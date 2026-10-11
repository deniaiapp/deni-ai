import { AsyncLocalStorage } from "node:async_hooks";
import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { member } from "@/db/schema";
import {
  deletePersonalBillingRecords,
  takeDetachedTeamBillingContacts,
} from "@/lib/account-deletion-billing";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordTeamAuditEvent, updateTeamSeatCount } from "@/lib/team-billing";
import {
  findTeamBillingContactOrganizations,
  redirectTeamBillingEmail,
  releaseTeamBillingContact,
} from "@/lib/team-billing-contact";

const auditActor = new AsyncLocalStorage<string>();

// Better Auth trims roles when validating them but not in its owner checks, so a
// padded multi-role such as "admin, owner" passes as a non-owner and is later
// trusted as an owner. Accept only one exact role. Invitations never grant
// ownership; an owner hands it over with a role update instead.
const INVITATION_ROLES: ReadonlySet<string> = new Set(["member", "admin"]);
const MEMBER_ROLES: ReadonlySet<string> = new Set(["member", "admin", "owner"]);

function assertTeamRole(role: string, allowed: ReadonlySet<string>) {
  if (!allowed.has(role)) {
    throw new APIError("BAD_REQUEST", { message: "Role not found", code: "ROLE_NOT_FOUND" });
  }
}

const INVITATION_WINDOW_MS = 60 * 60 * 1000;
// Enough to fill a team up to its membership limit in one sitting.
const INVITATIONS_PER_INVITER = 50;
// Bounds resends to one inbox, whichever teams or accounts send them.
const INVITATIONS_PER_RECIPIENT = 5;

async function canInviteToTeam(userId: string, organizationId: string) {
  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1);
  return Boolean(
    membership?.role.split(",").some((role) => ["owner", "admin"].includes(role.trim())),
  );
}

/**
 * Runs before `/organization/invite-member`. Its resend branch emails again and
 * returns before the invitation limit and every invitation hook, so this is the
 * only point that sees both new invitations and resends.
 */
export async function assertCanSendTeamInvitation({
  user,
  email,
  organizationId,
}: {
  user: { id: string; isAnonymous?: boolean | null };
  email: unknown;
  organizationId: unknown;
}) {
  // Guests have placeholder addresses and must not mail people from the app's sender.
  if (user.isAnonymous) {
    throw new APIError("FORBIDDEN", {
      message: "You are not allowed to invite users to this organization",
      code: "YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION",
    });
  }
  // This runs before the endpoint's own permission checks. Count only senders
  // it will accept, so strangers cannot spend a team's budget for an address.
  if (typeof organizationId !== "string" || !(await canInviteToTeam(user.id, organizationId))) {
    return;
  }
  const limits = [{ key: `team-invite:inviter:${user.id}`, maxRequests: INVITATIONS_PER_INVITER }];
  if (typeof email === "string") {
    limits.push({
      // Capped: the key outlives the request, and no valid address is this long.
      key: `team-invite:recipient:${organizationId}:${email.trim().toLowerCase().slice(0, 320)}`,
      maxRequests: INVITATIONS_PER_RECIPIENT,
    });
  }
  for (const limit of limits) {
    const result = await checkRateLimit({ ...limit, windowMs: INVITATION_WINDOW_MS });
    if (!result.allowed) {
      throw new APIError("TOO_MANY_REQUESTS", {
        message: "Too many requests. Please try again later.",
        code: "TOO_MANY_REQUESTS",
      });
    }
  }
}

type InvitationRoleCheck = { invitation: { role: string } };

export const teamInvitationHooks = {
  beforeCreateInvitation: async ({ invitation }: InvitationRoleCheck) => {
    assertTeamRole(invitation.role, INVITATION_ROLES);
  },
  // Also stops invitations stored before roles were checked from being accepted.
  beforeAcceptInvitation: async ({ invitation }: InvitationRoleCheck) => {
    assertTeamRole(invitation.role, INVITATION_ROLES);
  },
};

export function withTeamAuditActor<T>(userId: string | undefined, run: () => T): T {
  // Never infer the actor from the target member or from client-supplied IDs.
  return auditActor.run(userId ?? "", run);
}

function requireAuditActor(): string {
  const userId = auditActor.getStore();
  if (!userId) throw new Error("Authenticated team audit context is required.");
  return userId;
}

type MemberChange = {
  member: { userId: string; role: string };
  organization: { id: string };
};

/** Better Auth's leave endpoint bypasses its remove-member hooks. */
export async function withTeamLeaveAudit(
  request: Request,
  userId: string | undefined,
  run: () => Promise<Response>,
) {
  if (!userId) return run();
  const body = (await request
    .clone()
    .json()
    .catch(() => null)) as { organizationId?: unknown } | null;
  if (typeof body?.organizationId !== "string") return run();
  const organizationId = body.organizationId;
  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1);
  const response = await run();
  // Only the authenticated framework mutation can authorize a successful leave.
  if (response.ok && membership) {
    // First: it never throws, so a failed audit write cannot keep a former
    // member as the team's billing contact.
    await releaseTeamBillingContact(organizationId, userId);
    await recordTeamAuditEvent({
      organizationId,
      actorUserId: userId,
      targetUserId: userId,
      action: "member_removed",
      metadata: { role: membership.role, selfLeave: true },
    });
    await updateTeamSeatCount(organizationId);
  }
  return response;
}

type Departure = {
  organizationIds: string[];
  billingContactOrganizationIds: string[];
  email: string | null;
};
const departures = new Map<string, Departure>();

/**
 * Account deletion drops memberships through the `member.user_id` cascade, so no
 * organization hook runs. Capture the user's teams before the row goes and
 * reconcile their seats after. No `member_removed` event is written for the
 * departure itself; earlier entries keep their actor as a deleted user.
 *
 * Team billing rows outlive the user (`billing.user_id` is SET NULL, and a
 * self-service deletion clears it earlier); invoices that may still go to the
 * departing user move to a current owner, for every team they belonged to or
 * were the billing contact of.
 */
export const accountDeletionSeatHooks = {
  before: async (user: { id: string; email?: string | null }) => {
    // Unlike the reads below this must succeed: a personal billing row may not
    // lose its user, so the user row cannot be deleted while one remains.
    await deletePersonalBillingRecords(user.id);
    const departure: Departure = {
      organizationIds: [],
      billingContactOrganizationIds: [],
      email: user.email ?? null,
    };
    try {
      const memberships = await db
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, user.id));
      departure.organizationIds = memberships.map((membership) => membership.organizationId);
    } catch (error) {
      // Sessions and accounts are already gone here; never abort the deletion.
      console.error("[team-billing] Failed to read memberships before account deletion:", error);
    }
    // Self-service deletion already cleared these rows' contact; other deletion
    // paths leave that to the FK, so read them before it does.
    departure.billingContactOrganizationIds = takeDetachedTeamBillingContacts(user.id);
    try {
      departure.billingContactOrganizationIds.push(
        ...(await findTeamBillingContactOrganizations(user.id)),
      );
    } catch (error) {
      console.error(
        "[team-billing] Failed to read billing contacts before account deletion:",
        error,
      );
    }
    departures.set(user.id, departure);
  },
  after: async (user: { id: string }) => {
    const departure = departures.get(user.id);
    departures.delete(user.id);
    if (!departure) return;
    // Never throws, so it runs first.
    const teams = new Set([
      ...departure.organizationIds,
      ...departure.billingContactOrganizationIds,
    ]);
    for (const organizationId of teams) {
      await redirectTeamBillingEmail(organizationId, { userId: user.id, email: departure.email });
    }
    for (const organizationId of departure.organizationIds) {
      await updateTeamSeatCount(organizationId);
    }
  },
};

/** Called only by better-auth after it has authorized and performed the mutation. */
export const teamMemberAuditHooks = {
  beforeRemoveMember: async () => {
    requireAuditActor();
  },
  beforeUpdateMemberRole: async ({ newRole }: { newRole: string }) => {
    requireAuditActor();
    assertTeamRole(newRole, MEMBER_ROLES);
  },
  afterRemoveMember: async ({ member, organization }: MemberChange) => {
    // First: it never throws, so a failed audit write cannot keep a removed
    // member as the team's billing contact.
    await releaseTeamBillingContact(organization.id, member.userId);
    await recordTeamAuditEvent({
      organizationId: organization.id,
      actorUserId: requireAuditActor(),
      targetUserId: member.userId,
      action: "member_removed",
      metadata: { role: member.role },
    });
    await updateTeamSeatCount(organization.id);
  },
  afterUpdateMemberRole: async ({
    member,
    organization,
    previousRole,
  }: MemberChange & { previousRole: string }) => {
    await recordTeamAuditEvent({
      organizationId: organization.id,
      actorUserId: requireAuditActor(),
      targetUserId: member.userId,
      action: "member_role_updated",
      metadata: { previousRole, newRole: member.role },
    });
  },
};

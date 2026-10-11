import { AsyncLocalStorage } from "node:async_hooks";
import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { member } from "@/db/schema";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordTeamAuditEvent, updateTeamSeatCount } from "@/lib/team-billing";

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

/**
 * Runs before `/organization/invite-member`. Its resend branch emails again and
 * returns before the invitation limit and every invitation hook, so this is the
 * only point that sees both new invitations and resends.
 */
export async function assertCanSendTeamInvitation({
  user,
  email,
}: {
  user: { id: string; isAnonymous?: boolean | null };
  email: unknown;
}) {
  // Guests have placeholder addresses and must not mail people from the app's sender.
  if (user.isAnonymous) {
    throw new APIError("FORBIDDEN", {
      message: "You are not allowed to invite users to this organization",
      code: "YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION",
    });
  }
  const limits = [{ key: `team-invite:inviter:${user.id}`, maxRequests: INVITATIONS_PER_INVITER }];
  if (typeof email === "string") {
    limits.push({
      // Capped: the key outlives the request, and no valid address is this long.
      key: `team-invite:recipient:${email.trim().toLowerCase().slice(0, 320)}`,
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

const departingOrganizations = new Map<string, string[]>();

/**
 * Account deletion drops memberships through the `member.user_id` cascade, so no
 * organization hook runs. Capture the user's teams before the row goes and
 * reconcile their seats after. No `member_removed` event is written: the audit
 * log's actor references the deleted user and would be cascaded away with it.
 */
export const accountDeletionSeatHooks = {
  before: async (user: { id: string }) => {
    try {
      const memberships = await db
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(eq(member.userId, user.id));
      departingOrganizations.set(
        user.id,
        memberships.map((membership) => membership.organizationId),
      );
    } catch (error) {
      // Sessions and accounts are already gone here; never abort the deletion.
      console.error("[team-billing] Failed to read memberships before account deletion:", error);
    }
  },
  after: async (user: { id: string }) => {
    const organizationIds = departingOrganizations.get(user.id) ?? [];
    departingOrganizations.delete(user.id);
    for (const organizationId of organizationIds) {
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

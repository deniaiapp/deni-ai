import { resolveTxt } from "node:dns/promises";
import { generateRandomString } from "better-auth/crypto";
import { and, count, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { member, teamDomain, teamDomainPolicy, user } from "@/db/schema";
import { extractEmailDomain } from "@/lib/email-domain-policy";
import {
  cancelPersonalSubscription,
  hasPaidTeamPlan,
  recordTeamAuditEvent,
  updateTeamSeatCount,
} from "@/lib/team-billing";
import {
  type TeamDomainJoinMode,
  teamDomainTxtRecord,
  toTeamDomainJoinMode,
} from "@/lib/team-domain-policy";

/** Matches the organization plugin's `membershipLimit` in auth.ts. */
export const TEAM_MEMBERSHIP_LIMIT = 50;

// Team domains are a paid team feature (hasPaidTeamPlan). A lapsed plan keeps
// its domains, but they stop applying.

export function createTeamDomainVerificationToken() {
  return generateRandomString(32, "a-z", "0-9");
}

/** True when the domain publishes the team's verification TXT record. */
export async function hasTeamDomainTxtRecord(domain: string, token: string) {
  const record = teamDomainTxtRecord(domain, token);
  try {
    const records = await resolveTxt(record.name);
    return records.some((chunks) => chunks.join("").trim() === record.value);
  } catch {
    // NXDOMAIN, NODATA and timeouts all mean "not verified yet".
    return false;
  }
}

export async function getTeamDomainJoinMode(organizationId: string): Promise<TeamDomainJoinMode> {
  const [policy] = await db
    .select({ joinMode: teamDomainPolicy.joinMode })
    .from(teamDomainPolicy)
    .where(eq(teamDomainPolicy.organizationId, organizationId))
    .limit(1);
  return toTeamDomainJoinMode(policy?.joinMode);
}

/** The team whose verified domain matches the email, while its plan is paid. */
export async function findActiveTeamForEmail(email: string | null | undefined) {
  const domain = email ? extractEmailDomain(email) : null;
  if (!domain) return null;
  const [claim] = await db
    .select({ organizationId: teamDomain.organizationId })
    .from(teamDomain)
    .where(and(eq(teamDomain.domain, domain), isNotNull(teamDomain.verifiedAt)))
    .limit(1);
  if (!claim || !(await hasPaidTeamPlan(claim.organizationId))) return null;
  return {
    organizationId: claim.organizationId,
    joinMode: await getTeamDomainJoinMode(claim.organizationId),
  };
}

/** Sign-up allowlist exception: addresses on a verified domain of a paid team. */
export async function isActiveTeamEmailDomain(email: string) {
  return Boolean(await findActiveTeamForEmail(email));
}

export type TeamDomainJoinSource = "domain_auto" | "domain_request";

/**
 * Adds a user to a team as a member, the same way an accepted invitation does
 * (seat count, personal subscription, audit). Returns false when the user is
 * already a member or the team is full.
 */
export async function addTeamMemberFromDomain({
  organizationId,
  userId,
  actorUserId,
  source,
}: {
  organizationId: string;
  userId: string;
  /** The approving admin, or the user themselves for automatic joins. */
  actorUserId: string;
  source: TeamDomainJoinSource;
}) {
  const added = await db.transaction(async (transaction) => {
    // Serializes concurrent sign-ins and approvals: `member` has no unique key.
    await transaction.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`team-member:${organizationId}`}, 0))`,
    );
    const [existing] = await transaction
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
      .limit(1);
    if (existing) return false;
    const [members] = await transaction
      .select({ count: count() })
      .from(member)
      .where(eq(member.organizationId, organizationId));
    if ((members?.count ?? 0) >= TEAM_MEMBERSHIP_LIMIT) return false;
    await transaction.insert(member).values({
      id: generateRandomString(32),
      organizationId,
      userId,
      role: "member",
      createdAt: new Date(),
    });
    return true;
  });
  if (!added) return false;

  await updateTeamSeatCount(organizationId);
  await cancelPersonalSubscription(userId, organizationId);
  await recordTeamAuditEvent({
    organizationId,
    actorUserId,
    targetUserId: userId,
    action: "member_joined",
    metadata: { role: "member", source },
  });
  return true;
}

/** On sign-in, adds a verified domain user to a team that joins them automatically. */
export async function joinTeamByDomainOnSignIn(userId: string) {
  const [account] = await db
    .select({ email: user.email, emailVerified: user.emailVerified, isAnonymous: user.isAnonymous })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  // Only a proved mailbox speaks for the domain.
  if (!account?.emailVerified || account.isAnonymous) return;
  const team = await findActiveTeamForEmail(account.email);
  if (team?.joinMode !== "auto") return;
  await addTeamMemberFromDomain({
    organizationId: team.organizationId,
    userId,
    actorUserId: userId,
    source: "domain_auto",
  });
}

import { TRPCError } from "@trpc/server";
import { and, asc, eq, isNotNull, ne } from "drizzle-orm";
import { z } from "zod";
import {
  member,
  organization,
  teamDomain,
  teamDomainPolicy,
  teamJoinRequest,
  user,
} from "@/db/schema";
import { hasPaidTeamPlan, recordTeamAuditEvent } from "@/lib/team-billing";
import {
  isSharedEmailDomain,
  normalizeTeamDomain,
  TEAM_DOMAIN_JOIN_MODES,
  teamDomainTxtRecord,
} from "@/lib/team-domain-policy";
import {
  addTeamMemberFromDomain,
  createTeamDomainVerificationToken,
  findActiveTeamForEmail,
  getTeamDomainJoinMode,
  hasTeamDomainTxtRecord,
} from "@/lib/team-domains";
import { type ProtectedContext, protectedProcedure, rateLimited, router } from "../trpc";

/** Each check is a DNS lookup; a new record takes minutes to appear anyway. */
const DOMAIN_VERIFY_LIMIT = { windowMs: 60_000, maxRequests: 10 };
const MAX_DOMAINS_PER_TEAM = 10;

const organizationInput = z.object({ organizationId: z.string().min(1) });

const signedInProcedure = protectedProcedure.use(({ ctx, next }) => {
  // Guests have placeholder emails, so they neither own domains nor join by one.
  if (ctx.session?.user?.isAnonymous) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Sign in before managing teams." });
  }
  return next();
});

async function verifyOrgOwnerOrAdmin(ctx: ProtectedContext, organizationId: string) {
  const [memberRecord] = await ctx.db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, ctx.userId)))
    .limit(1);

  if (!memberRecord || (memberRecord.role !== "owner" && memberRecord.role !== "admin")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only organization owners or admins can manage this.",
    });
  }
}

async function requirePaidTeamPlan(organizationId: string) {
  if (!(await hasPaidTeamPlan(organizationId))) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Team domains require a paid team plan.",
    });
  }
}

async function findTeamDomain(ctx: ProtectedContext, organizationId: string, domainId: string) {
  const [record] = await ctx.db
    .select()
    .from(teamDomain)
    .where(and(eq(teamDomain.id, domainId), eq(teamDomain.organizationId, organizationId)))
    .limit(1);
  if (!record) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Domain not found." });
  }
  return record;
}

async function isVerifiedByAnotherTeam(
  ctx: ProtectedContext,
  organizationId: string,
  domain: string,
) {
  const [claim] = await ctx.db
    .select({ id: teamDomain.id })
    .from(teamDomain)
    .where(
      and(
        eq(teamDomain.domain, domain),
        isNotNull(teamDomain.verifiedAt),
        ne(teamDomain.organizationId, organizationId),
      ),
    )
    .limit(1);
  return Boolean(claim);
}

function domainTakenError() {
  return new TRPCError({
    code: "CONFLICT",
    message: "This domain is already verified by another team.",
  });
}

/** Only a proved mailbox speaks for its domain. */
function verifiedEmail(ctx: ProtectedContext) {
  const sessionUser = ctx.session?.user;
  return sessionUser?.emailVerified && !sessionUser.isAnonymous ? sessionUser.email : null;
}

async function isTeamMember(ctx: ProtectedContext, organizationId: string, userId: string) {
  const [membership] = await ctx.db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
    .limit(1);
  return Boolean(membership);
}

export const teamDomainsRouter = router({
  settings: signedInProcedure.input(organizationInput).query(async ({ ctx, input }) => {
    await verifyOrgOwnerOrAdmin(ctx, input.organizationId);
    const [isPaid, joinMode, domains] = await Promise.all([
      hasPaidTeamPlan(input.organizationId),
      getTeamDomainJoinMode(input.organizationId),
      ctx.db
        .select()
        .from(teamDomain)
        .where(eq(teamDomain.organizationId, input.organizationId))
        .orderBy(asc(teamDomain.createdAt), asc(teamDomain.domain)),
    ]);
    return {
      isPaid,
      joinMode,
      domains: domains.map((record) => ({
        id: record.id,
        domain: record.domain,
        verifiedAt: record.verifiedAt,
        txtRecord: teamDomainTxtRecord(record.domain, record.verificationToken),
      })),
    };
  }),

  addDomain: signedInProcedure
    .input(organizationInput.extend({ domain: z.string().trim().min(1).max(260) }))
    .mutation(async ({ ctx, input }) => {
      await verifyOrgOwnerOrAdmin(ctx, input.organizationId);
      await requirePaidTeamPlan(input.organizationId);
      const domain = normalizeTeamDomain(input.domain);
      if (!domain) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid domain." });
      }
      if (isSharedEmailDomain(domain)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Shared email provider domains cannot be added to a team.",
        });
      }
      if (await isVerifiedByAnotherTeam(ctx, input.organizationId, domain)) {
        throw domainTakenError();
      }
      const existing = await ctx.db
        .select({ domain: teamDomain.domain })
        .from(teamDomain)
        .where(eq(teamDomain.organizationId, input.organizationId));
      if (existing.some((record) => record.domain === domain)) {
        throw new TRPCError({ code: "CONFLICT", message: "This domain is already added." });
      }
      if (existing.length >= MAX_DOMAINS_PER_TEAM) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A team can add up to 10 domains.",
        });
      }

      await ctx.db.insert(teamDomain).values({
        organizationId: input.organizationId,
        domain,
        verificationToken: createTeamDomainVerificationToken(),
      });
      await recordTeamAuditEvent({
        organizationId: input.organizationId,
        actorUserId: ctx.userId,
        action: "domain_added",
        metadata: { domain },
      });
      return { domain };
    }),

  verifyDomain: signedInProcedure
    .use(rateLimited("teamDomains.verifyDomain", DOMAIN_VERIFY_LIMIT))
    .input(organizationInput.extend({ domainId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await verifyOrgOwnerOrAdmin(ctx, input.organizationId);
      await requirePaidTeamPlan(input.organizationId);
      const record = await findTeamDomain(ctx, input.organizationId, input.domainId);
      if (record.verifiedAt) return { verified: true };
      if (!(await hasTeamDomainTxtRecord(record.domain, record.verificationToken))) {
        return { verified: false };
      }
      if (await isVerifiedByAnotherTeam(ctx, input.organizationId, record.domain)) {
        throw domainTakenError();
      }
      try {
        await ctx.db
          .update(teamDomain)
          .set({ verifiedAt: new Date() })
          .where(eq(teamDomain.id, record.id));
      } catch (error) {
        // The unique index on verified domains: another team verified it first.
        console.error("Failed to mark team domain verified", error);
        throw domainTakenError();
      }
      await recordTeamAuditEvent({
        organizationId: input.organizationId,
        actorUserId: ctx.userId,
        action: "domain_verified",
        metadata: { domain: record.domain },
      });
      return { verified: true };
    }),

  // Allowed without a paid plan, so a lapsed team can still release a domain.
  removeDomain: signedInProcedure
    .input(organizationInput.extend({ domainId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await verifyOrgOwnerOrAdmin(ctx, input.organizationId);
      const record = await findTeamDomain(ctx, input.organizationId, input.domainId);
      await ctx.db.delete(teamDomain).where(eq(teamDomain.id, record.id));
      await recordTeamAuditEvent({
        organizationId: input.organizationId,
        actorUserId: ctx.userId,
        action: "domain_removed",
        metadata: { domain: record.domain },
      });
      return { success: true };
    }),

  updateJoinMode: signedInProcedure
    .input(organizationInput.extend({ joinMode: z.enum(TEAM_DOMAIN_JOIN_MODES) }))
    .mutation(async ({ ctx, input }) => {
      await verifyOrgOwnerOrAdmin(ctx, input.organizationId);
      await requirePaidTeamPlan(input.organizationId);
      const previous = await getTeamDomainJoinMode(input.organizationId);
      await ctx.db
        .insert(teamDomainPolicy)
        .values({ organizationId: input.organizationId, joinMode: input.joinMode })
        .onConflictDoUpdate({
          target: teamDomainPolicy.organizationId,
          set: { joinMode: input.joinMode, updatedAt: new Date() },
        });
      if (previous !== input.joinMode) {
        await recordTeamAuditEvent({
          organizationId: input.organizationId,
          actorUserId: ctx.userId,
          action: "domain_join_mode_updated",
          metadata: { previous: { joinMode: previous }, next: { joinMode: input.joinMode } },
        });
      }
      return { joinMode: input.joinMode };
    }),

  /** The team the signed-in user may ask to join through their email domain. */
  suggestion: signedInProcedure.query(async ({ ctx }) => {
    const team = await findActiveTeamForEmail(verifiedEmail(ctx));
    if (team?.joinMode !== "request") return null;
    const [isMember, [request], [org]] = await Promise.all([
      isTeamMember(ctx, team.organizationId, ctx.userId),
      ctx.db
        .select({ status: teamJoinRequest.status })
        .from(teamJoinRequest)
        .where(
          and(
            eq(teamJoinRequest.organizationId, team.organizationId),
            eq(teamJoinRequest.userId, ctx.userId),
          ),
        )
        .limit(1),
      ctx.db
        .select({ id: organization.id, name: organization.name, logo: organization.logo })
        .from(organization)
        .where(eq(organization.id, team.organizationId))
        .limit(1),
    ]);
    // A declined request is final; the team can still send an invitation.
    if (isMember || !org || request?.status === "declined") return null;
    return { organization: org, requested: request?.status === "pending" };
  }),

  requestToJoin: signedInProcedure.input(organizationInput).mutation(async ({ ctx, input }) => {
    const team = await findActiveTeamForEmail(verifiedEmail(ctx));
    if (team?.organizationId !== input.organizationId || team.joinMode !== "request") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This team does not accept join requests from your email domain.",
      });
    }
    if (await isTeamMember(ctx, input.organizationId, ctx.userId)) {
      return { success: true };
    }
    const [created] = await ctx.db
      .insert(teamJoinRequest)
      .values({ organizationId: input.organizationId, userId: ctx.userId })
      .onConflictDoNothing()
      .returning({ id: teamJoinRequest.id });
    if (created) {
      await recordTeamAuditEvent({
        organizationId: input.organizationId,
        actorUserId: ctx.userId,
        targetUserId: ctx.userId,
        action: "join_requested",
      });
    }
    return { success: true };
  }),

  joinRequests: signedInProcedure.input(organizationInput).query(async ({ ctx, input }) => {
    await verifyOrgOwnerOrAdmin(ctx, input.organizationId);
    return ctx.db
      .select({
        id: teamJoinRequest.id,
        userId: teamJoinRequest.userId,
        createdAt: teamJoinRequest.createdAt,
        name: user.name,
        email: user.email,
        image: user.image,
      })
      .from(teamJoinRequest)
      .innerJoin(user, eq(user.id, teamJoinRequest.userId))
      .where(
        and(
          eq(teamJoinRequest.organizationId, input.organizationId),
          eq(teamJoinRequest.status, "pending"),
        ),
      )
      .orderBy(asc(teamJoinRequest.createdAt));
  }),

  decideJoinRequest: signedInProcedure
    .input(organizationInput.extend({ requestId: z.string().min(1), approve: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await verifyOrgOwnerOrAdmin(ctx, input.organizationId);
      const [request] = await ctx.db
        .select({ userId: teamJoinRequest.userId })
        .from(teamJoinRequest)
        .where(
          and(
            eq(teamJoinRequest.id, input.requestId),
            eq(teamJoinRequest.organizationId, input.organizationId),
            eq(teamJoinRequest.status, "pending"),
          ),
        )
        .limit(1);
      if (!request) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Join request not found." });
      }

      if (
        input.approve &&
        !(await isTeamMember(ctx, input.organizationId, request.userId)) &&
        !(await addTeamMemberFromDomain({
          organizationId: input.organizationId,
          userId: request.userId,
          actorUserId: ctx.userId,
          source: "domain_request",
        }))
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This team has reached its member limit.",
        });
      }

      await ctx.db
        .update(teamJoinRequest)
        .set({
          status: input.approve ? "approved" : "declined",
          decidedByUserId: ctx.userId,
          decidedAt: new Date(),
        })
        .where(eq(teamJoinRequest.id, input.requestId));
      if (!input.approve) {
        await recordTeamAuditEvent({
          organizationId: input.organizationId,
          actorUserId: ctx.userId,
          targetUserId: request.userId,
          action: "join_request_declined",
        });
      }
      return { success: true };
    }),
});

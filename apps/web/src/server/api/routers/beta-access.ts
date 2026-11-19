import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { normalizeBetaEmail } from "@/lib/beta-access";
import { forgetBetaAccess, isBetaAccessRequired, isBetaAdmin } from "@/lib/beta-access.server";
import { betaAccessStore } from "@/lib/beta-access-store";
import { protectedProcedure, router, type ProtectedContext } from "../trpc";

/** The verified admin calling, or FORBIDDEN (same rule as reset-credit grants). */
function requireAdmin(ctx: ProtectedContext) {
  const user = ctx.session?.user;
  if (!user || !isBetaAdmin(user)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Beta tester administration is limited to Deni AI operators.",
    });
  }
  return { id: ctx.userId, email: user.email };
}

const NOTE_MAX_LENGTH = 500;

/**
 * Private beta testers (`beta_access`), managed by operators from
 * Settings > Beta testers. Grants and removals are logged with the operator's
 * email (like reset-credit grants), and `granted_by` keeps who added a tester.
 */
export const betaAccessRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    requireAdmin(ctx);
    return { required: isBetaAccessRequired(), testers: await betaAccessStore.list() };
  }),

  grant: protectedProcedure
    .input(
      z.object({
        email: z.string().trim().max(320).pipe(z.email()),
        note: z.string().trim().max(NOTE_MAX_LENGTH).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const admin = requireAdmin(ctx);
      const email = normalizeBetaEmail(input.email);
      const note = input.note ? input.note : null;
      const added = await betaAccessStore.add({ email, note, grantedBy: admin.id });
      if (!added) {
        throw new TRPCError({ code: "CONFLICT", message: "This email is already a beta tester." });
      }
      console.info("[beta-access] Beta access granted", {
        adminEmail: admin.email,
        email,
        grantId: added.id,
      });
      return added;
    }),

  revoke: protectedProcedure
    .input(z.object({ id: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      const admin = requireAdmin(ctx);
      const removed = await betaAccessStore.remove(input.id);
      if (!removed) {
        throw new TRPCError({ code: "NOT_FOUND", message: "This beta tester no longer exists." });
      }
      if (removed.userId) forgetBetaAccess(removed.userId);
      console.info("[beta-access] Beta access removed", {
        adminEmail: admin.email,
        email: removed.email,
        grantId: removed.id,
      });
      return { id: removed.id };
    }),
});

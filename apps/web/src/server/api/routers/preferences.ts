import { eq } from "drizzle-orm";
import { z } from "zod";
import { models } from "@deniai/ai/models";
import { userPreference } from "@/db/schema";
import { protectedProcedure, router } from "../trpc";

/** A model id from the catalog; whether the plan allows it is checked when it is used. */
export const knownModelSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => models.some((entry) => entry.value === value), "Unknown model");

export const preferencesRouter = router({
  /** Account-wide settings; `preferredModel` is null until a model is picked. */
  get: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({ preferredModel: userPreference.preferredModel })
      .from(userPreference)
      .where(eq(userPreference.userId, ctx.userId))
      .limit(1);
    return { preferredModel: row?.preferredModel ?? null };
  }),

  /** The model last picked in the composer: the default for new chats on every device. */
  setPreferredModel: protectedProcedure
    .input(z.object({ model: knownModelSchema }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .insert(userPreference)
        .values({ userId: ctx.userId, preferredModel: input.model })
        .onConflictDoUpdate({
          target: userPreference.userId,
          set: { preferredModel: input.model, updatedAt: new Date() },
        });
      return { preferredModel: input.model };
    }),
});

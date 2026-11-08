import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { platformCapabilities } from "@/lib/platform-capabilities.server";
import { memoryItem, userMemory } from "@/db/schema";
import { protectedProcedure, router } from "../trpc";

const toneSchema = z.enum(["concise", "balanced", "detailed"]);
const friendlinessSchema = z.enum(["neutral", "friendly", "very-friendly"]);
const warmthSchema = z.enum(["neutral", "warm", "very-warm"]);
const emojiStyleSchema = z.enum(["none", "light", "expressive"]);

const profileInputSchema = z.object({
  instructions: z
    .string()
    .trim()
    .max(4000)
    .transform((value) => value.trim()),
  tone: toneSchema,
  friendliness: friendlinessSchema,
  warmth: warmthSchema,
  emojiStyle: emojiStyleSchema,
  autoMemory: z.boolean(),
});

const itemInputSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .transform((value) => value.trim()),
});

const memoryEnabledProcedure = protectedProcedure.use(({ next }) => {
  if (!platformCapabilities.features.memory) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Memory is disabled in this environment.",
    });
  }
  return next();
});

export const memoryRouter = router({
  get: memoryEnabledProcedure.query(async ({ ctx }) => {
    const [profile, items] = await Promise.all([
      ctx.db
        .select()
        .from(userMemory)
        .where(eq(userMemory.userId, ctx.userId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      ctx.db
        .select()
        .from(memoryItem)
        .where(eq(memoryItem.userId, ctx.userId))
        .orderBy(memoryItem.updatedAt),
    ]);

    return {
      profile: profile ?? {
        userId: ctx.userId,
        instructions: "",
        tone: "balanced",
        friendliness: "friendly",
        warmth: "warm",
        emojiStyle: "light",
        autoMemory: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      items,
    };
  }),

  upsertProfile: memoryEnabledProcedure
    .input(profileInputSchema)
    .mutation(async ({ ctx, input }) => {
      const [profile] = await ctx.db
        .insert(userMemory)
        .values({
          userId: ctx.userId,
          ...input,
        })
        .onConflictDoUpdate({
          target: userMemory.userId,
          set: {
            ...input,
            updatedAt: new Date(),
          },
        })
        .returning();

      return profile;
    }),

  addItem: memoryEnabledProcedure.input(itemInputSchema).mutation(async ({ ctx, input }) => {
    const normalizedContent = input.content.trim().toLowerCase();

    const existing = await ctx.db
      .select()
      .from(memoryItem)
      .where(eq(memoryItem.userId, ctx.userId));

    const duplicate = existing.find(
      (item) => item.content.trim().toLowerCase() === normalizedContent,
    );
    if (duplicate) {
      return duplicate;
    }

    const [item] = await ctx.db
      .insert(memoryItem)
      .values({
        id: nanoid(),
        userId: ctx.userId,
        content: input.content,
        source: "manual",
      })
      .returning();

    return item;
  }),

  deleteItem: memoryEnabledProcedure
    .input(
      z.object({
        id: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await ctx.db
        .delete(memoryItem)
        .where(and(eq(memoryItem.id, input.id), eq(memoryItem.userId, ctx.userId)))
        .returning();

      return deleted ?? null;
    }),

  clearItems: memoryEnabledProcedure.mutation(async ({ ctx }) => {
    const deleted = await ctx.db
      .delete(memoryItem)
      .where(eq(memoryItem.userId, ctx.userId))
      .returning({ id: memoryItem.id });

    return {
      count: deleted.length,
    };
  }),
});

export { emojiStyleSchema, friendlinessSchema, profileInputSchema, toneSchema, warmthSchema };

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { chats } from "@/db/schema";
import { omitUnownedAttachmentParts } from "@/lib/attachments";
import { MigrationPayloadTooLargeError, normalizeMigrationPayload } from "@/lib/migration";
import { checkRateLimit } from "@/lib/rate-limit";
import { protectedProcedure, router } from "../trpc";

/** Five bound parameters per chat row. */
export const IMPORT_BATCH_SIZE = 1000;

/** Each call can carry 25 MB of JSON and insert thousands of rows. */
export const IMPORT_RATE_LIMIT = { windowMs: 60 * 60 * 1000, maxRequests: 5 };

/** Runs before the input is parsed, so rejected calls never read their 25 MB body. */
const importProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  // Guest accounts are discarded when the visitor signs in, so an import there
  // would only cost storage.
  if (ctx.session?.user?.isAnonymous) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  const limit = await checkRateLimit({
    key: `migration-import:${ctx.userId}`,
    ...IMPORT_RATE_LIMIT,
  });
  if (!limit.allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Too many requests. Please try again later.",
    });
  }
  return next();
});

export const migrationRouter = router({
  import: importProcedure
    .input(
      z.object({
        payload: z.unknown().refine((val) => JSON.stringify(val).length <= 25_000_000, {
          message: "Payload too large (max 25 MB)",
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let normalized: ReturnType<typeof normalizeMigrationPayload>;
      try {
        normalized = normalizeMigrationPayload(input.payload);
      } catch (error) {
        // No message: clients localize the bare code.
        if (error instanceof MigrationPayloadTooLargeError) {
          throw new TRPCError({ code: "PAYLOAD_TOO_LARGE" });
        }
        throw error;
      }
      const { conversations, warnings } = normalized;

      if (!conversations.length) {
        return {
          success: false,
          importedChats: 0,
          importedMessages: 0,
          warnings,
          error: "No conversations found to import",
        };
      }

      // A deni-ai export of another account carries app URLs of that account's
      // files, which would make every request of the imported chat fail.
      const { conversations: importable, omitted } = await omitUnownedAttachmentParts(
        conversations,
        ctx.userId,
        ctx.db,
      );
      if (omitted > 0) {
        warnings.push(
          `${omitted} attached file(s) could not be imported: they belong to another account or no longer exist`,
        );
      }

      const now = new Date();
      // normalizeMigrationPayload already returns fresh JSON copies of the messages.
      const values = importable.map((conversation) => ({
        uid: ctx.userId,
        title: conversation.title,
        messages: conversation.messages,
        created_at: conversation.createdAt ?? now,
        updated_at: conversation.updatedAt ?? now,
      }));

      // One INSERT per batch keeps each statement below Postgres' 65,534 bind
      // parameter limit; the transaction keeps the import all-or-nothing.
      const importedChats = await ctx.db.transaction(async (tx) => {
        let count = 0;
        for (let index = 0; index < values.length; index += IMPORT_BATCH_SIZE) {
          const inserted = await tx
            .insert(chats)
            .values(values.slice(index, index + IMPORT_BATCH_SIZE))
            .returning({ id: chats.id });
          count += inserted.length;
        }
        return count;
      });

      return {
        success: true,
        importedChats,
        importedMessages: conversations.reduce(
          (count, conversation) => count + conversation.messages.length,
          0,
        ),
        warnings,
      };
    }),
});

export type MigrationRouter = typeof migrationRouter;

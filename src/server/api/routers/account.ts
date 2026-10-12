import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { securityActivity } from "@/db/schema";
import { buildAccountExport } from "@/lib/account-export";
import {
  accountExportFileName,
  findDownloadableAccountExportKey,
  getLatestAccountExport,
  runAccountExportJob,
  startAccountExport,
} from "@/lib/account-export-jobs";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordSecurityActivity } from "@/lib/security-activity";
import {
  ATTACHMENT_EXPORT_URL_TTL_SECONDS,
  isStorageConfigured,
  signAttachmentUrl,
} from "@/lib/upload";
import { protectedProcedure, router } from "../trpc";
import { historyBefore, historyCursorSchema, historyCursorTimestamp } from "../history-pagination";

const EXPORT_INTERVAL_MS = 60_000;
const EXPORT_THROTTLED = "Please wait a minute before exporting again.";
const EXPORT_UNAVAILABLE = "This export is no longer available.";

export const accountRouter = router({
  /**
   * With attachment storage configured, starts a background export (or
   * returns the one still being built): poll `exportStatus`, then download it
   * with `exportDownloadUrl`. Without storage (local development), builds the
   * export in the request and returns it for the browser to save.
   */
  requestExport: protectedProcedure.mutation(async ({ ctx }) => {
    // Claimed atomically before any work: the activity row below is written only
    // once the export is built or started, so concurrent calls (one batched
    // request) all pass that check.
    const slot = await checkRateLimit({
      key: `account-export:${ctx.userId}`,
      windowMs: EXPORT_INTERVAL_MS,
      maxRequests: 1,
    });
    if (!slot.allowed) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: EXPORT_THROTTLED });
    }

    // Still checked so the interval holds across instances without shared Redis.
    const [lastExport] = await ctx.db
      .select({ createdAt: securityActivity.createdAt })
      .from(securityActivity)
      .where(
        and(eq(securityActivity.userId, ctx.userId), eq(securityActivity.action, "data_exported")),
      )
      .orderBy(desc(securityActivity.createdAt))
      .limit(1);

    if (lastExport && Date.now() - lastExport.createdAt.getTime() < EXPORT_INTERVAL_MS) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: EXPORT_THROTTLED });
    }

    const activity = {
      userId: ctx.userId,
      action: "data_exported",
      ipAddress: ctx.session?.session.ipAddress ?? null,
      userAgent: ctx.session?.session.userAgent ?? null,
    } as const;

    if (!isStorageConfigured()) {
      const payload = await buildAccountExport(ctx.userId);
      await recordSecurityActivity(activity);
      return {
        mode: "download" as const,
        fileName: accountExportFileName(new Date()),
        payload,
      };
    }

    const started = await startAccountExport(ctx.userId, {}, ctx.db);
    if (started.created) {
      const job = {
        id: started.export.id,
        userId: ctx.userId,
        createdAt: started.export.createdAt,
      };
      // Runs once the response is sent, for up to the route's maximum duration
      // (Node.js servers wait for it on shutdown). Scheduled before anything
      // else can fail, so the new row never waits for a job that was not started.
      after(() => runAccountExportJob(job));
      // Logged when the export is requested, so the interval check above sees
      // it while the job runs.
      await recordSecurityActivity(activity);
    }
    return { mode: "background" as const, export: started.export };
  }),

  /**
   * The user's latest export (never its storage key), or null. Polled while
   * pending. Always null without storage, where exports are only built in the
   * request: rows left from when it was configured cannot be built or downloaded.
   */
  exportStatus: protectedProcedure.query(async ({ ctx }) =>
    isStorageConfigured() ? getLatestAccountExport(ctx.userId, {}, ctx.db) : null,
  ),

  /** A 15-minute signed URL to the user's own ready, unexpired export file. */
  exportDownloadUrl: protectedProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const storageKey = isStorageConfigured()
        ? await findDownloadableAccountExportKey(input.id, ctx.userId, {}, ctx.db)
        : null;
      if (!storageKey) {
        throw new TRPCError({ code: "NOT_FOUND", message: EXPORT_UNAVAILABLE });
      }
      return { url: await signAttachmentUrl(storageKey, ATTACHMENT_EXPORT_URL_TTL_SECONDS) };
    }),

  securityActivity: protectedProcedure
    .input(
      z
        .object({
          cursor: historyCursorSchema.optional(),
          limit: z.number().int().min(1).max(50).default(20),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      const cursor = input?.cursor;

      const rows = await ctx.db
        .select({
          id: securityActivity.id,
          action: securityActivity.action,
          ipAddress: securityActivity.ipAddress,
          userAgent: securityActivity.userAgent,
          createdAt: securityActivity.createdAt,
          cursorCreatedAt: historyCursorTimestamp(securityActivity.createdAt),
        })
        .from(securityActivity)
        .where(
          and(eq(securityActivity.userId, ctx.userId), historyBefore(securityActivity, cursor)),
        )
        .orderBy(desc(securityActivity.createdAt), desc(securityActivity.id))
        .limit(limit + 1);

      const page = rows.slice(0, limit);
      const last = page.at(-1);

      return {
        items: page.map(({ cursorCreatedAt, ...item }) => {
          void cursorCreatedAt;
          return item;
        }),
        nextCursor:
          rows.length > limit && last ? { createdAt: last.cursorCreatedAt, id: last.id } : null,
      };
    }),
});

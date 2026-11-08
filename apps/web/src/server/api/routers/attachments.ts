import { getStorageLimitForUser, getStorageUsageBytes } from "@/lib/attachments";
import { isStorageConfigured } from "@/lib/upload";
import { protectedProcedure, router } from "../trpc";

export const attachmentsRouter = router({
  /** Attachment storage counted against the user's plan quota. */
  storageUsage: protectedProcedure.query(async ({ ctx }) => {
    if (!isStorageConfigured()) return null;
    const [usedBytes, limitBytes] = await Promise.all([
      getStorageUsageBytes(ctx.userId),
      getStorageLimitForUser(ctx.userId, Boolean(ctx.session?.user?.isAnonymous)),
    ]);
    return { usedBytes, limitBytes };
  }),
});

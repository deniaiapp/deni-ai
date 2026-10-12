import type { SubscriptionTier } from "@/lib/usage";

/** Guests have their own allowance; signed-in users follow their plan tier. */
export type StoragePlan = SubscriptionTier | "guest";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/**
 * Total bytes of stored attachments per user. Team plans count as their tier
 * (Pro Team as Pro, Max Team as Max) and lifetime Pro as Pro.
 */
export const STORAGE_LIMIT_BYTES: Record<StoragePlan, number> = {
  guest: 20 * MIB,
  free: 100 * MIB,
  plus: 500 * MIB,
  pro: GIB,
  max: 2 * GIB,
};

export function getStorageLimitBytes(plan: StoragePlan): number {
  return STORAGE_LIMIT_BYTES[plan];
}

/** Whether a file of `sizeBytes` fits next to `usedBytes` within `limitBytes`. */
export function fitsStorageLimit(usedBytes: number, sizeBytes: number, limitBytes: number) {
  return usedBytes + sizeBytes <= limitBytes;
}

/** "95.3 MB" / "1.5 GB" (binary units, at most one decimal). */
export function formatStorageBytes(bytes: number): string {
  const safe = Math.max(0, bytes);
  const [value, unit] = safe >= GIB ? [safe / GIB, "GB"] : [safe / MIB, "MB"];
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} ${unit}`;
}

/**
 * Error the upload route returns when the quota is full. The client matches it
 * by pattern in `useLocalizeError`, so keep the wording in sync there.
 */
export function storageQuotaExceededMessage(usedBytes: number, limitBytes: number): string {
  return `Attachment storage is full (${formatStorageBytes(usedBytes)} of ${formatStorageBytes(limitBytes)} used). Delete chats with attachments or upgrade your plan.`;
}

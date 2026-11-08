import { createHash } from "node:crypto";
import path from "node:path";
import { eq } from "drizzle-orm";
import { runSettings } from "@deniai/db";
import { db, runConfig } from "../runtime";

/** Local data (workspace mirrors, browser profiles, screenshots) when object storage is off. */
function dataDir() {
  return path.resolve(runConfig().localDataDir);
}

const storageKeys = new Map<string, string>();

/**
 * The object storage prefix of a user: the SHA-256 of the user id, or the stored
 * `run_settings.storage_key` of an account migrated from the standalone Deni Run (its
 * old Run user id's hash, so existing S3 keys stay valid). Call {@link primeStorageKey}
 * before building keys.
 */
export function userStorageKey(userId: string) {
  return storageKeys.get(userId) ?? createHash("sha256").update(userId).digest("hex");
}

export async function primeStorageKey(userId: string) {
  if (storageKeys.has(userId)) return;
  const [row] = await db
    .select({ storageKey: runSettings.storageKey })
    .from(runSettings)
    .where(eq(runSettings.userId, userId))
    .limit(1);
  if (row?.storageKey) storageKeys.set(userId, row.storageKey);
}

export function userDataDir(userId: string) {
  return path.join(dataDir(), "users", userStorageKey(userId));
}

export function userWorkspaceDir(userId: string) {
  return path.join(userDataDir(userId), "workspace");
}

export function userBrowserDir(userId: string) {
  return path.join(userDataDir(userId), "browser-profile");
}

export function userScreenPath(userId: string, jobId?: string) {
  return jobId
    ? path.join(userDataDir(userId), "computer", "jobs", userStorageKey(jobId), "screen.png")
    : path.join(userDataDir(userId), "computer", "screen.png");
}

export function userWorkspacePrefix(userId: string) {
  return `users/${userStorageKey(userId)}/workspace/`;
}

export function jailPath(relativePath: string, root: string): string {
  const cleaned = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const resolved = path.resolve(root, cleaned);
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path is outside the workspace");
  }
  return resolved;
}

export function toWorkspacePath(abs: string, root: string): string {
  const rel = path.relative(root, abs).replace(/\\/g, "/");
  return rel ? `/${rel}` : "/";
}

export function defaultTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

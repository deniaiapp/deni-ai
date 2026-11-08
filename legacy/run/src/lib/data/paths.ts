import { createHash } from "node:crypto";
import path from "node:path";

export const ROOT = process.cwd();
export const DATA_DIR = path.join(ROOT, ".deni");

export function userStorageKey(userId: string) {
  return createHash("sha256").update(userId).digest("hex");
}

export function userDataDir(userId: string) {
  return path.join(DATA_DIR, "users", userStorageKey(userId));
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

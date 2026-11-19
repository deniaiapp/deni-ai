import { createHash } from "node:crypto";

export { API_KEY_PREFIX } from "./api-key";

/**
 * Synchronous SHA-256 hex digest of a raw API key for Node services (the agent
 * API validates keys on every request). Same output as `hashApiKey()` from
 * `@deniai/auth/api-key`.
 */
export function hashApiKeySync(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Deni AI API keys: `deni_` followed by 40 lowercase hex characters. Only the
 * SHA-256 hex digest of a key is stored (`api_key.key_hash`), next to its
 * first 13 characters for display.
 *
 * WebCrypto only, so this module runs in the web app (server and browser) and
 * in Node. Node services that hash on a hot path synchronously use
 * `@deniai/auth/api-key/node`, which produces the same digest.
 */

export const API_KEY_PREFIX = "deni_";

/** Length of the stored display prefix (`deni_` + 8 hex characters). */
export const API_KEY_DISPLAY_PREFIX_LENGTH = 13;

const API_KEY_RANDOM_BYTES = 20;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateApiKey(): string {
  const bytes = new Uint8Array(API_KEY_RANDOM_BYTES);
  crypto.getRandomValues(bytes);
  return `${API_KEY_PREFIX}${toHex(bytes)}`;
}

/** SHA-256 hex digest of a raw key, as stored in `api_key.key_hash`. */
export async function hashApiKey(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(hashBuffer));
}

export function getKeyPrefix(raw: string): string {
  return raw.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH);
}

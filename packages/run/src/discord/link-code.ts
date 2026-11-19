import { createHash, randomInt } from "node:crypto";

/**
 * Discord link codes: a short code the web app shows (Run settings) and the person
 * sends to the bot. Only the SHA-256 of the normalized code is stored
 * (`run_discord_link_codes.code_hash`). Pure helpers with no database access, so the
 * web app and the worker can share one format.
 */
export const LINK_CODE_TTL_MS = 10 * 60_000;
// No 0/O/1/I/L so a code read off a screen cannot be mistyped.
export const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 8;

export function hashLinkCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

/** People type codes as "ABCD-EFGH" or in lower case; both must match the stored hash. */
export function normalizeLinkCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatLinkCode(code: string) {
  return `${code.slice(0, CODE_LENGTH / 2)}-${code.slice(CODE_LENGTH / 2)}`;
}

/** The shape of a code, so the bot can treat a plain DM that looks like one as a link attempt. */
export function looksLikeLinkCode(value: string) {
  const code = normalizeLinkCode(value.trim());
  return (
    code.length === CODE_LENGTH &&
    [...code].every((char) => ALPHABET.includes(char)) &&
    /^[A-Za-z0-9\s-]+$/.test(value.trim())
  );
}

/** A fresh random code (unformatted, `CODE_LENGTH` characters from `ALPHABET`). */
export function generateLinkCode() {
  return Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

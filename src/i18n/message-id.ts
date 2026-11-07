import { sha512 } from "@noble/hashes/sha2.js";

// Catalog entries are keyed by the first six base64url characters of the SHA-512 of the source
// message, the same IDs the .po files carry in msgctxt. Six characters need 36 bits, so the first
// five bytes of the digest are enough.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const ids = new Map<string, string>();
const encoder = new TextEncoder();

export function messageId(message: string): string {
  const cached = ids.get(message);
  if (cached) return cached;
  const digest = sha512(encoder.encode(message));
  let bits = 0;
  let value = 0;
  let id = "";
  for (let index = 0; id.length < 6; index++) {
    value = (value << 8) | digest[index];
    bits += 8;
    while (bits >= 6 && id.length < 6) {
      bits -= 6;
      id += ALPHABET[(value >> bits) & 63];
    }
    value &= (1 << bits) - 1;
  }
  ids.set(message, id);
  return id;
}

// Lightweight AES-GCM wrapper using Web Crypto API
// Derives a key from BETTER_AUTH_SECRET so we don't introduce new env vars.

import { env } from "@/env";

function getSubtle() {
  // Node 18+/20+ exposes globalThis.crypto.subtle; on edge it's also available.
  const maybeCrypto = (globalThis as { crypto?: Crypto }).crypto;
  const subtle = (maybeCrypto ?? (require("node:crypto").webcrypto as Crypto)).subtle;
  return subtle;
}

/**
 * PBKDF2 at 310k iterations costs ~40 ms per call and the inputs (secret + salt)
 * are fixed for the process, so derive once and reuse. The promise is cached
 * rather than the key so concurrent callers share a single derivation.
 */
let cachedKey: Promise<CryptoKey> | null = null;

function deriveKey() {
  if (!cachedKey) {
    // Drop a rejected promise so a transient failure is not cached forever.
    cachedKey = deriveKeyUncached().catch((error) => {
      cachedKey = null;
      throw error;
    });
  }
  return cachedKey;
}

async function deriveKeyUncached() {
  const secret = env.BETTER_AUTH_SECRET;
  const enc = new TextEncoder();
  const salt = enc.encode("deni-ai:v1");
  const baseKey = await getSubtle().importKey(
    "raw",
    enc.encode(secret),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return getSubtle().deriveKey(
    { name: "PBKDF2", salt, iterations: 310_000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptToB64(plaintext: string) {
  const key = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ct = await getSubtle().encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  const out = new Uint8Array(iv.byteLength + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.byteLength);
  return Buffer.from(out).toString("base64");
}

export async function decryptFromB64(b64: string) {
  const raw = Buffer.from(b64, "base64");
  const iv = raw.slice(0, 12);
  const data = raw.slice(12);
  const key = await deriveKey();
  const pt = await getSubtle().decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(pt);
}

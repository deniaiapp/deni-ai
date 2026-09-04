import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

function encryptionKey() {
  const encoded = process.env.APP_ENCRYPTION_KEY;
  if (!encoded) throw new Error("APP_ENCRYPTION_KEY is required");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must decode to 32 bytes");
  }
  return key;
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptSecret(value: string) {
  if (!value) return "";
  if (!value.startsWith(PREFIX)) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Stored secret is not encrypted");
    }
    return value;
  }
  const [ivRaw, tagRaw, ciphertextRaw] = value.slice(PREFIX.length).split(".");
  if (!ivRaw || !tagRaw || !ciphertextRaw) throw new Error("Invalid encrypted secret");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivRaw, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

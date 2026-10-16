import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createAdminSessionToken,
  verifyAdminSessionToken,
} from "../middleware/adminAuth";

const PASSWORD = "test-password-not-a-secret";
const SECRET = "test-session-secret-0123456789abcdef-not-real";

const keys = ["ADMIN_PASSWORD", "ADMIN_SESSION_SECRET"] as const;
const original = Object.fromEntries(keys.map((key) => [key, Bun.env[key]]));

beforeEach(() => {
  Bun.env.ADMIN_PASSWORD = PASSWORD;
  delete Bun.env.ADMIN_SESSION_SECRET;
});

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete Bun.env[key];
    else Bun.env[key] = value;
  }
});

const enc = new TextEncoder();

async function hmac(
  key: Uint8Array<ArrayBuffer>,
  message: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signWith(key: Uint8Array<ArrayBuffer>, payload: string): Promise<string> {
  return `${payload}.${base64Url(await hmac(key, payload))}`;
}

/** The pre-fix key: the raw admin password with a fixed prefix. */
function rawPasswordKey(password: string): Uint8Array<ArrayBuffer> {
  return enc.encode(`flixa-admin-v1:${password}`);
}

async function pbkdf2Key(password: string): Promise<Uint8Array<ArrayBuffer>> {
  const base = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: enc.encode("flixa-admin-session-kdf-v1"),
        iterations: 100_000,
      },
      base,
      256,
    ),
  );
}

async function secretKey(
  secret: string,
  password: string,
): Promise<Uint8Array<ArrayBuffer>> {
  return hmac(enc.encode(secret), `flixa-admin-session-v1:${password}`);
}

function futureExp(): number {
  return Date.now() + 60 * 60 * 1000;
}

describe("admin session signing key without ADMIN_SESSION_SECRET", () => {
  test("issued tokens verify and are signed with a PBKDF2-derived key", async () => {
    const token = await createAdminSessionToken();
    expect(await verifyAdminSessionToken(token)).toBe(true);

    const payload = token.split(".").slice(0, 3).join(".");
    expect(token).toBe(await signWith(await pbkdf2Key(PASSWORD), payload));
    expect(token).not.toBe(await signWith(rawPasswordKey(PASSWORD), payload));
  });

  test("tokens signed with the raw password key are rejected", async () => {
    const exp = futureExp();
    const key = rawPasswordKey(PASSWORD);
    expect(
      await verifyAdminSessionToken(await signWith(key, `v2.${exp}.0123456789abcdef`)),
    ).toBe(false);
    expect(await verifyAdminSessionToken(await signWith(key, `v1.${exp}`))).toBe(false);
  });

  test("legacy v1 tokens signed with the current key still verify", async () => {
    const token = await signWith(await pbkdf2Key(PASSWORD), `v1.${futureExp()}`);
    expect(await verifyAdminSessionToken(token)).toBe(true);
  });

  test("changing ADMIN_PASSWORD invalidates existing sessions", async () => {
    const token = await createAdminSessionToken();
    Bun.env.ADMIN_PASSWORD = `${PASSWORD}-rotated`;
    expect(await verifyAdminSessionToken(token)).toBe(false);
    Bun.env.ADMIN_PASSWORD = PASSWORD;
    expect(await verifyAdminSessionToken(token)).toBe(true);
  });
});

describe("admin session signing key with ADMIN_SESSION_SECRET", () => {
  test("issued tokens verify and are keyed by the secret", async () => {
    Bun.env.ADMIN_SESSION_SECRET = SECRET;
    const token = await createAdminSessionToken();
    expect(await verifyAdminSessionToken(token)).toBe(true);

    const payload = token.split(".").slice(0, 3).join(".");
    expect(token).toBe(await signWith(await secretKey(SECRET, PASSWORD), payload));
    expect(token).not.toBe(await signWith(rawPasswordKey(PASSWORD), payload));
  });

  test("changing or removing the secret invalidates existing sessions", async () => {
    Bun.env.ADMIN_SESSION_SECRET = SECRET;
    const token = await createAdminSessionToken();

    Bun.env.ADMIN_SESSION_SECRET = `${SECRET}-rotated`;
    expect(await verifyAdminSessionToken(token)).toBe(false);

    delete Bun.env.ADMIN_SESSION_SECRET;
    expect(await verifyAdminSessionToken(token)).toBe(false);

    Bun.env.ADMIN_SESSION_SECRET = SECRET;
    expect(await verifyAdminSessionToken(token)).toBe(true);
  });

  test("changing ADMIN_PASSWORD still invalidates existing sessions", async () => {
    Bun.env.ADMIN_SESSION_SECRET = SECRET;
    const token = await createAdminSessionToken();
    Bun.env.ADMIN_PASSWORD = `${PASSWORD}-rotated`;
    expect(await verifyAdminSessionToken(token)).toBe(false);
  });

  test("tokens signed with the raw password key are rejected", async () => {
    Bun.env.ADMIN_SESSION_SECRET = SECRET;
    const token = await signWith(
      rawPasswordKey(PASSWORD),
      `v2.${futureExp()}.0123456789abcdef`,
    );
    expect(await verifyAdminSessionToken(token)).toBe(false);
  });
});

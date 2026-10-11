import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { auth as Auth } from "./auth";

const mocks = vi.hoisted(() => ({
  db: {} as Record<string, Record<string, unknown>[]>,
  sendEmail: vi.fn(),
}));

// Run the real Better Auth config against an in-memory store instead of Postgres.
vi.mock("@better-auth/drizzle-adapter", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  return { drizzleAdapter: () => memoryAdapter(mocks.db) };
});
vi.mock("@/lib/email", () => ({ isEmailConfigured: () => true, sendEmail: mocks.sendEmail }));
vi.mock("@/lib/signup-risk", () => ({
  checkSignupLimits: async () => ({ allowed: true }),
  recordSignupRisk: async () => {},
}));
vi.mock("@/lib/security-activity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./security-activity")>()),
  recordSecurityActivity: async () => {},
  isAnonymousUser: async () => false,
}));

const MODELS = [
  "user",
  "session",
  "account",
  "verification",
  "twoFactor",
  "passkey",
  "organization",
  "member",
  "invitation",
];
const ORIGIN = "http://localhost:3000";
const EMAIL = "owner@outlook.com";

let auth: typeof Auth;

beforeAll(async () => {
  // haveIBeenPwned checks sign-up and reset passwords against the range API.
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    if (String(input).startsWith("https://api.pwnedpasswords.com/range/")) {
      return new Response("", { headers: { "content-type": "text/plain" } });
    }
    throw new Error(`Unexpected network request: ${String(input)}`);
  });
  ({ auth } = await import("./auth"));
}, 30_000);

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  for (const model of MODELS) mocks.db[model] = [];
  mocks.sendEmail.mockReset();
});

let nextIp = 1;

/** A browser: keeps cookies between requests, each from its own address (no rate limits). */
function browser() {
  const cookies = new Map<string, string>();
  const ip = `198.51.100.${nextIp++}`;

  async function request(path: string, init: { method?: string; body?: unknown } = {}) {
    const url = path.startsWith("http") ? path : `${ORIGIN}/api/auth${path}`;
    const response = await auth.handler(
      new Request(url, {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        redirect: "manual",
        headers: {
          origin: ORIGIN,
          "x-forwarded-for": ip,
          cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
    );
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attributes] = header.split(";");
      const name = pair.slice(0, pair.indexOf("="));
      const value = pair.slice(pair.indexOf("=") + 1);
      const expired = attributes.some((attribute) => /^\s*max-age=0$/i.test(attribute));
      if (expired || !value) cookies.delete(name);
      else cookies.set(name, value);
    }
    return response;
  }

  return {
    request,
    cookieNames: () => [...cookies.keys()],
    session: async () => {
      const response = await request("/get-session");
      return (await response.json()) as { user: { email: string } } | null;
    },
  };
}

/** Props of the React email most recently passed to `sendEmail`. */
function lastEmailProps() {
  const [message] = mocks.sendEmail.mock.calls.at(-1) as [
    { to: string; react: { props: Record<string, string> } },
  ];
  return message.react.props;
}

function signUp(password: string) {
  return browser().request("/sign-up/email", { body: { email: EMAIL, name: "Owner", password } });
}

function signIn(password: string) {
  return browser().request("/sign-in/email", { body: { email: EMAIL, password } });
}

function credentialAccounts() {
  return mocks.db.account.filter((account) => account.providerId === "credential");
}

/** RFC 6238 code for an `otpauth://` URI (SHA-1, 6 digits, 30 s). */
function totp(uri: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const secret = new URL(uri).searchParams.get("secret") ?? "";
  const bits = [...secret.replace(/=+$/, "").toUpperCase()]
    .map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  return ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

test("a squatter's password does not survive the owner's sign-up and verification", async () => {
  // The squatter registers the owner's address first.
  expect((await signUp("squatter-password-1")).status).toBe(200);
  expect(credentialAccounts()).toHaveLength(1);

  // The owner's sign-up gets the generic answer, but voids the unproven password.
  expect((await signUp("owner-password-1")).status).toBe(200);
  expect(credentialAccounts()).toHaveLength(0);
  // Signing up again stores no new password on the contested account.
  expect((await signUp("squatter-password-2")).status).toBe(200);
  expect(credentialAccounts()).toHaveLength(0);

  // The owner resends the verification email and opens the link.
  const owner = browser();
  mocks.sendEmail.mockReset();
  const resend = await owner.request("/send-verification-email", {
    body: { email: EMAIL, callbackURL: "/chat" },
  });
  expect(resend.status).toBe(200);
  const verified = await owner.request(lastEmailProps().verificationUrl);
  expect(verified.status).toBe(302);
  expect(mocks.db.user[0]?.emailVerified).toBe(true);
  expect((await owner.session())?.user.email).toBe(EMAIL);

  for (const password of ["squatter-password-1", "squatter-password-2"]) {
    expect((await signIn(password)).status).toBe(401);
  }

  // The owner sets a password through the mailbox; that ends every session.
  mocks.sendEmail.mockReset();
  const requestReset = await browser().request("/request-password-reset", {
    body: { email: EMAIL, redirectTo: "/auth/reset-password" },
  });
  expect(requestReset.status).toBe(200);
  const resetToken = new URL(lastEmailProps().resetUrl).pathname.split("/").at(-1);
  const reset = await browser().request("/reset-password", {
    body: { newPassword: "owner-password-2", token: resetToken },
  });
  expect(reset.status).toBe(200);
  expect(await owner.session()).toBeNull();
  expect((await signIn("owner-password-2")).status).toBe(200);
}, 30_000);

test("a sign-up form never voids the password of an account already in use", async () => {
  expect((await signUp("owner-password-1")).status).toBe(200);
  const [user] = mocks.db.user;
  const now = new Date();

  // Linked to another sign-in method (e.g. OAuth with an unverified address).
  mocks.db.account.push({
    id: "github-account",
    userId: user.id,
    providerId: "github",
    accountId: "gh-1",
    createdAt: now,
    updatedAt: now,
  });
  expect((await signUp("someone-else-1")).status).toBe(200);
  expect(credentialAccounts()).toHaveLength(1);

  // Signed in to through that method: its sessions stay as well.
  mocks.db.account = mocks.db.account.filter((account) => account.providerId === "credential");
  mocks.db.session.push({
    id: "live-session",
    userId: user.id,
    token: "live-token",
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: now,
    updatedAt: now,
  });
  expect((await signUp("someone-else-2")).status).toBe(200);
  expect(credentialAccounts()).toHaveLength(1);
  expect(mocks.db.session).toHaveLength(1);
}, 30_000);

test("repeating a sign-up with the same password keeps that password", async () => {
  expect((await signUp("owner-password-1")).status).toBe(200);
  expect((await signUp("owner-password-1")).status).toBe(200);
  expect(credentialAccounts()).toHaveLength(1);

  const owner = browser();
  expect((await owner.request(lastEmailProps().verificationUrl)).status).toBe(302);
  expect((await signIn("owner-password-1")).status).toBe(200);
}, 30_000);

test("a magic link still asks an account with 2FA for its second factor", async () => {
  const owner = browser();
  await owner.request("/sign-up/email", {
    body: { email: EMAIL, name: "Owner", password: "owner-password-1" },
  });
  await owner.request(lastEmailProps().verificationUrl);
  const enable = await owner.request("/two-factor/enable", {
    body: { password: "owner-password-1" },
  });
  const { totpURI } = (await enable.json()) as { totpURI: string };
  expect(
    (await owner.request("/two-factor/verify-totp", { body: { code: totp(totpURI) } })).status,
  ).toBe(200);
  expect(mocks.db.user[0]?.twoFactorEnabled).toBe(true);

  // Someone with access to the mailbox requests and opens a magic link.
  const mailbox = browser();
  mocks.sendEmail.mockReset();
  const requestLink = await mailbox.request("/sign-in/magic-link", {
    body: { email: EMAIL, callbackURL: `${ORIGIN}/chat` },
  });
  expect(requestLink.status).toBe(200);
  const sessionsBefore = mocks.db.session.length;
  const opened = await mailbox.request(lastEmailProps().signInUrl);

  expect(opened.status).toBe(302);
  expect(opened.headers.get("location")).toBe(`${ORIGIN}/auth/two-factor?redirectTo=%2Fchat`);
  expect(mocks.db.session).toHaveLength(sessionsBefore);
  expect(mailbox.cookieNames()).toContain("better-auth.two_factor");
  expect(await mailbox.session()).toBeNull();

  // The same challenge as after a password: a valid code completes the sign-in.
  const wrongCode = await mailbox.request("/two-factor/verify-totp", {
    body: { code: totp(totpURI) === "000000" ? "111111" : "000000" },
  });
  expect(wrongCode.status).toBe(401);
  const verified = await mailbox.request("/two-factor/verify-totp", {
    body: { code: totp(totpURI) },
  });
  expect(verified.status).toBe(200);
  expect((await mailbox.session())?.user.email).toBe(EMAIL);
}, 30_000);

test("a magic link without 2FA signs in directly", async () => {
  const mailbox = browser();
  await mailbox.request("/sign-in/magic-link", {
    body: { email: EMAIL, callbackURL: `${ORIGIN}/chat` },
  });
  const opened = await mailbox.request(lastEmailProps().signInUrl);

  expect(opened.status).toBe(302);
  expect(opened.headers.get("location")).toBe(`${ORIGIN}/chat`);
  expect((await mailbox.session())?.user.email).toBe(EMAIL);
}, 30_000);

test("guests cannot attach an email address to their guest account", async () => {
  const guest = browser();
  expect((await guest.request("/sign-in/anonymous", { method: "POST" })).status).toBe(200);

  const change = await guest.request("/change-email", {
    body: { newEmail: "me@outlook.com", callbackURL: "/account/settings" },
  });
  expect(change.status).toBe(403);
  await expect(change.json()).resolves.toMatchObject({ code: "GUEST_EMAIL_CHANGE_NOT_ALLOWED" });
  expect(mocks.sendEmail).not.toHaveBeenCalled();
}, 30_000);

test("an email change is checked against the address it requests", async () => {
  // An extra `email` field must not stand in for the disallowed `newEmail`.
  const change = await browser().request("/change-email", {
    body: { newEmail: "someone@example.com", email: "someone@outlook.com" },
  });
  expect(change.status).toBe(400);
  await expect(change.json()).resolves.toMatchObject({ code: "EMAIL_DOMAIN_NOT_ALLOWED" });
}, 30_000);

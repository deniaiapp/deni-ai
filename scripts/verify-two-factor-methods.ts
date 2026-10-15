import { createHash, createHmac, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mockModules } from "./module-mocks";

mockModules((request) => {
  if (request === "@tanstack/react-start/server-only") return {};
  if (request === "@tanstack/react-start/server") return { getRequestHeaders: () => new Headers() };
  if (request === "@/i18n/server") {
    return {
      getLocale: async () => "en",
      getExtracted: async () => (message: string, values?: Record<string, string>) =>
        message.replace(/\{(\w+)\}/g, (_, key: string) => values?.[key] ?? ""),
    };
  }
  return undefined;
});

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const ORIGIN = "http://localhost:3000";
let tempDir = "";
let ipCounter = 0;

// Minimal CBOR for the WebAuthn structures below: integers, byte and text strings, and maps.
function cbor(value: unknown): Buffer {
  const head = (major: number, length: number) => {
    if (length < 24) return Buffer.from([(major << 5) | length]);
    if (length < 256) return Buffer.from([(major << 5) | 24, length]);
    return Buffer.from([(major << 5) | 25, length >> 8, length & 0xff]);
  };
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), value]);
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value as object);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, v]) => [cbor(k), cbor(v)])]);
}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

// A software passkey: an ES256 key pair registered with "none" attestation.
class SoftPasskey {
  readonly id = randomBytes(16);
  private readonly privateKey: KeyObject;
  private readonly cose: Buffer;
  private counter = 0;

  constructor() {
    const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = pair.privateKey;
    const jwk = pair.publicKey.export({ format: "jwk" });
    this.cose = cbor(
      new Map<number, unknown>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, Buffer.from(jwk.x!, "base64url")],
        [-3, Buffer.from(jwk.y!, "base64url")],
      ]),
    );
  }

  private authData(userVerified: boolean, attested: boolean) {
    const flags = 0x01 | (userVerified ? 0x04 : 0) | (attested ? 0x40 : 0);
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter++);
    const parts: Uint8Array[] = [createHash("sha256").update("localhost").digest(), Buffer.from([flags]), counter];
    if (attested) {
      const length = Buffer.alloc(2);
      length.writeUInt16BE(this.id.length);
      parts.push(Buffer.alloc(16), length, this.id, this.cose);
    }
    return Buffer.concat(parts);
  }

  private clientData(type: string, challenge: string) {
    return Buffer.from(JSON.stringify({ type, challenge, origin: ORIGIN, crossOrigin: false }));
  }

  register(challenge: string, userVerified = true) {
    const attestationObject = cbor({ fmt: "none", attStmt: {}, authData: this.authData(userVerified, true) });
    return {
      id: b64url(this.id),
      rawId: b64url(this.id),
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(this.clientData("webauthn.create", challenge)),
        attestationObject: b64url(attestationObject),
        transports: ["internal"],
      },
    };
  }

  assert(challenge: string, userVerified = true) {
    const authenticatorData = this.authData(userVerified, false);
    const clientDataJSON = this.clientData("webauthn.get", challenge);
    const signed = Buffer.concat([authenticatorData, createHash("sha256").update(clientDataJSON).digest()]);
    return {
      id: b64url(this.id),
      rawId: b64url(this.id),
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authenticatorData),
        signature: b64url(sign("sha256", signed, this.privateKey)),
      },
    };
  }
}

// Two-factor methods other than the authenticator app: email codes turn on only after the first
// code is verified, passkeys must be unlocked with a fingerprint, face, or PIN, a passkey cannot
// sign in to an account that uses another method, and authenticator users never get codes.
async function main() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "deni-2fa-methods-"));
  delete process.env.D1_PROXY_URL;
  process.env.LOCAL_DB_PATH = path.join(tempDir, "test.sqlite");
  process.env.BETTER_AUTH_SECRET = "verify-otp-secret-verify-otp-secret";
  process.env.BETTER_AUTH_URL = ORIGIN;
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_FROM = "Deni Run <auth@example.com>";

  const sent: { url: string; body: string }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), body: String(init?.body ?? "") });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  const { auth } = await import("../lib/auth");
  const { db } = await import("../db");
  const { user, passkey } = await import("../db/auth-schema");
  const { eq } = await import("drizzle-orm");
  // Same format as better-call's signCookieValue, which Better Auth uses to read signed cookies.
  const signCookieValue = (value: string, secret: string) =>
    encodeURIComponent(`${value}.${createHmac("sha256", secret).update(value).digest("base64")}`);
  const ctx = await auth.$context;
  const suffix = Date.now().toString(36);

  async function createUser(name: string, fields: Record<string, unknown>) {
    const created = await ctx.internalAdapter.createOAuthUser(
      { name, email: `${name}-${suffix}@example.com`, emailVerified: true, image: null },
      { providerId: "google", accountId: `${name}-${suffix}` },
    );
    if (Object.keys(fields).length) await db.update(user).set(fields).where(eq(user.id, created.user.id));
    return created.user.id;
  }

  async function readUser(id: string) {
    const [row] = await db.select().from(user).where(eq(user.id, id));
    return row;
  }

  // A browser: keeps the cookies Better Auth sets between requests.
  function browser(initial: Record<string, string> = {}) {
    const jar = new Map(Object.entries(initial));
    return async (route: string, body?: unknown) => {
      const res = await auth.handler(
        new Request(`${ORIGIN}/api/auth${route}`, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            Origin: ORIGIN,
            Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "),
            "X-Forwarded-For": `10.0.0.${++ipCounter}`,
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      for (const cookie of res.headers.getSetCookie()) {
        const [pair] = cookie.split(";");
        const index = pair!.indexOf("=");
        jar.set(pair!.slice(0, index), pair!.slice(index + 1));
      }
      const text = await res.text();
      return { status: res.status, text, json: () => JSON.parse(text) as Record<string, unknown>, jar };
    };
  }

  async function signedIn(userId: string) {
    const session = await ctx.internalAdapter.createSession(userId);
    return browser({ "better-auth.session_token": signCookieValue(session.token, ctx.secret) });
  }

  async function challenged(userId: string) {
    const identifier = `2fa-verify-${userId}-${++ipCounter}`;
    const expiresAt = new Date(Date.now() + 600_000);
    await ctx.internalAdapter.createVerificationValue({ value: userId, identifier, expiresAt });
    await ctx.internalAdapter.createVerificationValue({ value: "0", identifier: `2fa-attempts-${identifier}`, expiresAt });
    return browser({ "better-auth.two_factor": signCookieValue(identifier, ctx.secret) });
  }

  function lastEmailedCode() {
    const message = sent.filter((item) => item.url.includes("api.resend.com")).at(-1);
    const code = message?.body.match(/\b\d{6}\b/)?.[0];
    assert(message && code, "no 6-digit code was emailed");
    return { code, body: message.body };
  }

  async function registerPasskey(call: ReturnType<typeof browser>, key: SoftPasskey, userVerified = true) {
    const options = await call("/passkey/generate-register-options");
    if (options.status !== 200) return options;
    return call("/passkey/verify-registration", { response: key.register(String(options.json().challenge), userVerified) });
  }

  async function passkeySignIn(key: SoftPasskey, userVerified = true) {
    const call = browser();
    const options = await call("/passkey/generate-authenticate-options");
    assert(options.status === 200, `authenticate options failed: ${options.status} ${options.text}`);
    return call("/passkey/verify-authentication", { response: key.assert(String(options.json().challenge), userVerified) });
  }

  // Email setup: two-factor stays off until the emailed code is verified.
  const emailUser = await createUser("email", { twoFactorMethod: "email" });
  const emailBrowser = await signedIn(emailUser);
  const sendSetup = await emailBrowser("/two-factor/send-otp", {});
  assert(sendSetup.status === 200, `setup send-otp failed: ${sendSetup.status} ${sendSetup.text}`);
  const emailed = lastEmailedCode();
  assert(emailed.body.includes(`email-${suffix}@example.com`), "the code was not emailed to the account address");
  assert((await readUser(emailUser))?.twoFactorEnabled !== true, "sending a setup code turned two-factor on");
  const wrong = await emailBrowser("/two-factor/verify-otp", { code: emailed.code === "000000" ? "111111" : "000000" });
  assert(wrong.status === 401, `a wrong setup code was accepted: ${wrong.status}`);
  const right = await emailBrowser("/two-factor/verify-otp", { code: emailed.code });
  assert(right.status === 200, `the setup code was rejected: ${right.status} ${right.text}`);
  assert((await readUser(emailUser))?.twoFactorEnabled === true, "verifying the setup code did not turn two-factor on");

  // Email sign-in through the OAuth challenge, then the per-user limit of 5 codes per 15 minutes.
  const emailChallenge = await challenged(emailUser);
  assert((await emailChallenge("/two-factor/send-otp", {})).status === 200, "sign-in send-otp failed");
  const signIn = await emailChallenge("/two-factor/verify-otp", { code: lastEmailedCode().code });
  assert(signIn.status === 200 && signIn.jar.has("better-auth.session_token"), "the emailed sign-in code did not start a session");
  for (let index = 0; index < 3; index += 1) {
    const again = await (await challenged(emailUser))("/two-factor/send-otp", {});
    assert(again.status === 200, `code ${index + 3} was limited too early: ${again.status}`);
  }
  const limited = await (await challenged(emailUser))("/two-factor/send-otp", {});
  assert(limited.status === 429, `the sixth code in 15 minutes was not limited: ${limited.status}`);

  // Better Auth's method "otp" turns two-factor on without a code; the hook blocks it.
  const fresh = await createUser("fresh", {});
  const otpEnable = await (await signedIn(fresh))("/two-factor/enable", { method: "otp" });
  assert(otpEnable.status === 400, `enable with method otp was not rejected: ${otpEnable.status}`);

  // Authenticator users never get an emailed code and cannot add a passkey that skips the app.
  const totpUser = await createUser("totp", { twoFactorEnabled: true });
  const before = sent.length;
  const totpSend = await (await challenged(totpUser))("/two-factor/send-otp", {});
  assert(totpSend.status === 400 && sent.length === before, `an authenticator user was sent a code: ${totpSend.status}`);
  const totpPasskey = await registerPasskey(await signedIn(totpUser), new SoftPasskey());
  assert(totpPasskey.status === 400, `an authenticator user registered a passkey: ${totpPasskey.status}`);

  // Passkey setup: a passkey without a fingerprint, face, or PIN check is refused.
  const passkeyUser = await createUser("passkey", {});
  const passkeyBrowser = await signedIn(passkeyUser);
  const unverified = await registerPasskey(passkeyBrowser, new SoftPasskey(), false);
  assert(unverified.status === 400, `a passkey without user verification was registered: ${unverified.status}`);
  assert((await readUser(passkeyUser))?.twoFactorEnabled !== true, "a refused passkey turned two-factor on");
  const key = new SoftPasskey();
  const registered = await registerPasskey(passkeyBrowser, key);
  assert(registered.status === 200, `passkey registration failed: ${registered.status} ${registered.text}`);
  const enabled = await readUser(passkeyUser);
  assert(enabled?.twoFactorEnabled === true && enabled.twoFactorMethod === "passkey", "registering a passkey did not turn passkey two-factor on");

  // Passkey sign-in needs user verification, and the last passkey cannot be removed.
  const passkeySession = await passkeySignIn(key);
  assert(passkeySession.status === 200 && passkeySession.jar.has("better-auth.session_token"), `passkey sign-in failed: ${passkeySession.status} ${passkeySession.text}`);
  const touchOnly = await passkeySignIn(key, false);
  assert(touchOnly.status === 400, `a passkey sign-in without user verification was accepted: ${touchOnly.status}`);
  const [row] = await db.select().from(passkey).where(eq(passkey.userId, passkeyUser));
  const removeLast = await passkeyBrowser("/passkey/delete-passkey", { id: row!.id });
  assert(removeLast.status === 400, `the last passkey was removed: ${removeLast.status}`);

  // Switching methods removes the passkeys, so none can sign in afterwards.
  const disabled = await passkeyBrowser("/two-factor/disable", {});
  assert(disabled.status === 200, `disabling passkey two-factor failed: ${disabled.status} ${disabled.text}`);
  const left = await db.select().from(passkey).where(eq(passkey.userId, passkeyUser));
  assert(left.length === 0, "disabling two-factor left passkeys behind");

  // A passkey left on an account that now uses another method cannot sign in.
  const switched = await createUser("switched", {});
  const switchedKey = new SoftPasskey();
  assert((await registerPasskey(await signedIn(switched), switchedKey)).status === 200, "second passkey registration failed");
  await db.update(user).set({ twoFactorMethod: "totp" }).where(eq(user.id, switched));
  const bypass = await passkeySignIn(switchedKey);
  assert(bypass.status === 400, `a passkey skipped the authenticator app: ${bypass.status}`);

  console.log("verified two-factor methods: email setup and sign-in, code limit, passkey setup and sign-in, user verification, method isolation");
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  });

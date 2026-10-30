import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { auth as Auth } from "./auth";

vi.mock("@/lib/team-domains", () => ({
  TEAM_MEMBERSHIP_LIMIT: 50,
  isActiveTeamEmailDomain: async () => false,
  joinTeamByDomainOnSignIn: async () => undefined,
}));

const mocks = vi.hoisted(() => ({
  db: {} as Record<string, Record<string, unknown>[]>,
  sendEmail: vi.fn(),
  transferGuestData: vi.fn(),
}));

// Run the real Better Auth config against an in-memory store instead of Postgres.
vi.mock("@better-auth/drizzle-adapter", async () => {
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  return { drizzleAdapter: () => memoryAdapter(mocks.db) };
});
vi.mock("@/lib/email", () => ({ isEmailConfigured: () => true, sendEmail: mocks.sendEmail }));
vi.mock("@/lib/guest-data-transfer", () => ({ transferGuestData: mocks.transferGuestData }));
vi.mock("@/lib/signup-risk", () => ({
  checkSignupLimits: async () => ({ allowed: true }),
  recordSignupRisk: async () => {},
}));
vi.mock("@/lib/security-activity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./security-activity")>()),
  recordSecurityActivity: async () => {},
  isAnonymousUser: async () => false,
}));
// The deletion hooks read billing, seats and stored files from Postgres.
vi.mock("@/lib/team-member-audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./team-member-audit")>()),
  accountDeletionSeatHooks: { before: async () => {}, after: async () => {} },
}));
vi.mock("@/lib/attachments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./attachments")>()),
  accountDeletionAttachmentHooks: { before: async () => {}, after: async () => {} },
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
const PASSWORD = "owner-password-1";

let auth: typeof Auth;

beforeAll(async () => {
  // haveIBeenPwned checks sign-up passwords against the range API.
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
  mocks.transferGuestData.mockReset();
});

let nextIp = 1;

/** A browser: keeps cookies between requests, each from its own address (no rate limits). */
function browser() {
  const cookies = new Map<string, string>();
  const ip = `198.51.100.${nextIp++}`;

  async function request(path: string, init: { method?: string; body?: unknown } = {}) {
    const method = init.method ?? "POST";
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method,
        redirect: "manual",
        headers: {
          origin: ORIGIN,
          "x-forwarded-for": ip,
          cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
          ...(method === "GET" ? {} : { "content-type": "application/json" }),
        },
        body: method === "GET" ? undefined : JSON.stringify(init.body ?? {}),
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

  return { request };
}

/** A verified email-and-password account, the way a finished sign-up leaves it. */
async function createAccount({ twoFactorEnabled = false } = {}) {
  const signUp = await browser().request("/sign-up/email", {
    body: { email: EMAIL, name: "Owner", password: PASSWORD },
  });
  expect(signUp.status).toBe(200);
  const [user] = mocks.db.user;
  user.emailVerified = true;
  user.twoFactorEnabled = twoFactorEnabled;
  return user.id as string;
}

/** A browser signed in as a new guest, and that guest's id. */
async function guestBrowser() {
  const guest = browser();
  expect((await guest.request("/sign-in/anonymous")).status).toBe(200);
  const row = mocks.db.user.find((user) => user.isAnonymous);
  return { guest, guestId: row?.id as string };
}

function userIds() {
  return mocks.db.user.map((user) => user.id);
}

test("signing in from a guest session moves the guest's data, then deletes the guest", async () => {
  const userId = await createAccount();
  const { guest, guestId } = await guestBrowser();

  const signIn = await guest.request("/sign-in/email", {
    body: { email: EMAIL, password: PASSWORD },
  });

  expect(signIn.status).toBe(200);
  expect(mocks.transferGuestData).toHaveBeenCalledExactlyOnceWith(guestId, userId);
  expect(userIds()).toEqual([userId]);
}, 30_000);

test("a password sign-in awaiting 2FA does not move the guest's data", async () => {
  const userId = await createAccount({ twoFactorEnabled: true });
  const { guest } = await guestBrowser();

  const signIn = await guest.request("/sign-in/email", {
    body: { email: EMAIL, password: PASSWORD },
  });

  expect(signIn.status).toBe(200);
  await expect(signIn.json()).resolves.toMatchObject({ twoFactorRedirect: true });
  expect(mocks.transferGuestData).not.toHaveBeenCalled();
  expect(userIds()).toEqual([userId]);
}, 30_000);

test("a guest whose data could not be moved is kept", async () => {
  const userId = await createAccount();
  const { guest, guestId } = await guestBrowser();
  mocks.transferGuestData.mockRejectedValueOnce(new Error("database unavailable"));
  vi.spyOn(console, "error").mockImplementationOnce(() => {});

  const signIn = await guest.request("/sign-in/email", {
    body: { email: EMAIL, password: PASSWORD },
  });

  expect(signIn.status).toBe(200);
  expect(userIds()).toEqual([userId, guestId]);
}, 30_000);

test.each([
  ["POST", "/link-social"],
  ["GET", "/passkey/generate-register-options"],
  ["POST", "/passkey/verify-registration"],
  ["POST", "/two-factor/enable"],
])(
  "guests cannot add a sign-in method through %s %s",
  async (method, path) => {
    const { guest } = await guestBrowser();

    const response = await guest.request(path, {
      method,
      body: { provider: "google", password: "irrelevant", response: {} },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "GUEST_SIGN_IN_METHOD_NOT_ALLOWED",
    });
  },
  30_000,
);

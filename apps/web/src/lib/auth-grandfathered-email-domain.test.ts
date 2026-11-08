import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { auth as Auth } from "./auth";

// Team domains are read from Postgres; no team has verified one in these tests.
vi.mock("@/lib/team-domains", () => ({
  TEAM_MEMBERSHIP_LIMIT: 50,
  isActiveTeamEmailDomain: async () => false,
  joinTeamByDomainOnSignIn: async () => undefined,
}));

/**
 * duck.com left the sign-up allowlist. These run the real Better Auth config
 * (in-memory store, stubbed GitHub) to check that the domain hooks only gate
 * new accounts and email changes, never sign-ins of accounts that already exist.
 */

const mocks = vi.hoisted(() => ({
  db: {} as Record<string, Record<string, unknown>[]>,
  sendEmail: vi.fn(),
}));

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
const DUCK_EMAIL = "owner@duck.com";
const PASSWORD = "existing-owner-password-1";

/** The GitHub identity the stubbed OAuth provider returns. */
const github = { email: DUCK_EMAIL };

let auth: typeof Auth;

beforeAll(async () => {
  vi.stubEnv("GITHUB_CLIENT_ID", "github-client-id");
  vi.stubEnv("GITHUB_CLIENT_SECRET", "github-client-secret");
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://api.pwnedpasswords.com/range/")) {
      return new Response("", { headers: { "content-type": "text/plain" } });
    }
    if (url === "https://github.com/login/oauth/access_token") {
      return Response.json({ access_token: "gh-token", token_type: "bearer", scope: "user:email" });
    }
    if (url === "https://api.github.com/user") {
      return Response.json({ id: 4242, login: "duckling", name: "Duck", email: github.email });
    }
    if (url === "https://api.github.com/user/emails") {
      return Response.json([{ email: github.email, primary: true, verified: true }]);
    }
    throw new Error(`Unexpected network request: ${url}`);
  });
  ({ auth } = await import("./auth"));
}, 30_000);

afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  for (const model of MODELS) mocks.db[model] = [];
  mocks.sendEmail.mockReset();
  github.email = DUCK_EMAIL;
});

let nextIp = 1;

/** A browser: keeps cookies between requests, each from its own address (no rate limits). */
function browser() {
  const cookies = new Map<string, string>();
  const ip = `203.0.113.${nextIp++}`;

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

/** A verified duck.com account with a password, created before duck.com was dropped. */
async function seedExistingDuckUser() {
  const now = new Date();
  mocks.db.user.push({
    id: "duck-user",
    name: "Duck",
    email: DUCK_EMAIL,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  mocks.db.account.push({
    id: "duck-credential",
    accountId: "duck-user",
    providerId: "credential",
    userId: "duck-user",
    password: await hashPassword(PASSWORD),
    createdAt: now,
    updatedAt: now,
  });
}

/** Runs the GitHub OAuth redirect and callback; returns the callback response. */
async function signInWithGitHub(client: ReturnType<typeof browser>) {
  const start = await client.request("/sign-in/social", {
    body: { provider: "github", callbackURL: "/chat" },
  });
  expect(start.status).toBe(200);
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get("state");
  return client.request(`/callback/github?code=gh-code&state=${state}`);
}

async function expectDomainDenied(response: Response) {
  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({ code: "EMAIL_DOMAIN_NOT_ALLOWED" });
}

test("new duck.com registrations are rejected on every path", async () => {
  await expectDomainDenied(
    await browser().request("/sign-up/email", {
      body: { email: DUCK_EMAIL, name: "Duck", password: PASSWORD },
    }),
  );
  await expectDomainDenied(
    await browser().request("/sign-in/magic-link", {
      body: { email: DUCK_EMAIL, callbackURL: `${ORIGIN}/chat` },
    }),
  );
  expect(mocks.sendEmail).not.toHaveBeenCalled();

  const client = browser();
  const callback = await signInWithGitHub(client);
  expect(callback.status).toBe(302);
  expect(new URL(callback.headers.get("location") ?? "", ORIGIN).searchParams.get("error")).toBe(
    "EMAIL_DOMAIN_NOT_ALLOWED",
  );
  expect(await client.session()).toBeNull();
  expect(mocks.db.user).toHaveLength(0);
}, 30_000);

test("an existing duck.com account still signs in with its password", async () => {
  await seedExistingDuckUser();
  const owner = browser();
  const signIn = await owner.request("/sign-in/email", {
    body: { email: DUCK_EMAIL, password: PASSWORD },
  });
  expect(signIn.status).toBe(200);
  expect((await owner.session())?.user.email).toBe(DUCK_EMAIL);
}, 30_000);

test("an existing duck.com account still signs in with a magic link", async () => {
  await seedExistingDuckUser();
  const owner = browser();
  const requestLink = await owner.request("/sign-in/magic-link", {
    body: { email: "Owner@Duck.com", callbackURL: `${ORIGIN}/chat` },
  });
  expect(requestLink.status).toBe(200);
  const opened = await owner.request(lastEmailProps().signInUrl);
  expect(opened.status).toBe(302);
  expect(opened.headers.get("location")).toBe(`${ORIGIN}/chat`);
  expect((await owner.session())?.user.email).toBe(DUCK_EMAIL);
  expect(mocks.db.user).toHaveLength(1);
}, 30_000);

test("an existing duck.com account still signs in with GitHub", async () => {
  await seedExistingDuckUser();

  // First GitHub sign-in links the verified identity to the existing account…
  const first = browser();
  expect((await signInWithGitHub(first)).status).toBe(302);
  expect((await first.session())?.user.email).toBe(DUCK_EMAIL);
  expect(mocks.db.account.map((account) => account.providerId).sort()).toEqual([
    "credential",
    "github",
  ]);

  // …and later ones reuse the linked account.
  const second = browser();
  expect((await signInWithGitHub(second)).status).toBe(302);
  expect((await second.session())?.user.email).toBe(DUCK_EMAIL);
  expect(mocks.db.user).toHaveLength(1);
}, 30_000);

test("an email change cannot move an account to duck.com", async () => {
  await seedExistingDuckUser();
  mocks.db.user[0].email = "owner@outlook.com";
  const owner = browser();
  await owner.request("/sign-in/email", {
    body: { email: "owner@outlook.com", password: PASSWORD },
  });
  mocks.sendEmail.mockReset();

  await expectDomainDenied(
    await owner.request("/change-email", {
      body: { newEmail: "new@duck.com", callbackURL: "/account/settings" },
    }),
  );
  expect(mocks.sendEmail).not.toHaveBeenCalled();
  expect(mocks.db.user[0].email).toBe("owner@outlook.com");
}, 30_000);

test("an existing duck.com account can move to an allowed address", async () => {
  await seedExistingDuckUser();
  const owner = browser();
  await owner.request("/sign-in/email", { body: { email: DUCK_EMAIL, password: PASSWORD } });
  mocks.sendEmail.mockReset();

  const change = await owner.request("/change-email", {
    body: { newEmail: "owner@outlook.com", callbackURL: "/account/settings" },
  });
  expect(change.status).toBe(200);
  // The current (duck.com) address approves, then the new address verifies.
  await owner.request(lastEmailProps().confirmUrl);
  await owner.request(lastEmailProps().verificationUrl);
  expect(mocks.db.user[0].email).toBe("owner@outlook.com");
}, 30_000);

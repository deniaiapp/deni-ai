import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { session: { userId: "user-1" }, user: { isAnonymous: false } } as unknown,
  configured: true,
  capabilities: {
    llm: false,
    webSearch: false,
    sandbox: false,
    browser: false,
    objectStorage: false,
  },
  handleChat: vi.fn(async (_request: Request, _ctx: { userId: string; locale: string }) =>
    Response.json({ error: "No model", code: "llm_unconfigured" }, { status: 503 }),
  ),
  createTeammate: vi.fn(),
  finishMcpSignIn: vi.fn(),
  rateAllowed: true,
  env: {
    NEXT_PUBLIC_BETTER_AUTH_URL: "https://app.example",
    DISCORD_BOT_TOKEN: undefined,
    RUN_ENABLED: true,
  },
}));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => mocks.session } } }));
vi.mock("@/i18n/locale", () => ({ getPreferredLocale: () => "ja" }));
vi.mock("@/env", () => ({ env: mocks.env }));
vi.mock("@/i18n/messages", () => ({ loadMessages: async () => ({}) }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () =>
    mocks.rateAllowed ? { allowed: true } : { allowed: false, retryAfter: 30 },
}));
vi.mock("@/lib/run/runtime.server", () => ({
  ensureRunConfigured: () =>
    mocks.configured ? { ok: true } : { ok: false, reason: "config_error", message: "x" },
  runStatus: () => ({ configured: mocks.configured, capabilities: mocks.capabilities }),
}));
vi.mock("@/lib/run/discord-link.server", () => ({
  getDiscordLink: async () => null,
  createDiscordLinkCode: async () => ({ code: "ABCD-EFGH", expiresAt: "" }),
  unlinkDiscord: async () => undefined,
}));
vi.mock("@deniai/run/chat/route", () => ({ handleChat: mocks.handleChat }));
vi.mock("@deniai/run/teammates/index", () => ({ createTeammate: mocks.createTeammate }));
vi.mock("@deniai/run/billing/plans", () => ({
  isUsageLimitError: (error: unknown) => (error as { code?: string })?.code === "usage_limit",
}));
vi.mock("@deniai/run/data/store", () => ({
  readStore: async () => ({
    shells: [],
    computer: { status: "idle", steelDebugUrl: "https://steel.example/live", workingLabel: "" },
  }),
}));
vi.mock("@deniai/run/computer/index", () => ({
  computerForJob: (computer: unknown) => computer,
  lastComputer: () => null,
  withBrowserLive: (_userId: string, computer: unknown) => computer,
}));
vi.mock("@deniai/run/mcp/index", () => ({ finishMcpSignIn: mocks.finishMcpSignIn }));

const { handleRunApi } = await import("./router");

function request(path: string, init: RequestInit = {}) {
  return handleRunApi(
    new Request(`https://app.example/api/run/${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
    }),
    path.split("?")[0]!,
  );
}

beforeEach(() => {
  mocks.session = { session: { userId: "user-1" }, user: { isAnonymous: false } };
  mocks.configured = true;
  mocks.rateAllowed = true;
  mocks.env.RUN_ENABLED = true;
  mocks.capabilities = {
    llm: false,
    webSearch: false,
    sandbox: false,
    browser: false,
    objectStorage: false,
  };
  mocks.handleChat.mockClear();
  mocks.createTeammate.mockReset();
  mocks.finishMcpSignIn.mockReset();
});

test("RUN_ENABLED=false answers every Run endpoint with 404 run_disabled", async () => {
  mocks.env.RUN_ENABLED = false;
  for (const path of ["status", "state", "mcp/oauth/callback"]) {
    const response = await request(path);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "run_disabled" });
  }
});

test("unauthenticated requests get 401", async () => {
  mocks.session = null;
  const response = await request("state");
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "unauthorized" });
});

test("guest accounts get 403", async () => {
  mocks.session = { session: { userId: "guest" }, user: { isAnonymous: true } };
  const response = await request("chat", { method: "POST", body: "{}" });
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "guest_account" });
  expect(mocks.handleChat).not.toHaveBeenCalled();
});

test("an unconfigured runtime answers 503 run_unconfigured", async () => {
  mocks.configured = false;
  const response = await request("skills");
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "run_unconfigured" });
});

test("cross-site mutations are rejected before authentication", async () => {
  const response = await request("chat", {
    method: "POST",
    body: "{}",
    headers: { origin: "https://evil.example" },
  });
  expect(response.status).toBe(403);
  expect(mocks.handleChat).not.toHaveBeenCalled();
});

test("chat forwards to handleChat with the user and locale, passing an unconfigured LLM through", async () => {
  const response = await request("chat", {
    method: "POST",
    body: JSON.stringify({ threadId: "dm_chief", messages: [] }),
  });
  expect(mocks.handleChat).toHaveBeenCalledTimes(1);
  expect(mocks.handleChat.mock.calls[0]![1]).toEqual({ userId: "user-1", locale: "ja" });
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: "llm_unconfigured" });
});

test("chat is rate limited", async () => {
  mocks.rateAllowed = false;
  const response = await request("chat", { method: "POST", body: "{}" });
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("30");
  expect(mocks.handleChat).not.toHaveBeenCalled();
});

test("the computer reports a disabled state without providers", async () => {
  const response = await request("computer");
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    capabilities: { browser: boolean };
    liveViewUrl: unknown;
  };
  expect(body.capabilities.browser).toBe(false);
  // A stale live-view URL is never handed out while the browser provider is off.
  expect(body.liveViewUrl).toBeNull();
});

test("the computer exposes the live view when the browser provider is configured", async () => {
  mocks.capabilities = { ...mocks.capabilities, browser: true };
  const body = (await (await request("computer")).json()) as { liveViewUrl: unknown };
  expect(body.liveViewUrl).toBe("https://steel.example/live");
});

test("a teammate over the plan limit answers 402 usage_limit", async () => {
  mocks.createTeammate.mockResolvedValue({
    ok: false,
    reason: "limit",
    error: { message: "Teammate limit reached (5 on Free).", metric: "teammates" },
  });
  const response = await request("teammates", {
    method: "POST",
    body: JSON.stringify({ name: "Six" }),
  });
  expect(response.status).toBe(402);
  expect(await response.json()).toMatchObject({ error: "usage_limit", metric: "teammates" });
});

test("a teammate without a name answers 400", async () => {
  mocks.createTeammate.mockResolvedValue({ ok: false, reason: "name_required" });
  const response = await request("teammates", { method: "POST", body: JSON.stringify({}) });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "name_required" });
});

test("unknown paths and methods", async () => {
  expect((await request("nope")).status).toBe(404);
  expect((await request("state", { method: "DELETE" })).status).toBe(405);
});

test("the MCP OAuth callback finishes the sign-in and returns to Run settings", async () => {
  mocks.finishMcpSignIn.mockResolvedValue({ id: "mcp_1" });
  const response = await request("mcp/oauth/callback?state=s&code=c&iss=https%3A%2F%2Fi");
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("https://app.example/run/settings?mcp=mcp_1");
  expect(mocks.finishMcpSignIn).toHaveBeenCalledWith("user-1", {
    state: "s",
    code: "c",
    iss: "https://i",
  });
});

test("the MCP OAuth callback reports a refused sign-in", async () => {
  const response = await request("mcp/oauth/callback?error=access_denied");
  const location = new URL(response.headers.get("location")!);
  expect(location.pathname).toBe("/run/settings");
  expect(location.searchParams.get("mcpError")).toMatch(/refused/);
  expect(mocks.finishMcpSignIn).not.toHaveBeenCalled();
});

test("the MCP OAuth callback sends signed-out visitors to sign in", async () => {
  mocks.session = null;
  const response = await request("mcp/oauth/callback?state=s&code=c");
  expect(response.headers.get("location")).toContain("/auth/sign-in");
});

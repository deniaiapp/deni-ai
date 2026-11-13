import { beforeEach, describe, expect, it, vi } from "vitest";

const getRequestSession = vi.hoisted(() => vi.fn());
const checkRateLimit = vi.hoisted(() => vi.fn(async () => ({ allowed: true as const })));
const callerApi = vi.hoisted(() => ({
  chat: {
    getChatPage: vi.fn(),
    getChatStatus: vi.fn(),
    deleteChat: vi.fn(),
    updateChat: vi.fn(),
    setChatModel: vi.fn(),
  },
  preferences: { get: vi.fn(), setPreferredModel: vi.fn() },
}));

vi.mock("@/lib/request-session.server", () => ({ getRequestSession }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("@/server/api/root", () => ({ appRouter: { createCaller: () => callerApi } }));
vi.mock("@/db/drizzle", () => ({ db: {} }));
vi.mock("@/lib/plan-currency", () => ({ requestCountry: () => undefined }));
vi.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_BETTER_AUTH_URL: "http://localhost:3000",
    DESKTOP_MIN_CLIENT_VERSION: "1.0.0",
  },
}));

const { handleClientApi, isClientUpdateRequired, matchClientRoute } = await import("./router");

const oauthSession = {
  credential: "oauth",
  session: { userId: "user_1" },
  user: { id: "user_1", isAnonymous: false },
};

function call(path: string, init: RequestInit = {}) {
  return handleClientApi(new Request(`http://localhost:3000/api/client/v1/${path}`, init), path);
}

beforeEach(() => {
  vi.clearAllMocks();
  getRequestSession.mockResolvedValue(oauthSession);
});

describe("matchClientRoute", () => {
  it("matches fixed and :id segments", () => {
    expect(matchClientRoute(["chats", "abc", "status"])?.params).toEqual(["abc"]);
    expect(matchClientRoute(["chats"])?.handlers.POST).toBeTypeOf("function");
    expect(matchClientRoute(["chats", "abc", "unknown"])).toBeNull();
  });
});

describe("handleClientApi", () => {
  it("answers 401 without a usable credential", async () => {
    getRequestSession.mockResolvedValue(null);
    const response = await call("chats/abc");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "unauthorized" });
    expect(getRequestSession).toHaveBeenCalledWith(expect.any(Request), { bearerScope: "chat" });
  });

  it("refuses guests", async () => {
    getRequestSession.mockResolvedValue({ ...oauthSession, user: { isAnonymous: true } });
    expect((await call("chats/abc")).status).toBe(403);
  });

  it("answers 404 for unknown endpoints and 405 for wrong methods", async () => {
    expect((await call("nope")).status).toBe(404);
    const response = await call("bootstrap", { method: "DELETE" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(getRequestSession).not.toHaveBeenCalled();
  });

  it("maps a missing chat to 404 not_found", async () => {
    callerApi.chat.getChatPage.mockResolvedValue(null);
    const response = await call("chats/abc");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "not_found",
      code: "not_found",
      message: "Chat not found",
    });
  });

  it("reports generation status", async () => {
    callerApi.chat.getChatStatus.mockResolvedValue({
      activeGenerationId: "gen_1",
      updated_at: new Date("2026-11-12T00:00:00Z"),
    });
    const response = await call("chats/abc/status");
    expect(await response.json()).toEqual({
      generating: true,
      updatedAt: "2026-11-12T00:00:00.000Z",
    });
  });

  it("validates JSON bodies", async () => {
    const wrongType = await call("chats/abc", { method: "PATCH", body: "{}" });
    expect(wrongType.status).toBe(415);
    const empty = await call("chats/abc", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(empty.status).toBe(400);
    expect(callerApi.chat.updateChat).not.toHaveBeenCalled();
  });

  it("updates fields and the chat model separately", async () => {
    callerApi.chat.getChatPage.mockResolvedValue({
      id: "abc",
      title: "Renamed",
      projectId: null,
      projectName: null,
      model: "claude-haiku-5.5",
      messages: [],
      oldestIndex: 0,
      hasMore: false,
    });
    const response = await call("chats/abc", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Renamed", model: "claude-haiku-5.5" }),
    });
    expect(response.status).toBe(200);
    expect(callerApi.chat.updateChat).toHaveBeenCalledWith({ id: "abc", title: "Renamed" });
    expect(callerApi.chat.setChatModel).toHaveBeenCalledWith({
      id: "abc",
      model: "claude-haiku-5.5",
    });
  });

  it("reports a tRPC input error by its first zod issue", async () => {
    const { TRPCError } = await import("@trpc/server");
    callerApi.preferences.setPreferredModel.mockRejectedValue(
      new TRPCError({
        code: "BAD_REQUEST",
        message: '[{"message":"Unknown model"}]',
        cause: Object.assign(new Error("zod"), { issues: [{ message: "Unknown model" }] }),
      }),
    );
    const response = await call("preferences/model", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "nope" }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "invalid_request",
      message: "Unknown model",
    });
  });

  it("deletes with 204", async () => {
    expect((await call("chats/abc", { method: "DELETE" })).status).toBe(204);
    expect(callerApi.chat.deleteChat).toHaveBeenCalledWith({ id: "abc" });
  });

  it("asks outdated desktop clients to update, except on bootstrap", async () => {
    const headers = { "x-deni-client": "desktop/0.9.0 (windows; x86_64)" };
    const response = await call("chats/abc/status", { headers });
    expect(response.status).toBe(426);
    expect(await response.json()).toMatchObject({ code: "client_update_required" });
  });

  it("checks cookie-authenticated mutations for a same-origin request", async () => {
    getRequestSession.mockResolvedValue({ ...oauthSession, credential: "cookie" });
    const response = await call("chats/abc", {
      method: "DELETE",
      headers: { origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
    expect(callerApi.chat.deleteChat).not.toHaveBeenCalled();
  });

  it("rate limits per user", async () => {
    checkRateLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 12 } as never);
    const response = await call("chats/abc/status");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("12");
  });
});

describe("isClientUpdateRequired", () => {
  it("compares the desktop version with the minimum", () => {
    expect(isClientUpdateRequired("desktop/0.9.0", "1.0.0")).toBe(true);
    expect(isClientUpdateRequired("desktop/1.0.0", "1.0.0")).toBe(false);
    expect(isClientUpdateRequired(null, "1.0.0")).toBe(false);
    expect(isClientUpdateRequired("desktop/0.1.0", null)).toBe(false);
  });
});

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  createChatFromRequest: vi.fn<(headers: Headers) => Promise<string>>(),
}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("../src/server/chat-manager", () => ({
  createChatFromRequest: state.createChatFromRequest,
}));

const { proxy } = await import("../src/proxy");
const { GET } = await import("../src/app/(app)/new/[message]/route");

const SESSION = { cookie: "better-auth.session_token=token" };

function run(path: string, headers: Record<string, string> = {}) {
  return proxy(new NextRequest(`https://deniai.app${path}`, { headers }));
}

function forwardedHeader(response: Response, name: string) {
  return response.headers.get(`x-middleware-request-${name}`);
}

describe("proxy locale negotiation", () => {
  test("honors Accept-Language q-values instead of any ja entry", () => {
    const response = run("/about", { "accept-language": "en-US,en;q=0.9,ja;q=0.8" });
    expect(response.headers.get("location")).toBeNull();
    expect(forwardedHeader(response, "x-locale")).toBe("en");

    const refused = run("/chat", { ...SESSION, "accept-language": "en, ja;q=0" });
    expect(forwardedHeader(refused, "x-locale")).toBe("en");
  });

  test("locale redirects are never cacheable by a shared cache", () => {
    for (const response of [
      run("/about?x=1", { "accept-language": "ja,en;q=0.5" }),
      run("/legal/terms", { cookie: "locale=ja" }),
      run("/home", { cookie: "locale=ja" }),
    ]) {
      expect(response.status).toBe(307);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("vary")).toBe("Cookie, Accept-Language");
    }
    expect(run("/about?x=1", { "accept-language": "ja" }).headers.get("location")).toBe(
      "https://deniai.app/ja/about?x=1",
    );
  });

  test("/ja copies of app routes redirect instead of rendering under the /ja cache rule", () => {
    for (const path of ["/projects/p1", "/compare", "/new/hello", "/flixa/authorize"]) {
      const response = run(`/ja${path}?code=1`, SESSION);
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(`https://deniai.app${path}?code=1`);
    }
    expect(run("/ja/flixa").headers.get("x-middleware-rewrite")).toBe("https://deniai.app/flixa");
  });

  test("strips a client-supplied x-deni-url-locale and only sets it on /ja rewrites", () => {
    const spoofed = run("/about", { "x-deni-url-locale": "ja", "x-deni-return-to": "/evil" });
    expect(forwardedHeader(spoofed, "x-deni-url-locale")).toBeNull();
    expect(spoofed.headers.get("x-middleware-override-headers")).not.toContain("x-deni-url-locale");
    expect(forwardedHeader(spoofed, "x-deni-return-to")).toBe("/about");

    const rewritten = run("/ja/about", { "x-deni-url-locale": "en" });
    expect(forwardedHeader(rewritten, "x-deni-url-locale")).toBe("ja");
  });
});

describe("signed-out deep links keep their destination", () => {
  test.each([
    ["/flixa/authorize?code=ABCD-EFGH", "/flixa/authorize?code=ABCD-EFGH"],
    ["/settings/team?invitationId=inv_1", "/settings/team?invitationId=inv_1"],
    ["/projects/p1", "/projects/p1"],
    ["/compare", "/compare"],
    ["/new/Explain%20RSC", "/new/Explain%20RSC"],
    ["/chat/c1", "/chat/c1"],
  ])("%s", (path, returnTo) => {
    const response = run(path);
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/auth/sign-in");
    expect(location.searchParams.get("redirectTo")).toBe(returnTo);
  });

  test("passes signed-in requests through with the return path for layout guards", () => {
    const response = run("/flixa/authorize?code=ABCD", SESSION);
    expect(response.headers.get("location")).toBeNull();
    expect(forwardedHeader(response, "x-deni-return-to")).toBe("/flixa/authorize?code=ABCD");
  });
});

describe("/new/[message]", () => {
  const params = Promise.resolve({ message: "hello" });
  const navigation = { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" };

  beforeEach(() => {
    state.createChatFromRequest.mockReset();
    state.createChatFromRequest.mockResolvedValue("chat-1");
  });

  test("redirects signed-out visitors to sign-in instead of a JSON 401", async () => {
    state.createChatFromRequest.mockRejectedValue(new Error("Unauthorized"));
    const response = await GET(
      new Request("https://deniai.app/new/hello?webSearch=true", { headers: navigation }),
      { params },
    );
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/auth/sign-in");
    expect(location.searchParams.get("redirectTo")).toBe("/new/hello?webSearch=true");
  });

  test("creates a chat for top-level navigations", async () => {
    const response = await GET(
      new Request("https://deniai.app/new/hello", { headers: navigation }),
      {
        params,
      },
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://deniai.app/chat/chat-1?message=hello");
    expect(state.createChatFromRequest).toHaveBeenCalledTimes(1);
  });

  test.each([
    { "sec-fetch-dest": "image", "sec-fetch-mode": "no-cors" },
    { "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate" },
    { "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", rsc: "1" },
    { ...navigation, "sec-purpose": "prefetch;prerender" },
    { purpose: "prefetch" },
  ])("does not create chats for non-navigation request %j", async (headers) => {
    const response = await GET(new Request("https://deniai.app/new/hello", { headers }), {
      params,
    });
    expect(response.status).toBe(400);
    expect(state.createChatFromRequest).not.toHaveBeenCalled();
  });
});

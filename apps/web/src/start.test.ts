import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  createChatFromRequest: vi.fn<(headers: Headers) => Promise<string>>(),
}));
vi.mock("@/server/chat-manager", () => ({
  createChatFromRequest: state.createChatFromRequest,
}));

const { localeAndAuthRedirects } = await import("@/start");

const SESSION = { cookie: "better-auth.session_token=token" };
/** What `next()` resolves to: the request continued to route matching. */
const PASSED_THROUGH = new Response("passed through", { status: 299 });

type MiddlewareServer = (options: {
  request: Request;
  pathname: string;
  context: undefined;
  next: () => Response;
}) => Response | Promise<Response>;

async function run(path: string, headers: Record<string, string> = {}, method = "GET") {
  const request = new Request(`https://deniai.app${path}`, { method, headers });
  const server = localeAndAuthRedirects.options.server as unknown as MiddlewareServer;
  return server({
    request,
    pathname: new URL(request.url).pathname,
    context: undefined,
    next: () => PASSED_THROUGH,
  });
}

describe("request middleware locale negotiation", () => {
  test("honors Accept-Language q-values instead of any ja entry", async () => {
    expect(await run("/about", { "accept-language": "en-US,en;q=0.9,ja;q=0.8" })).toBe(
      PASSED_THROUGH,
    );
    expect(await run("/about", { "accept-language": "en, ja;q=0" })).toBe(PASSED_THROUGH);
    expect(await run("/chat", { ...SESSION, "accept-language": "en, ja;q=0" })).toBe(
      PASSED_THROUGH,
    );
  });

  test("locale redirects are never cacheable by a shared cache", async () => {
    for (const response of [
      await run("/about?x=1", { "accept-language": "ja,en;q=0.5" }),
      await run("/legal/terms", { cookie: "locale=ja" }),
      await run("/home", { cookie: "locale=ja" }),
    ]) {
      expect(response.status).toBe(307);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("vary")).toBe("Cookie, Accept-Language");
    }
    expect((await run("/about?x=1", { "accept-language": "ja" })).headers.get("location")).toBe(
      "https://deniai.app/ja/about?x=1",
    );
  });

  test("an explicit locale cookie wins over Accept-Language", async () => {
    expect(await run("/about", { cookie: "locale=en", "accept-language": "ja" })).toBe(
      PASSED_THROUGH,
    );
  });

  test("/ja copies of app routes redirect instead of rendering under the /ja cache rule", async () => {
    for (const path of ["/projects/p1", "/compare", "/new/hello", "/flixa/authorize"]) {
      const response = await run(`/ja${path}?code=1`, SESSION);
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(`https://deniai.app${path}?code=1`);
    }
    // Public /ja pages render from the {-$locale} routes.
    expect(await run("/ja/flixa")).toBe(PASSED_THROUGH);
  });

  test("the root redirect follows the session cookie, then the locale cookie", async () => {
    expect((await run("/", SESSION)).headers.get("location")).toBe("https://deniai.app/chat");
    expect((await run("/", { cookie: "locale=ja" })).headers.get("location")).toBe(
      "https://deniai.app/ja",
    );
    expect((await run("/")).headers.get("location")).toBe("https://deniai.app/home");
  });

  test("collapses duplicate slashes with a permanent redirect", async () => {
    const response = await run("//settings//billing?tab=1");
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://deniai.app/settings/billing?tab=1");
  });

  test("API routes, server functions, assets and mutations pass through untouched", async () => {
    for (const path of ["/api/chat", "/_serverFn/abc", "/robots.txt", "/pwa/icon.png"]) {
      expect(await run(path, { "accept-language": "ja" })).toBe(PASSED_THROUGH);
    }
    expect(await run("/settings", {}, "POST")).toBe(PASSED_THROUGH);
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
  ])("%s", async (path, returnTo) => {
    const response = await run(path);
    expect(response.status).toBe(307);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/auth/sign-in");
    expect(location.searchParams.get("redirectTo")).toBe(returnTo);
  });

  test("passes signed-in requests through to the route guards", async () => {
    expect(await run("/flixa/authorize?code=ABCD", SESSION)).toBe(PASSED_THROUGH);
    expect(await run("/settings", { cookie: "__Secure-better-auth.session_token=token" })).toBe(
      PASSED_THROUGH,
    );
  });
});

describe("/new/$message", () => {
  const navigation = { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" };

  async function get(url: string, headers: Record<string, string>) {
    const { Route } = await import("@/routes/new/$message");
    const handlers = Route.options.server?.handlers as unknown as {
      GET: (ctx: { request: Request; params: { message: string } }) => Promise<Response>;
    };
    return handlers.GET({ request: new Request(url, { headers }), params: { message: "hello" } });
  }

  beforeEach(() => {
    state.createChatFromRequest.mockReset();
    state.createChatFromRequest.mockResolvedValue("chat-1");
  });

  test("redirects signed-out visitors to sign-in instead of a JSON 401", async () => {
    state.createChatFromRequest.mockRejectedValue(new Error("Unauthorized"));
    const response = await get("https://deniai.app/new/hello?webSearch=true", navigation);
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/auth/sign-in");
    expect(location.searchParams.get("redirectTo")).toBe("/new/hello?webSearch=true");
  });

  test("creates a chat for top-level navigations", async () => {
    const response = await get("https://deniai.app/new/hello", navigation);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://deniai.app/chat/chat-1?message=hello");
    expect(state.createChatFromRequest).toHaveBeenCalledTimes(1);
  });

  test.each<Record<string, string>>([
    { "sec-fetch-dest": "image", "sec-fetch-mode": "no-cors" },
    { "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate" },
    { "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", rsc: "1" },
    { ...navigation, "sec-purpose": "prefetch;prerender" },
    { purpose: "prefetch" },
  ])("does not create chats for non-navigation request %j", async (headers) => {
    const response = await get("https://deniai.app/new/hello", headers);
    expect(response.status).toBe(400);
    expect(state.createChatFromRequest).not.toHaveBeenCalled();
  });
});

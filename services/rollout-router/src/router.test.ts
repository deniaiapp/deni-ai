import { describe, expect, test, vi } from "vitest";
import {
  decide,
  parsePercent,
  readVariantCookie,
  route,
  safeReturnPath,
  VARIANT_COOKIE,
} from "./router";

const V8_ORIGIN = "https://beta.deniai.app";
const env = (percent: string) => ({ V8_ORIGIN, V8_PERCENT: percent });

function page(path = "/chat", headers: Record<string, string> = {}) {
  return new Request(`https://deniai.app${path}`, {
    headers: { "sec-fetch-mode": "navigate", accept: "text/html", ...headers },
  });
}

function withCookie(value: string, path = "/chat") {
  return page(path, { cookie: `other=1; ${VARIANT_COOKIE}=${value}` });
}

/** Records which upstream got the request and answers 200. */
function upstream() {
  const seen: Request[] = [];
  const fetcher = vi.fn(async (request: Request) => {
    seen.push(request);
    return new Response("ok", { status: 200 });
  });
  return { seen, fetcher };
}

describe("parsePercent", () => {
  test("clamps and defaults to 0", () => {
    expect(parsePercent(undefined)).toBe(0);
    expect(parsePercent("abc")).toBe(0);
    expect(parsePercent("-5")).toBe(0);
    expect(parsePercent("12.7")).toBe(12);
    expect(parsePercent("150")).toBe(100);
  });
});

describe("readVariantCookie", () => {
  test("reads buckets and manual choices, ignores anything else", () => {
    expect(readVariantCookie(null)).toEqual({ kind: "none" });
    expect(readVariantCookie(`${VARIANT_COOKIE}=b7`)).toEqual({ kind: "bucket", bucket: 7 });
    expect(readVariantCookie(`a=1; ${VARIANT_COOKIE}=v8`)).toEqual({
      kind: "manual",
      variant: "v8",
    });
    expect(readVariantCookie(`${VARIANT_COOKIE}=b100`)).toEqual({ kind: "none" });
    expect(readVariantCookie(`${VARIANT_COOKIE}=v9`)).toEqual({ kind: "none" });
  });
});

describe("decide", () => {
  test("a bucket below the percentage gets v8, others v7, and they stay when it grows", () => {
    expect(decide(withCookie("b9"), 10).variant).toBe("v8");
    expect(decide(withCookie("b10"), 10).variant).toBe("v7");
    expect(decide(withCookie("b9"), 50).variant).toBe("v8");
    expect(decide(withCookie("b10"), 50).variant).toBe("v8");
  });

  test("a manual choice wins over the bucket rule", () => {
    expect(decide(withCookie("v8"), 1).variant).toBe("v8");
    expect(decide(withCookie("v7"), 100).variant).toBe("v7");
  });

  test("0 percent sends everyone to v7, a manual v8 choice included", () => {
    expect(decide(withCookie("v8"), 0).variant).toBe("v7");
    expect(decide(withCookie("b0"), 0).variant).toBe("v7");
    expect(decide(page(), 0)).toEqual({ variant: "v7" });
  });

  test("a first page view draws a bucket", () => {
    expect(decide(page(), 30, () => 0.25)).toEqual({ variant: "v8", assignBucket: 25 });
    expect(decide(page(), 30, () => 0.75)).toEqual({ variant: "v7", assignBucket: 75 });
  });

  test("requests that are not page views get v7 without a bucket", () => {
    const api = new Request("https://deniai.app/api/trpc/x", { headers: { accept: "*/*" } });
    expect(decide(api, 100)).toEqual({ variant: "v7" });
    const bot = page("/home", { "user-agent": "Googlebot/2.1" });
    expect(decide(bot, 100)).toEqual({ variant: "v7" });
    const post = new Request("https://deniai.app/chat", { method: "POST" });
    expect(decide(post, 100)).toEqual({ variant: "v7" });
  });

  test("webhooks, cron and integrations stay on v7; the client API goes to v8", () => {
    expect(decide(withCookie("v8", "/api/stripe/webhook"), 100).variant).toBe("v7");
    expect(decide(withCookie("v8", "/api/cron/usage-and-meter"), 100).variant).toBe("v7");
    expect(decide(withCookie("b0", "/api/integrations/deni-run/usage"), 100).variant).toBe("v7");
    expect(decide(withCookie("v7", "/api/client/v1/bootstrap"), 0).variant).toBe("v8");
  });
});

describe("safeReturnPath", () => {
  test("keeps paths on this site only", () => {
    expect(safeReturnPath("/chat/1?x=1")).toBe("/chat/1?x=1");
    expect(safeReturnPath(null)).toBe("/");
    expect(safeReturnPath("https://evil.example")).toBe("/");
    expect(safeReturnPath("//evil.example")).toBe("/");
    expect(safeReturnPath("/\\evil.example")).toBe("/");
  });
});

describe("route", () => {
  test("v7 traffic goes to deniai.app unchanged", async () => {
    const { seen, fetcher } = upstream();
    const response = await route(withCookie("v7"), env("50"), fetcher);
    expect(response.status).toBe(200);
    expect(seen[0]?.url).toBe("https://deniai.app/chat");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("v8 traffic goes to the v8 host with the visitor's address and host", async () => {
    const { seen, fetcher } = upstream();
    const request = new Request("https://deniai.app/api/chat?x=1", {
      method: "POST",
      body: JSON.stringify({ hello: "world" }),
      headers: {
        cookie: `${VARIANT_COOKIE}=v8; better-auth.session_token=abc`,
        "cf-connecting-ip": "203.0.113.7",
        origin: "https://deniai.app",
        "content-type": "application/json",
      },
    });
    await route(request, env("10"), fetcher);
    const forwarded = seen[0]!;
    expect(forwarded.url).toBe("https://beta.deniai.app/api/chat?x=1");
    expect(forwarded.method).toBe("POST");
    expect(await forwarded.text()).toBe('{"hello":"world"}');
    expect(forwarded.headers.get("x-real-ip")).toBe("203.0.113.7");
    expect(forwarded.headers.get("x-forwarded-host")).toBe("deniai.app");
    expect(forwarded.headers.get("origin")).toBe("https://deniai.app");
    expect(forwarded.headers.get("cookie")).toContain("better-auth.session_token=abc");
  });

  test("redirects v8 builds from its own host point back at deniai.app", async () => {
    const fetcher = async () =>
      new Response(null, {
        status: 307,
        headers: { location: "https://beta.deniai.app/auth/sign-in?redirectTo=%2Fchat" },
      });
    const response = await route(withCookie("v8"), env("10"), fetcher);
    expect(response.headers.get("location")).toBe(
      "https://deniai.app/auth/sign-in?redirectTo=%2Fchat",
    );

    const relative = async () =>
      new Response(null, { status: 307, headers: { location: "/home" } });
    const kept = await route(withCookie("v8"), env("10"), relative);
    expect(kept.headers.get("location")).toBe("/home");
  });

  test("a first page view stores its bucket", async () => {
    const { seen, fetcher } = upstream();
    const response = await route(page("/home"), env("20"), fetcher, () => 0.05);
    expect(seen[0]?.url).toBe("https://beta.deniai.app/home");
    expect(response.headers.get("set-cookie")).toMatch(
      new RegExp(`^${VARIANT_COOKIE}=b5; Path=/; Max-Age=\\d+; Secure; SameSite=Lax$`),
    );
  });

  test("/__rollout/v7 stores the choice and returns to the page", async () => {
    const { fetcher } = upstream();
    const response = await route(
      new Request("https://deniai.app/__rollout/v7?return=%2Fchat%2F1"),
      env("50"),
      fetcher,
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/chat/1");
    expect(response.headers.get("set-cookie")).toMatch(new RegExp(`^${VARIANT_COOKIE}=v7;`));
  });

  test("/__rollout/auto forgets the choice and /__rollout reports the state", async () => {
    const { fetcher } = upstream();
    const auto = await route(
      new Request("https://deniai.app/__rollout/auto"),
      env("50"),
      fetcher,
      () => 0.42,
    );
    expect(auto.headers.get("set-cookie")).toMatch(new RegExp(`^${VARIANT_COOKIE}=b42;`));
    expect(auto.headers.get("location")).toBe("/");

    const status = await route(withCookie("b42", "/__rollout"), env("50"), fetcher);
    expect(await status.json()).toEqual({
      variant: "v8",
      cookie: { kind: "bucket", bucket: 42 },
      percent: 50,
    });
    const unknown = await route(new Request("https://deniai.app/__rollout/v9"), env("50"), fetcher);
    expect(unknown.status).toBe(404);
  });
});

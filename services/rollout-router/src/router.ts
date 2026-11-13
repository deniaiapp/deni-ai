/**
 * Percentage rollout of Deni AI v8 on deniai.app.
 *
 * Every request to deniai.app passes this Worker. It picks v7 (the `deni-ai`
 * app, served by Caddy for `deniai.app` itself) or v8 (the `deni-ai-beta` app,
 * reached through its own host name, `V8_ORIGIN`), and keeps a browser on the
 * version it got through the `deni_variant` cookie:
 *
 * - `b<0-99>`: an assigned bucket. The browser gets v8 while its bucket is below
 *   `V8_PERCENT`, so raising the percentage moves only new buckets to v8 and
 *   lowering it moves the highest ones back; nobody else changes version.
 * - `v7` / `v8`: the visitor chose a version with `/__rollout/v7` or
 *   `/__rollout/v8` (the "previous version" / "try the new version" links).
 *
 * `V8_PERCENT=0` is the kill switch: everyone gets v7, whatever the cookie says
 * (cookies are left alone, so restoring the percentage restores who had v8).
 */

export type Variant = "v7" | "v8";

export type RolloutEnv = {
  /** Origin of the v8 app, e.g. `https://beta.deniai.app`. */
  V8_ORIGIN: string;
  /** Share of new browsers sent to v8, `0`–`100`. Unset or invalid: 0. */
  V8_PERCENT?: string;
};

export const VARIANT_COOKIE = "deni_variant";
/** Ninety days; refreshed on every switch. */
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;
export const SWITCH_PATH_PREFIX = "/__rollout/";

/**
 * Paths that one app must handle whatever the visitor's version: inbound
 * webhooks and cron (v7 runs them; v8 has CRON_ENABLED=false and
 * STRIPE_WEBHOOK_ENABLED=false), the Deni Run usage integration (v7 has its
 * secrets), and the native client API that only v8 has.
 */
const PINNED_PREFIXES: ReadonlyArray<readonly [string, Variant]> = [
  ["/api/stripe/", "v7"],
  ["/api/cron/", "v7"],
  ["/api/integrations/", "v7"],
  ["/api/client/v1/", "v8"],
];

const BOT_USER_AGENT =
  /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|lighthouse|headless/i;

export type CookieState =
  | { kind: "none" }
  | { kind: "bucket"; bucket: number }
  | { kind: "manual"; variant: Variant };

export function parsePercent(value: string | undefined): number {
  const percent = Number(value?.trim());
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, Math.floor(percent)));
}

export function readVariantCookie(cookieHeader: string | null): CookieState {
  if (!cookieHeader) return { kind: "none" };
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== VARIANT_COOKIE) continue;
    const value = rest.join("=").trim();
    if (value === "v7" || value === "v8") return { kind: "manual", variant: value };
    const match = /^b(\d{1,2})$/.exec(value);
    if (match) return { kind: "bucket", bucket: Number(match[1]) };
  }
  return { kind: "none" };
}

export function variantCookie(value: string): string {
  return `${VARIANT_COOKIE}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Secure; SameSite=Lax`;
}

export function pinnedVariant(pathname: string): Variant | null {
  for (const [prefix, variant] of PINNED_PREFIXES) {
    if (pathname.startsWith(prefix)) return variant;
  }
  return null;
}

/** A browser opening a page: the only request that gets a bucket assigned. */
export function isPageNavigation(request: Request): boolean {
  if (request.method !== "GET") return false;
  if (BOT_USER_AGENT.test(request.headers.get("user-agent") ?? "")) return false;
  const mode = request.headers.get("sec-fetch-mode");
  if (mode) return mode === "navigate";
  return (request.headers.get("accept") ?? "").includes("text/html");
}

/** The version a cookie stands for, or null when the browser has none yet. */
export function variantForCookie(cookie: CookieState, percent: number): Variant | null {
  if (percent <= 0) return "v7";
  if (cookie.kind === "manual") return cookie.variant;
  if (cookie.kind === "bucket") return cookie.bucket < percent ? "v8" : "v7";
  return null;
}

export type Decision = {
  variant: Variant;
  /** A new bucket to store, when this request assigned one. */
  assignBucket?: number;
};

export function decide(
  request: Request,
  percent: number,
  random: () => number = Math.random,
): Decision {
  const pinned = pinnedVariant(new URL(request.url).pathname);
  if (pinned) return { variant: pinned };
  const known = variantForCookie(readVariantCookie(request.headers.get("cookie")), percent);
  if (known) return { variant: known };

  // No cookie: API calls, bots and server-to-server requests stay on v7 without
  // one; a page navigation is assigned a bucket for good.
  if (!isPageNavigation(request)) return { variant: "v7" };
  const bucket = Math.floor(random() * 100);
  return { variant: bucket < percent ? "v8" : "v7", assignBucket: bucket };
}

/** `?return=` of a switch link: a path on this site, never another origin. */
export function safeReturnPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return "/";
  }
  return value;
}

/**
 * `/__rollout/v7`, `/__rollout/v8` and `/__rollout/auto` (forget the choice and
 * draw a bucket again) set the cookie and send the browser back to `?return=`.
 * `/__rollout` answers the current state as JSON, for support and debugging.
 */
export function handleRolloutPath(
  request: Request,
  percent: number,
  random: () => number = Math.random,
): Response | null {
  const url = new URL(request.url);
  if (url.pathname === "/__rollout" || url.pathname === SWITCH_PATH_PREFIX) {
    const cookie = readVariantCookie(request.headers.get("cookie"));
    // `variant: null`: no version yet; the next page view assigns one.
    const variant = variantForCookie(cookie, percent);
    return Response.json(
      { variant, cookie, percent },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!url.pathname.startsWith(SWITCH_PATH_PREFIX)) return null;

  const target = url.pathname.slice(SWITCH_PATH_PREFIX.length);
  let value: string;
  if (target === "v7" || target === "v8") value = target;
  else if (target === "auto") value = `b${Math.floor(random() * 100)}`;
  else return new Response("Not found", { status: 404 });

  console.log(JSON.stringify({ event: "rollout_switch", to: target, percent }));
  return new Response(null, {
    status: 303,
    headers: {
      Location: safeReturnPath(url.searchParams.get("return")),
      "Set-Cookie": variantCookie(value),
      "Cache-Control": "no-store",
    },
  });
}

/** The request as v8 receives it: same path and body, on the v8 host name. */
export function toV8Request(request: Request, v8Origin: string): Request {
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, v8Origin);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const forwarded = new Request(target, {
    method: request.method,
    headers: request.headers,
    body: hasBody ? request.body : null,
    redirect: "manual",
    // Needed by Node (tests) to stream a request body; Workers accept it too.
    duplex: "half",
  } as RequestInit);
  // Same-zone subrequests take CF-Connecting-IP from x-real-ip, so v8 keeps
  // seeing the visitor's address (CLIENT_IP_HEADER=cf-connecting-ip).
  const clientIp = request.headers.get("cf-connecting-ip");
  if (clientIp) forwarded.headers.set("x-real-ip", clientIp);
  forwarded.headers.set("x-forwarded-host", incoming.host);
  forwarded.headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));
  return forwarded;
}

/**
 * v8's answer as the visitor sees it: redirects that v8 built from its own
 * host name point back at the public one.
 */
export function fromV8Response(
  response: Response,
  publicOrigin: string,
  v8Origin: string,
): Response {
  const location = response.headers.get("location");
  const v8 = new URL(v8Origin);
  if (!location) return response;
  let absolute: URL;
  try {
    absolute = new URL(location);
  } catch {
    return response; // relative: already right
  }
  if (absolute.host !== v8.host) return response;
  const rewritten = new Response(response.body, response);
  rewritten.headers.set(
    "location",
    new URL(absolute.pathname + absolute.search + absolute.hash, publicOrigin).toString(),
  );
  return rewritten;
}

export async function route(
  request: Request,
  env: RolloutEnv,
  fetcher: (request: Request) => Promise<Response> = fetch,
  random: () => number = Math.random,
): Promise<Response> {
  const percent = parsePercent(env.V8_PERCENT);
  const rolloutResponse = handleRolloutPath(request, percent, random);
  if (rolloutResponse) return rolloutResponse;

  const decision = decide(request, percent, random);
  let response: Response;
  if (decision.variant === "v8") {
    const upstream = await fetcher(toV8Request(request, env.V8_ORIGIN));
    response = fromV8Response(upstream, new URL(request.url).origin, env.V8_ORIGIN);
  } else {
    // deniai.app's own origin: Caddy serves it with the v7 app.
    response = await fetcher(request);
  }

  if (decision.assignBucket === undefined) return response;
  const withCookie = new Response(response.body, response);
  withCookie.headers.append("Set-Cookie", variantCookie(`b${decision.assignBucket}`));
  return withCookie;
}

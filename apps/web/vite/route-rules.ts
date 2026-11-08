import type { NitroConfig } from "nitro/types";

type RouteRules = NonNullable<NitroConfig["routeRules"]>;

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "Permissions-Policy": "camera=(), microphone=(self), geolocation=()",
  // srcDoc artifact previews inherit this CSP and import React from esm.sh.
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://www.googletagmanager.com https://js.stripe.com https://*.js.stripe.com https://pagead2.googlesyndication.com https://static.cloudflareinsights.com https://esm.sh; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: wss: https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net; frame-src https://challenges.cloudflare.com https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://googleads.g.doubleclick.net https://tpc.googlesyndication.com; object-src 'none'; base-uri 'self'",
};

// Locale lives in the URL (/ja/*), so these pages need no locale Vary. The
// request middleware answers locale redirects with `private, no-store`.
const marketingCache = {
  headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
};
const legalCache = {
  headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
};

const permanentRedirect = (to: string) => ({ redirect: { to, status: 308 as const } });

/** Response headers and fixed redirects (formerly `next.config.ts`). */
export const routeRules: RouteRules = {
  "/**": { headers: securityHeaders },
  "/sw.js": {
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  },
  "/manifest.webmanifest": { headers: { "Cache-Control": "public, max-age=0, must-revalidate" } },
  "/home": marketingCache,
  "/ja": marketingCache,
  "/ja/**": marketingCache,
  "/about": marketingCache,
  "/use-cases": marketingCache,
  "/guides/**": marketingCache,
  "/models": marketingCache,
  "/flixa": marketingCache,
  "/desktop": marketingCache,
  "/legal/**": legalCache,
  "/api/**": { headers: { "Cache-Control": "private, no-cache, no-store" } },

  // The legacy migrator site is gone; chat imports now live in Settings.
  "/migration": permanentRedirect("/settings/import"),
  "/ja/migration": permanentRedirect("/settings/import"),
  // The affiliate program was removed; reset credits now live on the billing page.
  "/invite/**": permanentRedirect("/auth/sign-up"),
  "/settings/affiliate": permanentRedirect("/settings/billing"),
  // Deni AI no longer acts as an OAuth/OIDC provider.
  "/settings/developer": permanentRedirect("/settings/api-keys"),
  "/oauth/example": permanentRedirect("/"),
  "/ja/oauth/example": permanentRedirect("/ja"),
  // The blog was removed; the AI guides cover the same topics.
  "/blog": permanentRedirect("/guides"),
  "/blog/**": permanentRedirect("/guides"),
  "/ja/blog": permanentRedirect("/ja/guides"),
  "/ja/blog/**": permanentRedirect("/ja/guides"),
};

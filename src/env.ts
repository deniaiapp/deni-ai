import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  /**
   * Docker/Dokploy often inject unset optionals as "" rather than omitting them.
   * Treat empty strings as undefined so `.optional()` / `.url().optional()` work.
   */
  emptyStringAsUndefined: true,
  server: {
    DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().length(32),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
    CRON_SECRET: z.string().min(32).optional(),
    /**
     * Deni Run integration. The service secret authenticates Deni Run's server
     * calls to `/api/integrations/deni-run/usage`; the OAuth client id is the
     * client registered with `pnpm run tools:register-oauth-client` and is
     * cached as a trusted first-party client.
     */
    DENI_RUN_SERVICE_SECRET: z.string().min(32).optional(),
    DENI_RUN_OAUTH_CLIENT_ID: z.string().min(1).optional(),
    STRIPE_FLASH_OFFER_COUPON_ID: z.string().min(1).optional(),
    /**
     * Customer Portal configuration (`bpc_...`) used for billing portal sessions.
     * Create it with `pnpm run tools:stripe-portal`. When unset, Stripe's default
     * portal configuration applies and must have subscription updates disabled.
     */
    STRIPE_PORTAL_CONFIGURATION_ID: z.string().min(1).optional(),
    /** Operator emails (reset-credit grants, dispute alerts, blog fallback). */
    ADMIN_EMAILS: z.string().min(1).optional(),
    /** @deprecated Former name of `ADMIN_EMAILS`; still read when it is unset. */
    AFFILIATE_ADMIN_EMAILS: z.string().min(1).optional(),
    BLOG_ADMIN_EMAILS: z.string().min(1).optional(),
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    /**
     * OpenAI-compatible Deni AI API. The key is required to expose OpenAI
     * models; the base URL has a default.
     */
    DENI_API_KEY: z.string().min(1).optional(),
    DENI_API_BASE_URL: z.url().default("https://api.deniai.app/v1"),
    // Optional strings preserve parseFloat prefix parsing and fallback defaults
    // in token-weighting.ts; invalid/negative/non-finite values use defaults.
    FLIXA_USAGE_WEIGHT_INPUT: z.string().optional(),
    FLIXA_USAGE_WEIGHT_CACHE_READ: z.string().optional(),
    FLIXA_USAGE_WEIGHT_CACHE_WRITE: z.string().optional(),
    FLIXA_USAGE_WEIGHT_OUTPUT: z.string().optional(),
    EXA_API_KEY: z.string().min(1).optional(),
    TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
    /**
     * Cloudflare Email Sending (optional). Both account id and API token are
     * required to enable transactional email (magic link, verification, etc.).
     * Token needs Email Sending: Edit permission.
     */
    CLOUDFLARE_ACCOUNT_ID: z.string().min(1).optional(),
    CLOUDFLARE_API_TOKEN: z.string().min(1).optional(),
    UPSTASH_REDIS_REST_URL: z.url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
    /**
     * Cloudflare R2 attachment storage (optional; without it attachments fall
     * back to inline base64 URLs). All four are required to enable it. The API
     * token needs Object Read & Write on the bucket.
     */
    R2_ACCOUNT_ID: z
      .string()
      .regex(/^[a-z0-9]+$/i, "R2_ACCOUNT_ID must be a Cloudflare account id")
      .optional(),
    R2_ACCESS_KEY_ID: z.string().min(1).optional(),
    R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    R2_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "R2_BUCKET must be an R2 bucket name")
      .optional(),
    /**
     * Client IP resolution behind proxies (see `src/lib/client-ip.ts` and SETUP.md).
     * CLIENT_IP_HEADER: single-value header set by the trusted edge (e.g.
     * cf-connecting-ip); takes precedence. TRUSTED_PROXY_HOPS: number of trusted
     * proxies appending to X-Forwarded-For. Neither: first X-Forwarded-For entry
     * (spoofable unless the edge overwrites it).
     */
    CLIENT_IP_HEADER: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9!#$%&'*+.^_`|~-]+$/, "CLIENT_IP_HEADER must be a header name")
      .optional(),
    TRUSTED_PROXY_HOPS: z
      .string()
      .trim()
      .regex(/^[1-9]\d*$/, "TRUSTED_PROXY_HOPS must be a positive integer")
      .transform(Number)
      .optional(),
  },
  client: {
    /**
     * Public app origin (OAuth callbacks, emails).
     * Must be the real public URL (e.g. https://deniai.app) — never the Docker
     * bind address (0.0.0.0) or an internal container hostname.
     */
    NEXT_PUBLIC_BETTER_AUTH_URL: z.url().refine((value) => {
      try {
        const host = new URL(value).hostname;
        return host !== "0.0.0.0" && host !== "::" && host !== "[::]";
      } catch {
        return false;
      }
    }, "NEXT_PUBLIC_BETTER_AUTH_URL must be a public origin (not 0.0.0.0)"),
    NEXT_PUBLIC_BILLING_DISABLED: z.string().min(1).optional(),
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1).optional(),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().min(1).optional(),
    NEXT_PUBLIC_SENTRY_DSN: z.string().min(1).optional(),
    /** Public Deni Run origin linked from the usage view. */
    NEXT_PUBLIC_DENI_RUN_URL: z.url().default("https://run.deniai.app"),
  },
  clientPrefix: "NEXT_PUBLIC_",
  runtimeEnv: process.env,
});

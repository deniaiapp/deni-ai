import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { parseTwoFactorDeadline } from "@/lib/two-factor-policy";

export const env = createEnv({
  /**
   * Docker/Dokploy often inject unset optionals as "" rather than omitting them.
   * Treat empty strings as undefined so `.optional()` / `.url().optional()` work.
   */
  emptyStringAsUndefined: true,
  server: {
    DATABASE_URL: z.url(),
    // Used for HMACs and key derivation, so any length works; `pnpx auth secret`
    // prints 64 hex characters.
    BETTER_AUTH_SECRET: z.string().min(32),
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
    /** Operator emails (reset-credit grants, dispute alerts). */
    ADMIN_EMAILS: z.string().min(1).optional(),
    /**
     * Operator email domains (e.g. `deniai.app`): verified accounts on them may
     * sign up and grant reset credits, like `ADMIN_EMAILS`.
     */
    ADMIN_EMAIL_DOMAINS: z.string().min(1).optional(),
    /**
     * From this ISO date or date-time, password accounts without Google or
     * GitHub linked must turn on two-factor authentication (src/lib/two-factor-policy.ts).
     * Before it they only see a reminder; unset keeps the reminder forever.
     */
    PASSWORD_2FA_REQUIRED_FROM: z
      .string()
      .refine((value) => parseTwoFactorDeadline(value) !== null, "Use an ISO date, e.g. 2027-01-15")
      .optional(),
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
    /**
     * Deni Run (Run mode, `/run`). All optional: without a provider the matching
     * feature shows a disabled state. `@deniai/run` reads them through
     * `loadRunConfig(process.env)` (see `src/lib/run/runtime.server.ts`).
     * RUN_ENCRYPTION_KEY (32 bytes, base64) encrypts MCP credentials; unset, a key is
     * derived from BETTER_AUTH_SECRET.
     */
    RUN_ENCRYPTION_KEY: z.string().min(1).optional(),
    E2B_API_KEY: z.string().min(1).optional(),
    STEEL_API_KEY: z.string().min(1).optional(),
    STEEL_BASE_URL: z.url().optional(),
    RUN_S3_ENDPOINT: z.url().optional(),
    RUN_S3_REGION: z.string().min(1).optional(),
    RUN_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    RUN_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    RUN_S3_BUCKET: z.string().min(1).optional(),
    RUN_BROWSER_USD_PER_HOUR: z.string().optional(),
    RUN_COMPUTER_USD_PER_HOUR: z.string().optional(),
    /** `true` runs Run's job scheduler inside the web server (local development). */
    RUN_SCHEDULER_IN_PROCESS: z.enum(["true", "false"]).optional(),
    RUN_SCHEDULER_CONCURRENCY: z.string().optional(),
    SLACK_MCP_CLIENT_ID: z.string().min(1).optional(),
    SLACK_MCP_CLIENT_SECRET: z.string().min(1).optional(),
    /** Set where the Run worker's Discord bot runs; the web app only shows the link card. */
    DISCORD_BOT_TOKEN: z.string().min(1).optional(),
    DISCORD_INVITE_URL: z.url().optional(),
    /**
     * Private beta gate (`true` on beta.deniai.app). Signed-in users need a
     * `beta_access` row (or an admin email) to use the app or any signed-in
     * API, and guest sign-in is refused. Default off, so local development and
     * tests are unaffected (src/lib/beta-access.server.ts, docs/v8-beta-rollout.md).
     */
    BETA_ACCESS_REQUIRED: z.stringbool().default(false),
    /**
     * With the gate on, `true` also lets in every account on a paid plan (Go, Plus,
     * Pro, or a team plan; not Go through education), so new subscribers get in
     * without an invitation. Default off.
     */
    BETA_ACCESS_PAID_PLANS: z.stringbool().default(false),
    /**
     * `false` turns `/api/cron/*` into no-ops and keeps the in-process jobs that
     * write the shared database (usage recovery, storage and guest cleanup) from
     * starting. For a deployment that shares its database with one that already
     * runs them (the v8 beta next to v7).
     */
    CRON_ENABLED: z.stringbool().default(true),
    /**
     * `false` answers `/api/stripe/webhook` with 503 without reading the event,
     * for a deployment whose Stripe events another deployment processes.
     */
    STRIPE_WEBHOOK_ENABLED: z.stringbool().default(true),
    /**
     * `false` turns Run mode off: the sidebar hides the chat / Run switch, `/run/*`
     * pages redirect to `/chat`, `/api/run/*` answers 404 `run_disabled` and the
     * in-process scheduler never starts. Run's data stays in the database.
     */
    RUN_ENABLED: z.stringbool().default(true),
    /**
     * WebAuthn relying party ID for passkeys. Unset: the host of the auth URL
     * (deniai.app in production). beta.deniai.app sets `deniai.app` so passkeys
     * registered on deniai.app keep working there.
     */
    PASSKEY_RP_ID: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9.-]+$/, "PASSKEY_RP_ID must be a domain, e.g. deniai.app")
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
    /** The previous Deni AI (v7), linked from the account menu and the private beta screen. */
    NEXT_PUBLIC_V7_URL: z.url().default("https://deniai.app"),
  },
  clientPrefix: "NEXT_PUBLIC_",
  runtimeEnv: process.env,
});

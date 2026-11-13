/**
 * Environment of the app under end-to-end test, used for both `vite build` and
 * the production server it starts.
 *
 * Every `NEXT_PUBLIC_*` value (inlined at build time) and every key that the
 * build could pick up from local `.env*` files is set here explicitly: values
 * set in the shell win over the files (vite.config.ts), so a developer's
 * `.env` or `.env.local` cannot leak production URLs, keys or the Sentry upload
 * token into the test build.
 */

export const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3100);
export const MOCK_DENI_API_PORT = Number(process.env.MOCK_DENI_API_PORT ?? 4010);
// 127.0.0.1 rather than localhost: the server binds IPv4 only.
/**
 * Client address header the e2e server trusts (`CLIENT_IP_HEADER`); e2e/fixtures.ts
 * sends a different address per test.
 */
export const CLIENT_IP_HEADER = "x-e2e-client-ip";
export const BASE_URL = `http://127.0.0.1:${APP_PORT}`;

export function e2eDatabaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "Set E2E_DATABASE_URL to an empty Postgres database for the end-to-end tests " +
        "(for example postgresql://postgres:postgres@127.0.0.1:5432/deni_ai_e2e). " +
        "Its schema is migrated before the run; never point it at a shared database.",
    );
  }
  return url;
}

/**
 * Optional server keys of `src/env.ts` that would reach real services (email,
 * Redis, storage, OAuth, billing, Run providers). Blank, i.e. unset: the build
 * treats empty values as set, so local `.env*` files cannot fill them.
 */
const BLANK_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "CRON_SECRET",
  "DENI_RUN_SERVICE_SECRET",
  "DENI_RUN_OAUTH_CLIENT_ID",
  "ADMIN_EMAILS",
  "ADMIN_EMAIL_DOMAINS",
  "PASSWORD_2FA_REQUIRED_FROM",
  "OPENROUTER_API_KEY",
  "EXA_API_KEY",
  "TURNSTILE_SECRET_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "TRUSTED_PROXY_HOPS",
  "E2B_API_KEY",
  "STEEL_API_KEY",
  "RUN_S3_ENDPOINT",
  "RUN_S3_ACCESS_KEY_ID",
  "RUN_S3_SECRET_ACCESS_KEY",
  "RUN_S3_BUCKET",
  "SLACK_MCP_CLIENT_ID",
  "SLACK_MCP_CLIENT_SECRET",
  "DISCORD_BOT_TOKEN",
  "BETA_ACCESS_REQUIRED",
  "BETA_ACCESS_PAID_PLANS",
  "PASSKEY_RP_ID",
  "NOINDEX",
  "SENTRY_AUTH_TOKEN",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SENTRY_DSN",
  "NEXT_PUBLIC_DENI_RUN_URL",
  "NEXT_PUBLIC_V7_URL",
] as const;

export function appEnv(): Record<string, string> {
  return {
    ...Object.fromEntries(BLANK_KEYS.map((key) => [key, ""])),
    NODE_ENV: "production",
    PORT: String(APP_PORT),
    HOST: "127.0.0.1",
    DATABASE_URL: e2eDatabaseUrl(),
    BETTER_AUTH_SECRET: "e2e-secret-0123456789abcdef0123456789abcdef",
    BETTER_AUTH_URL: BASE_URL,
    NEXT_PUBLIC_BETTER_AUTH_URL: BASE_URL,
    // Answers come from e2e/mock-deni-api.ts; OpenRouter models stay unavailable.
    DENI_API_KEY: "e2e-mock-key",
    DENI_API_BASE_URL: `http://127.0.0.1:${MOCK_DENI_API_PORT}/v1`,
    CLIENT_IP_HEADER,
    // No in-process jobs or model probes during a test run.
    DISABLE_BACKGROUND_JOBS: "1",
    NEXT_PUBLIC_BILLING_DISABLED: "true",
  };
}

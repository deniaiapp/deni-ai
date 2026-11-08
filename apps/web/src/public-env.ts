/**
 * Public (`NEXT_PUBLIC_*`) environment values, inlined at build time and safe in
 * both the server and the browser bundle.
 *
 * Keep this module free of runtime validation dependencies. The validated
 * server environment lives in `src/env.ts`; importing that module from browser
 * code would add the full Zod schema to the bundle.
 */
export const clientEnv = {
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: import.meta.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: import.meta.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
} as const;

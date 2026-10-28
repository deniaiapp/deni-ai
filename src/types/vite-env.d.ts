/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly NEXT_PUBLIC_BETTER_AUTH_URL?: string;
  readonly NEXT_PUBLIC_BILLING_DISABLED?: string;
  readonly NEXT_PUBLIC_DENI_RUN_URL?: string;
  readonly NEXT_PUBLIC_SENTRY_DSN?: string;
  readonly NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?: string;
  readonly NEXT_PUBLIC_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

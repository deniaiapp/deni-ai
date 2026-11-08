// Server-only configuration. Every value is optional so the help center still runs
// without them; the features that need a value turn themselves off. Empty strings
// count as unset.

function read(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export const serverEnv = {
  /** Enables the AI support chat. */
  get anthropicApiKey() {
    return read('ANTHROPIC_API_KEY');
  },
  /** Cloudflare Email Sending (account ID + token with Email Sending: Edit). */
  get cloudflareAccountId() {
    return read('CLOUDFLARE_ACCOUNT_ID');
  },
  get cloudflareApiToken() {
    return read('CLOUDFLARE_API_TOKEN');
  },
  /** Where contact requests and feedback are delivered. */
  get supportEmailTo() {
    return read('SUPPORT_EMAIL_TO') ?? 'contact@deniai.app';
  },
  get supportEmailFrom() {
    return read('SUPPORT_EMAIL_FROM') ?? 'Deni AI Support <noreply@deniai.app>';
  },
  /** Cloudflare Turnstile. Without both keys, submissions are not challenged. */
  get turnstileSiteKey() {
    return read('TURNSTILE_SITE_KEY');
  },
  get turnstileSecretKey() {
    return read('TURNSTILE_SECRET_KEY');
  },
};

import { serverEnv } from './env';

/** True when submissions must carry a Turnstile token. */
export function isTurnstileEnabled(): boolean {
  return Boolean(serverEnv.turnstileSiteKey && serverEnv.turnstileSecretKey);
}

/**
 * Verifies a Turnstile token with Cloudflare. Always passes when Turnstile is not
 * configured (local development).
 */
export async function verifyTurnstile(token: unknown, ip: string): Promise<boolean> {
  if (!isTurnstileEnabled()) return true;
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return false;

  const body = new URLSearchParams({ secret: serverEnv.turnstileSecretKey!, response: token });
  if (ip !== 'unknown') body.set('remoteip', ip);

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
    });
    const data = (await response.json()) as { success?: boolean };
    return data.success === true;
  } catch (error) {
    console.error('[turnstile] Verification request failed', error);
    return false;
  }
}

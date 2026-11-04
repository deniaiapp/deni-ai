import { createServerFn } from '@tanstack/react-start';

export type SupportConfig = {
  /** The AI chat has an API key. */
  chat: boolean;
  /** Contact and feedback can be delivered. */
  email: boolean;
  /** Set when submissions must pass a Turnstile challenge. */
  turnstileSiteKey: string | null;
};

/** Which support features the server has configured, read at runtime. */
export const getSupportConfig = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SupportConfig> => {
    const [{ serverEnv }, { isEmailConfigured }, { isTurnstileEnabled }] = await Promise.all([
      import('@/server/env'),
      import('@/server/email'),
      import('@/server/turnstile'),
    ]);

    return {
      chat: Boolean(serverEnv.anthropicApiKey),
      email: isEmailConfigured(),
      turnstileSiteKey: isTurnstileEnabled() ? serverEnv.turnstileSiteKey! : null,
    };
  },
);

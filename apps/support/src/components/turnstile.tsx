import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';
import type { Language } from '@/lib/i18n';

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const scriptUrl = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise: Promise<TurnstileApi> | undefined;

/** Loads the Turnstile script; call early to save time before a widget renders. */
export function loadTurnstile(): Promise<TurnstileApi> {
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);

    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile missing'));
    script.onerror = () => {
      scriptPromise = undefined;
      reject(new Error('Failed to load Turnstile'));
    };
    document.head.append(script);
  });
  return scriptPromise;
}

export type TurnstileHandle = {
  /** Requests a fresh token; tokens are single-use. */
  reset: () => void;
  /**
   * Resolves with an unused token, waiting for the challenge (and starting a new
   * one if the last token was taken). Resolves `undefined` if none arrives in time.
   */
  take: () => Promise<string | undefined>;
};

const takeTimeoutMs = 45_000;

/**
 * Cloudflare Turnstile challenge. It stays invisible unless the visitor has to
 * interact, and reports each new token (or `undefined` when it expires).
 */
export function Turnstile({
  siteKey,
  lang,
  onToken,
  ref,
}: {
  siteKey: string;
  lang: Language;
  onToken?: (token: string | undefined) => void;
  ref?: Ref<TurnstileHandle>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);
  const onTokenRef = useRef(onToken);
  useLayoutEffect(() => {
    onTokenRef.current = onToken;
  });
  // Token not yet handed out by `take`, whether the widget's last token was taken,
  // and callers waiting for the next one.
  const tokenRef = useRef<string | undefined>(undefined);
  const takenRef = useRef(false);
  const waitersRef = useRef<((token: string | undefined) => void)[]>([]);

  function setToken(token: string | undefined) {
    onTokenRef.current?.(token);
    const waiter = token ? waitersRef.current.shift() : undefined;
    if (waiter) {
      takenRef.current = true;
      waiter(token);
    } else {
      tokenRef.current = token;
    }
  }

  useImperativeHandle(ref, () => ({
    reset() {
      setToken(undefined);
      takenRef.current = false;
      if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
    },
    take() {
      const token = tokenRef.current;
      if (token) {
        tokenRef.current = undefined;
        takenRef.current = true;
        return Promise.resolve(token);
      }
      if (takenRef.current && widgetIdRef.current) {
        takenRef.current = false;
        window.turnstile?.reset(widgetIdRef.current);
      }
      return new Promise((resolve) => {
        const waiter = (value: string | undefined) => {
          clearTimeout(timeout);
          resolve(value);
        };
        const timeout = setTimeout(() => {
          waitersRef.current = waitersRef.current.filter((w) => w !== waiter);
          resolve(undefined);
        }, takeTimeoutMs);
        waitersRef.current.push(waiter);
      });
    },
  }));

  useEffect(() => {
    let cancelled = false;

    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          language: lang,
          appearance: 'interaction-only',
          size: 'flexible',
          callback: (token: string) => setToken(token),
          'expired-callback': () => setToken(undefined),
          // Turnstile retries on its own; waiters keep waiting until it succeeds or times out.
          'error-callback': () => setToken(undefined),
        });
      })
      .catch((error) => console.error(error));

    return () => {
      cancelled = true;
      if (widgetIdRef.current) window.turnstile?.remove(widgetIdRef.current);
      widgetIdRef.current = undefined;
      tokenRef.current = undefined;
      takenRef.current = false;
    };
  }, [siteKey, lang]);

  return <div ref={containerRef} className="empty:hidden" />;
}

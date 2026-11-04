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

function loadTurnstile(): Promise<TurnstileApi> {
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
};

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
  onToken: (token: string | undefined) => void;
  ref?: Ref<TurnstileHandle>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);
  const onTokenRef = useRef(onToken);
  useLayoutEffect(() => {
    onTokenRef.current = onToken;
  });

  useImperativeHandle(ref, () => ({
    reset() {
      onTokenRef.current(undefined);
      if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
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
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(undefined),
          'error-callback': () => onTokenRef.current(undefined),
        });
      })
      .catch((error) => console.error(error));

    return () => {
      cancelled = true;
      if (widgetIdRef.current) window.turnstile?.remove(widgetIdRef.current);
      widgetIdRef.current = undefined;
    };
  }, [siteKey, lang]);

  return <div ref={containerRef} className="empty:hidden" />;
}

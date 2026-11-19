import type { CaptchaRenderProps } from "@better-auth-ui/react/plugins/captcha";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useLocale } from "use-intl";
import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { clientEnv } from "@/public-env";

/**
 * Cloudflare Turnstile widget wired for better-auth-ui `captchaPlugin`.
 * Tokens are forwarded as the `x-captcha-response` header on auth requests.
 */
export function TurnstileCaptcha({ setToken, clearToken, setReset }: CaptchaRenderProps) {
  const ref = useRef<TurnstileInstance | null>(null);
  const { resolvedTheme } = useTheme();
  const locale = useLocale();
  const siteKey = clientEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  const handleSuccess = (token: string) => {
    setToken(token);
  };

  const handleExpireOrError = () => {
    clearToken();
  };

  useEffect(() => {
    setReset(() => {
      ref.current?.reset();
    });

    return () => {
      setReset(null);
    };
  }, [setReset]);

  if (!siteKey) {
    return null;
  }

  return (
    <Turnstile
      ref={ref}
      siteKey={siteKey}
      onSuccess={handleSuccess}
      onExpire={handleExpireOrError}
      onError={handleExpireOrError}
      options={{
        theme: resolvedTheme === "dark" ? "dark" : "light",
        language: locale === "ja" ? "ja" : "en",
        size: "flexible",
      }}
    />
  );
}

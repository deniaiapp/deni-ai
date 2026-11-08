import { AlertCircleIcon, X } from "lucide-react";
import { useExtracted } from "use-intl";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useLocalizeError } from "@/hooks/use-localize-error";
import { usePathname, useRouter, useSearchParams } from "@/lib/navigation";

/**
 * Social sign-in failures (for example a Gmail address used with GitHub) come
 * back to the auth page with `?error=CODE&error_description=...`. Explain them
 * in the user's language instead of leaving the form unchanged.
 */
export function OAuthErrorAlert() {
  const t = useExtracted();
  const localizeError = useLocalizeError();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const code = searchParams.get("error");

  if (!code) {
    return null;
  }

  // Better Auth's own OAuth callback codes (lowercase); policy codes such as
  // EMAIL_USE_GOOGLE_OAUTH come from useLocalizeError's table.
  const callbackMessages: Record<string, string> = {
    invalid_code: t("Sign-in was cancelled or took too long. Please try again."),
    state_mismatch: t(
      "Sign-in was started in another tab or took too long. Please try again from this page.",
    ),
    please_restart_the_process: t(
      "Sign-in was started in another tab or took too long. Please try again from this page.",
    ),
    account_not_linked: t(
      "This email is already registered with another sign-in method. Sign in with that method, then connect this provider in account settings.",
    ),
    email_not_found: t(
      "The provider didn't share an email address. Make your email visible to Deni AI there, or use another sign-in method.",
    ),
    unable_to_get_user_info: t(
      "We couldn't read your profile from the provider. Please try again.",
    ),
  };
  // `code` comes from the URL: own keys only, so `?error=__proto__` is not looked up.
  const message = Object.hasOwn(callbackMessages, code)
    ? callbackMessages[code]
    : localizeError(
        { code, message: searchParams.get("error_description") ?? undefined },
        t("Something went wrong. Please try again. (Error: {code})", { code }),
      );

  const dismiss = () => {
    const rest = new URLSearchParams(searchParams);
    rest.delete("error");
    rest.delete("error_description");
    const query = rest.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <Alert variant="destructive" className="w-full max-w-sm">
      <AlertCircleIcon />
      <AlertTitle>{t("We couldn't sign you in")}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      <AlertAction>
        <Button type="button" size="icon-sm" variant="ghost" onClick={dismiss}>
          <X />
          <span className="sr-only">{t("Dismiss")}</span>
        </Button>
      </AlertAction>
    </Alert>
  );
}

import { createFileRoute, redirect } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useExtracted, useLocale } from "use-intl";
import { AuthFrame } from "@/components/auth/auth-frame";
import { TwoFactorSettings } from "@/components/auth/settings/security/two-factor-settings";
import { useLocalizeError } from "@/hooks/use-localize-error";
import { authClient } from "@/lib/auth-client";
import { toSafeRedirectPath } from "@/lib/auth-redirect";
import { formatAppDate } from "@/lib/format-date";
import { Link, useRouter } from "@/lib/navigation";
import { getAuthState, resetAuthStateCache } from "@/lib/session-functions";
import { signInPath } from "@/lib/sign-in-redirect";
import { Button } from "@deniai/ui/components/button";
import { Spinner } from "@deniai/ui/components/spinner";

/**
 * Two-factor setup for password accounts subject to the rule in
 * src/lib/two-factor-policy.ts. Required accounts are sent here from every
 * signed-in app route; accounts in the grace period can open it from the
 * reminder. Everyone else goes back to the app.
 */
export const Route = createFileRoute("/_auth/two-factor/setup")({
  validateSearch: (search: Record<string, unknown>): { redirectTo?: string } =>
    typeof search.redirectTo === "string" ? { redirectTo: search.redirectTo } : {},
  beforeLoad: async ({ location, search }) => {
    const authState = await getAuthState();
    if (!authState.signedIn) {
      throw redirect({ href: signInPath(location.href) });
    }
    const { status } = authState.twoFactor;
    if (status !== "required" && status !== "grace") {
      throw redirect({ href: toSafeRedirectPath(search.redirectTo) });
    }
    return { twoFactor: authState.twoFactor };
  },
  head: () => ({ meta: [{ title: "Deni AI" }] }),
  component: TwoFactorSetupPage,
});

function TwoFactorSetupPage() {
  const t = useExtracted();
  const locale = useLocale();
  const { push } = useRouter();
  const localizeError = useLocalizeError();
  const { redirectTo } = Route.useSearch();
  const { twoFactor } = Route.useRouteContext();
  const { data: session } = authClient.useSession();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const enabled = Boolean(session?.user.twoFactorEnabled);
  const deadline = twoFactor.deadline ? formatAppDate(twoFactor.deadline, locale) : null;
  const destination = toSafeRedirectPath(redirectTo);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        toast.error(localizeError(result.error));
        return;
      }
      resetAuthStateCache();
      push("/");
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <AuthFrame>
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex flex-col gap-3">
          <span className="flex size-10 items-center justify-center rounded-card bg-secondary text-secondary-foreground">
            <ShieldCheck aria-hidden="true" className="size-5" />
          </span>
          <h1 className="text-2xl leading-8 font-semibold">
            {enabled
              ? t("Two-factor authentication is on")
              : t("Turn on two-factor authentication")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {enabled
              ? t(
                  "Your account now asks for a code from your authenticator app when you sign in with your password.",
                )
              : twoFactor.status === "required"
                ? t(
                    "Accounts that sign in with a password and have no Google or GitHub account linked need a second sign-in step since {date}. Turn it on to keep using Deni AI.",
                    { date: deadline ?? "—" },
                  )
                : deadline
                  ? t(
                      "From {date}, accounts that sign in with a password and have no Google or GitHub account linked need a second sign-in step. Turn it on now to avoid an interruption.",
                      { date: deadline },
                    )
                  : t("Protect password sign-ins with a code from an authenticator app.")}
          </p>
        </div>

        <TwoFactorSettings />

        <div className="flex flex-col gap-3 border-t border-border pt-6">
          {enabled || twoFactor.status === "grace" ? (
            <Button
              onClick={() => {
                resetAuthStateCache();
                push(destination);
              }}
              variant={enabled ? "default" : "outline"}
            >
              {enabled ? t("Continue to Deni AI") : t("Remind me later")}
            </Button>
          ) : null}
          <p className="text-sm text-muted-foreground">
            {t.rich(
              "Prefer to sign in with Google or GitHub? Link one in <link>security settings</link>.",
              {
                link: (chunks) => (
                  <Link
                    href="/account/security"
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {chunks}
                  </Link>
                ),
              },
            )}
          </p>
          <Button
            variant="ghost"
            className="self-start"
            disabled={isSigningOut}
            onClick={() => void handleSignOut()}
          >
            {isSigningOut ? <Spinner /> : null}
            {t("Sign out")}
          </Button>
        </div>
      </div>
    </AuthFrame>
  );
}

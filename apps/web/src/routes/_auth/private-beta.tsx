import { createFileRoute, redirect } from "@tanstack/react-router";
import { ArrowUpRight, FlaskConical } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useExtracted } from "use-intl";
import { AuthFrame } from "@/components/auth/auth-frame";
import { useLocalizeError } from "@/hooks/use-localize-error";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "@/lib/navigation";
import { getAuthState, resetAuthStateCache } from "@/lib/session-functions";
import { signInPath } from "@/lib/sign-in-redirect";
import { clientEnv } from "@/public-env";
import { Button } from "@deniai/ui/components/button";
import { Spinner } from "@deniai/ui/components/spinner";

/**
 * Private beta screen (BETA_ACCESS_REQUIRED): where `/_app` sends signed-in
 * accounts without a `beta_access` grant, and guests. Invited accounts go on
 * to the app.
 */
export const Route = createFileRoute("/_auth/private-beta")({
  beforeLoad: async ({ location }) => {
    const authState = await getAuthState();
    if (!authState.signedIn) {
      throw redirect({ href: signInPath(location.href) });
    }
    if (authState.betaAccess) {
      throw redirect({ href: "/chat" });
    }
    return { paidPlans: authState.betaPaidPlans };
  },
  head: () => ({ meta: [{ title: "Deni AI" }] }),
  component: PrivateBetaPage,
});

function PrivateBetaPage() {
  const t = useExtracted();
  const { push } = useRouter();
  const localizeError = useLocalizeError();
  const { data: session } = authClient.useSession();
  const { paidPlans } = Route.useRouteContext();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const user = session?.user;
  const account = user?.isAnonymous ? t("a guest account") : (user?.email ?? "—");

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        toast.error(localizeError(result.error));
        return;
      }
      resetAuthStateCache();
      push("/auth/sign-in");
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <AuthFrame>
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex flex-col gap-3">
          <span className="flex size-10 items-center justify-center rounded-card bg-secondary text-secondary-foreground">
            <FlaskConical aria-hidden="true" className="size-5" />
          </span>
          <h1 className="text-2xl leading-8 font-semibold">{t("Deni AI v8 is in private beta")}</h1>
          <p className="text-sm text-muted-foreground">
            {paidPlans
              ? t(
                  "The new Deni AI is open to subscribers and invited testers for now. Subscribe to a paid plan to try it, or keep using Deni AI v7: your chats, projects and plan are the same there.",
                )
              : t(
                  "The new Deni AI is open to invited testers only for now. Your account has not been invited, so keep using Deni AI v7: your chats, projects and plan are the same there.",
                )}
          </p>
        </div>

        <div className="rounded-card border border-border bg-card px-4 py-3 text-sm">
          <p className="text-muted-foreground">{t("Signed in as")}</p>
          <p className="truncate font-medium" data-testid="private-beta-account">
            {account}
          </p>
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-6">
          <Button render={<a href={clientEnv.NEXT_PUBLIC_V7_URL} />} nativeButton={false}>
            {t("Go to Deni AI (v7)")}
            <ArrowUpRight aria-hidden="true" />
          </Button>
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

import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { RuntimeAppProviders } from "@/components/runtime-app-providers";
import { Spinner } from "@deniai/ui/components/spinner";
import { getAppMode } from "@/lib/app-mode";
import { BETA_ACCESS_PATH } from "@/lib/beta-access";
import { getAuthState } from "@/lib/session-functions";
import { signInPath } from "@/lib/sign-in-redirect";
import { isAllowedWhileTwoFactorRequired, TWO_FACTOR_SETUP_PATH } from "@/lib/two-factor-policy";

/** Content-area only — AppShell (sidebar) stays visible while a page loads. */
function AppContentFallback() {
  return (
    <div className="flex min-h-[50vh] flex-1 items-center justify-center">
      <Spinner className="size-5" />
    </div>
  );
}

/**
 * Signed-in app routes. Chat panes are hosted by ChatRouteHost inside AppShell,
 * so chat pages are empty route markers and switching chats keeps the shell
 * mounted.
 */
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ location }) => {
    const authState = await getAuthState();
    if (!authState.signedIn) {
      // Return to the requested page (e.g. a Flixa device code), not always /chat.
      throw redirect({ href: signInPath(location.href) });
    }
    // Private beta (BETA_ACCESS_REQUIRED): uninvited accounts and guests only
    // see the private beta screen; their API calls are refused in src/start.ts.
    if (!authState.betaAccess) {
      throw redirect({ href: BETA_ACCESS_PATH });
    }
    // Password accounts past PASSWORD_2FA_REQUIRED_FROM without 2FA: only the
    // setup screen and security settings stay open (sign-out lives on both).
    if (
      authState.twoFactor.status === "required" &&
      !isAllowedWhileTwoFactorRequired(location.pathname)
    ) {
      throw redirect({
        href: `${TWO_FACTOR_SETUP_PATH}?redirectTo=${encodeURIComponent(location.href)}`,
      });
    }
    // RUN_ENABLED=false: Run mode is switched off for this deployment.
    if (!authState.runEnabled && getAppMode(location.pathname) === "run") {
      throw redirect({ href: "/chat" });
    }
    return { authState };
  },
  // App routes set their own titles client-side (DocumentTitle); keep the
  // marketing homepage title out of signed-in tabs.
  head: () => ({ meta: [{ title: "Deni AI" }] }),
  pendingComponent: AppContentFallback,
  component: AppLayout,
});

function AppLayout() {
  return (
    <RuntimeAppProviders>
      <AppShell>
        <Outlet />
      </AppShell>
    </RuntimeAppProviders>
  );
}

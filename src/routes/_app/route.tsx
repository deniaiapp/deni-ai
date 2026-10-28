import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { RuntimeAppProviders } from "@/components/runtime-app-providers";
import { Spinner } from "@/components/ui/spinner";
import { getAuthState } from "@/lib/session-functions";
import { signInPath } from "@/lib/sign-in-redirect";

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

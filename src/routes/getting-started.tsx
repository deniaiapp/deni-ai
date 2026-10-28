import { createFileRoute, redirect } from "@tanstack/react-router";
import GettingStartedPage from "@/components/getting-started-page";
import { RuntimeAppProviders } from "@/components/runtime-app-providers";
import { Spinner } from "@/components/ui/spinner";
import { pageHead } from "@/lib/seo";
import { getAuthState } from "@/lib/session-functions";

function GettingStartedFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner className="size-5" />
    </div>
  );
}

export const Route = createFileRoute("/getting-started")({
  beforeLoad: async () => {
    const authState = await getAuthState();
    if (!authState.signedIn) {
      throw redirect({ href: "/" });
    }
  },
  head: () =>
    pageHead({
      title: "Getting Started",
      description: "Set up your Deni AI workspace.",
    }),
  pendingComponent: GettingStartedFallback,
  component: GettingStarted,
});

function GettingStarted() {
  // The setup flow reads the theme preset and session like the app routes do.
  return (
    <RuntimeAppProviders>
      <GettingStartedPage />
    </RuntimeAppProviders>
  );
}

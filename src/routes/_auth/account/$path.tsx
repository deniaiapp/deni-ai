import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { Settings } from "@/components/auth/settings/settings";
import Footer from "@/components/footer";
import Header from "@/components/header";
import { Spinner } from "@/components/ui/spinner";

/** Matches AuthProvider viewPaths.settings override (account → "settings"). */
const ACCOUNT_SETTINGS_PATHS = ["settings", "security"] as const;

/** Better Auth UI's session query key (shared by its client and server helpers). */
const SESSION_QUERY_KEY = ["auth", "getSession"] as const;

const getAccountSessionFn = createServerFn({ method: "GET" }).handler(async () => {
  const { auth } = await import("@/lib/auth");
  return auth.api.getSession({ headers: getRequestHeaders() });
});

function AccountPageFallback() {
  return (
    <main className="flex min-h-[50vh] items-center justify-center pt-24" id="main-content">
      <Spinner className="size-5" />
    </main>
  );
}

export const Route = createFileRoute("/_auth/account/$path")({
  loader: async ({ params, location }) => {
    if (!(ACCOUNT_SETTINGS_PATHS as readonly string[]).includes(params.path)) {
      throw notFound();
    }

    const session = await getAccountSessionFn();
    if (!session) {
      // Email links can land here signed out; keep their ?error= so the result is
      // still shown after signing in.
      const error = new URLSearchParams(location.searchStr).get("error");
      const returnTo =
        error === null
          ? `/account/${params.path}`
          : `/account/${params.path}?${new URLSearchParams({ error }).toString()}`;
      throw redirect({ href: `/auth/sign-in?redirectTo=${encodeURIComponent(returnTo)}` });
    }

    // Seed Better Auth UI's session query so settings render without a refetch.
    const queryClient = new QueryClient();
    queryClient.setQueryData(SESSION_QUERY_KEY, session);
    return dehydrate(queryClient);
  },
  pendingComponent: AccountPageFallback,
  component: AccountPage,
});

function AccountPage() {
  const { path } = Route.useParams();
  const dehydratedState = Route.useLoaderData();

  return (
    <HydrationBoundary state={dehydratedState}>
      <main className="pt-24" id="main-content">
        <Header />
        <div className="mx-auto w-full max-w-3xl px-8 pb-12">
          <Settings path={path} />
        </div>
        <Footer />
      </main>
    </HydrationBoundary>
  );
}

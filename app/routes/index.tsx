import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { lazy, Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { getAuthSession } from "@/lib/auth";
import { connectorId } from "@/lib/connect-intent";
import { Landing } from "../components/landing";

const Workspace = lazy(() => import("../components/workspace").then((mod) => ({ default: mod.Workspace })));

type HomeSearch = { connect?: string };

const loadHome = createServerFn({ method: "GET" })
  .validator((search: HomeSearch) => search)
  .handler(async ({ data }) => {
    const session = await getAuthSession();
    if (!session?.user.id) {
      // "Add to Slack" and similar links: sign in first, then the workspace starts the connection.
      if (data.connect) throw redirect({ to: "/sign-in", search: { connect: data.connect } });
      return { signedIn: false };
    }
    if (!session.user.twoFactorEnabled) throw redirect({ to: "/two-factor/setup" });
    return { signedIn: true };
  });

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): HomeSearch => ({
    connect: connectorId(search.connect) ?? undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadHome({ data: deps }),
  component: HomePage,
});

function HomePage() {
  const { signedIn } = Route.useLoaderData();
  if (!signedIn) return <Landing signedIn={false} />;
  return (
    <Suspense fallback={<PageLoading />}>
      <Workspace />
    </Suspense>
  );
}

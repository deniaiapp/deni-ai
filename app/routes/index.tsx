import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { lazy, Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { getAuthSession } from "@/lib/auth";
import { connectorId } from "@/lib/connect-intent";
import workspaceChunk from "virtual:workspace-chunk";
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
    // The account menu shows these, so the page does not ask for the session again.
    const { name, email, image } = session.user as { name: string; email: string; image?: string | null };
    return { signedIn: true, account: { name, email, image: image ?? null }, workspaceChunk };
  });

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): HomeSearch => ({
    connect: connectorId(search.connect) ?? undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadHome({ data: deps }),
  // Signed in, the page will need the workspace: fetch its chunk alongside the main bundle.
  head: ({ loaderData }) => ({
    links: loaderData && "workspaceChunk" in loaderData && loaderData.workspaceChunk
      ? [{ rel: "modulepreload", href: loaderData.workspaceChunk }]
      : [],
  }),
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

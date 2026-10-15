import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { lazy, Suspense } from "react";
import { PageLoading } from "@/components/page-loading";
import { getAuthSession } from "@/lib/auth";
import { syncBilling } from "@/lib/billing";
import { Landing } from "../components/landing";

const Workspace = lazy(() => import("../components/workspace").then((mod) => ({ default: mod.Workspace })));

type HomeSearch = { billing?: string; session_id?: string };

const loadHome = createServerFn({ method: "GET" })
  .validator((search: HomeSearch) => search)
  .handler(async ({ data }) => {
    const session = await getAuthSession();
    if (!session?.user.id) return { signedIn: false };
    if (!session.user.twoFactorEnabled) throw redirect({ to: "/two-factor/setup" });
    if (data.session_id || data.billing === "success") {
      await syncBilling(session.user.id, data.session_id).catch(() => undefined);
    }
    return { signedIn: true };
  });

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): HomeSearch => ({
    billing: typeof search.billing === "string" ? search.billing : undefined,
    session_id: typeof search.session_id === "string" ? search.session_id : undefined,
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

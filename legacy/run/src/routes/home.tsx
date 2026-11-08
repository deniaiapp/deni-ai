import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getAuthSession } from "@/lib/auth";
import { Landing } from "@/components/marketing/landing";

const loadSignedIn = createServerFn({ method: "GET" }).handler(async () => {
  const session = await getAuthSession();
  return Boolean(session?.user.id);
});

export const Route = createFileRoute("/home")({
  loader: () => loadSignedIn(),
  component: HomePage,
});

function HomePage() {
  return <Landing signedIn={Route.useLoaderData()} />;
}

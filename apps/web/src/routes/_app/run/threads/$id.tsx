import { createFileRoute } from "@tanstack/react-router";
import { RunThreadView } from "@/components/run/run-thread";

export const Route = createFileRoute("/_app/run/threads/$id")({
  component: RunThreadRoute,
});

function RunThreadRoute() {
  const { id } = Route.useParams();
  return <RunThreadView threadId={id} />;
}

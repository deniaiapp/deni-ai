import { createFileRoute } from "@tanstack/react-router";
import { ConnectorDetailPage } from "@/components/run/connectors/connector-detail-page";

export const Route = createFileRoute("/_app/run/connectors/$id")({
  component: ConnectorDetailRoute,
});

function ConnectorDetailRoute() {
  const { id } = Route.useParams();
  return <ConnectorDetailPage id={id} />;
}

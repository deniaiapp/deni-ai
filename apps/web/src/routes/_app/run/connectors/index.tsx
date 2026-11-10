import { createFileRoute } from "@tanstack/react-router";
import { ConnectorGalleryPage } from "@/components/run/connectors/connector-gallery-page";

export const Route = createFileRoute("/_app/run/connectors/")({
  component: ConnectorGalleryPage,
});

import { createFileRoute } from "@tanstack/react-router";
import { SavedModelComparison } from "@/components/chat/model-comparison";

export const Route = createFileRoute("/_app/compare/$id")({
  component: SavedComparePage,
});

function SavedComparePage() {
  const { id } = Route.useParams();
  return <SavedModelComparison key={id} id={id} />;
}

import { createFileRoute } from "@tanstack/react-router";
import { ModelComparison } from "@/components/chat/model-comparison";

export const Route = createFileRoute("/_app/compare/")({
  component: ModelComparison,
});

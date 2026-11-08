import { createFileRoute } from "@tanstack/react-router";
import { RunHome } from "@/components/run/run-home";

export const Route = createFileRoute("/_app/run/")({
  component: RunHome,
});

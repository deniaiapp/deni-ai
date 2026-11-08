import { createFileRoute } from "@tanstack/react-router";
import { RunGroupForm } from "@/components/run/run-group-form";

export const Route = createFileRoute("/_app/run/groups/new")({
  component: RunGroupForm,
});

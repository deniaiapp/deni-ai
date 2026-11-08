import { createFileRoute } from "@tanstack/react-router";
import { TeammateForm } from "@/components/run/teammate-form";

export const Route = createFileRoute("/_app/run/teammates/new")({
  component: () => <TeammateForm />,
});

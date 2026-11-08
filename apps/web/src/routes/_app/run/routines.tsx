import { createFileRoute } from "@tanstack/react-router";
import { RunRoutinesPage } from "@/components/run/run-routines-page";

export const Route = createFileRoute("/_app/run/routines")({
  component: RunRoutinesPage,
});

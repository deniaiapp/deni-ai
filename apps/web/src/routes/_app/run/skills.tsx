import { createFileRoute } from "@tanstack/react-router";
import { RunSkillsPage } from "@/components/run/run-skills-page";

export const Route = createFileRoute("/_app/run/skills")({
  component: RunSkillsPage,
});

import { createFileRoute } from "@tanstack/react-router";
import { dynamic } from "@/lib/dynamic";
import { ProjectsSettingsLoading } from "@/components/projects/projects-settings-loading";

export const Route = createFileRoute("/_app/settings/projects")({
  component: ProjectsPage,
});

const ProjectsSettingsPage = dynamic(
  () =>
    import("@/components/projects/projects-settings-page").then((mod) => mod.ProjectsSettingsPage),
  {
    loading: () => <ProjectsSettingsLoading />,
  },
);

function ProjectsPage() {
  return <ProjectsSettingsPage />;
}

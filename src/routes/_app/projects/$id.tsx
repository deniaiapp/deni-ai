import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";
import { ProjectPage } from "@/components/projects/project-page";
import { Spinner } from "@/components/ui/spinner";

/** Name of a project the signed-in user can open; 404 for anything else. */
const getAccessibleProjectNameFn = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const [{ auth }, { db }, { getAccessibleProject }] = await Promise.all([
      import("@/lib/auth"),
      import("@/db/drizzle"),
      import("@/lib/project-access"),
    ]);
    const session = await auth.api.getSession({ headers: getRequestHeaders() });
    if (!session?.user) {
      throw notFound();
    }

    const project = await getAccessibleProject(db, session.user.id, data.id);
    if (!project) {
      throw notFound();
    }

    return { name: project.name };
  });

function ProjectPageFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner className="size-5" />
    </div>
  );
}

export const Route = createFileRoute("/_app/projects/$id")({
  loader: ({ params }) => getAccessibleProjectNameFn({ data: { id: params.id } }),
  pendingComponent: ProjectPageFallback,
  component: ProjectDetailPage,
});

function ProjectDetailPage() {
  const { id } = Route.useParams();
  const project = Route.useLoaderData();
  return <ProjectPage key={id} projectId={id} initialProjectName={project.name} />;
}

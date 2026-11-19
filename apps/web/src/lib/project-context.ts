import { db } from "@/db/drizzle";
import { getAccessibleProject } from "@/lib/project-access";

export async function buildProjectPrompt(projectId: string | null | undefined, userId: string) {
  if (!projectId) {
    return null;
  }

  const project = await getAccessibleProject(db, userId, projectId);
  if (!project || project.archivedAt) {
    return null;
  }

  return [
    `Project: ${project.name}`,
    project.description ? `Description: ${project.description}` : null,
    project.instructions ? `Project instructions: ${project.instructions}` : null,
    "Treat these project instructions as persistent working context for the conversation. Use them when relevant.",
  ]
    .filter(Boolean)
    .join("\n");
}

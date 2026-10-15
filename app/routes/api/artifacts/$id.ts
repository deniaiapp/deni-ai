import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { getArtifact } from "@/lib/artifacts";
import { readWorkspaceBytes, readWorkspaceFile } from "@/lib/workspace";
import { getExtracted } from "@/i18n/server";
import { localizeError } from "@/lib/localize-error";

async function GET({ request: req, params }: { request: Request; params: { id: string } }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const { id } = params;
  const artifact = await getArtifact(userId, id);
  if (!artifact) return Response.json({ error: t("Artifact not found") }, { status: 404 });
  const mode = new URL(req.url).searchParams.get("mode") || "preview";
  try {
    if (mode === "download") {
      const file = await readWorkspaceBytes(userId, artifact.path);
      return new Response(new Uint8Array(file.data), {
        headers: {
          "Content-Type": artifact.mimeType,
          "Content-Disposition": `attachment; filename="${artifact.title.replace(/[^A-Za-z0-9._-]+/g, "_")}"`,
          "Cache-Control": "no-store",
        },
      });
    }
    const file = await readWorkspaceFile(userId, artifact.path);
    return Response.json({ artifact, content: file.content }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: await localizeError(error) },
      { status: 404 },
    );
  }
}

export const Route = createFileRoute("/api/artifacts/$id")({
  server: { handlers: { GET } },
});

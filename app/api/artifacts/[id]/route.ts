import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { getArtifact } from "@/lib/artifacts";
import { readWorkspaceBytes, readWorkspaceFile } from "@/lib/workspace";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: Context) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const { id } = await context.params;
  const artifact = await getArtifact(userId, id);
  if (!artifact) return NextResponse.json({ error: "artifact not found" }, { status: 404 });
  const mode = new URL(req.url).searchParams.get("mode") || "preview";
  try {
    if (mode === "download") {
      const file = await readWorkspaceBytes(userId, artifact.path);
      return new NextResponse(new Uint8Array(file.data), {
        headers: {
          "Content-Type": artifact.mimeType,
          "Content-Disposition": `attachment; filename="${artifact.title.replace(/[^A-Za-z0-9._-]+/g, "_")}"`,
          "Cache-Control": "no-store",
        },
      });
    }
    const file = await readWorkspaceFile(userId, artifact.path);
    return NextResponse.json({ artifact, content: file.content }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 404 },
    );
  }
}

import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/auth/api";
import { listArtifacts, registerArtifact } from "@/lib/agent/artifacts";
import { readWorkspaceBytes } from "@/lib/computer/workspace";
import { getExtracted } from "@/i18n/server";
import { localizeError } from "@/i18n/localize-error";

async function GET({ request: req }: { request: Request }) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const threadId = new URL(req.url).searchParams.get("threadId") || undefined;
  return Response.json({ artifacts: await listArtifacts(userId, threadId) }, {
    headers: { "Cache-Control": "no-store" },
  });
}

async function POST({ request: req }: { request: Request }) {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const body = (await req.json().catch(() => ({}))) as {
    jobId?: string;
    threadId?: string;
    botId?: string;
    path?: string;
    title?: string;
    mimeType?: string;
    description?: string;
  };
  if (!body.threadId || !body.path || !body.title) {
    return Response.json({ error: t("threadId, path, and title are required") }, { status: 400 });
  }
  try {
    await readWorkspaceBytes(userId, body.path);
    const artifact = await registerArtifact({
      userId,
      jobId: body.jobId,
      threadId: body.threadId,
      botId: body.botId,
      path: body.path,
      title: body.title,
      mimeType: body.mimeType,
      description: body.description,
    });
    return Response.json({ artifact }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: await localizeError(error) },
      { status: 400 },
    );
  }
}

export const Route = createFileRoute("/api/artifacts/")({
  server: { handlers: { GET, POST } },
});

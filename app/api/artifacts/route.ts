import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { listArtifacts, registerArtifact } from "@/lib/artifacts";
import { readWorkspaceBytes } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const threadId = new URL(req.url).searchParams.get("threadId") || undefined;
  return NextResponse.json({ artifacts: await listArtifacts(userId, threadId) }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request) {
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
    return NextResponse.json({ error: "threadId, path, and title required" }, { status: 400 });
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
    return NextResponse.json({ artifact }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

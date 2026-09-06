import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { nowIso } from "@/lib/ids";
import { mutateStore } from "@/lib/store";
import { validAvatarIcon } from "@/lib/avatar";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const { id } = await params;
  const body = (await req.json()) as {
    name?: string;
    job?: string;
    instructions?: string;
    icon?: string | null;
  };
  if (body.icon !== undefined && !validAvatarIcon(body.icon)) return NextResponse.json({ error: "Invalid icon" }, { status: 400 });
  const bot = await mutateStore(userId, (store) => {
    const item = store.bots.find((entry) => entry.id === id);
    if (!item) return null;
    if (body.name) item.name = body.name.trim();
    if (body.job) item.job = body.job.trim();
    if (body.instructions) item.instructions = body.instructions;
    if (body.icon !== undefined) item.icon = body.icon || null;
    item.updatedAt = nowIso();
    const dm = store.threads.find(
      (thread) => thread.kind === "dm" && thread.botIds[0] === id,
    );
    if (dm) dm.title = item.name;
    return item;
  });
  if (!bot) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ bot });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const { id } = await params;
  if (["chief", "research", "ops"].includes(id)) {
    return NextResponse.json({ error: "default bots stay" }, { status: 400 });
  }
  await mutateStore(userId, (store) => {
    store.bots = store.bots.filter((item) => item.id !== id);
    store.threads = store.threads.filter((item) => !item.botIds.includes(id));
    store.routines = store.routines.filter((item) => item.botId !== id);
  });
  return NextResponse.json({ ok: true });
}

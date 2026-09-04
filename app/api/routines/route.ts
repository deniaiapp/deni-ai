import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { nextCron } from "@/lib/agent";
import { createId, nowIso } from "@/lib/ids";
import { mutateStore, readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const store = await readStore(userId);
  return NextResponse.json({ routines: store.routines });
}

export async function POST(req: Request) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const body = (await req.json()) as {
    botId?: string;
    threadId?: string;
    name?: string;
    instructions?: string;
    cron?: string;
    enabled?: boolean;
    id?: string;
  };

  if (body.id) {
    const routine = await mutateStore(userId, (store) => {
      const item = store.routines.find((entry) => entry.id === body.id);
      if (!item) return null;
      if (typeof body.enabled === "boolean") item.enabled = body.enabled;
      if (body.cron) item.cron = body.cron;
      if (body.instructions) item.instructions = body.instructions;
      if (item.enabled) item.nextRunAt = nextCron(item.cron, store.config.timezone);
      return item;
    });
    if (!routine) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ routine });
  }

  if (!body.botId || !body.threadId || !body.name || !body.cron || !body.instructions) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  const store = await readStore(userId);
  const routine = await mutateStore(userId, (s) => {
    const created = {
      id: createId("rtn"),
      botId: body.botId!,
      threadId: body.threadId!,
      name: body.name!,
      instructions: body.instructions!,
      cron: body.cron!,
      timezone: s.config.timezone,
      enabled: true,
      lastRunAt: null,
      nextRunAt: nextCron(body.cron!, store.config.timezone),
      lastError: null,
      createdAt: nowIso(),
    };
    s.routines.push(created);
    return created;
  });
  return NextResponse.json({ routine });
}

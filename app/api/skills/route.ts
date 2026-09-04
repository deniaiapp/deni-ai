import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { createId, nowIso } from "@/lib/ids";
import { mutateStore, readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const store = await readStore(userId);
  return NextResponse.json({ skills: store.skills });
}

export async function POST(req: Request) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const body = (await req.json()) as { name?: string; body?: string };
  if (!body.name?.trim() || !body.body?.trim()) {
    return NextResponse.json({ error: "name and body required" }, { status: 400 });
  }
  const skill = await mutateStore(userId, (store) => {
    const created = {
      id: createId("skill"),
      name: body.name!.trim(),
      body: body.body!.trim(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    store.skills.push(created);
    return created;
  });
  return NextResponse.json({ skill });
}

import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { getHandoff, listHandoffs } from "@/lib/handoff";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const run = await getHandoff(userId, id);
    if (!run) return NextResponse.json({ error: "handoff not found" }, { status: 404 });
    return NextResponse.json(run);
  }
  return NextResponse.json({ handoffs: await listHandoffs(userId) });
}

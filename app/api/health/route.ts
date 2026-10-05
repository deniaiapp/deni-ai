import { NextResponse } from "next/server";
import { rawRows } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await rawRows("select 1");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}

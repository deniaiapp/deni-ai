import { NextResponse } from "next/server";
import { sqlClient } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await sqlClient`select 1`;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}

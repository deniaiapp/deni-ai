import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { deleteAccount, exportAccount } from "@/lib/account";
import { limitOrResponse } from "@/lib/rate-limit";
import { getExtracted } from "next-intl/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const limited = await limitOrResponse(userId, "account-export", 10);
  if (limited) return limited;
  const payload = await exportAccount(userId);
  return NextResponse.json(payload);
}

export async function DELETE() {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const limited = await limitOrResponse(userId, "account-delete", 5, 60 * 60_000);
  if (limited) return limited;
  try {
    await deleteAccount(userId);
  } catch {
    return NextResponse.json(
      { error: t("Could not finish deleting your account. Please try again.") },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true });
}

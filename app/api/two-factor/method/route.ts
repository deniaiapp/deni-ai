import { NextResponse } from "next/server";
import { getExtracted } from "next-intl/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { getAuthSession } from "@/lib/auth";
import { limitOrResponse } from "@/lib/rate-limit";
import { emailOtpAvailable } from "@/lib/two-factor-delivery";

export const dynamic = "force-dynamic";

// Picks email codes during setup. Two-factor turns on only after the first emailed code is
// verified, so an address that cannot receive mail does not lock the account.
export async function POST(request: Request) {
  const t = await getExtracted();
  const session = await getAuthSession();
  if (!session?.user.id) {
    return NextResponse.json({ error: t("Unauthorized") }, { status: 401 });
  }
  if (session.user.twoFactorEnabled) {
    return NextResponse.json(
      { error: t("Turn off two-factor authentication before choosing another method.") },
      { status: 409 },
    );
  }
  const limited = await limitOrResponse(session.user.id, "two-factor-method", 10, 15 * 60_000);
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as { method?: unknown } | null;
  if (body?.method !== "email") {
    return NextResponse.json({ error: t("Choose email.") }, { status: 400 });
  }
  if (!emailOtpAvailable()) {
    return NextResponse.json(
      { error: t("This sign-in method is not available right now.") },
      { status: 400 },
    );
  }

  await db.update(user).set({ twoFactorMethod: "email" }).where(eq(user.id, session.user.id));
  return NextResponse.json({ ok: true });
}

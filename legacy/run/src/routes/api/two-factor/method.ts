import { createFileRoute } from "@tanstack/react-router";
import { getExtracted } from "@/i18n/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { getAuthSession } from "@/lib/auth";
import { limitOrResponse } from "@/lib/billing/rate-limit";
import { emailOtpAvailable } from "@/lib/auth/two-factor-delivery";

// Picks email codes during setup. Two-factor turns on only after the first emailed code is
// verified, so an address that cannot receive mail does not lock the account.
async function POST({ request }: { request: Request }) {
  const t = await getExtracted();
  const session = await getAuthSession();
  if (!session?.user.id) {
    return Response.json({ error: t("Unauthorized") }, { status: 401 });
  }
  if (session.user.twoFactorEnabled) {
    return Response.json(
      { error: t("Turn off two-factor authentication before choosing another method.") },
      { status: 409 },
    );
  }
  const limited = await limitOrResponse(session.user.id, "two-factor-method", 10, 15 * 60_000);
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as { method?: unknown } | null;
  if (body?.method !== "email") {
    return Response.json({ error: t("Choose email.") }, { status: 400 });
  }
  if (!emailOtpAvailable()) {
    return Response.json(
      { error: t("This sign-in method is not available right now.") },
      { status: 400 },
    );
  }

  await db.update(user).set({ twoFactorMethod: "email" }).where(eq(user.id, session.user.id));
  return Response.json({ ok: true });
}

export const Route = createFileRoute("/api/two-factor/method")({
  server: { handlers: { POST } },
});

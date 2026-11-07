import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/auth/api";
import { deleteAccount, exportAccount } from "@/lib/auth/account";
import { limitOrResponse } from "@/lib/billing/rate-limit";
import { getExtracted } from "@/i18n/server";

async function GET() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const limited = await limitOrResponse(userId, "account-export", 10);
  if (limited) return limited;
  const payload = await exportAccount(userId);
  return Response.json(payload);
}

async function DELETE() {
  const t = await getExtracted();
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const limited = await limitOrResponse(userId, "account-delete", 5, 60 * 60_000);
  if (limited) return limited;
  try {
    await deleteAccount(userId);
  } catch {
    return Response.json(
      { error: t("Could not finish deleting your account. Please try again.") },
      { status: 503 },
    );
  }
  return Response.json({ ok: true });
}

export const Route = createFileRoute("/api/account")({
  server: { handlers: { GET, DELETE } },
});

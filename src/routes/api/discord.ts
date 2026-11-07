import { createFileRoute } from "@tanstack/react-router";
import { getApiUserId, unauthorizedResponse } from "@/lib/auth/api";
import { createDiscordLinkCode, getDiscordLinkByUser, unlinkDiscord } from "@/lib/discord/link";
import { limitOrResponse } from "@/lib/billing/rate-limit";
import { getLocale } from "@/i18n/server";

const configured = () => Boolean(process.env.DISCORD_BOT_TOKEN?.trim());

async function GET() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const link = await getDiscordLinkByUser(userId);
  return Response.json(
    {
      configured: configured(),
      inviteUrl: process.env.DISCORD_INVITE_URL?.trim() || null,
      link: link ? { username: link.discordUsername, linkedAt: link.createdAt } : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Issue a one-time code the user sends to the bot from their own Discord account. */
async function POST() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  if (!configured()) return Response.json({ error: "Discord is not configured" }, { status: 503 });
  const limited = await limitOrResponse(userId, "discord-code", 5);
  if (limited) return limited;
  return Response.json(await createDiscordLinkCode(userId, await getLocale()), { headers: { "Cache-Control": "no-store" } });
}

async function DELETE() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  await unlinkDiscord(userId);
  return Response.json({ link: null });
}

export const Route = createFileRoute("/api/discord")({
  server: { handlers: { GET, POST, DELETE } },
});

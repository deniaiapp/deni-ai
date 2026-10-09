import { NextResponse } from "next/server";
import { getApiUserId, unauthorizedResponse } from "@/lib/api-auth";
import { createDiscordLinkCode, getDiscordLinkByUser, unlinkDiscord } from "@/lib/discord-link";
import { limitOrResponse } from "@/lib/rate-limit";
import { getLocale } from "next-intl/server";

export const dynamic = "force-dynamic";

const configured = () => Boolean(process.env.DISCORD_BOT_TOKEN?.trim());

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  const link = await getDiscordLinkByUser(userId);
  return NextResponse.json(
    {
      configured: configured(),
      inviteUrl: process.env.DISCORD_INVITE_URL?.trim() || null,
      link: link ? { username: link.discordUsername, linkedAt: link.createdAt } : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Issue a one-time code the user sends to the bot from their own Discord account. */
export async function POST() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  if (!configured()) return NextResponse.json({ error: "Discord is not configured" }, { status: 503 });
  const limited = await limitOrResponse(userId, "discord-code", 5);
  if (limited) return limited;
  return NextResponse.json(await createDiscordLinkCode(userId, await getLocale()), { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE() {
  const userId = await getApiUserId();
  if (!userId) return unauthorizedResponse();
  await unlinkDiscord(userId);
  return NextResponse.json({ link: null });
}

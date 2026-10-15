import "@tanstack/react-start/server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentJobs } from "@/db/schema";
import { getDiscordLinkByUser, getDiscordPrefs } from "./discord-link";
import { discordTranslator } from "./discord-i18n";
import { scrubServerPaths } from "./discord-text";
import type { Translate } from "./i18n-server";
import { reportError } from "./report";
import type { AgentJob, AppNotification } from "./types";

/**
 * Notifications DMed to the linked Discord account. This talks to Discord's REST API with
 * fetch instead of discord.js because lib/notifications.ts, which calls it, is also loaded by
 * the standalone worker and by every route that creates a notification.
 */

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_MESSAGE_LIMIT = 2_000;
const TITLE_LIMIT = 200;
const REQUEST_TIMEOUT_MS = 10_000;

// Work nobody is watching. Chat replies already reach the person in the web chat or inline in Discord.
const BACKGROUND_KINDS = new Set<AgentJob["kind"]>(["routine", "retry", "handoff"]);

export function isBackgroundJobKind(kind: string): boolean {
  return BACKGROUND_KINDS.has(kind as AgentJob["kind"]);
}

// DM channel per Discord user, so each push costs one request instead of two.
const dmChannels = new Map<string, string>();

function botToken() {
  return process.env.DISCORD_BOT_TOKEN?.trim() || "";
}

/** The web app's address. lib/discord-ui.ts has the same helper but imports discord.js. */
function appLink() {
  return (process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");
}

/** Bold title, body, and a link to the app, within Discord's 2,000 characters. */
export function formatDiscordNotification(notification: Pick<AppNotification, "title" | "body">, tr: Translate, url = appLink()) {
  const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text);
  const title = `**${clip(notification.title.replace(/\s+/g, " ").trim(), TITLE_LIMIT)}**`;
  const footer = url ? `\n\n${tr("Open the app: {url}", { url })}` : "";
  const room = DISCORD_MESSAGE_LIMIT - title.length - footer.length - 1;
  const body = scrubServerPaths(notification.body).trim();
  return `${title}${body ? `\n${clip(body, room)}` : ""}${footer}`;
}

async function discordRequest(path: string, body: unknown) {
  return fetch(`${DISCORD_API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bot ${botToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function dmChannelId(discordUserId: string) {
  const cached = dmChannels.get(discordUserId);
  if (cached) return cached;
  const response = await discordRequest("/users/@me/channels", { recipient_id: discordUserId });
  if (!response.ok) throw new Error(`Discord DM channel request failed with HTTP ${response.status}`);
  const { id } = (await response.json()) as { id?: unknown };
  if (typeof id !== "string" || !id) throw new Error("Discord did not return a DM channel");
  dmChannels.set(discordUserId, id);
  return id;
}

/** Send one DM from the bot. False when there is no bot token or Discord refused; never throws. */
export async function sendDiscordDm(discordUserId: string, content: string): Promise<boolean> {
  if (!botToken()) return false;
  try {
    const channelId = await dmChannelId(discordUserId);
    // No mentions: the text may quote model output, which must not ping anyone.
    const response = await discordRequest(`/channels/${channelId}/messages`, { content, allowed_mentions: { parse: [] } });
    if (!response.ok) {
      dmChannels.delete(discordUserId);
      throw new Error(`Discord message request failed with HTTP ${response.status}`);
    }
    return true;
  } catch (error) {
    reportError(error, "discord push");
    return false;
  }
}

async function jobKind(userId: string, jobId: string) {
  const [row] = await db
    .select({ kind: agentJobs.kind })
    .from(agentJobs)
    .where(and(eq(agentJobs.userId, userId), eq(agentJobs.id, jobId)))
    .limit(1);
  return row?.kind ?? null;
}

/**
 * DM a stored notification to the user's linked Discord account when it comes from background
 * work and they have not turned notifications off. Resolves to whether a DM was sent; never throws.
 */
export async function pushNotificationToDiscord(userId: string, notification: Pick<AppNotification, "jobId" | "title" | "body">): Promise<boolean> {
  if (!botToken() || !notification.jobId) return false;
  try {
    const kind = await jobKind(userId, notification.jobId);
    if (!kind || !isBackgroundJobKind(kind)) return false;
    const link = await getDiscordLinkByUser(userId);
    if (!link || !(await getDiscordPrefs(userId)).notify) return false;
    return await sendDiscordDm(link.discordUserId, formatDiscordNotification(notification, discordTranslator(link.locale)));
  } catch (error) {
    reportError(error, "discord push");
    return false;
  }
}

/** Forget cached DM channels. For tests. */
export function resetDiscordPushForTests() {
  dmChannels.clear();
}

import "server-only";

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  escapeMarkdown,
  type MessageActionRowComponentBuilder,
  time,
  TimestampStyles,
} from "discord.js";
import { getDiscordPrefs, setDiscordPrefs } from "../discord-link";
import {
  bulletList,
  customId,
  type DiscordFeature,
  dmCommand,
  MESSAGE_LIMIT,
  respond,
  type Translate,
  truncate,
  updateMessage,
} from "../discord-ui";
import { listNotifications, markAllNotificationsRead } from "../notifications";
import type { AppNotification } from "../types";

/** Whether background work is DMed here (lib/discord-push.ts sends it), and the app's inbox. */

const PREFIX = "nt";
const INBOX_FETCHED = 100;
const BODY_SHOWN = 300;

function whatIsSent(tr: Translate) {
  return tr(
    "What is sent: results of work that runs while you are away (routines, retried tasks, and handoffs), including when it fails, needs your approval, or needs your help on the computer. Replies to messages you send here arrive in this chat either way.",
  );
}

async function setNotify(userId: string, notify: boolean, tr: Translate) {
  await setDiscordPrefs(userId, { notify });
  return notify
    ? `${tr("Notifications are on.")}\n${whatIsSent(tr)}`
    : tr("Notifications are off. You still find them in the app and with /inbox. Turn them back on with /notify on.");
}

async function notifyStatus(userId: string, tr: Translate) {
  const { notify } = await getDiscordPrefs(userId);
  return notify
    ? `${tr("Notifications are on.")}\n${whatIsSent(tr)}\n${tr("Turn them off with /notify off.")}`
    : `${tr("Notifications are off. You still find them in the app and with /inbox. Turn them back on with /notify on.")}\n${whatIsSent(tr)}`;
}

function inboxEntry(item: Pick<AppNotification, "title" | "body" | "createdAt">) {
  const at = new Date(item.createdAt);
  const when = Number.isFinite(at.getTime()) ? ` · ${time(at, TimestampStyles.RelativeTime)}` : "";
  const body = truncate(item.body.replace(/\s+/g, " ").trim(), BODY_SHOWN);
  return `**${escapeMarkdown(truncate(item.title, 200))}**${when}${body ? `\n  ${body}` : ""}`;
}

/** Unread notifications, newest first, with Mark all read under them. */
async function inbox(userId: string, tr: Translate) {
  const unread = await listNotifications(userId, { unreadOnly: true, limit: INBOX_FETCHED });
  if (!unread.length) return { content: tr("No unread notifications."), components: [] };
  const header = `**${tr("Unread notifications")}**`;
  const list = bulletList(unread.map(inboxEntry), tr, "", MESSAGE_LIMIT - header.length - 100);
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(customId(PREFIX, "readall")).setLabel(tr("Mark all read")).setStyle(ButtonStyle.Secondary),
  );
  return { content: `${header}\n${list}`, components: [row] };
}

export const feature: DiscordFeature = {
  prefix: PREFIX,
  commands: [
    dmCommand("notify", "Choose whether background work is reported here", "バックグラウンドの作業をここで知らせるかを選択")
      .addSubcommand((sub) => sub.setName("on").setDescription("DM me when background work ends or needs me").setDescriptionLocalization("ja", "バックグラウンドの作業が終わったときや対応が必要なときに DM する"))
      .addSubcommand((sub) => sub.setName("off").setDescription("Stop these DMs").setDescriptionLocalization("ja", "この DM を止める"))
      .addSubcommand((sub) => sub.setName("status").setDescription("Show whether notifications are on and what is sent").setDescriptionLocalization("ja", "通知のオン・オフと送られる内容を表示")),
    dmCommand("inbox", "Show unread notifications", "未読の通知を表示"),
  ],
  async command(interaction, { link, tr }) {
    if (interaction.commandName === "inbox") {
      await respond(interaction, await inbox(link.userId, tr));
      return;
    }
    const sub = interaction.options.getSubcommand();
    if (sub === "on" || sub === "off") await respond(interaction, await setNotify(link.userId, sub === "on", tr));
    else await respond(interaction, await notifyStatus(link.userId, tr));
  },
  async component(interaction, { link, tr }, args) {
    if (!interaction.isButton() || args[0] !== "readall") return;
    await interaction.deferUpdate();
    await markAllNotificationsRead(link.userId);
    // Keep the list visible so the person still sees what they just marked.
    const note = tr("Marked all notifications as read.");
    await updateMessage(interaction, `${truncate(interaction.message.content, MESSAGE_LIMIT - note.length - 2)}\n\n${note}`);
  },
};

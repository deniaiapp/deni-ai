import "server-only";

import {
  ActionRowBuilder,
  ApplicationIntegrationType,
  type AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  InteractionContextType,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type MessageActionRowComponentBuilder,
  type ModalSubmitInteraction,
  type RepliableInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  SlashCommandBuilder,
  type StringSelectMenuInteraction,
} from "discord.js";
import type { DiscordLink } from "./discord-link";
import type { Translate } from "./i18n-server";

export type { Translate };

/**
 * Shared building blocks for the Discord commands. Each area of the app (teammates, skills,
 * files, ...) is a DiscordFeature in lib/discord-features/, registered in lib/discord-bot.ts.
 * The router looks up the sender's link before calling a feature, so a handler only ever
 * touches ctx.link.userId's workspace.
 */

export const MESSAGE_LIMIT = 1_900;

export type FeatureContext = {
  link: DiscordLink;
  /** Translator for the link's language. Keys are English text; Japanese lives in lib/i18n-ja.ts. */
  tr: Translate;
};

export type ComponentInteraction = ButtonInteraction | StringSelectMenuInteraction;

export type DiscordFeature = {
  /** Slash commands this feature owns. Build them with dmCommand(). */
  commands: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody }[];
  /** Custom id prefix for this feature's buttons, select menus, and modals. Short and unique. */
  prefix?: string;
  /**
   * True when this invocation answers with a modal. Those must be the first response, so the
   * router does not defer them; every other command is deferred before the link lookup.
   */
  opensModal?: (interaction: ChatInputCommandInteraction) => boolean;
  command?: (interaction: ChatInputCommandInteraction, ctx: FeatureContext) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction, ctx: FeatureContext) => Promise<void>;
  /** args are the custom id parts after the prefix. Not acknowledged yet: deferUpdate or show a modal. */
  component?: (interaction: ComponentInteraction, ctx: FeatureContext, args: string[]) => Promise<void>;
  modal?: (interaction: ModalSubmitInteraction, ctx: FeatureContext, args: string[]) => Promise<void>;
};

/** A slash command that only exists in the bot's DMs, with an optional Japanese description. */
export function dmCommand(name: string, description: string, ja?: string) {
  const builder = new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setContexts(InteractionContextType.BotDM)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall);
  return ja ? builder.setDescriptionLocalization("ja", ja) : builder;
}

/** prefix:arg:arg. Discord caps custom ids at 100 characters, so keep args to ids. */
export function customId(prefix: string, ...args: string[]) {
  const id = [prefix, ...args].join(":");
  if (id.length > 100) throw new Error(`custom id too long: ${id.slice(0, 40)}…`);
  return id;
}

export function parseCustomId(value: string) {
  const [prefix = "", ...args] = value.split(":");
  return { prefix, args };
}

/** Split on paragraph, line, then word boundaries so a long reply never exceeds Discord's limit. */
export function splitForDiscord(text: string, limit = MESSAGE_LIMIT) {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(" "));
    const at = cut > limit / 2 ? cut : limit;
    chunks.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export type Reply =
  | string
  | { content?: string; files?: AttachmentBuilder[]; components?: ActionRowBuilder<MessageActionRowComponentBuilder>[] };

/**
 * Answer an interaction whether or not it was deferred. Long text is split over follow-up
 * messages; files and components go on the last one so buttons sit under the full text.
 */
export async function respond(interaction: RepliableInteraction, reply: Reply) {
  const payload = typeof reply === "string" ? { content: reply } : reply;
  const parts = splitForDiscord(payload.content ?? "");
  if (!parts.length) parts.push("");
  for (const [index, content] of parts.entries()) {
    const last = index === parts.length - 1;
    const message = {
      content,
      files: last ? (payload.files ?? []) : [],
      components: last ? (payload.components ?? []) : [],
    };
    if (index === 0 && (interaction.deferred || interaction.replied)) await interaction.editReply(message);
    else if (index === 0) await interaction.reply(message);
    else await interaction.followUp(message);
  }
}

/** Replace the message a button or select menu sits on, dropping its components by default. */
export async function updateMessage(
  interaction: ComponentInteraction,
  content: string,
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [],
) {
  const shown = truncate(content, MESSAGE_LIMIT);
  if (interaction.deferred || interaction.replied) await interaction.editReply({ content: shown, components });
  else await interaction.update({ content: shown, components });
}

/** Confirm and Cancel for a destructive action. The router answers prefix:cancel itself. */
export function confirmRow(prefix: string, args: string[], tr: Translate, label?: string) {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(customId(prefix, ...args)).setLabel(label ?? tr("Delete")).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(customId(prefix, "cancel")).setLabel(tr("Cancel")).setStyle(ButtonStyle.Secondary),
  );
}

/** The web app's address, for the few things Discord cannot do (OAuth, live browser control). */
export function appUrl(path = "/") {
  const base = (process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");
  return base ? `${base}${path.startsWith("/") ? path : `/${path}`}` : "";
}

/** "Open the app" with a link when the address is configured. */
export function inApp(tr: Translate, path = "/") {
  const url = appUrl(path);
  return url ? tr("Open the app: {url}", { url }) : tr("Open the app to do this.");
}

export function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

/** Text inside a code block, with fences neutralized so it cannot break out. */
export function codeBlock(text: string, language = "") {
  return `\`\`\`${language}\n${text.replace(/```/g, "'''")}\n\`\`\``;
}

/** A bullet list that fits one message, ending with "+N more" when it does not. */
export function bulletList(items: string[], tr: Translate, empty: string, limit = MESSAGE_LIMIT - 100) {
  if (!items.length) return empty;
  const lines: string[] = [];
  let used = 0;
  for (const [index, item] of items.entries()) {
    const line = `• ${item}`;
    if (used + line.length + 1 > limit) {
      lines.push(tr("+{count} more", { count: items.length - index }));
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

/** Up to 25 autocomplete choices whose label contains the typed text. */
export function choices<T>(items: T[], query: string, label: (item: T) => string, value: (item: T) => string) {
  const wanted = query.trim().toLowerCase();
  return items
    .filter((item) => !wanted || label(item).toLowerCase().includes(wanted))
    .slice(0, 25)
    .map((item) => ({ name: truncate(label(item), 100), value: value(item).slice(0, 100) }));
}

/** Find by id first (what autocomplete submits), then by case-insensitive name. */
export function findByIdOrName<T extends { id: string; name: string }>(items: T[], typed: string | null | undefined) {
  const value = typed?.trim();
  if (!value) return undefined;
  return items.find((item) => item.id === value) ?? items.find((item) => item.name.toLowerCase() === value.toLowerCase());
}

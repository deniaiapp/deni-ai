import "@tanstack/react-start/server-only";

import {
  ActionRowBuilder,
  type AutocompleteInteraction,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Message,
  type ModalSubmitInteraction,
  type RepliableInteraction,
} from "discord.js";
import { saveDiscordAttachments, type IncomingAttachment } from "./attachments";
import { features } from "./features";
import {
  describeLinkedAccount,
  getDiscordLinkByDiscordId,
  looksLikeLinkCode,
  redeemDiscordLinkCode,
  talkToTeammate,
  unlinkDiscord,
  type DiscordLink,
} from "./link";
import {
  discordComponentId,
  parseDiscordComponentId,
  resetDiscordConversation,
  runDiscordApproval,
  runDiscordConversation,
  type TurnOutcome,
} from "./turn";
import {
  type ComponentInteraction,
  dmCommand,
  type DiscordFeature,
  type FeatureContext,
  MESSAGE_LIMIT,
  parseCustomId,
  respond,
  splitForDiscord,
  updateMessage,
} from "./ui";
import { discordErrorText, discordTranslator as translatorFor } from "./i18n";
import type { Translate } from "@/i18n/standalone";
import { assertRateLimit, RateLimitError } from "../billing/rate-limit";
import { reportError } from "../report";
import { joinRunMode, parseRunMode, RUN_MODES, splitRunMode, type RunLevel } from "../agent/model";
import { mutateStore, readStore } from "../data/store";

export { splitForDiscord } from "./ui";

const TYPING_INTERVAL_MS = 8_000;

const g = globalThis as typeof globalThis & { __deniDiscord?: Client };

type Sendable = {
  send(options: string | { content: string; components?: ActionRowBuilder<ButtonBuilder>[] }): Promise<unknown>;
  sendTyping(): Promise<unknown>;
};

// Discord rejects messages over 2,000 characters; leave room for the buttons' row.
const APPROVAL_LIMIT = MESSAGE_LIMIT + 90;

function approvalButtons(outcome: Extract<TurnOutcome, { kind: "approval" }>, locale: string) {
  const tr = translatorFor(locale);
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(discordComponentId("approve", outcome.jobId, outcome.round)).setLabel(tr("Approve")).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(discordComponentId("deny", outcome.jobId, outcome.round)).setLabel(tr("Deny")).setStyle(ButtonStyle.Danger),
    ),
  ];
}

/**
 * Approve and Deny answer every request of the round, so the buttons only appear when all of
 * it fits in the message. Otherwise nothing is cut silently: the person is sent to the app.
 */
export function approvalPrompt(outcome: Extract<TurnOutcome, { kind: "approval" }>, locale: string) {
  const actions = outcome.pending.map((item) => `**${item.tool}**\n\`\`\`\n${item.summary}\n\`\`\``).join("\n");
  const content = `${outcome.text}\n${actions}`;
  if (!outcome.pending.some((item) => item.truncated) && content.length <= APPROVAL_LIMIT) {
    return { content, components: approvalButtons(outcome, locale) };
  }
  const tools = [...new Set(outcome.pending.map((item) => item.tool))].join(", ").slice(0, 500);
  const note = translatorFor(locale)("Part of this request is too long to show in Discord. Open the app to review and answer it.");
  return { content: `${outcome.text}\n**${tools}**\n${note}`, components: [] as ActionRowBuilder<ButtonBuilder>[] };
}

/** In a group several teammates answer, so each reply is labeled with who wrote it. */
async function deliver(channel: Sendable, outcome: TurnOutcome, locale: string, labeled = false) {
  if (outcome.kind === "none") return;
  if (outcome.kind === "approval") {
    await channel.send(approvalPrompt(outcome, locale));
    return;
  }
  const text = labeled && (outcome.kind === "reply" || outcome.kind === "takeover") ? `**${outcome.botName}**\n${outcome.text}` : outcome.text;
  for (const chunk of splitForDiscord(text)) await channel.send(chunk);
}

/** Keep Discord's "typing…" indicator alive while a long agent run is in flight. */
async function withTyping<T>(channel: Sendable, work: () => Promise<T>) {
  const ping = () => void channel.sendTyping().catch(() => undefined);
  ping();
  const timer = setInterval(ping, TYPING_INTERVAL_MS);
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}

// One conversation at a time per Discord user, so quick follow-ups queue instead of racing.
const queues = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
  queues.set(key, next);
  void next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  }).catch(() => undefined);
  return next;
}

function bilingual(key: string, params?: Record<string, string | number>) {
  return `${translatorFor("en")(key, params)}\n${translatorFor("ja")(key, params)}`;
}

const LINK_FIRST = "Link your account first: open the app, go to Discord settings, create a code, and send it to me here.";

async function tryLink(code: string, discord: { id: string; username: string }) {
  try {
    await assertRateLimit(`discord:${discord.id}`, "discord-link", 5, 10 * 60_000);
  } catch (error) {
    if (error instanceof RateLimitError) return { ok: false as const, reason: "rate" as const };
    throw error;
  }
  const userId = await redeemDiscordLinkCode(code, discord);
  return userId ? { ok: true as const, userId } : { ok: false as const, reason: "invalid" as const };
}

/** Say which workspace account was linked, so a code obtained from someone else is noticed. */
async function linkedMessage(userId: string, discordId: string) {
  const [linked, account] = await Promise.all([getDiscordLinkByDiscordId(discordId), describeLinkedAccount(userId)]);
  return translatorFor(linked?.locale)("Linked to {account}. Send a message to talk to your teammate. If this is not your account, send /unlink.", { account });
}

/** Uploads per person: a burst limit and a daily one, counted per file before anything is downloaded. */
async function withinUploadLimit(userId: string) {
  try {
    await assertRateLimit(userId, "discord-upload", 10, 10 * 60_000);
    await assertRateLimit(userId, "discord-upload-day", 50, 24 * 60 * 60_000);
    return true;
  } catch (error) {
    if (error instanceof RateLimitError) return false;
    throw error;
  }
}

/** Files sent in a DM go to the workspace inbox; the teammate is told where they are. */
async function receiveAttachments(message: Message, link: DiscordLink, tr: Translate) {
  if (!message.attachments.size) return { note: "", notice: "" };
  const accepted: IncomingAttachment[] = [];
  const limited: string[] = [];
  for (const item of message.attachments.values()) {
    if (limited.length || !(await withinUploadLimit(link.userId))) limited.push(item.name);
    else accepted.push({ name: item.name, url: item.url, size: item.size, contentType: item.contentType });
  }
  const { saved, skipped } = await saveDiscordAttachments(link.userId, accepted);
  const named = (reasons: string[]) => skipped.filter((item) => reasons.includes(item.reason)).map((item) => item.name).join(", ");
  const notices = [
    named(["size", "count"]) ? tr("Could not save: {files}. Files must be 10 MB or smaller, at most 10 per message.", { files: named(["size", "count"]) }) : "",
    named(["download"]) ? tr("Could not download from Discord, so these were not saved: {files}. Send them again.", { files: named(["download"]) }) : "",
    limited.length ? tr("Upload limit reached, so these were not saved: {files}. Try again later.", { files: limited.join(", ") }) : "",
  ];
  const note = saved.length ? `\n\n[${tr("Attached files saved in the workspace")}: ${saved.join(", ")}]` : "";
  return { note, notice: notices.filter(Boolean).join("\n"), saved };
}

async function handleMessage(message: Message) {
  if (message.author.bot || message.guildId || !message.channel.isDMBased()) return;
  const channel = message.channel as unknown as Sendable;
  const text = message.content.trim();
  if (!text && !message.attachments.size) return;
  const link = await getDiscordLinkByDiscordId(message.author.id);
  if (!link) {
    if (text && looksLikeLinkCode(text)) {
      const result = await tryLink(text, { id: message.author.id, username: message.author.username });
      if (result.ok) {
        await channel.send(await linkedMessage(result.userId, message.author.id));
      } else {
        await channel.send(bilingual(result.reason === "rate" ? "Too many requests. Wait a moment and try again." : "That code is invalid or expired. Create a new one in the app."));
      }
      return;
    }
    await channel.send(bilingual(LINK_FIRST));
    return;
  }
  const tr = translatorFor(link.locale);
  // A message with only files runs no turn, so it is counted like a command instead.
  if (!text && !(await withinCommandLimit(message.author.id))) {
    await channel.send(tr("Too many requests. Wait a moment and try again."));
    return;
  }
  const attachments = await receiveAttachments(message, link, tr);
  if (attachments.notice) await channel.send(attachments.notice);
  if (!text) {
    // Files alone are only stored; the next message says what to do with them.
    if (attachments.saved?.length) await channel.send(tr("Saved to the workspace: {files}. Send a message to say what to do with them.", { files: attachments.saved.join(", ") }));
    return;
  }
  const result = await serialize(message.author.id, () =>
    withTyping(channel, () =>
      runDiscordConversation({ userId: link.userId, discordMessageId: message.id, text: `${text}${attachments.note}`, botId: link.botId, locale: link.locale }),
    ),
  );
  for (const outcome of result.outcomes) await deliver(channel, outcome, link.locale, Boolean(result.group));
}

async function handleApprovalButton(interaction: ButtonInteraction, parsed: NonNullable<ReturnType<typeof parseDiscordComponentId>>) {
  // Discord drops an interaction that is not acknowledged within 3 seconds, and the database may be remote.
  await interaction.deferUpdate();
  // The sender's own link decides whose workspace this touches, so another account's job is never found.
  const link = await getDiscordLinkByDiscordId(interaction.user.id);
  const tr = translatorFor(link?.locale);
  if (!link) {
    await interaction.editReply({ content: `${interaction.message.content}\n\n${bilingual("This approval is no longer pending.")}`, components: [] });
    return;
  }
  const channel = interaction.channel as unknown as Sendable;
  await interaction.editReply({
    content: `${interaction.message.content}\n\n${parsed.approved ? tr("Approved.") : tr("Denied.")}`,
    components: [],
  });
  const outcome = await serialize(interaction.user.id, () =>
    withTyping(channel, () =>
      runDiscordApproval({ userId: link.userId, jobId: parsed.jobId, round: parsed.round, approved: parsed.approved, locale: link.locale }),
    ),
  );
  await deliver(channel, outcome, link.locale);
}

function runModeParams(mode: ReturnType<typeof parseRunMode>, tr: Translate) {
  const { label, costMultiplier, effort } = RUN_MODES[mode];
  return {
    mode: `${label} (${effort})`,
    cost: tr("~{multiplier}× cost", { multiplier: costMultiplier }),
  };
}

/** The chat commands: who you talk to, how hard they think, and starting over. */
const core: DiscordFeature = {
  commands: [
    dmCommand("help", "List what you can do here", "ここでできることの一覧"),
    dmCommand("reset", "Start a new conversation with your teammate", "チームメイトとの会話をリセット"),
    dmCommand("teammate", "Show or choose the teammate you talk to", "話すチームメイトを表示・選択").addStringOption((option) =>
      option.setName("name").setDescription("Teammate name").setDescriptionLocalization("ja", "チームメイトの名前").setAutocomplete(true),
    ),
    dmCommand("model", "Show or choose the model family", "モデルを表示・選択").addStringOption((option) =>
      option.setName("family").setDescription("Run is faster and cheaper, Run+ is stronger").setDescriptionLocalization("ja", "Run は速く安い、Run+ はより強力").addChoices({ name: "Run", value: "run" }, { name: "Run+", value: "plus" }),
    ),
    dmCommand("effort", "Show or choose how hard the model thinks", "考える深さを表示・選択").addStringOption((option) =>
      option.setName("level").setDescription("Reasoning effort").setDescriptionLocalization("ja", "推論の深さ").addChoices({ name: "Default (medium)", value: "default" }, { name: "High", value: "high" }, { name: "xhigh", value: "xhigh" }, { name: "Max", value: "max" }),
    ),
    dmCommand("unlink", "Disconnect this Discord account", "この Discord アカウントの連携を解除"),
  ],
  async command(interaction, { link, tr }) {
    if (interaction.commandName === "help") {
      await respond(interaction, helpText(link.locale, tr));
      return;
    }
    if (interaction.commandName === "unlink") {
      await unlinkDiscord(link.userId);
      await respond(interaction, tr("Unlinked. This Discord account no longer reaches your workspace."));
      return;
    }
    if (interaction.commandName === "reset") {
      // Queued behind a reply in flight, so the divider lands after it instead of being refused.
      const content = await serialize(interaction.user.id, () => resetDiscordConversation({ userId: link.userId, botId: link.botId, locale: link.locale }));
      await respond(interaction, content);
      return;
    }
    if (interaction.commandName === "teammate") {
      const store = await readStore(link.userId);
      const typed = interaction.options.getString("name")?.trim();
      const wanted = typed?.toLowerCase();
      const group = store.discord?.threadId ? store.threads.find((item) => item.id === store.discord?.threadId && item.kind === "group") : undefined;
      const current = group ? undefined : (store.bots.find((bot) => bot.id === link.botId) ?? store.bots[0]);
      if (!wanted) {
        const list = store.bots.map((bot) => `${bot.id === current?.id ? "• **" : "• "}${bot.name}${bot.id === current?.id ? "**" : ""} — ${bot.job}`).join("\n");
        const header = group ? `${tr("Now talking in the group {name}.", { name: group.title })}\n` : "";
        await respond(interaction, `${header}${list || tr("Create a teammate in the app first, then message again.")}`);
        return;
      }
      // Autocomplete submits the teammate id; typed text is matched by name.
      const match = store.bots.find((bot) => bot.id === typed || bot.name.toLowerCase() === wanted);
      if (!match) {
        await respond(interaction, tr("No teammate with that name. Run /teammate to see the list."));
        return;
      }
      await talkToTeammate(link.userId, match.id);
      await respond(interaction, tr("Now talking to {name}.", { name: match.name }));
      return;
    }
    if (interaction.commandName === "model" || interaction.commandName === "effort") {
      // The run mode is the account's shared setting, so the web app and Discord stay in step.
      const picked = interaction.options.getString(interaction.commandName === "model" ? "family" : "level");
      const current = splitRunMode(parseRunMode((await readStore(link.userId)).config.runMode));
      if (picked) {
        const next = joinRunMode(
          interaction.commandName === "model" ? picked === "plus" : current.plus,
          interaction.commandName === "effort" ? (picked as RunLevel) : current.level,
        );
        await mutateStore(link.userId, (store) => {
          store.config.runMode = next;
        });
        await respond(interaction, tr("Now using {mode}. {cost}", runModeParams(next, tr)));
        return;
      }
      const mode = joinRunMode(current.plus, current.level);
      await respond(interaction, tr("Current setting: {mode}. {cost}", runModeParams(mode, tr)));
    }
  },
  /** Suggest teammates while typing /teammate. Only a linked account sees its own workspace's list. */
  async autocomplete(interaction, { link }) {
    const query = interaction.options.getFocused().trim().toLowerCase();
    const { bots } = await readStore(link.userId);
    await interaction.respond(
      bots
        .filter((bot) => !query || bot.name.toLowerCase().includes(query) || bot.job.toLowerCase().includes(query))
        .slice(0, 25)
        .map((bot) => ({ name: `${bot.name} — ${bot.job}`.slice(0, 100), value: bot.id.slice(0, 100) })),
    );
  },
};

const linkCommand = dmCommand("link", "Link this Discord account to your workspace", "この Discord アカウントをワークスペースに連携").addStringOption((option) =>
  option.setName("code").setDescription("Code from the app's Discord settings").setDescriptionLocalization("ja", "アプリの Discord 設定で作成したコード").setRequired(true),
);

const allFeatures = [core, ...features];

function featureForCommand(name: string) {
  return allFeatures.find((feature) => feature.commands.some((command) => command.name === name));
}

function featureForPrefix(prefix: string) {
  return prefix ? allFeatures.find((feature) => feature.prefix === prefix) : undefined;
}

/** Every command with its subcommands, described in the person's language. */
function helpText(locale: string, tr: Translate) {
  const describe = (item: { description: string; description_localizations?: Record<string, string | null> | null }) =>
    (locale === "ja" ? item.description_localizations?.ja : null) ?? item.description;
  const lines = [linkCommand, ...allFeatures.flatMap((feature) => feature.commands)].map((command) => {
    const json = command.toJSON();
    const subcommands = (json.options ?? []).filter((option) => option.type === 1);
    const head = `**/${json.name}** — ${describe(json)}`;
    return subcommands.length ? `${head}\n${subcommands.map((option) => `  · \`${option.name}\` ${describe(option)}`).join("\n")}` : head;
  });
  return `${lines.join("\n")}\n\n${tr("Any other message goes to your teammate. Files you attach are saved to the workspace.")}`;
}

function commandDefinitions() {
  return [linkCommand, ...allFeatures.flatMap((feature) => feature.commands)].map((command) => command.toJSON());
}

/** What the person may see of an error: never a server path from a file system message. */
export function publicErrorText(locale: string | undefined, error: unknown) {
  if ((error as { code?: unknown } | null)?.code === "ENOENT") return translatorFor(locale)("File not found");
  return discordErrorText(locale, error).slice(0, 500);
}

/** Tell the person what went wrong instead of letting Discord show "interaction failed". */
async function answerError(interaction: RepliableInteraction, locale: string | undefined, error: unknown) {
  reportError(error, "discord interaction");
  const content = translatorFor(locale)("Something went wrong: {error}", { error: publicErrorText(locale, error) || "error" });
  try {
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content });
    else await interaction.reply({ content });
  } catch {
    // The interaction may have expired; nothing else to do.
  }
}

/**
 * Commands, buttons, and form submits share one window per Discord account (a link maps one
 * account to one user), so a loop cannot flood the workspace. Keyed by the Discord id, it runs
 * alongside the link lookup and costs no extra round trip before the 3-second deadline.
 */
async function withinCommandLimit(discordUserId: string) {
  try {
    await assertRateLimit(`discord:${discordUserId}`, "discord-command", 60);
    return true;
  } catch (error) {
    if (error instanceof RateLimitError) return false;
    throw error;
  }
}

async function handleCommand(interaction: ChatInputCommandInteraction) {
  const feature = featureForCommand(interaction.commandName);
  // A modal must be the first answer; everything else is acknowledged before the database is read.
  if (!feature?.opensModal?.(interaction)) await interaction.deferReply();
  const discord = { id: interaction.user.id, username: interaction.user.username };
  const [link, allowed] = await Promise.all([getDiscordLinkByDiscordId(discord.id), withinCommandLimit(discord.id)]);
  const tr = translatorFor(link?.locale ?? interaction.locale?.split("-")[0]);
  try {
    if (interaction.commandName === "link") {
      const result = await tryLink(interaction.options.getString("code", true), discord);
      if (result.ok) await respond(interaction, await linkedMessage(result.userId, discord.id));
      else await respond(interaction, tr(result.reason === "rate" ? "Too many requests. Wait a moment and try again." : "That code is invalid or expired. Create a new one in the app."));
      return;
    }
    if (!link) {
      await respond(interaction, bilingual(LINK_FIRST));
      return;
    }
    if (!allowed) {
      await respond(interaction, tr("Too many requests. Wait a moment and try again."));
      return;
    }
    await feature?.command?.(interaction, { link, tr });
  } catch (error) {
    await answerError(interaction, link?.locale, error);
  }
}

async function handleAutocomplete(interaction: AutocompleteInteraction) {
  const link = await getDiscordLinkByDiscordId(interaction.user.id);
  const feature = featureForCommand(interaction.commandName);
  if (!link || !feature?.autocomplete) {
    await interaction.respond([]);
    return;
  }
  await feature.autocomplete(interaction, { link, tr: translatorFor(link.locale) });
}

async function handleComponent(interaction: ComponentInteraction) {
  if (interaction.guildId || !interaction.channel?.isDMBased()) return;
  if (interaction.isButton()) {
    const approval = parseDiscordComponentId(interaction.customId);
    if (approval) {
      await handleApprovalButton(interaction, approval);
      return;
    }
  }
  const { prefix, args } = parseCustomId(interaction.customId);
  const feature = featureForPrefix(prefix);
  if (!feature?.component) return;
  const [link, allowed] = await Promise.all([getDiscordLinkByDiscordId(interaction.user.id), withinCommandLimit(interaction.user.id)]);
  if (!link) {
    await updateMessage(interaction, `${interaction.message.content}\n\n${bilingual(LINK_FIRST)}`);
    return;
  }
  const ctx: FeatureContext = { link, tr: translatorFor(link.locale) };
  if (!allowed) {
    await interaction.reply({ content: ctx.tr("Too many requests. Wait a moment and try again."), flags: MessageFlags.Ephemeral });
    return;
  }
  try {
    if (args[0] === "cancel") {
      await updateMessage(interaction, `${interaction.message.content}\n\n${ctx.tr("Cancelled.")}`);
      return;
    }
    await feature.component(interaction, ctx, args);
  } catch (error) {
    await answerError(interaction, link.locale, error);
  }
}

async function handleModal(interaction: ModalSubmitInteraction) {
  if (interaction.guildId) return;
  const { prefix, args } = parseCustomId(interaction.customId);
  const feature = featureForPrefix(prefix);
  if (!feature?.modal) return;
  const [link, allowed] = await Promise.all([getDiscordLinkByDiscordId(interaction.user.id), withinCommandLimit(interaction.user.id)]);
  if (!link) {
    await interaction.reply({ content: bilingual(LINK_FIRST) });
    return;
  }
  const ctx: FeatureContext = { link, tr: translatorFor(link.locale) };
  if (!allowed) {
    await interaction.reply({ content: ctx.tr("Too many requests. Wait a moment and try again."), flags: MessageFlags.Ephemeral });
    return;
  }
  try {
    await feature.modal(interaction, ctx, args);
  } catch (error) {
    await answerError(interaction, link.locale, error);
  }
}

function guard<T extends unknown[]>(context: string, handler: (...args: T) => Promise<void>) {
  return (...args: T) => {
    handler(...args).catch((error) => {
      console.error(`[deni discord] ${context}`, error);
      reportError(error, `discord ${context}`);
    });
  };
}

/** Connect the shared bot to Discord's gateway. Run on the one instance that owns the scheduler. */
export function startDiscordBot() {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token || g.__deniDiscord) return;
  const client = new Client({
    intents: [GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel, Partials.Message],
  });
  g.__deniDiscord = client;
  client.once(Events.ClientReady, (ready) => {
    console.info(`[deni discord] connected as ${ready.user.tag}`);
    ready.application.commands.set(commandDefinitions()).catch((error) => reportError(error, "discord commands"));
  });
  client.on(Events.MessageCreate, guard("message", handleMessage));
  client.on(
    Events.InteractionCreate,
    guard("interaction", async (interaction) => {
      if (interaction.isAutocomplete()) await handleAutocomplete(interaction);
      else if (interaction.isChatInputCommand()) await handleCommand(interaction);
      else if (interaction.isButton() || interaction.isStringSelectMenu()) await handleComponent(interaction);
      else if (interaction.isModalSubmit()) await handleModal(interaction);
    }),
  );
  client.on(Events.Error, (error) => reportError(error, "discord client"));
  client.login(token).catch((error) => {
    g.__deniDiscord = undefined;
    reportError(error, "discord login");
  });
}

/** Command names and help text, exported for tests. */
export const discordCommandsForTests = { commandDefinitions, helpText };

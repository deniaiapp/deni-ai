import "server-only";

import {
  ActionRowBuilder,
  type AutocompleteInteraction,
  ApplicationIntegrationType,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  InteractionContextType,
  Partials,
  SlashCommandBuilder,
  type SlashCommandOptionsOnlyBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Message,
} from "discord.js";
import {
  describeLinkedAccount,
  getDiscordLinkByDiscordId,
  looksLikeLinkCode,
  redeemDiscordLinkCode,
  setDiscordLinkBot,
  unlinkDiscord,
} from "./discord-link";
import {
  discordComponentId,
  parseDiscordComponentId,
  runDiscordApproval,
  runDiscordMessage,
  type TurnOutcome,
} from "./discord-turn";
import { translatorFor } from "./i18n-server";
import { assertRateLimit, RateLimitError } from "./rate-limit";
import { reportError } from "./report";
import { joinRunMode, parseRunMode, RUN_MODES, splitRunMode, type RunLevel } from "./model";
import { mutateStore, readStore } from "./store";

const MESSAGE_LIMIT = 1_900;
const TYPING_INTERVAL_MS = 8_000;

const g = globalThis as typeof globalThis & { __deniDiscord?: Client };

type Sendable = {
  send(options: string | { content: string; components?: ActionRowBuilder<ButtonBuilder>[] }): Promise<unknown>;
  sendTyping(): Promise<unknown>;
};

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

async function deliver(channel: Sendable, outcome: TurnOutcome, locale: string) {
  if (outcome.kind === "none") return;
  if (outcome.kind === "approval") {
    await channel.send(approvalPrompt(outcome, locale));
    return;
  }
  for (const chunk of splitForDiscord(outcome.text)) await channel.send(chunk);
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

async function handleMessage(message: Message) {
  if (message.author.bot || message.guildId || !message.channel.isDMBased()) return;
  const channel = message.channel as unknown as Sendable;
  const text = message.content.trim();
  if (!text) {
    if (message.attachments.size) await channel.send(bilingual("Attachments are not supported in Discord yet. Send your request as text."));
    return;
  }
  const link = await getDiscordLinkByDiscordId(message.author.id);
  if (!link) {
    if (looksLikeLinkCode(text)) {
      const result = await tryLink(text, { id: message.author.id, username: message.author.username });
      if (result.ok) {
        await channel.send(await linkedMessage(result.userId, message.author.id));
      } else {
        await channel.send(bilingual(result.reason === "rate" ? "Too many requests. Wait a moment and try again." : "That code is invalid or expired. Create a new one in the app."));
      }
      return;
    }
    await channel.send(bilingual("Link your account first: open the app, go to Discord settings, create a code, and send it to me here."));
    return;
  }
  const outcome = await serialize(message.author.id, () =>
    withTyping(channel, () =>
      runDiscordMessage({ userId: link.userId, discordMessageId: message.id, text, botId: link.botId, locale: link.locale }),
    ),
  );
  await deliver(channel, outcome, link.locale);
}

async function handleButton(interaction: ButtonInteraction) {
  const parsed = parseDiscordComponentId(interaction.customId);
  if (!parsed || interaction.guildId || !interaction.channel?.isDMBased()) return;
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

async function handleCommand(interaction: ChatInputCommandInteraction) {
  // Acknowledge first: the lookups below can outlast Discord's 3 second window on a remote database.
  await interaction.deferReply();
  const discord = { id: interaction.user.id, username: interaction.user.username };
  const link = await getDiscordLinkByDiscordId(discord.id);
  const tr = translatorFor(link?.locale ?? interaction.locale?.split("-")[0]);
  if (interaction.commandName === "link") {
    const result = await tryLink(interaction.options.getString("code", true), discord);
    if (result.ok) {
      await interaction.editReply({ content: await linkedMessage(result.userId, discord.id) });
    } else {
      await interaction.editReply({ content: tr(result.reason === "rate" ? "Too many requests. Wait a moment and try again." : "That code is invalid or expired. Create a new one in the app.") });
    }
    return;
  }
  if (!link) {
    await interaction.editReply({ content: bilingual("Link your account first: open the app, go to Discord settings, create a code, and send it to me here.") });
    return;
  }
  if (interaction.commandName === "unlink") {
    await unlinkDiscord(link.userId);
    await interaction.editReply({ content: tr("Unlinked. This Discord account no longer reaches your workspace.") });
    return;
  }
  if (interaction.commandName === "teammate") {
    const store = await readStore(link.userId);
    const typed = interaction.options.getString("name")?.trim();
    const wanted = typed?.toLowerCase();
    const current = store.bots.find((bot) => bot.id === link.botId) ?? store.bots[0];
    if (!wanted) {
      const list = store.bots.map((bot) => `${bot.id === current?.id ? "• **" : "• "}${bot.name}${bot.id === current?.id ? "**" : ""} — ${bot.job}`).join("\n");
      await interaction.editReply({ content: list || tr("Create a teammate in the app first, then message again.") });
      return;
    }
    // Autocomplete submits the teammate id; typed text is matched by name.
    const match = store.bots.find((bot) => bot.id === typed || bot.name.toLowerCase() === wanted);
    if (!match) {
      await interaction.editReply({ content: tr("No teammate with that name. Run /teammate to see the list.") });
      return;
    }
    await setDiscordLinkBot(link.userId, match.id);
    await interaction.editReply({ content: tr("Now talking to {name}.", { name: match.name }) });
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
      await interaction.editReply({ content: tr("Now using {mode}. {cost}", runModeParams(next, tr)) });
      return;
    }
    const mode = joinRunMode(current.plus, current.level);
    await interaction.editReply({ content: tr("Current setting: {mode}. {cost}", runModeParams(mode, tr)) });
  }
}

function runModeParams(mode: ReturnType<typeof parseRunMode>, tr: ReturnType<typeof translatorFor>) {
  const { label, tokenMultiplier, effort } = RUN_MODES[mode];
  return {
    mode: `${label} (${effort})`,
    cost: tokenMultiplier === 1 ? tr("Standard token use.") : tr("{multiplier}× tokens", { multiplier: tokenMultiplier }),
  };
}

/** Suggest teammates while typing /teammate. Only a linked account sees its own workspace's list. */
async function handleAutocomplete(interaction: AutocompleteInteraction) {
  const link = await getDiscordLinkByDiscordId(interaction.user.id);
  if (!link || interaction.commandName !== "teammate") {
    await interaction.respond([]);
    return;
  }
  const query = interaction.options.getFocused().trim().toLowerCase();
  const { bots } = await readStore(link.userId);
  const choices = bots
    .filter((bot) => !query || bot.name.toLowerCase().includes(query) || bot.job.toLowerCase().includes(query))
    .slice(0, 25)
    .map((bot) => ({ name: `${bot.name} — ${bot.job}`.slice(0, 100), value: bot.id.slice(0, 100) }));
  await interaction.respond(choices);
}

function commandDefinitions() {
  const dm = (builder: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder) =>
    builder.setContexts(InteractionContextType.BotDM).setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall);
  return [
    dm(new SlashCommandBuilder().setName("link").setDescription("Link this Discord account to your workspace").addStringOption((option) => option.setName("code").setDescription("Code from the app's Discord settings").setRequired(true))),
    dm(new SlashCommandBuilder().setName("teammate").setDescription("Show or choose the teammate you talk to").addStringOption((option) => option.setName("name").setDescription("Teammate name").setAutocomplete(true))),
    dm(new SlashCommandBuilder().setName("model").setDescription("Show or choose the model family").addStringOption((option) => option.setName("family").setDescription("Run is faster and cheaper, Run+ is stronger").addChoices({ name: "Run", value: "run" }, { name: "Run+", value: "plus" }))),
    dm(new SlashCommandBuilder().setName("effort").setDescription("Show or choose how hard the model thinks").addStringOption((option) => option.setName("level").setDescription("Reasoning effort").addChoices({ name: "Default (medium)", value: "default" }, { name: "High", value: "high" }, { name: "xhigh", value: "xhigh" }, { name: "Max", value: "max" }))),
    dm(new SlashCommandBuilder().setName("unlink").setDescription("Disconnect this Discord account")),
  ].map((command) => command.toJSON());
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
      else if (interaction.isButton()) await handleButton(interaction);
    }),
  );
  client.on(Events.Error, (error) => reportError(error, "discord client"));
  client.login(token).catch((error) => {
    g.__deniDiscord = undefined;
    reportError(error, "discord login");
  });
}

import "server-only";

import { discordErrorText } from "../discord-i18n";
import {
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  LabelBuilder,
  type MessageActionRowComponentBuilder,
  ModalBuilder,
  type ModalSubmitInteraction,
  type SlashCommandStringOption,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { setDiscordPrefs } from "../discord-link";
import {
  bulletList,
  choices,
  confirmRow,
  customId,
  type DiscordFeature,
  dmCommand,
  type FeatureContext,
  findByIdOrName,
  inApp,
  respond,
  type Translate,
  truncate,
  updateMessage,
} from "../discord-ui";
import { discordTargetGroup } from "../groups";

import { readStore } from "../store";
import { createTeammate, deleteTeammate, forgetTeammateMemory, isDefaultTeammate, updateTeammate } from "../teammates";
import type { Bot, Store } from "../types";

const PREFIX = "tm";
// Discord caps a modal text input at 4,000 characters and a select menu at 25 options.
const FIELD_MAX = 4_000;
const NAME_MAX = 100;
const JOB_MAX = 200;
const MENU_MAX = 25;

const nameOption = (option: SlashCommandStringOption) =>
  option.setName("name").setDescription("Teammate name").setDescriptionLocalization("ja", "チームメイトの名前").setRequired(true).setAutocomplete(true);

const command = dmCommand("team", "Create, edit, and delete teammates", "チームメイトの作成・編集・削除")
  .addSubcommand((sub) => sub.setName("list").setDescription("List your teammates").setDescriptionLocalization("ja", "チームメイトの一覧"))
  .addSubcommand((sub) => sub.setName("create").setDescription("Create a teammate").setDescriptionLocalization("ja", "チームメイトを作成"))
  .addSubcommand((sub) =>
    sub.setName("edit").setDescription("Edit a teammate's name, job, and instructions").setDescriptionLocalization("ja", "チームメイトの名前・役割・指示を編集").addStringOption(nameOption),
  )
  .addSubcommand((sub) => sub.setName("delete").setDescription("Delete a teammate").setDescriptionLocalization("ja", "チームメイトを削除").addStringOption(nameOption))
  .addSubcommand((sub) =>
    sub.setName("memory").setDescription("Show or forget what a teammate remembers").setDescriptionLocalization("ja", "チームメイトのメモリを表示・削除").addStringOption(nameOption),
  );

/** The teammate plain DMs go to when no group is chosen, as lib/discord-turn.ts picks it. */
function currentTeammate(store: Store, botId: string | null) {
  return store.bots.find((bot) => bot.id === botId) ?? store.bots[0];
}

function textField(id: string, style: TextInputStyle, max: number, value?: string, required = false) {
  const input = new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(required).setMaxLength(Math.min(FIELD_MAX, Math.max(max, value?.length ?? 0)));
  return value ? input.setValue(value.slice(0, FIELD_MAX)) : input;
}

/**
 * Create and edit share one form. Instructions over Discord's field limit are left out rather
 * than shown cut off, since saving a cut-off copy would lose the rest.
 */
export function teammateModal(tr: Translate, bot?: Bot) {
  const modal = new ModalBuilder()
    .setCustomId(bot ? customId(PREFIX, "edit", bot.id) : customId(PREFIX, "create"))
    .setTitle(truncate(bot ? tr("Edit {name}", { name: bot.name }) : tr("New teammate"), 45))
    .addLabelComponents(
      new LabelBuilder().setLabel(tr("Name")).setTextInputComponent(textField("name", TextInputStyle.Short, NAME_MAX, bot?.name, true)),
      new LabelBuilder()
        .setLabel(tr("Job"))
        .setDescription(tr("What this teammate does, such as Research and reports"))
        .setTextInputComponent(textField("job", TextInputStyle.Short, JOB_MAX, bot?.job)),
    );
  if (bot && bot.instructions.length > FIELD_MAX) {
    return modal.addTextDisplayComponents(new TextDisplayBuilder().setContent(tr("The instructions are too long for Discord. Edit them in the app.")));
  }
  return modal.addLabelComponents(
    new LabelBuilder()
      .setLabel(tr("Instructions"))
      .setDescription(bot ? tr("How this teammate should work. Leave empty to keep the current instructions.") : tr("How this teammate should work. Leave empty for a default."))
      .setTextInputComponent(textField("instructions", TextInputStyle.Paragraph, FIELD_MAX, bot?.instructions)),
  );
}

async function list(interaction: ChatInputCommandInteraction, { link, tr }: FeatureContext) {
  const store = await readStore(link.userId);
  const group = discordTargetGroup(store);
  const current = group ? undefined : currentTeammate(store, link.botId);
  const lines = store.bots.map((bot) =>
    bot.id === current?.id ? `**${bot.name}** — ${bot.job} ${tr("(your messages go here)")}` : `${bot.name} — ${bot.job}`,
  );
  const header = group
    ? tr("Your messages go to the group {name}. Use /teammate to talk to one teammate.", { name: group.title })
    : tr("Use /teammate to choose who your messages go to.");
  await respond(interaction, `${header}\n${bulletList(lines, tr, tr("No teammates yet. Create one with /team create."))}`);
}

/** Newest first, so a long memory is cut at its oldest entries in both the list and the menu. */
export function memoryView(bot: Bot, tr: Translate) {
  if (!bot.memory.length) return { content: tr("{name} has no saved memories yet.", { name: bot.name }), components: [] };
  const newest = [...bot.memory].reverse();
  const content = `${tr("What {name} remembers:", { name: bot.name })}\n${bulletList(newest.map((entry) => truncate(entry.text.replace(/\s+/g, " "), 300)), tr, "", 1_600)}`;
  const options = newest.slice(0, MENU_MAX).map((entry) =>
    new StringSelectMenuOptionBuilder().setLabel(truncate(entry.text.replace(/\s+/g, " ").trim() || "…", 100)).setValue(entry.id).setDescription(entry.createdAt.slice(0, 10)),
  );
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId(PREFIX, "forget", bot.id))
    .setPlaceholder(tr("Choose memories to forget"))
    .setMinValues(1)
    .setMaxValues(options.length)
    .addOptions(options);
  return { content, components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu)] };
}

async function showMemory(interaction: ChatInputCommandInteraction, { link, tr }: FeatureContext) {
  const store = await readStore(link.userId);
  const bot = findByIdOrName(store.bots, interaction.options.getString("name", true));
  if (!bot) {
    await respond(interaction, tr("No teammate with that name. Run /team list to see your teammates."));
    return;
  }
  await respond(interaction, memoryView(bot, tr));
}

async function askDelete(interaction: ChatInputCommandInteraction, { link, tr }: FeatureContext) {
  const store = await readStore(link.userId);
  const bot = findByIdOrName(store.bots, interaction.options.getString("name", true));
  if (!bot) {
    await respond(interaction, tr("No teammate with that name. Run /team list to see your teammates."));
    return;
  }
  if (isDefaultTeammate(bot.id)) {
    await respond(interaction, tr("Default teammates cannot be deleted."));
    return;
  }
  // Deleting a teammate also deletes every group it is in, so the person is told which ones.
  const groups = store.threads.filter((thread) => thread.kind === "group" && thread.botIds.includes(bot.id)).map((thread) => thread.title);
  const lines = [tr("Delete {name}? Their conversation, memory, and routines are deleted too.", { name: bot.name })];
  if (groups.length) lines.push(tr("These groups are deleted too: {groups}", { groups: truncate(groups.join(", "), 1_000) }));
  await respond(interaction, { content: lines.join("\n"), components: [confirmRow(PREFIX, ["delete", bot.id], tr)] });
}

async function saveModal(interaction: ModalSubmitInteraction, { link, tr }: FeatureContext, args: string[]) {
  const [action, botId] = args;
  if (action !== "create" && !(action === "edit" && botId)) return;
  // The store may be remote; acknowledge before writing.
  await interaction.deferReply();
  const name = interaction.fields.getTextInputValue("name").trim();
  const job = interaction.fields.getTextInputValue("job").trim();
  const hasInstructions = interaction.fields.fields.has("instructions");
  const instructions = hasInstructions ? interaction.fields.getTextInputValue("instructions").trim() : "";
  if (!name) {
    await respond(interaction, tr("Name is required."));
    return;
  }
  if (action === "create") {
    const result = await createTeammate(link.userId, { name, job, instructions });
    if (!result.ok) {
      await respond(
        interaction,
        result.reason === "limit" ? `${discordErrorText(link.locale, result.error)}\n${inApp(tr, "/upgrade")}` : tr("Name is required."),
      );
      return;
    }
    await respond(interaction, tr("Created {name}. Use /teammate to talk to them.", { name: result.bot.name }));
    return;
  }
  // Empty fields keep their current value, as in the app.
  const result = await updateTeammate(link.userId, botId, { name, job: job || undefined, instructions: instructions || undefined });
  if (!result.ok) {
    await respond(interaction, tr("That teammate no longer exists."));
    return;
  }
  const saved = tr("Saved {name}.", { name: result.bot.name });
  await respond(interaction, hasInstructions ? saved : `${saved}\n${tr("The instructions are too long for Discord. Edit them in the app.")} ${inApp(tr)}`);
}

export const feature: DiscordFeature = {
  commands: [command],
  prefix: PREFIX,
  opensModal: (interaction) => ["create", "edit"].includes(interaction.options.getSubcommand(false) ?? ""),
  async command(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    if (sub === "list") await list(interaction, ctx);
    else if (sub === "memory") await showMemory(interaction, ctx);
    else if (sub === "delete") await askDelete(interaction, ctx);
    else if (sub === "create") await interaction.showModal(teammateModal(ctx.tr));
    else if (sub === "edit") {
      // Not deferred: the modal has to be the first answer.
      const bot = findByIdOrName((await readStore(ctx.link.userId)).bots, interaction.options.getString("name", true));
      if (bot) await interaction.showModal(teammateModal(ctx.tr, bot));
      else await respond(interaction, ctx.tr("No teammate with that name. Run /team list to see your teammates."));
    }
  },
  async autocomplete(interaction, { link }) {
    const { bots } = await readStore(link.userId);
    await interaction.respond(choices(bots, interaction.options.getFocused(), (bot) => `${bot.name} — ${bot.job}`, (bot) => bot.id));
  },
  async component(interaction, { link, tr }, args) {
    const [action, botId = ""] = args;
    if (action === "delete" && interaction.isButton()) {
      await interaction.deferUpdate();
      const store = await readStore(link.userId);
      const bot = store.bots.find((item) => item.id === botId);
      if (!bot) {
        await updateMessage(interaction, tr("That teammate no longer exists."));
        return;
      }
      const result = await deleteTeammate(link.userId, bot.id);
      if (!result.ok) {
        await updateMessage(interaction, tr("Default teammates cannot be deleted."));
        return;
      }
      const lines = [tr("Deleted teammate {name}.", { name: bot.name })];
      // The teammate's groups went with it. If plain DMs were going to it or to one of those
      // groups, they now reach another teammate; say who instead of surprising the person.
      const target = discordTargetGroup(store);
      if (target?.botIds.includes(bot.id)) await setDiscordPrefs(link.userId, { threadId: null });
      if (target ? target.botIds.includes(bot.id) : link.botId === bot.id) {
        const next = store.bots.find((item) => item.id === link.botId && item.id !== bot.id) ?? store.bots.find((item) => item.id !== bot.id);
        if (next) lines.push(tr("Your messages now go to {name}.", { name: next.name }));
      }
      await updateMessage(interaction, lines.join("\n"));
      return;
    }
    if (action === "forget" && interaction.isStringSelectMenu()) {
      await interaction.deferUpdate();
      const result = await forgetTeammateMemory(link.userId, botId, interaction.values);
      if (!result.ok) {
        await updateMessage(interaction, tr("That teammate no longer exists."));
        return;
      }
      const view = memoryView(result.bot, tr);
      const done = tr("Memories forgotten: {count}.", { count: result.removed });
      await updateMessage(interaction, `${done}\n\n${view.content}`, view.components);
    }
  },
  modal: saveModal,
};

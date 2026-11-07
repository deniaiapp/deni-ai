import "@tanstack/react-start/server-only";

import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  LabelBuilder,
  type MessageActionRowComponentBuilder,
  ModalBuilder,
  type ModalSubmitInteraction,
  type SlashCommandStringOption,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { setDiscordPrefs } from "../link";
import {
  bulletList,
  choices,
  confirmRow,
  customId,
  type DiscordFeature,
  dmCommand,
  type FeatureContext,
  inApp,
  respond,
  type Translate,
  truncate,
  updateMessage,
} from "../ui";
import { createGroup, discordTargetGroup, GROUP_TITLE_MAX, groupMembers, listGroups, updateGroup } from "@/lib/chat/groups";
import { deleteGroupThread, readStore } from "@/lib/data/store";
import type { Bot, Store, Thread } from "@/lib/types";

const PREFIX = "gp";
const MENU_MAX = 25;
const DRAFT_TTL_MS = 15 * 60_000;

const groupOption = (option: SlashCommandStringOption) =>
  option.setName("name").setDescription("Group name").setDescriptionLocalization("ja", "グループ名").setRequired(true).setAutocomplete(true);

const command = dmCommand("group", "Talk to several teammates at once", "複数のチームメイトとまとめて話す")
  .addSubcommand((sub) => sub.setName("list").setDescription("List your groups").setDescriptionLocalization("ja", "グループの一覧"))
  .addSubcommand((sub) =>
    sub.setName("talk").setDescription("Send your messages to a group").setDescriptionLocalization("ja", "メッセージの送り先をグループにする").addStringOption(groupOption),
  )
  .addSubcommand((sub) =>
    sub
      .setName("create")
      .setDescription("Create a group and choose its members")
      .setDescriptionLocalization("ja", "グループを作成してメンバーを選ぶ")
      .addStringOption((option) =>
        option
          .setName("name")
          .setDescription("Group name. Leave empty to use the members' names")
          .setDescriptionLocalization("ja", "グループ名。空欄ならメンバーの名前になります")
          .setMaxLength(GROUP_TITLE_MAX),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("edit").setDescription("Rename a group or change its members").setDescriptionLocalization("ja", "グループ名やメンバーを変更").addStringOption(groupOption),
  )
  .addSubcommand((sub) => sub.setName("delete").setDescription("Delete a group").setDescriptionLocalization("ja", "グループを削除").addStringOption(groupOption));

/**
 * The name typed in /group create waits here until the members are chosen: a custom id cannot
 * hold a 120-character name. The bot runs on one instance, so memory is enough; a restart only
 * means running the command again.
 */
const drafts = new Map<string, { userId: string; title: string; expiresAt: number }>();

function saveDraft(userId: string, title: string) {
  const now = Date.now();
  for (const [key, draft] of drafts) if (draft.expiresAt < now) drafts.delete(key);
  const key = randomUUID().replace(/-/g, "").slice(0, 16);
  drafts.set(key, { userId, title, expiresAt: now + DRAFT_TTL_MS });
  return key;
}

function findDraft(key: string, userId: string) {
  const draft = drafts.get(key);
  return draft && draft.userId === userId && draft.expiresAt >= Date.now() ? draft : null;
}

/** Find by id first (what autocomplete submits), then by case-insensitive title. */
function findGroup(store: Store, typed: string | null) {
  const value = typed?.trim();
  if (!value) return undefined;
  const groups = listGroups(store);
  return groups.find((group) => group.id === value) ?? groups.find((group) => group.title.toLowerCase() === value.toLowerCase());
}

/** Buttons carry the group id; it is looked up in the presser's own workspace. */
function groupById(store: Store, id: string) {
  return listGroups(store).find((group) => group.id === id);
}

function names(bots: Bot[]) {
  return truncate(bots.map((bot) => bot.name).join(", "), 1_000);
}

function row(...components: MessageActionRowComponentBuilder[]) {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...components);
}

/** Up to 25 teammates, the chosen ones first so a long team never drops a current member. */
function memberMenu(id: string, store: Store, chosen: readonly string[], tr: Translate) {
  const ordered = [...store.bots.filter((bot) => chosen.includes(bot.id)), ...store.bots.filter((bot) => !chosen.includes(bot.id))].slice(0, MENU_MAX);
  const options = ordered.map((bot) => {
    const option = new StringSelectMenuOptionBuilder().setLabel(truncate(bot.name, 100)).setValue(bot.id).setDefault(chosen.includes(bot.id));
    return bot.job.trim() ? option.setDescription(truncate(bot.job, 100)) : option;
  });
  return new StringSelectMenuBuilder().setCustomId(id).setPlaceholder(tr("Choose at least two teammates")).setMinValues(2).setMaxValues(options.length).addOptions(options);
}

function talkButton(group: Thread, tr: Translate) {
  return row(new ButtonBuilder().setCustomId(customId(PREFIX, "talk", group.id)).setLabel(tr("Talk in this group")).setStyle(ButtonStyle.Primary));
}

/** How a group conversation works here, so @name and @everyone are not a surprise. */
export function talkMessage(group: Thread, members: Bot[], tr: Translate) {
  return [
    tr("Your messages now go to the group {name} ({members}).", { name: group.title, members: names(members) }),
    tr("Every member answers. Start with @name to ask only that teammate, or @everyone to ask them all."),
    tr("Use /teammate to go back to talking with one teammate."),
  ].join("\n");
}

async function list(interaction: ChatInputCommandInteraction, { link, tr }: FeatureContext) {
  const store = await readStore(link.userId);
  const target = discordTargetGroup(store);
  const lines = listGroups(store).map((group) => {
    const members = names(groupMembers(store, group));
    return group.id === target?.id ? `**${group.title}** — ${members} ${tr("(your messages go here)")}` : `${group.title} — ${members}`;
  });
  const footer = target ? tr("Use /teammate to go back to talking with one teammate.") : tr("Use /group talk to send your messages to a group.");
  await respond(interaction, `${bulletList(lines, tr, tr("No groups yet. Create one with /group create."))}\n\n${footer}`);
}

async function talk(interaction: ChatInputCommandInteraction, { link, tr }: FeatureContext) {
  const store = await readStore(link.userId);
  const group = findGroup(store, interaction.options.getString("name", true));
  if (!group) {
    await respond(interaction, tr("No group with that name. Run /group list to see your groups."));
    return;
  }
  await setDiscordPrefs(link.userId, { threadId: group.id });
  await respond(interaction, talkMessage(group, groupMembers(store, group), tr));
}

async function create(interaction: ChatInputCommandInteraction, { link, tr }: FeatureContext) {
  const title = interaction.options.getString("name")?.trim().slice(0, GROUP_TITLE_MAX) ?? "";
  const store = await readStore(link.userId);
  if (store.bots.length < 2) {
    await respond(interaction, tr("A group needs at least two teammates. Create another one with /team create."));
    return;
  }
  const lines = [title ? tr("Who should be in {name}? Choose at least two teammates.", { name: title }) : tr("Who should be in the new group? Choose at least two teammates.")];
  if (store.bots.length > MENU_MAX) lines.push(tr("Only 25 teammates fit in this menu. Add the others in the app."));
  const menu = memberMenu(customId(PREFIX, "new", saveDraft(link.userId, title)), store, [], tr);
  await respond(interaction, { content: lines.join("\n"), components: [row(menu)] });
}

async function edit(interaction: ChatInputCommandInteraction, { link, tr }: FeatureContext) {
  const store = await readStore(link.userId);
  const group = findGroup(store, interaction.options.getString("name", true));
  if (!group) {
    await respond(interaction, tr("No group with that name. Run /group list to see your groups."));
    return;
  }
  const lines = [tr("{name}: {members}", { name: group.title, members: names(groupMembers(store, group)) })];
  const rename = new ButtonBuilder().setCustomId(customId(PREFIX, "rename", group.id)).setLabel(tr("Rename")).setStyle(ButtonStyle.Secondary);
  const components = [row(rename)];
  if (group.botIds.length > MENU_MAX) {
    lines.push(`${tr("This group has more than 25 members. Change them in the app.")} ${inApp(tr)}`);
  } else {
    lines.push(tr("Choose the members below. Routines of teammates you remove are turned off."));
    if (store.bots.length > MENU_MAX) lines.push(tr("Only 25 teammates fit in this menu. Add the others in the app."));
    components.push(row(memberMenu(customId(PREFIX, "members", group.id), store, group.botIds, tr)));
  }
  await respond(interaction, { content: lines.join("\n"), components });
}

async function askDelete(interaction: ChatInputCommandInteraction, { link, tr }: FeatureContext) {
  const store = await readStore(link.userId);
  const group = findGroup(store, interaction.options.getString("name", true));
  if (!group) {
    await respond(interaction, tr("No group with that name. Run /group list to see your groups."));
    return;
  }
  await respond(interaction, {
    content: tr("Delete the group {name}? Its messages and routines are deleted too.", { name: group.title }),
    components: [confirmRow(PREFIX, ["delete", group.id], tr)],
  });
}

async function saveRename(interaction: ModalSubmitInteraction, { link, tr }: FeatureContext, groupId: string) {
  await interaction.deferReply();
  const result = await updateGroup(link.userId, groupId, { title: interaction.fields.getTextInputValue("title") });
  if (!result.ok) {
    await respond(interaction, result.reason === "invalid_title" ? tr("Enter a group name of up to 120 characters.") : tr("That group no longer exists."));
    return;
  }
  await respond(interaction, tr("Renamed the group to {name}.", { name: result.thread.title }));
}

export const feature: DiscordFeature = {
  commands: [command],
  prefix: PREFIX,
  async command(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    if (sub === "list") await list(interaction, ctx);
    else if (sub === "talk") await talk(interaction, ctx);
    else if (sub === "create") await create(interaction, ctx);
    else if (sub === "edit") await edit(interaction, ctx);
    else if (sub === "delete") await askDelete(interaction, ctx);
  },
  async autocomplete(interaction, { link }) {
    const store = await readStore(link.userId);
    const label = (group: Thread) => `${group.title} (${groupMembers(store, group).map((bot) => bot.name).join(", ")})`;
    await interaction.respond(choices(listGroups(store), interaction.options.getFocused(), label, (group) => group.id));
  },
  async component(interaction, { link, tr }, args) {
    const [action, id = ""] = args;
    if (action === "rename" && interaction.isButton()) {
      // A modal must be the first answer, so it is shown before anything else is sent.
      const group = groupById(await readStore(link.userId), id);
      if (!group) {
        await updateMessage(interaction, tr("That group no longer exists."));
        return;
      }
      const input = new TextInputBuilder().setCustomId("title").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(GROUP_TITLE_MAX).setValue(group.title.slice(0, GROUP_TITLE_MAX));
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(customId(PREFIX, "rename", group.id))
          .setTitle(tr("Rename the group"))
          .addLabelComponents(new LabelBuilder().setLabel(tr("Group name")).setTextInputComponent(input)),
      );
      return;
    }
    await interaction.deferUpdate();
    if (action === "new" && interaction.isStringSelectMenu()) {
      const draft = findDraft(id, link.userId);
      if (!draft) {
        await updateMessage(interaction, tr("This menu has expired. Run /group create again."));
        return;
      }
      const result = await createGroup(link.userId, { title: draft.title || undefined, botIds: interaction.values });
      if (!result.ok) {
        // A teammate was deleted meanwhile: offer the current team again.
        const menu = memberMenu(customId(PREFIX, "new", id), await readStore(link.userId), [], tr);
        await updateMessage(interaction, tr("Choose at least two valid teammates."), [row(menu)]);
        return;
      }
      drafts.delete(id);
      const members = names(groupMembers(await readStore(link.userId), result.thread));
      await updateMessage(interaction, tr("Created the group {name} with {members}.", { name: result.thread.title, members }), [talkButton(result.thread, tr)]);
      return;
    }
    if (action === "members" && interaction.isStringSelectMenu()) {
      const result = await updateGroup(link.userId, id, { botIds: interaction.values });
      if (!result.ok) {
        await updateMessage(interaction, result.reason === "not_found" ? tr("That group no longer exists.") : tr("Choose at least two valid teammates."));
        return;
      }
      const store = await readStore(link.userId);
      const lines = [tr("{name}: {members}", { name: result.thread.title, members: names(groupMembers(store, result.thread)) })];
      if (result.disabledRoutines) lines.push(tr("Routines turned off because their teammate left the group: {count}.", { count: result.disabledRoutines }));
      await updateMessage(interaction, lines.join("\n"));
      return;
    }
    if (action === "talk" && interaction.isButton()) {
      const store = await readStore(link.userId);
      const group = groupById(store, id);
      if (!group) {
        await updateMessage(interaction, tr("That group no longer exists."));
        return;
      }
      await setDiscordPrefs(link.userId, { threadId: group.id });
      await updateMessage(interaction, talkMessage(group, groupMembers(store, group), tr));
      return;
    }
    if (action === "delete" && interaction.isButton()) {
      const store = await readStore(link.userId);
      const group = groupById(store, id);
      if (!group || !(await deleteGroupThread(link.userId, group.id))) {
        await updateMessage(interaction, tr("That group no longer exists."));
        return;
      }
      const lines = [tr("Deleted the group {name}.", { name: group.title })];
      // Plain DMs would otherwise keep pointing at a group that is gone.
      if (store.discord?.threadId === group.id) {
        await setDiscordPrefs(link.userId, { threadId: null });
        const teammate = store.bots.find((bot) => bot.id === link.botId) ?? store.bots[0];
        if (teammate) lines.push(tr("Your messages go to {name} again.", { name: teammate.name }));
      }
      await updateMessage(interaction, lines.join("\n"));
    }
  },
  async modal(interaction, ctx, args) {
    const [action, id] = args;
    if (action === "rename" && id) await saveRename(interaction, ctx, id);
  },
};

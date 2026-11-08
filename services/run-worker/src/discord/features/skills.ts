import {
  type Attachment,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  escapeMarkdown,
  LabelBuilder,
  ModalBuilder,
  type SlashCommandStringOption,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { attachmentFileName } from "../attachments";
import {
  bulletList,
  choices,
  codeBlock,
  confirmRow,
  customId,
  dmCommand,
  type DiscordFeature,
  type FeatureContext,
  findByIdOrName,
  MESSAGE_LIMIT,
  respond,
  type Translate,
  truncate,
  updateMessage,
} from "../ui";
import {
  deleteSkill,
  saveSkill,
  SKILL_BODY_MAX,
  SKILL_NAME_MAX,
  type SaveSkillResult,
} from "@deniai/run/agent/skills";
import { readStore } from "@deniai/run/data/store";
import type { Skill } from "@deniai/run/types";

const PREFIX = "sk";
/** Discord caps a modal text input at this many characters; longer text goes through a file. */
export const MODAL_TEXT_MAX = 4_000;

export type TextFileResult =
  | { ok: true; text: string }
  | { ok: false; reason: "type" | "size" | "download" | "empty"; limit: number };

const TEXT_EXTENSION = /\.(md|markdown|txt|text)$/i;
// Attachment URLs come from Discord's own payload; refuse anything else so a URL is never fetched blindly.
const DISCORD_HOST = /(^|\.)(discordapp\.com|discordapp\.net|discord\.com)$/i;

/**
 * The text of a .md or .txt file attached to a command, for instructions too long for a Discord
 * form. Binary files are refused instead of being stored as garbled text.
 */
export async function readTextAttachment(
  file: Pick<Attachment, "name" | "url" | "size" | "contentType">,
  maxChars: number,
): Promise<TextFileResult> {
  const fail = (reason: "type" | "size" | "download" | "empty"): TextFileResult => ({
    ok: false,
    reason,
    limit: maxChars,
  });
  if (!TEXT_EXTENSION.test(file.name) && !file.contentType?.startsWith("text/"))
    return fail("type");
  // UTF-8 needs at most 4 bytes a character, so a bigger file cannot fit.
  if (file.size > maxChars * 4) return fail("size");
  let host = "";
  try {
    host = new URL(file.url).hostname;
  } catch {
    return fail("download");
  }
  if (!DISCORD_HOST.test(host)) return fail("download");
  const response = await fetch(file.url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!response?.ok) return fail("download");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxChars * 4) return fail("size");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("type");
  }
  if (text.includes("\u0000")) return fail("type");
  text = text.replace(/\r\n?/g, "\n");
  if (text.length > maxChars) return fail("size");
  if (!text.trim()) return fail("empty");
  return { ok: true, text };
}

/** Why an attached file could not be used, in the person's language. */
export function textFileProblem(
  result: Extract<TextFileResult, { ok: false }>,
  tr: Translate,
  locale: string,
) {
  const limit = result.limit.toLocaleString(locale);
  if (result.reason === "type") return tr("Attach a text or Markdown file (.md or .txt).");
  if (result.reason === "size")
    return tr("That file is too long. The limit is {limit} characters.", { limit });
  if (result.reason === "empty") return tr("That file is empty.");
  return tr("Could not read that file. Attach it again.");
}

/** A text attachment Discord can show, so text from a form that failed to save is not lost. */
export function textAttachment(text: string, name: string) {
  return new AttachmentBuilder(Buffer.from(text, "utf8"), { name: attachmentFileName(name) });
}

function nameOption(option: SlashCommandStringOption) {
  return option
    .setName("name")
    .setDescription("Skill name")
    .setDescriptionLocalization("ja", "スキル名")
    .setRequired(true)
    .setAutocomplete(true);
}

const fileDescription = {
  en: "A .md or .txt file with the instructions, for long skills",
  ja: "指示を書いた .md または .txt ファイル(長いスキル向け)",
};

const command = dmCommand(
  "skill",
  "Create, view, edit, and delete skills",
  "スキルの作成・表示・編集・削除",
)
  .addSubcommand((sub) =>
    sub
      .setName("list")
      .setDescription("List your skills")
      .setDescriptionLocalization("ja", "スキルの一覧"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("show")
      .setDescription("Show a skill's instructions")
      .setDescriptionLocalization("ja", "スキルの内容を表示")
      .addStringOption(nameOption),
  )
  .addSubcommand((sub) =>
    sub
      .setName("create")
      .setDescription("Create a skill in a form, or from an attached file")
      .setDescriptionLocalization("ja", "フォームまたは添付ファイルからスキルを作成")
      .addStringOption((option) =>
        option
          .setName("name")
          .setDescription("Skill name (with a file, defaults to the file name)")
          .setDescriptionLocalization("ja", "スキル名(ファイル添付時の既定はファイル名)")
          .setMaxLength(SKILL_NAME_MAX),
      )
      .addAttachmentOption((option) =>
        option
          .setName("file")
          .setDescription(fileDescription.en)
          .setDescriptionLocalization("ja", fileDescription.ja),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("edit")
      .setDescription("Edit a skill in a form, or replace its instructions with a file")
      .setDescriptionLocalization("ja", "フォームで編集、またはファイルで指示を置き換え")
      .addStringOption(nameOption)
      .addAttachmentOption((option) =>
        option
          .setName("file")
          .setDescription(fileDescription.en)
          .setDescriptionLocalization("ja", fileDescription.ja),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("delete")
      .setDescription("Delete a skill")
      .setDescriptionLocalization("ja", "スキルを削除")
      .addStringOption(nameOption),
  );

function skillModal(
  tr: Translate,
  args: string[],
  title: string,
  values: { name?: string; body?: string },
) {
  const name = new TextInputBuilder()
    .setCustomId("name")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(SKILL_NAME_MAX)
    .setRequired(true);
  const body = new TextInputBuilder()
    .setCustomId("body")
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(MODAL_TEXT_MAX)
    .setRequired(true);
  if (values.name) name.setValue(truncate(values.name, SKILL_NAME_MAX));
  if (values.body) body.setValue(values.body);
  return new ModalBuilder()
    .setCustomId(customId(PREFIX, ...args))
    .setTitle(truncate(title, 45))
    .addLabelComponents(
      new LabelBuilder().setLabel(truncate(tr("Name"), 45)).setTextInputComponent(name),
      new LabelBuilder()
        .setLabel(truncate(tr("Instructions"), 45))
        .setDescription(
          truncate(
            tr(
              "When to use it, the steps, and how to check the result. Longer skills: attach a file.",
            ),
            100,
          ),
        )
        .setTextInputComponent(body),
    );
}

const firstLine = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) ?? "";

/** The file name a skill is sent and offered back as. */
const skillFile = (name: string) => `${name}.md`;

/** The confirmation for a save, or why it failed. */
function savedMessage(result: SaveSkillResult, created: boolean, tr: Translate) {
  if (result.ok) {
    const name = escapeMarkdown(result.skill.name);
    return created
      ? tr("Created the skill {name}.", { name })
      : tr("Saved the skill {name}.", { name });
  }
  if (result.reason === "duplicate") return tr("A skill with this name already exists.");
  if (result.reason === "not_found") return tr("That skill no longer exists.");
  return tr("Name and instructions are required.");
}

async function findSkill(interaction: ChatInputCommandInteraction, { link, tr }: FeatureContext) {
  const { skills } = await readStore(link.userId);
  const skill = findByIdOrName(skills, interaction.options.getString("name", true));
  if (!skill)
    await respond(interaction, tr("No skill with that name. Run /skill list to see them."));
  return skill;
}

async function list(interaction: ChatInputCommandInteraction, { link, tr }: FeatureContext) {
  const { skills } = await readStore(link.userId);
  if (!skills.length) {
    await respond(interaction, tr("No skills yet. Create one with /skill create."));
    return;
  }
  const items = skills.map((skill) => {
    const preview = truncate(firstLine(skill.body).replace(/^#+\s*/, ""), 80);
    const name = `**${escapeMarkdown(skill.name)}**`;
    return preview ? `${name} — ${escapeMarkdown(preview)}` : name;
  });
  await respond(
    interaction,
    `${tr("Skills ({count})", { count: skills.length })}\n${bulletList(items, tr, "")}`,
  );
}

async function show(interaction: ChatInputCommandInteraction, ctx: FeatureContext) {
  const skill = await findSkill(interaction, ctx);
  if (!skill) return;
  const inline = `**${escapeMarkdown(skill.name)}**\n${codeBlock(skill.body, "md")}`;
  // A body with its own code fences would be altered in a code block, so it goes as a file too.
  if (inline.length <= MESSAGE_LIMIT && !skill.body.includes("```")) {
    await respond(interaction, inline);
    return;
  }
  await respond(interaction, {
    content: ctx.tr("The instructions of {name} are attached as a file.", {
      name: escapeMarkdown(skill.name),
    }),
    files: [textAttachment(skill.body, skillFile(skill.name))],
  });
}

/** Create or edit from an attached file. Without a name, the file name (minus .md) is used. */
async function saveFromFile(
  interaction: ChatInputCommandInteraction,
  { link, tr }: FeatureContext,
  file: Attachment,
  existing?: Skill,
) {
  const read = await readTextAttachment(file, SKILL_BODY_MAX);
  if (!read.ok) {
    await respond(interaction, textFileProblem(read, tr, link.locale));
    return;
  }
  const name =
    existing?.name ??
    (
      interaction.options.getString("name")?.trim() || file.name.replace(/\.[^.]+$/, "").trim()
    ).slice(0, SKILL_NAME_MAX);
  const result = await saveSkill(link.userId, { id: existing?.id, name, body: read.text });
  await respond(interaction, savedMessage(result, !existing, tr));
}

async function create(interaction: ChatInputCommandInteraction, ctx: FeatureContext) {
  const file = interaction.options.getAttachment("file");
  if (file) {
    await saveFromFile(interaction, ctx, file);
    return;
  }
  await interaction.showModal(
    skillModal(ctx.tr, ["new"], ctx.tr("New skill"), {
      name: interaction.options.getString("name") ?? undefined,
    }),
  );
}

async function edit(interaction: ChatInputCommandInteraction, ctx: FeatureContext) {
  const skill = await findSkill(interaction, ctx);
  if (!skill) return;
  const file = interaction.options.getAttachment("file");
  if (file) {
    await saveFromFile(interaction, ctx, file, skill);
    return;
  }
  if (skill.body.length > MODAL_TEXT_MAX) {
    // Hand the current text over so it can be edited and sent back.
    await respond(interaction, {
      content: ctx.tr(
        "{name} is longer than 4,000 characters, more than a Discord form holds. Edit the attached file and send it back with /skill edit file:.",
        { name: escapeMarkdown(skill.name) },
      ),
      files: [textAttachment(skill.body, skillFile(skill.name))],
    });
    return;
  }
  await interaction.showModal(
    skillModal(ctx.tr, ["edit", skill.id], ctx.tr("Edit skill"), {
      name: skill.name,
      body: skill.body,
    }),
  );
}

async function confirmDelete(interaction: ChatInputCommandInteraction, ctx: FeatureContext) {
  const skill = await findSkill(interaction, ctx);
  if (!skill) return;
  await respond(interaction, {
    content: ctx.tr("Delete the skill {name}? Teammates will no longer be able to read it.", {
      name: escapeMarkdown(skill.name),
    }),
    components: [confirmRow(PREFIX, ["del", skill.id], ctx.tr)],
  });
}

export const feature: DiscordFeature = {
  commands: [command],
  prefix: PREFIX,
  opensModal(interaction) {
    const sub = interaction.options.getSubcommand(false);
    return (sub === "create" || sub === "edit") && !interaction.options.getAttachment("file");
  },
  async command(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    if (sub === "list") await list(interaction, ctx);
    else if (sub === "show") await show(interaction, ctx);
    else if (sub === "create") await create(interaction, ctx);
    else if (sub === "edit") await edit(interaction, ctx);
    else if (sub === "delete") await confirmDelete(interaction, ctx);
  },
  async autocomplete(interaction, { link }) {
    const { skills } = await readStore(link.userId);
    await interaction.respond(
      choices(
        skills,
        interaction.options.getFocused(),
        (skill) => skill.name,
        (skill) => skill.id,
      ),
    );
  },
  async component(interaction, { link, tr }, args) {
    const [action, skillId] = args;
    if (action !== "del" || !skillId) return;
    await interaction.deferUpdate();
    // The id came from a button; deleteSkill only looks in this person's own skills.
    const deleted = await deleteSkill(link.userId, skillId);
    await updateMessage(
      interaction,
      deleted
        ? tr("Deleted the skill {name}.", { name: escapeMarkdown(deleted.name) })
        : tr("That skill no longer exists."),
    );
  },
  async modal(interaction, { link, tr }, args) {
    const [action, skillId] = args;
    if (action !== "new" && !(action === "edit" && skillId)) return;
    await interaction.deferReply();
    const name = interaction.fields.getTextInputValue("name");
    const body = interaction.fields.getTextInputValue("body");
    const result = await saveSkill(link.userId, {
      id: action === "edit" ? skillId : undefined,
      name,
      body,
    });
    const message = savedMessage(result, action === "new", tr);
    if (result.ok) {
      await respond(interaction, message);
      return;
    }
    await respond(interaction, {
      content: `${message}\n${tr("Your text is attached so nothing is lost.")}`,
      files: [textAttachment(body, skillFile(name.trim() || "skill"))],
    });
  },
};

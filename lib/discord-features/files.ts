import "@tanstack/react-start/server-only";

import { createHash } from "node:crypto";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  type ChatInputCommandInteraction,
  escapeMarkdown,
  type MessageActionRowComponentBuilder,
  type SlashCommandStringOption,
  StringSelectMenuBuilder,
  time,
} from "discord.js";
import { getArtifact, listArtifacts } from "../artifacts";
import {
  bulletList,
  choices,
  codeBlock,
  type ComponentInteraction,
  confirmRow,
  customId,
  type DiscordFeature,
  dmCommand,
  type FeatureContext,
  inApp,
  MESSAGE_LIMIT,
  respond,
  type Translate,
  truncate,
  updateMessage,
} from "../discord-ui";
import { readStore } from "../store";
import type { WorkspaceNode } from "../types";
import {
  deleteWorkspacePath,
  findWorkspaceEntry,
  listWorkspace,
  listWorkspaceFiles,
  normalizeWorkspacePath,
  readWorkspaceBytes,
  zipWorkspaceFiles,
} from "../workspace";

const PREFIX = "fl";
/** Discord's upload cap for a bot is 10 MiB; stay a little under it. */
export const UPLOAD_LIMIT = 10_000_000;
/** /files list shows the folder and one level below it. */
const LIST_DEPTH = 1;
const NESTED_SHOWN = 10;
const SUGGEST_DEPTH = 3;
// Autocomplete must answer within 3 seconds, so a slow listing gives no suggestions instead.
const SUGGEST_TIMEOUT_MS = 2_500;
const MENU_SIZE = 25;

type Package = { content: string; files?: AttachmentBuilder[] };

const shown = (rel: string) => `/${rel}`;
/** A path as inline code, with backticks swapped so it cannot close the span. */
const code = (text: string) => `\`${text.replace(/`/g, "'")}\``;

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Nested folders show their first few entries, so one big folder cannot crowd out the rest. */
function treeLines(nodes: WorkspaceNode[], tr: Translate, indent = 0): string[] {
  const pad = "  ".repeat(indent);
  const shownNodes = indent > 0 ? nodes.slice(0, NESTED_SHOWN) : nodes;
  const lines = shownNodes.flatMap((node) => [
    `${pad}${node.name}${node.type === "dir" ? "/" : `  ${formatSize(node.size ?? 0)}`}`,
    ...(node.type === "dir" ? treeLines(node.children ?? [], tr, indent + 1) : []),
  ]);
  if (nodes.length > shownNodes.length) lines.push(`${pad}${tr("+{count} more", { count: nodes.length - shownNodes.length })}`);
  return lines;
}

function flatten(nodes: WorkspaceNode[]): WorkspaceNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

/** As many lines as fit the budget, then "+N more". */
function fitLines(lines: string[], budget: number, tr: Translate) {
  const kept: string[] = [];
  let used = 0;
  for (const [index, line] of lines.entries()) {
    if (used + line.length + 1 > budget) {
      kept.push(tr("+{count} more", { count: lines.length - index }));
      break;
    }
    kept.push(line);
    used += line.length + 1;
  }
  return kept.join("\n");
}

function tooLarge(rel: string, size: string, tr: Translate) {
  return `${tr("{path} is {size}, which is over Discord's 10 MB limit.", { path: code(shown(rel)), size })}\n${inApp(tr)}`;
}

/**
 * A file as an attachment, or a folder as a zip, within Discord's upload limit. The zip keeps
 * the web download's file-count cap and the tighter of the two size caps.
 */
export async function packageWorkspacePath(userId: string, rel: string, tr: Translate): Promise<Package> {
  const files = await listWorkspaceFiles(userId, rel);
  if (!files.length) return { content: tr("Nothing to send at {path}.", { path: code(shown(rel)) }) };
  const single = files.length === 1 && files[0]?.path === rel ? files[0] : undefined;
  if (single) {
    if (single.size > UPLOAD_LIMIT) return { content: tooLarge(rel, formatSize(single.size), tr) };
    const file = await readWorkspaceBytes(userId, rel);
    return {
      content: `${code(file.path)} · ${formatSize(file.data.byteLength)}`,
      files: [new AttachmentBuilder(file.data, { name: file.name })],
    };
  }
  const zip = await zipWorkspaceFiles(userId, [rel], { maxBytes: UPLOAD_LIMIT });
  if (!zip.ok && zip.reason === "empty") return { content: tr("Nothing to send at {path}.", { path: code(shown(rel)) }) };
  if (!zip.ok && zip.reason === "too_many") {
    return {
      content: `${tr("{path} has more than {max} files, too many to zip here.", { path: code(shown(rel)), max: zip.max })}\n${inApp(tr)}`,
    };
  }
  const total = files.reduce((sum, item) => sum + item.size, 0);
  if (!zip.ok || zip.data.byteLength > UPLOAD_LIMIT) return { content: tooLarge(rel, formatSize(total), tr) };
  const name = `${rel.split("/").at(-1) || "workspace"}.zip`;
  return {
    content: tr("{path} as a zip ({size}, files: {count}).", { path: code(shown(rel)), count: zip.files, size: formatSize(zip.data.byteLength) }),
    files: [new AttachmentBuilder(zip.data, { name })],
  };
}

async function listFolder(interaction: ChatInputCommandInteraction, { link, tr }: FeatureContext) {
  const rel = normalizeWorkspacePath(interaction.options.getString("path") ?? "");
  const entry = await findWorkspaceEntry(link.userId, rel);
  if (!entry) {
    await respond(interaction, tr("Nothing found at {path}.", { path: code(shown(rel)) }));
    return;
  }
  if (entry.type === "file") {
    await respond(interaction, tr("{path} is a file ({size}). Use /files get to download it.", { path: code(shown(rel)), size: formatSize(entry.size ?? 0) }));
    return;
  }
  const nodes = await listWorkspace(link.userId, rel || ".", LIST_DEPTH);
  const header = `**${escapeMarkdown(truncate(shown(rel), 200))}**`;
  if (!nodes.length) {
    await respond(interaction, `${header}\n${tr("This folder is empty.")}`);
    return;
  }
  const footer = tr("Use /files get with a path to download a file, or a folder as a zip.");
  // One message: header, fences, and footer come out of the budget, with room for "+N more".
  const budget = MESSAGE_LIMIT - header.length - footer.length - 40;
  await respond(interaction, `${header}\n${codeBlock(fitLines(treeLines(nodes, tr), budget, tr))}\n${footer}`);
}

async function sendPath(interaction: ChatInputCommandInteraction, { link, tr }: FeatureContext) {
  const rel = normalizeWorkspacePath(interaction.options.getString("path", true));
  await respond(interaction, await packageWorkspacePath(link.userId, rel, tr));
}

function pathHash(rel: string) {
  return createHash("sha256").update(rel).digest("hex").slice(0, 16);
}

/** The path itself when it fits in a custom id; otherwise a hash looked up again on confirm. */
export function deleteArgs(rel: string) {
  const direct = ["rm", "p", rel];
  return [PREFIX, ...direct].join(":").length <= 100 ? direct : ["rm", "h", pathHash(rel)];
}

/** Resolve a delete button back to a path, only ever inside the presser's own workspace. */
async function deleteTarget(userId: string, args: string[]) {
  if (args[1] === "p") return normalizeWorkspacePath(args.slice(2).join(":"));
  const wanted = args[2];
  if (args[1] !== "h" || !wanted) return "";
  const candidates = new Set<string>();
  for (const file of await listWorkspaceFiles(userId)) {
    const parts = file.path.split("/");
    for (let index = 1; index <= parts.length; index += 1) candidates.add(parts.slice(0, index).join("/"));
  }
  return [...candidates].find((candidate) => pathHash(candidate) === wanted) ?? "";
}

async function confirmDelete(interaction: ChatInputCommandInteraction, { link, tr }: FeatureContext) {
  const rel = normalizeWorkspacePath(interaction.options.getString("path", true));
  if (!rel) {
    await respond(interaction, tr("The whole workspace cannot be deleted from Discord. Name a file or folder inside it."));
    return;
  }
  const entry = await findWorkspaceEntry(link.userId, rel);
  if (!entry) {
    await respond(interaction, tr("Nothing found at {path}.", { path: code(shown(rel)) }));
    return;
  }
  const question =
    entry.type === "dir"
      ? tr("Delete the folder {path} and everything in it (files: {count})? This cannot be undone.", {
          path: code(shown(rel)),
          count: (await listWorkspaceFiles(link.userId, rel)).length,
        })
      : tr("Delete {path}? This cannot be undone.", { path: code(shown(rel)) });
  await respond(interaction, { content: question, components: [confirmRow(PREFIX, deleteArgs(rel), tr)] });
}

async function runDelete(interaction: ComponentInteraction, { link, tr }: FeatureContext, args: string[]) {
  await interaction.deferUpdate();
  const rel = await deleteTarget(link.userId, args);
  const entry = rel ? await findWorkspaceEntry(link.userId, rel) : null;
  if (!rel || !entry) {
    await updateMessage(interaction, `${interaction.message.content}\n\n${tr("That file or folder is no longer there.")}`);
    return;
  }
  await deleteWorkspacePath(link.userId, rel);
  await updateMessage(interaction, tr("Deleted {path}.", { path: code(shown(rel)) }));
}

async function showDeliverables(interaction: ChatInputCommandInteraction, { link, tr }: FeatureContext) {
  const [artifacts, store] = await Promise.all([listArtifacts(link.userId), readStore(link.userId)]);
  if (!artifacts.length) {
    await respond(interaction, tr("No deliverables yet. Files your teammates hand over show up here."));
    return;
  }
  const names = new Map(store.bots.map((bot) => [bot.id, bot.name]));
  const recent = artifacts.slice(0, MENU_SIZE);
  const lines = recent.map((artifact) => {
    const teammate = artifact.botId ? names.get(artifact.botId) : undefined;
    const parts = [`**${escapeMarkdown(truncate(artifact.title, 100))}**`, code(shown(truncate(artifact.path, 200)))];
    if (teammate) parts.push(escapeMarkdown(teammate));
    parts.push(time(new Date(artifact.createdAt), "R"));
    return parts.join(" · ");
  });
  const header =
    artifacts.length > recent.length
      ? tr("The latest {count} of {total} deliverables:", { count: recent.length, total: artifacts.length })
      : tr("Recent deliverables:");
  const footer = tr("Choose one below to get the file.");
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId(PREFIX, "art"))
    .setPlaceholder(tr("Choose a deliverable"))
    .addOptions(
      recent.map((artifact) => ({
        label: truncate(artifact.title, 100),
        value: artifact.id,
        description: truncate(shown(artifact.path), 100),
      })),
    );
  await respond(interaction, {
    content: `${header}\n${bulletList(lines, tr, "", MESSAGE_LIMIT - header.length - footer.length - 20)}\n${footer}`,
    components: [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu)],
  });
}

/** Send the chosen deliverable as a new message, so the menu stays usable for another pick. */
async function sendDeliverable(interaction: ComponentInteraction, { link, tr }: FeatureContext) {
  if (!interaction.isStringSelectMenu()) return;
  await interaction.deferUpdate();
  // The id comes from Discord, so it is looked up in the presser's own deliverables.
  const artifact = await getArtifact(link.userId, interaction.values[0] ?? "");
  if (!artifact) {
    await interaction.followUp({ content: tr("That deliverable no longer exists.") });
    return;
  }
  const rel = normalizeWorkspacePath(artifact.path);
  const found = rel ? await findWorkspaceEntry(link.userId, rel) : null;
  if (!found) {
    await interaction.followUp({ content: tr("The file for {title} is no longer in the workspace.", { title: escapeMarkdown(artifact.title) }) });
    return;
  }
  const result = await packageWorkspacePath(link.userId, rel, tr);
  await interaction.followUp({ content: truncate(`**${escapeMarkdown(truncate(artifact.title, 200))}**\n${result.content}`, MESSAGE_LIMIT), files: result.files ?? [] });
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Workspace listing timed out")), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const pathOption = (required: boolean, description: string, ja: string) => (option: SlashCommandStringOption) =>
  option.setName("path").setDescription(description).setDescriptionLocalization("ja", ja).setRequired(required).setAutocomplete(true);

export const feature: DiscordFeature = {
  prefix: PREFIX,
  commands: [
    dmCommand("files", "Browse, download, and delete workspace files", "ワークスペースのファイルを閲覧・ダウンロード・削除")
      .addSubcommand((sub) =>
        sub
          .setName("list")
          .setDescription("Show a folder and what is inside")
          .setDescriptionLocalization("ja", "フォルダの中身を表示")
          .addStringOption(pathOption(false, "Folder (the whole workspace when empty)", "フォルダ（空欄ならワークスペース全体）")),
      )
      .addSubcommand((sub) =>
        sub
          .setName("get")
          .setDescription("Send a file here, or a folder as a zip")
          .setDescriptionLocalization("ja", "ファイルを送信（フォルダは zip で送信）")
          .addStringOption(pathOption(true, "File or folder", "ファイルまたはフォルダ")),
      )
      .addSubcommand((sub) =>
        sub
          .setName("delete")
          .setDescription("Delete a file or folder")
          .setDescriptionLocalization("ja", "ファイルまたはフォルダを削除")
          .addStringOption(pathOption(true, "File or folder", "ファイルまたはフォルダ")),
      )
      .addSubcommand((sub) =>
        sub
          .setName("deliverables")
          .setDescription("Recent deliverables from your teammates")
          .setDescriptionLocalization("ja", "チームメイトの最近の成果物"),
      ),
  ],
  async command(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    if (sub === "list") await listFolder(interaction, ctx);
    else if (sub === "get") await sendPath(interaction, ctx);
    else if (sub === "delete") await confirmDelete(interaction, ctx);
    else if (sub === "deliverables") await showDeliverables(interaction, ctx);
  },
  /** Suggest the person's own files and folders; /files list only needs folders. */
  async autocomplete(interaction, { link }) {
    const focused = interaction.options.getFocused(true);
    const foldersOnly = interaction.options.getSubcommand() === "list";
    try {
      const nodes = flatten(await withTimeout(listWorkspace(link.userId, ".", SUGGEST_DEPTH), SUGGEST_TIMEOUT_MS)).filter(
        // A longer value would be cut by Discord's 100 character cap and name another path.
        (node) => node.path.length <= 100 && (!foldersOnly || node.type === "dir"),
      );
      const label = (node: WorkspaceNode) => (node.type === "dir" ? `${node.path}/` : `${node.path} (${formatSize(node.size ?? 0)})`);
      await interaction.respond(focused.name === "path" ? choices(nodes, focused.value, label, (node) => node.path) : []);
    } catch {
      await interaction.respond([]).catch(() => undefined);
    }
  },
  async component(interaction, ctx, args) {
    if (args[0] === "rm" && interaction.isButton()) await runDelete(interaction, ctx, args);
    else if (args[0] === "art") await sendDeliverable(interaction, ctx);
  },
};

import "@tanstack/react-start/server-only";

import { discordErrorText } from "../i18n";
import { scrubServerPaths } from "../text";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  escapeMarkdown,
  LabelBuilder,
  type MessageActionRowComponentBuilder,
  type ModalSubmitInteraction,
  ModalBuilder,
  type SlashCommandStringOption,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  time,
} from "discord.js";
import {
  bulletList,
  choices,
  confirmRow,
  customId,
  dmCommand,
  type DiscordFeature,
  type FeatureContext,
  findByIdOrName,
  respond,
  type Translate,
  truncate,
  updateMessage,
} from "../ui";
import { translateMessage } from "@/i18n/standalone";
import { deleteMcpConnection, listMcpConnections, saveMcpConnection, setMcpConnectionEnabled, startMcpSignIn, testMcpConnection } from "@/lib/mcp";
import { mcpCatalog, mcpCatalogEntry, type McpCatalogEntry } from "@/lib/mcp/catalog";
import { oauthBaseUrl } from "@/lib/site";
import type { McpConnection } from "@/lib/types";

/**
 * MCP servers: one-click connectors that sign in with OAuth, and custom servers to list, add,
 * test, switch on and off, and delete. Secrets are never shown.
 */

const PREFIX = "mc";
const transports: Record<McpConnection["transport"], string> = { "streamable-http": "Streamable HTTP", sse: "SSE" };

/** Only the host: a URL can carry a token in its path or query. */
function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "?";
  }
}

/** Text from the server or the person, on one line and unable to change the formatting around it. */
function plain(text: string, max: number) {
  return escapeMarkdown(truncate(text.replace(/\s+/g, " ").trim(), max));
}

function testState(connection: McpConnection, locale: string, tr: Translate) {
  if (!connection.lastTestAt) return tr("not tested");
  const when = time(new Date(connection.lastTestAt), "R");
  if (!connection.lastError) return tr("last test passed {time}", { time: when });
  return tr("last test failed {time}: {error}", { time: when, error: plain(scrubServerPaths(translateMessage(locale, connection.lastError)), 200) });
}

function describeConnection(connection: McpConnection, locale: string, tr: Translate) {
  const parts = [
    `\`${hostOf(connection.url)}\``,
    transports[connection.transport] ?? connection.transport,
    connection.enabled ? tr("on") : tr("off"),
    ...(connection.hasSecret ? [tr("token saved")] : []),
    testState(connection, locale, tr),
  ];
  return `**${plain(connection.name, 120)}** — ${parts.join(" · ")}`;
}

/** Connectors whose OAuth client comes from the environment are unusable until it is set. */
function connectorReady(entry: McpCatalogEntry) {
  return !entry.clientEnv || Boolean(process.env[entry.clientEnv.id]?.trim());
}

function connectorRow(connections: McpConnection[], entry: McpCatalogEntry) {
  return connections.find((item) => item.catalogId === entry.id);
}

function describeConnector(entry: McpCatalogEntry, connection: McpConnection | undefined, tr: Translate) {
  const parts = !connection
    ? [connectorReady(entry) ? tr("not connected") : tr("not set up on this server")]
    : [connection.oauth === "signed-in" ? tr("connected") : tr("needs sign-in"), connection.enabled ? tr("on") : tr("off")];
  return `**${entry.name}** — ${parts.join(" · ")}`;
}

function listReply(connections: McpConnection[], locale: string, tr: Translate) {
  const custom = connections.filter((item) => !mcpCatalogEntry(item.catalogId));
  return [
    `**${tr("Connectors")}**`,
    bulletList(mcpCatalog.map((entry) => describeConnector(entry, connectorRow(connections, entry), tr)), tr, ""),
    tr("Connect one with /mcp connect."),
    "",
    `**${tr("Custom servers")}**`,
    bulletList(custom.map((item) => describeConnection(item, locale, tr)), tr, tr("No MCP connections yet. Add one with /mcp add.")),
  ].join("\n");
}

/** Discord rejects link buttons whose URL is longer than this. */
const LINK_BUTTON_URL_LIMIT = 512;

/**
 * Start OAuth for a connector and answer with the authorization link. The callback needs the
 * person's web session, so the link must be opened where they are signed in to the app.
 */
async function connectReply(entry: McpCatalogEntry, { link, tr }: FeatureContext) {
  const base = oauthBaseUrl();
  if (!base) return tr("Signing in needs the app's address, which this server does not have set.");
  let started: Awaited<ReturnType<typeof startMcpSignIn>>;
  try {
    started = await startMcpSignIn(link.userId, { catalogId: entry.id }, base);
  } catch (error) {
    return tr("Could not start signing in to {name}: {error}", { name: entry.name, error: plain(discordErrorText(link.locale, error), 500) });
  }
  if (!started.authorizeUrl) return tr("{name} does not need a sign-in. It is connected.", { name: entry.name });
  const content = [
    tr("Open the link below in a browser where you are signed in to Deni Run to connect {name}. It works for 15 minutes.", { name: entry.name }),
    tr("If that browser is not signed in, you are asked to sign in first. Then run /mcp connect again for a fresh link."),
  ].join("\n");
  // Too long for a button: the plain link, in angle brackets so Discord shows no preview.
  if (started.authorizeUrl.length > LINK_BUTTON_URL_LIMIT) return `${content}\n<${started.authorizeUrl}>`;
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(started.authorizeUrl).setLabel(truncate(tr("Sign in to {name}", { name: entry.name }), 80)),
  );
  return { content, components: [row] };
}

/** "Key: value" per line. Errors name the line, never its content, since values are often secrets. */
export function parseHeaderLines(text: string): { ok: true; headers: Record<string, string> } | { ok: false; line: number } {
  const headers: Record<string, string> = {};
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    const name = colon > 0 ? line.slice(0, colon).trim() : "";
    if (!name) return { ok: false, line: index + 1 };
    headers[name] = line.slice(colon + 1).trim();
  }
  return { ok: true, headers };
}

/**
 * Only the switch changes. saveMcpConnection would also clear the last test error, and the
 * list would then show a failed server as passing.
 */
/** Ids from options and buttons are only ever looked up among the sender's own connections. */
async function ownConnection(userId: string, typed: string | null | undefined) {
  return findByIdOrName(await listMcpConnections(userId), typed);
}

async function testReport(connection: McpConnection, { link, tr }: FeatureContext) {
  const name = plain(connection.name, 120);
  let report: string;
  try {
    const { tools } = await testMcpConnection(link.userId, connection.id);
    const names = tools
      .map((tool) => (tool && typeof tool === "object" ? (tool as { name?: unknown }).name : undefined))
      .filter((value): value is string => typeof value === "string");
    report = tools.length === 1
      ? tr("Connected to {name}. Discovered 1 tool.", { name })
      : tr("Connected to {name}. Discovered {count} tools.", { name, count: tools.length });
    if (names.length) report += `\n${truncate(names.map((value) => `\`${truncate(value.replace(/[`\s]/g, ""), 80)}\``).join(", "), 1_500)}`;
  } catch (error) {
    report = tr("Test failed for {name}: {error}", { name, error: plain(discordErrorText(link.locale, error), 500) });
  }
  return connection.enabled ? report : `${report}\n${tr("It is turned off, so teammates cannot call it until you run /mcp enable.")}`;
}

function addModal(tr: Translate) {
  const text = (id: string, style: TextInputStyle, required: boolean, max: number) =>
    new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(required).setMaxLength(max);
  return new ModalBuilder()
    .setCustomId(customId(PREFIX, "add"))
    .setTitle(tr("Add an MCP server"))
    .addLabelComponents(
      new LabelBuilder().setLabel(tr("Name")).setTextInputComponent(text("name", TextInputStyle.Short, true, 120).setPlaceholder(tr("My tools"))),
      new LabelBuilder().setLabel(tr("Server URL")).setTextInputComponent(text("url", TextInputStyle.Short, true, 2_000).setPlaceholder("https://example.com/mcp")),
      new LabelBuilder()
        .setLabel(tr("Transport"))
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId("transport")
            .setRequired(true)
            .addOptions(
              { label: transports["streamable-http"], value: "streamable-http", default: true },
              { label: transports.sse, value: "sse" },
            ),
        ),
      new LabelBuilder()
        .setLabel(tr("Bearer token (optional)"))
        .setDescription(tr("Stored encrypted and never shown again."))
        .setTextInputComponent(text("secret", TextInputStyle.Short, false, 4_000)),
      new LabelBuilder()
        .setLabel(tr("Extra headers (optional)"))
        .setDescription(tr("One per line, as Key: value. Values are stored encrypted."))
        .setTextInputComponent(text("headers", TextInputStyle.Paragraph, false, 4_000).setPlaceholder("X-Workspace: demo")),
    );
}

function chosenTransport(interaction: ModalSubmitInteraction): McpConnection["transport"] {
  try {
    return interaction.fields.getStringSelectValues("transport").includes("sse") ? "sse" : "streamable-http";
  } catch {
    return "streamable-http";
  }
}

async function saveFromModal(interaction: ModalSubmitInteraction, ctx: FeatureContext) {
  const { link, tr } = ctx;
  const name = interaction.fields.getTextInputValue("name").trim();
  const url = interaction.fields.getTextInputValue("url").trim();
  const secret = interaction.fields.getTextInputValue("secret").trim();
  const parsed = parseHeaderLines(interaction.fields.getTextInputValue("headers"));
  if (!name || !url) return tr("Name and URL are required.");
  if (!parsed.ok) return tr("Header line {line} is not in the form Key: value.", { line: parsed.line });
  // Names are unique per account, and Discord commands find connections by name.
  if ((await listMcpConnections(link.userId)).some((item) => item.name.toLowerCase() === name.toLowerCase())) {
    return tr("A connection named {name} already exists. Choose another name, or delete that one first.", { name: plain(name, 120) });
  }
  let saved: McpConnection | null;
  try {
    saved = await saveMcpConnection({ userId: link.userId, name, url, transport: chosenTransport(interaction), secret: secret || undefined, headers: parsed.headers });
  } catch (error) {
    return tr("Could not save the connection: {error}", { error: plain(discordErrorText(link.locale, error), 500) });
  }
  if (!saved) return tr("Could not save the connection.");
  const lines = [
    tr("Saved {name} ({host}, {transport}). Test it before asking a teammate to call it.", {
      name: plain(saved.name, 120),
      host: hostOf(saved.url),
      transport: transports[saved.transport] ?? saved.transport,
    }),
  ];
  if (saved.hasSecret || saved.headerNames.length) lines.push(tr("The token and header values are stored encrypted and are not shown again."));
  // src/lib/mcp/index.ts drops an Authorization header so it cannot override the bearer token.
  if (Object.keys(parsed.headers).some((header) => header.toLowerCase() === "authorization")) {
    lines.push(tr("The Authorization header was left out. Put the token in the bearer token field instead."));
  }
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(customId(PREFIX, "test", saved.id)).setLabel(tr("Test now")).setStyle(ButtonStyle.Primary),
  );
  return { content: lines.join("\n"), components: [row] };
}

const nameOption = (option: SlashCommandStringOption) =>
  option.setName("name").setDescription("Connection name").setDescriptionLocalization("ja", "接続名").setRequired(true).setAutocomplete(true);

const connectorOption = (option: SlashCommandStringOption) =>
  option
    .setName("connector")
    .setDescription("Connector")
    .setDescriptionLocalization("ja", "コネクタ")
    .setRequired(true)
    // More connectors than the 25 fixed choices Discord allows, so they are suggested as typed.
    .setAutocomplete(true);

const command = dmCommand("mcp", "Connectors and custom MCP servers your teammates can call", "チームメイトが呼び出せるコネクタとカスタム MCP サーバー")
  .addSubcommand((sub) => sub.setName("list").setDescription("List connectors and your MCP connections").setDescriptionLocalization("ja", "コネクタと MCP 接続の一覧"))
  .addSubcommand((sub) =>
    sub.setName("connect").setDescription("Connect or sign in again to a connector").setDescriptionLocalization("ja", "コネクタに接続、または再サインイン").addStringOption(connectorOption),
  )
  .addSubcommand((sub) =>
    sub.setName("disconnect").setDescription("Disconnect a connector and delete its sign-in").setDescriptionLocalization("ja", "コネクタの接続を解除してサインイン情報を削除").addStringOption(connectorOption),
  )
  .addSubcommand((sub) => sub.setName("add").setDescription("Add an MCP server").setDescriptionLocalization("ja", "MCP サーバーを追加"))
  .addSubcommand((sub) =>
    sub.setName("test").setDescription("Check that a connection works and list its tools").setDescriptionLocalization("ja", "接続を確認してツールを一覧表示").addStringOption(nameOption),
  )
  .addSubcommand((sub) =>
    sub.setName("enable").setDescription("Let teammates call a connection").setDescriptionLocalization("ja", "チームメイトが接続を呼び出せるようにする").addStringOption(nameOption),
  )
  .addSubcommand((sub) =>
    sub.setName("disable").setDescription("Stop teammates from calling a connection").setDescriptionLocalization("ja", "チームメイトが接続を呼び出せないようにする").addStringOption(nameOption),
  )
  .addSubcommand((sub) =>
    sub.setName("delete").setDescription("Delete a connection and its saved secrets").setDescriptionLocalization("ja", "接続と保存したシークレットを削除").addStringOption(nameOption),
  );

export const feature: DiscordFeature = {
  commands: [command],
  prefix: PREFIX,
  opensModal: (interaction) => interaction.commandName === "mcp" && interaction.options.getSubcommand(false) === "add",
  async command(interaction, ctx) {
    const { link, tr } = ctx;
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "add") {
      await interaction.showModal(addModal(tr));
      return;
    }
    if (subcommand === "list") {
      await respond(interaction, listReply(await listMcpConnections(link.userId), link.locale, tr));
      return;
    }
    if (subcommand === "connect" || subcommand === "disconnect") {
      const entry = findByIdOrName([...mcpCatalog], interaction.options.getString("connector"));
      if (!entry) {
        await respond(interaction, tr("No connector with that name. Run /mcp list to see them."));
        return;
      }
      if (subcommand === "connect") {
        await respond(interaction, await connectReply(entry, ctx));
        return;
      }
      const connection = connectorRow(await listMcpConnections(link.userId), entry);
      if (!connection) {
        await respond(interaction, tr("{name} is not connected.", { name: entry.name }));
        return;
      }
      // The same confirmation and delete as a custom server: the row holds the sign-in.
      await respond(interaction, {
        content: tr("Disconnect {name}? Its sign-in is deleted, and teammates can no longer call it.", { name: entry.name }),
        components: [confirmRow(PREFIX, ["delete", connection.id], tr, tr("Disconnect"))],
      });
      return;
    }
    const connection = await ownConnection(link.userId, interaction.options.getString("name"));
    if (!connection) {
      await respond(interaction, tr("No MCP connection with that name. Run /mcp list to see yours."));
      return;
    }
    const name = plain(connection.name, 120);
    if (subcommand === "test") {
      await respond(interaction, await testReport(connection, ctx));
      return;
    }
    if (subcommand === "enable" || subcommand === "disable") {
      const enabled = subcommand === "enable";
      if (connection.enabled === enabled) {
        await respond(interaction, enabled ? tr("{name} is already on.", { name }) : tr("{name} is already off.", { name }));
        return;
      }
      await setMcpConnectionEnabled(link.userId, connection.id, enabled);
      await respond(
        interaction,
        enabled ? tr("Turned on {name}. Teammates can call its tools.", { name }) : tr("Turned off {name}. Teammates cannot call its tools until you turn it on again.", { name }),
      );
      return;
    }
    if (subcommand === "delete") {
      await respond(interaction, {
        content: tr("Delete the MCP connection {name}? Its saved token and headers are deleted too, and teammates can no longer call it.", { name }),
        components: [confirmRow(PREFIX, ["delete", connection.id], tr)],
      });
    }
  },
  async autocomplete(interaction, { link, tr }) {
    const focused = interaction.options.getFocused();
    const subcommand = interaction.options.getSubcommand(false);
    if (subcommand === "connect" || subcommand === "disconnect") {
      // Match keywords too, so "jira" finds Atlassian.
      const wanted = focused.trim().toLowerCase();
      const entries = mcpCatalog.filter((entry) => !wanted || [entry.name, ...(entry.keywords ?? [])].some((word) => word.toLowerCase().includes(wanted)));
      await interaction.respond(choices(entries, "", (entry) => entry.name, (entry) => entry.id));
      return;
    }
    const connections = (await listMcpConnections(link.userId)).filter((item) =>
      subcommand === "enable" ? !item.enabled : subcommand === "disable" ? item.enabled : true,
    );
    await interaction.respond(
      choices(connections, focused, (item) => `${item.name} — ${hostOf(item.url)}${item.enabled ? "" : ` (${tr("off")})`}`, (item) => item.id),
    );
  },
  async component(interaction, ctx, args) {
    const { link, tr } = ctx;
    // A test can take several seconds and the database may be remote.
    await interaction.deferUpdate();
    const [action, id] = args;
    const connection = action === "test" || action === "delete" ? (await listMcpConnections(link.userId)).find((item) => item.id === id) : undefined;
    if (!connection) {
      await updateMessage(interaction, tr("That connection no longer exists."));
      return;
    }
    if (action === "test") {
      await updateMessage(interaction, `${interaction.message.content}\n\n${await testReport(connection, ctx)}`);
      return;
    }
    const deleted = await deleteMcpConnection(link.userId, connection.id);
    await updateMessage(interaction, deleted ? tr("Deleted {name}.", { name: plain(connection.name, 120) }) : tr("That connection no longer exists."));
  },
  async modal(interaction, ctx, args) {
    await interaction.deferReply();
    if (args[0] !== "add") {
      await respond(interaction, ctx.tr("That form is no longer valid."));
      return;
    }
    await respond(interaction, await saveFromModal(interaction, ctx));
  },
};

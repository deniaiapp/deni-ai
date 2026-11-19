import { discordErrorText } from "../i18n";
import type { SlashCommandStringOption } from "discord.js";
import {
  disconnectPlugin,
  pluginKinds,
  pluginStatus,
  pluginWriteActions,
  setPluginAlwaysAllow,
  type PluginKind,
  type WriteAction,
} from "../../mcp/builtin-plugins";
import {
  choices,
  confirmRow,
  dmCommand,
  type DiscordFeature,
  inApp,
  respond,
  type Translate,
  updateMessage,
} from "../ui";

import { assertRateLimit, RateLimitError } from "../rate-limit";

/** Gmail, Google Drive, and GitHub: status, always-allow switches, and disconnecting. */

const PREFIX = "pl";
// The web app's Plugins dialog opens from this address (also where OAuth returns).
const PLUGINS_PATH = "/settings";

const labels: Record<PluginKind, string> = {
  gmail: "Gmail",
  drive: "Google Drive",
  github: "GitHub",
};
const providers: Record<PluginKind, string> = {
  gmail: "Google",
  drive: "Google",
  github: "GitHub",
};

export const pluginActions = pluginWriteActions;

/** English text; each one is a key in plugins.ja.ts. */
export const actionLabels: Record<WriteAction, string> = {
  send: "Send email",
  create: "Create files",
  update: "Update files",
  createIssue: "Create issues",
  createPR: "Open pull requests",
  comment: "Comment on issues and pull requests",
  updateIssue: "Edit, close, and reopen issues and pull requests",
  review: "Review pull requests",
  mergePR: "Merge pull requests",
  rerunWorkflow: "Re-run failed workflow jobs",
};

type PluginState = Awaited<ReturnType<typeof pluginStatus>>[number];

function isPluginKind(value: string | undefined): value is PluginKind {
  return pluginKinds.includes(value as PluginKind);
}

/** Match a typed kind or label. Only plugins the web app shows are listed by pluginStatus. */
function findPlugin(plugins: PluginState[], typed: string | null | undefined) {
  const wanted = typed?.trim().toLowerCase();
  if (!wanted) return undefined;
  return plugins.find(
    (plugin) => plugin.kind === wanted || labels[plugin.kind].toLowerCase() === wanted,
  );
}

function findAction(kind: PluginKind, typed: string | null, tr: Translate) {
  const wanted = typed?.trim().toLowerCase();
  if (!wanted) return undefined;
  return pluginActions[kind].find(
    (action) =>
      action.toLowerCase() === wanted ||
      actionLabels[action].toLowerCase() === wanted ||
      tr(actionLabels[action]).toLowerCase() === wanted,
  );
}

function describePlugin(plugin: PluginState, tr: Translate) {
  const head = `**${labels[plugin.kind]}** — ${plugin.connected ? tr("Connected · search and read") : tr("Not connected")}`;
  if (!plugin.connected) return head;
  const lines = [
    head,
    `  ${plugin.writeAccess ? tr("Write access: on") : tr("Write access: off")}`,
  ];
  if (plugin.writeAccess) {
    const allowed = plugin.alwaysAllow.map((action) => tr(actionLabels[action]));
    lines.push(
      `  ${tr("Always allowed: {actions}", { actions: allowed.length ? allowed.join(", ") : tr("none") })}`,
    );
  }
  return lines.join("\n");
}

function unavailable(plugins: PluginState[], tr: Translate) {
  return tr("That plugin is not available. Choose one of: {plugins}", {
    plugins: plugins.map((plugin) => labels[plugin.kind]).join(", ") || tr("none"),
  });
}

const kindOption = (option: SlashCommandStringOption) =>
  option
    .setName("kind")
    .setDescription("Plugin")
    .setDescriptionLocalization("ja", "プラグイン")
    .setRequired(true)
    .setAutocomplete(true);

const command = dmCommand(
  "plugins",
  "Gmail, Google Drive, and GitHub for your teammates",
  "チームメイトが使う Gmail・Google Drive・GitHub",
)
  .addSubcommand((sub) =>
    sub
      .setName("status")
      .setDescription("Show what is connected and which actions are always allowed")
      .setDescriptionLocalization("ja", "接続状況と常に許可している操作を表示"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("connect")
      .setDescription("Connect or reconnect a plugin in the app")
      .setDescriptionLocalization("ja", "アプリでプラグインを接続・再接続")
      .addStringOption(kindOption),
  )
  .addSubcommand((sub) =>
    sub
      .setName("disconnect")
      .setDescription("Disconnect a plugin and give its access back")
      .setDescriptionLocalization("ja", "プラグインの接続を解除してアクセス権を返す")
      .addStringOption(kindOption),
  )
  .addSubcommand((sub) =>
    sub
      .setName("allow")
      .setDescription("Let a write action run without asking you first")
      .setDescriptionLocalization("ja", "書き込み操作を確認なしで実行できるようにする")
      .addStringOption(kindOption)
      .addStringOption((option) =>
        option
          .setName("action")
          .setDescription("Write action")
          .setDescriptionLocalization("ja", "書き込み操作")
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addBooleanOption((option) =>
        option
          .setName("enabled")
          .setDescription("True to always allow, false to ask each time")
          .setDescriptionLocalization("ja", "True で常に許可、False で毎回確認")
          .setRequired(true),
      ),
  );

export const feature: DiscordFeature = {
  commands: [command],
  prefix: PREFIX,
  async command(interaction, { link, tr }) {
    const subcommand = interaction.options.getSubcommand();
    const plugins = await pluginStatus(link.userId);
    if (subcommand === "status") {
      const body = plugins.length
        ? plugins.map((plugin) => describePlugin(plugin, tr)).join("\n\n")
        : tr("No plugins are available right now.");
      await respond(
        interaction,
        `${body}\n\n${tr("Write actions wait for your approval unless they are always allowed. Change that with /plugins allow.")}`,
      );
      return;
    }
    const plugin = findPlugin(plugins, interaction.options.getString("kind"));
    if (!plugin) {
      await respond(interaction, unavailable(plugins, tr));
      return;
    }
    const params = { plugin: labels[plugin.kind], provider: providers[plugin.kind] };
    if (subcommand === "connect") {
      // OAuth needs a browser, so Discord only points the way.
      const line = !plugin.connected
        ? tr(
            "Connecting {plugin} needs a {provider} sign-in in your browser, so it is done in the app: open Plugins and choose Connect.",
            params,
          )
        : !plugin.writeAccess
          ? tr(
              "{plugin} is connected for search and read. To let teammates write too, open Plugins in the app and choose Enable write access.",
              params,
            )
          : tr(
              "{plugin} is already connected. To reconnect, open Plugins in the app and choose Reconnect.",
              params,
            );
      await respond(interaction, `${line}\n${inApp(tr, PLUGINS_PATH)}`);
      return;
    }
    if (subcommand === "disconnect") {
      if (!plugin.connected) {
        await respond(interaction, tr("{plugin} is not connected.", params));
        return;
      }
      await respond(interaction, {
        content: tr(
          "Disconnect {plugin}? Teammates will lose access to it right away. You can connect it again later.",
          params,
        ),
        components: [confirmRow(PREFIX, ["disconnect", plugin.kind], tr, tr("Disconnect"))],
      });
      return;
    }
    if (subcommand === "allow") {
      const action = findAction(plugin.kind, interaction.options.getString("action"), tr);
      const enabled = interaction.options.getBoolean("enabled", true);
      if (!action) {
        await respond(
          interaction,
          tr("Choose one of the write actions for {plugin}: {actions}", {
            ...params,
            actions: pluginActions[plugin.kind].map((item) => tr(actionLabels[item])).join(", "),
          }),
        );
        return;
      }
      if (enabled && !plugin.writeAccess) {
        const first = plugin.connected
          ? tr("Turn on write access for {plugin} in the app first.", params)
          : tr("Connect {plugin} in the app first.", params);
        await respond(interaction, `${first}\n${inApp(tr, PLUGINS_PATH)}`);
        return;
      }
      await setPluginAlwaysAllow(link.userId, plugin.kind, action, enabled);
      const named = { ...params, action: tr(actionLabels[action]) };
      await respond(
        interaction,
        enabled
          ? tr(
              "{action} in {plugin} is now always allowed: teammates do it without asking you first.",
              named,
            )
          : tr("{action} in {plugin} now waits for your approval each time.", named),
      );
    }
  },
  /** Only the plugins the web app shows, and only the actions that apply to the chosen one. */
  async autocomplete(interaction, { link, tr }) {
    const focused = interaction.options.getFocused(true);
    const plugins = await pluginStatus(link.userId);
    if (focused.name === "kind") {
      await interaction.respond(
        choices(
          plugins,
          focused.value,
          (plugin) =>
            `${labels[plugin.kind]} — ${plugin.connected ? tr("connected") : tr("not connected")}`,
          (plugin) => plugin.kind,
        ),
      );
      return;
    }
    const chosen = findPlugin(plugins, interaction.options.getString("kind"));
    const options = (chosen ? [chosen] : plugins).flatMap((plugin) =>
      pluginActions[plugin.kind].map((action) => ({ plugin, action })),
    );
    await interaction.respond(
      choices(
        options,
        focused.value,
        ({ plugin, action }) =>
          `${labels[plugin.kind]} · ${tr(actionLabels[action])}${plugin.alwaysAllow.includes(action) ? ` (${tr("always allowed")})` : ""}`,
        ({ action }) => action,
      ),
    );
  },
  async component(interaction, { link, tr }, args) {
    // Revoking at Google or GitHub can take longer than Discord's 3 seconds.
    await interaction.deferUpdate();
    const [action, kind] = args;
    const plugin =
      action === "disconnect" && isPluginKind(kind)
        ? findPlugin(await pluginStatus(link.userId), kind)
        : undefined;
    if (!plugin) {
      await updateMessage(interaction, tr("That plugin is not available."));
      return;
    }
    try {
      // The web app's limit for the same action.
      await assertRateLimit(link.userId, "plugin-disconnect", 20);
    } catch (error) {
      if (!(error instanceof RateLimitError)) throw error;
      await updateMessage(interaction, tr("Too many requests. Wait a moment and try again."));
      return;
    }
    try {
      await disconnectPlugin(link.userId, plugin.kind);
    } catch (error) {
      await updateMessage(
        interaction,
        discordErrorText(link.locale, error) || tr("Could not disconnect plugin."),
      );
      return;
    }
    await updateMessage(
      interaction,
      tr("Disconnected {plugin}. Teammates can no longer use it.", { plugin: labels[plugin.kind] }),
    );
  },
};

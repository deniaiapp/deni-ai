import dotenv from "dotenv";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from "discord.js";
import { mockModules } from "./module-mocks";

dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: ".env.local", override: true, quiet: true });

mockModules((request) => {
  if (request === "server-only") return {};
  if (request === "next/headers") return { headers: async () => new Headers() };
  return undefined;
});

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

type Sent = { content?: string; components?: { toJSON(): { components: { custom_id?: string }[] } }[] };

const textOf = (sent: Sent[]) => sent.map((message) => message.content ?? "").join("\n");
const idsOf = (sent: Sent[]) => sent.flatMap((message) => message.components ?? []).flatMap((row) => row.toJSON().components.map((item) => item.custom_id ?? ""));

/** Just enough of a deferred slash command for respond() and the handlers. */
function slash(commandName: string, subcommand: string, values: Record<string, string | boolean> = {}) {
  const sent: Sent[] = [];
  let modal: ModalBuilder | null = null;
  const push = async (message: Sent) => {
    sent.push(message);
  };
  const interaction = {
    commandName,
    deferred: true,
    replied: false,
    options: {
      getSubcommand: () => subcommand,
      getString: (name: string) => (typeof values[name] === "string" ? values[name] : null),
      getBoolean: (name: string) => (typeof values[name] === "boolean" ? values[name] : null),
    },
    editReply: push,
    reply: push,
    followUp: push,
    showModal: async (value: ModalBuilder) => {
      modal = value;
    },
  };
  return { interaction: interaction as unknown as ChatInputCommandInteraction, sent, modal: () => modal };
}

function button(content: string) {
  const sent: Sent[] = [];
  const interaction = {
    deferred: false,
    replied: false,
    message: { content },
    deferUpdate: async () => {
      interaction.deferred = true;
    },
    editReply: async (message: Sent) => {
      sent.push(message);
    },
    update: async (message: Sent) => {
      sent.push(message);
    },
  };
  return { interaction: interaction as unknown as StringSelectMenuInteraction, sent };
}

function modalSubmit(fields: Record<string, string>, transport: string[] = []) {
  const sent: Sent[] = [];
  const push = async (message: Sent) => {
    sent.push(message);
  };
  const interaction = {
    deferred: false,
    replied: false,
    fields: {
      getTextInputValue: (id: string) => fields[id] ?? "",
      getStringSelectValues: () => transport,
    },
    deferReply: async () => {
      interaction.deferred = true;
    },
    editReply: push,
    reply: push,
    followUp: push,
  };
  return { interaction: interaction as unknown as ModalSubmitInteraction, sent };
}

function autocomplete(focused: { name: string; value: string }, values: Record<string, string> = {}, subcommand = "") {
  let answered: { name: string; value: string }[] = [];
  const interaction = {
    options: {
      getFocused: (full?: boolean) => (full ? focused : focused.value),
      getString: (name: string) => values[name] ?? null,
      getSubcommand: () => subcommand,
    },
    respond: async (list: { name: string; value: string }[]) => {
      answered = list;
    },
  };
  return { interaction: interaction as unknown as AutocompleteInteraction, answered: () => answered };
}

let tempDir = "";

// Only plugins the web shows are reachable, always-allow only takes actions that apply, a
// disconnect asks first, and MCP connections never echo secrets or reach another account.
async function main() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "deni-discord-plugins-"));
  delete process.env.D1_PROXY_URL;
  process.env.LOCAL_DB_PATH = path.join(tempDir, "test.sqlite");
  process.env.APP_ENCRYPTION_KEY ||= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  process.env.BETTER_AUTH_SECRET ||= "verify-discord-plugins-secret-verify";
  process.env.BETTER_AUTH_URL = "https://app.example.test";
  // Without app credentials GitHub revocation is skipped, so no real request leaves the test.
  delete process.env.GITHUB_CLIENT_ID;
  delete process.env.GITHUB_CLIENT_SECRET;
  delete process.env.DISABLED_PLUGINS;

  const calls: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
  let googleRevokeStatus = 200;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = String(init?.body ?? "");
    calls.push({ url, method: init?.method ?? "GET", headers, body });
    if (url === "https://oauth2.googleapis.com/revoke") return new Response("{}", { status: googleRevokeStatus });
    if (url.startsWith("https://mcp.example.test/")) {
      const method = (JSON.parse(body) as { method: string }).method;
      if (method.startsWith("notifications/")) return new Response(null, { status: 202 });
      const result = method === "tools/list" ? { tools: [{ name: "echo" }, { name: "search" }] } : { protocolVersion: "2025-11-25", capabilities: {} };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { headers: { "content-type": "application/json" } });
    }
    if (url.startsWith("https://down.example.test/")) return new Response("down", { status: 500 });
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  const { db } = await import("../db");
  const { user, account, mcpConnections } = await import("../db/schema");
  const { eq } = await import("drizzle-orm");
  const { discordTranslator: translatorFor } = await import("../lib/discord-i18n");
  const store = await import("../lib/store");
  const builtin = await import("../lib/builtin-plugins");
  const mcpLib = await import("../lib/mcp");
  const plugins = await import("../lib/discord-features/plugins");
  const mcp = await import("../lib/discord-features/mcp");
  const { discordJa: merged } = await import("../lib/discord-i18n");
  const { ja: pluginsJa } = await import("../lib/discord-features/plugins.ja");
  const { ja: mcpJa } = await import("../lib/discord-features/mcp.ja");

  const ctx = (userId: string, locale = "en") => ({
    link: { userId, discordUserId: `d-${userId}`, discordUsername: userId, botId: null, locale, createdAt: "" },
    tr: translatorFor(locale),
  });

  for (const id of ["u1", "u2"]) await db.insert(user).values({ id, name: id, email: `${id}@example.com`, emailVerified: true });
  const gmailRead = "https://www.googleapis.com/auth/gmail.readonly";
  const drive = "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file";
  await db.insert(account).values([
    { id: "a-google", accountId: "g1", providerId: "google", userId: "u1", scope: `openid email ${gmailRead} ${drive}`, accessToken: "g-access", refreshToken: "g-refresh" },
    { id: "a-github", accountId: "h1", providerId: "github", userId: "u1", scope: "user:email,repo", accessToken: "h-access" },
  ]);

  const pf = plugins.feature;
  const runPlugins = async (userId: string, subcommand: string, values: Record<string, string | boolean> = {}, locale = "en") => {
    const call = slash("plugins", subcommand, values);
    await pf.command!(call.interaction, ctx(userId, locale));
    return call;
  };

  // Visibility follows the web: Gmail and Drive are hidden unless DISABLED_PLUGINS says otherwise.
  let status = textOf((await runPlugins("u1", "status")).sent);
  assert(status.includes("**GitHub**") && !status.includes("Gmail") && !status.includes("Google Drive"), `hidden plugins shown: ${status}`);
  const kinds = autocomplete({ name: "kind", value: "" });
  await pf.autocomplete!(kinds.interaction, ctx("u1"));
  assert(kinds.answered().map((item) => item.value).join() === "github", `autocomplete offered hidden plugins: ${JSON.stringify(kinds.answered())}`);
  assert(textOf((await runPlugins("u1", "connect", { kind: "gmail" })).sent).includes("not available"), "a hidden plugin was offered for connecting");
  const hiddenAllow = await runPlugins("u1", "allow", { kind: "drive", action: "create", enabled: true });
  assert(textOf(hiddenAllow.sent).includes("not available") && !(await store.readStore("u1")).pluginAlwaysAllow?.["drive:create"], "a hidden plugin was changed");

  process.env.DISABLED_PLUGINS = "";
  status = textOf((await runPlugins("u1", "status")).sent);
  assert(["**Gmail**", "**Google Drive**", "**GitHub**"].every((label) => status.includes(label)), `status: ${status}`);
  assert(/\*\*Gmail\*\*[^*]*Write access: off/.test(status) && /\*\*Google Drive\*\*[^*]*Write access: on/.test(status), `write access: ${status}`);
  const jaStatus = textOf((await runPlugins("u2", "status", {}, "ja")).sent);
  assert(jaStatus.includes("未接続") && jaStatus.includes("/plugins allow"), `ja status: ${jaStatus}`);

  // Connecting needs a browser, so Discord answers with the app's Plugins link.
  const connect = textOf((await runPlugins("u1", "connect", { kind: "Gmail" })).sent);
  assert(connect.includes("Enable write access") && connect.includes("https://app.example.test/?plugins=1"), `connect: ${connect}`);
  const jaConnect = textOf((await runPlugins("u2", "connect", { kind: "github" }, "ja")).sent);
  assert(jaConnect.includes("サインイン") && jaConnect.includes("https://app.example.test/?plugins=1"), `ja connect: ${jaConnect}`);

  // Always allow: only the chosen plugin's actions, write access first, and only the sender's store.
  for (const kind of builtin.pluginKinds) {
    for (const action of builtin.writeActions) {
      const applies = plugins.pluginActions[kind].includes(action);
      const accepted = await builtin.setPluginAlwaysAllow("u2", kind, action, false).then(() => true, () => false);
      assert(accepted === applies, `pluginActions drifted from lib/builtin-plugins.ts for ${kind}:${action}`);
    }
  }
  const wrongAction = textOf((await runPlugins("u1", "allow", { kind: "github", action: "send", enabled: true })).sent);
  assert(wrongAction.includes("Create issues") && !(await store.readStore("u1")).pluginAlwaysAllow?.["github:send"], `wrong action: ${wrongAction}`);
  const noWrite = textOf((await runPlugins("u1", "allow", { kind: "gmail", action: "send", enabled: true })).sent);
  assert(noWrite.includes("write access") && !(await store.readStore("u1")).pluginAlwaysAllow?.["gmail:send"], `no write access: ${noWrite}`);
  const allowed = textOf((await runPlugins("u1", "allow", { kind: "github", action: "createIssue", enabled: true })).sent);
  assert(allowed.includes("always allowed") && (await store.readStore("u1")).pluginAlwaysAllow?.["github:createIssue"] === true, `allow: ${allowed}`);
  await runPlugins("u1", "allow", { kind: "drive", action: "Create files", enabled: true });
  assert((await store.readStore("u1")).pluginAlwaysAllow?.["drive:create"] === true, "an action typed by its label was not accepted");
  assert(!(await store.readStore("u2")).pluginAlwaysAllow?.["github:createIssue"], "another account's store changed");
  assert(textOf((await runPlugins("u1", "status")).sent).includes("Always allowed: Create issues"), "status does not show always-allowed actions");
  const actions = autocomplete({ name: "action", value: "" }, { kind: "github" });
  await pf.autocomplete!(actions.interaction, ctx("u1"));
  assert(actions.answered().map((item) => item.value).join() === "createIssue,createPR,comment", `action choices: ${JSON.stringify(actions.answered())}`);
  assert(actions.answered()[0].name.includes("always allowed"), "action choices do not show the current state");

  // Disconnect asks first, then reports what the web reports; buttons are checked against the sender.
  assert(textOf((await runPlugins("u2", "disconnect", { kind: "github" })).sent).includes("is not connected"), "disconnecting an unconnected plugin was offered");
  const ask = await runPlugins("u1", "disconnect", { kind: "github" });
  assert(textOf(ask.sent).includes("Disconnect GitHub?") && idsOf(ask.sent).join() === "pl:disconnect:github,pl:cancel", `confirm: ${JSON.stringify(idsOf(ask.sent))}`);
  const bogus = button("Disconnect?");
  await pf.component!(bogus.interaction, ctx("u1"), ["disconnect", "bogus"]);
  assert(textOf(bogus.sent).includes("not available"), "an unknown plugin id was accepted");
  const confirm = button("Disconnect GitHub?");
  await pf.component!(confirm.interaction, ctx("u1"), ["disconnect", "github"]);
  assert(textOf(confirm.sent).includes("Disconnected GitHub. Teammates can no longer use it."), `disconnect: ${textOf(confirm.sent)}`);
  const github = (await db.select().from(account).where(eq(account.id, "a-github")))[0];
  assert(github.scope === "user:email" && github.accessToken === null, `github scope: ${github.scope}`);
  assert((await store.readStore("u1")).pluginAlwaysAllow?.["github:createIssue"] === undefined, "always-allow survived the disconnect");

  process.env.DISABLED_PLUGINS = "gmail";
  const hidden = button("Disconnect Gmail?");
  await pf.component!(hidden.interaction, ctx("u1"), ["disconnect", "gmail"]);
  assert(textOf(hidden.sent).includes("not available"), "a hidden plugin was disconnected");
  process.env.DISABLED_PLUGINS = "";

  // Drive goes while Gmail stays (no revoke); Gmail last needs Google, whose failure is reported in Japanese.
  await pf.component!(button("").interaction, ctx("u1"), ["disconnect", "drive"]);
  assert(!calls.some((call) => call.url.includes("oauth2.googleapis.com")), "Google was revoked while Gmail was still connected");
  googleRevokeStatus = 503;
  const failed = button("");
  await pf.component!(failed.interaction, ctx("u1", "ja"), ["disconnect", "gmail"]);
  assert(textOf(failed.sent).includes("Google 側のアクセス権を取り消せませんでした"), `revoke failure: ${textOf(failed.sent)}`);
  assert((await db.select().from(account).where(eq(account.id, "a-google")))[0].scope?.includes(gmailRead) === true, "a failed revoke still dropped Gmail");

  // MCP: add opens a modal (not deferred), at most five inputs.
  const mf = mcp.feature;
  const opens = (subcommand: string) => mf.opensModal!(slash("mcp", subcommand).interaction);
  assert(opens("add") && !opens("list") && !opens("delete"), "only /mcp add opens a modal");
  const add = slash("mcp", "add");
  await mf.command!(add.interaction, ctx("u1"));
  const shown = add.modal()?.toJSON();
  assert(shown?.custom_id === "mc:add" && shown.components.length === 5, `modal: ${JSON.stringify(shown)}`);

  const submit = async (userId: string, fields: Record<string, string>, transport: string[] = [], locale = "en") => {
    const call = modalSubmit(fields, transport);
    await mf.modal!(call.interaction, ctx(userId, locale), ["add"]);
    return call;
  };
  const rows = async (userId: string) => db.select().from(mcpConnections).where(eq(mcpConnections.userId, userId));

  const saved = await submit("u1", {
    name: "Tools",
    url: "https://mcp.example.test/mcp?token=query-secret-1",
    secret: "bearer-secret-2",
    headers: "X-Workspace: header-secret-3\n\nAuthorization: Bearer header-secret-4",
  });
  const savedText = textOf(saved.sent);
  assert(savedText.includes("Saved Tools (mcp.example.test, Streamable HTTP)") && savedText.includes("stored encrypted") && savedText.includes("Authorization header was left out"), `saved: ${savedText}`);
  assert(!/secret-\d/.test(savedText), "a secret was echoed");
  const [tools] = await rows("u1");
  assert(tools.transport === "streamable-http" && tools.authSecret?.startsWith("enc:v1:") === true, "the bearer token is not stored encrypted");
  assert(Object.keys(tools.headers).join() === "X-Workspace" && tools.headers["X-Workspace"].startsWith("enc:v1:"), `headers: ${JSON.stringify(Object.keys(tools.headers))}`);
  assert(idsOf(saved.sent).join() === `mc:test:${tools.id}`, "no Test now button");

  const badLine = textOf((await submit("u1", { name: "Bad", url: "https://mcp.example.test/x", headers: "X-Ok: 1\nsecret-without-colon-5" })).sent);
  assert(badLine.includes("Header line 2") && !badLine.includes("secret-without-colon-5"), `bad header: ${badLine}`);
  const badName = textOf((await submit("u1", { name: "Bad", url: "https://mcp.example.test/x", headers: "X Bad: 1" })).sent);
  assert(badName.includes("Invalid MCP header: X Bad"), `invalid header name: ${badName}`);
  const badUrl = textOf((await submit("u1", { name: "Bad", url: "ftp://mcp.example.test/x" }, [], "ja")).sent);
  assert(badUrl.includes("http または https"), `bad url: ${badUrl}`);
  assert(textOf((await submit("u1", { name: " ", url: "https://mcp.example.test/x" })).sent).includes("Name and URL are required"), "a blank name was accepted");
  assert(textOf((await submit("u1", { name: "tools", url: "https://mcp.example.test/x" })).sent).includes("already exists"), "a duplicate name was accepted");
  assert((await rows("u1")).length === 1, "a refused form saved a connection");
  // The web route shares the rule through lib/mcp.ts: no raw UNIQUE error, and renaming onto another name is refused.
  const { saveMcpConnection: save } = await import("../lib/mcp");
  const duplicate = await save({ userId: "u1", name: "TOOLS", url: "https://mcp.example.test/y" }).then(() => "saved", (error: Error) => error.message);
  assert(duplicate === "An MCP connection with this name already exists", `lib duplicate: ${duplicate}`);
  const kept = (await rows("u1"))[0];
  assert((await save({ userId: "u1", id: kept.id, name: "Tools", url: "https://mcp.example.test/x" }))?.name === "Tools", "renaming a connection to its own name in another case was refused");
  await submit("u1", { name: "Events", url: "https://down.example.test/sse" }, ["sse"]);
  const events = (await rows("u1")).find((row) => row.name === "Events")!;
  assert(events.transport === "sse" && events.authSecret === null, "SSE transport not saved");

  const runMcp = async (userId: string, subcommand: string, values: Record<string, string> = {}, locale = "en") => {
    const call = slash("mcp", subcommand, values);
    await mf.command!(call.interaction, ctx(userId, locale));
    return call;
  };

  // List: host, transport, switch, test state. Never the URL's path or query, the token, or header values.
  let list = textOf((await runMcp("u1", "list")).sent);
  assert(["**Tools**", "`mcp.example.test`", "Streamable HTTP", "SSE", "token saved", "not tested"].every((part) => list.includes(part)), `list: ${list}`);
  assert(!/secret-\d|\/mcp|token=/.test(list), `list leaked a secret: ${list}`);

  // Test: by name or id, sends the stored credentials, and records the result.
  const tested = textOf((await runMcp("u1", "test", { name: "tools" })).sent);
  assert(tested.includes("Discovered 2 tools") && tested.includes("`echo`"), `test: ${tested}`);
  const sentToServer = calls.find((call) => call.url.startsWith("https://mcp.example.test/"));
  assert(sentToServer?.headers.authorization === "Bearer bearer-secret-2" && sentToServer.headers["x-workspace"] === "header-secret-3", "stored credentials not used");
  const down = button("Saved Events.");
  await mf.component!(down.interaction, ctx("u1"), ["test", events.id]);
  assert(textOf(down.sent).includes("Test failed for Events: MCP SSE connection failed (500)"), `failed test: ${textOf(down.sent)}`);
  list = textOf((await runMcp("u1", "list")).sent);
  assert(list.includes("last test passed") && list.includes("last test failed"), `list after tests: ${list}`);

  // Enable/disable flips only the switch: the failed test stays visible, and a disabled server cannot be called.
  assert(textOf((await runMcp("u1", "disable", { name: events.id })).sent).includes("Turned off Events"), "disable not confirmed");
  const off = (await rows("u1")).find((row) => row.id === events.id)!;
  assert(!off.enabled && Boolean(off.lastError), "disabling changed more than the switch");
  assert(await mcpLib.callMcpTool("u1", events.id, "echo", {}).then(() => false, (error: Error) => error.message === "MCP connection is not available"), "a disabled connection was callable");
  assert(textOf((await runMcp("u1", "disable", { name: "Events" })).sent).includes("already off"), "disable twice");
  const enableChoices = autocomplete({ name: "name", value: "" }, {}, "enable");
  await mf.autocomplete!(enableChoices.interaction, ctx("u1"));
  assert(enableChoices.answered().map((item) => item.value).join() === events.id, `enable choices: ${JSON.stringify(enableChoices.answered())}`);
  await runMcp("u1", "enable", { name: "Events" });
  assert((await rows("u1")).find((row) => row.id === events.id)?.enabled === true, "enable did not save");

  // Another account never reaches these connections, by name, id, button, or autocomplete.
  assert(textOf((await runMcp("u2", "test", { name: tools.id })).sent).includes("No MCP connection"), "another account tested by id");
  assert(textOf((await runMcp("u2", "disable", { name: "Tools" })).sent).includes("No MCP connection"), "another account disabled by name");
  const foreign = button("Delete?");
  await mf.component!(foreign.interaction, ctx("u2"), ["delete", tools.id]);
  assert(textOf(foreign.sent).includes("no longer exists") && (await rows("u1")).length === 2, "another account deleted a connection");
  const foreignChoices = autocomplete({ name: "name", value: "" }, {}, "test");
  await mf.autocomplete!(foreignChoices.interaction, ctx("u2"));
  assert(foreignChoices.answered().length === 0, "autocomplete showed another account's connections");
  assert(textOf((await runMcp("u2", "list", {}, "ja")).sent).includes("MCP 接続はまだありません"), "ja empty list");

  // Delete asks first.
  const confirmDelete = await runMcp("u1", "delete", { name: "Tools" });
  assert(idsOf(confirmDelete.sent).join() === `mc:delete:${tools.id},mc:cancel` && (await rows("u1")).length === 2, "delete did not ask first");
  const deleted = button("Delete?");
  await mf.component!(deleted.interaction, ctx("u1"), ["delete", tools.id]);
  assert(textOf(deleted.sent).includes("Deleted Tools.") && (await rows("u1")).length === 1, "delete failed");

  // Every string has Japanese with the same placeholders, and no other dictionary overrides it.
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join();
  for (const [file, own] of [["plugins", pluginsJa], ["mcp", mcpJa]] as const) {
    const source = await readFile(path.join("lib", "discord-features", `${file}.ts`), "utf8");
    const keys = [...source.matchAll(/\btr\(\s*"((?:[^"\\]|\\.)*)"/g)].map((match) => JSON.parse(`"${match[1]}"`) as string);
    if (file === "plugins") keys.push(...Object.values(plugins.actionLabels));
    for (const key of keys) assert(key in merged, `${file}: no Japanese for "${key}"`);
    for (const [key, value] of Object.entries(own)) {
      assert(placeholders(key) === placeholders(value), `${file}.ja: placeholders differ for "${key}"`);
      assert(merged[key] === value, `${file}.ja: "${key}" is overridden by another dictionary`);
    }
  }

  // Command shapes Discord accepts.
  for (const command of [...pf.commands, ...mf.commands]) {
    const json = command.toJSON();
    const options = (json.options ?? []) as { name: string; description: string; description_localizations?: Record<string, string> | null; options?: { name: string; description: string; description_localizations?: Record<string, string> | null }[] }[];
    for (const item of [json, ...options, ...options.flatMap((option) => option.options ?? [])]) {
      assert(/^[a-z]+$/.test(item.name) && item.description.length <= 100 && Boolean(item.description_localizations?.ja), `command shape: ${item.name}`);
    }
  }

  console.log("discord plugins and MCP verification passed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    process.exit();
  });

import dotenv from "dotenv";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  ActionRowBuilder,
  AttachmentBuilder,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  MessageActionRowComponentBuilder,
} from "discord.js";
import { mockModules } from "./module-mocks";

dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: ".env.local", override: true, quiet: true });
// The workspace must fall back to the local .deni directory: no test may reach real storage,
// a real sandbox, or a real browser service.
for (const key of Object.keys(process.env)) if (key.startsWith("S3_")) delete process.env[key];
delete process.env.E2B_API_KEY;
delete process.env.STEEL_API_KEY;

mockModules((request) => {
  if (request === "@tanstack/react-start/server-only") return {};
  return undefined;
});

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

type Sent = {
  content?: string;
  files?: AttachmentBuilder[];
  components?: ActionRowBuilder<MessageActionRowComponentBuilder>[];
};

function command(sub: string, options: Record<string, string> = {}) {
  const sent: Sent[] = [];
  const record = async (message: Sent) => {
    sent.push(message);
  };
  const interaction = {
    deferred: true,
    replied: false,
    options: {
      getSubcommand: () => sub,
      getString: (name: string, required?: boolean) => {
        if (options[name] === undefined && required) throw new Error(`missing option ${name}`);
        return options[name] ?? null;
      },
    },
    reply: record,
    editReply: record,
    followUp: record,
  };
  return { interaction: interaction as unknown as ChatInputCommandInteraction, sent };
}

function component(customId: string, options: { select?: string[]; content?: string } = {}) {
  const sent: Sent[] = [];
  const followUps: Sent[] = [];
  const interaction = {
    customId,
    values: options.select ?? [],
    deferred: false,
    replied: false,
    message: { content: options.content ?? "" },
    isButton: () => !options.select,
    isStringSelectMenu: () => Boolean(options.select),
    deferUpdate: async () => {
      interaction.deferred = true;
    },
    update: async (message: Sent) => {
      sent.push(message);
    },
    editReply: async (message: Sent) => {
      sent.push(message);
    },
    followUp: async (message: Sent) => {
      followUps.push(message);
    },
  };
  return { interaction, sent, followUps, args: customId.split(":").slice(1) };
}

function autocomplete(sub: string, value: string) {
  const result: { name: string; value: string }[][] = [];
  const interaction = {
    options: { getFocused: () => ({ name: "path", value }), getSubcommand: () => sub },
    respond: async (items: { name: string; value: string }[]) => {
      result.push(items);
    },
  };
  return { interaction: interaction as unknown as AutocompleteInteraction, result };
}

function customIds(message: Sent | undefined) {
  return (message?.components ?? []).flatMap((row) =>
    row.toJSON().components.map((item) => (item as { custom_id?: string }).custom_id ?? ""),
  );
}

function only(sent: Sent[]) {
  assert(sent.length === 1, `expected one message, got ${sent.length}`);
  const [message] = sent;
  const content = message.content ?? "";
  assert(content.length <= 2_000, `message too long: ${content.length}`);
  return { ...message, content };
}

let tempDir = "";
const cleanups: (() => Promise<unknown>)[] = [];

// Files and the computer from Discord: only the sender's own workspace is reachable, the
// workspace root can never be deleted, uploads stay under Discord's limit, and every string
// the commands show has Japanese.
async function main() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "deni-discord-files-"));
  delete process.env.D1_PROXY_URL;
  process.env.LOCAL_DB_PATH = path.join(tempDir, "test.sqlite");
  process.env.APP_ENCRYPTION_KEY ||= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

  const storage = await import("../lib/storage");
  assert(!storage.hasObjectStorage(), "object storage is configured; refusing to touch a real bucket");
  const { db } = await import("../db");
  const { user } = await import("../db/schema");
  const workspace = await import("../lib/workspace");
  const paths = await import("../lib/paths");
  const store = await import("../lib/store");
  const artifacts = await import("../lib/artifacts");
  const computerLib = await import("../lib/computer");
  const { discordTranslator: translatorFor } = await import("../lib/discord-i18n");
  const files = await import("../lib/discord-features/files");
  const computer = await import("../lib/discord-features/computer");
  const { ja: filesJa } = await import("../lib/discord-features/files.ja");
  const { ja: computerJa } = await import("../lib/discord-features/computer.ja");

  const suffix = Math.random().toString(36).slice(2, 10);
  const u1 = `verify-files-a-${suffix}`;
  const u2 = `verify-files-b-${suffix}`;
  for (const id of [u1, u2]) {
    await db.insert(user).values({ id, name: id, email: `${id}@example.com`, emailVerified: true });
    cleanups.push(() => rm(paths.userDataDir(id), { recursive: true, force: true }));
    cleanups.push(() => workspace.deleteWorkspaceContents(id));
  }

  // Every key a handler uses is recorded, then checked for Japanese at the end.
  const used = new Set<string>();
  const english = translatorFor("en");
  const japanese = translatorFor("ja");
  const tr = (key: string, params?: Record<string, string | number>) => {
    used.add(key);
    return english(key, params);
  };
  const trJa = (key: string, params?: Record<string, string | number>) => {
    used.add(key);
    return japanese(key, params);
  };
  const link = (userId: string) => ({ userId, discordUserId: `d-${userId}`, discordUsername: userId, botId: null, locale: "en", createdAt: new Date().toISOString() });
  const ctx1 = { link: link(u1), tr };
  const ctx2 = { link: link(u2), tr };
  const run = async (feature: typeof files.feature, ctx: typeof ctx1, sub: string, options?: Record<string, string>) => {
    const call = command(sub, options);
    await feature.command?.(call.interaction, ctx);
    return call.sent;
  };
  const press = async (feature: typeof files.feature, ctx: typeof ctx1, customId: string, options?: { select?: string[]; content?: string }) => {
    const call = component(customId, options);
    await feature.component?.(call.interaction as never, ctx, call.args);
    return call;
  };

  await mutateBots(store, u1);
  const report = "# Report\n";
  await workspace.writeWorkspaceFile(u1, "outbox/report.md", report);
  await workspace.writeWorkspaceFile(u1, "projects/site/index.html", "<h1>Hi</h1>");
  await workspace.writeWorkspaceFile(u1, "projects/site/css/app.css", "body{}");
  for (let index = 0; index < 101; index += 1) {
    await workspace.writeWorkspaceFile(u1, `many/a-file-with-a-fairly-long-name-${String(index).padStart(3, "0")}.txt`, "x");
  }
  await workspace.writeWorkspaceBytes(u1, "bulk/one.bin", new Uint8Array(6_000_000));
  await workspace.writeWorkspaceBytes(u1, "bulk/two.bin", new Uint8Array(6_000_000));
  // Over the upload cap, so it is written directly; the workspace refuses uploads this big.
  const bigPath = path.join(paths.userWorkspaceDir(u1), "outbox", "big.bin");
  await mkdir(path.dirname(bigPath), { recursive: true });
  await writeFile(bigPath, new Uint8Array(files.UPLOAD_LIMIT + 1));
  const longRel = `deep/${"x".repeat(100)}.txt`;
  await workspace.writeWorkspaceFile(u1, longRel, "long");
  await workspace.writeWorkspaceFile(u2, "outbox/mine.md", "u2's file");

  // Shared helpers: paths stay inside the workspace, entries resolve, zips keep the web caps.
  let escaped = false;
  try {
    workspace.normalizeWorkspacePath("../etc/passwd");
  } catch {
    escaped = true;
  }
  assert(escaped, "a path outside the workspace was accepted");
  assert(workspace.normalizeWorkspacePath("/outbox//./report.md") === "outbox/report.md", "path not normalized");
  assert((await workspace.findWorkspaceEntry(u1, "outbox/report.md"))?.type === "file", "file entry not found");
  assert((await workspace.findWorkspaceEntry(u1, "projects"))?.type === "dir", "folder entry not found");
  assert((await workspace.findWorkspaceEntry(u1, "nope/missing.txt")) === null, "missing entry found");
  assert((await workspace.findWorkspaceEntry(u1, "outbox/report.md/inner")) === null, "entry inside a file found");
  assert((await workspace.findWorkspaceEntry(u2, "outbox/report.md")) === null, "another user's file was found");
  assert((await workspace.findWorkspaceEntry(u1, "/"))?.path === "/", "root entry");
  const zipped = await workspace.zipWorkspaceFiles(u1, ["projects"]);
  assert(zipped.ok && zipped.files === 2 && zipped.data.subarray(0, 2).toString() === "PK", "folder zip");
  const tooMany = await workspace.zipWorkspaceFiles(u1, ["many"], { maxFiles: 1_000 });
  assert(!tooMany.ok && tooMany.reason === "too_many" && tooMany.max === workspace.WORKSPACE_ZIP_MAX_FILES, "a caller raised the file cap");
  const bulk = await workspace.zipWorkspaceFiles(u1, ["bulk"], { maxBytes: files.UPLOAD_LIMIT });
  assert(!bulk.ok && bulk.reason === "too_large", "zip over the size cap");
  assert((await workspace.zipWorkspaceFiles(u1, ["bulk"])).ok, "zip under the web cap refused");
  const empty = await workspace.zipWorkspaceFiles(u1, ["nothing-here"]);
  assert(!empty.ok && empty.reason === "empty", "empty zip");

  // /files list: a tree with sizes that fits one message.
  const root = only(await run(files.feature, ctx1, "list"));
  assert(root.content?.includes("outbox/") && root.content.includes("report.md  9 B") && root.content.includes("projects/"), `root listing: ${root.content}`);
  assert(!root.content.includes("app.css"), "listing went deeper than two levels");
  const crowded = only(await run(files.feature, ctx1, "list", { path: "/many" }));
  assert(crowded.content?.includes("more") ?? false, "a long listing was not cut with +N more");
  assert(only(await run(files.feature, ctx1, "list", { path: "outbox/report.md" })).content?.includes("is a file") ?? false, "listing a file");
  assert(only(await run(files.feature, ctx1, "list", { path: "missing" })).content?.includes("Nothing found") ?? false, "listing a missing folder");
  assert(only(await run(files.feature, ctx2, "list")).content?.includes("mine.md") ?? false, "second user's listing");
  assert(!only(await run(files.feature, ctx2, "list")).content?.includes("report.md"), "a listing showed another user's files");

  // /files get: a file as itself, a folder as a zip, nothing over Discord's limit.
  const got = only(await run(files.feature, ctx1, "get", { path: "/outbox/report.md" }));
  assert(got.files?.[0]?.name === "report.md" && Buffer.from(got.files[0].attachment as Buffer).toString() === report, "file attachment");
  const site = only(await run(files.feature, ctx1, "get", { path: "projects/site" }));
  assert(site.files?.[0]?.name === "site.zip" && (site.content?.includes("files: 2") ?? false), `folder zip: ${site.content}`);
  const big = only(await run(files.feature, ctx1, "get", { path: "outbox/big.bin" }));
  assert(!big.files?.length && (big.content?.includes("10 MB") ?? false), "a file over the limit was sent");
  const bulkGet = only(await run(files.feature, ctx1, "get", { path: "bulk" }));
  assert(!bulkGet.files?.length && (bulkGet.content?.includes("10 MB") ?? false), "a folder over the limit was sent");
  const manyGet = only(await run(files.feature, ctx1, "get", { path: "many" }));
  assert(!manyGet.files?.length && (manyGet.content?.includes("more than 100 files") ?? false), "a folder over the file cap was zipped");
  assert(only(await run(files.feature, ctx2, "get", { path: "outbox/report.md" })).content?.includes("Nothing to send") ?? false, "another user's file was sent");
  let outside = "";
  await run(files.feature, ctx1, "get", { path: "../../secret" }).catch((error: Error) => {
    outside = error.message;
  });
  assert(outside === "Path is outside the workspace", `escape attempt: ${outside}`);

  // /files delete: never the root, always confirmed, and only in the presser's workspace.
  for (const target of ["/", ".", "./"]) {
    const refused = only(await run(files.feature, ctx1, "delete", { path: target }));
    assert((refused.content?.includes("cannot be deleted") ?? false) && !refused.components?.length, `root delete offered for ${target}`);
  }
  const ask = only(await run(files.feature, ctx1, "delete", { path: "/outbox/report.md" }));
  const [confirmId, cancelId] = customIds(ask);
  assert(confirmId === "fl:rm:p:outbox/report.md" && cancelId === "fl:cancel", `confirm ids: ${customIds(ask)}`);
  const stranger = await press(files.feature, ctx2, confirmId, { content: ask.content });
  assert(stranger.sent[0]?.content?.includes("no longer there") ?? false, "another user's press was not refused");
  assert(Boolean(await workspace.findWorkspaceEntry(u1, "outbox/report.md")), "another user's press deleted the file");
  const deleted = await press(files.feature, ctx1, confirmId, { content: ask.content });
  assert(deleted.interaction.deferred && (deleted.sent[0]?.content?.startsWith("Deleted") ?? false), "delete not confirmed");
  assert((await workspace.findWorkspaceEntry(u1, "outbox/report.md")) === null, "file not deleted");
  const again = await press(files.feature, ctx1, confirmId, { content: ask.content });
  assert(again.sent[0]?.content?.includes("no longer there") ?? false, "a second press was not refused");
  const askLong = only(await run(files.feature, ctx1, "delete", { path: longRel }));
  const [longId] = customIds(askLong);
  assert(longId.length <= 100 && longId.startsWith("fl:rm:h:"), `long path id: ${longId}`);
  await press(files.feature, ctx2, longId);
  assert(Boolean(await workspace.findWorkspaceEntry(u1, longRel)), "another user resolved a hashed path");
  await press(files.feature, ctx1, longId);
  assert((await workspace.findWorkspaceEntry(u1, longRel)) === null, "hashed path not deleted");
  const askFolder = only(await run(files.feature, ctx1, "delete", { path: "projects/site" }));
  assert(askFolder.content?.includes("files: 2") ?? false, `folder question: ${askFolder.content}`);
  await press(files.feature, ctx1, customIds(askFolder)[0]);
  assert((await workspace.findWorkspaceEntry(u1, "projects/site")) === null, "folder not deleted");
  assert(Boolean(await workspace.findWorkspaceEntry(u1, "outbox/big.bin")), "delete removed more than asked");
  assert(only(await run(files.feature, ctx1, "delete", { path: "missing.txt" })).content?.includes("Nothing found") ?? false, "deleting a missing file");

  // /files deliverables: newest first, with a menu that only reaches the presser's own.
  assert(only(await run(files.feature, ctx2, "deliverables")).content?.includes("No deliverables") ?? false, "empty deliverables");
  await workspace.writeWorkspaceFile(u1, "outbox/summary.md", "summary");
  const summary = await artifacts.registerArtifact({ userId: u1, threadId: "dm_ops", botId: "ops", path: "outbox/summary.md", title: "Weekly *summary*" });
  await workspace.writeWorkspaceFile(u1, "outbox/gone.md", "soon gone");
  const gone = await artifacts.registerArtifact({ userId: u1, threadId: "dm_ops", path: "outbox/gone.md", title: "Gone" });
  await workspace.deleteWorkspacePath(u1, "outbox/gone.md");
  const shelf = only(await run(files.feature, ctx1, "deliverables"));
  assert((shelf.content?.includes("Weekly \\*summary\\*") ?? false) && (shelf.content?.includes("Operations") ?? false), `deliverables: ${shelf.content}`);
  const menu = shelf.components?.[0]?.toJSON().components[0] as { custom_id?: string; options?: { value: string }[] } | undefined;
  assert(menu?.custom_id === "fl:art" && menu.options?.some((option) => option.value === summary.id) === true, "deliverable menu");
  const picked = await press(files.feature, ctx1, "fl:art", { select: [summary.id] });
  assert(picked.interaction.deferred && picked.followUps[0]?.files?.[0]?.name === "summary.md", "deliverable not sent");
  const foreign = await press(files.feature, ctx2, "fl:art", { select: [summary.id] });
  assert((foreign.followUps[0]?.content?.includes("no longer exists") ?? false) && !foreign.followUps[0]?.files?.length, "another user's deliverable was sent");
  const missing = await press(files.feature, ctx1, "fl:art", { select: [gone.id] });
  assert(missing.followUps[0]?.content?.includes("no longer in the workspace") ?? false, "deleted deliverable file");

  // Autocomplete: the sender's own paths, values that fit Discord, folders only for list.
  await workspace.writeWorkspaceFile(u1, longRel, "long");
  const suggest = autocomplete("get", "big");
  await files.feature.autocomplete?.(suggest.interaction, ctx1);
  assert(suggest.result[0]?.some((item) => item.value === "/outbox/big.bin") ?? false, `suggestions: ${JSON.stringify(suggest.result)}`);
  const everything = autocomplete("get", "");
  await files.feature.autocomplete?.(everything.interaction, ctx1);
  assert((everything.result[0] ?? []).every((item) => item.value.length <= 100 && item.name.length <= 100), "a suggestion is over 100 characters");
  assert(!(everything.result[0] ?? []).some((item) => item.value.startsWith("/deep/")), "a path too long to submit was suggested");
  const folders = autocomplete("list", "");
  await files.feature.autocomplete?.(folders.interaction, ctx1);
  assert((folders.result[0] ?? []).length > 0 && (folders.result[0] ?? []).every((item) => item.name.endsWith("/")), "list suggested files");
  const theirs = autocomplete("get", "mine");
  await files.feature.autocomplete?.(theirs.interaction, ctx1);
  assert((theirs.result[0] ?? []).length === 0, "autocomplete showed another user's files");

  // /computer: the account-level state, nothing started, busy actions confirmed first.
  const idle = only(await run(computer.feature, ctx1, "status"));
  assert((idle.content?.includes("Status: Idle") ?? false) && (idle.content?.includes("Browser: not running") ?? false) && !idle.files?.length, `idle status: ${idle.content}`);
  assert(only(await run(computer.feature, ctx1, "screenshot")).content?.includes("not running") ?? false, "screenshot of a stopped browser");
  assert(only(await run(computer.feature, ctx1, "release")).content === "The browser is not running.", "release of a stopped browser");
  assert(only(await run(computer.feature, ctx1, "stop")).content === "The computer was already stopped.", "stop of a stopped computer");
  const help = only(await run(computer.feature, ctx1, "takeover"));
  assert((help.content?.includes("needs the app") ?? false) && !help.content.includes("waiting for you"), `takeover: ${help.content}`);

  // A recent screen is attached to the status; one from a closed browser is not.
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const shots = (globalThis as { __deniScreenshots?: Map<string, Buffer> }).__deniScreenshots ?? new Map<string, Buffer>();
  (globalThis as { __deniScreenshots?: Map<string, Buffer> }).__deniScreenshots = shots;
  shots.set(`${u1}:default`, png);
  shots.set(`${u2}:default`, Buffer.from("other user's screen"));
  assert(!only(await run(computer.feature, ctx1, "status")).files?.length, "an image without a capture time was attached");
  await computerLib.setComputer(u1, { screenshotAt: new Date().toISOString(), url: "https://example.com/", title: "Example" });
  const withScreen = only(await run(computer.feature, ctx1, "status"));
  assert(withScreen.files?.[0]?.name === "screen.png" && Buffer.compare(withScreen.files[0].attachment as Buffer, png) === 0, "screen not attached");
  assert(withScreen.content?.includes("<https://example.com/>") ?? false, `page line: ${withScreen.content}`);

  await computerLib.setComputer(u1, { status: "takeover", workingBotId: "ops", workingLabel: "Logging in" });
  const busy = only(await run(computer.feature, ctx1, "release"));
  assert(customIds(busy).join() === "pc:release,pc:cancel" && (busy.content?.includes("Operations") ?? false), `busy release: ${busy.content}`);
  assert(customIds(only(await run(computer.feature, ctx1, "stop"))).join() === "pc:stop,pc:cancel", "busy stop was not confirmed");
  const waiting = only(await run(computer.feature, ctx1, "takeover"));
  assert(waiting.content?.includes("Operations is waiting for you") ?? false, `takeover while waiting: ${waiting.content}`);
  const busyStatus = only(await run(computer.feature, ctx1, "status"));
  assert((busyStatus.content?.includes("Teammate: Operations") ?? false) && (busyStatus.content?.includes("/computer takeover") ?? false), `busy status: ${busyStatus.content}`);
  const confirmed = await press(computer.feature, ctx1, "pc:release");
  assert(confirmed.interaction.deferred && confirmed.sent[0]?.content === "The browser is not running.", "confirmed release");
  const stopped = await press(computer.feature, ctx1, "pc:stop");
  assert(stopped.sent[0]?.content === "The computer was already stopped.", "confirmed stop");
  // The second user's computer is untouched by the first user's state.
  const other = only(await run(computer.feature, ctx2, "status"));
  assert((other.content?.includes("Status: Idle") ?? false) && !other.files?.length, "status leaked another user's computer");

  const jaStatus = only(await run(computer.feature, { link: link(u1), tr: trJa }, "status"));
  assert(jaStatus.content?.includes("状態: あなたの対応が必要です") ?? false, `japanese status: ${jaStatus.content}`);
  await run(files.feature, { link: link(u1), tr: trJa }, "list");

  // Commands: lowercase names, Japanese descriptions everywhere.
  for (const definition of [...files.feature.commands, ...computer.feature.commands].map((item) => item.toJSON())) {
    assert(/^[a-z]+$/.test(definition.name) && Boolean(definition.description_localizations?.ja), `command ${definition.name}`);
    for (const option of definition.options ?? []) {
      assert(/^[a-z]+$/.test(option.name) && Boolean(option.description_localizations?.ja), `option ${definition.name} ${option.name}`);
      for (const inner of "options" in option ? (option.options ?? []) : []) {
        assert(/^[a-z]+$/.test(inner.name) && Boolean(inner.description_localizations?.ja), `option ${option.name} ${inner.name}`);
      }
    }
  }

  // Japanese: every key used has a translation that keeps its placeholders.
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join();
  for (const [key, value] of Object.entries({ ...filesJa, ...computerJa })) {
    assert(placeholders(key) === placeholders(value), `placeholders differ for "${key}"`);
  }
  const untranslated = [...used].filter((key) => japanese(key) === key);
  assert(untranslated.length === 0, `missing Japanese: ${untranslated.join(" | ")}`);

  console.log("discord files verification passed");
}

/** A teammate to attribute deliverables and computer work to. */
async function mutateBots(store: typeof import("../lib/store"), userId: string) {
  const now = new Date().toISOString();
  await store.mutateStore(userId, (data) => {
    data.bots = [{ id: "ops", name: "Operations", job: "Runs things", instructions: "", accent: "#000000", createdAt: now, updatedAt: now, memory: [] }];
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined);
    if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    process.exit();
  });

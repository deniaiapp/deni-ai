import dotenv from "dotenv";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mockModules } from "./module-mocks";

dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: ".env.local", override: true, quiet: true });

mockModules((request) => {
  if (request === "server-only") return {};
  return undefined;
});

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

type Sent = { content?: string; components?: { toJSON(): unknown }[] };
type Json = { type?: number; custom_id?: string; value?: string; components?: Json[]; component?: Json; options?: Json[] };

/** Just enough of a discord.js interaction for the handlers: it records what they send. */
function fake(extra: Record<string, unknown> = {}) {
  const sent: Sent[] = [];
  const modals: Json[] = [];
  let suggestions: { name: string; value: string }[] = [];
  const interaction = {
    deferred: false,
    replied: false,
    async deferReply() {
      this.deferred = true;
    },
    async deferUpdate() {
      this.deferred = true;
    },
    async reply(message: Sent) {
      this.replied = true;
      sent.push(message);
    },
    async editReply(message: Sent) {
      sent.push(message);
    },
    async followUp(message: Sent) {
      sent.push(message);
    },
    async update(message: Sent) {
      this.replied = true;
      sent.push(message);
    },
    async showModal(modal: { toJSON(): Json }) {
      modals.push(modal.toJSON());
    },
    async respond(list: { name: string; value: string }[]) {
      suggestions = list;
    },
    isButton: () => false,
    isStringSelectMenu: () => false,
    message: { content: "", components: [] },
    ...extra,
  };
  return {
    interaction,
    sent,
    modals,
    text: () => sent.map((item) => item.content ?? "").join("\n"),
    suggestions: () => suggestions,
  };
}

function command(sub: string, options: Record<string, string> = {}, focused = "") {
  return fake({
    options: {
      getSubcommand: () => sub,
      getString: (name: string) => options[name] ?? null,
      getFocused: () => focused,
    },
  });
}

function component(kind: "button" | "select", values: string[] = []) {
  return fake({ isButton: () => kind === "button", isStringSelectMenu: () => kind === "select", values });
}

function modalSubmit(values: Record<string, string>) {
  return fake({
    fields: {
      fields: new Map(Object.entries(values)),
      getTextInputValue(id: string) {
        if (!(id in values)) throw new Error(`modal field ${id} was not sent`);
        return values[id];
      },
    },
  });
}

/** Every component in the replies and modals, flattened, so custom ids and types can be checked. */
function flatten(items: Json[]): Json[] {
  return items.flatMap((item) => [item, ...flatten(item.components ?? []), ...(item.component ? flatten([item.component]) : [])]);
}
const sentComponents = (sent: Sent[]) => flatten(sent.flatMap((item) => (item.components ?? []).map((row) => row.toJSON() as Json)));

let tempDir = "";

// Teammates and groups from Discord must follow the web's rules: the plan limit, the default
// teammates, members from the person's own team, and only ever the linked account's workspace.
async function main() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "deni-discord-team-"));
  delete process.env.D1_PROXY_URL;
  process.env.LOCAL_DB_PATH = path.join(tempDir, "test.sqlite");
  process.env.APP_ENCRYPTION_KEY ||= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

  const { db } = await import("../db");
  const { user } = await import("../db/schema");
  const store = await import("../lib/store");
  const teammates = await import("../lib/teammates");
  const groups = await import("../lib/groups");
  const { getDiscordPrefs, setDiscordPrefs } = await import("../lib/discord-link");
  const { discordTranslator: translatorFor } = await import("../lib/discord-i18n");
  const { feature: team } = await import("../lib/discord-features/team");
  const { feature: group } = await import("../lib/discord-features/groups");
  const { ja: teamJa } = await import("../lib/discord-features/team.ja");
  const { ja: groupsJa } = await import("../lib/discord-features/groups.ja");

  for (const id of ["u1", "u2"]) await db.insert(user).values({ id, name: id, email: `${id}@example.com`, emailVerified: true });
  await store.readStore("u1");
  await store.readStore("u2");
  const ctx = (userId: string, botId: string | null = null) => ({
    link: { userId, discordUserId: `d-${userId}`, discordUsername: userId, botId, locale: "en", createdAt: new Date().toISOString() },
    tr: translatorFor("en"),
  });
  const bots = async (userId: string) => (await store.readStore(userId)).bots;

  // Create: name and icon are validated, the DM comes with it, and the plan limit (5 on Free) holds.
  assert((await teammates.createTeammate("u1", { name: "   " })).ok === false, "blank name accepted");
  const badIcon = await teammates.createTeammate("u1", { name: "X", icon: "javascript:alert(1)" });
  assert(!badIcon.ok && badIcon.reason === "invalid_icon", "invalid icon accepted");
  const writer = await teammates.createTeammate("u1", { name: " Writer ", job: "", instructions: "" });
  assert(writer.ok, "create failed");
  if (!writer.ok) return;
  assert(writer.bot.name === "Writer" && writer.bot.job === "Teammate" && writer.bot.instructions.includes('"Writer"'), "create defaults");
  assert(writer.thread.id === `dm_${writer.bot.id}` && writer.thread.kind === "dm" && writer.thread.title === "Writer", "create DM");
  const designer = await teammates.createTeammate("u1", { name: "Designer", job: "Visuals" });
  assert(designer.ok, "second create failed");
  if (!designer.ok) return;
  const over = await teammates.createTeammate("u1", { name: "One too many" });
  assert(!over.ok && over.reason === "limit" && over.error.metric === "teammates", "plan limit not enforced");
  assert((await bots("u1")).length === 5, "a refused create still added a teammate");

  // Update: only the owner's teammate, a rename follows into the DM title, empty fields stay.
  assert((await teammates.updateTeammate("u2", writer.bot.id, { name: "Hijacked" })).ok === false, "another user edited a teammate");
  const renamed = await teammates.updateTeammate("u1", writer.bot.id, { name: " Author ", job: "", instructions: "" });
  assert(renamed.ok && renamed.bot.name === "Author" && renamed.bot.job === "Teammate" && renamed.bot.instructions.includes('"Writer"'), "update fields");
  assert((await store.readStore("u1")).threads.find((thread) => thread.id === writer.thread.id)?.title === "Author", "DM title not renamed");
  const iconRefused = await teammates.updateTeammate("u1", writer.bot.id, { icon: "<svg>" });
  assert(!iconRefused.ok && iconRefused.reason === "invalid_icon", "update accepted an invalid icon");

  // Memory: only the teammate's own entries are forgotten, and only by its owner.
  await store.mutateStore("u1", (data) => {
    const bot = data.bots.find((item) => item.id === writer.bot.id);
    if (bot) bot.memory = [1, 2, 3].map((n) => ({ id: `mem_${n}`, text: `fact ${n}`, createdAt: new Date().toISOString() }));
  });
  assert((await teammates.forgetTeammateMemory("u2", writer.bot.id, ["mem_1"])).ok === false, "another user reached the memory");
  const forgot = await teammates.forgetTeammateMemory("u1", writer.bot.id, ["mem_1", "mem_other"]);
  assert(forgot.ok && forgot.removed === 1 && forgot.bot.memory.map((entry) => entry.id).join() === "mem_2,mem_3", "forget memory");

  // Groups: members must be two of the person's own teammates; the title defaults to their names.
  const foreign = await groups.createGroup("u2", { botIds: ["chief", writer.bot.id] });
  assert(!foreign.ok && foreign.reason === "invalid_members", "a group used another user's teammate");
  assert(!(await groups.createGroup("u1", { botIds: ["chief", "chief"] })).ok, "a duplicate member counted twice");
  const crew = await groups.createGroup("u1", { title: "  ", botIds: ["chief", writer.bot.id, "nope"] });
  assert(crew.ok && crew.thread.title === "Chief · Author" && crew.thread.botIds.join() === `chief,${writer.bot.id}`, "group defaults");
  if (!crew.ok) return;
  const long = await groups.createGroup("u1", { title: "x".repeat(200), botIds: ["chief", "ops"] });
  assert(long.ok && long.thread.title.length === groups.GROUP_TITLE_MAX, "long title not capped");

  // Edits: DMs are refused, titles validated, and removed members' routines turned off.
  const u1 = await store.readStore("u1");
  const dm = u1.threads.find((thread) => thread.id === "dm_chief");
  assert(dm && groups.applyGroupEdits(u1, dm, { title: "No" }).ok === false && dm.title === "Chief", "a DM was edited as a group");
  assert(dm && groups.applyGroupEdits(u1, dm, {}).ok, "a plain DM update was refused");
  assert((await groups.updateGroup("u1", "dm_chief", { title: "No" })).ok === false, "updateGroup edited a DM");
  const blank = await groups.updateGroup("u1", crew.thread.id, { title: "   " });
  assert(!blank.ok && blank.reason === "invalid_title", "blank group title accepted");
  assert((await groups.updateGroup("u2", crew.thread.id, { title: "Mine" })).ok === false, "another user renamed a group");
  const routine = (id: string, botId: string) => ({
    id, botId, threadId: crew.thread.id, name: id, instructions: "x", cron: "0 9 * * *", timezone: "UTC",
    enabled: true, lastRunAt: null, nextRunAt: new Date().toISOString(), lastError: null, createdAt: new Date().toISOString(),
  });
  await store.mutateStore("u1", (data) => {
    data.routines.push(routine("r_chief", "chief"), routine("r_writer", writer.bot.id));
  });
  assert(!(await groups.updateGroup("u1", crew.thread.id, { botIds: ["chief"] })).ok, "a one-member group was accepted");
  const swapped = await groups.updateGroup("u1", crew.thread.id, { botIds: ["chief", "research"] });
  assert(swapped.ok && swapped.disabledRoutines === 1 && swapped.thread.botIds.join() === "chief,research", "member change");
  const after = (await store.readStore("u1")).routines;
  const writerRoutine = after.find((item) => item.id === "r_writer");
  assert(writerRoutine && !writerRoutine.enabled && writerRoutine.nextRunAt === null && writerRoutine.revision === 1, "removed member's routine still on");
  assert(after.find((item) => item.id === "r_chief")?.enabled, "a remaining member's routine was turned off");

  // Delete: defaults stay; a custom teammate takes its DM, its groups, and its routines with it.
  const keep = await teammates.deleteTeammate("u1", "chief");
  assert(!keep.ok && keep.reason === "default", "a default teammate was deleted");
  const withDesigner = await groups.createGroup("u1", { botIds: ["ops", designer.bot.id] });
  assert(withDesigner.ok, "group with designer");
  const notTheirs = await teammates.deleteTeammate("u2", designer.bot.id);
  assert(notTheirs.ok && !notTheirs.deleted && (await bots("u1")).some((bot) => bot.id === designer.bot.id), "another user deleted a teammate");
  await teammates.deleteTeammate("u1", designer.bot.id);
  const pruned = await store.readStore("u1");
  assert(!pruned.bots.some((bot) => bot.id === designer.bot.id), "teammate not deleted");
  assert(!pruned.threads.some((thread) => thread.botIds.includes(designer.bot.id)), "teammate's DM or group left behind");

  // /team list marks where plain messages go, or names the group when one is chosen.
  const listed = command("list");
  await team.command?.(listed.interaction as never, ctx("u1", "research"));
  assert(listed.text().includes("**Research**") && !listed.text().includes("**Chief**"), `team list mark: ${listed.text()}`);
  await setDiscordPrefs("u1", { threadId: crew.thread.id });
  const listedGroup = command("list");
  await team.command?.(listedGroup.interaction as never, ctx("u1", "research"));
  assert(listedGroup.text().includes(crew.thread.title) && !listedGroup.text().includes("**Research**"), `team list with group: ${listedGroup.text()}`);
  await setDiscordPrefs("u1", { threadId: null });

  // /team delete refuses defaults and asks before deleting anyone else.
  const refuse = command("delete", { name: "chief" });
  await team.command?.(refuse.interaction as never, ctx("u1"));
  assert(refuse.text().includes("Default teammates cannot be deleted") && !sentComponents(refuse.sent).length, "default delete offered");
  const ask = command("delete", { name: "author" });
  await team.command?.(ask.interaction as never, ctx("u1"));
  assert(sentComponents(ask.sent).some((item) => item.custom_id === `tm:delete:${writer.bot.id}`), "delete confirmation missing");
  const otherPress = component("button");
  await team.component?.(otherPress.interaction as never, ctx("u2"), ["delete", writer.bot.id]);
  assert(otherPress.text().includes("no longer exists") && (await bots("u1")).some((bot) => bot.id === writer.bot.id), "another user's button deleted a teammate");

  // /team edit leaves out instructions Discord cannot hold, and saving keeps them.
  assert(team.opensModal?.({ options: { getSubcommand: () => "edit" } } as never) && !team.opensModal?.({ options: { getSubcommand: () => "list" } } as never), "opensModal");
  const longInstructions = "y".repeat(4_500);
  await teammates.updateTeammate("u1", writer.bot.id, { instructions: longInstructions });
  const editLong = command("edit", { name: writer.bot.id });
  await team.command?.(editLong.interaction as never, ctx("u1"));
  const longFields = flatten(editLong.modals);
  assert(editLong.modals.length === 1 && !longFields.some((item) => item.custom_id === "instructions") && longFields.some((item) => item.type === 10), "long instructions were put in the modal");
  const saveLong = modalSubmit({ name: "Author", job: "Words" });
  await team.modal?.(saveLong.interaction as never, ctx("u1"), ["edit", writer.bot.id]);
  const savedLong = (await bots("u1")).find((bot) => bot.id === writer.bot.id);
  assert(savedLong?.job === "Words" && savedLong.instructions === longInstructions && saveLong.text().includes("in the app"), "saving without instructions changed them");
  const editShort = command("edit", { name: "Research" });
  await team.command?.(editShort.interaction as never, ctx("u1"));
  assert(flatten(editShort.modals).some((item) => item.custom_id === "instructions"), "instructions field missing");
  const foreignEdit = modalSubmit({ name: "Taken", job: "", instructions: "" });
  await team.modal?.(foreignEdit.interaction as never, ctx("u2"), ["edit", writer.bot.id]);
  assert(foreignEdit.text().includes("no longer exists") && (await bots("u1")).some((bot) => bot.name === "Author"), "another user's modal edited a teammate");

  // /team create over the plan limit explains the limit instead of failing.
  assert((await teammates.createTeammate("u1", { name: "Filler" })).ok, "filling the plan failed");
  const full =modalSubmit({ name: "Sixth", job: "", instructions: "" });
  await team.modal?.(full.interaction as never, ctx("u1"), ["create"]);
  assert(full.text().includes("Teammate limit reached"), `limit message: ${full.text()}`);
  const made = modalSubmit({ name: "Helper", job: "Help", instructions: "Be kind." });
  await team.modal?.(made.interaction as never, ctx("u2"), ["create"]);
  assert(made.text().includes("Created Helper") && (await bots("u2")).some((bot) => bot.name === "Helper" && bot.instructions === "Be kind."), "create from Discord");

  // /team memory lists entries and the menu forgets them; another user's menu reaches nothing.
  const memory = command("memory", { name: "Author" });
  await team.command?.(memory.interaction as never, ctx("u1"));
  const menu = sentComponents(memory.sent).find((item) => item.custom_id === `tm:forget:${writer.bot.id}`);
  assert(memory.text().includes("fact 3") && menu?.options?.length === 2, "memory view");
  const stranger = component("select", ["mem_2"]);
  await team.component?.(stranger.interaction as never, ctx("u2"), ["forget", writer.bot.id]);
  assert((await bots("u1")).find((bot) => bot.id === writer.bot.id)?.memory.length === 2, "another user forgot a memory");
  const forget = component("select", ["mem_2"]);
  await team.component?.(forget.interaction as never, ctx("u1"), ["forget", writer.bot.id]);
  assert(forget.text().includes("Memories forgotten: 1") && (await bots("u1")).find((bot) => bot.id === writer.bot.id)?.memory.length === 1, "forget from Discord");

  // Autocomplete only ever offers the linked account's own teammates and groups.
  const suggestBots = command("edit", {}, "");
  await team.autocomplete?.(suggestBots.interaction as never, ctx("u2"));
  assert(suggestBots.suggestions().length === 4 && !suggestBots.suggestions().some((item) => item.value === writer.bot.id), "team autocomplete leaked");
  const suggestGroups = command("talk", {}, "");
  await group.autocomplete?.(suggestGroups.interaction as never, ctx("u2"));
  assert(suggestGroups.suggestions().length === 0, "group autocomplete leaked");

  // /group talk points plain DMs at the group and explains @name and @everyone.
  const talk = command("talk", { name: crew.thread.title.toUpperCase() });
  await group.command?.(talk.interaction as never, ctx("u1"));
  assert((await getDiscordPrefs("u1")).threadId === crew.thread.id && talk.text().includes("@everyone") && talk.text().includes("/teammate"), "group talk");
  const foreignTalk = command("talk", { name: crew.thread.id });
  await group.command?.(foreignTalk.interaction as never, ctx("u2"));
  assert((await getDiscordPrefs("u2")).threadId === null, "another user's group became the target");
  const listGroups = command("list");
  await group.command?.(listGroups.interaction as never, ctx("u1"));
  assert(listGroups.text().includes(`**${crew.thread.title}**`), "group list does not mark the target");

  // /group create keeps the typed name until the members are chosen, for the same person only.
  const start = command("create", { name: "Launch crew" });
  await group.command?.(start.interaction as never, ctx("u1"));
  const picker = sentComponents(start.sent).find((item) => item.custom_id?.startsWith("gp:new:"));
  assert(picker?.custom_id, "member menu missing");
  const draftArgs = (picker?.custom_id ?? "").split(":").slice(1);
  const hijack = component("select", ["chief", "ops"]);
  await group.component?.(hijack.interaction as never, ctx("u2"), draftArgs);
  assert(hijack.text().includes("expired") && !(await store.readStore("u2")).threads.some((thread) => thread.title === "Launch crew"), "another user used the draft");
  const pick = component("select", ["ops", "research"]);
  await group.component?.(pick.interaction as never, ctx("u1"), draftArgs);
  const launch = (await store.readStore("u1")).threads.find((thread) => thread.title === "Launch crew");
  assert(launch?.kind === "group" && launch.botIds.join() === "ops,research", "group not created from the menu");
  assert(sentComponents(pick.sent).some((item) => item.custom_id === `gp:talk:${launch?.id}`), "talk button missing");
  const reuse = component("select", ["ops", "chief"]);
  await group.component?.(reuse.interaction as never, ctx("u1"), draftArgs);
  assert(reuse.text().includes("expired"), "a draft created two groups");

  // /group edit: members from the menu, and a rename through the modal.
  const editGroup = command("edit", { name: "Launch crew" });
  await group.command?.(editGroup.interaction as never, ctx("u1"));
  const editIds = sentComponents(editGroup.sent).map((item) => item.custom_id);
  assert(editIds.includes(`gp:rename:${launch?.id}`) && editIds.includes(`gp:members:${launch?.id}`), "edit controls missing");
  const members = component("select", ["ops", "chief"]);
  await group.component?.(members.interaction as never, ctx("u1"), ["members", launch?.id ?? ""]);
  assert((await store.readStore("u1")).threads.find((thread) => thread.id === launch?.id)?.botIds.join() === "ops,chief", "members not changed");
  const renameButton = component("button");
  await group.component?.(renameButton.interaction as never, ctx("u1"), ["rename", launch?.id ?? ""]);
  assert(flatten(renameButton.modals).some((item) => item.custom_id === "title"), "rename modal missing");
  const talkButton = component("button");
  await group.component?.(talkButton.interaction as never, ctx("u2"), ["talk", launch?.id ?? ""]);
  assert((await getDiscordPrefs("u2")).threadId === null, "another user's talk button set the target");
  const rename = modalSubmit({ title: "  Launch team  " });
  await group.modal?.(rename.interaction as never, ctx("u1"), ["rename", launch?.id ?? ""]);
  assert((await store.readStore("u1")).threads.find((thread) => thread.id === launch?.id)?.title === "Launch team", "rename failed");

  // /group delete asks first; deleting the current target sends DMs back to the teammate.
  const askGroup = command("delete", { name: crew.thread.title });
  await group.command?.(askGroup.interaction as never, ctx("u1"));
  assert(sentComponents(askGroup.sent).some((item) => item.custom_id === `gp:delete:${crew.thread.id}`), "group delete confirmation missing");
  const otherDelete = component("button");
  await group.component?.(otherDelete.interaction as never, ctx("u2"), ["delete", crew.thread.id]);
  assert((await store.readStore("u1")).threads.some((thread) => thread.id === crew.thread.id), "another user deleted a group");
  const confirm = component("button");
  await group.component?.(confirm.interaction as never, ctx("u1", "research"), ["delete", crew.thread.id]);
  assert(!(await store.readStore("u1")).threads.some((thread) => thread.id === crew.thread.id), "group not deleted");
  assert((await getDiscordPrefs("u1")).threadId === null && confirm.text().includes("Research"), "target not cleared");

  // Deleting a teammate whose group was the target sends DMs back to a teammate.
  const temp = await teammates.createTeammate("u2", { name: "Temp" });
  assert(temp.ok, "temp teammate");
  if (!temp.ok) return;
  const tempGroup = await groups.createGroup("u2", { botIds: ["chief", temp.bot.id] });
  assert(tempGroup.ok, "temp group");
  if (!tempGroup.ok) return;
  await setDiscordPrefs("u2", { threadId: tempGroup.thread.id });
  const dropTemp = component("button");
  await team.component?.(dropTemp.interaction as never, ctx("u2", "ops"), ["delete", temp.bot.id]);
  assert((await getDiscordPrefs("u2")).threadId === null && dropTemp.text().includes("now go to Operations"), `delete target: ${dropTemp.text()}`);

  // Commands are DM-only, lowercase, and described in Japanese; every string has a Japanese entry.
  for (const feature of [team, group]) {
    for (const definition of feature.commands.map((item) => item.toJSON())) {
      assert(/^[a-z]+$/.test(definition.name) && definition.description_localizations?.ja, `command ${definition.name}`);
      for (const sub of definition.options ?? []) assert(/^[a-z]+$/.test(sub.name) && sub.description_localizations?.ja, `subcommand ${sub.name}`);
    }
  }
  for (const [file, dictionary] of [["team", teamJa], ["groups", groupsJa]] as const) {
    const source = await readFile(path.join("lib", "discord-features", `${file}.ts`), "utf8");
    for (const [, key] of source.matchAll(/\btr\("((?:[^"\\]|\\.)*)"/g)) assert(dictionary[key], `${file}.ja.ts is missing "${key}"`);
  }

  console.log("discord team verification passed");
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

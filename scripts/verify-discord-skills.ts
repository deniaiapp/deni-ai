import dotenv from "dotenv";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import { mockModules } from "./module-mocks";

dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: ".env.local", override: true, quiet: true });

mockModules((request) => {
  if (request === "server-only") return {};
  return undefined;
});

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function throws(work: () => unknown, message: string) {
  try {
    await work();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(message);
}

type Sent = { content?: string; files?: unknown[]; components?: { toJSON(): { components: { custom_id?: string }[] } }[] };
type Modal = { toJSON(): { custom_id: string; title: string; components: { component: { custom_id: string; value?: string } }[] } };
type Values = Record<string, string | number | { name: string; url: string; size: number; contentType: string | null }>;

/** The parts of a slash command interaction the features use, recording what they send back. */
function fakeCommand(commandName: string, sub: string, values: Values) {
  const sent: Sent[] = [];
  let modal: Modal | null = null;
  const pick = <T>(name: string, test: (value: unknown) => value is T) => {
    const value = values[name];
    return test(value) ? value : null;
  };
  const interaction = {
    commandName,
    deferred: false,
    replied: false,
    options: {
      getSubcommand: () => sub,
      getString: (name: string) => pick(name, (value): value is string => typeof value === "string"),
      getInteger: (name: string) => pick(name, (value): value is number => typeof value === "number"),
      getAttachment: (name: string) => pick(name, (value): value is Values[string] & object => typeof value === "object" && value !== null),
    },
    async reply(message: Sent) {
      interaction.replied = true;
      sent.push(message);
    },
    async editReply(message: Sent) {
      sent.push(message);
    },
    async followUp(message: Sent) {
      sent.push(message);
    },
    async showModal(built: Modal) {
      modal = built;
    },
  };
  return { interaction, sent, modal: () => modal as Modal | null };
}

function fakeModal(fields: Record<string, string>) {
  const sent: Sent[] = [];
  const interaction = {
    deferred: false,
    replied: false,
    fields: { getTextInputValue: (id: string) => fields[id] ?? "" },
    async deferReply() {
      interaction.deferred = true;
    },
    async reply(message: Sent) {
      interaction.replied = true;
      sent.push(message);
    },
    async editReply(message: Sent) {
      sent.push(message);
    },
    async followUp(message: Sent) {
      sent.push(message);
    },
  };
  return { interaction: interaction as unknown as ModalSubmitInteraction, sent };
}

function fakeButton() {
  const sent: Sent[] = [];
  const interaction = {
    deferred: false,
    replied: false,
    message: { content: "" },
    async deferUpdate() {
      interaction.deferred = true;
    },
    async update(message: Sent) {
      sent.push(message);
    },
    async editReply(message: Sent) {
      sent.push(message);
    },
  };
  return { interaction: interaction as unknown as ButtonInteraction, sent };
}

function fakeAutocomplete(focused: string, value: string, values: Record<string, string> = {}) {
  let answered: { name: string; value: string }[] = [];
  const interaction = {
    options: {
      getFocused: (full?: boolean) => (full ? { name: focused, value } : value),
      getString: (name: string) => values[name] ?? null,
    },
    async respond(list: { name: string; value: string }[]) {
      answered = list;
    },
  };
  return { interaction: interaction as unknown as AutocompleteInteraction, answered: () => answered };
}

const text = (sent: Sent[]) => sent.map((message) => message.content ?? "").join("\n");

let tempDir = "";

// Skills and routines from Discord share the web routes' rules: unique skill names, a teammate
// that belongs to the routine's conversation, validated schedules, and only the sender's own data.
async function main() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "deni-discord-skills-"));
  delete process.env.D1_PROXY_URL;
  process.env.LOCAL_DB_PATH = path.join(tempDir, "test.sqlite");
  process.env.APP_ENCRYPTION_KEY ||= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

  const { db } = await import("../db");
  const { user } = await import("../db/schema");
  const store = await import("../lib/store");
  const skills = await import("../lib/skills");
  const routines = await import("../lib/routines");
  const skillUi = await import("../lib/discord-features/skills");
  const routineUi = await import("../lib/discord-features/routines");
  const { discordTranslator: translatorFor } = await import("../lib/discord-i18n");
  const { discordJa: ja } = await import("../lib/discord-i18n");

  for (const id of ["u1", "u2"]) await db.insert(user).values({ id, name: id, email: `${id}@example.com`, emailVerified: true });
  const ctxFor = (userId: string, locale = "en") => ({
    link: { userId, discordUserId: `d-${userId}`, discordUsername: userId, botId: null, locale, createdAt: "" },
    tr: translatorFor(locale),
  });
  const u1 = ctxFor("u1");
  const u2 = ctxFor("u2");

  // ── lib/skills: names are unique regardless of case, and a rejected save writes nothing.
  const created = await skills.saveSkill("u1", { name: "  Weekly digest ", body: "Summarize the week." });
  assert(created.ok && created.skill.name === "Weekly digest", `create: ${JSON.stringify(created)}`);
  const skillId = created.skill.id;
  assert((await skills.saveSkill("u1", { name: "weekly DIGEST", body: "x" })).ok === false, "duplicate name accepted");
  const recased = await skills.saveSkill("u1", { id: skillId, name: "Weekly Digest", body: "Summarize the week again." });
  assert(recased.ok && recased.skill.body === "Summarize the week again.", "renaming a skill to its own name in another case failed");
  const other = await skills.saveSkill("u1", { name: "Inbox triage", body: "Sort the inbox." });
  assert(other.ok, "second skill");
  const clash = await skills.saveSkill("u1", { id: other.skill.id, name: "weekly digest", body: "changed" });
  assert(!clash.ok && clash.reason === "duplicate", "rename onto another skill's name accepted");
  assert((await store.readStore("u1")).skills.find((item) => item.id === other.skill.id)?.body === "Sort the inbox.", "a rejected save changed the skill");
  const missing = await skills.saveSkill("u1", { id: "skill_missing", name: "Fresh", body: "x" });
  assert(!missing.ok && missing.reason === "not_found", "update of a missing skill");
  for (const input of [{ name: "Blank", body: "   " }, { name: " ", body: "x" }, { name: "n".repeat(121), body: "x" }, { name: "Huge", body: "x".repeat(100_001) }]) {
    const result = await skills.saveSkill("u1", input);
    assert(!result.ok && result.reason === "invalid", `invalid skill accepted: ${input.name.slice(0, 10)}`);
  }
  const longest = await skills.saveSkill("u1", { name: "Longest", body: "x".repeat(100_000) });
  assert(longest.ok, "a 100,000 character skill was refused");
  // Another account cannot reach these ids.
  assert(!(await skills.saveSkill("u2", { id: skillId, name: "Hijack", body: "x" })).ok, "u2 updated u1's skill");
  assert((await skills.deleteSkill("u2", skillId)) === null, "u2 deleted u1's skill");
  assert((await store.readStore("u1")).skills.some((item) => item.id === skillId), "u1's skill disappeared");

  // ── lib/routines: membership, validation, revisions, and timezone defaults.
  await routines.setDefaultTimezone("u1", "Asia/Tokyo");
  const seeded = await store.readStore("u1");
  const [chief, second] = seeded.bots;
  const dmOf = (botId: string) => seeded.threads.find((item) => item.kind === "dm" && item.botIds[0] === botId)?.id ?? "";
  await store.mutateStore("u1", (data) => {
    data.threads.push({ id: "grp_launch", kind: "group", title: "Launch", botIds: [chief.id], createdAt: "", updatedAt: "", lastPreview: "" });
  });
  const base = { botId: chief.id, threadId: dmOf(chief.id), name: "Morning brief", instructions: "Check the news.", cron: "0 9 * * *" };
  const made = await routines.createRoutine("u1", base, "ja");
  assert(made.ok && made.routine.timezone === "Asia/Tokyo" && made.routine.locale === "ja" && made.routine.revision === 0 && Boolean(made.routine.nextRunAt), `create routine: ${JSON.stringify(made)}`);
  const routineId = made.routine.id;
  const inGroup = await routines.createRoutine("u1", { ...base, threadId: "grp_launch", timezone: "America/New_York" }, "en");
  assert(inGroup.ok && inGroup.routine.timezone === "America/New_York", "group routine or explicit timezone");
  const outsider = await routines.createRoutine("u1", { ...base, botId: second.id, threadId: "grp_launch" }, "en");
  assert(!outsider.ok && outsider.reason === "not_found", "a teammate outside the group got a routine there");
  assert(!(await routines.createRoutine("u2", { ...base, threadId: "grp_launch" }, "en")).ok, "u2 reached u1's group");
  for (const [field, patch] of [["name", { name: " " }], ["instructions", { instructions: "" }], ["cron", { cron: "" }]] as const) {
    const result = await routines.createRoutine("u1", { ...base, ...patch }, "en");
    assert(!result.ok && result.reason === "invalid" && result.field === field, `invalid ${field}: ${JSON.stringify(result)}`);
  }
  const countBefore = (await store.readStore("u1")).routines.length;
  assert((await throws(() => routines.createRoutine("u1", { ...base, cron: "nope" }, "en"), "bad cron accepted")) === "Invalid cron expression", "bad cron message");
  assert((await throws(() => routines.createRoutine("u1", { ...base, timezone: "Mars/Base" }, "en"), "bad zone accepted")).startsWith("Invalid timezone"), "bad zone message");
  assert((await store.readStore("u1")).routines.length === countBefore, "a failed create saved a routine");

  await store.mutateStore("u1", (data) => {
    const item = data.routines.find((entry) => entry.id === routineId);
    if (item) item.lastError = "boom";
  });
  const renamed = await routines.updateRoutine("u1", { id: routineId, name: "Daily brief" }, "en");
  assert(renamed.ok && renamed.routine.revision === 1 && renamed.routine.lastError === null && renamed.routine.locale === "en", "rename should bump the revision and clear the error");
  const same = await routines.updateRoutine("u1", { id: routineId, name: "Daily brief" }, "en");
  assert(same.ok && same.routine.revision === 1, "a no-op edit bumped the revision");
  const paused = await routines.updateRoutine("u1", { id: routineId, enabled: false }, "en");
  assert(paused.ok && paused.routine.nextRunAt === null && paused.routine.revision === 2, "pause");
  assert(!(await routines.updateRoutine("u2", { id: routineId, enabled: true }, "en")).ok, "u2 resumed u1's routine");
  await throws(() => routines.updateRoutine("u1", { id: routineId, cron: "61 * * * *" }, "en"), "invalid cron edit accepted");
  assert((await store.readStore("u1")).routines.find((item) => item.id === routineId)?.cron === "0 9 * * *", "a failed edit changed the routine");
  const invalidEdit = await routines.updateRoutine("u1", { id: routineId, instructions: " " }, "en");
  assert(!invalidEdit.ok && invalidEdit.reason === "invalid" && invalidEdit.field === "instructions", "blank instructions on edit");
  assert((await routines.deleteRoutine("u2", routineId)) === null, "u2 deleted u1's routine");

  assert(routines.normalizeTimezone(" asia/tokyo ") === "Asia/Tokyo", "timezone should be canonicalized");
  for (const zone of ["Mars/Olympus", "+09:00", "", "Asia/Tokyo; drop"]) assert(routines.normalizeTimezone(zone) === null, `accepted timezone ${zone}`);
  assert((await routines.setDefaultTimezone("u1", "Nowhere")) === null && (await store.readStore("u1")).config.timezone === "Asia/Tokyo", "invalid default timezone saved");

  // ── Schedules from command options.
  assert(routineUi.parseTime("9:30") === "09:30" && routineUi.parseTime("9：30") === "09:30" && routineUi.parseTime("7") === "07:00", "time parsing");
  assert(routineUi.parseTime("24:00") === null && routineUi.parseTime("9:7") === null && routineUi.parseTime("noon") === null, "bad times parsed");
  const picks = (patch: Partial<import("../lib/discord-features/routines").SchedulePicks>) => ({ frequency: null, time: null, weekday: null, day: null, cron: null, ...patch });
  assert(routineUi.scheduleCron(picks({})) === "0 9 * * *", "default schedule");
  assert(routineUi.scheduleCron(picks({ frequency: "weekly", weekday: "3", time: "10:15" })) === "15 10 * * 3", "weekly schedule");
  assert(routineUi.scheduleCron(picks({ frequency: "monthly", day: 31 })) === "0 9 31 * *", "monthly schedule");
  assert(routineUi.scheduleCron(picks({ frequency: "weekdays", time: "18:00" })) === "0 18 * * 1-5", "weekday schedule");
  assert(routineUi.scheduleCron(picks({ cron: "*/15 * * * *" })) === "*/15 * * * *", "cron alone means custom");
  assert(routineUi.scheduleCron(picks({ time: "07:00" }), "30 8 * * 1-5") === "0 7 * * 1-5", "editing the time kept the days");
  assert(routineUi.scheduleCron(picks({ frequency: "monthly", day: 2 }), "30 8 * * 1-5") === "30 8 2 * *", "editing the frequency kept the time");
  assert((await throws(() => routineUi.scheduleCron(picks({ frequency: "weekly" })), "weekly without a day")) === "Choose a weekday.", "weekly needs a weekday");
  assert((await throws(() => routineUi.scheduleCron(picks({ frequency: "monthly" })), "monthly without a day")) === "Choose a day between 1 and 31.", "monthly needs a day");
  await throws(() => routineUi.scheduleCron(picks({ frequency: "custom" })), "custom without cron");
  await throws(() => routineUi.scheduleCron(picks({ frequency: "daily", cron: "0 9 * * *" })), "cron with a preset frequency");
  await throws(() => routineUi.scheduleCron(picks({ frequency: "daily", weekday: "2" })), "weekday with daily");
  await throws(() => routineUi.scheduleCron(picks({ time: "10:00" }), "*/5 * * * *"), "time on a custom schedule without frequency");
  await throws(() => routineUi.scheduleCron(picks({ time: "25:00" })), "invalid time");
  const jaTr = translatorFor("ja");
  assert(routineUi.describeSchedule("0 8 * * 1", jaTr) === "毎週月曜日 08:00", `ja schedule: ${routineUi.describeSchedule("0 8 * * 1", jaTr)}`);
  assert(routineUi.describeSchedule("*/5 * * * *", u1.tr) === "Custom: `*/5 * * * *`", "custom schedules are shown as code");

  // ── Every string the two features show has Japanese.
  for (const file of ["skills", "routines"]) {
    const source = await readFile(path.join("lib", "discord-features", `${file}.ts`), "utf8");
    const keys = [...source.matchAll(/\btr\("((?:[^"\\]|\\.)*)"/g), ...source.matchAll(/new Error\("((?:[^"\\]|\\.)*)"\)/g)].map((match) => JSON.parse(`"${match[1]}"`) as string);
    const untranslated = [...new Set(keys)].filter((key) => !ja[key]);
    assert(keys.length > 10 && untranslated.length === 0, `${file}: missing Japanese for ${untranslated.join(" | ")}`);
  }
  for (const name of ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]) assert(Boolean(ja[name]), `weekday ${name}`);

  // ── Command definitions fit Discord's rules.
  for (const { feature } of [skillUi, routineUi]) {
    for (const definition of feature.commands.map((item) => item.toJSON())) {
      const check = (item: { name: string; description: string; description_localizations?: Record<string, string | null> | null; options?: unknown[] }, where: string) => {
        assert(/^[a-z][a-z0-9_-]{0,31}$/.test(item.name), `${where}: name ${item.name}`);
        assert(item.description.length <= 100 && (item.description_localizations?.ja ?? "").length > 0 && (item.description_localizations?.ja ?? "").length <= 100, `${where}: description`);
        const options = (item.options ?? []) as { name: string; description: string; type: number; required?: boolean; options?: unknown[]; choices?: unknown[] }[];
        assert(options.length <= 25, `${where}: too many options`);
        const firstOptional = options.findIndex((option) => option.type !== 1 && !option.required);
        assert(firstOptional === -1 || options.slice(firstOptional).every((option) => !option.required), `${where}: required option after an optional one`);
        for (const option of options) {
          assert((option.choices?.length ?? 0) <= 25, `${where}.${option.name}: choices`);
          check(option, `${where}.${option.name}`);
        }
      };
      check(definition, definition.name);
    }
  }

  // ── /skill handlers, driven the way the router drives them.
  const run = async (feature: typeof skillUi.feature, commandName: string, sub: string, values: Values, ctx = u1) => {
    const fake = fakeCommand(commandName, sub, values);
    const interaction = fake.interaction as unknown as ChatInputCommandInteraction;
    fake.interaction.deferred = !feature.opensModal?.(interaction);
    await feature.command?.(interaction, ctx);
    return { sent: fake.sent, modal: fake.modal() };
  };
  const skill = (sub: string, values: Values = {}, ctx = u1) => run(skillUi.feature, "skill", sub, values, ctx);
  const routine = (sub: string, values: Values = {}, ctx = u1) => run(routineUi.feature, "routine", sub, values, ctx);

  const listed = await skill("list");
  assert(text(listed.sent).includes("Weekly Digest") && text(listed.sent).includes("Inbox triage"), "skill list");
  const form = await skill("create", { name: "Release notes" });
  assert(form.modal?.toJSON().custom_id === "sk:new" && form.modal.toJSON().components[0].component.value === "Release notes" && form.sent.length === 0, "create should open a prefilled form");
  const submit = async (args: string[], fields: Record<string, string>, ctx = u1, feature = skillUi.feature) => {
    const fake = fakeModal(fields);
    await feature.modal?.(fake.interaction, ctx, args);
    return fake.sent;
  };
  assert(text(await submit(["new"], { name: "Release notes", body: "List the changes." })).startsWith("Created the skill Release notes."), "form submit");
  const duplicate = await submit(["new"], { name: "release notes", body: "Typed text" });
  assert(text(duplicate).includes("already exists") && duplicate[0].files?.length === 1, "a duplicate from the form should keep the typed text");

  const realFetch = globalThis.fetch;
  const served = new Map<string, string>();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = served.get(url);
    if (body === undefined) return realFetch(input, init);
    return new Response(body);
  }) as typeof fetch;
  const attach = (name: string, body: string, contentType: string | null = "text/markdown; charset=utf-8") => {
    const url = `https://cdn.discordapp.com/attachments/1/2/${name}`;
    served.set(url, body);
    return { name, url, size: Buffer.byteLength(body), contentType };
  };
  const longBody = `# Deploy\r\n${"Step. ".repeat(1_500)}`;
  const fromFile = await skill("create", { file: attach("deploy-guide.md", longBody) });
  assert(fromFile.modal === null && text(fromFile.sent) === "Created the skill deploy-guide.", `create from file: ${text(fromFile.sent)}`);
  const stored = (await store.readStore("u1")).skills.find((item) => item.name === "deploy-guide");
  assert(stored?.body === longBody.replace(/\r\n/g, "\n"), "file body not stored as sent");
  assert(text((await skill("create", { file: attach("photo.png", "x", "image/png") })).sent).includes("Attach a text"), "binary file accepted");
  assert(text((await skill("create", { file: { ...attach("big.md", "x"), size: 400_001 } })).sent).includes("too long"), "oversized file accepted");
  assert(text((await skill("create", { file: { name: "a.md", url: "https://example.com/a.md", size: 3, contentType: "text/markdown" } })).sent).includes("Could not read"), "non-Discord URL fetched");
  assert(text((await skill("create", { file: attach("empty.md", "  \n") })).sent).includes("empty"), "empty file accepted");

  const shortShow = await skill("show", { name: skillId });
  assert(text(shortShow.sent).includes("```md") && !shortShow.sent[0].files?.length, "short skill inline");
  const longShow = await skill("show", { name: "deploy-guide" });
  assert(longShow.sent[0].files?.length === 1, "long skill should be attached");
  const longEdit = await skill("edit", { name: "deploy-guide" });
  assert(longEdit.modal === null && longEdit.sent[0].files?.length === 1 && text(longEdit.sent).includes("4,000"), "a long skill cannot be edited in a form");
  const shortEdit = await skill("edit", { name: "weekly digest" });
  const editForm = shortEdit.modal?.toJSON();
  assert(editForm?.custom_id === `sk:edit:${skillId}` && editForm.components[1].component.value === "Summarize the week again.", "edit form should be prefilled");
  assert(text(await submit(["edit", skillId], { name: "Weekly Digest", body: "New body" })).startsWith("Saved the skill"), "edit submit");
  assert(text(await submit(["edit", skillId], { name: "Hijack", body: "x" }, u2)).includes("no longer exists"), "u2 edited u1's skill through a form");
  const replaced = await skill("edit", { name: skillId, file: attach("v2.txt", "Version two", "text/plain") });
  assert(text(replaced.sent) === "Saved the skill Weekly Digest." && (await store.readStore("u1")).skills.find((item) => item.id === skillId)?.body === "Version two", "edit from file");
  assert(text((await skill("show", { name: "nothing here" })).sent).includes("No skill with that name"), "unknown skill");

  const confirm = await skill("delete", { name: skillId });
  const buttons = confirm.sent[0].components?.[0].toJSON().components.map((item) => item.custom_id);
  assert(buttons?.[0] === `sk:del:${skillId}` && buttons[1] === "sk:cancel", `delete confirmation: ${JSON.stringify(buttons)}`);
  const foreignPress = fakeButton();
  await skillUi.feature.component?.(foreignPress.interaction, u2, ["del", skillId]);
  assert(text(foreignPress.sent).includes("no longer exists") && (await store.readStore("u1")).skills.some((item) => item.id === skillId), "u2 deleted u1's skill with a button");
  const press = fakeButton();
  await skillUi.feature.component?.(press.interaction, u1, ["del", skillId]);
  assert(text(press.sent) === "Deleted the skill Weekly Digest." && !(await store.readStore("u1")).skills.some((item) => item.id === skillId), "delete button");
  const own = fakeAutocomplete("name", "");
  await skillUi.feature.autocomplete?.(own.interaction, u2);
  assert(!own.answered().some((item) => item.name === "Inbox triage"), "autocomplete showed another account's skills");

  // ── /routine handlers.
  const direct = await routine("create", { teammate: chief.id, frequency: "weekly", weekday: "1", time: "8:30", name: "Plan the week", instructions: "List priorities." }, ctxFor("u1", "ja"));
  const planned = (await store.readStore("u1")).routines.find((item) => item.name === "Plan the week");
  assert(direct.modal === null && planned?.cron === "30 8 * * 1" && planned.threadId === dmOf(chief.id) && planned.locale === "ja", `direct create: ${text(direct.sent)}`);
  assert(text(direct.sent).includes("毎週月曜日 08:30") && text(direct.sent).includes("Asia/Tokyo"), `ja confirmation: ${text(direct.sent)}`);

  const opened = await routine("create", { teammate: chief.name.toLowerCase(), frequency: "daily", time: "07:05", timezone: "europe/paris" });
  const routineForm = opened.modal?.toJSON();
  assert(routineForm?.custom_id === `rt:new:${chief.id}::5_7_*_*_*:Europe/Paris`, `create form id: ${routineForm?.custom_id} ${text(opened.sent)}`);
  const formArgs = routineForm.custom_id.split(":").slice(1);
  const formSaved = await submit(formArgs, { name: "Inbox sweep", instructions: "Clear the inbox." }, u1, routineUi.feature);
  const swept = (await store.readStore("u1")).routines.find((item) => item.name === "Inbox sweep");
  assert(swept?.cron === "5 7 * * *" && swept.timezone === "Europe/Paris" && swept.threadId === dmOf(chief.id) && text(formSaved).startsWith("Created the routine"), `form create: ${text(formSaved)}`);
  assert(text(await submit(formArgs, { name: "Sneaky", instructions: "x" }, ctxFor("u2"), routineUi.feature)).includes("Created") === true, "seeded teammates exist in every workspace");
  assert(!(await store.readStore("u1")).routines.some((item) => item.name === "Sneaky"), "u2's form wrote to u1");
  const lost = await submit(["new", second.id, "grp_launch", "0_9_*_*_*", ""], { name: "Outsider", instructions: "Keep me" }, u1, routineUi.feature);
  assert(text(lost).includes("is not in the group") && lost[0].files?.length === 1, "a refused form should keep the typed text");

  const grouped = await routine("create", { teammate: chief.id, group: "launch", name: "Launch check", instructions: "Status?" });
  assert((await store.readStore("u1")).routines.find((item) => item.name === "Launch check")?.threadId === "grp_launch", `group create: ${text(grouped.sent)}`);
  assert(text((await routine("create", { teammate: second.id, group: "grp_launch", name: "X", instructions: "Y" })).sent).includes("is not in the group"), "group membership");
  const badTime = await routine("create", { teammate: chief.id, time: "25:00" });
  assert(badTime.modal === null && text(badTime.sent).includes("HH:MM"), "a bad time should be reported before the form");
  assert(text((await routine("create", { teammate: chief.id, timezone: "Nowhere/Zone" })).sent).includes("Unknown timezone"), "unknown timezone");
  assert(text((await routine("create", { teammate: chief.id, frequency: "custom", cron: "99 * * * *" })).sent).includes("cron"), "bad cron before the form");
  assert(text((await routine("create", { teammate: "Nobody" })).sent).includes("No teammate"), "unknown teammate");
  const fileNoName = await routine("create", { teammate: chief.id, file: attach("steps.md", "Do things") });
  assert(text(fileNoName.sent).includes("Add name:"), "file without a name");
  await routine("create", { teammate: chief.id, name: "From file", file: attach("steps2.md", "Long steps") });
  assert((await store.readStore("u1")).routines.find((item) => item.name === "From file")?.instructions === "Long steps", "instructions from a file");

  const pausedReply = await routine("pause", { name: "plan the week" });
  assert(text(pausedReply.sent).startsWith("Paused Plan the week") && (await store.readStore("u1")).routines.find((item) => item.name === "Plan the week")?.enabled === false, "pause");
  assert(text((await routine("pause", { name: "plan the week" })).sent).includes("already paused"), "pause twice");
  await store.mutateStore("u1", (data) => {
    const item = data.routines.find((entry) => entry.name === "Inbox sweep");
    if (item) item.lastError = "Model unavailable\nretry later";
  });
  const routineList = text((await routine("list")).sent);
  assert(routineList.includes("Every Monday at 08:30") && routineList.includes("Paused") && routineList.includes("Last error: Model unavailable retry later") && routineList.includes("(group Launch)"), `routine list: ${routineList}`);
  const resumed = await routine("resume", { name: planned.id });
  const resumedRoutine = (await store.readStore("u1")).routines.find((item) => item.id === planned.id);
  assert(text(resumed.sent).startsWith("Resumed") && resumedRoutine?.enabled === true && Boolean(resumedRoutine.nextRunAt), "resume");

  const moved = await routine("edit", { name: planned.id, time: "10:00" });
  const edited = (await store.readStore("u1")).routines.find((item) => item.id === planned.id);
  assert(edited?.cron === "0 10 * * 1" && (edited.revision ?? 0) > (resumedRoutine.revision ?? 0) && text(moved.sent).startsWith("Saved the routine"), `edit time: ${text(moved.sent)}`);
  const editForm2 = (await routine("edit", { name: planned.id })).modal?.toJSON();
  assert(editForm2?.custom_id === `rt:edit:${planned.id}` && editForm2.components[1].component.value === "List priorities.", "routine edit form");
  await submit(["edit", planned.id], { name: "Plan the week v2", instructions: "List priorities and risks." }, u1, routineUi.feature);
  assert((await store.readStore("u1")).routines.find((item) => item.id === planned.id)?.instructions === "List priorities and risks.", "routine edit submit");
  assert(text(await submit(["edit", planned.id], { name: "Taken", instructions: "x" }, u2, routineUi.feature)).includes("no longer exists"), "u2 edited u1's routine through a form");
  await store.mutateStore("u1", (data) => {
    const item = data.routines.find((entry) => entry.id === planned.id);
    if (item) item.instructions = "y".repeat(5_000);
  });
  const longRoutine = await routine("edit", { name: planned.id });
  assert(longRoutine.modal === null && longRoutine.sent[0].files?.length === 1, "long instructions cannot be edited in a form");

  const routineConfirm = await routine("delete", { name: planned.id });
  assert(routineConfirm.sent[0].components?.[0].toJSON().components[0].custom_id === `rt:del:${planned.id}`, "routine delete confirmation");
  const foreignRoutinePress = fakeButton();
  await routineUi.feature.component?.(foreignRoutinePress.interaction, u2, ["del", planned.id]);
  assert((await store.readStore("u1")).routines.some((item) => item.id === planned.id), "u2 deleted u1's routine with a button");
  const routinePress = fakeButton();
  await routineUi.feature.component?.(routinePress.interaction, u1, ["del", planned.id]);
  assert(text(routinePress.sent).startsWith("Deleted the routine") && !(await store.readStore("u1")).routines.some((item) => item.id === planned.id), "routine delete button");

  assert(text((await routine("timezone")).sent).includes("Asia/Tokyo"), "show timezone");
  assert(text((await routine("timezone", { zone: "Nowhere" })).sent).includes("Unknown timezone") && (await store.readStore("u1")).config.timezone === "Asia/Tokyo", "invalid default timezone");
  assert(text((await routine("timezone", { zone: "europe/london" })).sent).includes("Europe/London") && (await store.readStore("u1")).config.timezone === "Europe/London", "set default timezone");

  const zones = fakeAutocomplete("zone", "tokyo");
  await routineUi.feature.autocomplete?.(zones.interaction, u1);
  assert(zones.answered().some((item) => item.value === "Asia/Tokyo") && zones.answered().length <= 25, "timezone autocomplete");
  const groups = fakeAutocomplete("group", "", { teammate: second.id });
  await routineUi.feature.autocomplete?.(groups.interaction, u1);
  assert(!groups.answered().some((item) => item.value === "grp_launch"), "group autocomplete offered a group the teammate is not in");
  const groupsForChief = fakeAutocomplete("group", "lau", { teammate: chief.id });
  await routineUi.feature.autocomplete?.(groupsForChief.interaction, u1);
  assert(groupsForChief.answered().some((item) => item.value === "grp_launch"), "group autocomplete");
  const foreignRoutines = fakeAutocomplete("name", "");
  await routineUi.feature.autocomplete?.(foreignRoutines.interaction, u2);
  assert(!foreignRoutines.answered().some((item) => item.name.startsWith("Inbox sweep")), "routine autocomplete showed another account's routines");

  globalThis.fetch = realFetch;
  console.log("discord skills and routines verification passed");
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

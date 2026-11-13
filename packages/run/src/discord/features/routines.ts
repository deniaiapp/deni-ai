import { discordErrorText } from "../i18n";
import { scrubServerPaths } from "../text";
import {
  type ChatInputCommandInteraction,
  escapeMarkdown,
  LabelBuilder,
  ModalBuilder,
  type RepliableInteraction,
  type SlashCommandStringOption,
  type SlashCommandSubcommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { nextCron } from "../../jobs/cron";
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

import {
  formatRoutineTime,
  readRoutineSchedule,
  type RoutineFrequency,
  routineCron,
  WEEKDAYS,
} from "../../jobs/routine-schedule";
import {
  createRoutine,
  type CreateRoutineInput,
  deleteRoutine,
  normalizeTimezone,
  ROUTINE_CRON_MAX,
  ROUTINE_INSTRUCTIONS_MAX,
  ROUTINE_NAME_MAX,
  type RoutineResult,
  setDefaultTimezone,
  updateRoutine,
  type UpdateRoutineInput,
} from "../../jobs/routines";
import { readStore } from "../../data/store";
import type { Routine, Store, Thread } from "../../types";
import { MODAL_TEXT_MAX, readTextAttachment, textAttachment, textFileProblem } from "./skills";

const PREFIX = "rt";
/** Discord's cap for a string option. */
const OPTION_TEXT_MAX = 6_000;

const FREQUENCIES: { value: RoutineFrequency; en: string; ja: string }[] = [
  { value: "daily", en: "Every day", ja: "毎日" },
  { value: "weekdays", en: "Weekdays (Mon–Fri)", ja: "平日(月〜金)" },
  { value: "weekly", en: "Weekly", ja: "毎週" },
  { value: "monthly", en: "Monthly", ja: "毎月" },
  { value: "custom", en: "Custom (cron)", ja: "カスタム(cron)" },
];
const WEEKDAYS_JA = ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"];
const COMMON_TIMEZONES = [
  "Asia/Tokyo",
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Asia/Singapore",
  "Australia/Sydney",
];
let timezones: string[] | undefined;
const allTimezones = () =>
  (timezones ??= [...new Set([...COMMON_TIMEZONES, ...Intl.supportedValuesOf("timeZone")])]);

// Options that change a routine in /routine edit; with none of them the edit form opens.
const EDIT_OPTIONS = ["frequency", "time", "weekday", "cron", "timezone", "rename", "instructions"];

export type SchedulePicks = {
  frequency: RoutineFrequency | null;
  time: string | null;
  weekday: string | null;
  day: number | null;
  cron: string | null;
};

/** "9:30", "09:30", and "9：30" all mean 09:30; a bare hour means on the hour. */
export function parseTime(value: string): string | null {
  const match = /^([01]?\d|2[0-3])(?:[:：]([0-5]\d))?$/.exec(value.trim());
  return match ? `${match[1].padStart(2, "0")}:${match[2] ?? "00"}` : null;
}

const touched = (picks: SchedulePicks) =>
  Boolean(picks.frequency || picks.time || picks.weekday || picks.day !== null || picks.cron);

/**
 * The cron for the picked schedule. Picks left out keep the current schedule's values, so
 * `/routine edit time:10:00` only moves the time. Throws English text that says what to fix.
 */
export function scheduleCron(picks: SchedulePicks, current?: string): string {
  const base = readRoutineSchedule(current ?? "0 9 * * *");
  const frequency = picks.frequency ?? (picks.cron ? "custom" : base.frequency);
  if (frequency === "custom") {
    if (picks.time || picks.weekday || picks.day !== null)
      throw new Error("With a custom schedule, put the time and days in cron:.");
    const cron = (picks.cron ?? current ?? "").trim();
    if (!cron) throw new Error("Add cron: for a custom schedule, for example 0 9 * * 1-5.");
    return cron;
  }
  if (picks.cron) throw new Error("cron: only works with frequency: custom.");
  if (base.frequency === "custom" && !picks.frequency)
    throw new Error("This routine has a custom schedule. Choose frequency: as well.");
  if (picks.weekday && frequency !== "weekly")
    throw new Error("weekday: only works with frequency: weekly.");
  if (picks.day !== null && frequency !== "monthly")
    throw new Error("day: only works with frequency: monthly.");
  let time = base.time;
  if (picks.time !== null) {
    const parsed = parseTime(picks.time);
    if (!parsed) throw new Error("Write the time as HH:MM, for example 09:30.");
    time = parsed;
  }
  const weekday = picks.weekday ?? (base.frequency === "weekly" ? base.weekday : "");
  const day = picks.day !== null ? String(picks.day) : base.frequency === "monthly" ? base.day : "";
  return routineCron({ frequency, time, weekday, day, cron: "" });
}

/** The schedule in words, like the web app's routine list. */
export function describeSchedule(cron: string, tr: Translate, markdown = true) {
  const schedule = readRoutineSchedule(cron);
  const time = schedule.time;
  if (schedule.frequency === "custom")
    return tr("Custom: {cron}", { cron: markdown ? `\`${cron.replace(/`/g, "'")}\`` : cron });
  if (schedule.frequency === "daily") return tr("Every day at {time}", { time });
  if (schedule.frequency === "weekdays") return tr("Weekdays at {time}", { time });
  if (schedule.frequency === "weekly")
    return tr("Every {weekday} at {time}", {
      weekday: tr(WEEKDAYS[Number(schedule.weekday)] ?? "Sunday"),
      time,
    });
  return tr("Day {day} of each month at {time}", { day: schedule.day, time });
}

function whoRuns(routine: Routine, store: Store, tr: Translate) {
  const bot = store.bots.find((item) => item.id === routine.botId);
  const teammate = bot ? escapeMarkdown(bot.name) : tr("a deleted teammate");
  const thread = store.threads.find((item) => item.id === routine.threadId);
  return thread?.kind === "group"
    ? tr("{teammate} (group {group})", { teammate, group: escapeMarkdown(thread.title) })
    : teammate;
}

/** Who, when, and the next run in the routine's own timezone. */
export function routineSummary(routine: Routine, store: Store, tr: Translate, locale: string) {
  // Old routines may have no timezone; the scheduler then uses the account default.
  const zone = routine.timezone || store.config.timezone;
  const state = routine.enabled
    ? tr("Next run {time}", { time: formatRoutineTime(routine.nextRunAt, zone, locale) })
    : tr("Paused");
  return `${whoRuns(routine, store, tr)} · ${describeSchedule(routine.cron, tr)} (${zone}) · ${state}`;
}

type Target =
  | { ok: true; botId: string; botName: string; thread: Thread }
  | { ok: false; message: string };

/**
 * The conversation a new routine posts to: the teammate's DM, or a group the teammate is in.
 * Both values may be typed names or autocomplete ids, and only this store's entries match.
 */
function resolveTarget(
  store: Store,
  teammate: string,
  group: string | null,
  tr: Translate,
): Target {
  const bot = findByIdOrName(store.bots, teammate);
  if (!bot)
    return { ok: false, message: tr("No teammate with that name. Run /teammate to see the list.") };
  if (group) {
    const groups = store.threads
      .filter((item) => item.kind === "group")
      .map((item) => ({ id: item.id, name: item.title, thread: item }));
    const match = findByIdOrName(groups, group);
    if (!match)
      return {
        ok: false,
        message: tr(
          "No group with that name. Run /routine create again and pick one from the list.",
        ),
      };
    if (!match.thread.botIds.includes(bot.id))
      return {
        ok: false,
        message: tr("{teammate} is not in the group {group}.", {
          teammate: bot.name,
          group: match.name,
        }),
      };
    return { ok: true, botId: bot.id, botName: bot.name, thread: match.thread };
  }
  const thread = store.threads.find((item) => item.kind === "dm" && item.botIds[0] === bot.id);
  return thread
    ? { ok: true, botId: bot.id, botName: bot.name, thread }
    : { ok: false, message: tr("Teammate or conversation not found.") };
}

function readPicks(interaction: ChatInputCommandInteraction): SchedulePicks {
  const frequency = interaction.options.getString("frequency");
  return {
    frequency: FREQUENCIES.find((item) => item.value === frequency)?.value ?? null,
    time: interaction.options.getString("time"),
    weekday: interaction.options.getString("weekday"),
    day: interaction.options.getInteger("day"),
    cron: interaction.options.getString("cron"),
  };
}

function scheduleOptions(sub: SlashCommandSubcommandBuilder) {
  return sub
    .addStringOption((option) =>
      option
        .setName("frequency")
        .setDescription("How often it runs")
        .setDescriptionLocalization("ja", "実行する頻度")
        .addChoices(
          ...FREQUENCIES.map((item) => ({
            name: item.en,
            value: item.value,
            name_localizations: { ja: item.ja },
          })),
        ),
    )
    .addStringOption((option) =>
      option
        .setName("time")
        .setDescription("Time of day as HH:MM, for example 09:30")
        .setDescriptionLocalization("ja", "時刻(HH:MM 形式、例: 09:30)")
        .setMaxLength(8),
    )
    .addStringOption((option) =>
      option
        .setName("weekday")
        .setDescription("Day of the week, for weekly")
        .setDescriptionLocalization("ja", "曜日(毎週の場合)")
        .addChoices(
          ...WEEKDAYS.map((name, index) => ({
            name,
            value: String(index),
            name_localizations: { ja: WEEKDAYS_JA[index] },
          })),
        ),
    )
    .addIntegerOption((option) =>
      option
        .setName("day")
        .setDescription("Day of the month, for monthly")
        .setDescriptionLocalization("ja", "日付(毎月の場合)")
        .setMinValue(1)
        .setMaxValue(31),
    )
    .addStringOption((option) =>
      option
        .setName("cron")
        .setDescription("Cron expression, for custom, for example 0 9 * * 1-5")
        .setDescriptionLocalization("ja", "cron 式(カスタムの場合、例: 0 9 * * 1-5)")
        .setMaxLength(ROUTINE_CRON_MAX),
    )
    .addStringOption((option) =>
      option
        .setName("timezone")
        .setDescription("Timezone of this routine; defaults to /routine timezone")
        .setDescriptionLocalization(
          "ja",
          "このルーティンのタイムゾーン(既定は /routine timezone の設定)",
        )
        .setMaxLength(100)
        .setAutocomplete(true),
    );
}

function routineOption(option: SlashCommandStringOption) {
  return option
    .setName("name")
    .setDescription("Routine name")
    .setDescriptionLocalization("ja", "ルーティン名")
    .setRequired(true)
    .setAutocomplete(true);
}

const instructionsOption = (option: SlashCommandStringOption) =>
  option
    .setName("instructions")
    .setDescription("What the teammate should do each time")
    .setDescriptionLocalization("ja", "毎回チームメイトにしてほしいこと")
    .setMaxLength(OPTION_TEXT_MAX);
const fileOption = {
  en: "A .md or .txt file with long instructions",
  ja: "長い指示を書いた .md または .txt ファイル",
};

const command = dmCommand(
  "routine",
  "Schedule recurring work for your teammates",
  "チームメイトの定期実行を管理",
)
  .addSubcommand((sub) =>
    sub
      .setName("list")
      .setDescription("List your routines")
      .setDescriptionLocalization("ja", "ルーティンの一覧"),
  )
  .addSubcommand((sub) =>
    scheduleOptions(
      sub
        .setName("create")
        .setDescription("Create a routine; without name and instructions a form opens")
        .setDescriptionLocalization("ja", "ルーティンを作成(名前と指示を省くとフォームが開きます)")
        .addStringOption((option) =>
          option
            .setName("teammate")
            .setDescription("Teammate who runs it")
            .setDescriptionLocalization("ja", "実行するチームメイト")
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
      .addStringOption((option) =>
        option
          .setName("group")
          .setDescription("Post in this group instead of the teammate's DM")
          .setDescriptionLocalization("ja", "チームメイトの DM ではなくこのグループに投稿")
          .setAutocomplete(true),
      )
      .addStringOption((option) =>
        option
          .setName("name")
          .setDescription("Routine name")
          .setDescriptionLocalization("ja", "ルーティン名")
          .setMaxLength(ROUTINE_NAME_MAX),
      )
      .addStringOption(instructionsOption)
      .addAttachmentOption((option) =>
        option
          .setName("file")
          .setDescription(fileOption.en)
          .setDescriptionLocalization("ja", fileOption.ja),
      ),
  )
  .addSubcommand((sub) =>
    scheduleOptions(
      sub
        .setName("edit")
        .setDescription("Change a routine; with no other options a form opens")
        .setDescriptionLocalization(
          "ja",
          "ルーティンを変更(ほかのオプションがなければフォームが開きます)",
        )
        .addStringOption(routineOption),
    )
      .addStringOption((option) =>
        option
          .setName("rename")
          .setDescription("New name")
          .setDescriptionLocalization("ja", "新しい名前")
          .setMaxLength(ROUTINE_NAME_MAX),
      )
      .addStringOption(instructionsOption)
      .addAttachmentOption((option) =>
        option
          .setName("file")
          .setDescription(fileOption.en)
          .setDescriptionLocalization("ja", fileOption.ja),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("pause")
      .setDescription("Pause a routine")
      .setDescriptionLocalization("ja", "ルーティンを一時停止")
      .addStringOption(routineOption),
  )
  .addSubcommand((sub) =>
    sub
      .setName("resume")
      .setDescription("Resume a paused routine")
      .setDescriptionLocalization("ja", "一時停止中のルーティンを再開")
      .addStringOption(routineOption),
  )
  .addSubcommand((sub) =>
    sub
      .setName("delete")
      .setDescription("Delete a routine")
      .setDescriptionLocalization("ja", "ルーティンを削除")
      .addStringOption(routineOption),
  )
  .addSubcommand((sub) =>
    sub
      .setName("timezone")
      .setDescription("Show or set the timezone new routines use")
      .setDescriptionLocalization("ja", "新しいルーティンのタイムゾーンを表示・設定")
      .addStringOption((option) =>
        option
          .setName("zone")
          .setDescription("IANA timezone, for example Asia/Tokyo")
          .setDescriptionLocalization("ja", "IANA タイムゾーン(例: Asia/Tokyo)")
          .setMaxLength(100)
          .setAutocomplete(true),
      ),
  );

function routineModal(
  tr: Translate,
  args: string[],
  title: string,
  schedule: string,
  values: { name?: string; instructions?: string },
) {
  const name = new TextInputBuilder()
    .setCustomId("name")
    .setStyle(TextInputStyle.Short)
    .setMaxLength(ROUTINE_NAME_MAX)
    .setRequired(true);
  const instructions = new TextInputBuilder()
    .setCustomId("instructions")
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(MODAL_TEXT_MAX)
    .setRequired(true);
  if (values.name) name.setValue(truncate(values.name, ROUTINE_NAME_MAX));
  if (values.instructions) instructions.setValue(values.instructions);
  return new ModalBuilder()
    .setCustomId(customId(PREFIX, ...args))
    .setTitle(truncate(title, 45))
    .addLabelComponents(
      new LabelBuilder().setLabel(truncate(tr("Name"), 45)).setTextInputComponent(name),
      new LabelBuilder()
        .setLabel(truncate(tr("Instructions"), 45))
        .setDescription(truncate(tr("Schedule: {schedule}", { schedule }), 100))
        .setTextInputComponent(instructions),
    );
}

function failure(result: Extract<RoutineResult, { ok: false }>, tr: Translate, notFound: string) {
  if (result.reason === "not_found") return notFound;
  const byField: Record<string, string> = {
    name: tr("Name is required."),
    instructions: tr("Instruction is required."),
    cron: tr("When to run is required."),
  };
  return byField[result.field] ?? tr("Invalid routine.");
}

/** Validate the schedule and timezone up front, so a typo is reported before anything is typed into a form. */
function checkSchedule(cron: string, timezone: string, locale: string) {
  try {
    nextCron(cron, timezone);
    return null;
  } catch (error) {
    return discordErrorText(locale, error);
  }
}

function pickTimezone(interaction: ChatInputCommandInteraction, tr: Translate) {
  const typed = interaction.options.getString("timezone");
  if (!typed) return { ok: true as const, zone: undefined };
  const zone = normalizeTimezone(typed);
  return zone
    ? { ok: true as const, zone }
    : { ok: false as const, message: unknownZone(typed, tr) };
}

const unknownZone = (typed: string, tr: Translate) =>
  tr("Unknown timezone {zone}. Pick one from the list, for example Asia/Tokyo.", {
    zone: truncate(typed, 100),
  });

/** Save a new routine and say so. keep is text the person typed into a form, sent back if the save fails. */
async function saveNew(
  interaction: RepliableInteraction,
  { link, tr }: FeatureContext,
  input: CreateRoutineInput,
  keep?: string,
) {
  const result = await createRoutine(link.userId, input, link.locale);
  if (result.ok) {
    const store = await readStore(link.userId);
    await respond(
      interaction,
      tr("Created the routine {name}: {summary}", {
        name: escapeMarkdown(result.routine.name),
        summary: routineSummary(result.routine, store, tr, link.locale),
      }),
    );
    return;
  }
  await answerFailure(
    interaction,
    tr,
    failure(result, tr, tr("Teammate or conversation not found.")),
    keep,
  );
}

async function answerFailure(
  interaction: RepliableInteraction,
  tr: Translate,
  message: string,
  keep?: string,
) {
  if (!keep) {
    await respond(interaction, message);
    return;
  }
  await respond(interaction, {
    content: `${message}\n${tr("Your text is attached so nothing is lost.")}`,
    files: [textAttachment(keep, "instructions.md")],
  });
}

/** Instructions from the instructions: option or an attached file, or the problem with the file. */
async function readInstructions(
  interaction: ChatInputCommandInteraction,
  { link, tr }: FeatureContext,
) {
  const file = interaction.options.getAttachment("file");
  if (!file)
    return { ok: true as const, text: interaction.options.getString("instructions")?.trim() ?? "" };
  const read = await readTextAttachment(file, ROUTINE_INSTRUCTIONS_MAX);
  return read.ok
    ? { ok: true as const, text: read.text.trim() }
    : { ok: false as const, message: textFileProblem(read, tr, link.locale) };
}

async function create(interaction: ChatInputCommandInteraction, ctx: FeatureContext) {
  const { link, tr } = ctx;
  const store = await readStore(link.userId);
  const target = resolveTarget(
    store,
    interaction.options.getString("teammate", true),
    interaction.options.getString("group"),
    tr,
  );
  if (!target.ok) return respond(interaction, target.message);
  const timezone = pickTimezone(interaction, tr);
  if (!timezone.ok) return respond(interaction, timezone.message);
  let cron: string;
  try {
    cron = scheduleCron(readPicks(interaction));
  } catch (error) {
    return respond(interaction, discordErrorText(link.locale, error));
  }
  const problem = checkSchedule(cron, timezone.zone ?? store.config.timezone, link.locale);
  if (problem) return respond(interaction, problem);
  const name = interaction.options.getString("name")?.trim() ?? "";
  if (interaction.options.getAttachment("file") && !name)
    return respond(interaction, tr("Add name: when you attach the instructions as a file."));
  const instructions = await readInstructions(interaction, ctx);
  if (!instructions.ok) return respond(interaction, instructions.message);
  if (name && instructions.text) {
    return saveNew(interaction, ctx, {
      botId: target.botId,
      threadId: target.thread.id,
      name,
      instructions: instructions.text,
      cron,
      timezone: timezone.zone,
    });
  }
  if (instructions.text.length > MODAL_TEXT_MAX)
    return respond(
      interaction,
      tr("Add name: as well when the instructions are longer than 4,000 characters."),
    );
  // The form carries the choices in its id: teammate, group ("" for the DM), cron, and timezone.
  const group = target.thread.kind === "group" ? target.thread.id : "";
  let args: string[];
  try {
    args = ["new", target.botId, group, cron.replace(/ /g, "_"), timezone.zone ?? ""];
    customId(PREFIX, ...args);
  } catch {
    return respond(
      interaction,
      tr(
        "These choices are too long to carry into a form. Pass name: and instructions: as options instead.",
      ),
    );
  }
  const schedule = `${describeSchedule(cron, tr, false)} (${timezone.zone ?? store.config.timezone})`;
  await interaction.showModal(
    routineModal(tr, args, tr("New routine for {name}", { name: target.botName }), schedule, {
      name,
      instructions: instructions.text,
    }),
  );
}

async function findRoutine(interaction: ChatInputCommandInteraction, { link, tr }: FeatureContext) {
  const store = await readStore(link.userId);
  const routine = findByIdOrName(store.routines, interaction.options.getString("name", true));
  if (!routine)
    await respond(interaction, tr("No routine with that name. Run /routine list to see them."));
  return routine ? { routine, store } : null;
}

const editHasChanges = (interaction: ChatInputCommandInteraction) =>
  EDIT_OPTIONS.some((name) => interaction.options.getString(name) !== null) ||
  interaction.options.getInteger("day") !== null ||
  interaction.options.getAttachment("file") !== null;

async function edit(interaction: ChatInputCommandInteraction, ctx: FeatureContext) {
  const { link, tr } = ctx;
  const found = await findRoutine(interaction, ctx);
  if (!found) return;
  const { routine } = found;
  if (!editHasChanges(interaction)) {
    if (routine.instructions.length > MODAL_TEXT_MAX) {
      // Hand the current text over so it can be edited and sent back.
      return respond(interaction, {
        content: tr(
          "The instructions of {name} are longer than 4,000 characters, more than a Discord form holds. Edit the attached file and send it back with /routine edit file:.",
          { name: escapeMarkdown(routine.name) },
        ),
        files: [textAttachment(routine.instructions, `${routine.name}.md`)],
      });
    }
    const schedule = `${describeSchedule(routine.cron, tr, false)} (${routine.timezone})`;
    await interaction.showModal(
      routineModal(tr, ["edit", routine.id], tr("Edit routine"), schedule, {
        name: routine.name,
        instructions: routine.instructions,
      }),
    );
    return;
  }
  const patch: UpdateRoutineInput = { id: routine.id };
  const rename = interaction.options.getString("rename")?.trim();
  if (rename) patch.name = rename;
  const instructions = await readInstructions(interaction, ctx);
  if (!instructions.ok) return respond(interaction, instructions.message);
  if (instructions.text) patch.instructions = instructions.text;
  const picks = readPicks(interaction);
  try {
    if (touched(picks)) patch.cron = scheduleCron(picks, routine.cron);
  } catch (error) {
    return respond(interaction, discordErrorText(link.locale, error));
  }
  const timezone = pickTimezone(interaction, tr);
  if (!timezone.ok) return respond(interaction, timezone.message);
  if (timezone.zone) patch.timezone = timezone.zone;
  if (patch.cron || patch.timezone) {
    const problem = checkSchedule(
      patch.cron ?? routine.cron,
      patch.timezone ?? routine.timezone,
      link.locale,
    );
    if (problem) return respond(interaction, problem);
  }
  await saveEdit(interaction, ctx, patch);
}

async function saveEdit(
  interaction: RepliableInteraction,
  { link, tr }: FeatureContext,
  patch: UpdateRoutineInput,
  keep?: string,
) {
  const result = await updateRoutine(link.userId, patch, link.locale);
  if (result.ok) {
    const store = await readStore(link.userId);
    await respond(
      interaction,
      tr("Saved the routine {name}: {summary}", {
        name: escapeMarkdown(result.routine.name),
        summary: routineSummary(result.routine, store, tr, link.locale),
      }),
    );
    return;
  }
  await answerFailure(
    interaction,
    tr,
    failure(result, tr, tr("That routine no longer exists.")),
    keep,
  );
}

async function setEnabled(
  interaction: ChatInputCommandInteraction,
  ctx: FeatureContext,
  enabled: boolean,
) {
  const { link, tr } = ctx;
  const found = await findRoutine(interaction, ctx);
  if (!found) return;
  const { routine } = found;
  const name = escapeMarkdown(routine.name);
  if (routine.enabled === enabled)
    return respond(
      interaction,
      enabled
        ? tr("The routine {name} is already running.", { name })
        : tr("The routine {name} is already paused.", { name }),
    );
  // Resuming computes the next run, which fails for a schedule that was saved invalid long ago.
  const problem = enabled
    ? checkSchedule(routine.cron, routine.timezone || found.store.config.timezone, link.locale)
    : null;
  if (problem)
    return respond(
      interaction,
      `${problem}\n${tr("Fix the schedule with /routine edit, then resume.")}`,
    );
  const result = await updateRoutine(link.userId, { id: routine.id, enabled }, link.locale);
  if (!result.ok) return respond(interaction, tr("That routine no longer exists."));
  const next = formatRoutineTime(result.routine.nextRunAt, result.routine.timezone, link.locale);
  await respond(
    interaction,
    enabled
      ? tr("Resumed {name}. Next run: {time}.", { name, time: next })
      : tr("Paused {name}. It will not run until you resume it.", { name }),
  );
}

async function list(interaction: ChatInputCommandInteraction, { link, tr }: FeatureContext) {
  const store = await readStore(link.userId);
  const footer = tr("New routines use {zone}. Change it with /routine timezone.", {
    zone: store.config.timezone,
  });
  if (!store.routines.length)
    return respond(
      interaction,
      `${tr("No routines yet. Create one with /routine create.")}\n${footer}`,
    );
  const items = store.routines.map((routine) => {
    const line = `**${escapeMarkdown(routine.name)}** — ${routineSummary(routine, store, tr, link.locale)}`;
    if (!routine.lastError) return line;
    return `${line}\n  ${tr("Last error: {error}", { error: escapeMarkdown(truncate(scrubServerPaths(routine.lastError).replace(/\s+/g, " "), 200)) })}`;
  });
  await respond(
    interaction,
    `${tr("Routines ({count})", { count: store.routines.length })}\n${bulletList(items, tr, "")}\n\n${footer}`,
  );
}

async function timezone(interaction: ChatInputCommandInteraction, { link, tr }: FeatureContext) {
  const typed = interaction.options.getString("zone");
  if (!typed) {
    const { config } = await readStore(link.userId);
    return respond(
      interaction,
      tr("New routines use {zone}. Change it with /routine timezone zone:.", {
        zone: config.timezone,
      }),
    );
  }
  const zone = await setDefaultTimezone(link.userId, typed);
  if (!zone) return respond(interaction, unknownZone(typed, tr));
  await respond(
    interaction,
    tr(
      "New routines now use {zone}. Existing routines keep their own timezone; change one with /routine edit timezone:.",
      { zone },
    ),
  );
}

async function confirmDelete(interaction: ChatInputCommandInteraction, ctx: FeatureContext) {
  const found = await findRoutine(interaction, ctx);
  if (!found) return;
  await respond(interaction, {
    content: ctx.tr("Delete the routine {name}? It will stop running.", {
      name: escapeMarkdown(found.routine.name),
    }),
    components: [confirmRow(PREFIX, ["del", found.routine.id], ctx.tr)],
  });
}

export const feature: DiscordFeature = {
  commands: [command],
  prefix: PREFIX,
  opensModal(interaction) {
    const sub = interaction.options.getSubcommand(false);
    if (sub === "edit") return !editHasChanges(interaction);
    if (sub !== "create" || interaction.options.getAttachment("file")) return false;
    return !(
      interaction.options.getString("name")?.trim() &&
      interaction.options.getString("instructions")?.trim()
    );
  },
  async command(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    if (sub === "list") await list(interaction, ctx);
    else if (sub === "create") await create(interaction, ctx);
    else if (sub === "edit") await edit(interaction, ctx);
    else if (sub === "pause") await setEnabled(interaction, ctx, false);
    else if (sub === "resume") await setEnabled(interaction, ctx, true);
    else if (sub === "delete") await confirmDelete(interaction, ctx);
    else if (sub === "timezone") await timezone(interaction, ctx);
  },
  async autocomplete(interaction, { link }) {
    const focused = interaction.options.getFocused(true);
    const query = String(focused.value);
    if (focused.name === "zone" || focused.name === "timezone") {
      await interaction.respond(
        choices(
          allTimezones(),
          query,
          (zone) => zone,
          (zone) => zone,
        ),
      );
      return;
    }
    const store = await readStore(link.userId);
    if (focused.name === "teammate") {
      await interaction.respond(
        choices(
          store.bots,
          query,
          (bot) => `${bot.name} — ${bot.job}`,
          (bot) => bot.id,
        ),
      );
    } else if (focused.name === "group") {
      // Once a teammate is picked, only the groups they are in can be chosen.
      const bot = findByIdOrName(store.bots, interaction.options.getString("teammate"));
      const groups = store.threads.filter(
        (item) => item.kind === "group" && (!bot || item.botIds.includes(bot.id)),
      );
      await interaction.respond(
        choices(
          groups,
          query,
          (item) => item.title,
          (item) => item.id,
        ),
      );
    } else if (focused.name === "name") {
      const botName = (id: string) => store.bots.find((bot) => bot.id === id)?.name ?? "";
      await interaction.respond(
        choices(
          store.routines,
          query,
          (routine) => `${routine.name} — ${botName(routine.botId)}`,
          (routine) => routine.id,
        ),
      );
    } else {
      await interaction.respond([]);
    }
  },
  async component(interaction, { link, tr }, args) {
    const [action, routineId] = args;
    if (action !== "del" || !routineId) return;
    await interaction.deferUpdate();
    // The id came from a button; deleteRoutine only looks in this person's own routines.
    const deleted = await deleteRoutine(link.userId, routineId);
    await updateMessage(
      interaction,
      deleted
        ? tr("Deleted the routine {name}.", { name: escapeMarkdown(deleted.name) })
        : tr("That routine no longer exists."),
    );
  },
  async modal(interaction, ctx, args) {
    const { link, tr } = ctx;
    const [action, ...rest] = args;
    if (action !== "new" && action !== "edit") return;
    await interaction.deferReply();
    const name = interaction.fields.getTextInputValue("name");
    const instructions = interaction.fields.getTextInputValue("instructions");
    if (action === "edit") {
      const [routineId] = rest;
      if (!routineId) return respond(interaction, tr("That routine no longer exists."));
      await saveEdit(interaction, ctx, { id: routineId, name, instructions }, instructions);
      return;
    }
    const [botId = "", group = "", cron = "", zone = ""] = rest;
    // Ids from the form are looked up again in this person's store before use.
    const store = await readStore(link.userId);
    const target = resolveTarget(store, botId, group || null, tr);
    if (!target.ok) return answerFailure(interaction, tr, target.message, instructions);
    const schedule = cron.replace(/_/g, " ");
    const problem = checkSchedule(schedule, zone || store.config.timezone, link.locale);
    if (problem) return answerFailure(interaction, tr, problem, instructions);
    await saveNew(
      interaction,
      ctx,
      {
        botId: target.botId,
        threadId: target.thread.id,
        name,
        instructions,
        cron: schedule,
        timezone: zone || undefined,
      },
      instructions,
    );
  },
};

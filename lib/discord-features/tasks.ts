import "@tanstack/react-start/server-only";

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  escapeMarkdown,
  type MessageActionRowComponentBuilder,
  time,
  TimestampStyles,
} from "discord.js";
import { getDiscordLinkByUser, getDiscordPrefs } from "../discord-link";
import { scrubServerPaths } from "../discord-text";
import { isBackgroundJobKind } from "../discord-push";
import {
  type ComponentInteraction,
  confirmRow,
  customId,
  type DiscordFeature,
  dmCommand,
  type FeatureContext,
  inApp,
  respond,
  splitForDiscord,
  type Translate,
  truncate,
  updateMessage,
} from "../discord-ui";
import { cancelAndReleaseJob, retryAndRunJob } from "../job-actions";
import { getJob, listJobOverview, listJobs } from "../jobs";
import { isActiveJob } from "../job-view";
import { reportError } from "../report";
import { readStore } from "../store";
import type { AgentJob, JobStatus, Store, Thread } from "../types";

/** The web app's task list: what is running, what recently ended, and Stop and Retry for them. */

const PREFIX = "tk";
const ACTIVE_SHOWN = 15;
const RECENT_SHOWN = 10;
// Discord allows 5 rows of 5 buttons.
const BUTTONS_PER_ROW = 5;
const MAX_BUTTONS = 25;

// The states cancelJob accepts that are still in progress. A finalizing job is about to end on its own.
const STOPPABLE = new Set<JobStatus>(["queued", "running", "waiting_approval", "waiting_takeover"]);

/** retryJob's rule: a failed or uncertain task with attempts left. */
export function canRetry(job: Pick<AgentJob, "status" | "attempt" | "maxAttempts">) {
  return (job.status === "failed" || job.status === "uncertain") && job.attempt < job.maxAttempts;
}

function statusLabel(status: JobStatus, tr: Translate) {
  switch (status) {
    case "queued":
      return tr("Queued");
    case "running":
      return tr("Running");
    case "finalizing":
      return tr("Finishing");
    case "waiting_approval":
      return tr("Waiting for approval");
    case "waiting_takeover":
      return tr("Needs you");
    case "paused":
      return tr("Paused");
    case "uncertain":
      return tr("Needs review");
    case "completed":
      return tr("Completed");
    case "failed":
      return tr("Failed");
    case "cancelled":
      return tr("Cancelled");
  }
}

function kindLabel(kind: AgentJob["kind"], tr: Translate) {
  switch (kind) {
    case "chat":
      return tr("Chat");
    case "routine":
      return tr("Routine");
    case "handoff":
      return tr("Handoff");
    case "retry":
      return tr("Retry");
  }
}

function when(iso: string | null) {
  const at = iso ? new Date(iso) : null;
  return at && Number.isFinite(at.getTime()) ? time(at, TimestampStyles.RelativeTime) : "";
}

function teammateName(store: Store, botId: string, tr: Translate) {
  const bot = store.bots.find((item) => item.id === botId);
  return bot ? bot.name : tr("Removed teammate");
}

/** How a conversation reads in a sentence: a teammate's chat or a named group. */
function conversationName(store: Store, thread: Thread, tr: Translate) {
  if (thread.kind === "group") return tr("the group {name}", { name: escapeMarkdown(thread.title) });
  return tr("your chat with {name}", { name: escapeMarkdown(teammateName(store, thread.botIds[0] ?? "", tr)) });
}

/** One task: who, where (unless it is that teammate's own chat), kind, status, when, and why it failed. */
function jobLine(job: AgentJob, store: Store, tr: Translate, number?: number) {
  const name = teammateName(store, job.botId, tr);
  const thread = store.threads.find((item) => item.id === job.threadId);
  const conversation = !thread ? tr("Deleted conversation") : thread.kind === "dm" && thread.title === name ? "" : escapeMarkdown(thread.title);
  const teammate = escapeMarkdown(name);
  const who = conversation ? tr("{teammate} in {conversation}", { teammate, conversation }) : teammate;
  const at = when(isActiveJob(job) ? job.createdAt : (job.finishedAt ?? job.updatedAt));
  const parts = [who, kindLabel(job.kind, tr), `**${statusLabel(job.status, tr)}**`, at].filter(Boolean);
  const error = job.error && job.status !== "completed" ? `\n    ${escapeMarkdown(truncate(scrubServerPaths(job.error).replace(/\s+/g, " ").trim(), 120))}` : "";
  return `${number ? `**${number}.** ` : ""}${parts.join(" · ")}${error}`;
}

function buttonRows(buttons: ButtonBuilder[]) {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  for (let index = 0; index < Math.min(buttons.length, MAX_BUTTONS); index += BUTTONS_PER_ROW) {
    rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(buttons.slice(index, index + BUTTONS_PER_ROW)));
  }
  return rows;
}

/** Active tasks first, then the latest finished ones, numbered so each button names its line. */
async function taskList(userId: string, tr: Translate) {
  // Recent ids beyond the ten shown leave room for active tasks among the latest ones.
  const [jobs, store] = await Promise.all([listJobOverview(userId, ACTIVE_SHOWN + RECENT_SHOWN, true), readStore(userId)]);
  const allActive = jobs.filter(isActiveJob);
  const active = allActive.slice(0, ACTIVE_SHOWN);
  const recent = jobs.filter((job) => !isActiveJob(job)).slice(0, RECENT_SHOWN);
  if (!active.length && !recent.length) {
    return { content: tr("No tasks yet. They appear here when a teammate works on a message or a routine runs."), components: [] };
  }
  const sections: string[] = [];
  const buttons: ButtonBuilder[] = [];
  let number = 0;
  if (active.length) {
    const lines = active.map((job) => {
      number += 1;
      if (STOPPABLE.has(job.status)) {
        buttons.push(new ButtonBuilder().setCustomId(customId(PREFIX, "stop", job.id)).setLabel(tr("Stop {number}", { number })).setStyle(ButtonStyle.Danger));
      }
      return jobLine(job, store, tr, number);
    });
    if (allActive.length > active.length) lines.push(tr("+{count} more", { count: allActive.length - active.length }));
    sections.push(`**${tr("In progress")}**\n${lines.join("\n")}`);
  }
  if (recent.length) {
    const lines = recent.map((job) => {
      number += 1;
      if (canRetry(job)) {
        buttons.push(new ButtonBuilder().setCustomId(customId(PREFIX, "retry", job.id)).setLabel(tr("Retry {number}", { number })).setStyle(ButtonStyle.Primary));
      }
      return jobLine(job, store, tr, number);
    });
    sections.push(`**${tr("Recent")}**\n${lines.join("\n")}`);
  }
  return { content: sections.join("\n\n"), components: buttonRows(buttons) };
}

/** Where plain DMs go now: the chosen group if it still exists, else the current teammate's chat. */
export function conversationTarget(store: Store, groupId: string | null, botId: string | null) {
  const group = groupId ? store.threads.find((item) => item.id === groupId && item.kind === "group") : undefined;
  if (group) return group;
  const bot = store.bots.find((item) => item.id === botId) ?? store.bots[0];
  return bot ? store.threads.find((item) => item.kind === "dm" && item.botIds[0] === bot.id) : undefined;
}

async function stoppableIn(userId: string, threadId: string) {
  return (await listJobs(userId, { threadId, limit: 50, summary: true })).filter((job) => STOPPABLE.has(job.status));
}

async function askStopConversation(interaction: ChatInputCommandInteraction, { link, tr }: FeatureContext) {
  const [store, prefs] = await Promise.all([readStore(link.userId), getDiscordPrefs(link.userId)]);
  const thread = conversationTarget(store, prefs.threadId, link.botId);
  if (!thread) {
    await respond(interaction, tr("Create a teammate in the app first, then message again."));
    return;
  }
  const conversation = conversationName(store, thread, tr);
  const jobs = await stoppableIn(link.userId, thread.id);
  if (!jobs.length) {
    await respond(interaction, tr("Nothing is running in {conversation}.", { conversation }));
    return;
  }
  const question = jobs.length === 1
    ? tr("Stop the task in {conversation}? It ends now and cannot be resumed.", { conversation })
    : tr("Stop {count} tasks in {conversation}? They end now and cannot be resumed.", { count: jobs.length, conversation });
  const lines = jobs.slice(0, ACTIVE_SHOWN).map((job, index) => jobLine(job, store, tr, index + 1));
  await respond(interaction, {
    content: `${question}\n${lines.join("\n")}`,
    components: [confirmRow(PREFIX, ["stopall", thread.id], tr, tr("Stop"))],
  });
}

/** Stops whatever is running there now: a task that started after the question is stopped too. */
async function stopConversation(userId: string, threadId: string, locale: string, tr: Translate) {
  const store = await readStore(userId);
  const thread = store.threads.find((item) => item.id === threadId);
  if (!thread) return tr("That conversation no longer exists.");
  const conversation = conversationName(store, thread, tr);
  let stopped = 0;
  for (const job of await stoppableIn(userId, thread.id)) {
    if (await cancelAndReleaseJob(userId, job.id, locale)) stopped += 1;
  }
  if (!stopped) return tr("Nothing is running in {conversation} anymore.", { conversation });
  return stopped === 1
    ? tr("Stopped the task in {conversation}.", { conversation })
    : tr("Stopped {count} tasks in {conversation}.", { count: stopped, conversation });
}

/** The DM sent when a retry started from Discord ends, unless the notification push already covers it. */
function retryOutcome(job: AgentJob, store: Store, tr: Translate) {
  const name = teammateName(store, job.botId, tr);
  switch (job.status) {
    case "completed": {
      const text = typeof job.result?.text === "string" ? job.result.text.trim() : "";
      return `**${tr("{name} finished the retried task.", { name: escapeMarkdown(name) })}**${text ? `\n${text}` : ""}`;
    }
    case "failed":
      return tr("The retried task failed: {error}", { error: scrubServerPaths(job.error ?? "") });
    case "waiting_approval":
      return `${tr("The retried task is waiting for your approval.")} ${inApp(tr)}`;
    case "waiting_takeover":
      return `${tr("The retried task needs your help on the computer.")} ${inApp(tr)}`;
    case "uncertain":
      return tr("The retried task stopped unexpectedly. Check it with /tasks list.");
    case "cancelled":
      return tr("The retried task was cancelled.");
    default:
      return "";
  }
}

async function reportRetry(interaction: ComponentInteraction, { link, tr }: FeatureContext, jobId: string, finished: Promise<unknown>) {
  try {
    await finished;
    const [job, store, prefs] = await Promise.all([getJob(link.userId, jobId), readStore(link.userId), getDiscordPrefs(link.userId)]);
    if (!job) return;
    // The run can take minutes; if the account was unlinked or relinked meanwhile, say nothing.
    if ((await getDiscordLinkByUser(link.userId))?.discordUserId !== interaction.user.id) return;
    // The notification push already DMs background results; only a cancelled run leaves no notification.
    if (isBackgroundJobKind(job.kind) && prefs.notify && job.status !== "cancelled") return;
    const text = retryOutcome(job, store, tr);
    for (const chunk of splitForDiscord(text)) await interaction.user.send({ content: chunk, allowedMentions: { parse: [] } });
  } catch (error) {
    reportError(error, "discord retry report");
  }
}

async function retry(interaction: ComponentInteraction, ctx: FeatureContext, jobId: string, reviewed: boolean) {
  const { link, tr } = ctx;
  const retried = await retryAndRunJob(link.userId, jobId, { reviewed });
  if (!retried.ok) {
    await updateMessage(interaction, retried.reason === "not_found" ? tr("That task was not found.") : tr("This task cannot be retried. Only failed tasks with attempts left can run again."));
    return;
  }
  const store = await readStore(link.userId);
  await updateMessage(interaction, tr("Retrying the task for {name}. You will hear here when it ends.", { name: escapeMarkdown(teammateName(store, retried.job.botId, tr)) }));
  void reportRetry(interaction, ctx, jobId, retried.finished);
}

async function onButton(interaction: ComponentInteraction, ctx: FeatureContext, action: string, id: string) {
  const { link, tr } = ctx;
  if (action === "stopall") {
    await updateMessage(interaction, await stopConversation(link.userId, id, link.locale, tr));
    return;
  }
  if (action === "stopok") {
    const job = await cancelAndReleaseJob(link.userId, id, link.locale);
    const store = await readStore(link.userId);
    await updateMessage(
      interaction,
      job ? tr("Stopped the task for {name}.", { name: escapeMarkdown(teammateName(store, job.botId, tr)) }) : tr("That task is no longer running, so there is nothing to stop."),
    );
    return;
  }
  if (action === "retryok") {
    await retry(interaction, ctx, id, true);
    return;
  }
  // The id came from a button, so it is looked up in this account's own jobs before anything else.
  const [job, store] = await Promise.all([getJob(link.userId, id), readStore(link.userId)]);
  if (!job) {
    await updateMessage(interaction, tr("That task was not found."));
    return;
  }
  const line = jobLine(job, store, tr);
  if (action === "stop") {
    if (!STOPPABLE.has(job.status)) {
      await updateMessage(interaction, `${tr("That task is no longer running, so there is nothing to stop.")}\n${line}`);
      return;
    }
    await updateMessage(interaction, `${tr("Stop this task? It ends now and cannot be resumed.")}\n${line}`, [confirmRow(PREFIX, ["stopok", job.id], tr, tr("Stop task"))]);
    return;
  }
  if (action === "retry") {
    if (!canRetry(job)) {
      await updateMessage(interaction, `${tr("This task cannot be retried. Only failed tasks with attempts left can run again.")}\n${line}`);
      return;
    }
    if (job.status === "uncertain") {
      // The worker died mid-run, so some of the work may already have happened.
      await updateMessage(
        interaction,
        `${tr("This task stopped unexpectedly and may have already done part of its work, such as sending a message or changing files. Check the conversation in the app before running it again.")}\n${line}`,
        [confirmRow(PREFIX, ["retryok", job.id], tr, tr("Retry anyway"))],
      );
      return;
    }
    await retry(interaction, ctx, job.id, false);
  }
}

export const feature: DiscordFeature = {
  prefix: PREFIX,
  commands: [
    dmCommand("tasks", "See and control your teammates' tasks", "チームメイトのタスクを確認・操作")
      .addSubcommand((sub) =>
        sub.setName("list").setDescription("Tasks in progress and the latest ones, with Stop and Retry").setDescriptionLocalization("ja", "進行中と最近のタスク（停止・再試行つき）"),
      )
      .addSubcommand((sub) =>
        sub.setName("stop").setDescription("Stop the task in the conversation you are in").setDescriptionLocalization("ja", "今の会話のタスクを停止"),
      ),
  ],
  async command(interaction, ctx) {
    if (interaction.options.getSubcommand() === "stop") await askStopConversation(interaction, ctx);
    else await respond(interaction, await taskList(ctx.link.userId, ctx.tr));
  },
  async component(interaction, ctx, args) {
    const [action = "", id = ""] = args;
    if (!interaction.isButton() || !id || !["stop", "stopok", "stopall", "retry", "retryok"].includes(action)) return;
    // Stopping or queueing a task reads and writes the database, which can take longer than Discord's 3 seconds.
    await interaction.deferUpdate();
    await onButton(interaction, ctx, action, id);
  },
};

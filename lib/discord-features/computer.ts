import "server-only";

import { scrubServerPaths } from "../discord-text";
import { AttachmentBuilder, type ChatInputCommandInteraction, escapeMarkdown, time } from "discord.js";
import {
  billLiveBrowser,
  getScreenshot,
  lastComputer,
  releaseBrowser,
  screenshot,
  stopSandbox,
  withBrowserLive,
} from "../computer";
import {
  type ComponentInteraction,
  confirmRow,
  type DiscordFeature,
  dmCommand,
  type FeatureContext,
  inApp,
  respond,
  type Translate,
  truncate,
  updateMessage,
} from "../discord-ui";
import { billLiveSandbox } from "../sandbox";
import { readStore } from "../store";
import type { ComputerState, Store } from "../types";

/**
 * The account-level computer, as the web panel shows it when no task is selected. Discord has no
 * selected task, so release and stop use the account default (no job id), as the web does. Reading
 * the screen prefers the task that owns the account indicator, whose page the URL and title describe.
 */

const PREFIX = "pc";
const CAPTURE_TIMEOUT_MS = 10_000;
const ACTIVITY_SHOWN = 3;

async function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Screen capture timed out")), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function currentComputer(userId: string) {
  const store = await readStore(userId);
  return { store, computer: withBrowserLive(userId, lastComputer(userId) ?? store.computer) };
}

function busy(computer: ComputerState) {
  return computer.status === "working" || computer.status === "takeover";
}

function teammateName(store: Store, botId: string | null | undefined) {
  return botId ? store.bots.find((bot) => bot.id === botId)?.name : undefined;
}

function statusLabel(computer: ComputerState, tr: Translate) {
  if (computer.status === "working") return computer.workingLabel || tr("Working");
  if (computer.status === "takeover") return tr("Your help is needed");
  if (computer.status === "error") return tr("Error");
  return tr("Idle");
}

/** URLs in angle brackets so Discord does not unfurl a preview of whatever page is open. */
function pageLine(computer: ComputerState, tr: Translate) {
  if (!computer.url) return "";
  const title = computer.title ? `${escapeMarkdown(truncate(computer.title, 200))} ` : "";
  return tr("Page: {page}", { page: `${title}<${truncate(computer.url, 500)}>` });
}

/** The latest screen: the task that owns the indicator first, then the account's own page. */
async function latestScreen(userId: string, computer: ComputerState) {
  const jobImage = computer.activeJobId ? await getScreenshot(userId, computer.activeJobId) : null;
  return jobImage ?? (await getScreenshot(userId));
}

/** Capture now: the owning task's page when it has one, otherwise the account's own page. */
async function captureLatest(userId: string, jobId?: string) {
  const capture = (scope?: string) => withTimeout(screenshot(userId, scope), CAPTURE_TIMEOUT_MS).catch(() => null);
  if (jobId && (await capture(jobId))) return getScreenshot(userId, jobId);
  return (await capture()) ? getScreenshot(userId) : null;
}

function screenFile(image: Buffer) {
  return new AttachmentBuilder(image, { name: "screen.png" });
}

async function showStatus(interaction: ChatInputCommandInteraction, { link, tr }: FeatureContext) {
  // Bill running time first, as the web panel does on every refresh.
  await billLiveBrowser(link.userId).catch(() => undefined);
  await billLiveSandbox(link.userId).catch(() => undefined);
  const { store, computer } = await currentComputer(link.userId);
  const teammate = teammateName(store, computer.workingBotId);
  // A released browser clears screenshotAt, so an old image of a closed page is not shown.
  const image = computer.screenshotAt ? await latestScreen(link.userId, computer) : null;
  const lines = [
    tr("Status: {status}", { status: escapeMarkdown(truncate(statusLabel(computer, tr), 200)) }),
    teammate && busy(computer) ? tr("Teammate: {name}", { name: escapeMarkdown(teammate) }) : "",
    pageLine(computer, tr),
    image && computer.screenshotAt ? tr("Screen captured {time}.", { time: time(new Date(computer.screenshotAt), "R") }) : "",
    tr("Browser: {state}", { state: computer.browserLive ? tr("running") : tr("not running") }),
    tr("Sandbox: {state}", { state: computer.sandboxLive ? tr("running") : tr("not running") }),
    computer.lastError ? tr("Last error: {error}", { error: escapeMarkdown(truncate(scrubServerPaths(computer.lastError), 300)) }) : "",
    computer.status === "takeover" ? tr("Your teammate is waiting for you in the browser. Run /computer takeover.") : "",
  ].filter(Boolean);
  const activity = (computer.activity ?? []).slice(0, ACTIVITY_SHOWN);
  if (activity.length) {
    lines.push(
      `\n**${tr("Recent activity")}**`,
      ...activity.map((item) => `• ${time(new Date(item.at), "R")} ${escapeMarkdown(truncate(item.title, 150))}`),
    );
  }
  await respond(interaction, { content: lines.join("\n"), files: image ? [screenFile(image)] : [] });
}

async function captureScreen(interaction: ChatInputCommandInteraction, { link, tr }: FeatureContext) {
  const { computer } = await currentComputer(link.userId);
  if (!computer.browserLive) {
    await respond(interaction, tr("The browser is not running. It starts when a teammate needs it."));
    return;
  }
  const image = await captureLatest(link.userId, computer.activeJobId ?? undefined);
  const after = (await currentComputer(link.userId)).computer;
  if (!image) {
    const reason = after.lastError ? `\n${tr("Last error: {error}", { error: escapeMarkdown(truncate(scrubServerPaths(after.lastError), 300)) })}` : "";
    await respond(interaction, `${tr("Could not capture the screen.")}${reason}`);
    return;
  }
  await respond(interaction, { content: pageLine(after, tr) || tr("The screen right now."), files: [screenFile(image)] });
}

async function release(userId: string, tr: Translate) {
  const before = (await currentComputer(userId)).computer;
  if (!before.browserLive) return tr("The browser is not running.");
  await releaseBrowser(userId);
  const after = (await currentComputer(userId)).computer;
  // A task's own page is not the account's, as on the web; /computer stop closes those too.
  return after.browserLive
    ? tr("Closed the browser. A teammate's task still has its own page open; /computer stop closes everything.")
    : tr("Closed the browser.");
}

async function stop(userId: string, tr: Translate) {
  const result = await stopSandbox(userId);
  if (!result.stopped) return tr("The computer was already stopped.");
  return [
    tr("Stopped the computer."),
    result.browserClosed ? tr("The browser is closed.") : "",
    result.sandboxStopped ? tr("The sandbox is paused. Files in the workspace are kept.") : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Closing the browser or stopping the computer mid-task interrupts a teammate, so ask first. */
async function confirmOrRun(
  interaction: ChatInputCommandInteraction,
  { link, tr }: FeatureContext,
  action: "release" | "stop",
) {
  const { store, computer } = await currentComputer(link.userId);
  if (busy(computer)) {
    const name = teammateName(store, computer.workingBotId);
    const question =
      action === "release"
        ? tr("{name} is using the computer. Close the browser anyway?", { name: name ? escapeMarkdown(name) : tr("A teammate") })
        : tr("{name} is using the computer. Stop it anyway?", { name: name ? escapeMarkdown(name) : tr("A teammate") });
    const label = action === "release" ? tr("Close the browser") : tr("Stop the computer");
    await respond(interaction, { content: question, components: [confirmRow(PREFIX, [action], tr, label)] });
    return;
  }
  await respond(interaction, action === "release" ? await release(link.userId, tr) : await stop(link.userId, tr));
}

async function explainTakeover(interaction: ChatInputCommandInteraction, { link, tr }: FeatureContext) {
  const { store, computer } = await currentComputer(link.userId);
  const name = teammateName(store, computer.workingBotId);
  const lines = [
    computer.status === "takeover"
      ? tr("{name} is waiting for you to finish a step in the browser.", { name: name ? escapeMarkdown(name) : tr("Your teammate") })
      : "",
    tr("Taking control of the browser needs the app, where you can click and type on the live screen."),
    inApp(tr),
    tr("When you are done, send a message here and your teammate continues."),
  ].filter(Boolean);
  await respond(interaction, lines.join("\n"));
}

export const feature: DiscordFeature = {
  prefix: PREFIX,
  commands: [
    dmCommand("computer", "See and control your teammates' computer", "チームメイトのコンピューターを確認・操作")
      .addSubcommand((sub) =>
        sub.setName("status").setDescription("What the computer is doing, with the latest screen").setDescriptionLocalization("ja", "コンピューターの状態と最新の画面"),
      )
      .addSubcommand((sub) =>
        sub.setName("screenshot").setDescription("Capture the browser screen now").setDescriptionLocalization("ja", "ブラウザの画面を今すぐ撮影"),
      )
      .addSubcommand((sub) =>
        sub.setName("release").setDescription("Close the browser").setDescriptionLocalization("ja", "ブラウザを閉じる"),
      )
      .addSubcommand((sub) =>
        sub.setName("stop").setDescription("Close the browser and pause the sandbox").setDescriptionLocalization("ja", "ブラウザを閉じてサンドボックスを一時停止"),
      )
      .addSubcommand((sub) =>
        sub.setName("takeover").setDescription("Take control of the browser yourself").setDescriptionLocalization("ja", "自分でブラウザを操作する"),
      ),
  ],
  async command(interaction, ctx) {
    const sub = interaction.options.getSubcommand();
    if (sub === "status") await showStatus(interaction, ctx);
    else if (sub === "screenshot") await captureScreen(interaction, ctx);
    else if (sub === "release" || sub === "stop") await confirmOrRun(interaction, ctx, sub);
    else if (sub === "takeover") await explainTakeover(interaction, ctx);
  },
  async component(interaction: ComponentInteraction, { link, tr }, args) {
    if (!interaction.isButton() || (args[0] !== "release" && args[0] !== "stop")) return;
    // Closing a browser can take longer than Discord's 3 seconds.
    await interaction.deferUpdate();
    await updateMessage(interaction, args[0] === "release" ? await release(link.userId, tr) : await stop(link.userId, tr));
  },
};

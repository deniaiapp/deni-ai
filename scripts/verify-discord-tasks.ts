import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChatInputCommandInteraction } from "discord.js";
import { mockModules } from "./module-mocks";

mockModules((request) => {
  if (request === "server-only") return {};
  return undefined;
});

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean | Promise<boolean>, what: string, timeoutMs = 5_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${what}`);
}

type Payload = { content?: string; components?: { toJSON(): { components: { custom_id?: string; label?: string }[] } }[] };

function buttonsOf(payload: Payload | undefined) {
  return (payload?.components ?? []).flatMap((row) => row.toJSON().components).map((item) => ({ id: item.custom_id ?? "", label: item.label ?? "" }));
}

/** Enough of a slash command interaction for respond(): already deferred, like the router leaves it. */
function fakeCommand(commandName: string, subcommand?: string) {
  const replies: Payload[] = [];
  const interaction = {
    commandName,
    deferred: true,
    replied: false,
    options: { getSubcommand: () => subcommand ?? "" },
    async editReply(payload: Payload) {
      replies.push(payload);
    },
    async reply(payload: Payload) {
      replies.push(payload);
    },
    async followUp(payload: Payload) {
      replies.push(payload);
    },
  };
  return { interaction: interaction as unknown as ChatInputCommandInteraction, replies };
}

/** A button press: the handler must acknowledge it, then edits the message it sits on. */
function fakeButton(messageContent = "", discordUserId = "d1") {
  const edits: Payload[] = [];
  const dms: string[] = [];
  const state = { deferred: false, replied: false };
  const interaction = {
    get deferred() {
      return state.deferred;
    },
    get replied() {
      return state.replied;
    },
    message: { content: messageContent },
    isButton: () => true,
    async deferUpdate() {
      state.deferred = true;
    },
    async update(payload: Payload) {
      state.replied = true;
      edits.push(payload);
    },
    async editReply(payload: Payload) {
      if (!state.deferred && !state.replied) throw new Error("edited before acknowledging");
      edits.push(payload);
    },
    user: {
      id: discordUserId,
      async send(payload: string | { content: string }) {
        dms.push(typeof payload === "string" ? payload : payload.content);
      },
    },
  };
  return { interaction, edits, dms, state };
}

let tempDir = "";

// Tasks and notifications from Discord: a handler only ever touches its own account's jobs,
// stopping asks first, retrying follows retryJob's rules, and only background work is pushed.
async function main() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "deni-discord-tasks-"));
  delete process.env.D1_PROXY_URL;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.ERROR_WEBHOOK_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;
  process.env.LOCAL_DB_PATH = path.join(tempDir, "test.sqlite");
  process.env.APP_ENCRYPTION_KEY ||= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  process.env.BETTER_AUTH_URL = "https://app.example.test/";

  // Discord's REST API is stubbed; nothing in this script may reach the network.
  const discordCalls: { url: string; auth: string; body: Record<string, unknown> }[] = [];
  let discordStatus = 200;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://discord.com/")) throw new Error(`unexpected request: ${url}`);
    const headers = new Headers(init?.headers);
    discordCalls.push({ url, auth: headers.get("authorization") ?? "", body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    if (discordStatus !== 200) return new Response("{}", { status: discordStatus });
    return Response.json(url.endsWith("/users/@me/channels") ? { id: "dmchan1" } : { id: "msg1" });
  }) as typeof fetch;

  const { db } = await import("../db");
  const { user, discordLinks, agentJobs } = await import("../db/schema");
  const { eq } = await import("drizzle-orm");
  const jobs = await import("../lib/jobs");
  const actions = await import("../lib/job-actions");
  const push = await import("../lib/discord-push");
  const notifications = await import("../lib/notifications");
  const store = await import("../lib/store");
  const link = await import("../lib/discord-link");
  const { setComputer } = await import("../lib/computer");
  const { discordTranslator: translatorFor } = await import("../lib/discord-i18n");
  const { parseCustomId } = await import("../lib/discord-ui");
  const tasks = await import("../lib/discord-features/tasks");
  const notify = await import("../lib/discord-features/notify");

  for (const id of ["u1", "u2", "u3"]) {
    await db.insert(user).values({ id, name: id, email: `${id}@example.com`, emailVerified: true });
    await store.readStore(id);
  }
  await db.insert(discordLinks).values({ userId: "u1", discordUserId: "d1", discordUsername: "alice", locale: "en", botId: "ops" });
  const linkOf = async (userId: string) => {
    const found = await link.getDiscordLinkByUser(userId);
    if (!found) throw new Error(`no link for ${userId}`);
    return found;
  };
  const ctx = { link: await linkOf("u1"), tr: translatorFor("en") };

  let keys = 0;
  const seed = async (userId: string, options: { status: string; kind?: string; threadId?: string; botId?: string; attempt?: number; error?: string }) => {
    const job = await jobs.createJob({
      userId,
      threadId: options.threadId ?? "dm_ops",
      botId: options.botId ?? "ops",
      kind: (options.kind ?? "chat") as "chat",
      payload: {},
      idempotencyKey: `seed-${keys++}`,
    });
    await db
      .update(agentJobs)
      .set({ status: options.status, attempt: options.attempt ?? 1, error: options.error ?? null, finishedAt: ["completed", "failed", "cancelled"].includes(options.status) ? new Date() : null })
      .where(eq(agentJobs.id, job.id));
    return job.id;
  };
  const statusOf = async (userId: string, id: string) => (await jobs.getJob(userId, id))?.status;

  // cancelAndReleaseJob: owner only, once, and a parked job's workspace is released.
  const queued = await seed("u1", { status: "queued" });
  assert((await actions.cancelAndReleaseJob("u2", queued)) === null && (await statusOf("u1", queued)) === "queued", "another user cancelled the job");
  assert((await actions.cancelAndReleaseJob("u1", queued))?.status === "cancelled", "owner could not cancel");
  assert((await actions.cancelAndReleaseJob("u1", queued)) === null, "a cancelled job was cancelled again");
  const parked = await seed("u1", { status: "waiting_takeover" });
  await setComputer("u1", { status: "takeover", jobId: parked, workingLabel: "Waiting for your help" });
  assert((await actions.cancelAndReleaseJob("u1", parked))?.status === "cancelled", "parked job not cancelled");
  assert((await store.readStore("u1")).computer.workspaces?.[parked]?.status === "idle", "parked job's computer was not idled");

  // retryAndRunJob: retryJob's rules, then a background run (no model key, so it fails cleanly again).
  assert((await actions.retryAndRunJob("u1", "job_missing")).ok === false, "missing job retried");
  const failed = await seed("u1", { status: "failed", error: "boom" });
  const foreign = await actions.retryAndRunJob("u2", failed);
  assert(!foreign.ok && foreign.reason === "not_found" && (await statusOf("u1", failed)) === "failed", "another user retried the job");
  const retried = await actions.retryAndRunJob("u1", failed);
  assert(retried.ok && retried.job.status === "queued", "failed job not queued");
  if (retried.ok) await retried.finished;
  const rerun = await jobs.getJob("u1", failed);
  assert(rerun?.status === "failed" && rerun.attempt === 2 && /OPENROUTER_API_KEY/.test(rerun.error ?? ""), `retry did not run: ${rerun?.status} ${rerun?.attempt} ${rerun?.error}`);
  const uncertain = await seed("u1", { status: "uncertain" });
  const unreviewed = await actions.retryAndRunJob("u1", uncertain);
  assert(!unreviewed.ok && unreviewed.reason === "not_retryable" && (await statusOf("u1", uncertain)) === "uncertain", "uncertain job retried without review");
  const exhausted = await seed("u1", { status: "failed", attempt: 3 });
  assert(!(await actions.retryAndRunJob("u1", exhausted)).ok, "job retried past its attempts");
  assert(tasks.canRetry({ status: "failed", attempt: 1, maxAttempts: 3 }) && !tasks.canRetry({ status: "failed", attempt: 3, maxAttempts: 3 }) && !tasks.canRetry({ status: "completed", attempt: 1, maxAttempts: 3 }), "canRetry");

  // Push format: bold title, body, app link, never over Discord's 2,000 characters.
  const formatted = push.formatDiscordNotification({ title: "Ops finished a task", body: "x".repeat(5_000) }, translatorFor("en"));
  assert(formatted.length <= 2_000 && formatted.startsWith("**Ops finished a task**\n") && formatted.endsWith("Open the app: https://app.example.test"), `format: ${formatted.slice(0, 60)}…${formatted.slice(-60)}`);
  assert(!push.formatDiscordNotification({ title: "t", body: "b" }, translatorFor("en"), "").includes("Open the app"), "link shown without an app address");
  assert(push.formatDiscordNotification({ title: "t", body: "b" }, translatorFor("ja")).includes("アプリで開いてください"), "push footer not translated");

  // Push rules: only background work, only a linked account that has not turned it off.
  const routine = await seed("u1", { status: "completed", kind: "routine" });
  const handoff = await seed("u1", { status: "completed", kind: "handoff" });
  const chat = await seed("u1", { status: "completed", kind: "chat" });
  const othersRoutine = await seed("u2", { status: "completed", kind: "routine" });
  const note = (jobId: string | null) => ({ jobId, title: "Ops finished a task", body: "Here is the report." });
  delete process.env.DISCORD_BOT_TOKEN;
  assert(!(await push.pushNotificationToDiscord("u1", note(routine))) && discordCalls.length === 0, "pushed without a bot token");
  process.env.DISCORD_BOT_TOKEN = "test-token";
  assert(await push.pushNotificationToDiscord("u1", note(routine)), "routine result not pushed");
  assert(discordCalls.length === 2 && discordCalls[0].url.endsWith("/users/@me/channels") && discordCalls[0].body.recipient_id === "d1", "DM channel not opened for the linked account");
  assert(discordCalls.every((call) => call.auth === "Bot test-token"), "bot token not sent");
  assert(discordCalls[1].url.endsWith("/channels/dmchan1/messages") && String(discordCalls[1].body.content).startsWith("**Ops finished a task**"), "message not sent");
  assert(JSON.stringify(discordCalls[1].body.allowed_mentions) === JSON.stringify({ parse: [] }), "mentions allowed in a push");
  discordCalls.length = 0;
  assert((await push.pushNotificationToDiscord("u1", note(handoff))) && discordCalls.length === 1, "DM channel not reused for the next push");
  discordCalls.length = 0;
  assert(!(await push.pushNotificationToDiscord("u1", note(chat))), "a chat reply was pushed");
  assert(!(await push.pushNotificationToDiscord("u1", note(null))), "a notification without a job was pushed");
  assert(!(await push.pushNotificationToDiscord("u1", note(othersRoutine))), "another account's job decided the push");
  assert(!(await push.pushNotificationToDiscord("u2", note(othersRoutine))), "pushed to an account without a link");
  await link.setDiscordPrefs("u1", { notify: false });
  assert(!(await push.pushNotificationToDiscord("u1", note(routine))), "pushed with notifications off");
  await link.setDiscordPrefs("u1", { notify: true });
  assert(discordCalls.length === 0, "a refused push still called Discord");
  discordStatus = 403;
  push.resetDiscordPushForTests();
  assert(!(await push.pushNotificationToDiscord("u1", note(routine))), "a refused DM reported success");
  discordStatus = 200;
  discordCalls.length = 0;

  // createNotification pushes in the background and never waits for Discord.
  await notifications.createNotification({ userId: "u1", jobId: routine, kind: "completed", title: "Routine done", body: "All good." });
  await waitFor(() => discordCalls.some((call) => String(call.body.content ?? "").startsWith("**Routine done**")), "the routine push");
  discordCalls.length = 0;
  await notifications.createNotification({ userId: "u1", jobId: chat, kind: "completed", title: "Chat done", body: "Reply." });
  await sleep(300);
  assert(discordCalls.length === 0, "a chat notification was pushed");

  // /tasks list: active first with Stop, recent with Retry, nothing from another account.
  await db.delete(agentJobs);
  const running = await seed("u1", { status: "running", kind: "routine" });
  const waiting = await seed("u1", { status: "waiting_approval" });
  const broken = await seed("u1", { status: "failed", error: "Model refused\nthe request" });
  const unsure = await seed("u1", { status: "uncertain", error: "Worker lease expired" });
  const done = await seed("u1", { status: "completed", kind: "routine" });
  const hidden = await seed("u2", { status: "running" });
  const listed = fakeCommand("tasks", "list");
  await tasks.feature.command?.(listed.interaction, ctx);
  const list = listed.replies.at(-1);
  const content = list?.content ?? "";
  assert(content.indexOf("In progress") < content.indexOf("Recent") && content.includes("Running") && content.includes("Waiting for approval") && content.includes("Needs review"), `list: ${content}`);
  assert(content.includes("Model refused the request") && content.includes("Routine"), "list lost the error or kind");
  const buttons = buttonsOf(list);
  const ids = buttons.map((item) => item.id);
  assert(ids.includes(`tk:stop:${running}`) && ids.includes(`tk:stop:${waiting}`) && ids.includes(`tk:retry:${broken}`) && ids.includes(`tk:retry:${unsure}`), `buttons: ${ids}`);
  assert(!ids.some((id) => id.includes(done)) && !ids.some((id) => id.includes(hidden)) && !content.includes(hidden), "list showed a finished task's button or another account's task");
  assert(ids.every((id) => id.length <= 100) && buttons.length <= 25, "button limits");

  const press = async (id: string, content = "") => {
    const button = fakeButton(content);
    await tasks.feature.component?.(button.interaction as never, ctx, parseCustomId(id).args);
    assert(button.state.deferred || button.state.replied, `button ${id} was not acknowledged`);
    return button;
  };

  // Stop asks first; only Confirm cancels, and only this account's task.
  const asked = await press(`tk:stop:${running}`);
  assert(buttonsOf(asked.edits.at(-1)).some((item) => item.id === `tk:stopok:${running}`) && (await statusOf("u1", running)) === "running", "stop did not ask first");
  assert(buttonsOf(asked.edits.at(-1)).some((item) => item.id === "tk:cancel"), "stop prompt has no Cancel");
  await press(`tk:stopok:${running}`);
  assert((await statusOf("u1", running)) === "cancelled", "confirmed stop did not cancel");
  const foreignStop = await press(`tk:stopok:${hidden}`);
  assert((await statusOf("u2", hidden)) === "running" && /no longer running/.test(foreignStop.edits.at(-1)?.content ?? ""), "a button stopped another account's task");
  const foreignAsk = await press(`tk:stop:${hidden}`);
  assert(/not found/.test(foreignAsk.edits.at(-1)?.content ?? ""), "another account's task was shown");

  // Retry: a failed task runs again right away and the result is DMed; an uncertain one asks first.
  const again = await press(`tk:retry:${broken}`);
  assert(/Retrying the task for Operations/.test(again.edits.at(-1)?.content ?? ""), `retry reply: ${again.edits.at(-1)?.content}`);
  await waitFor(() => again.dms.length > 0, "the retry result");
  assert(/The retried task failed: .*OPENROUTER_API_KEY/.test(again.dms[0]), `retry result: ${again.dms[0]}`);
  const review = await press(`tk:retry:${unsure}`);
  assert(buttonsOf(review.edits.at(-1)).some((item) => item.id === `tk:retryok:${unsure}`) && (await statusOf("u1", unsure)) === "uncertain", "uncertain retry did not ask first");
  const reviewed = await press(`tk:retryok:${unsure}`);
  await waitFor(() => reviewed.dms.length > 0, "the reviewed retry result");
  assert((await jobs.getJob("u1", unsure))?.attempt === 2, "reviewed retry did not run");
  const foreignRetry = await seed("u2", { status: "failed" });
  await press(`tk:retryok:${foreignRetry}`);
  assert((await statusOf("u2", foreignRetry)) === "failed", "a button retried another account's task");

  // Retried background work is reported by the notification push, so it is not DMed twice; with
  // notifications off, or when the run was cancelled without a notification, it comes back inline.
  discordCalls.length = 0;
  const handoffRetry = await seed("u1", { status: "failed", kind: "handoff" });
  const quiet = await press(`tk:retry:${handoffRetry}`);
  await waitFor(() => discordCalls.some((call) => String(call.body.content ?? "").startsWith("**Task needs setup**")), "the pushed handoff result");
  await sleep(200);
  assert(quiet.dms.length === 0 && (await statusOf("u1", handoffRetry)) === "failed", "a pushed result was also sent inline");
  const cancelledRoutine = await press(`tk:retry:${await seed("u1", { status: "failed", kind: "routine" })}`);
  await waitFor(() => cancelledRoutine.dms.length > 0, "the cancelled routine result");
  assert(/was cancelled/.test(cancelledRoutine.dms[0]), `cancelled routine result: ${cancelledRoutine.dms[0]}`);
  await link.setDiscordPrefs("u1", { notify: false });
  discordCalls.length = 0;
  const loud = await press(`tk:retry:${await seed("u1", { status: "failed", kind: "handoff" })}`);
  await waitFor(() => loud.dms.length > 0, "the inline handoff result");
  assert(/The retried task failed/.test(loud.dms[0]) && discordCalls.length === 0, `inline handoff result: ${loud.dms[0]}`);
  await link.setDiscordPrefs("u1", { notify: true });

  // /tasks stop: the current conversation (teammate's chat, or the chosen group), confirmed first.
  await db.delete(agentJobs);
  const inChat = await seed("u1", { status: "running" });
  const inOtherChat = await seed("u1", { status: "running", threadId: "dm_research", botId: "research" });
  const othersChat = await seed("u2", { status: "running" });
  const stopCmd = fakeCommand("tasks", "stop");
  await tasks.feature.command?.(stopCmd.interaction, ctx);
  const stopPrompt = stopCmd.replies.at(-1);
  assert(/your chat with Operations/.test(stopPrompt?.content ?? "") && buttonsOf(stopPrompt).some((item) => item.id === "tk:stopall:dm_ops"), `stop prompt: ${stopPrompt?.content}`);
  assert((await statusOf("u1", inChat)) === "running", "/tasks stop cancelled before confirming");
  const stoppedAll = await press("tk:stopall:dm_ops");
  assert(/Stopped the task in your chat with Operations/.test(stoppedAll.edits.at(-1)?.content ?? ""), `stop result: ${stoppedAll.edits.at(-1)?.content}`);
  assert((await statusOf("u1", inChat)) === "cancelled" && (await statusOf("u1", inOtherChat)) === "running" && (await statusOf("u2", othersChat)) === "running", "stop reached the wrong conversation or account");
  const nothing = fakeCommand("tasks", "stop");
  await tasks.feature.command?.(nothing.interaction, ctx);
  assert(/Nothing is running/.test(nothing.replies.at(-1)?.content ?? "") && !buttonsOf(nothing.replies.at(-1)).length, "stop with nothing running asked anyway");
  assert(/no longer exists/.test((await press("tk:stopall:thr_unknown")).edits.at(-1)?.content ?? ""), "unknown conversation accepted");

  await store.mutateStore("u1", (next) => {
    next.threads.push({ id: "grp_leads", kind: "group", title: "Leads", botIds: ["chief", "research"], createdAt: "", updatedAt: "", lastPreview: "" });
  });
  await link.setDiscordPrefs("u1", { threadId: "grp_leads" });
  const inGroup = await seed("u1", { status: "waiting_takeover", threadId: "grp_leads", botId: "research" });
  const groupCmd = fakeCommand("tasks", "stop");
  await tasks.feature.command?.(groupCmd.interaction, ctx);
  assert(buttonsOf(groupCmd.replies.at(-1)).some((item) => item.id === "tk:stopall:grp_leads") && /the group Leads/.test(groupCmd.replies.at(-1)?.content ?? ""), "group not used as the target");
  await press("tk:stopall:grp_leads");
  assert((await statusOf("u1", inGroup)) === "cancelled" && (await statusOf("u1", inOtherChat)) === "running", "group stop");
  const target = tasks.conversationTarget(await store.readStore("u1"), "grp_deleted", "research");
  assert(target?.id === "dm_research", "a deleted group must fall back to the teammate's chat");
  await link.setDiscordPrefs("u1", { threadId: null });

  // /notify on, off, status.
  const say = async (subcommand: string) => {
    const call = fakeCommand("notify", subcommand);
    await notify.feature.command?.(call.interaction, ctx);
    return call.replies.at(-1)?.content ?? "";
  };
  assert(/are off/.test(await say("off")) && (await link.getDiscordPrefs("u1")).notify === false, "notify off");
  assert(/are off/.test(await say("status")), "status while off");
  const on = await say("on");
  assert(/are on/.test(on) && /routines, retried tasks, and handoffs/.test(on) && (await link.getDiscordPrefs("u1")).notify === true, "notify on");
  assert(/are on/.test(await say("status")), "status while on");

  // /inbox: this account's unread notifications only, and Mark all read leaves others alone.
  await notifications.createNotification({ userId: "u1", kind: "failed", title: "Research could not finish", body: "Rate limited.\nTry later." });
  await notifications.createNotification({ userId: "u2", kind: "info", title: "Secret for u2", body: "not yours" });
  const inboxCall = fakeCommand("inbox");
  await notify.feature.command?.(inboxCall.interaction, ctx);
  const inbox = inboxCall.replies.at(-1);
  assert((inbox?.content ?? "").includes("Research could not finish") && (inbox?.content ?? "").includes("Rate limited. Try later.") && (inbox?.content ?? "").includes("<t:"), `inbox: ${inbox?.content}`);
  assert(!(inbox?.content ?? "").includes("Secret for u2"), "inbox showed another account's notification");
  assert(buttonsOf(inbox).some((item) => item.id === "nt:readall"), "inbox has no Mark all read");
  const readAll = fakeButton(inbox?.content ?? "");
  await notify.feature.component?.(readAll.interaction as never, ctx, ["readall"]);
  assert((await notifications.listNotifications("u1", { unreadOnly: true })).length === 0, "Mark all read left unread notifications");
  assert((await notifications.listNotifications("u2", { unreadOnly: true })).length === 1, "Mark all read touched another account");
  assert(/Marked all notifications as read/.test(readAll.edits.at(-1)?.content ?? "") && (readAll.edits.at(-1)?.content ?? "").length <= 2_000, "read-all reply");
  const empty = fakeCommand("inbox");
  await notify.feature.command?.(empty.interaction, ctx);
  assert(/No unread notifications/.test(empty.replies.at(-1)?.content ?? "") && !buttonsOf(empty.replies.at(-1)).length, "empty inbox");

  // Commands are lowercase, described in Japanese too, and every string has a Japanese translation.
  for (const command of [...tasks.feature.commands, ...notify.feature.commands]) {
    const json = command.toJSON();
    const options = (json.options ?? []) as { name: string; description_localizations?: Record<string, string | null> | null }[];
    assert(/^[a-z]+$/.test(json.name) && Boolean(json.description_localizations?.ja), `command ${json.name}`);
    assert(options.every((option) => /^[a-z]+$/.test(option.name) && Boolean(option.description_localizations?.ja)), `options of ${json.name}`);
  }
  const ja = translatorFor("ja");
  for (const file of ["lib/discord-features/tasks.ts", "lib/discord-features/notify.ts"]) {
    const source = await readFile(file, "utf8");
    const used = [...source.matchAll(/\btr\(\s*"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]);
    assert(used.length > 5, `no strings found in ${file}`);
    const missing = used.filter((key) => ja(key) === key);
    assert(!missing.length, `missing Japanese in ${file}: ${missing.join(" | ")}`);
  }

  globalThis.fetch = realFetch;
  console.log("discord tasks verification passed");
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

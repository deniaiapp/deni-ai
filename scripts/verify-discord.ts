import dotenv from "dotenv";
import { mkdtemp, rm } from "node:fs/promises";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import type { UIMessage } from "ai";

dotenv.config({ path: ".env", quiet: true });
dotenv.config({ path: ".env.local", override: true, quiet: true });

type NodeLoader = (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
const moduleRuntime = Module as unknown as { _load: NodeLoader };
const originalLoad = moduleRuntime._load;
moduleRuntime._load = function load(request: string, parent: NodeModule | null, isMain: boolean) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function approvalOf(outcome: { kind: string }) {
  if (outcome.kind !== "approval") throw new Error(`expected an approval prompt, got ${JSON.stringify(outcome)}`);
  return outcome as Extract<Awaited<ReturnType<typeof import("../lib/discord-turn").runDiscordMessage>>, { kind: "approval" }>;
}

let tempDir = "";

// Linking must be single-use and expiring, only a linked Discord account may reach a
// workspace, and a button press may only answer the approval round it was issued for.
async function main() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "deni-discord-"));
  delete process.env.D1_PROXY_URL;
  process.env.LOCAL_DB_PATH = path.join(tempDir, "test.sqlite");
  process.env.APP_ENCRYPTION_KEY ||= "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  delete process.env.OPENROUTER_API_KEY;

  const { db } = await import("../db");
  const { user, discordLinkCodes, agentJobs } = await import("../db/schema");
  const { eq } = await import("drizzle-orm");
  const link = await import("../lib/discord-link");
  const turn = await import("../lib/discord-turn");
  const bot = await import("../lib/discord-bot");
  const store = await import("../lib/store");
  const jobs = await import("../lib/jobs");

  for (const id of ["u1", "u2"]) await db.insert(user).values({ id, name: id, email: `${id}@example.com`, emailVerified: true });

  // Codes: formatted, stored only as a hash, redeemable once in any case/spacing.
  const issued = await link.createDiscordLinkCode("u1", "ja");
  assert(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(issued.code), `code format: ${issued.code}`);
  const stored = await db.select().from(discordLinkCodes).where(eq(discordLinkCodes.userId, "u1"));
  assert(stored.length === 1 && !stored[0].codeHash.includes(issued.code.replace("-", "")), "code must be stored hashed");
  assert(link.looksLikeLinkCode(issued.code) && link.looksLikeLinkCode(issued.code.toLowerCase().replace("-", " ")), "link code shape");
  assert(!link.looksLikeLinkCode("hello there") && !link.looksLikeLinkCode("please run the report"), "plain text is not a code");
  assert((await link.redeemDiscordLinkCode("WRONG-CODE", { id: "d1", username: "alice" })) === null, "unknown code redeemed");
  assert((await link.redeemDiscordLinkCode(issued.code.toLowerCase().replace("-", " "), { id: "d1", username: "alice" })) === "u1", "valid code rejected");
  assert((await link.redeemDiscordLinkCode(issued.code, { id: "d2", username: "mallory" })) === null, "code redeemed twice");
  const linked = await link.getDiscordLinkByDiscordId("d1");
  assert(linked?.userId === "u1" && linked.locale === "ja" && linked.discordUsername === "alice", "link not stored");

  // A newer code replaces the previous one; an expired code is refused.
  const first = await link.createDiscordLinkCode("u2");
  const second = await link.createDiscordLinkCode("u2");
  assert((await link.redeemDiscordLinkCode(first.code, { id: "d2", username: "bob" })) === null, "superseded code still worked");
  await db.update(discordLinkCodes).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(discordLinkCodes.userId, "u2"));
  assert((await link.redeemDiscordLinkCode(second.code, { id: "d2", username: "bob" })) === null, "expired code redeemed");

  // One Discord account maps to one user: relinking moves it, and the old owner loses it.
  const third = await link.createDiscordLinkCode("u2");
  assert((await link.redeemDiscordLinkCode(third.code, { id: "d1", username: "alice" })) === "u2", "relink failed");
  assert((await link.getDiscordLinkByUser("u1")) === null, "previous owner kept the link");
  assert((await link.getDiscordLinkByDiscordId("d1"))?.userId === "u2", "link did not move");
  await link.setDiscordLinkBot("u2", "ops");
  assert((await link.getDiscordLinkByUser("u2"))?.botId === "ops", "teammate not saved");
  assert(await link.unlinkDiscord("u2"), "unlink reported nothing removed");
  assert((await link.getDiscordLinkByDiscordId("d1")) === null, "unlink left a row");

  // Discord limits: replies are split under the cap and nothing is lost.
  const long = `${"word ".repeat(700)}\n\n${"x".repeat(2_500)}`;
  const chunks = bot.splitForDiscord(long);
  assert(chunks.length > 1 && chunks.every((chunk) => chunk.length > 0 && chunk.length <= 1_900), "chunk size");
  assert(chunks.join("").replace(/\s/g, "") === long.replace(/\s/g, ""), "chunks lost text");
  assert(bot.splitForDiscord("short").join() === "short", "short text changed");

  // Button ids carry the job and round and stay under Discord's 100 character cap.
  const part = (id: string) => ({ type: "tool-runCommand", toolCallId: id, state: "approval-requested", input: { command: "ls" }, approval: { id } });
  const request = (...ids: string[]) => ({ id: "m1", role: "assistant", parts: ids.map(part) }) as unknown as UIMessage;
  const round = turn.approvalRound(request("a1"));
  assert(round === turn.approvalRound(request("a1")) && round !== turn.approvalRound(request("a2")), "round must follow the approval ids");
  assert(turn.approvalRound(request("a", "b")) === turn.approvalRound(request("b", "a")), "round must not depend on order");
  const customId = turn.discordComponentId("deny", "job_0123456789abcdef", round);
  assert(customId.length <= 100, "custom id too long");
  const parsed = turn.parseDiscordComponentId(customId);
  assert(parsed?.approved === false && parsed.jobId === "job_0123456789abcdef" && parsed.round === round, "custom id round trip");
  assert(turn.parseDiscordComponentId("other:y:job:round") === null && turn.parseDiscordComponentId("dap:x:job:round") === null, "foreign id accepted");

  // Approve/Deny only appear when the whole request is visible; a cut-off request goes to the app.
  const shown = (summary: string, truncated = false) => ({ tool: "runCommand", summary, truncated });
  const prompt = (pending: ReturnType<typeof shown>[]) =>
    bot.approvalPrompt({ kind: "approval", botName: "Ops", jobId: "job_1", round, pending, text: "Ops needs your approval before continuing." }, "en");
  const small = prompt([shown("rm -rf build")]);
  assert(small.components.length === 1 && small.content.includes("rm -rf build"), "short request lost its buttons");
  const longRequest = { id: "long", role: "assistant", parts: [{ ...part("a-long"), input: { command: "y".repeat(turn.APPROVAL_SUMMARY_LIMIT + 50) } }] } as unknown as UIMessage;
  const flagged = turn.approvalOutcome(longRequest, "job_1", { name: "Ops" }, "en");
  assert(flagged.kind === "approval" && flagged.pending[0].truncated, "long input was not flagged as truncated");
  const unflagged = turn.approvalOutcome(request("a1"), "job_1", { name: "Ops" }, "en");
  assert(unflagged.kind === "approval" && !unflagged.pending[0].truncated, "short input was flagged as truncated");

  // Approval buttons: stale rounds and non-Discord jobs never resume a job.
  const userId = "u3";
  await db.insert(user).values({ id: userId, name: "u3", email: "u3@example.com", emailVerified: true });
  const seed = async (key: string, source: string | null) => {
    const job = await jobs.createJob({ userId, threadId: "dm_ops", botId: "ops", kind: "chat", idempotencyKey: key, payload: source ? { source } : {} });
    await jobs.transitionJob(userId, job.id, "queued", { status: "waiting_approval" });
    return job.id;
  };
  await store.readStore(userId);
  await store.saveMessages(userId, "dm_ops", [request("a1")]);
  const stateOf = async (id: string) => (await jobs.getJob(userId, id))?.status;
  const decide = (jobId: string, roundId: string, approved: boolean) => turn.runDiscordApproval({ userId, jobId, round: roundId, approved, locale: "en" });

  const web = await seed("web-job", null);
  assert((await decide(web, round, true)).kind === "notice" && (await stateOf(web)) === "waiting_approval", "non-discord job was resumed");
  const discord = await seed("discord-job", "discord");
  await db.update(agentJobs).set({ payload: { source: "discord" } }).where(eq(agentJobs.id, discord));
  assert((await decide(discord, "00000000", true)).kind === "notice" && (await stateOf(discord)) === "waiting_approval", "stale round resumed the job");
  assert((await turn.runDiscordApproval({ userId: "someone-else", jobId: discord, round, approved: true, locale: "en" })).kind === "notice", "other user reached the job");
  assert((await stateOf(discord)) === "waiting_approval", "other user changed the job");

  // The matching round records the decision on the stored message, then resumes (no model key, so it fails cleanly).
  const resumed = await decide(discord, round, false);
  assert(resumed.kind === "notice" && (await stateOf(discord)) === "failed", `resume outcome: ${resumed.kind}/${await stateOf(discord)}`);
  const saved = (await store.loadMessages(userId, "dm_ops")).find((message) => message.id === "m1");
  const savedPart = saved?.parts[0] as { state?: string; approval?: { approved?: boolean; reason?: string } };
  assert(savedPart.state === "approval-responded" && savedPart.approval?.approved === false && Boolean(savedPart.approval.reason), "denial not recorded");
  assert((await decide(discord, round, true)).kind === "notice", "a decided approval was answered twice");

  // End to end with a stubbed model: reply, approval round trip, and takeover continuation.
  process.env.OPENROUTER_API_KEY = "test-key";
  const completions: ("text" | "tool")[] = [];
  const script: { text?: string; tool?: { name: string; args: unknown } }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).includes("/chat/completions")) return realFetch(input, init);
    const step = script.shift();
    if (!step) throw new Error("model called more often than scripted");
    completions.push(step.tool ? "tool" : "text");
    const chunk = (delta: object, finish: string | null) =>
      `data: ${JSON.stringify({ id: "gen-1", object: "chat.completion.chunk", created: 0, model: "stub", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    const body = step.tool
      ? chunk({ role: "assistant", content: null, tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: step.tool.name, arguments: JSON.stringify(step.tool.args) } }] }, null) + chunk({}, "tool_calls")
      : chunk({ role: "assistant", content: step.text }, null) + chunk({}, "stop");
    return new Response(`${body}data: [DONE]\n\n`, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;

  const e2e = "u4";
  await db.insert(user).values({ id: e2e, name: e2e, email: "u4@example.com", emailVerified: true });
  const say = (id: string, text: string) => turn.runDiscordMessage({ userId: e2e, discordMessageId: id, text, botId: "ops", locale: "en" });

  script.push({ text: "Hello from Ops" });
  const hello = await say("m100", "hi");
  assert(hello.kind === "reply" && hello.text === "Hello from Ops" && hello.botName === "Operations", `reply: ${JSON.stringify(hello)}`);
  const thread = await store.loadMessages(e2e, "dm_ops");
  assert(thread.length === 2 && thread[0].role === "user" && thread[1].role === "assistant", "reply not stored in the web thread");
  assert((await say("m100", "hi")).kind === "none", "a redelivered Discord message ran twice");

  script.push({ tool: { name: "runCommand", args: { command: "rm -rf build" } }, text: "unused" });
  const gated = approvalOf(await say("m101", "clean the build folder"));
  assert(gated.pending[0]?.tool === "runCommand" && gated.pending[0].summary.includes("rm -rf build"), `approval: ${JSON.stringify(gated)}`);
  const parked = (await jobs.listJobs(e2e, { threadId: "dm_ops", limit: 5 })).find((job) => job.status === "waiting_approval");
  assert(Boolean(parked) && parked?.payload.source === "discord", "job not parked for approval");
  const again = approvalOf(await say("m102", "hello?"));
  assert(again.round === gated.round && again.jobId === gated.jobId, "waiting approval should be shown again, not start a new task");
  script.length = 0;
  script.push({ text: "Understood, I will not run it." });
  const denied = await turn.runDiscordApproval({ userId: e2e, jobId: gated.jobId, round: gated.round, approved: false, locale: "en" });
  assert(denied.kind === "reply" && denied.text === "Understood, I will not run it.", `after denial: ${JSON.stringify(denied)}`);
  assert((await jobs.getJob(e2e, gated.jobId))?.status === "completed", "denied task did not finish");
  const finalThread = await store.loadMessages(e2e, "dm_ops");
  const gatedMessage = finalThread.find((message) => message.role === "assistant" && message.parts.some((part) => (part as { state?: string }).state === "output-denied" || (part as { approval?: { approved?: boolean } }).approval?.approved === false));
  assert(Boolean(gatedMessage), "the denial is missing from the stored conversation");

  // A task parked for takeover continues with the next message instead of looping on a notice.
  const waiting = await jobs.createJob({ userId: e2e, threadId: "dm_ops", botId: "ops", kind: "chat", idempotencyKey: "takeover-job", payload: { source: "discord" } });
  await jobs.transitionJob(e2e, waiting.id, "queued", { status: "waiting_takeover" });
  script.push({ text: "Thanks, continuing." });
  const resumedTakeover = await say("m103", "done, I logged in");
  assert(resumedTakeover.kind === "reply" && resumedTakeover.text === "Thanks, continuing.", `takeover: ${JSON.stringify(resumedTakeover)}`);
  assert((await jobs.getJob(e2e, waiting.id))?.status === "completed", "takeover job did not continue");
  assert(script.length === 0, "unused scripted model responses");
  globalThis.fetch = realFetch;

  console.log("discord verification passed");
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

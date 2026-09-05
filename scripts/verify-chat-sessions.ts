import {
  clearChatSessionsForTests,
  getChatSession,
  getChatSessionRunStatus,
  syncChatSessionMessages,
  updateChatSessionJobState,
} from "../lib/chat-sessions";
import type { UIMessage } from "ai";

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const encoder = new TextEncoder();

function chunk(value: unknown) {
  return `data: ${JSON.stringify(value)}\n\n`;
}

let requests = 0;
let aborts = 0;
const lifecycle: string[] = [];
let submittedMessages: UIMessage[] = [];

const originalFetch = globalThis.fetch;
globalThis.fetch = async (_input, init) => {
  requests += 1;
  submittedMessages = JSON.parse(String(init?.body)).messages;
  const signal = init?.signal;
  if (signal?.aborted) aborts += 1;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: unknown) => controller.enqueue(encoder.encode(chunk(value)));
      send({ type: "start", messageId: "assistant-a" });
      send({ type: "text-start", id: "text-a" });
      send({ type: "text-delta", id: "text-a", delta: "A first " });
      await sleep(35);
      send({ type: "text-delta", id: "text-a", delta: "chunk" });
      await sleep(35);
      send({ type: "text-end", id: "text-a" });
      lifecycle.push("model-finished");
      send({ type: "data-job-status", transient: true, data: { jobId: "job-a", status: "finalizing" } });
      lifecycle.push("saving");
      await sleep(35);
      send({ type: "data-job-status", transient: true, data: { jobId: "job-a", status: "completed" } });
      lifecycle.push("completed");
      send({ type: "finish", finishReason: "stop" });
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
};

async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await sleep(10);
  }
  throw new Error("timed out waiting for chat stream");
}

async function main() {
  const a = getChatSession({ threadId: "thread-a", botId: "bot-a", runMode: "max", initialMessages: [] });
  const sameA = getChatSession({ threadId: "thread-a", botId: "bot-a", runMode: "max", initialMessages: [] });
  if (a !== sameA) throw new Error("thread A did not retain the same Chat instance");
  const aMessages: UIMessage[] = [];
  const unsubscribe = a["~registerMessagesCallback"](() => {
    aMessages.splice(0, aMessages.length, ...a.messages);
  });
  const replyTo = { key: "id:source-message", role: "assistant", text: "Source answer" };
  const request = a.sendMessage({ text: "start", metadata: { replyTo } });
  await waitFor(() => a.messages.some((message) => message.id === "assistant-a"));
  await waitFor(() => getChatSessionRunStatus("thread-a") === "finalizing");
  if (a.status === "ready") throw new Error("finalizing status was reported as ready before terminal event");
  if (a.messages.some((message) => message.parts.some((part) => part.type === "data-job-status"))) throw new Error("transient lifecycle event leaked into chat messages");
  if (syncChatSessionMessages("thread-a", [])) throw new Error("server history overwrote live A stream");
  unsubscribe();
  const b = getChatSession({ threadId: "thread-b", botId: "bot-b", runMode: "max", initialMessages: [] });
  if (b === a) throw new Error("thread B reused thread A's Chat instance");
  await sleep(50);
  const resubscribe = a["~registerMessagesCallback"](() => {
    aMessages.splice(0, aMessages.length, ...a.messages);
  });
  await request;
  await waitFor(() => a.status === "ready");
  if (getChatSessionRunStatus("thread-a") !== "completed") throw new Error("terminal run event was not delivered");
  if (lifecycle.join(",") !== "model-finished,saving,completed") throw new Error("run phases were delivered out of order");
  updateChatSessionJobState("thread-a", false);
  if (!syncChatSessionMessages("thread-a", a.messages)) throw new Error("terminal A history did not sync");
  resubscribe();
  const assistant = a.messages.find((message) => message.id === "assistant-a");
  const text = assistant?.parts.find((part) => part.type === "text");
  if (text?.type !== "text" || text.text !== "A first chunk") throw new Error("A did not receive all stream chunks");
  if (b.messages.some((message) => message.id === "assistant-a")) throw new Error("A output leaked into B");
  if (requests !== 1) throw new Error(`expected one request, received ${requests}`);
  const submitted = submittedMessages.at(-1);
  if (JSON.stringify(submitted?.metadata) !== JSON.stringify({ replyTo })) throw new Error("Reply reference was lost in transport");
  if (submitted?.parts[0]?.type !== "text" || submitted.parts[0].text !== "start") throw new Error("Reply reference altered visible message text");
  if (aborts !== 0) throw new Error("thread switch aborted the active stream");
  if (aMessages.at(-1)?.id !== "assistant-a") throw new Error("A subscriber missed the resumed state");
  clearChatSessionsForTests();
  globalThis.fetch = originalFetch;
  console.log("verified persistent Chat instance, one request, no abort, chunk continuity, and A/B isolation");
}

main().catch((error) => {
  globalThis.fetch = originalFetch;
  clearChatSessionsForTests();
  throw error;
});

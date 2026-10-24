import { convertToModelMessages, type UIMessage } from "ai";
import {
  compactMessagesForModel,
  contextResetMessage,
  HISTORY_TOKEN_LIMIT,
  HISTORY_TOKEN_TARGET,
  isContextReset,
  modelContextMessages,
} from "../lib/messages";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const text = (message: UIMessage) => message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
const user = (id: string, body: string): UIMessage => ({ id, role: "user", parts: [{ type: "text", text: body }] });
const assistant = (id: string, body: string): UIMessage => ({ id, role: "assistant", parts: [{ type: "text", text: body }] });

/** One user/assistant turn of roughly `tokens` tokens, using ASCII so 4 characters ≈ 1 token. */
function turn(index: number, tokens: number): UIMessage[] {
  const half = "x".repeat(tokens * 2);
  return [user(`u${index}`, `question ${index} ${half}`), assistant(`a${index}`, `answer ${index} ${half}`)];
}

function conversation(turns: number, tokens: number) {
  return Array.from({ length: turns }, (_, index) => turn(index, tokens)).flat();
}

// Only messages after the latest reset reach the model; the divider itself never does.
const reset = contextResetMessage("reset_1");
assert(isContextReset(reset) && !isContextReset(user("u", "hi")), "reset marker detection");
const forged = { ...user("u-forged", "hi"), metadata: { kind: "context-reset" } } as UIMessage;
assert(!isContextReset(forged), "a user message must not act as a reset");
const afterReset = modelContextMessages([user("old", "secret plan"), assistant("old-a", "ok"), reset, user("new", "hello")]);
assert(afterReset.length === 1 && afterReset[0].id === "new", `after reset: ${afterReset.map((m) => m.id)}`);
const twoResets = modelContextMessages([user("a", "1"), reset, user("b", "2"), contextResetMessage("reset_2"), user("c", "3")]);
assert(twoResets.map((m) => m.id).join() === "c", "the latest reset wins");
assert(modelContextMessages([user("a", "1"), reset]).length === 0, "nothing after a trailing reset");
const modelInput = await convertToModelMessages(compactMessagesForModel([user("old", "secret"), reset, user("new", "hello")]));
assert(modelInput.length === 1 && modelInput[0].role === "user" && !JSON.stringify(modelInput).includes("secret"), "model input leaked pre-reset text");

// A short conversation is passed through untouched.
const short = conversation(5, 500);
assert(modelContextMessages(short).length === short.length && !text(modelContextMessages(short)[0]).startsWith("[Earlier"), "short history was trimmed");

// A long one is cut to the budget on a user message, keeps the newest turn, and says so.
// Turns are sized from the budget so the checks hold whatever the limits are set to.
const TURN = Math.ceil(HISTORY_TOKEN_LIMIT / 40);
const long = conversation(60, TURN);
const window = modelContextMessages(long);
assert(window.length < long.length, "long history was not trimmed");
assert(window[0].role === "user" && text(window[0]).startsWith("[Earlier messages"), "trimmed window must open on a user message with a note");
assert(window.at(-1)?.id === long.at(-1)?.id, "newest message dropped");
const kept = (window.length * TURN) / 2;
assert(kept <= HISTORY_TOKEN_LIMIT + TURN, `window too large: ~${kept} tokens`);
assert(kept >= HISTORY_TOKEN_TARGET - TURN, `window cut too far: ~${kept} tokens`);

// The cut stays put while the conversation grows, so the cached prefix keeps matching.
const firstKept = (messages: UIMessage[]) => modelContextMessages(messages)[0]?.id;
const turnsPerCut = Math.ceil((HISTORY_TOKEN_LIMIT - HISTORY_TOKEN_TARGET) / TURN);
let moves = 0;
let previous = firstKept(conversation(40, TURN));
for (let turns = 41; turns <= 40 + turnsPerCut * 2; turns++) {
  const next = firstKept(conversation(turns, TURN));
  if (next !== previous) moves++;
  previous = next;
}
assert(moves > 0 && moves <= 3, `cut moved ${moves} times over ${turnsPerCut * 2} turns`);

// One turn larger than the whole budget still keeps its own question.
const huge = [...conversation(3, 500), user("big", "do it"), assistant("big-a", "y".repeat(HISTORY_TOKEN_LIMIT * 8))];
const hugeWindow = modelContextMessages(huge);
assert(hugeWindow[0].id === "big" && hugeWindow.length === 2, `oversized turn: ${hugeWindow.map((m) => m.id)}`);

// Large tool output is weighed after slimming, so a few big results do not wipe the history.
const toolTurn = (index: number): UIMessage[] => [
  user(`tu${index}`, `fetch page ${index}`),
  {
    id: `ta${index}`,
    role: "assistant",
    parts: [
      { type: "tool-browser", toolCallId: `call${index}`, state: "output-available", input: { url: "https://example.com" }, output: { content: "z".repeat(200_000) } },
      { type: "text", text: "done" },
    ],
  } as unknown as UIMessage,
];
const tools = Array.from({ length: 6 }, (_, index) => toolTurn(index)).flat();
assert(modelContextMessages(tools).length === tools.length, "slimmed tool output should fit the budget");

// Saved signed thinking is dropped: Anthropic rejects it once the prefix before it changes.
const signed = { openrouter: { reasoning_details: [{ type: "reasoning.text", text: "plan", signature: "sig" }] } };
const thinkingTurn = (id: string, steps: number): UIMessage => ({
  id,
  role: "assistant",
  parts: Array.from({ length: steps }, (_, step) => [
    { type: "step-start" },
    { type: "reasoning", text: `${id} thought ${step}`, providerMetadata: signed },
    { type: "tool-browser", toolCallId: `${id}-${step}`, state: "output-available", input: {}, output: { ok: true }, callProviderMetadata: signed },
  ]).flat(),
} as unknown as UIMessage);
const olderThinking = JSON.stringify(await convertToModelMessages(compactMessagesForModel([user("q1", "hi"), thinkingTurn("old", 1), user("q2", "again")])));
assert(!olderThinking.includes("signature") && !olderThinking.includes("old thought"), "earlier thinking must not reach the model");
const resumed = JSON.stringify(await convertToModelMessages(compactMessagesForModel([user("q1", "hi"), thinkingTurn("old", 1), user("q2", "go"), thinkingTurn("now", 2)])));
assert(resumed.includes("now thought 0") && resumed.includes("now thought 1") && !resumed.includes("old thought"), "a resumed turn keeps all its thinking, earlier turns none");

console.log("context window verification passed");

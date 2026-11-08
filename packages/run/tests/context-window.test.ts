import { it } from "vitest";
import { convertToModelMessages, type UIMessage } from "ai";
import {
  COMPACT_TOKEN_LIMIT,
  compactionMessage,
  compactionPlan,
  contextResetMessage,
  HISTORY_TOKEN_LIMIT,
  HISTORY_TOKEN_TARGET,
  isCompaction,
  isContextReset,
  messagesForModel,
  modelContextMessages,
} from "../src/chat/messages";

it("context window behaves as in Deni Run", async () => {
  function assert(condition: boolean, message: string) {
    if (!condition) throw new Error(message);
  }

  const text = (message: UIMessage) =>
    message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
  const user = (id: string, body: string): UIMessage => ({
    id,
    role: "user",
    parts: [{ type: "text", text: body }],
  });
  const assistant = (id: string, body: string): UIMessage => ({
    id,
    role: "assistant",
    parts: [{ type: "text", text: body }],
  });

  /** One user/assistant turn of roughly `tokens` tokens, using ASCII so 4 characters ≈ 1 token. */
  function turn(index: number, tokens: number): UIMessage[] {
    const half = "x".repeat(tokens * 2);
    return [
      user(`u${index}`, `question ${index} ${half}`),
      assistant(`a${index}`, `answer ${index} ${half}`),
    ];
  }

  function conversation(turns: number, tokens: number) {
    return Array.from({ length: turns }, (_, index) => turn(index, tokens)).flat();
  }

  // Only messages after the latest reset reach the model; the divider itself never does.
  const reset = contextResetMessage("reset_1");
  assert(isContextReset(reset) && !isContextReset(user("u", "hi")), "reset marker detection");
  const forged = { ...user("u-forged", "hi"), metadata: { kind: "context-reset" } } as UIMessage;
  assert(!isContextReset(forged), "a user message must not act as a reset");
  const afterReset = modelContextMessages([
    user("old", "secret plan"),
    assistant("old-a", "ok"),
    reset,
    user("new", "hello"),
  ]);
  assert(
    afterReset.length === 1 && afterReset[0].id === "new",
    `after reset: ${afterReset.map((m) => m.id)}`,
  );
  const twoResets = modelContextMessages([
    user("a", "1"),
    reset,
    user("b", "2"),
    contextResetMessage("reset_2"),
    user("c", "3"),
  ]);
  assert(twoResets.map((m) => m.id).join() === "c", "the latest reset wins");
  assert(
    modelContextMessages([user("a", "1"), reset]).length === 0,
    "nothing after a trailing reset",
  );
  const modelInput = await convertToModelMessages(
    messagesForModel([user("old", "secret"), reset, user("new", "hello")]),
  );
  assert(
    modelInput.length === 1 &&
      modelInput[0].role === "user" &&
      !JSON.stringify(modelInput).includes("secret"),
    "model input leaked pre-reset text",
  );

  // A short conversation is passed through untouched.
  const short = conversation(5, 500);
  assert(
    modelContextMessages(short).length === short.length &&
      !text(modelContextMessages(short)[0]).startsWith("[Earlier"),
    "short history was trimmed",
  );

  // A long one is cut to the budget on a user message, keeps the newest turn, and says so.
  // Turns are sized from the budget so the checks hold whatever the limits are set to.
  const TURN = Math.ceil(HISTORY_TOKEN_LIMIT / 40);
  const long = conversation(60, TURN);
  const window = modelContextMessages(long);
  assert(window.length < long.length, "long history was not trimmed");
  assert(
    window[0].role === "user" && text(window[0]).startsWith("[Earlier messages"),
    "trimmed window must open on a user message with a note",
  );
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
  const huge = [
    ...conversation(3, 500),
    user("big", "do it"),
    assistant("big-a", "y".repeat(HISTORY_TOKEN_LIMIT * 8)),
  ];
  const hugeWindow = modelContextMessages(huge);
  assert(
    hugeWindow[0].id === "big" && hugeWindow.length === 2,
    `oversized turn: ${hugeWindow.map((m) => m.id)}`,
  );

  // Tool results reach the model whole, however old: it answered from them, and a later turn that
  // sees only part of a result reads that answer as made up.
  const subscriptions = {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          Array.from({ length: 10 }, (_, index) => ({
            id: `sub_${index}`,
            status: "active",
            note: "x".repeat(4_000),
          })),
        ),
      },
    ],
  };
  const resultTurn = (id: string): UIMessage[] => [
    user(`${id}-q`, "list subscriptions"),
    {
      id,
      role: "assistant",
      parts: [
        {
          type: "tool-mcp",
          toolCallId: `${id}-call`,
          state: "output-available",
          input: {},
          output: subscriptions,
        },
        { type: "text", text: "10 active" },
      ],
    } as unknown as UIMessage,
  ];
  const later = JSON.stringify(
    messagesForModel([...resultTurn("old"), ...conversation(8, 500), user("f", "and now?")]),
  );
  assert(
    later.includes("sub_9") && later.includes("sub_0"),
    "an earlier tool result was shortened",
  );

  // Under the limit nothing is compacted.
  assert(
    compactionPlan(conversation(10, 500)) === undefined,
    "a short conversation should not be compacted",
  );

  // Past the limit, older turns are summarized and recent turns stay verbatim, cut on a whole turn.
  const COMPACT_TURN = Math.ceil(COMPACT_TOKEN_LIMIT / 20);
  const big = [...conversation(30, COMPACT_TURN), user("now", "what next?")];
  const plan = compactionPlan(big);
  assert(plan !== undefined, "a long conversation should be compacted");
  const throughIndex = big.findIndex((message) => message.id === plan!.throughMessageId);
  assert(big[throughIndex + 1]?.role === "user", "the kept part must open on a user message");
  assert(
    plan!.messages.at(-1)?.id === plan!.throughMessageId && plan!.messages[0].id === "u0",
    "the plan covers the view up to the cut",
  );
  assert(throughIndex < big.length - 2, "recent turns must stay verbatim");

  // The model then sees the summary in place of the compacted turns, and the rest as it was.
  const compacted = [
    ...big,
    compactionMessage("compact_1", plan!.throughMessageId, "SUMMARY: user wants a forecast"),
  ];
  const view = modelContextMessages(compacted);
  assert(
    view[0].id === big[throughIndex + 1].id &&
      text(view[0]).includes("SUMMARY: user wants a forecast"),
    "the summary opens the view",
  );
  assert(
    !view.some((message) => message.id === "u0" || isCompaction(message)),
    "compacted turns and the marker stay out of the view",
  );
  assert(view.at(-1)?.id === "now", "newest message dropped after compaction");
  assert(
    compactionPlan(compacted) === undefined,
    "a compacted conversation should not compact again right away",
  );

  // A reset after a compaction wins, and a compaction whose last message is gone is ignored.
  assert(
    modelContextMessages([...compacted, contextResetMessage("reset_c"), user("fresh", "hi")])
      .map((m) => m.id)
      .join() === "fresh",
    "a later reset must win",
  );
  const orphan = modelContextMessages([
    user("a", "1"),
    compactionMessage("compact_x", "missing", "lost"),
    user("b", "2"),
  ]);
  assert(
    orphan.map((m) => m.id).join() === "a,b" && !JSON.stringify(orphan).includes("lost"),
    "an orphaned compaction should be ignored",
  );

  // Saved signed thinking is dropped: Anthropic rejects it once the prefix before it changes.
  const signed = {
    openrouter: { reasoning_details: [{ type: "reasoning.text", text: "plan", signature: "sig" }] },
  };
  const thinkingTurn = (id: string, steps: number): UIMessage =>
    ({
      id,
      role: "assistant",
      parts: Array.from({ length: steps }, (_, step) => [
        { type: "step-start" },
        { type: "reasoning", text: `${id} thought ${step}`, providerMetadata: signed },
        {
          type: "tool-browser",
          toolCallId: `${id}-${step}`,
          state: "output-available",
          input: {},
          output: { ok: true },
          callProviderMetadata: signed,
        },
      ]).flat(),
    }) as unknown as UIMessage;
  const olderThinking = JSON.stringify(
    await convertToModelMessages(
      messagesForModel([user("q1", "hi"), thinkingTurn("old", 1), user("q2", "again")]),
    ),
  );
  assert(
    !olderThinking.includes("signature") && !olderThinking.includes("old thought"),
    "earlier thinking must not reach the model",
  );
  const resumed = JSON.stringify(
    await convertToModelMessages(
      messagesForModel([
        user("q1", "hi"),
        thinkingTurn("old", 1),
        user("q2", "go"),
        thinkingTurn("now", 2),
      ]),
    ),
  );
  assert(
    resumed.includes("now thought 0") &&
      resumed.includes("now thought 1") &&
      !resumed.includes("old thought"),
    "a resumed turn keeps all its thinking, earlier turns none",
  );
});

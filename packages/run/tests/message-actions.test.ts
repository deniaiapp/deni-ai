import { it } from "vitest";
import assert from "node:assert/strict";
import {
  isMessageReaction,
  messageActionKey,
  messageBody,
  messageReference,
  messagesWithReplyContext,
  resolveReplyReferences,
  updateReactions,
} from "../src/chat/message-actions";
import { createReactionState, type ReactionMap } from "../src/chat/reaction-state";
import type { UIMessage } from "ai";

it("message actions behaves as in Deni Run", async () => {
  const text = messageBody({
    id: "m1",
    role: "assistant",
    parts: [
      { type: "reasoning", text: "Private reasoning" },
      { type: "text", text: "First paragraph" },
      { type: "text", text: "Second paragraph" },
    ],
  });
  assert.equal(text, "First paragraph\n\nSecond paragraph");
  assert.equal(messageActionKey({ id: "", role: "assistant", parts: [] }, 6), "legacy:6");
  assert.equal(
    messageActionKey({ id: "legacy:6", role: "assistant", parts: [] }, 6),
    "id:legacy:6",
  );
  const source: UIMessage = {
    id: "m1",
    role: "assistant",
    parts: [{ type: "text", text: "Original answer" }],
  };
  const reference = messageReference(source, 0);
  const incoming: UIMessage = {
    id: "m2",
    role: "user",
    metadata: { replyTo: { ...reference, text: "Forged excerpt" } },
    parts: [{ type: "text", text: "Tell me more" }],
  };
  const [resolved] = resolveReplyReferences([incoming], [source]);
  assert.deepEqual(
    resolved.parts,
    incoming.parts,
    "Reply does not add quotes to the user's visible text",
  );
  assert.deepEqual(
    resolved.metadata,
    { replyTo: reference },
    "Server resolves the real reference contents",
  );
  const [modelMessage] = messagesWithReplyContext([resolved]);
  assert.match(messageBody(modelMessage), /Original answer/);
  assert.doesNotMatch(messageBody(modelMessage), /Forged excerpt/);
  assert.equal(messageBody(resolved), "Tell me more");
  assert.throws(() => resolveReplyReferences([incoming], []), /Reply target not found/);
  assert.equal(
    messageReference({ ...source, parts: [{ type: "text", text: "x".repeat(8000) }] }, 0).text
      .length,
    4000,
  );
  assert.deepEqual(updateReactions([], "👍", true), ["👍"]);
  assert.deepEqual(updateReactions(["👍"], "👍", true), ["👍"]);
  assert.deepEqual(updateReactions(["👍", "❤️"], "👍", false), ["❤️"]);
  assert.deepEqual(updateReactions(["👍", "unknown"], "❤️", true), ["👍", "❤️"]);
  for (const emoji of ["🦄", "🧑🏽‍💻", "🇯🇵", "👨‍👩‍👧‍👦", "1️⃣"]) assert.ok(isMessageReaction(emoji), emoji);
  for (const invalid of ["hello", "<script>", "👍👍", "", "x👍"])
    assert.equal(isMessageReaction(invalid), false, invalid);

  async function verifyOptimisticReactions() {
    let finish!: (map: ReactionMap) => void;
    const state = createReactionState(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const save = state.toggle("m1", "🦄", true);
    assert.deepEqual(
      state.getSnapshot().m1,
      ["🦄"],
      "Reaction is visible before the network responds",
    );
    const staleRevision = state.getRevision();
    await Promise.resolve();
    finish({ m1: ["🦄"] });
    await save;
    state.hydrate({}, staleRevision);
    assert.deepEqual(state.getSnapshot().m1, ["🦄"], "Stale GET cannot erase a confirmed reaction");

    const failed = createReactionState(async () => {
      throw new Error("Offline");
    });
    const failure = failed.toggle("m1", "👍", true);
    assert.deepEqual(failed.getSnapshot().m1, ["👍"]);
    await assert.rejects(failure, /Offline/);
    assert.deepEqual(failed.getSnapshot().m1 ?? [], [], "Failed save rolls back");

    const writes: boolean[] = [];
    const ordered = createReactionState(async (id, emoji, selected) => {
      writes.push(selected);
      return { [id]: selected ? [emoji] : [] };
    });
    const add = ordered.toggle("m1", "👍", true);
    const remove = ordered.toggle("m1", "👍", false);
    assert.deepEqual(ordered.getSnapshot().m1, [], "Rapid removal is immediate");
    await Promise.all([add, remove]);
    assert.deepEqual(writes, [true, false]);
    assert.deepEqual(ordered.getSnapshot().m1, []);
  }

  await verifyOptimisticReactions();
});

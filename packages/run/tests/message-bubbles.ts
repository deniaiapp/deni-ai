import assert from "node:assert/strict";
import type { UIMessage } from "ai";
import { messageBody, messageBubbleTargets } from "../src/lib/chat/message-actions";
import { BUBBLE_BREAK, BUBBLE_BREAK_METADATA, splitAssistantBubbles, withoutBubbleBreaks } from "../src/lib/chat/message-bubbles";

const texts = (message: UIMessage) => messageBubbleTargets(message, 0).map((bubble) => bubble.text);
const assistant = (text: string, metadata?: object): UIMessage => ({ id: "a1", role: "assistant", metadata, parts: [{ type: "text", text }] });

// The model splits where it writes a break line, and only there.
const paragraphs = `${"First point. ".repeat(20).trim()}\n\n${"Still the first bubble. ".repeat(10).trim()}`;
const chosen = `${paragraphs}\n${BUBBLE_BREAK}\nSecond bubble.\n\n  ${BUBBLE_BREAK}  \nThird bubble.`;
assert.deepEqual(texts(assistant(chosen, BUBBLE_BREAK_METADATA)), [paragraphs, "Second bubble.", "Third bubble."]);
assert.deepEqual(texts(assistant(paragraphs, BUBBLE_BREAK_METADATA)), [paragraphs], "no break keeps one bubble, however long");

// Messages saved before the change keep the paragraph rule, so their bubble keys stay put.
assert.equal(texts(assistant(paragraphs)).length, 2, "old messages still split at paragraphs");

// A break inside a code fence is content, not a split.
const fenced = `Look:\n\`\`\`html\n${BUBBLE_BREAK}\n\`\`\`\n${BUBBLE_BREAK}\nDone.`;
assert.deepEqual(splitAssistantBubbles(fenced, true), [`Look:\n\`\`\`html\n${BUBBLE_BREAK}\n\`\`\``, "Done."]);

// A break that is still streaming in never shows, and empty bubbles are dropped.
assert.deepEqual(splitAssistantBubbles("Hello\n<!-- sp", true), ["Hello"]);
assert.deepEqual(splitAssistantBubbles(`${BUBBLE_BREAK}\nHello\n${BUBBLE_BREAK}\n`, true), ["Hello"]);
assert.deepEqual(texts(assistant("<!", BUBBLE_BREAK_METADATA)), []);

// Plain-text views read the bubbles as paragraphs.
assert.equal(withoutBubbleBreaks(`One\n${BUBBLE_BREAK}\nTwo`), "One\n\nTwo");
assert.equal(messageBody(assistant(`One\n${BUBBLE_BREAK}\nTwo`, BUBBLE_BREAK_METADATA)), "One\n\nTwo");

console.log("Verified model-chosen bubble breaks, code fences, streaming, and the paragraph rule for old messages");

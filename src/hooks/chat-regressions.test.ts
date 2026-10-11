import { Chat } from "@ai-sdk/react";
import { QueryClient } from "@tanstack/react-query";
import type { UIMessage, UIMessageChunk } from "ai";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => {
  const pageFetch = vi.fn();
  const invalidate = vi.fn();
  return {
    slots: [] as unknown[],
    cursor: 0,
    effects: [] as Array<() => void>,
    query: new URLSearchParams(),
    pageFetch,
    invalidate,
    // `useUtils` returns the same object on every render.
    utils: {
      chat: { getChatPage: { fetch: pageFetch, invalidate } },
      billing: { usage: { invalidate } },
    },
  };
});

type EffectSlot = { deps?: readonly unknown[]; cleanup: void | (() => void) };

// Run the real hooks and AI SDK with deterministic scheduling and no network.
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useRef<T>(initial: T) {
    const index = harness.cursor++;
    return (harness.slots[index] ??= { current: initial }) as { current: T };
  },
  useState<T>(initial: T | (() => T)) {
    const index = harness.cursor++;
    if (!(index in harness.slots)) {
      harness.slots[index] = typeof initial === "function" ? (initial as () => T)() : initial;
    }
    return [
      harness.slots[index] as T,
      (next: T | ((previous: T) => T)) => {
        harness.slots[index] =
          typeof next === "function"
            ? (next as (previous: T) => T)(harness.slots[index] as T)
            : next;
      },
    ] as const;
  },
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
    const index = harness.cursor++;
    const previous = harness.slots[index] as EffectSlot | undefined;
    // Like React, re-run (after the previous cleanup) only when a dependency changed.
    if (
      previous?.deps &&
      deps?.length === previous.deps.length &&
      deps.every((dep, depIndex) => Object.is(dep, previous.deps?.[depIndex]))
    ) {
      return;
    }
    harness.effects.push(() => {
      previous?.cleanup?.();
      harness.slots[index] = { deps, cleanup: effect() } satisfies EffectSlot;
    });
  },
  useCallback<T>(callback: T) {
    return callback;
  },
  useMemo<T>(factory: () => T) {
    return factory();
  },
  useSyncExternalStore<T>(_subscribe: unknown, snapshot: () => T) {
    return snapshot();
  },
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => harness.query }));
vi.mock("@/lib/trpc/react", () => ({
  trpc: { useUtils: () => harness.utils },
}));

import { groupMessages, useChatBranches } from "./use-chat-branches";
import { useChatPageSync } from "./use-chat-page-sync";
import { useInitialMessage } from "./use-initial-message";
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts";
import { ensureChatCreated, trackChatCreation } from "@/lib/chat-creation";
import { mergeMessageWindow, sliceLatestMessages, sliceOlderMessages } from "@/lib/chat-messages";
import { models } from "@/lib/constants";

beforeEach(() => {
  vi.clearAllMocks();
  harness.slots = [];
  harness.cursor = 0;
  harness.effects = [];
  harness.query = new URLSearchParams();
  vi.stubGlobal("window", { history: { replaceState: vi.fn() } });
  vi.stubGlobal("sessionStorage", { getItem: () => null, removeItem: vi.fn() });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function render<T>(callback: () => T): T {
  harness.cursor = 0;
  harness.effects = [];
  const result = callback();
  for (const effect of harness.effects) effect();
  return result;
}

function message(id: string, role: "user" | "assistant", text: string): UIMessage {
  return { id, role, parts: [{ type: "text", text }] };
}

const conversation = () => [
  message("q1", "user", "Question one"),
  message("a1", "assistant", "Answer one"),
  message("q2", "user", "Question two"),
  message("a2", "assistant", "Answer two"),
];

async function regenerateAt(messages: UIMessage[], target?: string) {
  const sent: UIMessage[][] = [];
  const chat = new Chat({
    messages,
    transport: {
      sendMessages: async (options) => {
        sent.push(options.messages);
        const chunks: UIMessageChunk[] = [
          { type: "start", messageId: "new-answer" },
          { type: "text-start", id: "text" },
          { type: "text-delta", id: "text", delta: "Regenerated answer" },
          { type: "text-end", id: "text" },
          { type: "finish", finishReason: "stop" },
        ];
        return new ReadableStream<UIMessageChunk>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
          },
        });
      },
      reconnectToStream: async () => null,
    },
  });
  const setMessages = vi.fn((update: UIMessage[] | ((previous: UIMessage[]) => UIMessage[])) => {
    chat.messages = typeof update === "function" ? update(chat.messages) : update;
  });
  const hook = render(() =>
    useChatBranches({ messages: chat.messages, setMessages, regenerate: chat.regenerate }),
  );
  hook.handleRegenerate(target ? { messageId: target } : undefined);
  await vi.waitFor(() => expect(setMessages).toHaveBeenCalledOnce());
  expect(chat.error).toBeUndefined();
  return { chat, sent, grouped: groupMessages(chat.messages) };
}

test("regeneration without an ID keeps the last answer's alternatives", async () => {
  const { grouped, sent } = await regenerateAt(conversation());
  expect(sent[0].map((item) => item.id)).toEqual(["q1", "a1", "q2"]);
  expect(grouped.at(-1)).toMatchObject({
    type: "branch",
    messages: [{ id: "a2" }, { id: "new-answer" }],
  });
});

test("regenerating an older answer keeps the replacement under its own question", async () => {
  const { chat, grouped, sent } = await regenerateAt(conversation(), "a1");
  expect(sent[0].map((item) => item.id)).toEqual(["q1"]);
  expect(chat.messages.map((item) => item.id)).toEqual(["q1", "a1", "new-answer"]);
  expect(grouped.at(-1)).toMatchObject({
    type: "branch",
    messages: [{ id: "a1" }, { id: "new-answer" }],
  });
});

test("regenerating an earlier alternative preserves the other alternatives for that question", async () => {
  const messages = conversation();
  messages[1].metadata = { branchGroupId: "existing" };
  messages.splice(2, 0, {
    ...message("a1-alternative", "assistant", "Another answer one"),
    metadata: { branchGroupId: "existing" },
  });
  const { chat, grouped } = await regenerateAt(messages, "a1");
  expect(chat.messages.map((item) => item.id)).toEqual([
    "q1",
    "a1",
    "a1-alternative",
    "new-answer",
  ]);
  expect(grouped.at(-1)).toMatchObject({
    type: "branch",
    groupId: "existing",
    messages: [{ id: "a1" }, { id: "a1-alternative" }, { id: "new-answer" }],
  });
});

async function regenerateFailing(messages: UIMessage[], target?: string) {
  const sent: UIMessage[][] = [];
  const chat = new Chat({
    messages,
    transport: {
      sendMessages: async (options) => {
        sent.push(options.messages);
        // e.g. a 402 when the token reservation exceeds the remaining balance.
        throw new Error("You've hit the usage limit for your plan.");
      },
      reconnectToStream: async () => null,
    },
  });
  const setMessages = vi.fn((update: UIMessage[] | ((previous: UIMessage[]) => UIMessage[])) => {
    chat.messages = typeof update === "function" ? update(chat.messages) : update;
  });
  const hook = render(() =>
    useChatBranches({ messages: chat.messages, setMessages, regenerate: chat.regenerate }),
  );
  hook.handleRegenerate(target ? { messageId: target } : undefined);
  await vi.waitFor(() => expect(setMessages).toHaveBeenCalledOnce());
  expect(chat.status).toBe("error");
  return { chat, sent };
}

test("a failed regeneration puts the original answer back", async () => {
  const { chat, sent } = await regenerateFailing(conversation());
  expect(sent[0].map((item) => item.id)).toEqual(["q1", "a1", "q2"]);
  expect(chat.messages).toEqual(conversation());
});

test("a failed regeneration of an older answer keeps the later turns", async () => {
  const { chat } = await regenerateFailing(conversation(), "a1");
  expect(chat.messages).toEqual(conversation());
});

async function recoverPending(current: UIMessage[], serverMessages: UIMessage[]) {
  harness.pageFetch.mockResolvedValue({ messages: serverMessages });
  const setMessages = vi.fn((update: UIMessage[] | ((previous: UIMessage[]) => UIMessage[])) => {
    current = typeof update === "function" ? update(current) : update;
  });
  const params = {
    id: "chat",
    status: "ready" as const,
    isWaitingForResponse: true,
    activeGenerationId: null,
    statusUpdatedAt: new Date("2026-10-08T00:00:00Z"),
    isStatusSuccess: true,
    setMessages,
  };
  render(() => useChatPageSync(params));
  await vi.waitFor(() => expect(setMessages).toHaveBeenCalledOnce());
  // Each poll deserializes a new Date for the same timestamp.
  render(() => useChatPageSync({ ...params, statusUpdatedAt: new Date(params.statusUpdatedAt) }));
  expect(harness.pageFetch).toHaveBeenCalledExactlyOnceWith({ id: "chat" }, { staleTime: 0 });
  return current;
}

function pendingConversation() {
  const complete = Array.from({ length: 5 }, (_, index) => [
    message(`q${index + 1}`, "user", `Question ${index + 1}`),
    message(`a${index + 1}`, "assistant", `Completed ${index + 1}`),
  ]).flat();
  const pending = complete.map((item, index) =>
    index === complete.length - 1 ? { ...item, parts: [], metadata: { pending: true } } : item,
  );
  return { complete, pending };
}

test("the initial five-message window recovers a completed answer", async () => {
  const { complete, pending } = pendingConversation();
  const result = await recoverPending(
    sliceLatestMessages(pending).messages,
    sliceLatestMessages(complete).messages,
  );
  expect(result.at(-1)).toEqual(complete.at(-1));
});

test("loading older history still recovers the answer and preserves that history", async () => {
  const { complete, pending } = pendingConversation();
  const initial = sliceLatestMessages(pending);
  const current = mergeMessageWindow(
    sliceOlderMessages(pending, initial.oldestIndex).messages,
    initial.messages,
  );
  expect(await recoverPending(current, sliceLatestMessages(complete).messages)).toEqual(complete);
});

test("recovery reads past the page cached moments ago with the pending answer", async () => {
  const { complete, pending } = pendingConversation();
  // The app's defaults: a page fetched under a minute ago counts as fresh.
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } });
  const queryKey = [["chat", "getChatPage"], { input: { id: "chat" }, type: "query" }];
  queryClient.setQueryData(queryKey, sliceLatestMessages(pending));
  const server = vi.fn(async () => sliceLatestMessages(complete));
  // Mirrors tRPC's `utils.chat.getChatPage.fetch(input, opts)`.
  harness.pageFetch.mockImplementation((_input: unknown, opts?: object) =>
    queryClient.fetchQuery({ ...opts, queryKey, queryFn: server }),
  );
  let current = sliceLatestMessages(pending).messages;
  const setMessages = vi.fn((update: UIMessage[] | ((previous: UIMessage[]) => UIMessage[])) => {
    current = typeof update === "function" ? update(current) : update;
  });

  render(() =>
    useChatPageSync({
      id: "chat",
      status: "ready",
      isWaitingForResponse: true,
      activeGenerationId: null,
      statusUpdatedAt: new Date("2026-10-08T00:00:00Z"),
      isStatusSuccess: true,
      setMessages,
    }),
  );
  await vi.waitFor(() => expect(setMessages).toHaveBeenCalledOnce());
  expect(server).toHaveBeenCalledOnce();
  expect(current.at(-1)).toEqual(complete.at(-1));
});

test("a failed recovery read is retried even though the saved status stops changing", async () => {
  vi.useFakeTimers();
  const { complete, pending } = pendingConversation();
  harness.pageFetch
    .mockRejectedValueOnce(new Error("Service Unavailable"))
    .mockResolvedValue(sliceLatestMessages(complete));
  let current = sliceLatestMessages(pending).messages;
  const setMessages = vi.fn((update: UIMessage[] | ((previous: UIMessage[]) => UIMessage[])) => {
    current = typeof update === "function" ? update(current) : update;
  });
  // Every poll after the answer is saved deserializes the same timestamp.
  const poll = () =>
    render(() =>
      useChatPageSync({
        id: "chat",
        status: "ready",
        isWaitingForResponse: true,
        activeGenerationId: null,
        statusUpdatedAt: new Date("2026-10-08T00:00:00Z"),
        isStatusSuccess: true,
        setMessages,
      }),
    );

  poll();
  await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
  poll();
  expect(harness.pageFetch).toHaveBeenCalledOnce();
  expect(setMessages).not.toHaveBeenCalled();

  // The scheduled retry updates state, which re-renders the hook.
  await vi.advanceTimersByTimeAsync(1000);
  poll();
  await vi.waitFor(() => expect(setMessages).toHaveBeenCalledOnce());
  expect(harness.pageFetch).toHaveBeenCalledTimes(2);
  expect(current.at(-1)).toEqual(complete.at(-1));
});

test("a stale server page does not replace a newer local question", async () => {
  const { complete, pending } = pendingConversation();
  const stale = sliceLatestMessages(complete.slice(0, -2)).messages;
  expect(await recoverPending(pending, stale)).toEqual(pending);
});

test("an assistant-only server window recovers the matching pending message", async () => {
  const complete = [
    message("question", "user", "Question"),
    ...Array.from({ length: 6 }, (_, index) => message(`answer-${index}`, "assistant", "Answer")),
  ];
  const pending = complete.map((item, index) =>
    index === complete.length - 1 ? { ...item, parts: [], metadata: { pending: true } } : item,
  );
  expect(await recoverPending(pending, sliceLatestMessages(complete).messages)).toEqual(complete);
});

const storedFile = {
  type: "file" as const,
  filename: "report.pdf",
  mediaType: "application/pdf",
  url: "https://files.example/report.pdf",
};

function sendStoredPrompt(
  id: string,
  sendMessage: Parameters<typeof useInitialMessage>[0]["sendMessage"],
) {
  const storedPrompt = JSON.stringify({
    text: "Stored prompt",
    files: [storedFile],
    webSearch: false,
  });
  vi.stubGlobal("sessionStorage", { getItem: () => storedPrompt, removeItem: vi.fn() });
  const onDraft = vi.fn();
  render(() =>
    useInitialMessage({
      id,
      initialMessagesLength: 0,
      model: models[0].value,
      sendMessage,
      onMessageSent: vi.fn(),
      onDraft,
    }),
  );
  return { onDraft };
}

/** A chat whose transport waits for the row, like ChatInterface's. */
function chatWaitingForRow(id: string) {
  const posted: UIMessage[][] = [];
  const chat = new Chat({
    id,
    transport: {
      sendMessages: async (options) => {
        if (!(await ensureChatCreated(id))) {
          throw new Error("Chat not found");
        }
        posted.push(options.messages);
        return new ReadableStream<UIMessageChunk>({
          start(controller) {
            controller.enqueue({ type: "start", messageId: "answer" });
            controller.enqueue({ type: "finish", finishReason: "stop" });
            controller.close();
          },
        });
      },
      reconnectToStream: async () => null,
    },
  });
  return { chat, posted };
}

test("the home page prompt shows at once but is posted only after its chat row exists", async () => {
  let createRow!: () => void;
  void trackChatCreation(
    "new-chat",
    () =>
      new Promise<void>((resolve) => {
        createRow = resolve;
      }),
    0,
  );
  const { chat, posted } = chatWaitingForRow("new-chat");
  sendStoredPrompt("new-chat", chat.sendMessage);
  await vi.waitFor(() => expect(chat.messages).toHaveLength(1));
  expect(posted).toEqual([]);

  createRow();
  await vi.waitFor(() => expect(posted).toHaveLength(1));
  expect(posted[0][0].parts).toEqual([storedFile, { type: "text", text: "Stored prompt" }]);
});

test("a chat that cannot be created keeps the home page prompt and its attachments", async () => {
  void trackChatCreation("broken-chat", async () => Promise.reject(new Error("down")), 0);
  const { chat, posted } = chatWaitingForRow("broken-chat");
  const { onDraft } = sendStoredPrompt("broken-chat", chat.sendMessage);

  // ChatInterface shows this error, and the prompt keeps its file in the transcript.
  await vi.waitFor(() => expect(chat.status).toBe("error"));
  expect(chat.error?.message).toBe("Chat not found");
  expect(posted).toEqual([]);
  expect(onDraft).not.toHaveBeenCalled();
  expect(chat.messages).toHaveLength(1);
  expect(chat.messages[0]).toMatchObject({
    role: "user",
    parts: [storedFile, { type: "text", text: "Stored prompt" }],
  });
});

test("a keydown without a key, as autofill dispatches, is ignored by the chat shortcuts", () => {
  const listeners: Array<(event: KeyboardEvent) => void> = [];
  vi.stubGlobal("window", {
    addEventListener: (_type: string, listener: (event: KeyboardEvent) => void) =>
      listeners.push(listener),
    removeEventListener: vi.fn(),
  });
  const onFocusComposer = vi.fn();
  render(() => useKeyboardShortcuts({ onFocusComposer }));
  const [handleKeyDown] = listeners;

  expect(() => handleKeyDown(new Event("keydown") as KeyboardEvent)).not.toThrow();
  expect(onFocusComposer).not.toHaveBeenCalled();

  const slash = { key: "/", target: null, preventDefault: vi.fn() };
  handleKeyDown(slash as unknown as KeyboardEvent);
  expect(onFocusComposer).toHaveBeenCalledOnce();
});

test.each([
  "Explain URLs",
  "Explain %20 and %2F in URLs",
  "100% complete, even with %invalid",
  "Keep +, &, and ? literally",
  "日本語の質問\n次の行にも %E3%81%82 をそのまま残す",
])("a URL prompt is preserved exactly and is never sent automatically: %s", (prompt) => {
  harness.query = new URLSearchParams(new URLSearchParams({ message: prompt }).toString());
  const onDraft = vi.fn();
  const sendMessage = vi.fn();
  render(() =>
    useInitialMessage({
      id: "chat",
      initialMessagesLength: 0,
      model: models[0].value,
      sendMessage,
      onMessageSent: vi.fn(),
      onDraft,
    }),
  );
  expect(onDraft).toHaveBeenCalledExactlyOnceWith(prompt);
  expect(sendMessage).not.toHaveBeenCalled();
});

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { UIMessage } from "ai";
import { beforeEach, expect, test, vi } from "vitest";

/**
 * The chat route with the real attachment resolution: only the database,
 * signing, the byte download and the chat store are faked.
 */
const mocks = vi.hoisted(() => ({
  rows: [] as { id: string; userId: string; storageKey: string | null; status: string }[],
  links: [] as { set: unknown; params: unknown[] }[],
  getChat: vi.fn(),
  updateChat: vi.fn(),
  consume: vi.fn(),
  resolveModel: vi.fn(),
  sign: vi.fn(
    async (key: string, ttl: number) => `https://storage.example/${key}?ttl=${ttl}&sig=s`,
  ),
  anonymous: false,
  fit: vi.fn(async (messages: UIMessage[], _cache: Map<string, unknown>) => messages),
}));
const dialect = new PgDialect();

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => ({
        session: { userId: "user" },
        user: { isAnonymous: mocks.anonymous },
      }),
    },
  },
}));
vi.mock("@/db/drizzle", () => ({
  db: {
    // The `id in (...)` lookup of resolveAttachmentFileParts.
    select: () => ({
      from: () => ({
        where: async (condition: SQL) => {
          const { params } = dialect.sqlToQuery(condition);
          return mocks.rows.filter((row) => params.includes(row.id));
        },
      }),
    }),
    update: () => ({
      set: (set: unknown) => ({
        where: async (condition: SQL) => {
          mocks.links.push({ set, params: dialect.sqlToQuery(condition).params });
          return [];
        },
      }),
    }),
  },
}));
vi.mock("@/lib/upload", () => ({
  ATTACHMENT_FETCH_URL_TTL_SECONDS: 300,
  isStorageConfigured: () => true,
  signAttachmentUrl: mocks.sign,
  deleteStoredFiles: vi.fn(),
}));
vi.mock("@/lib/chat-attachment-download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat-attachment-download")>()),
  // Stands in for the server-side download of each file's bytes.
  fitBinaryAttachmentsToBudget: mocks.fit,
}));
vi.mock("@/lib/chat", () => ({
  getChatById: mocks.getChat,
  updateChat: mocks.updateChat,
  replaceLastChatMessage: vi.fn(),
  clearChatGenerationState: vi.fn(),
  isChatGenerationActive: async () => true,
  restoreStoppedRegeneration: vi.fn(),
  generateTitle: vi.fn(),
}));
vi.mock("@/lib/project-context", () => ({ buildProjectPrompt: async () => null }));
vi.mock("@/lib/usage", () => ({
  canCompareModels: async () => true,
  consumeUsage: mocks.consume,
  refundUsage: vi.fn(),
  getSubscriptionTier: vi.fn(),
  UsageLimitError: class UsageLimitError extends Error {},
}));
vi.mock("@/lib/memory", () => ({
  getUserMemoryState: async () => ({ profile: { autoMemory: false } }),
  buildMemoryPrompt: () => "",
  maybeAutoSaveMemories: vi.fn(),
}));
vi.mock("@/lib/max-mode", () => ({ reportMaxModeUsageToStripe: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/platform-capabilities.server", () => ({
  platformCapabilities: { features: { webSearch: false, memory: false } },
}));
vi.mock("./_lib/model", () => ({
  resolveChatModelContext: mocks.resolveModel,
  ChatRouteError: class ChatRouteError extends Error {},
  addOpenRouterCacheControl: vi.fn(),
}));

import { POST } from "./route";
import { UsageLimitError } from "@/lib/usage";

const MINE = "m".repeat(32);
const THEIRS = "t".repeat(32);

const ask = (url: string): UIMessage => ({
  id: "question",
  role: "user",
  parts: [
    { type: "text", text: "What is in this image?" },
    { type: "file", mediaType: "image/png", filename: "a.png", url },
  ],
});

const send = (messages: UIMessage[]) =>
  POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "chat-id", model: "test-model", messages }),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.anonymous = false;
  mocks.fit.mockImplementation(async (messages: UIMessage[]) => messages);
  mocks.links = [];
  mocks.rows = [
    { id: MINE, userId: "user", storageKey: "key-mine", status: "ready" },
    { id: THEIRS, userId: "someone-else", storageKey: "key-theirs", status: "ready" },
  ];
  mocks.resolveModel.mockResolvedValue({
    model: {},
    providerOptions: {},
    usageCategory: "basic",
    usageUnit: "requests",
    usesOpenRouter: false,
  });
  mocks.getChat.mockResolvedValue({ title: "Chat", projectId: null, messages: [] });
  mocks.updateChat.mockResolvedValue({ stopRequestedAt: null });
  // Stops the request right after the question is saved.
  mocks.consume.mockRejectedValue(new UsageLimitError("Quota exhausted"));
});

test.each([`/api/attachments/${MINE}`, `http://localhost:3000/api/attachments/${MINE}`])(
  "the server downloads the user's own file by a signed URL and saves the app URL: %s",
  async (appUrl) => {
    const response = await send([ask(appUrl)]);

    expect(response.status).toBe(402);
    // The download (server side) gets the short-lived signed URL...
    expect(mocks.sign).toHaveBeenCalledExactlyOnceWith("key-mine", 300);
    const downloaded = mocks.fit.mock.calls[0]?.[0];
    expect(downloaded?.[0]?.parts[1]).toMatchObject({
      url: "https://storage.example/key-mine?ttl=300&sig=s",
    });
    // ...while the saved transcript keeps the stable app URL.
    const saved = JSON.stringify(mocks.updateChat.mock.calls[0]?.[2]);
    expect(saved).toContain(appUrl);
    expect(saved).not.toContain("storage.example");
    // And the file is tied to the chat, for the owner only.
    expect(mocks.links).toEqual([{ set: { chatId: "chat-id" }, params: [MINE, "user", "ready"] }]);
  },
);

test.each([`/api/attachments/${THEIRS}`, `http://localhost:3000/api/attachments/${THEIRS}`])(
  "a request referencing another user's attachment is rejected: %s",
  async (url) => {
    const response = await send([ask(url)]);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid or oversized attachment" });
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.fit).not.toHaveBeenCalled();
    // Nothing is saved, linked or charged.
    expect(mocks.updateChat).not.toHaveBeenCalled();
    expect(mocks.links).toEqual([]);
    expect(mocks.consume).not.toHaveBeenCalled();
  },
);

test("another user's attachment anywhere in the history rejects the request", async () => {
  const response = await send([
    ask(`/api/attachments/${THEIRS}`),
    { id: "answer", role: "assistant", parts: [{ type: "text", text: "A cat." }] },
    { ...ask(`/api/attachments/${MINE}`), id: "follow-up" },
  ]);
  expect(response.status).toBe(400);
  expect(mocks.updateChat).not.toHaveBeenCalled();
});

test.each([
  // Unknown sizes count as the 10 MB maximum, so passing proves the lookup by signed URL.
  { bytes: 30 * 1024, status: 402 },
  { bytes: 3 * 1024 * 1024, status: 413 },
])(
  "guest prompt sizing measures a stored PDF by the bytes downloaded for its signed URL: $bytes",
  async ({ bytes, status }) => {
    mocks.anonymous = true;
    // The download fills the request's cache under the signed URL, as the real one does.
    mocks.fit.mockImplementation(async (messages: UIMessage[], cache: Map<string, unknown>) => {
      for (const part of messages.flatMap((message) => message.parts)) {
        if (part.type === "file") {
          cache.set(new URL(part.url).href, {
            data: new Uint8Array(bytes),
            mediaType: "application/pdf",
          });
        }
      }
      return messages;
    });
    const question: UIMessage = {
      id: "question",
      role: "user",
      parts: [
        { type: "text", text: "Summarize this." },
        {
          type: "file",
          mediaType: "application/pdf",
          filename: "a.pdf",
          url: `/api/attachments/${MINE}`,
        },
      ],
    };

    const response = await send([question]);

    expect(response.status).toBe(status);
    if (status === 413) {
      expect(await response.json()).toMatchObject({ reason: "guest_attachment_too_large" });
      expect(mocks.updateChat).not.toHaveBeenCalled();
    }
  },
);

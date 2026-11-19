import type { UIMessage } from "ai";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getChat: vi.fn(),
  updateChat: vi.fn(),
  checkActive: vi.fn(),
  consume: vi.fn(),
  resolveModel: vi.fn(),
  resolveAttachments: vi.fn(),
  linkAttachments: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => ({ session: { userId: "user" }, user: {} }) } },
}));
vi.mock("@/lib/chat", () => ({
  getChatById: mocks.getChat,
  updateChat: mocks.updateChat,
  replaceLastChatMessage: vi.fn(),
  clearChatGenerationState: vi.fn(),
  isChatGenerationActive: mocks.checkActive,
  restoreStoppedRegeneration: vi.fn(),
  generateTitle: vi.fn(),
}));
vi.mock("@/lib/attachments", () => ({
  resolveAttachmentFileParts: mocks.resolveAttachments,
  linkChatAttachments: mocks.linkAttachments,
  ForeignAttachmentError: class ForeignAttachmentError extends Error {},
  rewriteMigratedAttachmentUrls: async (messages: unknown) => messages,
  withStableAttachmentUrls: (messages: unknown) => messages,
}));
vi.mock("@/lib/project-context", () => ({ buildProjectPrompt: async () => null }));
vi.mock("@/lib/usage", () => ({
  canCompareModels: async () => true,
  consumeUsage: mocks.consume,
  refundUsage: vi.fn(),
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

const ATTACHMENT_URL = `/api/attachments/${"a".repeat(32)}`;
const question: UIMessage = {
  id: "question",
  role: "user",
  parts: [
    { type: "text", text: "What is in this file?" },
    { type: "file", mediaType: "image/png", filename: "a.png", url: ATTACHMENT_URL },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveModel.mockResolvedValue({
    model: {},
    providerOptions: {},
    usageCategory: "basic",
    usesOpenRouter: false,
  });
  mocks.getChat.mockResolvedValue({ title: "Chat", projectId: null, messages: [] });
  mocks.updateChat.mockResolvedValue({ stopRequestedAt: null });
  mocks.checkActive.mockResolvedValue(true);
  // Stops the request right after the question is saved.
  mocks.consume.mockRejectedValue(new UsageLimitError("Quota exhausted"));
  mocks.resolveAttachments.mockImplementation(async (messages: UIMessage[]) => ({
    messages: messages.map((message) => ({
      ...message,
      parts: message.parts.filter((part) => part.type !== "file"),
    })),
    cacheKeys: new Map(),
  }));
});

test("saving a question ties its uploads to the chat", async () => {
  const response = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "chat-id", model: "test-model", messages: [question] }),
    }),
  );

  expect(response.status).toBe(402);
  expect(mocks.resolveAttachments).toHaveBeenCalledWith([question], "user");
  expect(mocks.linkAttachments).toHaveBeenCalledExactlyOnceWith("chat-id", "user", [question]);
  // Only once the message carrying the upload is saved.
  expect(mocks.updateChat.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.linkAttachments.mock.invocationCallOrder[0] ?? 0,
  );
});

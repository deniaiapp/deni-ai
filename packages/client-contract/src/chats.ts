import { z } from "zod";

const isoDate = z.string().describe("ISO 8601 timestamp");

export const chatSummarySchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  projectId: z.string().nullable(),
  pinned: z.boolean(),
  folder: z.string().nullable(),
  tags: z.array(z.string()),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type ChatSummary = z.infer<typeof chatSummarySchema>;

/** Largest `limit` of `GET /chats`. */
export const CHAT_LIST_MAX_LIMIT = 100;

/** `GET /api/client/v1/chats?limit=&cursor=`: newest first by `updatedAt`. */
export const chatListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(CHAT_LIST_MAX_LIMIT).default(50),
  /** `nextCursor` of the previous page. */
  cursor: z.string().max(200).optional(),
});
export type ChatListQuery = z.infer<typeof chatListQuerySchema>;

export const chatListResponseSchema = z.object({
  chats: z.array(chatSummarySchema),
  /** Pass as `cursor` for the next page; null on the last page. */
  nextCursor: z.string().nullable(),
});
export type ChatListResponse = z.infer<typeof chatListResponseSchema>;

/**
 * One message of a transcript, as the AI SDK's `UIMessage`: `parts` holds
 * `text`, `reasoning`, `source-url`, `file`, `step-start` and `tool-*` parts.
 * Unknown part types must be skipped, not rejected.
 */
export const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["system", "user", "assistant"]),
  parts: z.array(z.looseObject({ type: z.string() })),
  metadata: z.unknown().optional(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** A window of a transcript: messages `oldestIndex` .. `total - 1` or an older page. */
export const messageWindowSchema = z.object({
  messages: z.array(chatMessageSchema),
  /** Index of the first message in this window; pass as `before` for the previous page. */
  oldestIndex: z.number().int().min(0),
  hasMore: z.boolean(),
});
export type MessageWindow = z.infer<typeof messageWindowSchema>;

/**
 * `POST /api/client/v1/chats` (body: {@link createChatBodySchema}) and
 * `GET /api/client/v1/chats/:id`: the chat with its latest messages.
 */
export const chatDetailSchema = messageWindowSchema.extend({
  id: z.string(),
  title: z.string().nullable(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  /** The model last used in this chat; null when none was recorded. */
  model: z.string().nullable(),
});
export type ChatDetail = z.infer<typeof chatDetailSchema>;

/**
 * Creates the chat row before the first `POST /api/chat`. The client picks the
 * id (a UUID) so it can show the conversation before the server answers; the
 * call is idempotent and returns the existing chat for a known id.
 */
export const createChatBodySchema = z.object({
  id: z.uuid(),
  projectId: z.uuid().nullable().optional(),
});
export type CreateChatBody = z.infer<typeof createChatBodySchema>;

/** `GET /api/client/v1/chats/:id/messages?before=&limit=` */
export const olderMessagesQuerySchema = z.object({
  before: z.coerce.number().int().min(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type OlderMessagesQuery = z.infer<typeof olderMessagesQuerySchema>;

/**
 * `GET /api/client/v1/chats/:id/status`. While `generating`, an answer is
 * still being written on the server (for example after the client lost its
 * stream); poll about once a second and reload the chat when it turns false.
 */
export const chatStatusSchema = z.object({
  generating: z.boolean(),
  updatedAt: isoDate,
});
export type ChatStatus = z.infer<typeof chatStatusSchema>;

/** `PATCH /api/client/v1/chats/:id`: every field optional, at least one. */
export const updateChatBodySchema = z
  .object({
    title: z.string().trim().max(500).nullable(),
    pinned: z.boolean(),
    folder: z.string().trim().max(80).nullable(),
    tags: z.array(z.string().trim().min(1).max(32)).max(12),
    /** Remember the model picked in this conversation. */
    model: z.string().min(1).max(200),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");
export type UpdateChatBody = z.infer<typeof updateChatBodySchema>;

/** `PUT /api/client/v1/preferences/model`: the default model for new chats. */
export const preferredModelBodySchema = z.object({
  model: z.string().min(1).max(200),
});
export type PreferredModelBody = z.infer<typeof preferredModelBodySchema>;

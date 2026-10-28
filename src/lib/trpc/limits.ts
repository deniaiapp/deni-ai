import { CHAT_BODY_LIMIT } from "@/lib/request-body";

/**
 * Most procedure calls one tRPC HTTP request may batch. The server runs every
 * call of a batch at once, so this bounds how far one request fans out; the
 * client splits larger batches to stay under it.
 */
export const TRPC_MAX_BATCH_SIZE = 20;

const MB = 1024 * 1024;

/**
 * POST body cap for every procedure not listed below. The largest of them is a
 * blog post: two 100,000-character bodies, about 600 KB of JSON in Japanese.
 */
export const TRPC_DEFAULT_BODY_LIMIT = 2 * MB;

/**
 * One comparison side as saved: the transcript its last /api/chat request
 * carried (at most CHAT_BODY_LIMIT), plus the answer to that request, which no
 * request carried. 4 MiB is room for one response's text, reasoning and tool
 * output (about 80 full-length English page fetches) and superjson's envelope.
 */
export const COMPARISON_SIDE_BODY_LIMIT = CHAT_BODY_LIMIT + 4 * MB;

/**
 * Procedures whose input can exceed the default. A Map, so a path such as
 * "constructor" never reads an inherited property.
 */
const LARGE_BODY_LIMITS = new Map<string, number>([
  // 25 MB of JSON, plus room for the RPC envelope.
  ["migration.import", 30 * MB],
  // Comparison transcripts, so any side /api/chat accepted can be saved. The
  // session sends both sides in one body: 40 MiB, deliberately above the
  // import's cap. Only Pro and Max bodies are read; chat.ts checks the plan
  // before parsing the input.
  ["chat.saveComparisonSession", 2 * COMPARISON_SIDE_BODY_LIMIT],
  ["chat.saveComparison", COMPARISON_SIDE_BODY_LIMIT],
]);

/** True when the client must send this procedure alone rather than in a batch. */
export function hasLargeBodyLimit(path: string) {
  return LARGE_BODY_LIMITS.has(path);
}

/**
 * Body cap for a request calling these procedures. A batch shares one body, so
 * it gets the smallest cap among its calls: no procedure can then receive more
 * than its own cap by batching with another (the client sends large-input
 * procedures alone, see src/lib/trpc/client.ts).
 */
export function trpcBodyLimit(paths: readonly string[]) {
  let limit = paths.length > 0 ? Infinity : TRPC_DEFAULT_BODY_LIMIT;
  for (const path of paths) {
    limit = Math.min(limit, LARGE_BODY_LIMITS.get(path) ?? TRPC_DEFAULT_BODY_LIMIT);
  }
  return limit;
}

/**
 * True when a tRPC call failed because its body was over the route's cap.
 * src/server/http/trpc/[trpc]/route.ts answers 413 outside tRPC's error shape, so
 * the client error carries only the HTTP response (in `meta`). Retrying such a
 * call can never succeed.
 */
export function isBodyTooLargeError(error: unknown) {
  const { data, meta } = (error ?? {}) as {
    data?: { code?: unknown } | null;
    meta?: { response?: { status?: unknown } | null } | null;
  };
  return data?.code === "PAYLOAD_TOO_LARGE" || meta?.response?.status === 413;
}

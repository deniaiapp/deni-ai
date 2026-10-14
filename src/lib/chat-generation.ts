type ActiveGeneration = {
  generationId: string;
  abortController: AbortController;
};

const activeGenerations = new Map<string, ActiveGeneration>();

/**
 * Abort with an AbortError, not a bare string: the AI SDK passes the reason
 * through to the provider's response body, and a non-AbortError reason there
 * surfaces as an unhandled "Failed to process successful response" API error.
 */
export function abortGeneration(abortController: AbortController, reason: "replaced" | "stopped") {
  abortController.abort(new DOMException(reason, "AbortError"));
}

export function startChatGeneration(chatId: string, generationId: string) {
  const replacedGeneration = activeGenerations.get(chatId);
  if (replacedGeneration) abortGeneration(replacedGeneration.abortController, "replaced");

  const abortController = new AbortController();
  activeGenerations.set(chatId, { generationId, abortController });

  return { abortController };
}

/** Abort only the given generation, never one that replaced it on this instance. */
export function stopChatGeneration(chatId: string, generationId: string) {
  const activeGeneration = activeGenerations.get(chatId);
  if (activeGeneration?.generationId !== generationId) {
    return false;
  }

  abortGeneration(activeGeneration.abortController, "stopped");
  activeGenerations.delete(chatId);
  return true;
}

export function clearChatGeneration(chatId: string, generationId: string) {
  const activeGeneration = activeGenerations.get(chatId);
  if (activeGeneration?.generationId !== generationId) {
    return;
  }

  activeGenerations.delete(chatId);
}

export function isCurrentChatGeneration(chatId: string, generationId: string) {
  return activeGenerations.get(chatId)?.generationId === generationId;
}

// A stop can reach the server before its request has registered a generation,
// when there is nothing to stop yet. Remember it briefly so that request stops
// itself once it registers. Per instance, as a fast path; the stop route also
// records it on the chat row for requests registering on other instances.
const STOP_REQUEST_TTL_MS = 60_000;
const stopRequests = new Map<string, number>();

/** Record a stop for requests on this chat that arrived before `requestedAt`. */
export function recordChatStopRequest(chatId: string, requestedAt = Date.now()) {
  for (const [key, recordedAt] of stopRequests) {
    if (requestedAt - recordedAt <= STOP_REQUEST_TTL_MS) break;
    stopRequests.delete(key);
  }
  const latest = Math.max(stopRequests.get(chatId) ?? requestedAt, requestedAt);
  // Re-insert so the map stays ordered by time for the pruning above.
  stopRequests.delete(chatId);
  stopRequests.set(chatId, latest);
}

/** Whether a stop for this chat arrived after a request that arrived at `startedAt`. */
export function isChatStopRequestedSince(chatId: string, startedAt: number, now = Date.now()) {
  const requestedAt = stopRequests.get(chatId);
  return (
    requestedAt !== undefined && requestedAt > startedAt && now - requestedAt <= STOP_REQUEST_TTL_MS
  );
}

// A provider call cut off mid-stream reports no usage, so its prompt is
// estimated. What the provider last reported for a chat bounds that estimate:
// its cache reads show how much of the prompt it reads from cache, billed at the
// cache-read weight instead of as uncached input, and the input it reported for
// a request's first call (attachments included) is a lower bound for any later
// prompt that still starts with that one. Per instance and kept only as long as
// a provider cache is commonly retained; without a recent report the estimate
// stays uncached and counts only the prompt text.
const PROMPT_USAGE_TTL_MS = 5 * 60_000;

export type ReportedPrompt = {
  /** Input tokens the provider reported for the prompt. */
  inputTokens: number;
  /** Messages in the prompt, and the fingerprint of the prompt up to them. */
  messageCount: number;
  fingerprint: string;
};

type PromptUsage = { cacheReadTokens: number; prompt?: ReportedPrompt };

const promptUsage = new Map<string, PromptUsage & { recordedAt: number }>();

/**
 * Record the usage of a finished provider call for this chat and model. A call
 * without `prompt` keeps the prompt recorded earlier.
 */
export function recordPromptUsage(key: string, usage: PromptUsage, now = Date.now()) {
  for (const [entryKey, entry] of promptUsage) {
    if (now - entry.recordedAt <= PROMPT_USAGE_TTL_MS) break;
    promptUsage.delete(entryKey);
  }
  const prompt = usage.prompt ?? promptUsage.get(key)?.prompt;
  // Re-insert so the map stays ordered by time for the pruning above.
  promptUsage.delete(key);
  promptUsage.set(key, { cacheReadTokens: usage.cacheReadTokens, prompt, recordedAt: now });
}

/** Usage of the last provider call for this chat and model, if recent. */
export function getRecentPromptUsage(key: string, now = Date.now()): PromptUsage {
  const entry = promptUsage.get(key);
  return entry && now - entry.recordedAt <= PROMPT_USAGE_TTL_MS
    ? { cacheReadTokens: entry.cacheReadTokens, prompt: entry.prompt }
    : { cacheReadTokens: 0 };
}

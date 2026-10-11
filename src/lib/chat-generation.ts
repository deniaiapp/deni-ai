type ActiveGeneration = {
  generationId: string;
  abortController: AbortController;
};

const activeGenerations = new Map<string, ActiveGeneration>();

export function startChatGeneration(chatId: string, generationId: string) {
  activeGenerations.get(chatId)?.abortController.abort("replaced");

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

  activeGeneration.abortController.abort("stopped");
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
// itself once it registers. Per instance; another instance sees a stop only once
// the generation has registered, through the database ownership poll.
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
// estimated. The prompt cache reads the provider last reported for a chat show
// how much of that prompt it reads from cache, so the estimate bills that much
// at the cache-read weight instead of as uncached input. Per instance and kept
// only as long as a provider cache is commonly retained; without a recent
// report the estimate stays uncached.
const PROMPT_CACHE_READ_TTL_MS = 5 * 60_000;
const promptCacheReads = new Map<string, { tokens: number; recordedAt: number }>();

/** Record the cache reads of a finished provider call for this chat and model. */
export function recordPromptCacheReads(key: string, tokens: number, now = Date.now()) {
  for (const [entryKey, entry] of promptCacheReads) {
    if (now - entry.recordedAt <= PROMPT_CACHE_READ_TTL_MS) break;
    promptCacheReads.delete(entryKey);
  }
  // Re-insert so the map stays ordered by time for the pruning above.
  promptCacheReads.delete(key);
  promptCacheReads.set(key, { tokens, recordedAt: now });
}

/** Cache reads of the last provider call for this chat and model, if recent. */
export function getRecentPromptCacheReads(key: string, now = Date.now()) {
  const entry = promptCacheReads.get(key);
  return entry && now - entry.recordedAt <= PROMPT_CACHE_READ_TTL_MS ? entry.tokens : 0;
}

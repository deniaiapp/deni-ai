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
// itself once it registers. Per instance; a cross-instance stop relies on the
// request's own abort signal and the database ownership poll.
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

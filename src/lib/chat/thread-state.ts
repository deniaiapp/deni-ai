import type { UIMessage } from "ai";

const MAX_CACHED_THREADS = 100;

export function getThreadDraft(cache: Map<string, string>, threadId: string) {
  return cache.get(threadId) ?? "";
}

export function setThreadDraft(cache: Map<string, string>, threadId: string, value: string) {
  if (!value) {
    cache.delete(threadId);
    return;
  }
  cache.delete(threadId);
  cache.set(threadId, value);
  while (cache.size > MAX_CACHED_THREADS) cache.delete(cache.keys().next().value as string);
}

export function clearThreadDraft(cache: Map<string, string>, threadId: string) {
  cache.delete(threadId);
}

export function cacheThreadMessages(
  cache: Record<string, UIMessage[]>,
  threadId: string,
  messages: UIMessage[],
) {
  const next = { ...cache, [threadId]: messages };
  const keys = Object.keys(next);
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_CACHED_THREADS))) delete next[key];
  return next;
}

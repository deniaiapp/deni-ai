const CHAT_CREATION_RETRY_DELAY_MS = 1000;

/** Chats started on the client whose row is not confirmed yet, keyed by id. */
const chatCreations = new Map<string, () => Promise<boolean>>();
const listeners = new Set<() => void>();

function emitChatCreations() {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Persist a chat that was started on the client. /api/chat rejects messages for
 * a chat whose row does not exist, so sends wait on `ensureChatCreated`.
 */
export function trackChatCreation(
  id: string,
  create: () => Promise<unknown>,
  retryDelayMs = CHAT_CREATION_RETRY_DELAY_MS,
) {
  let attempt: Promise<boolean> | null = null;
  const run = () => {
    attempt ??= create()
      // One delayed retry covers a transient network or database failure.
      .catch(() =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, retryDelayMs);
        }).then(create),
      )
      .then(
        () => {
          chatCreations.delete(id);
          emitChatCreations();
          return true;
        },
        () => {
          // Let the next send try again instead of failing for good.
          attempt = null;
          return false;
        },
      );
    return attempt;
  };

  chatCreations.set(id, run);
  emitChatCreations();
  return run();
}

/**
 * Resolves true once a chat started with `trackChatCreation` exists, and right
 * away for any other chat. A creation that failed earlier is attempted again;
 * false means the chat still could not be created.
 */
export function ensureChatCreated(id: string): Promise<boolean> {
  return chatCreations.get(id)?.() ?? Promise.resolve(true);
}

/**
 * Whether a chat started with `trackChatCreation` has no confirmed row yet,
 * either still creating or after a failed creation. The server has nothing to
 * load for it, so its client-side page must not be replaced with a refetch.
 */
export function isChatCreationPending(id: string): boolean {
  return chatCreations.has(id);
}

/** Subscribe to changes of `isChatCreationPending`, e.g. for `useSyncExternalStore`. */
export function subscribeChatCreations(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

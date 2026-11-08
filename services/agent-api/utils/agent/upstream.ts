/**
 * Abort an upstream request when it stops making progress.
 *
 * The timeout is intentionally refreshed by streaming callers after each
 * received chunk. This protects the server from a provider that never sends
 * headers or goes silent, without imposing a fixed maximum duration on a
 * healthy long-running model response.
 */

const DEFAULT_UPSTREAM_TIMEOUT_MS = 120_000;

function parseTimeoutMs(raw: string | undefined): number {
  if (!raw) return DEFAULT_UPSTREAM_TIMEOUT_MS;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_UPSTREAM_TIMEOUT_MS;
  }

  return parsed;
}

export function getUpstreamTimeoutMs(): number {
  return parseTimeoutMs(process.env.FLIXA_UPSTREAM_TIMEOUT_MS);
}

export type UpstreamTimeout = {
  signal: AbortSignal;
  /** Refresh the timeout after upstream progress. */
  refresh: () => void;
  /** Abort the active upstream operation (for client disconnects). */
  abort: () => void;
  /** Stop the timer and detach the optional parent signal listener. */
  dispose: () => void;
};

/**
 * Create a timeout signal that can also be cancelled by a client disconnect.
 * A value of 0 disables the timeout while retaining parent-signal support.
 */
export function createUpstreamTimeout(
  parentSignal?: AbortSignal,
): UpstreamTimeout {
  const controller = new AbortController();
  const timeoutMs = getUpstreamTimeoutMs();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const armTimer = () => {
    clearTimer();
    if (
      disposed ||
      timeoutMs <= 0 ||
      controller.signal.aborted
    ) {
      return;
    }

    timer = setTimeout(() => {
      timer = undefined;
      controller.abort(
        new Error(`Upstream request timed out after ${timeoutMs}ms`),
      );
    }, timeoutMs);
  };

  const onParentAbort = () => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal?.reason);
    }
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      onParentAbort();
    } else {
      parentSignal.addEventListener("abort", onParentAbort, { once: true });
    }
  }

  armTimer();

  return {
    signal: controller.signal,
    refresh: armTimer,
    abort: () => {
      if (!controller.signal.aborted) controller.abort();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearTimer();
      parentSignal?.removeEventListener("abort", onParentAbort);
    },
  };
}

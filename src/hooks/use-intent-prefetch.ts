import { useEffect, useRef } from "react";

/**
 * How long the pointer (or keyboard focus) has to rest on a link before it is
 * preloaded. Long enough that sweeping across a list preloads nothing, short
 * enough that a deliberate hover is still warm by the time the user clicks.
 */
export const INTENT_PREFETCH_DELAY_MS = 200;

/**
 * Event handlers that run `prefetch` once the user lingers on an element or is
 * about to open it: after `delayMs` of hover/focus (cancelled on leave/blur), or
 * immediately on pointer down. Pass the same delay to the element's router link
 * (`prefetchDelay`) so the route preload and the data prefetch fire together.
 *
 * @param prefetch - Warms the target's data; should dedupe repeat calls itself
 *   (e.g. a React Query `prefetch` that skips fresh or in-flight queries)
 * @param delayMs - Hover/focus dwell time before prefetching
 * @returns Handlers to spread onto the link element
 */
export function useIntentPrefetch(prefetch: () => void, delayMs = INTENT_PREFETCH_DELAY_MS) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function cancel() {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = undefined;
  }

  function schedule() {
    if (timeoutRef.current !== undefined) return;
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = undefined;
      prefetch();
    }, delayMs);
  }

  function prefetchNow() {
    cancel();
    prefetch();
  }

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  return {
    onMouseEnter: schedule,
    onMouseLeave: cancel,
    onFocus: schedule,
    onBlur: cancel,
    onPointerDown: prefetchNow,
  };
}

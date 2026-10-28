import { isSessionNotFreshError } from "@/lib/auth-error-utils";
import { useRef, useState } from "react";

/**
 * Detects better-auth's `SESSION_NOT_FRESH` error and coordinates showing a
 * re-authentication dialog, then retrying the original action once the
 * user's session becomes fresh again.
 *
 * Usage:
 * - For a query (e.g. `useListSessions`), call `guard(error, refetch)` from
 *   an effect that watches the query's `error`.
 * - For a mutation, call `guard(error, () => mutate(sameVariables))` from
 *   its `onError` handler.
 *
 * Render `<FreshSessionDialog open={open} onOpenChange={setOpen}
 * onVerified={handleVerified} />` alongside the guarded call site.
 */
export function useFreshSessionGuard() {
  const [open, setOpen] = useState(false);
  const retryRef = useRef<(() => void) | null>(null);

  function guard(error: unknown, retry?: () => void) {
    if (!isSessionNotFreshError(error)) return false;

    retryRef.current = retry ?? null;
    setOpen(true);
    return true;
  }

  function handleVerified() {
    setOpen(false);
    const retry = retryRef.current;
    retryRef.current = null;
    retry?.();
  }

  return { open, setOpen, guard, handleVerified };
}

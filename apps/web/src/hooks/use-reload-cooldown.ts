import { useEffect, useState } from "react";

/** Seconds a reload button stays disabled after firing, to prevent spamming the endpoint. */
export const DEFAULT_RELOAD_COOLDOWN_SECONDS = 5;

/**
 * Wrap a refetch-style action so a "reload" button can't be spam-clicked: the
 * action is ignored while it is already in flight, and again for a short
 * cooldown window after it settles.
 *
 * @param action - The refetch to run, e.g. `() => query.refetch()`
 * @param cooldownSeconds - How long to disable further reloads after one completes
 * @returns `reload` to call from the button's onClick, `isReloading` while the
 *   action itself is in flight, and `isCoolingDown` while spam-clicks are blocked
 */
export function useReloadCooldown(
  action: () => Promise<unknown> | unknown,
  cooldownSeconds = DEFAULT_RELOAD_COOLDOWN_SECONDS,
) {
  const [cooldown, setCooldown] = useState(0);
  const [isReloading, setIsReloading] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const interval = setInterval(() => {
      setCooldown((current) => (current > 0 ? current - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [cooldown]);

  function reload() {
    if (isReloading || cooldown > 0) return;
    setIsReloading(true);
    Promise.resolve(action())
      .catch(() => {
        // Surfacing failures is the caller's responsibility (e.g. via toast in
        // the underlying query); this hook only tracks in-flight/cooldown state.
      })
      .finally(() => {
        setIsReloading(false);
        setCooldown(cooldownSeconds);
      });
  }

  return { reload, isReloading, isCoolingDown: cooldown > 0 };
}

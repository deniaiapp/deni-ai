/**
 * Errors thrown when a tab opened before a redeploy requests chunks or module
 * factories that no longer exist on the server. A full reload fixes them.
 */
const STALE_DEPLOYMENT_PATTERNS = [
  // Chromium, Firefox and Safari wording for a failed dynamic import().
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
];

const RELOAD_GUARD_KEY = "deni-ai:stale-deployment-reload";
/** Skip auto-reload if one already happened recently, so a real bug cannot loop. */
const RELOAD_GUARD_MS = 60_000;

let reloadStarted = false;

/** True once this page has started a stale-deployment reload. */
export function isStaleDeploymentReloadStarted(): boolean {
  return reloadStarted;
}

export function isStaleDeploymentError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const text = `${error.name}: ${error.message}`;
  return STALE_DEPLOYMENT_PATTERNS.some((pattern) => pattern.test(text));
}

/** Reloads the page once per guard window. Returns true when a reload was started. */
export function reloadForStaleDeployment(): boolean {
  try {
    const lastReload = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
    if (Date.now() - lastReload < RELOAD_GUARD_MS) {
      return false;
    }
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // Storage unavailable (private mode, blocked): reloading without a guard could loop.
    return false;
  }
  reloadStarted = true;
  window.location.reload();
  return true;
}

/**
 * Vite fires `vite:preloadError` when a lazily loaded route chunk (or its CSS) can no
 * longer be fetched, typically because a redeploy removed it. Reload once instead of
 * letting the import throw into an error page and an error report.
 */
export function installStaleDeploymentReload() {
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadForStaleDeployment()) event.preventDefault();
  });
}

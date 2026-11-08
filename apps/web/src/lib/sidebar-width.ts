/**
 * User-resizable desktop sidebar width.
 *
 * The width lives in a CSS variable on <html> (`--app-sidebar-width`), which
 * AppShell feeds into `--sidebar-width`. A boot script in the root layout
 * restores it from localStorage before first paint, so there is no flash or
 * hydration mismatch and no React state is needed while dragging.
 */
export const SIDEBAR_WIDTH_STORAGE_KEY = "sidebar_width";
export const SIDEBAR_WIDTH_CSS_VAR = "--app-sidebar-width";
export const SIDEBAR_WIDTH_DEFAULT = 272;
export const SIDEBAR_WIDTH_MIN = 224;
export const SIDEBAR_WIDTH_MAX = 480;
/** Keep the chat pane usable on narrow desktop windows. */
const SIDEBAR_WIDTH_MAX_VIEWPORT_RATIO = 0.5;

/** Restores the stored width before first paint; kept in sync with the helpers below. */
export const SIDEBAR_WIDTH_BOOT_SCRIPT = `(function(){try{var w=Number(localStorage.getItem(${JSON.stringify(SIDEBAR_WIDTH_STORAGE_KEY)}));if(w>=${SIDEBAR_WIDTH_MIN}&&w<=${SIDEBAR_WIDTH_MAX})document.documentElement.style.setProperty(${JSON.stringify(SIDEBAR_WIDTH_CSS_VAR)},w+"px");}catch(e){}})();`;

export function clampSidebarWidth(width: number) {
  const viewportMax = Math.floor(window.innerWidth * SIDEBAR_WIDTH_MAX_VIEWPORT_RATIO);
  const max = Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, viewportMax));
  return Math.round(Math.min(Math.max(width, SIDEBAR_WIDTH_MIN), max));
}

const listeners = new Set<() => void>();

export function subscribeSidebarWidth(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSidebarWidth() {
  const value = Number.parseFloat(
    document.documentElement.style.getPropertyValue(SIDEBAR_WIDTH_CSS_VAR),
  );
  return Number.isFinite(value) ? value : SIDEBAR_WIDTH_DEFAULT;
}

export function getServerSidebarWidth() {
  return SIDEBAR_WIDTH_DEFAULT;
}

/** Applies a width (or `null` to reset to the default) without persisting it. */
export function setSidebarWidth(width: number | null) {
  const { style } = document.documentElement;
  if (width === null) {
    style.removeProperty(SIDEBAR_WIDTH_CSS_VAR);
  } else {
    style.setProperty(SIDEBAR_WIDTH_CSS_VAR, `${width}px`);
  }
  for (const listener of listeners) {
    listener();
  }
}

export function persistSidebarWidth(width: number | null) {
  try {
    if (width === null || width === SIDEBAR_WIDTH_DEFAULT) {
      localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY);
    } else {
      localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
    }
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
  }
}

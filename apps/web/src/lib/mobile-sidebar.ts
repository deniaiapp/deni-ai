/**
 * On mobile the sidebar is a sheet over the page, so picking a destination in
 * it (a conversation, settings, any other link) should close it. The sidebar
 * listens for clicks on its content and asks `closesMobileSidebar()` whether
 * the click chose a link. Clicks from its dropdown menus count too: React
 * events bubble through portals.
 */

/** Opts links out, e.g. the chat/Run switch, which only swaps the sidebar's content. */
export const SIDEBAR_KEEP_OPEN_ATTRIBUTE = "data-sidebar-keep-open";

type ElementLike = {
  closest(selector: string): ElementLike | null;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
};

export type SidebarClick = {
  target: EventTarget | null;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

function isElementLike(value: unknown): value is ElementLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<ElementLike>).closest === "function"
  );
}

export function closesMobileSidebar(event: SidebarClick): boolean {
  // Modified clicks open the link elsewhere (new tab or window); stay put.
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  if (!isElementLike(event.target)) {
    return false;
  }

  const link = event.target.closest("a[href]");
  if (!link) {
    return false;
  }
  if (link.getAttribute("aria-disabled") === "true" || link.hasAttribute("data-disabled")) {
    return false;
  }
  return link.closest(`[${SIDEBAR_KEEP_OPEN_ATTRIBUTE}]`) === null;
}

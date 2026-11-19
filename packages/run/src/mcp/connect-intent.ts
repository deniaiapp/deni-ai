import { mcpCatalogEntry } from "./catalog";

/**
 * A connector a signed-out visitor asked to add (from an "Add to Slack" link, for example).
 * Sign-in and two-factor steps all end on "/", so the request waits in this browser until the
 * workspace opens and starts the connection. It expires so a stale click never fires later.
 */
const key = "deni:pending-connect";
const maxAgeMs = 30 * 60_000;

/** The catalog id when it names a known connector, otherwise null. */
export function connectorId(value: unknown) {
  return typeof value === "string" && mcpCatalogEntry(value) ? value : null;
}

export function savePendingConnect(catalogId: string) {
  if (!connectorId(catalogId)) return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ catalogId, at: Date.now() }));
  } catch {
    // Storage can be unavailable; the visitor can still connect from Plugins.
  }
}

/** Returns the pending connector once and forgets it. */
export function takePendingConnect() {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    window.localStorage.removeItem(key);
    const parsed = JSON.parse(raw) as { catalogId?: unknown; at?: unknown };
    if (typeof parsed.at !== "number" || Date.now() - parsed.at > maxAgeMs) return null;
    return connectorId(parsed.catalogId);
  } catch {
    return null;
  }
}

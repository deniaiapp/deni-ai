"use client";

import { useEffect } from "react";

export const APP_NAME = "Deni AI";

/**
 * Sets document.title for client-driven routes (chat host, settings) where
 * metadata can't be per-request localized under cacheComponents.
 * Pass no `title` for the bare app name; otherwise renders "{title} | Deni AI".
 */
export function DocumentTitle({ title }: { title?: string | null }) {
  const trimmed = title?.trim();
  const next = trimmed ? `${trimmed} | ${APP_NAME}` : APP_NAME;

  useEffect(() => {
    const previous = document.title;
    const apply = () => {
      if (document.title !== next) {
        document.title = next;
      }
    };
    apply();
    // Client navigations re-insert the route's metadata <title> after this
    // effect runs; reapply before paint so the default title never shows.
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (document.title === next) {
        document.title = previous;
      }
    };
  }, [next]);

  return null;
}

import { useEffect, useRef } from "react";
import { createTitleStack, type TitleEntry } from "@/lib/document-title-stack";

export const APP_NAME = "Deni AI";

let titleStack: ReturnType<typeof createTitleStack> | null = null;

function getTitleStack() {
  titleStack ??= createTitleStack(document, MutationObserver);
  return titleStack;
}

/**
 * Sets document.title for client-driven routes (chat host, settings) whose
 * title depends on client data rather than the route `head`.
 * Pass no `title` for the bare app name; otherwise renders "{title} | Deni AI".
 * When several are mounted (e.g. the previous page while the next route loads),
 * the most recently mounted one sets the title.
 */
export function DocumentTitle({ title }: { title?: string | null }) {
  const trimmed = title?.trim();
  const next = trimmed ? `${trimmed} | ${APP_NAME}` : APP_NAME;
  const entryRef = useRef<TitleEntry | null>(null);
  const titleRef = useRef(next);

  // Mount order decides which title wins, so a title change keeps the entry.
  useEffect(() => {
    const stack = getTitleStack();
    const entry = stack.push(titleRef.current);
    entryRef.current = entry;
    return () => {
      entryRef.current = null;
      stack.remove(entry);
    };
  }, []);

  useEffect(() => {
    titleRef.current = next;
    if (entryRef.current) getTitleStack().update(entryRef.current, next);
  }, [next]);

  return null;
}

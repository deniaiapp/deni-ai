import { useSyncExternalStore } from "react";
import { type VisualLayout, visualLayouts } from "@/lib/intelligent-ui/prompt";

const STORAGE_KEY = "deni-visual-layout";
const VISUAL_LAYOUT_EVENT = "deni:visual-layout";
const DEFAULT_VISUAL_LAYOUT: VisualLayout = "rich";

/** Blocked site data makes `localStorage` throw; keep the choice for this page instead. */
let unpersistedLayout: VisualLayout | null = null;

const isVisualLayout = (value: unknown): value is VisualLayout =>
  visualLayouts.includes(value as VisualLayout);

function subscribeVisualLayout(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(VISUAL_LAYOUT_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(VISUAL_LAYOUT_EVENT, onStoreChange);
  };
}

/** The Intelligent UI layout preference sent with each chat request. */
export function getVisualLayout(): VisualLayout {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isVisualLayout(stored) ? stored : DEFAULT_VISUAL_LAYOUT;
  } catch {
    return unpersistedLayout ?? DEFAULT_VISUAL_LAYOUT;
  }
}

export function setVisualLayout(value: VisualLayout) {
  unpersistedLayout = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Keep the in-memory choice when it cannot be persisted.
  }
  window.dispatchEvent(new Event(VISUAL_LAYOUT_EVENT));
}

export function useVisualLayout() {
  return useSyncExternalStore(subscribeVisualLayout, getVisualLayout, () => DEFAULT_VISUAL_LAYOUT);
}

"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "deni-preferred-model";
const PREFERRED_MODEL_EVENT = "deni:preferred-model";

/**
 * Blocked site data makes `localStorage` access throw, and the snapshot is read
 * during render. Fall back to an in-memory choice so a model picked while
 * storage is unavailable still lasts for this page.
 */
let unpersistedModel: string | null = null;

function subscribePreferredModel(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(PREFERRED_MODEL_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(PREFERRED_MODEL_EVENT, onStoreChange);
  };
}

function getPreferredModelSnapshot(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return unpersistedModel;
  }
}

function getServerPreferredModelSnapshot(): string | null {
  return null;
}

export function setPreferredModel(value: string) {
  unpersistedModel = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Keep the in-memory choice when it cannot be persisted.
  }
  window.dispatchEvent(new Event(PREFERRED_MODEL_EVENT));
}

/**
 * The model the user last picked in the composer, or null before any pick.
 * Callers must still check that it is available on the current plan.
 */
export function usePreferredModel() {
  return useSyncExternalStore(
    subscribePreferredModel,
    getPreferredModelSnapshot,
    getServerPreferredModelSnapshot,
  );
}

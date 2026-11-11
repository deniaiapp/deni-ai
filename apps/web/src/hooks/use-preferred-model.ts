import { useEffect, useSyncExternalStore } from "react";
import { makeTRPCClient } from "@/lib/trpc/client";
import { trpc } from "@/lib/trpc/react";

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

function storePreferredModel(value: string) {
  unpersistedModel = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Keep the in-memory choice when it cannot be persisted.
  }
  window.dispatchEvent(new Event(PREFERRED_MODEL_EVENT));
}

/** Saves a model to the account (`user_preference`); a failure keeps the local pick. */
function savePreferredModel(value: string) {
  makeTRPCClient()
    .preferences.setPreferredModel.mutate({ model: value })
    .catch((error: unknown) => console.warn("Failed to save the preferred model", error));
}

/**
 * Remember the model picked in the composer: in this browser right away, and on
 * the account so other browsers and devices start new chats with it too.
 */
export function setPreferredModel(value: string) {
  storePreferredModel(value);
  savePreferredModel(value);
}

/**
 * Keeps this browser's cached pick in line with the account: the account's model
 * wins when it differs, and a pick made before it was saved to the account (this
 * browser only) is uploaded once. Mount once in the signed-in app shell.
 */
export function usePreferredModelSync() {
  const { data } = trpc.preferences.get.useQuery(undefined, { staleTime: Infinity });
  const saved = data?.preferredModel;
  useEffect(() => {
    if (data === undefined) return;
    const local = getPreferredModelSnapshot();
    if (saved) {
      if (saved !== local) storePreferredModel(saved);
    } else if (local) {
      savePreferredModel(local);
    }
  }, [data, saved]);
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

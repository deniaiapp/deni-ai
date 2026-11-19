import { forgetStorageKey, primeStorageKey } from "@deniai/run/data/paths";
import { deleteAllUserStorage, hasObjectStorage } from "@deniai/run/data/storage";
import { ensureRunConfigured } from "@/lib/run/runtime.server";

/**
 * Users whose `run_settings.storage_key` was primed before Better Auth cascades
 * their `run_settings` row away during account deletion.
 */
const primedUsers = new Set<string>();

/**
 * Better Auth `databaseHooks.user.delete` steps for Run workspace and screenshot
 * storage. Migrated accounts can keep a legacy `storage_key` in `run_settings`
 * pointing at their old Run user prefix, so `before` primes it while the row
 * still exists and `after` purges objects once the user row is deleted. Neither
 * step throws: storage cleanup must never block account deletion.
 */
export const accountDeletionRunHooks = {
  before: async (user: { id: string }) => {
    try {
      if (!ensureRunConfigured().ok || !hasObjectStorage()) return;
      await primeStorageKey(user.id);
      primedUsers.add(user.id);
    } catch (error) {
      console.error("[run] Failed to prime Run storage key before account deletion", error);
    }
  },
  after: async (user: { id: string }) => {
    const primed = primedUsers.delete(user.id);
    try {
      if (!primed || !ensureRunConfigured().ok || !hasObjectStorage()) return;
      await deleteAllUserStorage(user.id);
    } catch (error) {
      console.error("[run] Failed to delete Run storage objects after account deletion", error);
    } finally {
      forgetStorageKey(user.id);
    }
  },
};

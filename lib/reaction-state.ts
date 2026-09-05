import { updateReactions } from "./message-actions";

export type ReactionMap = Record<string, string[]>;
type Pending = { messageId: string; emoji: string; selected: boolean; version: number };

/** Optimistic display with per-message ordered writes and rollback to confirmed state. */
export function createReactionState(
  save: (messageId: string, emoji: string, selected: boolean) => Promise<ReactionMap>,
  initial: ReactionMap = {},
) {
  let confirmed = { ...initial };
  let snapshot = confirmed;
  let revision = 0;
  const pending = new Map<string, Pending>();
  const queues = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();

  function publish() {
    snapshot = { ...confirmed };
    for (const operation of pending.values()) {
      snapshot[operation.messageId] = updateReactions(snapshot[operation.messageId] ?? [], operation.emoji, operation.selected);
    }
    listeners.forEach((listener) => listener());
  }

  return {
    getSnapshot: () => snapshot,
    getRevision: () => revision,
    hasPending: () => pending.size > 0,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    hydrate(value: ReactionMap, startedAt: number) {
      if (startedAt !== revision || pending.size) return;
      confirmed = { ...value };
      publish();
    },
    toggle(messageId: string, emoji: string, selected: boolean): Promise<void> {
      const key = JSON.stringify([messageId, emoji]);
      const version = ++revision;
      pending.set(key, { messageId, emoji, selected, version });
      publish();
      const previous = queues.get(messageId) ?? Promise.resolve();
      const task = previous.then(async () => {
        let error: unknown;
        try {
          const result = await save(messageId, emoji, selected);
          confirmed = { ...confirmed, [messageId]: updateReactions(confirmed[messageId] ?? [], emoji, result[messageId]?.includes(emoji) ?? false) };
        } catch (cause) { error = cause; }
        const latest = pending.get(key)?.version === version;
        if (latest) pending.delete(key);
        ++revision;
        publish();
        if (error && latest) throw error;
      });
      const settled = task.then(() => undefined, () => undefined);
      queues.set(messageId, settled);
      void settled.then(() => { if (queues.get(messageId) === settled) queues.delete(messageId); });
      return task;
    },
  };
}

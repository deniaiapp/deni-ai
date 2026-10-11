import "server-only";

import { createId } from "./ids";
import { hasActiveThreadJob } from "./jobs";
import { contextResetMessage, isContextReset } from "./messages";
import { loadMessages, readStore, saveMessages } from "./store";

export type ThreadResetResult = "reset" | "unchanged" | "busy" | "missing";

/**
 * Start the conversation over for the model without deleting anything: a divider is stored
 * after the last message, and later turns only send what follows it. Refused while a task is
 * running or waiting, so its reply cannot land on the wrong side of the divider.
 */
export async function resetThreadContext(userId: string, threadId: string): Promise<ThreadResetResult> {
  const store = await readStore(userId);
  if (!store.threads.some((thread) => thread.id === threadId)) return "missing";
  if (await hasActiveThreadJob(userId, threadId)) return "busy";
  const last = (await loadMessages(userId, threadId, { clone: false })).at(-1);
  if (!last || isContextReset(last)) return "unchanged";
  await saveMessages(userId, threadId, [contextResetMessage(createId("reset"))]);
  return "reset";
}

import "server-only";

import { pendingBrowserMs } from "./computer";
import { pendingComputerMs } from "./sandbox";
import type { Store } from "./types";
import { usageSnapshot } from "./usage";

export function liveUsageSnapshot(store: Store, userId: string) {
  return usageSnapshot(store, {
    pendingBrowserMs: pendingBrowserMs(userId),
    pendingComputerMs: pendingComputerMs(userId),
  });
}

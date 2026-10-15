import "@tanstack/react-start/server-only";

import { rm } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user, verification } from "@/db/auth-schema";
import { cancelUserSubscription } from "./billing";
import { releaseBrowser, stopSandbox } from "./computer";
import { userDataDir } from "./paths";
import { deleteUserRecords, loadAllMessages, readStore } from "./store";
import { deleteAllUserStorage } from "./storage";
import { listArtifacts } from "./artifacts";
import { listJobs } from "./jobs";
import { listMcpConnections } from "./mcp";
import { listNotifications } from "./notifications";

export async function exportAccount(userId: string) {
  const store = await readStore(userId);
  const threads = await loadAllMessages(userId);
  const [jobs, artifacts, notifications, mcpConnections] = await Promise.all([
    listJobs(userId),
    listArtifacts(userId),
    listNotifications(userId),
    listMcpConnections(userId),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    store: {
      ...store,
      config: { ...store.config, apiKey: store.config.apiKey ? "[redacted]" : "" },
    },
    messages: threads,
    jobs,
    artifacts,
    notifications,
    mcpConnections,
  };
}

export async function deleteAccount(userId: string) {
  await cancelUserSubscription(userId);
  await stopSandbox(userId).catch(() => undefined);
  await releaseBrowser(userId, undefined, { all: true }).catch(() => undefined);
  await deleteAllUserStorage(userId).catch(() => undefined);
  await rm(userDataDir(userId), { recursive: true, force: true }).catch(() => undefined);
  await deleteUserRecords(userId);
  const [authUser] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId));
  if (authUser?.email) {
    await db.delete(verification).where(eq(verification.identifier, authUser.email));
  }
  await db.delete(user).where(eq(user.id, userId));
}

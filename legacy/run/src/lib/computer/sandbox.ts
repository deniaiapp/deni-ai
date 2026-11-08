import "@tanstack/react-start/server-only";

import { Sandbox } from "e2b";
import { mutateStore, readStore } from "../data/store";
import { assertCanStartComputer, isComputerLimitReached, recordTimeUsage } from "../billing/usage";

type UserSandbox = {
  sandbox: Sandbox;
  idleTimer?: ReturnType<typeof setTimeout>;
  startedAt: number;
  lastBilledAt: number;
};

const g = globalThis as typeof globalThis & {
  __deniSandboxes?: Map<string, Promise<UserSandbox>>;
  __deniSandboxBilledAt?: Map<string, number>;
};

function sandboxes() {
  if (!g.__deniSandboxes) g.__deniSandboxes = new Map();
  return g.__deniSandboxes;
}

function sandboxBilledAt() {
  if (!g.__deniSandboxBilledAt) g.__deniSandboxBilledAt = new Map();
  return g.__deniSandboxBilledAt;
}

export function pendingComputerMs(userId: string) {
  if (!sandboxes().has(userId)) return 0;
  const at = sandboxBilledAt().get(userId);
  if (at == null) return 0;
  return Math.max(0, Date.now() - at);
}

export function hasE2B() {
  return Boolean(process.env.E2B_API_KEY);
}

function sandboxTimeoutMs() {
  return Number(process.env.E2B_SANDBOX_TIMEOUT_MS ?? 600_000);
}

async function billSandboxTime(
  userId: string,
  handle: UserSandbox,
  opts?: { minDeltaMs?: number },
) {
  const now = Date.now();
  const previous = handle.lastBilledAt || handle.startedAt || now;
  const delta = now - previous;
  if (delta <= 0) return;
  if (opts?.minDeltaMs && delta < opts.minDeltaMs) return;
  handle.lastBilledAt = now;
  sandboxBilledAt().set(userId, now);
  await recordTimeUsage(userId, "computer", delta);
}

export function hasUserSandbox(userId: string) {
  return sandboxes().has(userId);
}

export async function billLiveSandbox(userId: string) {
  const existing = sandboxes().get(userId);
  if (!existing) return;
  const handle = await existing.catch(() => null);
  if (!handle) return;
  await billSandboxTime(userId, handle, { minDeltaMs: 5_000 });
  if (await isComputerLimitReached(userId, pendingComputerMs(userId))) {
    await stopUserSandbox(userId);
  }
}

export async function billUserSandbox(userId: string) {
  const existing = sandboxes().get(userId);
  if (!existing) return;
  const handle = await existing.catch(() => null);
  if (!handle) return;
  await billSandboxTime(userId, handle);
}

export async function getUserSandbox(userId: string) {
  const existing = sandboxes().get(userId);
  if (existing) {
    const handle = await existing;
    await billSandboxTime(userId, handle);
    if (await isComputerLimitReached(userId)) {
      await stopUserSandbox(userId);
    }
    await assertCanStartComputer(userId);
    touchSandbox(userId, handle);
    return handle.sandbox;
  }

  await assertCanStartComputer(userId);
  const promise = createUserSandbox(userId);
  sandboxes().set(userId, promise);
  try {
    const handle = await promise;
    if (sandboxes().get(userId) !== promise) {
      await handle.sandbox.pause({ keepMemory: false }).catch(() => undefined);
      throw new Error("Sandbox was stopped");
    }
    touchSandbox(userId, handle);
    return handle.sandbox;
  } catch (error) {
    if (sandboxes().get(userId) === promise) sandboxes().delete(userId);
    throw error;
  }
}

export async function stopUserSandbox(userId: string) {
  const promise = sandboxes().get(userId);
  if (promise) sandboxes().delete(userId);

  if (promise) {
    const handle = await promise.catch(() => null);
    if (handle) {
      if (handle.idleTimer) clearTimeout(handle.idleTimer);
      await billSandboxTime(userId, handle).catch(() => undefined);
      sandboxBilledAt().delete(userId);
      await handle.sandbox.pause({ keepMemory: false }).catch(() => undefined);
      return { stopped: true as const };
    }
  }
  sandboxBilledAt().delete(userId);

  const store = await readStore(userId);
  const sandboxId = store.computer.e2bSandboxId;
  if (!sandboxId) return { stopped: false as const, reason: "already stopped" };

  const paused = await Sandbox.pause(sandboxId, { keepMemory: false }).catch(() => false);
  return paused
    ? { stopped: true as const }
    : { stopped: false as const, reason: "already stopped" };
}

async function createUserSandbox(userId: string): Promise<UserSandbox> {
  const store = await readStore(userId);
  const timeoutMs = sandboxTimeoutMs();
  let sandbox: Sandbox;

  if (store.computer.e2bSandboxId) {
    try {
      sandbox = await Sandbox.connect(store.computer.e2bSandboxId, { timeoutMs });
      const now = Date.now();
      sandboxBilledAt().set(userId, now);
      return { sandbox, startedAt: now, lastBilledAt: now };
    } catch {
      // The old sandbox may have been killed or expired. Create a replacement.
    }
  }

  sandbox = await Sandbox.create({
    timeoutMs,
    lifecycle: {
      onTimeout: "pause",
      autoResume: false,
    },
  });
  await mutateStore(userId, (next) => {
    next.computer.e2bSandboxId = sandbox.sandboxId;
  });
  const now = Date.now();
  sandboxBilledAt().set(userId, now);
  return { sandbox, startedAt: now, lastBilledAt: now };
}

function touchSandbox(userId: string, handle: UserSandbox) {
  if (handle.idleTimer) clearTimeout(handle.idleTimer);
  handle.sandbox.setTimeout(sandboxTimeoutMs()).catch(() => undefined);
  const idleMs = Number(process.env.E2B_SANDBOX_IDLE_MS ?? 600_000);
  handle.idleTimer = setTimeout(() => {
    stopUserSandbox(userId).catch(() => undefined);
  }, idleMs);
}

import "server-only";

import Steel from "steel-sdk";
import { exec } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Browser, BrowserContext, Page } from "playwright";
import { mutateStore, readStore } from "./store";
import { emitComputer, lastComputer, listShells, pushShell } from "./events";
import { userBrowserDir, userScreenPath } from "./paths";
import { getUserObject, hasObjectStorage, putUserObject } from "./storage";
import {
  billUserSandbox,
  getUserSandbox,
  hasE2B,
  hasUserSandbox,
  stopUserSandbox,
} from "./sandbox";
import {
  collectWorkspaceFiles,
  deleteWorkspaceContents,
  deleteWorkspacePath,
  deleteWorkspacePaths,
  listWorkspace,
  makeWorkspaceDir,
  prepareCommandWorkspace,
  readWorkspaceBytes,
  readWorkspaceFile,
  syncCommandWorkspace,
  writeWorkspaceFile,
} from "./workspace";
import type { ComputerState, ShellRecord } from "./types";
import { createId, nowIso } from "./ids";
import { assertCanStartBrowser, consumeUsage, isBrowserLimitReached } from "./usage";

const execAsync = promisify(exec);
const VIEWPORT = { width: 1280, height: 800 };
const DANGEROUS = [
  /\b(sudo|doas|pkexec|su)\b/i,
  /\b(shutdown|poweroff|reboot|halt|init\s+0|init\s+6)\b/i,
  /\b(Stop-Computer|Restart-Computer|Stop-Process)\b/i,
  /\b(mkfs|diskpart|fdisk|parted|format)\b/i,
  /\bdd\b/i,
  /\b(rm|rmdir)\s+(-[a-zA-Z]*r|--recursive)/i,
  /rm\s+-rf\s+[\\/]/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\s*;\s*\}/,
  /\b(chmod|chown|chgrp)\b/i,
  /\b(iptables|nft|ufw|firewall-cmd)\b/i,
  /\b(systemctl|service|launchctl)\b/i,
  /\b(mount|umount|losetup)\b/i,
  /\b(crontab|atd|schtasks)\b/i,
  /\b(docker|podman|kubectl|nsenter)\b/i,
  /\b(nc|ncat|netcat)\b.*\s(-e|-c)\b/i,
  /\/dev\/tcp\b/i,
  /\b(curl|wget|fetch)\b.*\|\s*(sh|bash|zsh|python|perl|ruby|node)\b/i,
  /\b(bash|sh|zsh|python|perl|ruby|node|pwsh|powershell)\s+[-\/]c\b/i,
  /\beval\b/i,
  /\bbase64\b.*\|\s*(sh|bash)/i,
  /\b(reg\s+delete|bcdedit)\b/i,
  /Remove-Item\s+.*(-Recurse|-r)/i,
  /\b(ssh-keygen|authorized_keys)\b/i,
  />\s*~\/\.ssh\b/i,
];

export function commandNeedsApproval(command: string) {
  const text = command.trim();
  if (!text) return true;
  return DANGEROUS.some((pattern) => pattern.test(text));
}

export function assertBrowserUrl(url: string) {
  const target = url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`;
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  return parsed.toString();
}

type BrowserSession = {
  browser?: Browser;
  context: BrowserContext;
  page: Page;
  steel?: Steel;
  steelSessionId?: string;
  idleTimer?: ReturnType<typeof setTimeout>;
  closed?: boolean;
  startedAt: number;
  lastBilledAt: number;
};

const g = globalThis as typeof globalThis & {
  __deniBrowsers?: Map<string, Promise<BrowserSession>>;
  __deniBrowserBilledAt?: Map<string, number>;
  __deniScreenshots?: Map<string, Buffer>;
  __deniScreenshotWrites?: Map<string, Promise<void>>;
};

function browserSessions() {
  if (!g.__deniBrowsers) g.__deniBrowsers = new Map();
  return g.__deniBrowsers;
}

function browserBilledAt() {
  if (!g.__deniBrowserBilledAt) g.__deniBrowserBilledAt = new Map();
  return g.__deniBrowserBilledAt;
}

export function pendingBrowserMs(userId: string) {
  if (!browserSessions().has(userId)) return 0;
  const at = browserBilledAt().get(userId);
  if (at == null) return 0;
  return Math.max(0, Date.now() - at);
}

function screenshotCache() {
  if (!g.__deniScreenshots) g.__deniScreenshots = new Map();
  return g.__deniScreenshots;
}

function screenshotWrites() {
  if (!g.__deniScreenshotWrites) g.__deniScreenshotWrites = new Map();
  return g.__deniScreenshotWrites;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Screenshot storage timed out")), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function persistScreenshot(userId: string, image: Buffer, remoteStorage: boolean) {
  const writes = screenshotWrites();
  const previous = writes.get(userId) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(async () => {
      if (remoteStorage) {
        await withTimeout(putUserObject(userId, "computer/screen.png", image, "image/png"), 4_000);
        return;
      }
      const target = userScreenPath(userId);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, image);
    });
  writes.set(userId, current);
  void current.catch((error) =>
    setComputer(userId, {
      lastError: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined),
  );
  void current
    .finally(() => {
      if (writes.get(userId) === current) writes.delete(userId);
    })
    .catch(() => undefined);
}

export function computerSnapshot(partial?: Partial<ComputerState>): ComputerState {
  return {
    status: "idle",
    workingBotId: null,
    workingLabel: "",
    url: null,
    title: null,
    lastCommand: null,
    lastError: null,
    screenshotAt: null,
    e2bSandboxId: null,
    steelSessionId: null,
    steelProfileId: null,
    steelDebugUrl: null,
    activity: [],
    ...partial,
  };
}

export async function setComputer(
  userId: string,
  patch: Partial<ComputerState> & {
    activityTitle?: string;
    activityDetail?: string;
    activityKind?: ComputerState["activity"][number]["kind"];
    botId?: string | null;
  },
) {
  const state = await mutateStore(userId, (store) => {
    if (patch.activityTitle) {
      store.computer.activity.unshift({
        at: nowIso(),
        botId: patch.botId ?? store.computer.workingBotId,
        kind: patch.activityKind ?? "system",
        title: patch.activityTitle,
        detail: patch.activityDetail ?? "",
      });
    }
    const { activityTitle: _title, activityDetail: _detail, activityKind: _kind, botId, ...rest } =
      patch;
    Object.assign(store.computer, rest);
    if (botId !== undefined && rest.workingBotId === undefined) {
      store.computer.workingBotId = botId;
    }
    return store.computer;
  });
  emitComputer(userId, state);
  return state;
}

export function hasBrowserSession(userId: string) {
  return browserSessions().has(userId);
}

export async function billLiveBrowser(userId: string) {
  await getExistingBrowserSession(userId);
}

export function withBrowserLive(userId: string, computer: ComputerState): ComputerState {
  return {
    ...computer,
    browserLive: hasBrowserSession(userId) || Boolean(computer.steelSessionId),
    sandboxLive: hasUserSandbox(userId) || Boolean(computer.e2bSandboxId),
  };
}

function steelClient() {
  const steelApiKey = process.env.STEEL_API_KEY;
  if (!steelApiKey) return null;
  return {
    apiKey: steelApiKey,
    steel: new Steel({
      steelAPIKey: steelApiKey,
      baseURL: process.env.STEEL_BASE_URL || "https://api.steel.dev",
    }),
  };
}

function steelWebsocketUrl(session: { id: string; websocketUrl?: string }, apiKey: string) {
  if (!session.websocketUrl) {
    return `wss://connect.steel.dev?apiKey=${encodeURIComponent(apiKey)}&sessionId=${session.id}`;
  }
  const join = session.websocketUrl.includes("?") ? "&" : "?";
  return `${session.websocketUrl}${join}apiKey=${encodeURIComponent(apiKey)}`;
}

async function reconnectSteelSession(userId: string): Promise<BrowserSession | null> {
  const client = steelClient();
  if (!client) return null;
  const existing = await readStore(userId);
  const sessionId = existing.computer.steelSessionId;
  if (!sessionId) return null;
  try {
    const remote = await client.steel.sessions.retrieve(sessionId);
    if (remote.status !== "live") {
      await mutateStore(userId, (store) => {
        if (store.computer.steelSessionId === sessionId) {
          store.computer.steelSessionId = null;
          store.computer.steelDebugUrl = null;
        }
      }).catch(() => undefined);
      return null;
    }
    const { chromium } = await import("playwright");
    const websocketUrl = steelWebsocketUrl(remote, client.apiKey);
    const browser = await chromium.connectOverCDP(websocketUrl);
    const context = browser.contexts()[0];
    if (!context) throw new Error("Steel returned no browser context");
    const page = context.pages()[0] ?? (await context.newPage());
    const now = Date.now();
    const session: BrowserSession = {
      browser,
      context,
      page,
      steel: client.steel,
      steelSessionId: remote.id,
      startedAt: now,
      lastBilledAt: now,
    };
    browserSessions().set(userId, Promise.resolve(session));
    browserBilledAt().set(userId, now);
    await setComputer(userId, {
      steelSessionId: remote.id,
      steelDebugUrl: remote.debugUrl ?? existing.computer.steelDebugUrl,
      url: page.url() || "about:blank",
      lastError: null,
      browserLive: true,
    }).catch(() => undefined);
    touchSteelSession(userId, session);
    return session;
  } catch {
    return null;
  }
}

async function getExistingBrowserSession(userId: string): Promise<BrowserSession | null> {
  const existing = browserSessions().get(userId);
  if (!existing) return reconnectSteelSession(userId);
  try {
    const session = await existing;
    if (!(await isBrowserSessionUsable(session))) {
      await invalidateBrowserSession(userId, session);
      return reconnectSteelSession(userId);
    }
    touchSteelSession(userId, session);
    await billBrowserTime(userId, session, { allowOver: true, minDeltaMs: 5_000 }).catch(
      () => undefined,
    );
    if (await isBrowserLimitReached(userId, pendingBrowserMs(userId))) {
      await releaseBrowser(userId);
      return null;
    }
    return session;
  } catch {
    browserSessions().delete(userId);
    browserBilledAt().delete(userId);
    return null;
  }
}

async function billBrowserTime(
  userId: string,
  session: BrowserSession,
  opts?: { allowOver?: boolean; minDeltaMs?: number },
) {
  const now = Date.now();
  const previous = session.lastBilledAt || session.startedAt || now;
  const delta = now - previous;
  if (delta <= 0) return;
  if (opts?.minDeltaMs && delta < opts.minDeltaMs) return;
  session.lastBilledAt = now;
  browserBilledAt().set(userId, now);
  await consumeUsage(userId, { browserMs: delta }, { allowOver: opts?.allowOver });
}

async function ensureBrowser(userId: string): Promise<BrowserSession> {
  const current = await getExistingBrowserSession(userId);
  if (current) {
    await billBrowserTime(userId, current);
    await assertCanStartBrowser(userId);
    return current;
  }

  await assertCanStartBrowser(userId);
  const promise = createBrowser(userId);
  browserSessions().set(userId, promise);
  try {
    const session = await promise;
    const now = Date.now();
    session.startedAt = now;
    session.lastBilledAt = now;
    browserBilledAt().set(userId, now);
    touchSteelSession(userId, session);
    return session;
  } catch (error) {
    browserSessions().delete(userId);
    browserBilledAt().delete(userId);
    throw error;
  }
}

async function isBrowserSessionUsable(session: BrowserSession) {
  if (session.closed) return false;
  if (session.browser && !session.browser.isConnected()) return false;
  if (!session.page.isClosed()) return true;
  try {
    session.page = await session.context.newPage();
    return true;
  } catch {
    return false;
  }
}

function touchSteelSession(userId: string, session: BrowserSession) {
  if (!session.steel || !session.steelSessionId) return;
  if (session.idleTimer) clearTimeout(session.idleTimer);
  const idleMs = Number(process.env.STEEL_SESSION_IDLE_MS ?? 600_000);
  session.idleTimer = setTimeout(() => {
    releaseBrowser(userId).catch(() => undefined);
  }, idleMs);
}

export async function releaseBrowser(userId: string) {
  const promise = browserSessions().get(userId);
  if (!promise) return;
  const session = await promise.catch(() => null);
  browserSessions().delete(userId);
  if (!session) {
    browserBilledAt().delete(userId);
    return;
  }
  await closeBrowserSession(userId, session);
}

async function invalidateBrowserSession(userId: string, session: BrowserSession) {
  const current = browserSessions().get(userId);
  if (current) {
    const resolved = await current.catch(() => null);
    if (resolved === session) browserSessions().delete(userId);
  }
  await closeBrowserSession(userId, session);
}

async function closeBrowserSession(userId: string, session: BrowserSession) {
  session.closed = true;
  if (session.idleTimer) clearTimeout(session.idleTimer);
  await billBrowserTime(userId, session, { allowOver: true }).catch(() => undefined);
  browserBilledAt().delete(userId);
  if (session.steel && session.steelSessionId) {
    await session.steel.sessions.release(session.steelSessionId).catch(() => undefined);
    await mutateStore(userId, (store) => {
      if (store.computer.steelSessionId === session.steelSessionId) {
        store.computer.steelSessionId = null;
        store.computer.steelDebugUrl = null;
      }
    });
  }
  await session.browser?.close().catch(() => undefined);
  await session.context.close().catch(() => undefined);
  await setComputer(userId, {
    steelSessionId: null,
    steelDebugUrl: null,
    url: null,
    title: null,
    screenshotAt: null,
    browserLive: false,
  }).catch(() => undefined);
}

async function createBrowser(userId: string): Promise<BrowserSession> {
  const { chromium } = await import("playwright");
  const steelApiKey = process.env.STEEL_API_KEY;

  if (steelApiKey) {
    const reconnected = await reconnectSteelSession(userId);
    if (reconnected) return reconnected;
    const steel = new Steel({
      steelAPIKey: steelApiKey,
      baseURL: process.env.STEEL_BASE_URL || "https://api.steel.dev",
    });
    const existing = await readStore(userId);
    const profileId = existing.computer.steelProfileId || undefined;
    let session: Awaited<ReturnType<typeof steel.sessions.create>> | undefined;
    try {
      session = await steel.sessions.create({
        ...(profileId ? { profileId } : {}),
        persistProfile: true,
        headless: false,
        timeout: Number(process.env.STEEL_SESSION_TIMEOUT_MS ?? 900_000),
        dimensions: VIEWPORT,
        debugConfig: { interactive: true, systemCursor: true },
      });
      const websocketUrl = session.websocketUrl
        ? `${session.websocketUrl}${session.websocketUrl.includes("?") ? "&" : "?"}apiKey=${encodeURIComponent(steelApiKey)}`
        : `wss://connect.steel.dev?apiKey=${encodeURIComponent(steelApiKey)}&sessionId=${session.id}`;
      const browser = await chromium.connectOverCDP(websocketUrl);
      const context = browser.contexts()[0];
      if (!context) throw new Error("Steel returned no browser context");
      const page = context.pages()[0] ?? (await context.newPage());
      await setComputer(userId, {
        steelSessionId: session.id,
        steelProfileId: session.profileId ?? profileId ?? null,
        steelDebugUrl: session.debugUrl ?? null,
        url: page.url() || "about:blank",
        lastError: null,
        browserLive: true,
      });
      const now = Date.now();
      browserBilledAt().set(userId, now);
      return {
        browser,
        context,
        page,
        steel,
        steelSessionId: session.id,
        startedAt: now,
        lastBilledAt: now,
      };
    } catch (error) {
      if (session) await steel.sessions.release(session.id).catch(() => undefined);
      throw error;
    }
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("STEEL_API_KEY is required in production");
  }

  const context = await chromium.launchPersistentContext(userBrowserDir(userId), {
    headless: true,
    viewport: VIEWPORT,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.setViewportSize(VIEWPORT);
  await setComputer(userId, {
    url: page.url() || "about:blank",
    lastError: null,
    browserLive: true,
  });
  const now = Date.now();
  browserBilledAt().set(userId, now);
  return { context, page, startedAt: now, lastBilledAt: now };
}

async function recordShell(userId: string, record: ShellRecord) {
  pushShell(userId, record);
  await mutateStore(userId, (store) => {
    store.shells = [record, ...store.shells].slice(0, 80);
  });
}

async function uploadWorkspaceToSandbox(
  sandbox: Awaited<ReturnType<typeof getUserSandbox>>,
  root: string,
) {
  await sandbox.files.makeDir("/workspace");
  const directories: string[] = [];
  const files: string[] = [];
  async function collect(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        directories.push(rel);
        await collect(abs);
      } else {
        files.push(rel);
      }
    }
  }
  await collect(root);
  for (const directory of directories) {
    await sandbox.files.makeDir(`/workspace/${directory}`);
  }
  for (const file of files) {
    const contents = await readFile(path.join(root, file));
    await sandbox.files.write(`/workspace/${file}`, Uint8Array.from(contents).buffer);
  }
}

async function downloadWorkspaceFromSandbox(
  sandbox: Awaited<ReturnType<typeof getUserSandbox>>,
  root: string,
) {
  const entries = await sandbox.files.list("/workspace", { depth: 20 });
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  for (const entry of entries) {
    if (entry.type !== "file" || !entry.path.startsWith("/workspace/")) continue;
    const rel = entry.path.slice("/workspace/".length);
    if (!rel || rel.split("/").some((part) => part === ".." || part.startsWith("."))) {
      continue;
    }
    const destination = path.join(root, ...rel.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    const content = await sandbox.files.read(entry.path, { format: "bytes" });
    await writeFile(destination, content);
  }
}

async function runE2BCommand(
  userId: string,
  command: string,
  timeoutMs: number,
): Promise<ShellRecord> {
  const root = await prepareCommandWorkspace(userId);
  const sandbox = await getUserSandbox(userId);
  await uploadWorkspaceToSandbox(sandbox, root);
  try {
    const result = await sandbox.commands.run(command, {
      cwd: "/workspace",
      timeoutMs,
    });
    return {
      id: createId("sh"),
      at: nowIso(),
      command,
      cwd: "/workspace",
      exitCode: result.exitCode,
      stdout: clip(result.stdout),
      stderr: clip(result.stderr || result.error || ""),
    };
  } finally {
    await downloadWorkspaceFromSandbox(sandbox, root);
    await syncCommandWorkspace(userId, root);
    await billUserSandbox(userId, true).catch(() => undefined);
  }
}

function isClosedBrowserError(error: unknown) {
  return /target page, context or browser has been closed|browser has been closed|context has been closed/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

async function withBrowserSession<T>(
  userId: string,
  action: (session: BrowserSession) => Promise<T>,
) {
  let session = await ensureBrowser(userId);
  try {
    return await action(session);
  } catch (error) {
    if (!isClosedBrowserError(error)) throw error;
    await invalidateBrowserSession(userId, session);
    session = await ensureBrowser(userId);
    return action(session);
  }
}

export async function stopSandbox(userId: string) {
  const browserWasLive = hasBrowserSession(userId);
  await releaseBrowser(userId);
  const sandbox = hasE2B()
    ? await stopUserSandbox(userId)
    : { stopped: false as const, reason: "already stopped" };
  return {
    stopped: browserWasLive || sandbox.stopped,
    browserClosed: browserWasLive,
    sandboxStopped: sandbox.stopped,
  };
}

export async function runCommand(
  userId: string,
  command: string,
  timeoutMs = 60_000,
): Promise<ShellRecord> {
  if (hasE2B()) {
    const record = await runE2BCommand(userId, command, timeoutMs);
    await recordShell(userId, record);
    return record;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("E2B_API_KEY is required in production");
  }

  const cwd = await prepareCommandWorkspace(userId);
  const record: ShellRecord = {
    id: createId("sh"),
    at: nowIso(),
    command,
    cwd,
    exitCode: null,
    stdout: "",
    stderr: "",
  };
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: timeoutMs,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    record.stdout = clip(stdout);
    record.stderr = clip(stderr);
    record.exitCode = 0;
  } catch (error) {
    const err = error as {
      stdout?: string;
      stderr?: string;
      code?: number;
      message?: string;
      killed?: boolean;
    };
    record.stdout = clip(err.stdout ?? "");
    record.stderr = clip(err.stderr ?? err.message ?? String(error));
    record.exitCode = typeof err.code === "number" ? err.code : 1;
    if (err.killed) record.stderr = `${record.stderr}\n(timeout)`;
  } finally {
    await syncCommandWorkspace(userId, cwd);
  }
  await recordShell(userId, record);
  return record;
}

function clip(text: string, max = 12_000) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… (${text.length - max} more chars)`;
}

export async function screenshot(userId: string): Promise<string | null> {
  try {
    const session = await getExistingBrowserSession(userId);
    if (!session) return null;
    const image = Buffer.from(await session.page.screenshot({ type: "png" }));
    const at = nowIso();
    const url = session.page.url();
    const title = await session.page.title();
    screenshotCache().set(userId, image);
    await setComputer(userId, {
      screenshotAt: at,
      url,
      title,
      lastError: null,
      browserLive: true,
    });
    const remoteStorage = hasObjectStorage();
    if (process.env.NODE_ENV === "production" && !remoteStorage) {
      throw new Error("S3-compatible screenshot storage is required in production");
    }
    persistScreenshot(userId, image, remoteStorage);
    return at;
  } catch (error) {
    await setComputer(userId, {
      lastError: error instanceof Error ? error.message : "The browser could not be started",
    });
    return null;
  }
}

export async function getScreenshot(userId: string) {
  const cached = screenshotCache().get(userId);
  if (cached) return cached;
  const remoteStorage = hasObjectStorage();
  if (process.env.NODE_ENV === "production" && !remoteStorage) {
    return null;
  }
  if (remoteStorage) {
    try {
      const image = await getUserObject(userId, "computer/screen.png");
      if (image) screenshotCache().set(userId, image);
      return image;
    } catch {
      return null;
    }
  }
  try {
    const image = await readFile(userScreenPath(userId));
    screenshotCache().set(userId, image);
    return image;
  } catch {
    return null;
  }
}

async function pageSnapshot(page: Page) {
  try {
    const aria = await page.locator("html").ariaSnapshot({ timeout: 4000 });
    return clip(aria, 8000);
  } catch {
    const links = await page.$$eval("a[href]", (nodes) =>
      nodes.slice(0, 40).map((node) => ({
        text: (node.textContent ?? "").trim().slice(0, 80),
        href: node.getAttribute("href"),
      })),
    );
    const headings = await page.$$eval("h1,h2,h3", (nodes) =>
      nodes.slice(0, 20).map((node) => (node.textContent ?? "").trim().slice(0, 120)),
    );
    return JSON.stringify({ headings, links }, null, 2);
  }
}

export async function browserNavigate(userId: string, url: string) {
  return withBrowserSession(userId, async (session) => {
    const target = assertBrowserUrl(url);
    await session.page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await screenshot(userId);
    return {
      url: session.page.url(),
      title: await session.page.title(),
      snapshot: await pageSnapshot(session.page),
    };
  });
}

export async function browserSnapshot(userId: string) {
  return withBrowserSession(userId, async (session) => {
    await screenshot(userId);
    return {
      url: session.page.url(),
      title: await session.page.title(),
      snapshot: await pageSnapshot(session.page),
    };
  });
}

export async function browserClick(
  userId: string,
  input: { selector?: string; x?: number; y?: number; normalized?: boolean },
) {
  return withBrowserSession(userId, async (session) => {
    if (input.selector) {
      await session.page.locator(input.selector).first().click({ timeout: 10_000 });
    } else if (input.x != null && input.y != null) {
      const viewport = session.page.viewportSize() ?? VIEWPORT;
      const x = input.normalized ? input.x * viewport.width : input.x;
      const y = input.normalized ? input.y * viewport.height : input.y;
      if (process.env.NODE_ENV !== "production") {
        console.info("[computer] browser click", {
          x: Math.round(x),
          y: Math.round(y),
          viewport,
          normalized: input.normalized ?? false,
        });
      }
      await session.page.mouse.click(x, y);
    } else {
      throw new Error("A selector or x,y coordinates are required");
    }
    await session.page.waitForTimeout(400);
    await screenshot(userId);
    return {
      url: session.page.url(),
      title: await session.page.title(),
      snapshot: await pageSnapshot(session.page),
    };
  });
}

export async function browserType(userId: string, input: { selector?: string; text: string }) {
  return withBrowserSession(userId, async (session) => {
    if (input.selector) {
      await session.page.locator(input.selector).first().fill(input.text);
    } else {
      await session.page.keyboard.type(input.text, { delay: 20 });
    }
    await screenshot(userId);
    return { url: session.page.url(), title: await session.page.title() };
  });
}

export async function browserPress(userId: string, key: string) {
  return withBrowserSession(userId, async (session) => {
    await session.page.keyboard.press(key);
    await session.page.waitForTimeout(300);
    await screenshot(userId);
    return { url: session.page.url(), title: await session.page.title() };
  });
}

export async function browserScroll(userId: string, dy: number) {
  return withBrowserSession(userId, async (session) => {
    await session.page.mouse.wheel(0, dy);
    await screenshot(userId);
    return { url: session.page.url(), title: await session.page.title() };
  });
}

export {
  collectWorkspaceFiles,
  deleteWorkspaceContents,
  deleteWorkspacePath,
  deleteWorkspacePaths,
  listWorkspace,
  makeWorkspaceDir,
  readWorkspaceBytes,
  readWorkspaceFile,
  writeWorkspaceFile,
};
export { lastComputer, listShells };
export const BROWSER_VIEWPORT = VIEWPORT;

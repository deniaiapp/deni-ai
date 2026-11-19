import type { Browser } from "playwright-core";
import { runConfig, runDeps } from "../runtime";

/**
 * The account computer's external providers. Deni Run runs terminal commands in an E2B
 * sandbox (one per user, paused when idle) and drives a Steel cloud browser (one
 * persistent profile per user) through Playwright over CDP. Both sit behind these
 * interfaces so tests can inject fakes and a deployment without keys runs with the
 * computer turned off (the agent is not offered those tools; the UI shows a disabled
 * panel). Workspace files do not need a provider: they live in object storage (or the
 * local data directory in development).
 */

export type SandboxCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: string;
};

export type SandboxEntry = { type: string; path: string };

/** A running sandbox. Paths are absolute inside the sandbox (`/workspace/...`). */
export interface SandboxHandle {
  readonly id: string;
  makeDir(path: string): Promise<void>;
  writeFile(path: string, data: ArrayBuffer): Promise<void>;
  list(path: string, options: { depth: number }): Promise<SandboxEntry[]>;
  readFile(path: string): Promise<Uint8Array>;
  run(command: string, options: { cwd: string; timeoutMs: number }): Promise<SandboxCommandResult>;
  /** Extend the sandbox's lifetime (E2B kills or pauses it after this long). */
  setTimeout(timeoutMs: number): Promise<void>;
  pause(): Promise<void>;
}

export interface SandboxProvider {
  readonly name: string;
  /** How long a sandbox lives without being touched (ms). */
  readonly timeoutMs: number;
  /** Pause an idle sandbox after this long (ms). */
  readonly idleMs: number;
  create(): Promise<SandboxHandle>;
  /** Resume a paused or running sandbox; throws when it no longer exists. */
  connect(sandboxId: string): Promise<SandboxHandle>;
  /** Pause a sandbox by id; false when it was already gone. */
  pause(sandboxId: string): Promise<boolean>;
}

/** A remote browser session as the provider reports it. */
export type RemoteBrowserSession = {
  id: string;
  profileId: string | null;
  /** Live view (interactive debug URL) the takeover panel embeds. */
  debugUrl: string | null;
};

export interface BrowserProvider {
  readonly name: string;
  /** Release an idle session after this long (ms). */
  readonly idleMs: number;
  /** A session that is still live, else null. */
  retrieve(sessionId: string): Promise<RemoteBrowserSession | null>;
  create(options: {
    profileId: string | null;
    viewport: { width: number; height: number };
  }): Promise<RemoteBrowserSession>;
  /** Connect Playwright to the session over CDP. */
  connect(session: RemoteBrowserSession): Promise<Browser>;
  release(sessionId: string): Promise<void>;
}

class ComputerNotConfiguredError extends Error {
  readonly code = "computer_unconfigured";
  constructor(message: string) {
    super(message);
    this.name = "ComputerNotConfiguredError";
  }
}

export { ComputerNotConfiguredError };

/** The configured sandbox provider (E2B), an injected one, or null. */
export function sandboxProvider(): SandboxProvider | null {
  const injected = runDeps().computer?.sandbox;
  if (injected !== undefined) return injected;
  const config = runConfig().e2b;
  return config ? cachedE2B(config) : null;
}

/** The configured browser provider (Steel), an injected one, or null. */
export function browserProvider(): BrowserProvider | null {
  const injected = runDeps().computer?.browser;
  if (injected !== undefined) return injected;
  const config = runConfig().steel;
  return config ? cachedSteel(config) : null;
}

export function requireSandbox(): SandboxProvider {
  const provider = sandboxProvider();
  if (!provider) {
    throw new ComputerNotConfiguredError(
      "The terminal is not configured on this server (E2B_API_KEY is not set).",
    );
  }
  return provider;
}

export function requireBrowser(): BrowserProvider {
  const provider = browserProvider();
  if (!provider) {
    throw new ComputerNotConfiguredError(
      "The browser is not configured on this server (STEEL_API_KEY is not set).",
    );
  }
  return provider;
}

/** What the account computer can do on this deployment (the UI disables the rest). */
export function computerCapabilities() {
  return { browser: Boolean(browserProvider()), sandbox: Boolean(sandboxProvider()), files: true };
}

export type ComputerCapabilities = ReturnType<typeof computerCapabilities>;

type E2BConfig = NonNullable<ReturnType<typeof runConfig>["e2b"]>;
type SteelConfig = NonNullable<ReturnType<typeof runConfig>["steel"]>;

let e2bCache: { key: string; provider: SandboxProvider } | null = null;
let steelCache: { key: string; provider: BrowserProvider } | null = null;

function cachedE2B(config: E2BConfig) {
  if (e2bCache?.key !== config.apiKey)
    e2bCache = { key: config.apiKey, provider: e2bProvider(config) };
  return e2bCache.provider;
}

function cachedSteel(config: SteelConfig) {
  if (steelCache?.key !== config.apiKey)
    steelCache = { key: config.apiKey, provider: steelProvider(config) };
  return steelCache.provider;
}

/** E2B: one sandbox per user, paused (not killed) when idle so its disk survives. */
export function e2bProvider(config: E2BConfig): SandboxProvider {
  const timeoutMs = config.timeoutMs ?? 600_000;
  const load = () => import("e2b");
  const wrap = (sandbox: import("e2b").Sandbox): SandboxHandle => ({
    id: sandbox.sandboxId,
    makeDir: async (path) => {
      await sandbox.files.makeDir(path);
    },
    writeFile: async (path, data) => {
      await sandbox.files.write(path, data);
    },
    list: async (path, options) =>
      (await sandbox.files.list(path, options)).map((entry) => ({
        type: String(entry.type),
        path: entry.path,
      })),
    readFile: (path) => sandbox.files.read(path, { format: "bytes" }),
    run: async (command, options) => {
      const { CommandExitError } = await load();
      try {
        const result = await sandbox.commands.run(command, options);
        return {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          error: result.error,
        };
      } catch (error) {
        // A non-zero exit is a result, not a failure of the tool.
        if (error instanceof CommandExitError) {
          return {
            exitCode: error.exitCode,
            stdout: error.stdout,
            stderr: error.stderr,
            error: error.error,
          };
        }
        throw error;
      }
    },
    setTimeout: (ms) => sandbox.setTimeout(ms),
    pause: async () => {
      await sandbox.pause({ keepMemory: false });
    },
  });
  return {
    name: "e2b",
    timeoutMs,
    idleMs: config.idleMs ?? 600_000,
    create: async () => {
      const { Sandbox } = await load();
      return wrap(
        await Sandbox.create({
          apiKey: config.apiKey,
          timeoutMs,
          lifecycle: { onTimeout: "pause", autoResume: false },
        }),
      );
    },
    connect: async (sandboxId) => {
      const { Sandbox } = await load();
      return wrap(await Sandbox.connect(sandboxId, { apiKey: config.apiKey, timeoutMs }));
    },
    pause: async (sandboxId) => {
      const { Sandbox } = await load();
      return Sandbox.pause(sandboxId, { apiKey: config.apiKey, keepMemory: false })
        .then(() => true)
        .catch(() => false);
    },
  };
}

function steelWebsocketUrl(session: { id: string; websocketUrl?: string }, apiKey: string) {
  if (!session.websocketUrl) {
    return `wss://connect.steel.dev?apiKey=${encodeURIComponent(apiKey)}&sessionId=${session.id}`;
  }
  const join = session.websocketUrl.includes("?") ? "&" : "?";
  return `${session.websocketUrl}${join}apiKey=${encodeURIComponent(apiKey)}`;
}

/** Steel: a cloud browser per session with a persistent profile per user. */
export function steelProvider(config: SteelConfig): BrowserProvider {
  let client: Promise<import("steel-sdk").default> | null = null;
  const steel = () => {
    client ??= import("steel-sdk").then(
      ({ default: Steel }) =>
        new Steel({
          steelAPIKey: config.apiKey,
          baseURL: config.baseUrl ?? "https://api.steel.dev",
        }),
    );
    return client;
  };
  const websockets = new Map<string, string>();
  return {
    name: "steel",
    idleMs: config.sessionIdleMs ?? 600_000,
    retrieve: async (sessionId) => {
      const remote = await (await steel()).sessions.retrieve(sessionId).catch(() => null);
      if (!remote || remote.status !== "live") return null;
      websockets.set(remote.id, steelWebsocketUrl(remote, config.apiKey));
      return {
        id: remote.id,
        profileId: remote.profileId ?? null,
        debugUrl: remote.debugUrl ?? null,
      };
    },
    create: async ({ profileId, viewport }) => {
      const session = await (
        await steel()
      ).sessions.create({
        ...(profileId ? { profileId } : {}),
        persistProfile: true,
        headless: false,
        timeout: config.sessionTimeoutMs ?? 900_000,
        dimensions: viewport,
        debugConfig: { interactive: true, systemCursor: true },
      });
      websockets.set(session.id, steelWebsocketUrl(session, config.apiKey));
      return {
        id: session.id,
        profileId: session.profileId ?? profileId,
        debugUrl: session.debugUrl ?? null,
      };
    },
    connect: async (session) => {
      const { chromium } = await import("playwright-core");
      const url =
        websockets.get(session.id) ?? steelWebsocketUrl({ id: session.id }, config.apiKey);
      return chromium.connectOverCDP(url);
    },
    release: async (sessionId) => {
      websockets.delete(sessionId);
      await (await steel()).sessions.release(sessionId).catch(() => undefined);
    },
  };
}

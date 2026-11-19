import {
  pluginKinds,
  pluginWriteActions,
  type PluginKind,
  type PluginOperation,
  type WriteAction,
} from "./plugin-actions";
import { mutateStore, readStore } from "../data/store";

export {
  pluginKinds,
  pluginWriteActions,
  writeActions,
  type PluginKind,
  type PluginOperation,
  type WriteAction,
} from "./plugin-actions";

/**
 * Built-in Gmail, Google Drive and GitHub plugins. The standalone Deni Run used its own
 * Better Auth accounts with extra Google/GitHub scopes; the platform's sign-in does not
 * request those scopes yet, so the plugins are reported as unavailable and refuse to
 * run. Their always-allow settings (`run_settings.plugin_always_allow`) are kept so a
 * migrated account gets them back once the plugins return.
 */
export const scopes = {
  gmail: {
    read: "https://www.googleapis.com/auth/gmail.readonly",
    write: "https://www.googleapis.com/auth/gmail.send",
  },
  drive: {
    read: "https://www.googleapis.com/auth/drive.readonly",
    write: "https://www.googleapis.com/auth/drive.file",
  },
  github: { read: "repo", write: "repo" },
} as const;

export const PLUGINS_UNAVAILABLE_MESSAGE =
  "Gmail, Google Drive, and GitHub plugins are not available in Deni AI yet. Use an MCP connector instead.";

export type PluginStatus = {
  kind: PluginKind;
  connected: false;
  writeAccess: false;
  available: false;
  alwaysAllow: WriteAction[];
};

export async function pluginStatus(userId: string): Promise<PluginStatus[]> {
  const store = await readStore(userId);
  return pluginKinds.map((kind) => ({
    kind,
    connected: false as const,
    writeAccess: false as const,
    available: false as const,
    alwaysAllow: pluginWriteActions[kind].filter(
      (action) => store.pluginAlwaysAllow?.[`${kind}:${action}`],
    ),
  }));
}

export async function setPluginAlwaysAllow(
  _userId: string,
  kind: PluginKind,
  action: WriteAction,
  _enabled: boolean,
): Promise<never> {
  if (!pluginWriteActions[kind].includes(action)) throw new Error("Invalid plugin operation");
  throw new Error(PLUGINS_UNAVAILABLE_MESSAGE);
}

export async function isAlwaysAllowed(userId: string, kind: PluginKind, action: WriteAction) {
  return Boolean((await readStore(userId)).pluginAlwaysAllow?.[`${kind}:${action}`]);
}

/** Forget a plugin's always-allow rules (there is no grant to revoke on the platform). */
export async function disconnectPlugin(userId: string, kind: PluginKind) {
  await mutateStore(userId, (store) => {
    for (const action of pluginWriteActions[kind])
      delete store.pluginAlwaysAllow?.[`${kind}:${action}`];
  });
  return pluginStatus(userId);
}

export type PluginInput = {
  query?: string;
  id?: string;
  repo?: string;
  title?: string;
  body?: string;
  to?: string;
  subject?: string;
  head?: string;
  base?: string;
  mimeType?: string;
  ref?: string;
  state?: "open" | "closed" | "all";
  stateReason?: "completed" | "not_planned" | "reopened";
  labels?: string[];
  assignees?: string[];
  reviewers?: string[];
  mergeMethod?: "merge" | "squash" | "rebase";
  event?: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  page?: number;
};

export async function runPlugin(
  _userId: string,
  _kind: PluginKind,
  _action: PluginOperation,
  _input: PluginInput,
): Promise<never> {
  throw new Error(PLUGINS_UNAVAILABLE_MESSAGE);
}

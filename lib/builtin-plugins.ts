import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { account } from "@/db/auth-schema";
import { auth } from "./auth";
import { mutateStore, readStore } from "./store";

export const pluginKinds = ["gmail", "drive", "github"] as const;
export type PluginKind = (typeof pluginKinds)[number];
export const writeActions = ["send", "create", "update", "createIssue", "createPR", "comment"] as const;
export type WriteAction = (typeof writeActions)[number];
export const scopes = {
  gmail: { read: "https://www.googleapis.com/auth/gmail.readonly", write: "https://www.googleapis.com/auth/gmail.send" },
  drive: { read: "https://www.googleapis.com/auth/drive.readonly", write: "https://www.googleapis.com/auth/drive.file" },
  github: { read: "repo", write: "repo" },
} as const;
// Temporarily switched off: hidden from Plugins and refused at runtime. Set DISABLED_PLUGINS
// (comma separated, empty for none) to override; remove "gmail,drive" below to re-enable.
const disabledPlugins = () => new Set((process.env.DISABLED_PLUGINS ?? "gmail,drive").split(",").map((item) => item.trim()).filter(Boolean));
const provider = (kind: PluginKind) => kind === "github" ? "github" : "google";
/** Write actions each plugin supports; anything else is refused on save and at run time. */
export const pluginWriteActions: Record<PluginKind, WriteAction[]> = { gmail: ["send"], drive: ["create", "update"], github: ["createIssue", "createPR", "comment"] };

export async function pluginStatus(userId: string) {
  const rows = await db.select({ id: account.id, providerId: account.providerId, scope: account.scope }).from(account).where(eq(account.userId, userId));
  const store = await readStore(userId);
  const disabled = disabledPlugins();
  return pluginKinds.filter((kind) => !disabled.has(kind)).map((kind) => {
    const row = rows.find((item) => item.providerId === provider(kind) && item.scope?.split(/[,\s]+/).includes(scopes[kind].read));
    const granted = row?.scope?.split(/[,\s]+/).includes(scopes[kind].write) ?? false;
    return { kind, connected: Boolean(row), writeAccess: granted, alwaysAllow: pluginWriteActions[kind].filter((action) => store.pluginAlwaysAllow?.[`${kind}:${action}`]) };
  });
}

export async function setPluginAlwaysAllow(userId: string, kind: PluginKind, action: WriteAction, enabled: boolean) {
  if (!pluginWriteActions[kind].includes(action)) throw new Error("Invalid plugin operation");
  if (enabled && !(await pluginStatus(userId)).find((item) => item.kind === kind)?.writeAccess) throw new Error("Connect write access first");
  await mutateStore(userId, (store) => {
    store.pluginAlwaysAllow ??= {};
    store.pluginAlwaysAllow[`${kind}:${action}`] = enabled;
  });
}

export async function isAlwaysAllowed(userId: string, kind: PluginKind, action: WriteAction) {
  return Boolean((await readStore(userId)).pluginAlwaysAllow?.[`${kind}:${action}`]);
}

const splitScopes = (scope: string | null | undefined) => (scope ?? "").split(/[,\s]+/).filter(Boolean);

async function revokeGoogleToken(token: string) {
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(15_000),
  });
  // 400 means the token is already invalid or revoked, which is the state we want.
  if (!response.ok && response.status !== 400) throw new Error("Could not revoke access at Google. Try again.");
}

async function revokeGithubToken(token: string) {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return;
  const response = await fetch(`https://api.github.com/applications/${encodeURIComponent(clientId)}/token`, {
    method: "DELETE",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ access_token: token }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok && response.status !== 404) throw new Error("Could not revoke access at GitHub. Try again.");
}

/**
 * Stop using a plugin and give the access back. Google cannot revoke one scope at a time,
 * so while another Google plugin is still connected only this plugin's scopes are dropped
 * from our record (the app stops using them); the Google grant itself is revoked once the
 * last Google plugin is disconnected. The sign-in identity (the account row) is kept.
 */
export async function disconnectPlugin(userId: string, kind: PluginKind) {
  const rows = await db.select().from(account).where(and(eq(account.userId, userId), eq(account.providerId, provider(kind))));
  const own = new Set<string>([scopes[kind].read, scopes[kind].write]);
  const otherGoogleScopes = new Set<string>(
    kind === "github" ? [] : pluginKinds.filter((other) => other !== kind && other !== "github").flatMap((other) => [scopes[other].read, scopes[other].write]),
  );
  for (const row of rows) {
    const granted = splitScopes(row.scope);
    if (!granted.some((scope) => own.has(scope))) continue;
    const kept = granted.filter((scope) => !own.has(scope));
    const othersRemain = kept.some((scope) => otherGoogleScopes.has(scope));
    if (!othersRemain) {
      const token = row.refreshToken || row.accessToken;
      if (token) await (kind === "github" ? revokeGithubToken(token) : revokeGoogleToken(token));
    }
    const delimiter = (row.scope ?? "").includes(",") ? "," : " ";
    await db
      .update(account)
      .set({
        scope: kept.join(delimiter),
        ...(othersRemain ? {} : { accessToken: null, refreshToken: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null }),
        updatedAt: new Date(),
      })
      .where(eq(account.id, row.id));
  }
  await mutateStore(userId, (store) => {
    for (const action of pluginWriteActions[kind]) delete store.pluginAlwaysAllow?.[`${kind}:${action}`];
  });
  return pluginStatus(userId);
}

async function accessToken(userId: string, kind: PluginKind, write = false) {
  const rows = await db.select().from(account).where(and(eq(account.userId, userId), eq(account.providerId, provider(kind))));
  const required = write ? scopes[kind].write : scopes[kind].read;
  const row = rows.find((item) => item.scope?.split(/[,\s]+/).includes(required));
  if (!row) throw new Error(`Connect ${kind}${write ? " write access" : ""} in Plugins first.`);
  const tokens = await auth.api.getAccessToken({ body: { accountId: row.id, userId } });
  if (!tokens.accessToken) throw new Error(`Reconnect ${kind} in Plugins.`);
  return tokens.accessToken;
}

async function api(userId: string, kind: PluginKind, url: URL, options?: { method?: string; body?: string; write?: boolean; contentType?: string }) {
  const token = await accessToken(userId, kind, options?.write);
  const response = await fetch(url, {
    method: options?.method ?? "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(kind === "github" ? { "X-GitHub-Api-Version": "2022-11-28" } : {}), ...(options?.body !== undefined ? { "Content-Type": options.contentType ?? "application/json" } : {}) },
    body: options?.body,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${kind} request failed (${response.status}): ${text.slice(0, 500)}`);
  if (text.length > 200_000) throw new Error("Result too large to display");
  try { return JSON.parse(text) as unknown; } catch { return text.slice(0, 30_000); }
}

export type PluginOperation = "search" | "read" | WriteAction;
export async function runPlugin(userId: string, kind: PluginKind, action: PluginOperation, input: { query?: string; id?: string; repo?: string; title?: string; body?: string; to?: string; subject?: string; head?: string; base?: string; mimeType?: string }) {
  if (disabledPlugins().has(kind)) throw new Error(`${kind} is temporarily disabled.`);
  if (Object.values(input).some((value) => value && value.length > 20_000)) throw new Error("Input too large");
  if (action !== "search" && action !== "read" && !pluginWriteActions[kind].includes(action)) throw new Error("Unsupported plugin operation");
  if (kind === "gmail") {
    const base = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
    if (action === "search") { const url = new URL(base); url.searchParams.set("q", input.query ?? ""); url.searchParams.set("maxResults", "20"); return api(userId, kind, url); }
    if (action === "read") {
      if (!input.id) throw new Error("Message ID required");
      const url = new URL(`${base}/${encodeURIComponent(input.id)}`);
      url.searchParams.set("format", "full");
      const message = await api(userId, kind, url) as { id: string; snippet?: string; payload?: { headers?: { name: string; value: string }[]; body?: { data?: string }; parts?: unknown[] } };
      const textParts: string[] = [];
      function collect(part: { mimeType?: string; body?: { data?: string }; parts?: unknown[] }) {
        if (part.mimeType === "text/plain" && part.body?.data) textParts.push(Buffer.from(part.body.data, "base64url").toString("utf8"));
        for (const child of part.parts ?? []) collect(child as typeof part);
      }
      if (message.payload) collect(message.payload);
      return { id: message.id, headers: message.payload?.headers?.filter((header) => ["from", "to", "date", "subject"].includes(header.name.toLowerCase())), snippet: message.snippet, text: textParts.join("\n").slice(0, 30_000) };
    }
    if (!input.to || !input.subject || !input.body || /[\r\n]/.test(input.to + input.subject)) throw new Error("Valid recipient, subject and body required");
    const raw = Buffer.from(`To: ${input.to}\r\nSubject: ${input.subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${input.body}`).toString("base64url");
    return api(userId, kind, new URL(base + "/send"), { method: "POST", body: JSON.stringify({ raw }), write: true });
  }
  if (kind === "drive") {
    const base = "https://www.googleapis.com/drive/v3/files";
    if (action === "search") { const url = new URL(base); url.searchParams.set("q", `name contains '${(input.query ?? "").replaceAll("\\", "\\\\").replaceAll("'", "\\'")}' and trashed = false`); url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,description,webViewLink)"); url.searchParams.set("pageSize", "20"); return api(userId, kind, url); }
    if (action === "read") {
      if (!input.id) throw new Error("File ID required");
      const fileUrl = new URL(`${base}/${encodeURIComponent(input.id)}`);
      fileUrl.searchParams.set("fields", "id,name,mimeType,description,webViewLink,size");
      const file = await api(userId, kind, fileUrl) as { id: string; name: string; mimeType: string; size?: string };
      if (file.mimeType === "application/vnd.google-apps.document") {
        const exportUrl = new URL(`${base}/${encodeURIComponent(input.id)}/export`);
        exportUrl.searchParams.set("mimeType", "text/plain");
        return { file, content: await api(userId, kind, exportUrl) };
      }
      if (file.mimeType.startsWith("text/") && Number(file.size ?? 0) <= 200_000) {
        const contentUrl = new URL(`${base}/${encodeURIComponent(input.id)}`);
        contentUrl.searchParams.set("alt", "media");
        return { file, content: await api(userId, kind, contentUrl) };
      }
      return file;
    }
    if (action === "create") {
      if (!input.title || !input.body) throw new Error("Title and content required");
      const boundary = `deni${crypto.randomUUID().replaceAll("-", "")}`;
      const content = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: input.title, mimeType: "text/plain" })}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${input.body}\r\n--${boundary}--`;
      return api(userId, kind, new URL("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink"), { method: "POST", body: content, contentType: `multipart/related; boundary=${boundary}`, write: true });
    }
    if (!input.id || input.body === undefined) throw new Error("File ID and content required");
    return api(userId, kind, new URL(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(input.id)}?uploadType=media`), { method: "PATCH", body: input.body, contentType: "text/plain; charset=UTF-8", write: true });
  }
  const base = "https://api.github.com";
  if (action === "search") { const code = input.query?.startsWith("code:"); const url = new URL(base + (code ? "/search/code" : "/search/issues")); url.searchParams.set("q", code ? (input.query ?? "").slice(5).trim() : input.query ?? ""); url.searchParams.set("per_page", "20"); return api(userId, kind, url); }
  if (!input.repo || !/^[\w.-]+\/[\w.-]+$/.test(input.repo)) throw new Error("Repository must be owner/name");
  const repo = `${base}/repos/${input.repo}`;
  if (action === "read") {
    if (!input.id) throw new Error("Issue/PR number or file path required");
    if (/^\d+$/.test(input.id)) return api(userId, kind, new URL(`${repo}/issues/${input.id}`));
    if (input.id.split("/").some((part) => part === ".." || !part)) throw new Error("Invalid file path");
    const path = input.id.split("/").map(encodeURIComponent).join("/");
    const file = await api(userId, kind, new URL(`${repo}/contents/${path}`)) as { name?: string; content?: string; encoding?: string; html_url?: string };
    return file.encoding === "base64" && file.content ? { name: file.name, url: file.html_url, content: Buffer.from(file.content, "base64").toString("utf8").slice(0, 30_000) } : file;
  }
  if (action === "comment") { if (!input.id || !/^\d+$/.test(input.id) || !input.body) throw new Error("Issue number and comment required"); return api(userId, kind, new URL(`${repo}/issues/${input.id}/comments`), { method: "POST", body: JSON.stringify({ body: input.body }), write: true }); }
  if (!input.title || !input.body) throw new Error("Title and body required");
  if (action === "createPR" && (!input.head || !input.base)) throw new Error("Head and base branches required");
  return api(userId, kind, new URL(`${repo}/${action === "createPR" ? "pulls" : "issues"}`), { method: "POST", body: JSON.stringify({ title: input.title, body: input.body, ...(action === "createPR" ? { head: input.head, base: input.base } : {}) }), write: true });
}

import "@tanstack/react-start/server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { mcpConnections } from "@/db/schema";
import { encryptSecret, decryptSecret } from "./secrets";
import { createId } from "./ids";
import { mcpCatalogEntry } from "./mcp-catalog";
import { slackArgumentNames } from "./mcp-slack";
import { beginMcpOAuth, completeMcpOAuth, decodeOAuth, encodeOAuth, McpAuthRequiredError, refreshMcpOAuth, tokenExpiring, type McpOAuth } from "./mcp-oauth";
import { mutateStore, readStore } from "./store";
import type { McpConnection } from "./types";

type McpHeaders = Record<string, string>;

type McpRow = typeof mcpConnections.$inferSelect;
type McpTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: { properties?: Record<string, { title?: string; description?: string }> };
  annotations?: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean };
};

const sessions = new Map<string, string>();
// Last tools/list per connection, so approvals can tell read-only tools apart.
const toolLists = new Map<string, McpTool[]>();
// One refresh at a time per connection: servers that rotate refresh tokens reject the second.
const refreshes = new Map<string, Promise<McpOAuth | null>>();

function encodeHeaders(headers: McpHeaders): McpHeaders {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, encryptSecret(value)]));
}

function decodeHeaders(headers: McpHeaders): McpHeaders {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, decryptSecret(value)]));
}

function publicConnection(row: McpRow): McpConnection {
  const oauth = decodeOAuth(row.oauth);
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    transport: row.transport as McpConnection["transport"],
    enabled: row.enabled,
    catalogId: row.catalogId ?? null,
    hasSecret: Boolean(row.authSecret),
    oauth: oauth ? (oauth.accessToken ? "signed-in" : "signed-out") : null,
    headerNames: Object.keys(row.headers),
    lastTestAt: row.lastTestAt?.toISOString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function validateUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("MCP URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("MCP URL must use http or https");
  }
  return url.toString();
}

function validateHeaders(headers: unknown): McpHeaders {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return {};
  const output: McpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!/^[A-Za-z0-9-]+$/.test(name)) throw new Error(`Invalid MCP header: ${name}`);
    if (name.toLowerCase() === "authorization") continue;
    if (typeof value !== "string" || value.length > 8_000) throw new Error(`Invalid MCP header: ${name}`);
    output[name] = value;
  }
  return output;
}

export async function listMcpConnections(userId: string) {
  const rows = await db
    .select()
    .from(mcpConnections)
    .where(eq(mcpConnections.userId, userId))
    .orderBy(desc(mcpConnections.createdAt));
  return rows.map(publicConnection);
}

async function getMcpRow(userId: string, id: string) {
  const rows = await db
    .select()
    .from(mcpConnections)
    .where(and(eq(mcpConnections.userId, userId), eq(mcpConnections.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function saveMcpConnection(options: {
  userId: string;
  id?: string;
  name: string;
  url: string;
  transport?: McpConnection["transport"];
  secret?: string;
  headers?: unknown;
  enabled?: boolean;
}) {
  const name = options.name.trim();
  if (!name || name.length > 120) throw new Error("MCP connection name is required");
  const url = validateUrl(options.url.trim());
  const headers = validateHeaders(options.headers);
  const transport = options.transport ?? "streamable-http";
  const now = new Date();
  // Names identify connections in Discord commands, so they are unique per account ignoring case.
  const taken = await db
    .select({ id: mcpConnections.id, name: mcpConnections.name })
    .from(mcpConnections)
    .where(eq(mcpConnections.userId, options.userId));
  if (taken.some((row) => row.id !== options.id && row.name.trim().toLowerCase() === name.toLowerCase())) {
    throw new Error("An MCP connection with this name already exists");
  }
  if (options.id) {
    const existing = await getMcpRow(options.userId, options.id);
    if (!existing) throw new Error("MCP connection not found");
    const [row] = await db
      .update(mcpConnections)
      .set({
        name,
        url,
        transport,
        ...(options.secret?.trim() ? { authSecret: encryptSecret(options.secret.trim()) } : {}),
        headers: options.headers === undefined ? existing.headers : encodeHeaders(headers),
        ...(typeof options.enabled === "boolean" ? { enabled: options.enabled } : {}),
        updatedAt: now,
        lastError: null,
      })
      .where(and(eq(mcpConnections.userId, options.userId), eq(mcpConnections.id, options.id)))
      .returning();
    return row ? publicConnection(row) : null;
  }
  const [row] = await db
    .insert(mcpConnections)
    .values({
      id: createId("mcp"),
      userId: options.userId,
      name,
      url,
      transport,
      authSecret: options.secret?.trim() ? encryptSecret(options.secret.trim()) : null,
      headers: encodeHeaders(headers),
      enabled: options.enabled ?? true,
    })
    .returning();
  return row ? publicConnection(row) : null;
}

/** On or off without touching the stored test result, which saveMcpConnection resets. */
export async function setMcpConnectionEnabled(userId: string, id: string, enabled: boolean) {
  const rows = await db
    .update(mcpConnections)
    .set({ enabled, updatedAt: new Date() })
    .where(and(eq(mcpConnections.userId, userId), eq(mcpConnections.id, id)))
    .returning({ id: mcpConnections.id });
  return rows.length > 0;
}

export async function deleteMcpConnection(userId: string, id: string) {
  const result = await db
    .delete(mcpConnections)
    .where(and(eq(mcpConnections.userId, userId), eq(mcpConnections.id, id)))
    .returning({ id: mcpConnections.id });
  return result.length > 0;
}

function parseMcpResponse(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("data:") || trimmed.startsWith("event:") || trimmed.includes("\ndata:")) {
    const data = trimmed
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)
      .at(-1);
    return data ? JSON.parse(data) : {};
  }
  return JSON.parse(trimmed);
}

async function saveOAuth(row: McpRow, oauth: McpOAuth | null) {
  const value = oauth ? encodeOAuth(oauth) : null;
  row.oauth = value;
  await db
    .update(mcpConnections)
    .set({ oauth: value, updatedAt: new Date() })
    .where(and(eq(mcpConnections.userId, row.userId), eq(mcpConnections.id, row.id)));
}

async function refreshRow(row: McpRow, oauth: McpOAuth) {
  const key = `${row.userId}:${row.id}`;
  let pending = refreshes.get(key);
  if (!pending) {
    pending = (async () => {
      // Another call or process may have refreshed since this row was read; with rotation,
      // refreshing again with the old token would revoke the grant.
      const current = decodeOAuth((await getMcpRow(row.userId, row.id))?.oauth) ?? oauth;
      if (current.refreshToken && current.refreshToken !== oauth.refreshToken) return current;
      const next = await refreshMcpOAuth(current);
      if (next) await saveOAuth(row, next);
      return next;
    })().finally(() => refreshes.delete(key));
    refreshes.set(key, pending);
  }
  const next = await pending;
  if (next) row.oauth = encodeOAuth(next);
  return next;
}

async function authorization(row: McpRow) {
  let oauth = decodeOAuth(row.oauth);
  if (!oauth) return row.authSecret ? `Bearer ${decryptSecret(row.authSecret)}` : null;
  if (!oauth.accessToken) throw new McpAuthRequiredError();
  if (tokenExpiring(oauth)) oauth = (await refreshRow(row, oauth)) ?? oauth;
  return `Bearer ${oauth.accessToken}`;
}

async function requestMcp(row: McpRow, method: string, params?: unknown, retried = false): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    ...decodeHeaders(row.headers),
  };
  const auth = await authorization(row);
  if (auth) headers.Authorization = auth;
  const sessionId = sessions.get(`${row.userId}:${row.id}`);
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const request = {
    jsonrpc: "2.0",
    ...(method.startsWith("notifications/") ? {} : { id: createId("rpc") }),
    method,
    params: params ?? {},
  };
  let response: Response;
  if (row.transport === "sse") {
    const stream = await fetch(row.url, {
      method: "GET",
      headers: { ...headers, Accept: "text/event-stream" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!stream.ok) throw new Error(`MCP SSE connection failed (${stream.status})`);
    const streamSession = stream.headers.get("mcp-session-id");
    if (streamSession) sessions.set(`${row.userId}:${row.id}`, streamSession);
    const streamText = await stream.text();
    const endpointMatch = streamText.match(/event:\s*endpoint\s*\r?\n(?:id:.*\r?\n)?data:\s*([^\r\n]+)/i);
    const endpointLine = streamText.split(/\r?\n/).find((line) => line.startsWith("data:") && /^\s*https?:\/\//.test(line.slice(5)));
    const endpoint = endpointMatch?.[1]?.trim() || endpointLine?.slice(5).trim();
    if (!endpoint) {
      const data = parseMcpResponse(streamText) as { result?: unknown; error?: { message?: string } };
      if (data.error) throw new Error(data.error.message || "MCP request failed");
      return data.result ?? data;
    }
    response = await fetch(new URL(endpoint, row.url).toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(15_000),
    });
  } else {
    response = await fetch(row.url, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(15_000),
    });
  }
  const text = await response.text();
  if (response.status === 401 && row.oauth) {
    const oauth = decodeOAuth(row.oauth);
    if (!retried && oauth && (await refreshRow(row, oauth))?.accessToken) return requestMcp(row, method, params, true);
    throw new McpAuthRequiredError();
  }
  if (!response.ok) throw new Error(`MCP request failed (${response.status})`);
  const responseSession = response.headers.get("mcp-session-id");
  if (responseSession) sessions.set(`${row.userId}:${row.id}`, responseSession);
  if (!text.trim()) return {};
  const data = parseMcpResponse(text) as { error?: { message?: string }; result?: unknown };
  if (data.error) throw new Error(data.error.message || "MCP request failed");
  return data.result ?? data;
}

async function ensureInitialized(row: McpRow) {
  const key = `${row.userId}:${row.id}`;
  if (sessions.has(key)) return;
  await requestMcp(row, "initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "Deni Run", version: "0.1.0" },
  });
  await requestMcp(row, "notifications/initialized").catch(() => undefined);
}

export async function testMcpConnection(userId: string, id: string) {
  const row = await getMcpRow(userId, id);
  if (!row) throw new Error("MCP connection not found");
  try {
    await ensureInitialized(row);
    const result = await requestMcp(row, "tools/list");
    await db
      .update(mcpConnections)
      .set({ lastTestAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(and(eq(mcpConnections.userId, userId), eq(mcpConnections.id, id)));
    return { ok: true, tools: rememberTools(row, result) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(mcpConnections)
      .set({ lastTestAt: new Date(), lastError: message, updatedAt: new Date() })
      .where(and(eq(mcpConnections.userId, userId), eq(mcpConnections.id, id)));
    throw new Error(message);
  }
}

export async function callMcpTool(userId: string, id: string, name: string, argumentsValue: unknown) {
  const row = await getMcpRow(userId, id);
  if (!row || !row.enabled) throw new Error("MCP connection is not available");
  if (!name.trim() || name.length > 160) throw new Error("MCP tool name is invalid");
  await ensureInitialized(row);
  return requestMcp(row, "tools/call", { name, arguments: argumentsValue ?? {} });
}

export async function listMcpTools(userId: string, id: string) {
  const row = await getMcpRow(userId, id);
  if (!row || !row.enabled) throw new Error("MCP connection is not available");
  await ensureInitialized(row);
  const result = await requestMcp(row, "tools/list");
  rememberTools(row, result);
  return result;
}

function rememberTools(row: McpRow, result: unknown) {
  const tools = (result as { tools?: unknown })?.tools;
  const list = Array.isArray(tools) ? (tools as McpTool[]) : [];
  toolLists.set(`${row.userId}:${row.id}`, list);
  return list;
}

/**
 * Whether a tool call can run without asking. Always allow is per connection and tool;
 * tools that a catalog server marks read-only also run freely, since those servers are known.
 * Read-only hints from custom servers are not trusted.
 */
export async function mcpCallPreapproved(userId: string, id: string, name: string, options?: { readOnly?: boolean }) {
  if (!options?.readOnly && (await readStore(userId)).mcpAlwaysAllow?.[`${id}:${name}`]) return true;
  const row = await getMcpRow(userId, id);
  if (!row?.enabled || !mcpCatalogEntry(row.catalogId)) return false;
  const key = `${userId}:${id}`;
  if (!toolLists.has(key)) await listMcpTools(userId, id).catch(() => undefined);
  return toolLists.get(key)?.find((tool) => tool.name === name)?.annotations?.readOnlyHint === true;
}

/**
 * What an approval card needs to explain a call: the connection, the tool's own title,
 * description, and argument descriptions from its tools/list entry, and readable names for IDs
 * among the arguments where the connector can look them up (Slack channels and people).
 */
export async function describeMcpTool(userId: string, id: string, name: string, args?: Record<string, unknown>) {
  const row = await getMcpRow(userId, id);
  if (!row) throw new Error("MCP connection not found");
  const key = `${userId}:${id}`;
  if (!toolLists.has(key)) await listMcpTools(userId, id).catch(() => undefined);
  const tool = toolLists.get(key)?.find((item) => item.name === name);
  const properties = tool?.inputSchema?.properties ?? {};
  const names = row.catalogId === "slack" && args
    ? await slackArgumentNames(key, args, (tool, input) => callMcpTool(userId, id, tool, input))
    : {};
  return {
    connection: { id: row.id, name: row.name, catalogId: row.catalogId ?? null },
    names,
    tool: tool
      ? {
          name: tool.name,
          title: tool.title ?? tool.annotations?.title ?? null,
          description: tool.description?.slice(0, 1_000) ?? null,
          destructive: tool.annotations?.destructiveHint === true,
          arguments: Object.fromEntries(
            Object.entries(properties).map(([argument, schema]) => [
              argument,
              { title: schema?.title ?? null, description: schema?.description?.slice(0, 300) ?? null },
            ]),
          ),
        }
      : null,
  };
}

export async function setMcpAlwaysAllow(userId: string, id: string, name: string, enabled: boolean) {
  if (!(await getMcpRow(userId, id))) throw new Error("MCP connection not found");
  if (!name.trim() || name.length > 160) throw new Error("MCP tool name is invalid");
  await mutateStore(userId, (store) => {
    store.mcpAlwaysAllow ??= {};
    if (enabled) store.mcpAlwaysAllow[`${id}:${name}`] = true;
    else delete store.mcpAlwaysAllow[`${id}:${name}`];
  });
}

/** Tool names of a connection that run without asking. */
export async function mcpAlwaysAllowed(userId: string, id: string) {
  const allowed = (await readStore(userId)).mcpAlwaysAllow ?? {};
  return Object.keys(allowed)
    .filter((key) => allowed[key] && key.startsWith(`${id}:`))
    .map((key) => key.slice(id.length + 1));
}

/** Add a catalog connector once per account; adding it again returns the existing row. */
async function catalogRow(userId: string, catalogId: string) {
  const entry = mcpCatalogEntry(catalogId);
  if (!entry) throw new Error("Unknown connector");
  const rows = await db
    .select()
    .from(mcpConnections)
    .where(and(eq(mcpConnections.userId, userId), eq(mcpConnections.catalogId, catalogId)))
    .limit(1);
  if (rows[0]) return rows[0];
  const taken = await db.select({ name: mcpConnections.name }).from(mcpConnections).where(eq(mcpConnections.userId, userId));
  const names = new Set(taken.map((row) => row.name.trim().toLowerCase()));
  let name = entry.name;
  for (let index = 2; names.has(name.toLowerCase()); index += 1) name = `${entry.name} ${index}`;
  const [row] = await db
    .insert(mcpConnections)
    .values({ id: createId("mcp"), userId, name, url: entry.url, transport: "streamable-http", headers: {}, catalogId, enabled: true })
    .returning();
  if (!row) throw new Error("MCP connection not found");
  return row;
}

/**
 * Begin OAuth for a connection, adding a catalog connector first. Returns the URL to send the
 * browser to, or a null URL when the server needs no sign-in.
 */
export async function startMcpSignIn(userId: string, target: { id?: string; catalogId?: string }, appUrl: string) {
  // Check the connector's client before adding its row, so a failed connect leaves nothing behind.
  const requested = target.catalogId ? mcpCatalogEntry(target.catalogId) : undefined;
  if (requested?.clientEnv && !process.env[requested.clientEnv.id]?.trim()) throw new Error("This connector is not set up on this server yet");
  const row = target.catalogId ? await catalogRow(userId, target.catalogId) : target.id ? await getMcpRow(userId, target.id) : null;
  if (!row) throw new Error("MCP connection not found");
  const entry = mcpCatalogEntry(row.catalogId);
  let client: { clientId: string; clientSecret?: string } | undefined;
  if (entry?.clientEnv) {
    const clientId = process.env[entry.clientEnv.id]?.trim();
    if (!clientId) throw new Error("This connector is not set up on this server yet");
    client = { clientId, clientSecret: process.env[entry.clientEnv.secret]?.trim() || undefined };
  }
  const started = await beginMcpOAuth({ mcpUrl: row.url, appUrl, stateKey: row.id, previous: decodeOAuth(row.oauth), client, scope: entry?.scope });
  if (!started) return { connection: publicConnection(row), authorizeUrl: null };
  await saveOAuth(row, started.oauth);
  return { connection: publicConnection(row), authorizeUrl: started.authorizeUrl };
}

/** Finish OAuth from the callback, then check the connection by listing its tools. */
export async function finishMcpSignIn(userId: string, params: { state: string; code: string; iss?: string | null }) {
  const id = params.state.split(".")[0] ?? "";
  const row = await getMcpRow(userId, id);
  const oauth = decodeOAuth(row?.oauth);
  if (!row || !oauth) throw new Error("This sign-in link has expired. Start again.");
  await saveOAuth(row, await completeMcpOAuth(oauth, params));
  sessions.delete(`${userId}:${id}`);
  toolLists.delete(`${userId}:${id}`);
  await testMcpConnection(userId, id).catch(() => undefined);
  return publicConnection((await getMcpRow(userId, id)) ?? row);
}


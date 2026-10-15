import "@tanstack/react-start/server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { mcpConnections } from "@/db/schema";
import { encryptSecret, decryptSecret } from "./secrets";
import { createId } from "./ids";
import type { McpConnection } from "./types";

type McpHeaders = Record<string, string>;

const sessions = new Map<string, string>();

function encodeHeaders(headers: McpHeaders): McpHeaders {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, encryptSecret(value)]));
}

function decodeHeaders(headers: McpHeaders): McpHeaders {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, decryptSecret(value)]));
}

function publicConnection(row: typeof mcpConnections.$inferSelect): McpConnection {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    transport: row.transport as McpConnection["transport"],
    enabled: row.enabled,
    hasSecret: Boolean(row.authSecret),
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

async function requestMcp(row: typeof mcpConnections.$inferSelect, method: string, params?: unknown) {
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    ...decodeHeaders(row.headers),
  };
  if (row.authSecret) headers.Authorization = `Bearer ${decryptSecret(row.authSecret)}`;
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
  if (!response.ok) throw new Error(`MCP request failed (${response.status})`);
  const responseSession = response.headers.get("mcp-session-id");
  if (responseSession) sessions.set(`${row.userId}:${row.id}`, responseSession);
  if (!text.trim()) return {};
  const data = parseMcpResponse(text) as { error?: { message?: string }; result?: unknown };
  if (data.error) throw new Error(data.error.message || "MCP request failed");
  return data.result ?? data;
}

async function ensureInitialized(row: typeof mcpConnections.$inferSelect) {
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
    return { ok: true, tools: Array.isArray((result as { tools?: unknown[] })?.tools) ? (result as { tools: unknown[] }).tools : [] };
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
  return result;
}

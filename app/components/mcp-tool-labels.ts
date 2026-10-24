import { useEffect, useState } from "react";
import type { McpConnection } from "@/lib/types";

// Shared by every tool step on the page. A step naming an ID the list does not have yet (the
// connection was added after the page loaded) asks again.
let namesRequest: Promise<Record<string, string>> | null = null;

function loadNames(fresh = false) {
  if (fresh) namesRequest = null;
  namesRequest ??= fetch("/api/mcp", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : { connections: [] }))
    .then((data: { connections?: McpConnection[] }) =>
      Object.fromEntries((data.connections ?? []).map((connection) => [connection.id, connection.name])),
    )
    .catch(() => {
      namesRequest = null;
      return {};
    });
  return namesRequest;
}

/** Names of all MCP connections by ID, read fresh whenever a component using it mounts. */
export function useMcpConnectionNames() {
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    void loadNames(true).then((loaded) => {
      if (active) setNames(loaded);
    });
    return () => {
      active = false;
    };
  }, []);
  return names;
}

export type McpToolDescription = {
  connection: { id: string; name: string; catalogId: string | null };
  /** Readable names for ID arguments, such as "#general" for a Slack channel ID. */
  names: Record<string, string>;
  tool: {
    name: string;
    title: string | null;
    description: string | null;
    destructive: boolean;
    arguments: Record<string, { title: string | null; description: string | null }>;
  } | null;
};

const descriptions = new Map<string, Promise<McpToolDescription | null>>();

/** The connection, the tool's own title and descriptions, and names for ID arguments. */
export function useMcpToolDescription(connectionId: string | undefined, tool: string | undefined, args?: Record<string, unknown>) {
  const [description, setDescription] = useState<McpToolDescription | null>(null);
  const argsKey = JSON.stringify(args ?? {});
  useEffect(() => {
    if (!connectionId || !tool) return;
    const key = `${connectionId}:${tool}:${argsKey}`;
    let request = descriptions.get(key);
    if (!request) {
      request = fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "describe", id: connectionId, tool, arguments: JSON.parse(argsKey) }),
      })
        .then((response) => (response.ok ? (response.json() as Promise<McpToolDescription>) : null))
        .catch(() => null);
      descriptions.set(key, request);
    }
    let active = true;
    void request.then((result) => {
      if (!result) descriptions.delete(key);
      if (active) setDescription(result);
    });
    return () => {
      active = false;
    };
  }, [connectionId, tool, argsKey]);
  return description;
}

/** "slack_send_message" on Slack reads as "send message". */
export function mcpToolTitle(tool: string, service?: string) {
  const prefix = service?.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const words = tool
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
  if (prefix && words.length > 1 && words[0] === prefix) words.shift();
  return words.join(" ");
}

/** "channel_id" reads as "Channel ID". */
export function mcpArgumentTitle(key: string) {
  const text = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-.]+/g, " ").trim().toLowerCase();
  return text.replace(/\b(id|url|ts)\b/g, (word) => word.toUpperCase()).replace(/^./, (first) => first.toUpperCase());
}

// Arguments that carry what will be written, shown in full instead of in the summary line.
const bodyKeys = new Set(["text", "message", "body", "content", "markdown", "description", "comment"]);

export function isMcpBodyArgument(key: string, value: unknown) {
  return typeof value === "string" && (bodyKeys.has(key.toLowerCase()) || value.length > 120);
}

export function mcpArgumentValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value) && value.every((item) => typeof item !== "object")) return value.join(", ");
  return JSON.stringify(value);
}

/** Short `key: value` summary and the long text body of an MCP tool call's arguments. */
export function mcpArgumentPreview(args: unknown) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return { summary: undefined, body: undefined };
  let body: string | undefined;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (!body && isMcpBodyArgument(key, value)) {
      body = value as string;
      continue;
    }
    if (value !== null && value !== undefined) parts.push(`${mcpArgumentTitle(key)}: ${mcpArgumentValue(value)}`);
  }
  return { summary: parts.join(" · ") || undefined, body };
}

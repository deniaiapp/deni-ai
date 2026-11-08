/**
 * Names for the Slack IDs in a tool call, so an approval card can say "#general" instead of
 * "C0CCPF98GRW". Looked up with the Slack MCP server's own read-only tools; its answers are
 * markdown text, so anything that does not parse is left as the ID.
 */

type CallTool = (name: string, args: Record<string, unknown>) => Promise<unknown>;

const channelCache = new Map<string, { at: number; names: Map<string, string> }>();
const userCache = new Map<string, string>();
const cacheMs = 10 * 60_000;

function resultText(result: unknown) {
  const content = (result as { content?: { type?: string; text?: string }[] })?.content ?? [];
  const text = content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
  // Slack wraps its markdown in a JSON string under "result".
  try {
    const parsed = JSON.parse(text) as { result?: unknown; results?: unknown };
    const inner = parsed.result ?? parsed.results;
    if (typeof inner === "string") return inner;
  } catch {
    // Already plain text.
  }
  return text;
}

async function channelNames(cacheKey: string, call: CallTool) {
  const cached = channelCache.get(cacheKey);
  if (cached && Date.now() - cached.at < cacheMs) return cached.names;
  const names = new Map<string, string>();
  const text = resultText(
    await call("slack_list_user_channels", { limit: 200, exclude_archived: false }),
  );
  for (const match of text.matchAll(
    /^###\s+(#?\S+)\s*\n(?:.*\n)*?-\s+\*\*ID:\*\*\s+([A-Z0-9]+)/gm,
  )) {
    const [, name, id] = match;
    if (name && id) names.set(id, name.startsWith("#") ? name : `#${name}`);
  }
  channelCache.set(cacheKey, { at: Date.now(), names });
  return names;
}

async function userName(cacheKey: string, id: string, call: CallTool) {
  const key = `${cacheKey}:${id}`;
  const cached = userCache.get(key);
  if (cached) return cached;
  const text = resultText(await call("slack_read_user_profile", { user_id: id }));
  const field = (label: string) =>
    text.match(new RegExp(`^${label}:[ \\t]*(.+)$`, "m"))?.[1]?.trim();
  const name = field("Display Name") || field("Real Name") || field("Username");
  if (!name) return undefined;
  userCache.set(key, `@${name}`);
  return `@${name}`;
}

/** Readable names for Slack channel and user IDs among the arguments, by argument key. */
export async function slackArgumentNames(
  cacheKey: string,
  args: Record<string, unknown>,
  call: CallTool,
) {
  const names: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value !== "string" || !/^[CGDUW][A-Z0-9]{6,}$/.test(value)) continue;
    try {
      if (/^[CG]/.test(value)) {
        const name = (await channelNames(cacheKey, call)).get(value);
        if (name) names[key] = name;
      } else if (/^[UW]/.test(value)) {
        const name = await userName(cacheKey, value, call);
        if (name) names[key] = key === "channel_id" ? `${name} (DM)` : name;
      } else if (value.startsWith("D") && key === "channel_id") {
        names[key] = "DM";
      }
    } catch {
      // A lookup that fails leaves the ID as it is.
    }
  }
  return names;
}

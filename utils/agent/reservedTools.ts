/**
 * OpenAI GPT-5+ models reserve the `collaboration.*` function namespace
 * for hosted multi-agent tools (Sol, Terra, Luna, GPT-5.5, Codex, …).
 * A client-defined function with one of those names is rejected when its
 * schema does not exactly match the hosted schema.
 *
 * Flixa keeps the client-facing name, but uses a provider-safe private name
 * while talking to the upstream API. The same mapping is applied to tool
 * history and reversed on responses, so clients do not need to change their
 * tool definitions.
 */

export const RESERVED_COLLABORATION_PREFIX = "collaboration.";
export const RESERVED_COLLABORATION_NAMESPACE = "collaboration";
export const SAFE_COLLABORATION_NAMESPACE = "flixa_collab";
export const SAFE_COLLABORATION_PREFIX = "flixa_collab_";
export const SAFE_COLLABORATION_DOT_PREFIX = "flixa_collab.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedName(name: string): string {
  return name.toLowerCase();
}

/** Models currently known to expose the reserved collaboration namespace. */
export function modelReservesCollaborationTools(model: string): boolean {
  const normalized = model.toLowerCase();
  const slug = normalized.includes("/")
    ? normalized.slice(normalized.lastIndexOf("/") + 1)
    : normalized;

  // GPT-5 and later OpenAI models (5, 5.2, 5.3-codex, 5.4, 5.5, 5.6-sol/terra/luna).
  return slug.startsWith("gpt-5");
}

export function isReservedCollaborationToolName(name: string): boolean {
  const normalized = normalizedName(name);
  return (
    normalized === RESERVED_COLLABORATION_NAMESPACE ||
    normalized.startsWith(RESERVED_COLLABORATION_PREFIX) ||
    normalized.startsWith("functions.collaboration.")
  );
}

export function isSafeCollaborationProxyName(name: string): boolean {
  return (
    name === SAFE_COLLABORATION_NAMESPACE ||
    name.startsWith(SAFE_COLLABORATION_PREFIX) ||
    name.startsWith(SAFE_COLLABORATION_DOT_PREFIX)
  );
}

/** Convert a client-visible collaboration name into a valid private name. */
export function rewriteCollaborationNameOutbound(name: string): string {
  if (isSafeCollaborationProxyName(name)) {
    return name;
  }

  const normalized = normalizedName(name);
  if (normalized === RESERVED_COLLABORATION_NAMESPACE) {
    return SAFE_COLLABORATION_NAMESPACE;
  }

  if (normalized.startsWith(RESERVED_COLLABORATION_PREFIX)) {
    return SAFE_COLLABORATION_PREFIX + name.slice(RESERVED_COLLABORATION_PREFIX.length);
  }

  if (normalized.startsWith("functions.collaboration.")) {
    return SAFE_COLLABORATION_PREFIX + name.slice("functions.collaboration.".length);
  }

  return name;
}

/** Convert a private upstream name back to the client-visible name. */
export function rewriteCollaborationNameInbound(name: string): string {
  if (name === SAFE_COLLABORATION_NAMESPACE) {
    return RESERVED_COLLABORATION_NAMESPACE;
  }

  if (name.startsWith(SAFE_COLLABORATION_DOT_PREFIX)) {
    return RESERVED_COLLABORATION_PREFIX + name.slice(SAFE_COLLABORATION_DOT_PREFIX.length);
  }

  if (!name.startsWith(SAFE_COLLABORATION_PREFIX)) {
    return name;
  }

  return RESERVED_COLLABORATION_PREFIX + name.slice(SAFE_COLLABORATION_PREFIX.length);
}

/** Extract a function name from Responses or Chat Completions tool syntax. */
export function getFunctionToolName(tool: unknown): string | null {
  return collectFunctionToolNames(tool)[0] ?? null;
}

function collectFunctionToolNames(tool: unknown): string[] {
  if (!isRecord(tool)) {
    return [];
  }

  const names: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string" && value.length > 0) {
      names.push(value);
    }
  };

  push(tool.name);
  if (isRecord(tool.function)) {
    push(tool.function.name);
  }
  if (isRecord(tool.custom)) {
    push(tool.custom.name);
  }
  if (typeof tool.type === "string" && isReservedCollaborationToolName(tool.type)) {
    push(tool.type);
  }

  return names;
}

function usesChatFunctionWrapper(tools: unknown[]): boolean {
  return tools.some((tool) => {
    if (!isRecord(tool) || isRecord(tool.function) === false) {
      return false;
    }

    return (
      typeof tool.function.name === "string" &&
      (tool.name === undefined || typeof tool.name !== "string")
    );
  });
}

function toSafeFunctionTool(
  source: Record<string, unknown>,
  safeName: string,
  chatStyle: boolean,
): Record<string, unknown> {
  const functionRecord = isRecord(source.function) ? source.function : null;
  const description =
    (typeof source.description === "string" ? source.description : undefined) ??
    (functionRecord && typeof functionRecord.description === "string"
      ? functionRecord.description
      : undefined);
  const parameters =
    (isRecord(source.parameters) ? source.parameters : undefined) ??
    (functionRecord && isRecord(functionRecord.parameters)
      ? functionRecord.parameters
      : undefined);
  const strict =
    (typeof source.strict === "boolean" ? source.strict : undefined) ??
    (functionRecord && typeof functionRecord.strict === "boolean"
      ? functionRecord.strict
      : undefined);

  if (chatStyle || (functionRecord !== null && typeof source.name !== "string")) {
    const nextFunction: Record<string, unknown> = functionRecord
      ? { ...functionRecord, name: safeName }
      : { name: safeName };
    if (description !== undefined) {
      nextFunction.description = description;
    }
    if (parameters !== undefined) {
      nextFunction.parameters = parameters;
    }
    if (strict !== undefined) {
      nextFunction.strict = strict;
    }
    return { type: "function", function: nextFunction };
  }

  const next: Record<string, unknown> = {
    type: "function",
    name: safeName,
  };
  if (description !== undefined) {
    next.description = description;
  }
  if (parameters !== undefined) {
    next.parameters = parameters;
  }
  if (strict !== undefined) {
    next.strict = strict;
  }
  return next;
}

function setFunctionToolName(tool: unknown, name: string): unknown {
  if (!isRecord(tool)) {
    return tool;
  }

  const next: Record<string, unknown> = { ...tool };
  let changed = false;

  if (typeof tool.name === "string") {
    next.name = name;
    changed = true;
  }

  if (isRecord(tool.function) && typeof tool.function.name === "string") {
    next.function = { ...tool.function, name };
    changed = true;
  }

  if (isRecord(tool.custom) && typeof tool.custom.name === "string") {
    next.custom = { ...tool.custom, name };
    changed = true;
  }

  if (typeof tool.type === "string" && isReservedCollaborationToolName(tool.type)) {
    return toSafeFunctionTool(tool, name, isRecord(tool.function) && typeof tool.name !== "string");
  }

  return changed ? next : tool;
}

function collaborationFunctionName(name: string): string {
  if (isReservedCollaborationToolName(name) || isSafeCollaborationProxyName(name)) {
    return name;
  }

  return `${RESERVED_COLLABORATION_PREFIX}${name}`;
}

function flattenCollaborationNamespaceTool(
  tool: unknown,
  chatStyle: boolean,
): unknown[] | null {
  if (!isRecord(tool) || tool.type !== "namespace") {
    return null;
  }

  const namespace = typeof tool.name === "string" ? tool.name : "";
  if (!isReservedCollaborationToolName(namespace)) {
    return null;
  }

  const inner = Array.isArray(tool.tools)
    ? tool.tools
    : Array.isArray(tool.functions)
      ? tool.functions
      : [];

  if (inner.length === 0) {
    return [];
  }

  return inner.map((entry) => {
    const source = isRecord(entry) ? entry : {};
    const rawName = getFunctionToolName(source) ?? "tool";
    const safeName = rewriteCollaborationNameOutbound(collaborationFunctionName(rawName));
    return toSafeFunctionTool(source, safeName, chatStyle);
  });
}

function rewriteSingleReservedTool(tool: unknown, chatStyle: boolean): {
  tools: unknown[];
  rewritten: number;
} {
  const flattened = flattenCollaborationNamespaceTool(tool, chatStyle);
  if (flattened !== null) {
    return { tools: flattened, rewritten: flattened.length > 0 ? flattened.length : 1 };
  }

  const names = collectFunctionToolNames(tool);
  const reservedName = names.find((name) => isReservedCollaborationToolName(name));
  if (!reservedName) {
    return { tools: [tool], rewritten: 0 };
  }

  return {
    tools: [setFunctionToolName(tool, rewriteCollaborationNameOutbound(reservedName))],
    rewritten: 1,
  };
}

export function rewriteReservedCollaborationTools(
  tools: unknown[] | undefined,
  options?: { chatStyle?: boolean },
): {
  tools: unknown[] | undefined;
  rewritten: number;
} {
  if (!tools || tools.length === 0) {
    return { tools, rewritten: 0 };
  }

  const chatStyle = options?.chatStyle ?? usesChatFunctionWrapper(tools);
  let rewritten = 0;
  const next: unknown[] = [];

  for (const tool of tools) {
    const result = rewriteSingleReservedTool(tool, chatStyle);
    rewritten += result.rewritten;
    next.push(...result.tools);
  }

  return { tools: next, rewritten };
}

/** Backwards-compatible name for callers that previously stripped tools. */
export function stripReservedCollaborationTools(
  tools: unknown[] | undefined,
  _model?: string,
): unknown[] | undefined {
  return rewriteReservedCollaborationTools(tools).tools;
}

export function rewriteToolChoiceCollaborationName(toolChoice: unknown): {
  toolChoice: unknown;
  rewritten: boolean;
} {
  if (!isRecord(toolChoice)) {
    return { toolChoice, rewritten: false };
  }

  if (typeof toolChoice.name === "string" && isReservedCollaborationToolName(toolChoice.name)) {
    return {
      toolChoice: {
        ...toolChoice,
        name: rewriteCollaborationNameOutbound(toolChoice.name),
      },
      rewritten: true,
    };
  }

  if (
    isRecord(toolChoice.function) &&
    typeof toolChoice.function.name === "string" &&
    isReservedCollaborationToolName(toolChoice.function.name)
  ) {
    return {
      toolChoice: {
        ...toolChoice,
        function: {
          ...toolChoice.function,
          name: rewriteCollaborationNameOutbound(toolChoice.function.name),
        },
      },
      rewritten: true,
    };
  }

  return { toolChoice, rewritten: false };
}

export function sanitizeToolChoiceForReservedCollaboration(
  toolChoice: unknown,
  _model?: string,
): unknown {
  return rewriteToolChoiceCollaborationName(toolChoice).toolChoice;
}

function isFunctionCallLikeType(type: unknown): boolean {
  return (
    type === "function_call" ||
    type === "custom_tool_call" ||
    type === "tool_use" ||
    type === "server_tool_use"
  );
}

function isToolDefinitionType(type: unknown): boolean {
  return type === "function" || type === "custom" || type === "namespace";
}

type NameRewrite = (name: string) => string;

function rewriteToolNameFields(
  value: unknown,
  rewriteName: NameRewrite,
): { value: unknown; count: number } {
  let count = 0;

  const rewriteFunctionObject = (functionValue: Record<string, unknown>) => {
    let changed = false;
    const next: Record<string, unknown> = { ...functionValue };

    if (
      typeof functionValue.name === "string" &&
      rewriteName(functionValue.name) !== functionValue.name
    ) {
      next.name = rewriteName(functionValue.name);
      count += 1;
      changed = true;
    }

    for (const [key, child] of Object.entries(functionValue)) {
      if (key === "name") {
        continue;
      }

      const rewritten = walk(child);
      if (rewritten !== child) {
        next[key] = rewritten;
        changed = true;
      }
    }

    return changed ? next : functionValue;
  };

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      let changed = false;
      const next = node.map((child) => {
        const rewritten = walk(child);
        changed ||= rewritten !== child;
        return rewritten;
      });
      return changed ? next : node;
    }

    if (!isRecord(node)) {
      return node;
    }

    const functionCallLike = isFunctionCallLikeType(node.type);
    const toolDefinition = isToolDefinitionType(node.type);
    let changed = false;
    const next: Record<string, unknown> = { ...node };

    for (const [key, child] of Object.entries(node)) {
      if (key === "type" && typeof child === "string" && isReservedCollaborationToolName(child)) {
        const rewrittenType = rewriteName(child);
        if (rewrittenType !== child) {
          next.type = "function";
          if (typeof node.name !== "string") {
            next.name = rewrittenType;
          }
          count += 1;
          changed = true;
        }
        continue;
      }

      if (
        key === "name" &&
        typeof child === "string" &&
        (functionCallLike ||
          toolDefinition ||
          isReservedCollaborationToolName(child) ||
          isSafeCollaborationProxyName(child))
      ) {
        const rewrittenName = rewriteName(child);
        if (rewrittenName !== child) {
          next[key] = rewrittenName;
          count += 1;
          changed = true;
        }
        continue;
      }

      if (key === "function" && isRecord(child)) {
        const rewrittenFunction = rewriteFunctionObject(child);
        if (rewrittenFunction !== child) {
          next[key] = rewrittenFunction;
          changed = true;
        }
        continue;
      }

      const rewritten = walk(child);
      if (rewritten !== child) {
        next[key] = rewritten;
        changed = true;
      }
    }

    return changed ? next : node;
  };

  return { value: walk(value), count };
}

export function deepRewriteReservedCollaborationNames(value: unknown): {
  value: unknown;
  count: number;
} {
  return rewriteToolNameFields(value, rewriteCollaborationNameOutbound);
}

export function rewriteCollaborationNamesInInput(input: unknown): {
  input: unknown;
  rewritten: number;
} {
  const result = deepRewriteReservedCollaborationNames(input);
  return { input: result.value, rewritten: result.count };
}

export type CollaborationRewriteStats = {
  toolsRewritten: number;
  toolChoiceRewritten: boolean;
  inputNamesRewritten: number;
};

/** Apply the outbound mapping to a Responses or Chat request body. */
export function sanitizeReservedCollaborationInResponsesRequest(
  request: Record<string, unknown>,
  _model?: string,
): CollaborationRewriteStats {
  const stats: CollaborationRewriteStats = {
    toolsRewritten: 0,
    toolChoiceRewritten: false,
    inputNamesRewritten: 0,
  };

  const chatStyle =
    Array.isArray(request.messages) && request.input === undefined;

  if (Array.isArray(request.tools)) {
    const rewrittenTools = rewriteReservedCollaborationTools(request.tools, {
      chatStyle,
    });
    request.tools = rewrittenTools.tools;
    stats.toolsRewritten = rewrittenTools.rewritten;
  }

  if (Array.isArray(request.functions)) {
    const rewrittenFunctions = rewriteReservedCollaborationTools(request.functions, {
      chatStyle,
    });
    request.functions = rewrittenFunctions.tools;
    stats.toolsRewritten += rewrittenFunctions.rewritten;
  }

  if (request.tool_choice !== undefined) {
    const rewrittenChoice = rewriteToolChoiceCollaborationName(request.tool_choice);
    request.tool_choice = rewrittenChoice.toolChoice;
    stats.toolChoiceRewritten = rewrittenChoice.rewritten;
  }

  if (request.input !== undefined) {
    const rewrittenInput = rewriteCollaborationNamesInInput(request.input);
    request.input = rewrittenInput.input;
    stats.inputNamesRewritten += rewrittenInput.rewritten;
  }

  if (request.messages !== undefined) {
    const rewrittenMessages = rewriteCollaborationNamesInInput(request.messages);
    request.messages = rewrittenMessages.input;
    stats.inputNamesRewritten += rewrittenMessages.rewritten;
  }

  const deepRewritten = deepRewriteReservedCollaborationNames(request);
  stats.inputNamesRewritten += deepRewritten.count;
  if (deepRewritten.value !== request && isRecord(deepRewritten.value)) {
    for (const [key, value] of Object.entries(deepRewritten.value)) {
      request[key] = value;
    }
  }

  return stats;
}

/** Reverse the mapping in a non-streaming Responses payload. */
export function rewriteCollaborationNamesInResponsesPayload(payload: unknown): unknown {
  return rewriteToolNameFields(payload, rewriteCollaborationNameInbound).value;
}

/** Reverse the mapping in a non-streaming Chat Completions payload. */
export function rewriteCollaborationNamesInChatPayload(payload: unknown): unknown {
  return rewriteToolNameFields(payload, rewriteCollaborationNameInbound).value;
}

/** Reverse the mapping in one SSE event block. */
export function rewriteCollaborationNamesInSseEventBlock(eventBlock: string): string {
  if (
    !eventBlock.includes(SAFE_COLLABORATION_PREFIX) &&
    !eventBlock.includes(SAFE_COLLABORATION_DOT_PREFIX)
  ) {
    return eventBlock;
  }

  return eventBlock
    .split(/\r?\n/)
    .map((line) => {
      if (!line.startsWith("data:")) {
        return line;
      }

      const rest = line.slice("data:".length);
      const trimmed = rest.trimStart();
      if (!trimmed || trimmed === "[DONE]") {
        return line;
      }

      try {
        const parsed = JSON.parse(trimmed) as unknown;
        const rewritten = rewriteCollaborationNamesInResponsesPayload(parsed);
        const leadingWhitespace = rest.slice(0, rest.length - trimmed.length);
        return `data:${leadingWhitespace}${JSON.stringify(rewritten)}`;
      } catch {
        // A malformed/non-JSON data line should not break the stream.
        return line;
      }
    })
    .join("\n");
}

function toolContainsReservedCollaborationName(tool: unknown): boolean {
  if (Array.isArray(tool)) {
    return tool.some(toolContainsReservedCollaborationName);
  }

  if (!isRecord(tool)) {
    return false;
  }

  if (collectFunctionToolNames(tool).some(isReservedCollaborationToolName)) {
    return true;
  }

  if (Array.isArray(tool.tools) && tool.tools.some(toolContainsReservedCollaborationName)) {
    return true;
  }

  if (
    Array.isArray(tool.functions) &&
    tool.functions.some(toolContainsReservedCollaborationName)
  ) {
    return true;
  }

  return false;
}

export function requestHasReservedCollaborationToolNames(
  request: Record<string, unknown>,
): boolean {
  if (Array.isArray(request.tools) && request.tools.some(toolContainsReservedCollaborationName)) {
    return true;
  }

  if (
    Array.isArray(request.functions) &&
    request.functions.some(toolContainsReservedCollaborationName)
  ) {
    return true;
  }

  return false;
}

/** Final defensive guard for the exact body that is about to be serialized. */
export function assertNoReservedCollaborationToolsInUpstreamBody(
  request: Record<string, unknown>,
  model?: string,
): void {
  sanitizeReservedCollaborationInResponsesRequest(request, model);

  if (!requestHasReservedCollaborationToolNames(request)) {
    return;
  }

  if (Array.isArray(request.tools)) {
    const remainingTools = request.tools.filter(
      (tool) => !toolContainsReservedCollaborationName(tool),
    );
    if (remainingTools.length === 0) {
      delete request.tools;
    } else {
      request.tools = remainingTools;
    }
  }

  if (Array.isArray(request.functions)) {
    const remainingFunctions = request.functions.filter(
      (tool) => !toolContainsReservedCollaborationName(tool),
    );
    if (remainingFunctions.length === 0) {
      delete request.functions;
    } else {
      request.functions = remainingFunctions;
    }
  }

  if (request.tool_choice !== undefined) {
    const rewrittenChoice = rewriteToolChoiceCollaborationName(request.tool_choice);
    request.tool_choice = rewrittenChoice.toolChoice;
    if (
      isRecord(request.tool_choice) &&
      collectFunctionToolNames(request.tool_choice).some(isReservedCollaborationToolName)
    ) {
      request.tool_choice = "auto";
    }
  }
}

/**
 * OpenAI's GPT-5.6 family reserves the `collaboration.*` function namespace
 * for hosted multi-agent tools. A client-defined function with one of those
 * names is rejected when its schema does not exactly match the hosted schema.
 *
 * Flixa keeps the client-facing name, but uses a provider-safe private name
 * while talking to the upstream API. The same mapping is applied to tool
 * history and reversed on responses, so clients do not need to change their
 * tool definitions.
 */

export const RESERVED_COLLABORATION_PREFIX = "collaboration.";
export const SAFE_COLLABORATION_PREFIX = "flixa_collab_";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Models currently known to expose the reserved collaboration namespace. */
export function modelReservesCollaborationTools(model: string): boolean {
  const normalized = model.toLowerCase();
  return normalized.includes("gpt-5.6") || normalized.includes("gpt-5-6");
}

export function isReservedCollaborationToolName(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    normalized.startsWith(RESERVED_COLLABORATION_PREFIX) ||
    normalized.startsWith("functions.collaboration.")
  );
}

export function isSafeCollaborationProxyName(name: string): boolean {
  return name.startsWith(SAFE_COLLABORATION_PREFIX);
}

/** Convert a client-visible collaboration name into a valid private name. */
export function rewriteCollaborationNameOutbound(name: string): string {
  if (isSafeCollaborationProxyName(name)) {
    return name;
  }

  const normalized = name.toLowerCase();
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
  if (!isSafeCollaborationProxyName(name)) {
    return name;
  }

  return RESERVED_COLLABORATION_PREFIX + name.slice(SAFE_COLLABORATION_PREFIX.length);
}

/** Extract a function name from Responses or Chat Completions tool syntax. */
export function getFunctionToolName(tool: unknown): string | null {
  if (!isRecord(tool)) {
    return null;
  }

  if (typeof tool.name === "string" && tool.name.length > 0) {
    return tool.name;
  }

  if (isRecord(tool.function) && typeof tool.function.name === "string") {
    return tool.function.name;
  }

  return null;
}

function setFunctionToolName(tool: unknown, name: string): unknown {
  if (!isRecord(tool)) {
    return tool;
  }

  if (typeof tool.name === "string") {
    return { ...tool, name };
  }

  if (isRecord(tool.function) && typeof tool.function.name === "string") {
    return {
      ...tool,
      function: { ...tool.function, name },
    };
  }

  return tool;
}

export function rewriteReservedCollaborationTools(tools: unknown[] | undefined): {
  tools: unknown[] | undefined;
  rewritten: number;
} {
  if (!tools || tools.length === 0) {
    return { tools, rewritten: 0 };
  }

  let rewritten = 0;
  const next = tools.map((tool) => {
    const name = getFunctionToolName(tool);
    if (!name || !isReservedCollaborationToolName(name)) {
      return tool;
    }

    rewritten += 1;
    return setFunctionToolName(tool, rewriteCollaborationNameOutbound(name));
  });

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
    let changed = false;
    const next: Record<string, unknown> = { ...node };

    for (const [key, child] of Object.entries(node)) {
      if (key === "name" && functionCallLike && typeof child === "string") {
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

  if (Array.isArray(request.tools)) {
    const rewrittenTools = rewriteReservedCollaborationTools(request.tools);
    request.tools = rewrittenTools.tools;
    stats.toolsRewritten = rewrittenTools.rewritten;
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
  if (!eventBlock.includes(SAFE_COLLABORATION_PREFIX)) {
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

export function requestHasReservedCollaborationToolNames(
  request: Record<string, unknown>,
): boolean {
  if (!Array.isArray(request.tools)) {
    return false;
  }

  return request.tools.some((tool) => {
    const name = getFunctionToolName(tool);
    return name !== null && isReservedCollaborationToolName(name);
  });
}

/** Final defensive guard for the exact body that is about to be serialized. */
export function assertNoReservedCollaborationToolsInUpstreamBody(
  request: Record<string, unknown>,
  model?: string,
): void {
  sanitizeReservedCollaborationInResponsesRequest(request, model);

  if (requestHasReservedCollaborationToolNames(request)) {
    delete request.tools;
    if (request.tool_choice !== undefined) {
      request.tool_choice = "auto";
    }
  }
}

import { flattenResponsesInputItems } from "./converters";

/**
 * Policy for non-function (server / hosted) tools in client requests.
 *
 * Auth checks the plan tier and billing against the request `model` only, so
 * tools that make the upstream run another model are not forwarded. All users
 * also share one OpenRouter key, so OpenRouter tools that keep a sandbox or a
 * file store on that key (bash, shell, apply_patch, files) are not forwarded
 * either: one user's files would be reachable from another user's request.
 */

// OpenRouter server tools that run no other model and keep no per-key state.
// Any other `openrouter:*` type (advisor, fusion, subagent, image_generation,
// bash, shell, apply_patch, files, unknown) is rejected on every route.
export const ALLOWED_OPENROUTER_TOOL_TYPES: ReadonlySet<string> = new Set([
  "openrouter:datetime",
  "openrouter:web_search",
  "openrouter:web_fetch",
  "openrouter:experimental__search_models",
]);

// Non-function tool types forwarded to OpenRouter's Responses API. Anything
// else (image_generation, code_interpreter, mcp, advisor_*, unknown) is
// rejected there, since OpenRouter may serve it by running another model.
const ALLOWED_OPENROUTER_RESPONSES_TOOL_TYPES: ReadonlySet<string> = new Set([
  "function",
  "custom",
  "namespace",
  "local_shell",
  "shell",
  "apply_patch",
  "web_search",
  "web_search_preview",
  "tool_search",
  ...ALLOWED_OPENROUTER_TOOL_TYPES,
]);

export type ToolPolicyRoute = "openrouter" | "other";

export type ToolPolicyViolation = { param: string; message: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for an `openrouter:*` type that is not in ALLOWED_OPENROUTER_TOOL_TYPES. */
export function isDisallowedOpenRouterToolType(type: string): boolean {
  const normalized = type.toLowerCase();
  return (
    normalized.startsWith("openrouter:") &&
    !ALLOWED_OPENROUTER_TOOL_TYPES.has(normalized)
  );
}

function hasModelSelection(tool: Record<string, unknown>): boolean {
  return (
    tool.model !== undefined ||
    (isObject(tool.parameters) && tool.parameters.model !== undefined)
  );
}

/**
 * Check one Responses tool (or tool_choice selector) and any tools nested in
 * it (namespace tools, allowed_tools lists). Returns the first violation.
 */
function findToolViolation(
  root: unknown,
  rootParam: string,
  route: ToolPolicyRoute,
  allowedTypes: ReadonlySet<string>,
): ToolPolicyViolation | null {
  const stack: Array<{ tool: unknown; param: string }> = [
    { tool: root, param: rootParam },
  ];

  while (stack.length > 0) {
    const { tool, param } = stack.pop()!;
    if (!isObject(tool) || typeof tool.type !== "string") {
      continue;
    }

    const type = tool.type.toLowerCase();

    if (isDisallowedOpenRouterToolType(type)) {
      return { param, message: `Tool type '${tool.type}' is not supported` };
    }

    if (route === "openrouter" && type !== "function") {
      if (!allowedTypes.has(type)) {
        return { param, message: `Tool type '${tool.type}' is not supported` };
      }

      if (hasModelSelection(tool)) {
        return { param, message: "Tools must not select a model" };
      }
    }

    if (Array.isArray(tool.tools)) {
      tool.tools.forEach((child, index) =>
        stack.push({ tool: child, param: `${param}.tools[${index}]` }),
      );
    }
  }

  return null;
}

function findToolListViolation(
  tools: unknown,
  param: string,
  route: ToolPolicyRoute,
): ToolPolicyViolation | null {
  if (!Array.isArray(tools)) {
    return null;
  }

  for (let i = 0; i < tools.length; i++) {
    const violation = findToolViolation(
      tools[i],
      `${param}[${i}]`,
      route,
      ALLOWED_OPENROUTER_RESPONSES_TOOL_TYPES,
    );
    if (violation) {
      return violation;
    }
  }

  return null;
}

/**
 * Input items such as `additional_tools` declare tools mid-conversation.
 * Check the `tools` array of every (flattened) input item.
 */
function findInputToolViolation(
  input: unknown,
  param: string,
  route: ToolPolicyRoute,
): ToolPolicyViolation | null {
  const items = flattenResponsesInputItems(input);
  if (!Array.isArray(items)) {
    return null;
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!isObject(item)) {
      continue;
    }

    const violation = findToolListViolation(
      item.tools,
      `${param}[${i}].tools`,
      route,
    );
    if (violation) {
      return violation;
    }
  }

  return null;
}

/**
 * Find the first disallowed tool in a Responses (or Responses compact) body:
 * `tools`, `tool_choice`, and tools declared inside `input` / `messages`.
 */
export function findResponsesToolPolicyViolation(
  body: {
    tools?: unknown;
    tool_choice?: unknown;
    input?: unknown;
    messages?: unknown;
  },
  route: ToolPolicyRoute,
): ToolPolicyViolation | null {
  return (
    findToolListViolation(body.tools, "tools", route) ??
    (isObject(body.tool_choice)
      ? findToolViolation(
          body.tool_choice,
          "tool_choice",
          route,
          new Set([...ALLOWED_OPENROUTER_RESPONSES_TOOL_TYPES, "allowed_tools"]),
        )
      : null) ??
    findInputToolViolation(body.input, "input", route) ??
    findInputToolViolation(body.messages, "messages", route)
  );
}

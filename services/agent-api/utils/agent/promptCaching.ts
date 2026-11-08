type PromptCacheTtl = "5m" | "1h";

interface PromptCacheControl {
  type: "ephemeral";
  ttl?: PromptCacheTtl;
}

function getPromptCacheTtl(): PromptCacheTtl {
  return process.env.FLIXA_PROMPT_CACHE_TTL === "1h" ? "1h" : "5m";
}

export function isPromptCachingEnabled(): boolean {
  const value = process.env.FLIXA_PROMPT_CACHE?.toLowerCase();
  return value !== "0" && value !== "false" && value !== "off";
}

export function isClaudeModel(model: string): boolean {
  const normalizedModel = model.toLowerCase();
  return normalizedModel.startsWith("anthropic/") || normalizedModel.includes("claude");
}

export function isGoogleModel(model: string): boolean {
  const normalizedModel = model.toLowerCase();
  return normalizedModel.startsWith("google/") || normalizedModel.includes("gemini");
}

export function getPromptCacheControl(): PromptCacheControl | undefined {
  if (!isPromptCachingEnabled()) {
    return undefined;
  }

  const ttl = getPromptCacheTtl();
  return ttl === "1h" ? { type: "ephemeral", ttl } : { type: "ephemeral" };
}

function hasOwnCacheControl(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return record.cache_control !== undefined || record.cacheControl !== undefined;
}

/**
 * Shallow scan for existing cache breakpoints in the places clients actually
 * put them: top-level, system blocks, messages, and message content blocks.
 * Avoids a full recursive walk of the request body (tool schemas can be huge).
 */
function hasPromptCacheBreakpoint(requestBody: Record<string, unknown>): boolean {
  if (hasOwnCacheControl(requestBody)) {
    return true;
  }

  if (Array.isArray(requestBody.system)) {
    if (requestBody.system.some(hasOwnCacheControl)) {
      return true;
    }
  }

  if (Array.isArray(requestBody.tools)) {
    if (requestBody.tools.some(hasOwnCacheControl)) {
      return true;
    }
  }

  if (!Array.isArray(requestBody.messages)) {
    return false;
  }

  return requestBody.messages.some((message) => {
    if (hasOwnCacheControl(message)) {
      return true;
    }

    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return false;
    }

    const content = (message as Record<string, unknown>).content;
    return Array.isArray(content) && content.some(hasOwnCacheControl);
  });
}

function isCacheableMessage(message: unknown): message is Record<string, unknown> {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return false;
  }

  const role = (message as Record<string, unknown>).role;
  return role === "system" || role === "developer" || role === "user";
}

function addCacheBreakpointToContent(content: unknown): unknown {
  if (typeof content === "string") {
    return content
      ? [{ type: "text", text: content, cache_control: { type: "ephemeral" } }]
      : content;
  }

  if (!Array.isArray(content)) {
    return content;
  }

  const targetIndex = content.findLastIndex(
    (part) =>
      part &&
      typeof part === "object" &&
      !Array.isArray(part) &&
      (part as Record<string, unknown>).type === "text" &&
      typeof (part as Record<string, unknown>).text === "string" &&
      (part as Record<string, unknown>).cache_control === undefined &&
      (part as Record<string, unknown>).cacheControl === undefined,
  );

  if (targetIndex === -1) {
    return content;
  }

  return content.map((part, index) =>
    index === targetIndex
      ? {
          ...(part as Record<string, unknown>),
          cache_control: { type: "ephemeral" },
        }
      : part,
  );
}

function addCacheControlToAnthropicBlocks(blocks: unknown[]): unknown[] {
  const cacheControl = getPromptCacheControl();
  if (!cacheControl) {
    return blocks;
  }

  const targetIndex = blocks.findLastIndex(
    (block) =>
      block &&
      typeof block === "object" &&
      !Array.isArray(block) &&
      ((block as Record<string, unknown>).type === "text" ||
        (block as Record<string, unknown>).type === "tool_result") &&
      (block as Record<string, unknown>).cache_control === undefined,
  );

  if (targetIndex === -1) {
    return blocks;
  }

  return blocks.map((block, index) =>
    index === targetIndex
      ? { ...(block as Record<string, unknown>), cache_control: cacheControl }
      : block,
  );
}

/**
 * Add explicit cache breakpoints to an Anthropic-native (Messages API) request
 * body. The native API has no top-level cache_control, so without breakpoints
 * a direct-to-Anthropic failover request gets zero prompt caching — which is
 * up to a 10x input-cost difference for agent workloads.
 *
 * Breakpoints are added to the system prompt and the last user message. If the
 * client already provided any breakpoint, the body is left untouched.
 */
export function applyAnthropicNativePromptCaching<
  T extends Record<string, unknown>,
>(requestBody: T): T {
  if (!isPromptCachingEnabled() || hasPromptCacheBreakpoint(requestBody)) {
    return requestBody;
  }

  const cacheControl = getPromptCacheControl();
  if (!cacheControl) {
    return requestBody;
  }

  const result: Record<string, unknown> = { ...requestBody };

  if (typeof result.system === "string" && result.system) {
    result.system = [
      { type: "text", text: result.system, cache_control: cacheControl },
    ];
  } else if (Array.isArray(result.system)) {
    result.system = addCacheControlToAnthropicBlocks(result.system);
  }

  if (Array.isArray(result.messages)) {
    const targetIndex = result.messages.findLastIndex(
      (message) =>
        message &&
        typeof message === "object" &&
        !Array.isArray(message) &&
        (message as Record<string, unknown>).role === "user",
    );

    if (targetIndex !== -1) {
      const target = result.messages[targetIndex] as Record<string, unknown>;
      let content = target.content;

      if (typeof content === "string" && content) {
        content = [{ type: "text", text: content, cache_control: cacheControl }];
      } else if (Array.isArray(content)) {
        content = addCacheControlToAnthropicBlocks(content);
      }

      if (content !== target.content) {
        result.messages = result.messages.map((message, index) =>
          index === targetIndex ? { ...target, content } : message,
        );
      }
    }
  }

  return result as T;
}

function applyExplicitPromptCaching<T extends Record<string, unknown>>(
  requestBody: T,
): T {
  if (hasPromptCacheBreakpoint(requestBody)) {
    return requestBody;
  }

  if (!Array.isArray(requestBody.messages)) {
    return requestBody;
  }

  const targetIndex = requestBody.messages.findLastIndex(isCacheableMessage);
  if (targetIndex === -1) {
    return requestBody;
  }

  const targetMessage = requestBody.messages[targetIndex] as Record<
    string,
    unknown
  >;
  const updatedContent = addCacheBreakpointToContent(targetMessage.content);
  if (updatedContent === targetMessage.content) {
    return requestBody;
  }

  return {
    ...requestBody,
    messages: requestBody.messages.map((message, index) =>
      index === targetIndex
        ? {
            ...(message as Record<string, unknown>),
            content: updatedContent,
          }
        : message,
    ),
  };
}

export function applyAutomaticPromptCaching<T extends Record<string, unknown>>(
  requestBody: T,
  model: string,
): T {
  if (!isPromptCachingEnabled()) {
    return requestBody;
  }

  if (isClaudeModel(model)) {
    if (requestBody.cache_control !== undefined) {
      return requestBody;
    }

    const cacheControl = getPromptCacheControl();
    if (!cacheControl) {
      return requestBody;
    }

    return {
      ...requestBody,
      cache_control: cacheControl,
    };
  }

  if (isGoogleModel(model)) {
    return applyExplicitPromptCaching(requestBody);
  }

  return requestBody;
}

type PromptCacheTtl = "5m" | "1h";

interface PromptCacheControl {
  type: "ephemeral";
  ttl?: PromptCacheTtl;
}

function getPromptCacheTtl(): PromptCacheTtl {
  return Bun.env.FLIXA_PROMPT_CACHE_TTL === "1h" ? "1h" : "5m";
}

export function isPromptCachingEnabled(): boolean {
  const value = Bun.env.FLIXA_PROMPT_CACHE?.toLowerCase();
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

function hasPromptCacheBreakpoint(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(hasPromptCacheBreakpoint);
  }

  const record = value as Record<string, unknown>;
  if (record.cache_control !== undefined || record.cacheControl !== undefined) {
    return true;
  }

  return Object.values(record).some(hasPromptCacheBreakpoint);
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

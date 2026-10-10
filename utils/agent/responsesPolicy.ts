/**
 * OpenAI developer recommendations for long-running agent workloads:
 * 1. Prefer the Responses API over Chat Completions
 * 2. Retain reasoning across turns (encrypted reasoning / all_turns context)
 * 3. Compaction when context grows — client-driven via /responses/compact
 *    (or optional client-supplied context_management). No automatic server-side
 *    compact threshold is applied here.
 *
 * OpenRouter's Responses API is stateless: store / previous_response_id are
 * rejected, so retained reasoning uses encrypted_content replay instead.
 */

export type ResponsesProviderKind = "openrouter" | "openai";

export type ContextManagementEntry = {
  type: string;
  compact_threshold?: number | null;
};

export function isChatViaResponsesEnabled(): boolean {
  const value = process.env.FLIXA_CHAT_VIA_RESPONSES?.toLowerCase();
  // Default on: OpenAI recommends Responses over Chat Completions for agents.
  return value !== "0" && value !== "false" && value !== "off";
}

/** Models where Responses + retained reasoning is the recommended path. */
export function isOpenAIFamilyModel(model: string): boolean {
  const normalized = model.toLowerCase();
  return (
    normalized.startsWith("openai/") ||
    normalized.includes("gpt-") ||
    normalized.includes("o1") ||
    normalized.includes("o3") ||
    normalized.includes("o4") ||
    normalized.includes("codex")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merge client include list with retained-reasoning requirements.
 * When store is false (or OpenRouter), encrypted reasoning must be returned so
 * clients can replay it on subsequent turns.
 */
export function ensureRetainedReasoningInclude(
  include: string[] | undefined,
  store: boolean | undefined,
  provider: ResponsesProviderKind,
): string[] {
  const next = new Set(include ?? []);
  const needsEncrypted =
    provider === "openrouter" || store === false || store === undefined;

  if (needsEncrypted) {
    next.add("reasoning.encrypted_content");
  }

  return [...next];
}

/**
 * Ensure reasoning config retains prior reasoning across multi-turn agent work.
 */
export function ensureRetainedReasoningConfig(
  reasoning: unknown,
): Record<string, unknown> {
  const base = isRecord(reasoning) ? { ...reasoning } : {};

  // GPT-5.6+ defaults to all_turns; earlier models default to current_turn.
  // Explicitly prefer all_turns for long-running agent tasks.
  if (base.context === undefined) {
    base.context = "all_turns";
  }

  return base;
}

/**
 * Pass through client context_management only — never invent a default threshold.
 * Compaction is client-driven (POST /responses/compact or explicit field).
 */
export function resolveContextManagement(
  clientValue: unknown,
): ContextManagementEntry[] | undefined {
  if (clientValue === null || clientValue === undefined) {
    return undefined;
  }

  if (!Array.isArray(clientValue) || clientValue.length === 0) {
    return undefined;
  }

  return clientValue
    .filter(
      (entry): entry is ContextManagementEntry =>
        isRecord(entry) && typeof entry.type === "string",
    )
    .map((entry) => ({
      type: entry.type,
      compact_threshold:
        typeof entry.compact_threshold === "number"
          ? entry.compact_threshold
          : entry.compact_threshold === null
            ? null
            : undefined,
    }));
}

/**
 * Apply OpenAI agent best-practice defaults and provider constraints.
 * Does not auto-enable server-side compaction.
 */
export function applyResponsesBestPractices(
  request: Record<string, unknown>,
  provider: ResponsesProviderKind,
): Record<string, unknown> {
  const next = { ...request };

  // OpenRouter rejects store / previous_response_id.
  if (provider === "openrouter") {
    next.store = false;
    delete next.previous_response_id;
  } else if (next.store === undefined) {
    // Proxy default: stay ZDR-friendly; clients replay encrypted reasoning.
    next.store = false;
  }

  const store =
    typeof next.store === "boolean" ? next.store : (undefined as boolean | undefined);

  next.include = ensureRetainedReasoningInclude(
    Array.isArray(next.include)
      ? next.include.filter((item): item is string => typeof item === "string")
      : undefined,
    store,
    provider,
  );

  next.reasoning = ensureRetainedReasoningConfig(next.reasoning);

  const contextManagement = resolveContextManagement(next.context_management);
  if (contextManagement !== undefined) {
    next.context_management = contextManagement;
  } else {
    delete next.context_management;
  }

  return next;
}

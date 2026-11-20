import { DENI_API_UTILITY_MODEL_ID } from "@deniai/ai/deni-api";
import {
  defaultModel,
  getModelDefinition,
  getPreferredReasoningEffort,
  isModelAllowedForAccount,
  models,
  resolveReasoningEffort,
  type ModelDefinition,
  type ReasoningEffort,
} from "@deniai/ai/models";

export type { ModelDefinition, ReasoningEffort };

/**
 * Run uses the Deni AI chat model catalog (`@deniai/ai/models`): the same models, plan access
 * and usage tiers as chat, all called through the Deni AI API.
 */

/** The model a new account starts on: the chat default (catalog id). */
export const DENI_MODEL_ID = defaultModel.value;
export const DENI_REASONING_EFFORT: ReasoningEffort = getPreferredReasoningEffort(
  defaultModel.efforts,
);

/** Summarizes history the model no longer sees: the utility model (Haiku 5.5, Deni AI API id). */
export const SUMMARY_MODEL_ID = DENI_API_UTILITY_MODEL_ID;

/**
 * The account's Run mode: a catalog model and a reasoning effort, stored and sent as one string
 * (`<model>@<effort>`, e.g. `claude-sonnet-5.5@high`; `run_settings.run_mode`, job payloads, the
 * API's `runMode`). Read it with {@link parseRunMode} and {@link splitRunMode}.
 */
export type RunMode = string;

export type RunModeParts = {
  model: string;
  /** Undefined for a model without reasoning efforts. */
  reasoningEffort: ReasoningEffort | undefined;
};

const SEPARATOR = "@";

export function joinRunMode(model: string, reasoningEffort?: ReasoningEffort | null): RunMode {
  const definition = getModelDefinition(model);
  const effort = definition
    ? resolveReasoningEffort(definition.efforts, reasoningEffort)
    : (reasoningEffort ?? undefined);
  return effort ? `${model}${SEPARATOR}${effort}` : model;
}

export const DEFAULT_RUN_MODE: RunMode = joinRunMode(DENI_MODEL_ID, DENI_REASONING_EFFORT);

/** Run modes saved before Run used the chat catalog: Run (Sonnet) / Run+ (Opus) and a level. */
const LEGACY_RUN_MODEL = "claude-sonnet-5.5";
const LEGACY_RUN_PLUS_MODEL = "claude-opus-5.5";
const LEGACY_LEVELS: Record<string, ReasoningEffort> = {
  default: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

function legacyRunMode(value: string): RunMode | null {
  if (value === "plus") return joinRunMode(LEGACY_RUN_PLUS_MODEL, "max");
  const plus = value.startsWith("plus-");
  const effort = LEGACY_LEVELS[plus ? value.slice("plus-".length) : value];
  return effort ? joinRunMode(plus ? LEGACY_RUN_PLUS_MODEL : LEGACY_RUN_MODEL, effort) : null;
}

/** A valid Run mode for any stored or client-sent value; unknown values give the default. */
export function parseRunMode(value: unknown): RunMode {
  if (typeof value !== "string" || !value) return DEFAULT_RUN_MODE;
  const legacy = legacyRunMode(value);
  if (legacy) return legacy;
  const at = value.lastIndexOf(SEPARATOR);
  const model = at === -1 ? value : value.slice(0, at);
  if (!getModelDefinition(model)) return DEFAULT_RUN_MODE;
  return joinRunMode(model, (at === -1 ? undefined : value.slice(at + 1)) as ReasoningEffort);
}

export function splitRunMode(mode: RunMode): RunModeParts {
  const parsed = parseRunMode(mode);
  const at = parsed.lastIndexOf(SEPARATOR);
  return at === -1
    ? { model: parsed, reasoningEffort: undefined }
    : { model: parsed.slice(0, at), reasoningEffort: parsed.slice(at + 1) as ReasoningEffort };
}

export type RunModelAccess = {
  tier: "free" | "go" | "plus" | "pro" | null | undefined;
  hasVerifiedPaymentMethod?: boolean;
  /** Whether the model can be called on this server (the Deni AI API key is set). */
  isAvailable?: (model: ModelDefinition) => boolean;
};

function usable(model: ModelDefinition, access: RunModelAccess) {
  return (
    isModelAllowedForAccount(model.value, access.tier, access.hasVerifiedPaymentMethod) &&
    (access.isAvailable?.(model) ?? true)
  );
}

/**
 * The mode a turn really runs on: the saved one when the plan (the chat rules) and this server
 * allow its model, else the first usable of the default, the other free models, then the catalog.
 * A saved model can stop being allowed after a downgrade; background work then keeps running.
 */
export function runModeForAccount(mode: RunMode, access: RunModelAccess): RunMode {
  const { model, reasoningEffort } = splitRunMode(mode);
  const saved = getModelDefinition(model);
  if (saved && usable(saved, access)) return parseRunMode(mode);
  const preferred = [DENI_MODEL_ID, "gpt-6-luna", "gemini-3.8-flash"]
    .map((id) => getModelDefinition(id))
    .filter((item): item is ModelDefinition => Boolean(item));
  const fallback = [...preferred, ...models].find((item) => usable(item, access));
  if (!fallback) return parseRunMode(mode);
  return joinRunMode(
    fallback.value,
    resolveReasoningEffort(fallback.efforts, reasoningEffort) ??
      getPreferredReasoningEffort(fallback.efforts),
  );
}

/** "Claude Sonnet 5.5 (high)", for places that show the mode as text (Discord). */
export function runModeLabel(mode: RunMode): string {
  const { model, reasoningEffort } = splitRunMode(mode);
  const name = getModelDefinition(model)?.name ?? model;
  return reasoningEffort ? `${name} (${reasoningEffort})` : name;
}

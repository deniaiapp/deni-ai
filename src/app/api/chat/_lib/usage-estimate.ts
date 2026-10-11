import type { ModelMessage } from "ai";
import {
  getEffectiveTokenMultiplier,
  reasoningEffortValues,
  type ModelEfforts,
  type ReasoningEffort,
} from "@/lib/constants";

// Guests are billed per request, not per token, so bound the prompt and output a
// single guest request can use.
export const GUEST_MAX_PROMPT_TOKENS = 32_000;
export const GUEST_MAX_OUTPUT_TOKENS = 16_384;
// Earlier turns' tool results are resent with every guest request, so guests
// keep only the start of each one.
export const GUEST_TOOL_OUTPUT_CHARS = 2_000;
// Hidden reasoning counts toward the guest output cap, so guests stay at or
// below this effort and keep room for a visible answer.
export const GUEST_MAX_REASONING_EFFORT: ReasoningEffort = "medium";

// Image and PDF parts carry a URL or an encoded payload whose length says
// nothing about what the provider bills for them, so each file counts at a
// conservative per-file estimate instead.
export const URL_IMAGE_TOKEN_ESTIMATE = 2_000;
export const URL_PDF_TOKEN_ESTIMATE = 25_000;

/** Uncapped prompt-size estimate (chars/4). Used for long-context preflight. */
export function estimatePromptInputTokens({
  modelMessages,
  systemPrompt,
}: {
  modelMessages: unknown;
  systemPrompt: string;
}): number {
  const serializedMessages = JSON.stringify(modelMessages);
  return Math.ceil((serializedMessages.length + systemPrompt.length) / 4);
}

type ContentPart = Exclude<ModelMessage["content"], string>[number];
type AttachmentPart = Extract<ContentPart, { type: "file" } | { type: "image" }>;

function isAttachmentPart(part: ContentPart): part is AttachmentPart {
  return part.type === "file" || part.type === "image";
}

function getAttachmentData(part: AttachmentPart) {
  return part.type === "file" ? part.data : part.image;
}

function getAttachmentMediaType(part: AttachmentPart) {
  return part.mediaType ?? (part.type === "image" ? "image/*" : undefined);
}

function getAttachmentTokenEstimate(part: AttachmentPart) {
  return getAttachmentMediaType(part) === "application/pdf"
    ? URL_PDF_TOKEN_ESTIMATE
    : URL_IMAGE_TOKEN_ESTIMATE;
}

function isRemoteUrl(data: unknown): boolean {
  const url =
    data && typeof data === "object" && "url" in data && (data as { type?: unknown }).type === "url"
      ? data.url
      : data;
  return url instanceof URL && url.protocol !== "data:";
}

function sumAttachmentTokens(
  modelMessages: ModelMessage[],
  include: (part: AttachmentPart) => boolean,
) {
  let tokens = 0;
  for (const message of modelMessages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content as ContentPart[]) {
      if (isAttachmentPart(part) && include(part)) tokens += getAttachmentTokenEstimate(part);
    }
  }
  return tokens;
}

/** Input floor for image/PDF parts that the provider receives by URL. */
export function estimateUrlAttachmentTokens(modelMessages: ModelMessage[]): number {
  return sumAttachmentTokens(modelMessages, (part) => isRemoteUrl(getAttachmentData(part)));
}

/** Per-file estimate for every image/PDF part, sent by URL or inline as a data URL. */
export function estimateAttachmentTokens(modelMessages: ModelMessage[]): number {
  return sumAttachmentTokens(modelMessages, () => true);
}

/** chars/4 of the prompt with image/PDF payloads left out. */
export function estimatePromptTextTokens({
  modelMessages,
  systemPrompt,
}: {
  modelMessages: ModelMessage[];
  systemPrompt: string;
}): number {
  return estimatePromptInputTokens({
    modelMessages: modelMessages.map((message) =>
      Array.isArray(message.content)
        ? {
            ...message,
            content: (message.content as ContentPart[]).map((part) =>
              isAttachmentPart(part)
                ? { type: part.type, mediaType: getAttachmentMediaType(part) }
                : part,
            ),
          }
        : message,
    ),
    systemPrompt,
  });
}

/** What a guest prompt costs: its text plus a per-file estimate for each attachment. */
export function estimateGuestPromptTokens(params: {
  modelMessages: ModelMessage[];
  systemPrompt: string;
}): number {
  return estimatePromptTextTokens(params) + estimateAttachmentTokens(params.modelMessages);
}

/** The highest supported effort at or below the guest limit, for guest requests. */
export function capGuestReasoningEffort(
  efforts: ModelEfforts,
  requestedEffort: ReasoningEffort,
): ReasoningEffort {
  const rank = (effort: ReasoningEffort) => reasoningEffortValues.indexOf(effort);
  const limit = rank(GUEST_MAX_REASONING_EFFORT);
  if (rank(requestedEffort) <= limit) return requestedEffort;
  const allowed = (efforts === false ? reasoningEffortValues : efforts).filter(
    (effort) => rank(effort) <= limit,
  );
  return allowed.reduce(
    (highest, effort) => (rank(effort) > rank(highest) ? effort : highest),
    allowed[0] ?? GUEST_MAX_REASONING_EFFORT,
  );
}

/**
 * Reserve at least the estimated prompt before streaming starts, so a request
 * whose input alone exceeds the remaining quota is rejected up front. Long-context
 * sessions (>200K estimated input on OpenAI 1M models) also hold the 2× premium.
 * Settlement reconciles to the provider-reported usage afterwards.
 */
export function estimateTokenReservation({
  estimatedPromptTokens,
  modelId,
  proMode = false,
  fastMode = false,
}: {
  estimatedPromptTokens: number;
  modelId: string;
  proMode?: boolean;
  fastMode?: boolean;
}) {
  const effectiveMultiplier = getEffectiveTokenMultiplier(modelId, estimatedPromptTokens, {
    proMode,
    fastMode,
  });
  const baseUnits = Math.max(512, estimatedPromptTokens + 1_024);

  return Math.ceil(baseUnits * effectiveMultiplier);
}

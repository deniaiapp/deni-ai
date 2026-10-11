import type { ModelMessage } from "ai";
import { getEffectiveTokenMultiplier } from "@/lib/constants";

// Guests are billed per request, not per token, so bound the prompt and output a
// single guest request can use.
export const GUEST_MAX_PROMPT_TOKENS = 32_000;
export const GUEST_MAX_OUTPUT_TOKENS = 16_384;

// URL attachments are only downloaded inside streamText, so the serialized prompt
// holds just their URLs. Count a conservative floor per file instead; data URLs
// are already counted by their encoded length.
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

function isRemoteUrl(data: unknown): boolean {
  const url =
    data && typeof data === "object" && "url" in data && (data as { type?: unknown }).type === "url"
      ? data.url
      : data;
  return url instanceof URL && url.protocol !== "data:";
}

/** Input floor for image/PDF parts that the provider receives by URL. */
export function estimateUrlAttachmentTokens(modelMessages: ModelMessage[]): number {
  let tokens = 0;
  for (const message of modelMessages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type !== "file" || !isRemoteUrl(part.data)) continue;
      tokens +=
        part.mediaType === "application/pdf" ? URL_PDF_TOKEN_ESTIMATE : URL_IMAGE_TOKEN_ESTIMATE;
    }
  }
  return tokens;
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

import { createHash } from "node:crypto";
import type { ModelMessage } from "ai";
import {
  MAX_CHAT_ATTACHMENT_BYTES,
  type ChatAttachmentCache,
} from "@/lib/chat-attachment-download";
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
// A PDF is billed by its pages, so a flat estimate cannot bound it. Guests pay
// one unit per request, so their PDFs also count by size, as inline files once
// did by their encoded length (about one token per 3 bytes).
export const GUEST_PDF_BYTES_PER_TOKEN = 3;

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

function getAttachmentUrl(data: unknown): URL | undefined {
  const url =
    data && typeof data === "object" && "url" in data && (data as { type?: unknown }).type === "url"
      ? data.url
      : data;
  return url instanceof URL ? url : undefined;
}

function isRemoteUrl(data: unknown): boolean {
  const url = getAttachmentUrl(data);
  return url !== undefined && url.protocol !== "data:";
}

/**
 * Size of an image/PDF part: its decoded inline data, or the copy of a URL file
 * downloaded before the guest check. Unknown for a URL that was not downloaded.
 */
function getAttachmentByteLength(
  part: AttachmentPart,
  attachmentCache: ChatAttachmentCache | undefined,
): number | undefined {
  const data = getAttachmentData(part);
  const url = getAttachmentUrl(data);
  if (url) {
    if (url.protocol !== "data:") return attachmentCache?.get(url.href)?.data.byteLength;
    // Inline files are base64 data URLs (prepareBinaryAttachments rejects others).
    return Buffer.byteLength(url.href.slice(url.href.indexOf(",") + 1), "base64");
  }
  const content =
    data && typeof data === "object" && "type" in data && data.type === "data" ? data.data : data;
  if (typeof content === "string") return Buffer.byteLength(content, "base64");
  if (content instanceof Uint8Array || content instanceof ArrayBuffer) return content.byteLength;
  return undefined;
}

function sumAttachmentTokens(
  modelMessages: ModelMessage[],
  estimate: (part: AttachmentPart) => number,
) {
  let tokens = 0;
  for (const message of modelMessages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content as ContentPart[]) {
      if (isAttachmentPart(part)) tokens += estimate(part);
    }
  }
  return tokens;
}

/** Input floor for image/PDF parts that the provider receives by URL. */
export function estimateUrlAttachmentTokens(modelMessages: ModelMessage[]): number {
  return sumAttachmentTokens(modelMessages, (part) =>
    isRemoteUrl(getAttachmentData(part)) ? getAttachmentTokenEstimate(part) : 0,
  );
}

/**
 * Guest estimate for every image/PDF part, sent by URL or inline as a data URL:
 * the per-file estimate, and for a PDF at least its size in tokens. A PDF whose
 * size is unknown counts as the largest accepted file.
 */
export function estimateGuestAttachmentTokens(
  modelMessages: ModelMessage[],
  attachmentCache?: ChatAttachmentCache,
): number {
  return sumAttachmentTokens(modelMessages, (part) => {
    const tokens = getAttachmentTokenEstimate(part);
    if (getAttachmentMediaType(part) !== "application/pdf") return tokens;
    const bytes = getAttachmentByteLength(part, attachmentCache) ?? MAX_CHAT_ATTACHMENT_BYTES;
    return Math.max(tokens, Math.ceil(bytes / GUEST_PDF_BYTES_PER_TOKEN));
  });
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

/** What a guest prompt costs: its text plus an estimate for each attachment. */
export function estimateGuestPromptTokens({
  attachmentCache,
  ...params
}: {
  modelMessages: ModelMessage[];
  systemPrompt: string;
  /** URL files already downloaded for this request, to size their PDFs. */
  attachmentCache?: ChatAttachmentCache;
}): number {
  return (
    estimatePromptTextTokens(params) +
    estimateGuestAttachmentTokens(params.modelMessages, attachmentCache)
  );
}

/**
 * Fingerprints of a prompt's prefixes: entry `i` covers the system prompt, the
 * tool names and the first `i` messages. A later prompt whose entry at the same
 * index matches still starts with the earlier prompt, so it is at least as large.
 */
export function fingerprintPromptPrefixes({
  modelMessages,
  systemPrompt,
  toolNames,
}: {
  modelMessages: ModelMessage[];
  systemPrompt: string;
  toolNames: string[];
}): string[] {
  let fingerprint = createHash("sha256")
    .update(JSON.stringify([systemPrompt, toolNames]))
    .digest("base64url");
  const fingerprints = [fingerprint];
  for (const message of modelMessages) {
    fingerprint = createHash("sha256")
      .update(fingerprint)
      .update(JSON.stringify(message))
      .digest("base64url");
    fingerprints.push(fingerprint);
  }
  return fingerprints;
}

/**
 * The requested effort when the model supports it at or below the guest limit,
 * otherwise the highest supported effort at or below that limit. Callers resolve
 * the request against the model first: an unsupported effort falls back to the
 * model's preferred one, which this then caps.
 */
export function capGuestReasoningEffort(
  efforts: ModelEfforts,
  requestedEffort: ReasoningEffort,
): ReasoningEffort {
  const rank = (effort: ReasoningEffort) => reasoningEffortValues.indexOf(effort);
  const limit = rank(GUEST_MAX_REASONING_EFFORT);
  const supported = efforts === false ? reasoningEffortValues : efforts;
  if (rank(requestedEffort) <= limit && supported.includes(requestedEffort)) return requestedEffort;
  const allowed = supported.filter((effort) => rank(effort) <= limit);
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

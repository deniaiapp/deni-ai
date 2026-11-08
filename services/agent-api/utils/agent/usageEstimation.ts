import {
  getModelDefinition,
  getEffectiveTokenUsageMultiplier,
  type PlanTier,
} from "./models";
import { computeMeteredTokens } from "./usageMetering";

const encoder = new TextEncoder();
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

/** Fallback only: providers' actual usage always takes precedence when complete.
 * UTF-8 bytes / 4 is an approximation, not a tokenizer (especially for media,
 * hidden reasoning, cached history, and server-side previous_response_id).
 */
export class UsageEstimate {
  readonly inputTokens: number;
  readonly reservationAmount: number;
  private outputBytes = 0;
  completeUsage = false;

  constructor(
    body: Record<string, unknown>,
    model: string,
    protocol: "chat" | "responses" | "messages" | "compact" = "chat",
    tier?: PlanTier,
  ) {
    const input = JSON.stringify({
      messages: body.messages,
      input: body.input,
      instructions: body.instructions,
      system: body.system,
      tools: body.tools,
      previous_response_id: body.previous_response_id,
    });
    this.inputTokens = Math.max(1, Math.ceil(encoder.encode(input).length / 4));
    // Only use fields actually forwarded by this endpoint. An ignored, smaller
    // max_output_tokens on Chat must not reduce its reservation.
    const outputLimit =
      protocol === "compact"
        ? undefined
        : protocol === "responses"
          ? (body.max_output_tokens ?? body.max_tokens)
          : body.max_tokens;
    const outputTokens =
      typeof outputLimit === "number" && Number.isSafeInteger(outputLimit) && outputLimit > 0
        ? outputLimit
        : (getModelDefinition(model)?.maxOutputTokens ?? 16_384);
    const estimate = { input_tokens: this.inputTokens, output_tokens: outputTokens };
    this.reservationAmount = Math.max(
      1,
      Math.ceil(
        (computeMeteredTokens(estimate) ?? 0) * getEffectiveTokenUsageMultiplier(model, estimate, tier),
      ),
    );
  }

  get outputTokens(): number {
    return Math.ceil(this.outputBytes / 4);
  }

  observe(value: unknown): void {
    const event = object(value);
    const add = (text: unknown) => {
      if (typeof text === "string") this.outputBytes += encoder.encode(text).length;
    };
    if (Array.isArray(event.choices)) {
      for (const choice of event.choices) {
        const delta = object(object(choice).delta);
        add(delta.content);
        add(delta.reasoning_content ?? delta.reasoning);
        for (const tool of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
          add(object(object(tool).function).arguments);
        }
        add(object(delta.function_call).arguments);
      }
      const usage = object(event.usage);
      if (
        typeof usage.completion_tokens === "number" ||
        typeof usage.completionTokens === "number"
      ) {
        this.completeUsage = true;
      }
    } else if (typeof event.type === "string" && event.type.startsWith("response.")) {
      if (event.type.endsWith(".delta")) add(event.delta);
      if (
        ["response.completed", "response.incomplete"].includes(event.type) &&
        object(event.response).usage
      ) {
        this.completeUsage = true;
      }
    } else if (event.type === "content_block_delta") {
      const delta = object(event.delta);
      add(delta.text ?? delta.thinking ?? delta.partial_json);
    } else if (event.type === "content_block_start") {
      const block = object(event.content_block);
      add(block.text ?? block.thinking);
    } else if (event.type === "message_delta" && object(event.usage).output_tokens !== undefined) {
      this.completeUsage = true;
    }
  }

  /** Preserve cache breakdowns; supplement missing/partial input and output. */
  usageWithFallback(usage: unknown, completed: boolean): Record<string, unknown> {
    const record = { ...object(usage) };
    const hasNumber = (keys: string[]) =>
      keys.some((key) => typeof record[key] === "number" && Number.isFinite(record[key]));
    const inputKeys = ["prompt_tokens", "promptTokens", "input_tokens", "inputTokens"];
    const outputKeys = ["completion_tokens", "completionTokens", "output_tokens", "outputTokens"];
    const authoritative = completed || this.completeUsage;
    if (
      authoritative &&
      hasNumber(["total_tokens", "totalTokens"]) &&
      !hasNumber([...inputKeys, ...outputKeys])
    )
      return record;
    if (!hasNumber(inputKeys)) record.input_tokens = this.inputTokens;
    const outputKey =
      outputKeys.find((key) => typeof record[key] === "number" && Number.isFinite(record[key])) ??
      "output_tokens";
    if (!hasNumber(outputKeys) || !authoritative) {
      record[outputKey] = Math.max(Number(record[outputKey]) || 0, this.outputTokens);
    }
    return record;
  }
}

import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from "openai/resources/chat/completions";
import type OpenAI from "openai";

export type ReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface AgentRequest {
  model: string;
  messages: ChatCompletionMessageParam[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  reasoning_effort?: ReasoningEffort;
  tools?: ChatCompletionTool[];
  tool_choice?: ChatCompletionToolChoiceOption;
}

export interface ResponsesTextFormat {
  type: "text" | "json_object" | "json_schema";
  name?: string;
  description?: string;
  schema?: Record<string, unknown>;
  strict?: boolean;
}

export interface ResponsesTextConfig {
  format?: ResponsesTextFormat;
  verbosity?: "low" | "medium" | "high";
}

export interface ResponsesReasoningConfig {
  effort?: ReasoningEffort;
  summary?: "auto" | "concise" | "detailed";
  /** Which prior reasoning items to render into the next sample. */
  context?: "auto" | "current_turn" | "all_turns";
  /** GPT-5.6+ reasoning mode. */
  mode?: "standard" | "pro";
}

export interface ResponsesFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

export interface ResponsesContextManagement {
  type: string;
  compact_threshold?: number | null;
}

export interface ResponsesRequest {
  model: string;
  input?: string | unknown[];
  messages?: ChatCompletionMessageParam[];
  instructions?: string;
  previous_response_id?: string;
  stream?: boolean;
  truncation?: "auto" | "disabled";
  service_tier?: "auto" | "default" | "flex" | "priority";
  prompt_cache_key?: string;
  prompt_cache_retention?: "in-memory" | "24h";
  temperature?: number;
  max_output_tokens?: number;
  max_tokens?: number;
  top_p?: number;
  reasoning?: ResponsesReasoningConfig;
  reasoning_effort?: ReasoningEffort;
  tools?: ResponsesFunctionTool[] | ChatCompletionTool[];
  tool_choice?:
    | "none"
    | "auto"
    | "required"
    | ChatCompletionToolChoiceOption
    | {
        type: "function";
        name: string;
      };
  text?: ResponsesTextConfig;
  store?: boolean;
  include?: string[];
  parallel_tool_calls?: boolean;
  metadata?: Record<string, string | number | boolean>;
  /**
   * Optional server-side compaction (client opt-in only; no server default).
   * Prefer explicit POST /v1/agent/responses/compact for long agent runs.
   * OpenAI form: [{ type: "compaction", compact_threshold: 200000 }]
   */
  context_management?: ResponsesContextManagement[] | null;
}

export interface ResponsesCompactRequest {
  model: string;
  input?: string | unknown[];
  messages?: ChatCompletionMessageParam[];
  instructions?: string;
  previous_response_id?: string;
}

export type ClientResult =
  | { type: "openrouter"; providerName: string }
  | { type: "openai"; client: OpenAI; providerName: string }
  | { type: "deni"; client: OpenAI; providerName: string }
  | { error: string };

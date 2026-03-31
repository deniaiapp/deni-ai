import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from "openai/resources/chat/completions";
import type { OpenRouter } from "@openrouter/sdk";
import type OpenAI from "openai";

export type ReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

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
}

export interface ResponsesFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

export interface ResponsesRequest {
  model: string;
  input?: string | unknown[];
  messages?: ChatCompletionMessageParam[];
  instructions?: string;
  previous_response_id?: string;
  stream?: boolean;
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
}

export type ClientResult =
  | { type: "openrouter"; client: OpenRouter; providerName: string }
  | { type: "openai"; client: OpenAI; providerName: string }
  | { error: string };

import type { ChatCompletionMessageParam, ChatCompletionTool, ChatCompletionToolChoiceOption } from 'openai/resources/chat/completions';
import type { OpenRouter } from '@openrouter/sdk';
import type OpenAI from 'openai';
import type Anthropic from '@anthropic-ai/sdk';

export interface AgentRequest {
  model: string;
  messages: ChatCompletionMessageParam[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  tools?: ChatCompletionTool[];
  tool_choice?: ChatCompletionToolChoiceOption;
}

export type ClientResult =
  | { type: 'openrouter'; client: OpenRouter; providerName: string }
  | { type: 'openai'; client: OpenAI; providerName: string }
  | { type: 'anthropic'; client: Anthropic; providerName: string }
  | { error: string };


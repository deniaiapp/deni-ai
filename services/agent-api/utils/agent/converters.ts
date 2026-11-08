import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import type Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, Tool, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages/messages';

type OpenRouterTool = Record<string, unknown>;

function safeParseJson(value: string, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : fallback;
  } catch {
    return fallback;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Responses `input` accepts a string or a flat array of input items. Some
 * Codex turns can leave a batch of items nested as an array element while a
 * long tool transcript is being replayed. Flatten only the input-item
 * container; content arrays inside individual items must remain untouched.
 */
export function flattenResponsesInputItems(input: unknown): unknown {
  if (!Array.isArray(input)) {
    return input;
  }

  if (!input.some(Array.isArray)) {
    return input;
  }

  // Single depth-first pass with an explicit stack: linear in the number of
  // elements regardless of nesting depth, and no recursion to overflow.
  const flattened: unknown[] = [];
  const stack: Array<{ items: unknown[]; index: number }> = [{ items: input, index: 0 }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.index >= frame.items.length) {
      stack.pop();
      continue;
    }

    const index = frame.index++;
    if (!(index in frame.items)) {
      continue;
    }

    const item = frame.items[index];
    if (Array.isArray(item)) {
      stack.push({ items: item, index: 0 });
    } else {
      flattened.push(item);
    }
  }

  return flattened;
}

function stringifyResponsesToolOutput(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }

  if (output === undefined) {
    return "";
  }

  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

/**
 * Normalize Codex-local tool transcript items before sending them upstream.
 * Codex app tools can emit `function_call_output` items without a call_id;
 * those are not valid Responses items, but their textual result is still
 * useful context for the next model turn.
 */
export function normalizeResponsesInputItems(input: unknown): unknown {
  const flattened = flattenResponsesInputItems(input);
  if (!Array.isArray(flattened)) {
    return flattened;
  }

  return flattened.flatMap((item) => {
    if (!isRecord(item)) {
      return [item];
    }

    const type = item.type;
    const isFunctionCallOutput =
      type === "function_call_output" ||
      type === "functionCallOutput" ||
      type === "FunctionCallOutput";
    if (!isFunctionCallOutput) {
      return [item];
    }

    const output = stringifyResponsesToolOutput(item.output);
    if (typeof item.call_id !== "string" || item.call_id.length === 0) {
      return [
        {
          type: "message",
          role: "user",
          content: output,
        },
      ];
    }

    return [
      {
        type: "function_call_output",
        call_id: item.call_id,
        output,
      },
    ];
  });
}

function responsesContentPartToChat(part: unknown): unknown {
  if (!isRecord(part)) {
    return part;
  }

  if (
    (part.type === 'input_text' || part.type === 'output_text') &&
    typeof part.text === 'string'
  ) {
    return { type: 'text', text: part.text };
  }

  if (part.type === 'input_image' && typeof part.image_url === 'string') {
    return {
      type: 'image_url',
      image_url: {
        url: part.image_url,
        ...(typeof part.detail === 'string' ? { detail: part.detail } : {}),
      },
    };
  }

  return part;
}

/**
 * Rewrite Responses message content parts (input_text, output_text,
 * input_image) to their Chat Completions equivalents. For gateways that
 * accept a Responses request but forward message content unchanged to a
 * Chat Completions upstream.
 */
export function convertResponsesInputContentToChat(input: unknown): unknown {
  if (!Array.isArray(input)) {
    return input;
  }

  return input.map((item) => {
    if (!isRecord(item) || !Array.isArray(item.content)) {
      return item;
    }

    return { ...item, content: item.content.map(responsesContentPartToChat) };
  });
}

function chatContentToResponsesInputContent(content: unknown): unknown {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (!isRecord(part)) {
        return null;
      }

      if (part.type === 'text' && typeof part.text === 'string') {
        return { type: 'input_text', text: part.text };
      }

      const imageUrl = part.image_url;
      if (part.type === 'image_url' && imageUrl) {
        if (typeof imageUrl === 'string') {
          return { type: 'input_image', image_url: imageUrl, detail: 'auto' };
        }

        if (isRecord(imageUrl) && typeof imageUrl.url === 'string') {
          return {
            type: 'input_image',
            image_url: imageUrl.url,
            detail: typeof imageUrl.detail === 'string' ? imageUrl.detail : 'auto',
          };
        }
      }

      return null;
    })
    .filter((part) => part !== null);
}

function chatContentToResponsesOutputContent(content: unknown): unknown[] {
  if (typeof content === 'string') {
    return content ? [{ type: 'output_text', text: content }] : [];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .map((part) => {
      if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
        return { type: 'output_text', text: part.text };
      }

      return null;
    })
    .filter((part) => part !== null);
}

function chatContentToResponsesToolOutput(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
          return part.text;
        }

        return null;
      })
      .filter((part): part is string => part !== null)
      .join('\n');

    return text || JSON.stringify(content);
  }

  return content === undefined ? '' : JSON.stringify(content);
}

export function convertMessagesToResponsesInput(messages: ChatCompletionMessageParam[]): unknown[] {
  const input: unknown[] = [];

  for (const msg of messages) {
    if (msg.role === 'system' || msg.role === 'developer' || msg.role === 'user') {
      input.push({
        role: msg.role,
        content: chatContentToResponsesInputContent(msg.content),
      });
      continue;
    }

    if (msg.role === 'assistant') {
      const outputContent = chatContentToResponsesOutputContent(msg.content);
      if (outputContent.length > 0) {
        input.push({
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: outputContent,
        });
      }

      for (const toolCall of msg.tool_calls ?? []) {
        if (toolCall.type !== 'function') {
          continue;
        }

        input.push({
          type: 'function_call',
          call_id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
          status: 'completed',
        });
      }
      continue;
    }

    if (msg.role === 'tool') {
      input.push({
        type: 'function_call_output',
        call_id: msg.tool_call_id,
        output: chatContentToResponsesToolOutput(msg.content),
      });
    }
  }

  return input;
}

/**
 * Map Responses usage object to Chat Completions usage shape.
 */
export function convertResponsesUsageToChatUsage(
  usage: unknown,
): {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
} | undefined {
  if (!isRecord(usage)) {
    return undefined;
  }

  const promptTokens =
    typeof usage.input_tokens === 'number'
      ? usage.input_tokens
      : typeof usage.prompt_tokens === 'number'
        ? usage.prompt_tokens
        : 0;
  const completionTokens =
    typeof usage.output_tokens === 'number'
      ? usage.output_tokens
      : typeof usage.completion_tokens === 'number'
        ? usage.completion_tokens
        : 0;
  const totalTokens =
    typeof usage.total_tokens === 'number'
      ? usage.total_tokens
      : promptTokens + completionTokens;

  const inputDetails = isRecord(usage.input_tokens_details)
    ? usage.input_tokens_details
    : isRecord(usage.prompt_tokens_details)
      ? usage.prompt_tokens_details
      : null;
  const outputDetails = isRecord(usage.output_tokens_details)
    ? usage.output_tokens_details
    : isRecord(usage.completion_tokens_details)
      ? usage.completion_tokens_details
      : null;

  const result: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  } = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  };

  if (inputDetails) {
    const cached =
      typeof inputDetails.cached_tokens === 'number'
        ? inputDetails.cached_tokens
        : undefined;
    if (cached !== undefined) {
      result.prompt_tokens_details = { cached_tokens: cached };
    }
  }

  if (outputDetails) {
    const reasoning =
      typeof outputDetails.reasoning_tokens === 'number'
        ? outputDetails.reasoning_tokens
        : undefined;
    if (reasoning !== undefined) {
      result.completion_tokens_details = { reasoning_tokens: reasoning };
    }
  }

  return result;
}

function extractResponsesOutputText(output: unknown[]): string {
  const parts: string[] = [];

  for (const item of output) {
    if (!isRecord(item) || item.type !== 'message') {
      continue;
    }

    if (!Array.isArray(item.content)) {
      continue;
    }

    for (const block of item.content) {
      if (isRecord(block) && block.type === 'output_text' && typeof block.text === 'string') {
        parts.push(block.text);
      }
    }
  }

  return parts.join('');
}

function extractResponsesToolCalls(output: unknown[]): Array<{
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}> {
  const toolCalls: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }> = [];

  for (const item of output) {
    if (!isRecord(item) || item.type !== 'function_call') {
      continue;
    }

    const callId =
      typeof item.call_id === 'string'
        ? item.call_id
        : typeof item.id === 'string'
          ? item.id
          : `call_${toolCalls.length}`;
    const name = typeof item.name === 'string' ? item.name : '';
    const args =
      typeof item.arguments === 'string'
        ? item.arguments
        : item.arguments !== undefined
          ? JSON.stringify(item.arguments)
          : '{}';

    toolCalls.push({
      id: callId,
      type: 'function',
      function: { name, arguments: args },
    });
  }

  return toolCalls;
}

function responsesFinishReason(
  response: Record<string, unknown>,
  toolCalls: unknown[],
): string {
  if (response.status === 'incomplete') {
    const details = isRecord(response.incomplete_details)
      ? response.incomplete_details
      : null;
    if (details?.reason === 'max_output_tokens') {
      return 'length';
    }
    return 'stop';
  }

  if (toolCalls.length > 0) {
    return 'tool_calls';
  }

  return 'stop';
}

/**
 * Convert a non-streaming Responses API object to Chat Completions format.
 */
export function convertResponsesToChatCompletion(
  response: unknown,
  fallbackModel: string,
): Record<string, unknown> {
  const record = isRecord(response) ? response : {};
  const output = Array.isArray(record.output) ? record.output : [];
  const content = extractResponsesOutputText(output);
  const toolCalls = extractResponsesToolCalls(output);
  const usage = convertResponsesUsageToChatUsage(record.usage);

  const message: Record<string, unknown> = {
    role: 'assistant',
    content: content || (toolCalls.length > 0 ? null : ''),
  };
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  return {
    id:
      typeof record.id === 'string'
        ? record.id.replace(/^resp_/, 'chatcmpl-')
        : `chatcmpl-${crypto.randomUUID()}`,
    object: 'chat.completion',
    created:
      typeof record.created_at === 'number'
        ? record.created_at
        : Math.floor(Date.now() / 1000),
    model: typeof record.model === 'string' ? record.model : fallbackModel,
    choices: [
      {
        index: 0,
        message,
        finish_reason: responsesFinishReason(record, toolCalls),
        logprobs: null,
      },
    ],
    usage: usage ?? {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}

export type ResponsesToChatStreamState = {
  id: string;
  model: string;
  created: number;
  roleSent: boolean;
  toolCallIndexes: Map<string, number>;
  nextToolIndex: number;
  finishReason: string | null;
  usage: ReturnType<typeof convertResponsesUsageToChatUsage>;
};

export function createResponsesToChatStreamState(
  model: string,
): ResponsesToChatStreamState {
  return {
    id: `chatcmpl-${crypto.randomUUID()}`,
    model,
    created: Math.floor(Date.now() / 1000),
    roleSent: false,
    toolCallIndexes: new Map(),
    nextToolIndex: 0,
    finishReason: null,
    usage: undefined,
  };
}

function chatStreamChunk(
  state: ResponsesToChatStreamState,
  delta: Record<string, unknown>,
  finishReason: string | null = null,
): Record<string, unknown> {
  return {
    id: state.id,
    object: 'chat.completion.chunk',
    created: state.created,
    model: state.model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
  };
}

/**
 * Convert one Responses SSE JSON event into zero or more Chat Completions chunks.
 */
export function convertResponsesStreamEventToChatChunks(
  event: unknown,
  state: ResponsesToChatStreamState,
): Record<string, unknown>[] {
  if (!isRecord(event)) {
    return [];
  }

  const type = typeof event.type === 'string' ? event.type : '';
  const chunks: Record<string, unknown>[] = [];

  if (
    (type === 'response.created' || type === 'response.in_progress') &&
    isRecord(event.response)
  ) {
    if (typeof event.response.id === 'string') {
      state.id = event.response.id.replace(/^resp_/, 'chatcmpl-');
    }
    if (typeof event.response.model === 'string') {
      state.model = event.response.model;
    }
    if (typeof event.response.created_at === 'number') {
      state.created = event.response.created_at;
    }
  }

  if (type === 'response.output_item.added' && isRecord(event.item)) {
    const item = event.item;
    if (item.type === 'function_call') {
      const callId =
        typeof item.call_id === 'string'
          ? item.call_id
          : typeof item.id === 'string'
            ? item.id
            : `call_${state.nextToolIndex}`;
      const index = state.nextToolIndex++;
      state.toolCallIndexes.set(callId, index);
      if (typeof item.id === 'string' && item.id !== callId) {
        state.toolCallIndexes.set(item.id, index);
      }

      const delta: Record<string, unknown> = {
        tool_calls: [
          {
            index,
            id: callId,
            type: 'function',
            function: {
              name: typeof item.name === 'string' ? item.name : '',
              arguments: '',
            },
          },
        ],
      };

      if (!state.roleSent) {
        delta.role = 'assistant';
        state.roleSent = true;
      }

      chunks.push(chatStreamChunk(state, delta));
      state.finishReason = 'tool_calls';
    }
  }

  if (type === 'response.function_call_arguments.delta') {
    const itemId =
      typeof event.item_id === 'string'
        ? event.item_id
        : typeof event.call_id === 'string'
          ? event.call_id
          : null;
    const argsDelta = typeof event.delta === 'string' ? event.delta : '';
    if (itemId && argsDelta) {
      let index = state.toolCallIndexes.get(itemId);
      if (index === undefined) {
        index = state.nextToolIndex++;
        state.toolCallIndexes.set(itemId, index);
      }

      const delta: Record<string, unknown> = {
        tool_calls: [
          {
            index,
            function: { arguments: argsDelta },
          },
        ],
      };
      if (!state.roleSent) {
        delta.role = 'assistant';
        state.roleSent = true;
      }
      chunks.push(chatStreamChunk(state, delta));
      state.finishReason = 'tool_calls';
    }
  }

  if (
    type === 'response.output_text.delta' ||
    type === 'response.content_part.delta'
  ) {
    const text =
      typeof event.delta === 'string'
        ? event.delta
        : isRecord(event.delta) && typeof event.delta.text === 'string'
          ? event.delta.text
          : '';
    if (text) {
      const delta: Record<string, unknown> = { content: text };
      if (!state.roleSent) {
        delta.role = 'assistant';
        state.roleSent = true;
      }
      chunks.push(chatStreamChunk(state, delta));
      if (!state.finishReason) {
        state.finishReason = 'stop';
      }
    }
  }

  if (type === 'response.completed' && isRecord(event.response)) {
    if (typeof event.response.id === 'string') {
      state.id = event.response.id.replace(/^resp_/, 'chatcmpl-');
    }
    if (typeof event.response.model === 'string') {
      state.model = event.response.model;
    }
    state.usage = convertResponsesUsageToChatUsage(event.response.usage);

    if (
      Array.isArray(event.response.output) &&
      extractResponsesToolCalls(event.response.output).length > 0
    ) {
      state.finishReason = 'tool_calls';
    } else if (!state.finishReason) {
      state.finishReason = responsesFinishReason(event.response, []);
    }

    const finalChunk = chatStreamChunk(
      state,
      state.roleSent ? {} : { role: 'assistant' },
      state.finishReason ?? 'stop',
    );
    if (state.usage) {
      finalChunk.usage = state.usage;
    }
    chunks.push(finalChunk);
  }

  if (type === 'response.incomplete' && isRecord(event.response)) {
    state.usage = convertResponsesUsageToChatUsage(event.response.usage);
    state.finishReason = responsesFinishReason(event.response, []);
    const finalChunk = chatStreamChunk(
      state,
      state.roleSent ? {} : { role: 'assistant' },
      state.finishReason,
    );
    if (state.usage) {
      finalChunk.usage = state.usage;
    }
    chunks.push(finalChunk);
  }

  return chunks;
}

// Convert OpenAI-style tools to OpenRouter format
export function convertToolsToOpenRouter(tools?: ChatCompletionTool[]): OpenRouterTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  return tools.map(tool => {
    if (tool.type === 'function') {
      return {
        type: 'function' as const,
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters as Record<string, any>,
        },
      };
    }
    return tool as any;
  });
}

// ─── Anthropic Converters ────────────────────────────────────────────────────

/**
 * Extract the system prompt from OpenAI-style messages.
 * Anthropic uses a separate `system` parameter instead of a system role message.
 */
export function extractAnthropicSystemPrompt(messages: ChatCompletionMessageParam[]): string | undefined {
  const systemMessages = messages.filter(m => m.role === 'system');
  if (systemMessages.length === 0) return undefined;

  return systemMessages
    .map(m => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
          .map(block => block.text)
          .join('\n');
      }
      return '';
    })
    .join('\n');
}

/**
 * Convert OpenAI-style messages to Anthropic MessageParam format.
 * Filters out system messages (handled separately) and converts tool calls/results.
 */
export function convertMessagesToAnthropic(messages: ChatCompletionMessageParam[]): MessageParam[] {
  const result: MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        result.push({ role: 'user', content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const contentBlocks: Anthropic.Messages.ContentBlockParam[] = [];
        for (const block of msg.content) {
          if (block.type === 'text') {
            contentBlocks.push({ type: 'text', text: block.text });
          } else if (block.type === 'image_url') {
            // Convert OpenAI image_url to Anthropic image block
            const url = typeof block.image_url === 'string' ? block.image_url : block.image_url.url;
            if (url.startsWith('data:')) {
              const match = url.match(/^data:(image\/\w+);base64,(.+)$/);
              if (match) {
                contentBlocks.push({
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: match[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                    data: match[2],
                  },
                });
              }
            } else {
              contentBlocks.push({
                type: 'image',
                source: {
                  type: 'url',
                  url,
                },
              });
            }
          }
        }
        if (contentBlocks.length > 0) {
          result.push({ role: 'user', content: contentBlocks });
        }
      }
      continue;
    }

    if (msg.role === 'assistant') {
      const contentBlocks: Anthropic.Messages.ContentBlockParam[] = [];

      if (msg.content) {
        if (typeof msg.content === 'string') {
          contentBlocks.push({ type: 'text', text: msg.content });
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'text') {
              contentBlocks.push({ type: 'text', text: block.text });
            }
          }
        }
      }

      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.type === 'function') {
            contentBlocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: safeParseJson(tc.function.arguments || '{}'),
            });
          }
        }
      }

      if (contentBlocks.length > 0) {
        result.push({ role: 'assistant', content: contentBlocks });
      }
      continue;
    }

    if (msg.role === 'tool') {
      // Anthropic tool results must be inside a user message
      const toolResult: ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      };

      // Merge consecutive tool results into a single user message
      const lastMsg = result[result.length - 1];
      if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content)) {
        const hasToolResult = (lastMsg.content as any[]).some((b: any) => b.type === 'tool_result');
        if (hasToolResult) {
          (lastMsg.content as any[]).push(toolResult);
          continue;
        }
      }

      result.push({ role: 'user', content: [toolResult] });
      continue;
    }
  }

  return result;
}

/**
 * Convert OpenAI-style tools to Anthropic Tool format.
 */
export function convertToolsToAnthropic(tools?: ChatCompletionTool[]): Tool[] | undefined {
  if (!tools || tools.length === 0) return undefined;

  return tools
    .filter(tool => tool.type === 'function')
    .map(tool => ({
      name: tool.function.name,
      description: tool.function.description || '',
      input_schema: (tool.function.parameters as Tool['input_schema']) || { type: 'object' as const, properties: {} },
    }));
}

/**
 * Convert Anthropic Message response to OpenAI-compatible chat completion format.
 */
export function convertAnthropicResponseToOpenAI(response: Anthropic.Messages.Message, model: string): any {
  const toolCalls: any[] = [];
  let textContent = '';

  for (const block of response.content) {
    if (block.type === 'text') {
      textContent += block.text;
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      });
    }
  }

  // Map Anthropic stop_reason to OpenAI finish_reason
  const finishReasonMap: Record<string, string> = {
    end_turn: 'stop',
    max_tokens: 'length',
    stop_sequence: 'stop',
    tool_use: 'tool_calls',
  };

  return {
    id: response.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: response.model || model,
    system_fingerprint: null,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: textContent || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          refusal: null,
        },
        logprobs: null,
        finish_reason: finishReasonMap[response.stop_reason || ''] || 'stop',
      },
    ],
    usage: response.usage
      ? {
          prompt_tokens: response.usage.input_tokens,
          completion_tokens: response.usage.output_tokens,
          total_tokens: response.usage.input_tokens + response.usage.output_tokens,
        }
      : undefined,
  };
}

/**
 * Convert Anthropic streaming events to OpenAI-compatible SSE chunk format.
 */
export function convertAnthropicStreamEventToOpenAI(
  event: Anthropic.Messages.RawMessageStreamEvent,
  messageId: string,
  model: string,
): any | null {
  const base = {
    id: messageId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    system_fingerprint: null,
  };

  switch (event.type) {
    case 'message_start': {
      // Send initial chunk with role
      return {
        ...base,
        id: event.message.id,
        model: event.message.model || model,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: '' },
            logprobs: null,
            finish_reason: null,
          },
        ],
      };
    }

    case 'content_block_start': {
      if (event.content_block.type === 'tool_use') {
        return {
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: event.index,
                    id: event.content_block.id,
                    type: 'function',
                    function: {
                      name: event.content_block.name,
                      arguments: '',
                    },
                  },
                ],
              },
              logprobs: null,
              finish_reason: null,
            },
          ],
        };
      }
      // text block start — skip, content comes in deltas
      return null;
    }

    case 'content_block_delta': {
      if (event.delta.type === 'text_delta') {
        return {
          ...base,
          choices: [
            {
              index: 0,
              delta: { content: event.delta.text },
              logprobs: null,
              finish_reason: null,
            },
          ],
        };
      }
      if (event.delta.type === 'input_json_delta') {
        return {
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: event.index,
                    function: {
                      arguments: event.delta.partial_json,
                    },
                  },
                ],
              },
              logprobs: null,
              finish_reason: null,
            },
          ],
        };
      }
      return null;
    }

    case 'message_delta': {
      const finishReasonMap: Record<string, string> = {
        end_turn: 'stop',
        max_tokens: 'length',
        stop_sequence: 'stop',
        tool_use: 'tool_calls',
      };
      return {
        ...base,
        choices: [
          {
            index: 0,
            delta: {},
            logprobs: null,
            finish_reason: finishReasonMap[event.delta.stop_reason || ''] || 'stop',
          },
        ],
        usage: event.usage
          ? {
              prompt_tokens: (event.usage as any).input_tokens ?? 0,
              completion_tokens: event.usage.output_tokens ?? 0,
              total_tokens: ((event.usage as any).input_tokens ?? 0) + (event.usage.output_tokens ?? 0),
            }
          : undefined,
      };
    }

    default:
      return null;
  }
}

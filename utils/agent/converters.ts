import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import type { ChatGenerationParams } from '@openrouter/sdk/models';
import type Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, Tool, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages/messages';

function toTextContent(content: unknown): string | undefined {
  return typeof content === 'string' ? content : undefined;
}

function safeParseJson(value: string, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : fallback;
  } catch {
    return fallback;
  }
}

// Convert OpenAI-style messages to OpenRouter format
export function convertMessagesToOpenRouter(messages: ChatCompletionMessageParam[]): ChatGenerationParams['messages'] {
  return messages.map(msg => {
    if (msg.role === 'system') {
      return { role: 'system' as const, content: toTextContent(msg.content) ?? '' };
    }
    if (msg.role === 'user') {
      return { role: 'user' as const, content: toTextContent(msg.content) ?? '' };
    }
    if (msg.role === 'assistant') {
      const assistantMsg: any = { role: 'assistant' as const };
      if (msg.content) {
        assistantMsg.content = msg.content;
      }
      if (msg.tool_calls) {
        assistantMsg.toolCalls = msg.tool_calls.map(tc => {
          if (tc.type === 'function') {
            return {
              id: tc.id,
              type: tc.type,
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments,
              },
            };
          }
          return tc;
        });
      }
      return assistantMsg;
    }
    if (msg.role === 'tool') {
      return {
        role: 'tool' as const,
        toolCallId: msg.tool_call_id,
        content: toTextContent(msg.content) ?? JSON.stringify(msg.content),
      };
    }
    return msg as any;
  });
}

// Convert OpenAI-style tools to OpenRouter format
export function convertToolsToOpenRouter(tools?: ChatCompletionTool[]): ChatGenerationParams['tools'] {
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

// Convert OpenRouter response to OpenAI-compatible format
export function convertOpenRouterResponseToOpenAI(response: any): any {
  return {
    id: response.id,
    object: response.object,
    created: response.created,
    model: response.model,
    system_fingerprint: response.systemFingerprint ?? null,
    choices: response.choices.map((choice: any) => ({
      index: choice.index,
      message: {
        role: choice.message.role,
        content: choice.message.content ?? null,
        tool_calls: choice.message.toolCalls?.map((tc: any) => ({
          id: tc.id,
          type: tc.type,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
        refusal: choice.message.refusal ?? null,
      },
      logprobs: choice.logprobs ?? null,
      finish_reason: choice.finishReason,
    })),
    usage: response.usage ? {
      prompt_tokens: response.usage.promptTokens ?? response.usage.prompt_tokens,
      completion_tokens: response.usage.completionTokens ?? response.usage.completion_tokens,
      total_tokens: response.usage.totalTokens ?? response.usage.total_tokens,
    } : undefined,
  };
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


// Convert OpenRouter streaming chunk to OpenAI-compatible format
export function convertOpenRouterStreamChunkToOpenAI(chunk: any): any {
  // Handle both wrapped {data: ...} and unwrapped formats
  const data = chunk.data ?? chunk;

  return {
    id: data.id,
    object: data.object,
    created: data.created,
    model: data.model,
    system_fingerprint: data.systemFingerprint ?? null,
    choices: data.choices?.map((choice: any) => ({
      index: choice.index,
      delta: {
        role: choice.delta?.role,
        content: choice.delta?.content,
        tool_calls: choice.delta?.toolCalls?.map((tc: any) => ({
          index: tc.index,
          id: tc.id,
          type: tc.type,
          function: tc.function ? {
            name: tc.function.name,
            arguments: tc.function.arguments,
          } : undefined,
        })),
        refusal: choice.delta?.refusal,
      },
      logprobs: choice.logprobs ?? null,
      finish_reason: choice.finishReason,
    })) ?? [],
    usage: data.usage ? {
      prompt_tokens: data.usage.promptTokens ?? data.usage.prompt_tokens,
      completion_tokens: data.usage.completionTokens ?? data.usage.completion_tokens,
      total_tokens: data.usage.totalTokens ?? data.usage.total_tokens,
    } : undefined,
  };
}

// ─── Anthropic Request → OpenRouter → Anthropic Response Converters ──────────

/**
 * Convert an Anthropic-format request body to OpenRouter-compatible parameters.
 * Used by /v1/messages to proxy through OpenRouter.
 */
export function convertAnthropicRequestToOpenRouter(
  body: any,
  openRouterModel: string,
): ChatGenerationParams {
  const messages: ChatGenerationParams['messages'] = [];

  // Add system message if present
  if (body.system) {
    const systemText = typeof body.system === 'string'
      ? body.system
      : Array.isArray(body.system)
        ? body.system.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
        : '';
    if (systemText) {
      messages.push({ role: 'system' as const, content: systemText });
    }
  }

  // Convert Anthropic messages to OpenRouter format
  for (const msg of body.messages || []) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        messages.push({ role: 'user' as const, content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const toolResults = msg.content.filter((b: any) => b.type === 'tool_result');
        const textBlocks = msg.content.filter((b: any) => b.type === 'text');

        for (const tr of toolResults) {
          messages.push({
            role: 'tool' as const,
            toolCallId: tr.tool_use_id,
            content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
          } as any);
        }

        if (textBlocks.length > 0) {
          const text = textBlocks.map((b: any) => b.text).join('\n');
          if (text) {
            messages.push({ role: 'user' as const, content: text });
          }
        }

        if (toolResults.length === 0 && textBlocks.length === 0) {
          messages.push({ role: 'user' as const, content: JSON.stringify(msg.content) });
        }
      }
    } else if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        messages.push({ role: 'assistant' as const, content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const assistantMsg: any = { role: 'assistant' as const };
        const textParts: string[] = [];
        const toolCalls: any[] = [];

        for (const block of msg.content) {
          if (block.type === 'text') {
            textParts.push(block.text);
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

        if (textParts.length > 0) {
          assistantMsg.content = textParts.join('');
        }
        if (toolCalls.length > 0) {
          assistantMsg.toolCalls = toolCalls;
        }
        messages.push(assistantMsg);
      }
    }
  }

  // Convert tool_choice from Anthropic to OpenAI format
  let toolChoice: any = undefined;
  if (body.tool_choice) {
    if (body.tool_choice.type === 'auto') toolChoice = 'auto';
    else if (body.tool_choice.type === 'any') toolChoice = 'required';
    else if (body.tool_choice.type === 'none') toolChoice = 'none';
    else if (body.tool_choice.type === 'tool') {
      toolChoice = { type: 'function', function: { name: body.tool_choice.name } };
    }
  }

  return {
    model: openRouterModel,
    messages,
    stream: body.stream ?? false,
    temperature: body.temperature ?? undefined,
    maxTokens: body.max_tokens ?? undefined,
    topP: body.top_p ?? undefined,
    tools: convertToolsFromAnthropicToOpenRouter(body.tools),
    toolChoice,
  };
}

/**
 * Convert Anthropic tools to OpenRouter tool format
 */
function convertToolsFromAnthropicToOpenRouter(tools?: any[]): ChatGenerationParams['tools'] {
  if (!tools || tools.length === 0) return undefined;

  return tools.map((tool: any) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema || { type: 'object', properties: {} },
    },
  }));
}

/**
 * Convert OpenRouter (OpenAI-format) response back to Anthropic Message format.
 */
export function convertOpenRouterResponseToAnthropic(response: any, model: string): any {
  const choice = response.choices?.[0];
  if (!choice) {
    return {
      id: response.id || `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  const content: any[] = [];

  if (choice.message?.content) {
    content.push({ type: 'text', text: choice.message.content });
  }

  const toolCalls = choice.message?.tool_calls || choice.message?.toolCalls;
  if (toolCalls) {
    for (const tc of toolCalls) {
      const fn = tc.function;
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: fn.name,
        input: safeParseJson(fn.arguments || '{}'),
      });
    }
  }

  const stopReasonMap: Record<string, string> = {
    stop: 'end_turn',
    length: 'max_tokens',
    tool_calls: 'tool_use',
  };

  const finishReason = choice.finishReason ?? choice.finish_reason ?? 'stop';
  const usage = response.usage;

  return {
    id: response.id || `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content,
    model,
    stop_reason: stopReasonMap[finishReason] || 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: usage?.promptTokens ?? usage?.prompt_tokens ?? 0,
      output_tokens: usage?.completionTokens ?? usage?.completion_tokens ?? 0,
    },
  };
}

/**
 * Convert OpenRouter streaming chunk (OpenAI format) to Anthropic SSE events.
 * Returns an array of {event, data} objects to emit.
 */
export function convertOpenRouterStreamChunkToAnthropicEvents(
  chunk: any,
  state: { messageStarted: boolean; contentIndex: number; model: string },
): Array<{ event: string; data: any }> {
  const data = chunk.data ?? chunk;
  const events: Array<{ event: string; data: any }> = [];
  const choice = data.choices?.[0];
  if (!choice) return events;

  // Emit message_start on first chunk
  if (!state.messageStarted) {
    state.messageStarted = true;
    events.push({
      event: 'message_start',
      data: {
        type: 'message_start',
        message: {
          id: data.id || `msg_${Date.now()}`,
          type: 'message',
          role: 'assistant',
          content: [],
          model: data.model || state.model,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      },
    });
  }

  const delta = choice.delta;
  if (!delta) return events;

  // Handle text content
  if (delta.content) {
    if (state.contentIndex === 0) {
      events.push({
        event: 'content_block_start',
        data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      });
      state.contentIndex = 1;
    }
    events.push({
      event: 'content_block_delta',
      data: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: delta.content },
      },
    });
  }

  // Handle tool calls
  const toolCalls = delta.tool_calls || delta.toolCalls;
  if (toolCalls) {
    for (const tc of toolCalls) {
      const tcIndex = (tc.index ?? 0) + 1;
      if (tc.id) {
        events.push({
          event: 'content_block_start',
          data: {
            type: 'content_block_start',
            index: tcIndex,
            content_block: { type: 'tool_use', id: tc.id, name: tc.function?.name || '', input: {} },
          },
        });
      }
      if (tc.function?.arguments) {
        events.push({
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: tcIndex,
            delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
          },
        });
      }
    }
  }

  // Handle finish
  const finishReason = choice.finishReason ?? choice.finish_reason;
  if (finishReason) {
    events.push({
      event: 'content_block_stop',
      data: { type: 'content_block_stop', index: 0 },
    });

    const stopReasonMap: Record<string, string> = {
      stop: 'end_turn',
      length: 'max_tokens',
      tool_calls: 'tool_use',
    };

    const usage = data.usage;
    events.push({
      event: 'message_delta',
      data: {
        type: 'message_delta',
        delta: {
          stop_reason: stopReasonMap[finishReason] || 'end_turn',
          stop_sequence: null,
        },
        usage: {
          output_tokens: usage?.completionTokens ?? usage?.completion_tokens ?? 0,
        },
      },
    });

    events.push({
      event: 'message_stop',
      data: { type: 'message_stop' },
    });
  }

  return events;
}

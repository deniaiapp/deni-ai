import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import type { ChatGenerationParams } from '@openrouter/sdk/models';

// Convert OpenAI-style messages to OpenRouter format
export function convertMessagesToOpenRouter(messages: ChatCompletionMessageParam[]): ChatGenerationParams['messages'] {
  return messages.map(msg => {
    if (msg.role === 'system') {
      return { role: 'system' as const, content: msg.content as string };
    }
    if (msg.role === 'user') {
      return { role: 'user' as const, content: msg.content as string };
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
        content: msg.content as string,
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

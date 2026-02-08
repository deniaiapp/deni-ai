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

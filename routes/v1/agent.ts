import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { OpenRouter } from '@openrouter/sdk';
import type { ChatGenerationParams, ChatResponse } from '@openrouter/sdk/models';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool, ChatCompletionToolChoiceOption } from 'openai/resources/chat/completions';
import { validateAgentRequest } from '../../middleware/validateRequest';

interface AgentRequest {
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

const router = new Hono<{ Variables: { validatedBody: AgentRequest } }>();

// OpenRouter SDK client
const openrouterClient = new OpenRouter({
  apiKey: Bun.env.OPENROUTER_API_KEY || '',
  httpReferer: "https://deniai.app",
  xTitle: "Deni AI Flixa"
});

// Voids.top (OpenAI compatible) client
const voidsClient = new OpenAI({
  baseURL: Bun.env.OPENAI_COMPAT_BASE_URL || 'https://capi.voids.top/v2',
  apiKey: Bun.env.OPENAI_COMPAT_API_KEY || 'a',
});

type ClientResult =
  | { type: 'openrouter'; client: OpenRouter; providerName: string }
  | { type: 'openai'; client: OpenAI; providerName: string }
  | { error: string };

function getClient(model: string): ClientResult {
  const useOpenRouter = model.includes('/');

  if (useOpenRouter) {
    if (!Bun.env.OPENROUTER_API_KEY) {
      return { error: 'OPENROUTER_API_KEY is required for OpenRouter models' };
    }
    return { type: 'openrouter', client: openrouterClient, providerName: 'openrouter' };
  }

  return { type: 'openai', client: voidsClient, providerName: 'voids.top' };
}

function logToolsRequest(model: string, tools?: ChatCompletionTool[], tool_choice?: ChatCompletionToolChoiceOption) {
  if (!tools || tools.length === 0) return;

  const toolNames = tools.map(t => {
    if (t.type === 'function') {
      return t.function.name;
    }
    return t.type;
  });
  console.log(`[Tools Request] model=${model} tools=[${toolNames.join(', ')}] tool_choice=${JSON.stringify(tool_choice) || 'auto'}`);
}

function logToolsResponseOpenAI(response: OpenAI.Chat.Completions.ChatCompletion) {
  const toolCalls = response.choices[0]?.message?.tool_calls;
  if (!toolCalls || toolCalls.length === 0) return;

  for (const tc of toolCalls) {
    if (tc.type === 'function') {
      console.log(`[Tools Response] id=${tc.id} function=${tc.function.name} arguments=${tc.function.arguments}`);
    }
  }
}

function logToolsResponseOpenRouter(response: ChatResponse) {
  const toolCalls = response.choices?.[0]?.message?.toolCalls;
  if (!toolCalls || toolCalls.length === 0) return;

  for (const tc of toolCalls) {
    console.log(`[Tools Response] id=${tc.id} function=${tc.function.name} arguments=${tc.function.arguments}`);
  }
}

// Convert OpenAI-style messages to OpenRouter format
function convertMessagesToOpenRouter(messages: ChatCompletionMessageParam[]): ChatGenerationParams['messages'] {
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
function convertToolsToOpenRouter(tools?: ChatCompletionTool[]): ChatGenerationParams['tools'] {
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

/**
 * POST /v1/agent/chat/completions
 * OpenAI-style agent endpoint using official SDKs
 */
router.post('/agent/chat/completions', validateAgentRequest, async (c) => {
  try {
    const body = c.get('validatedBody');
    const { messages, model, stream, temperature, max_tokens, top_p, frequency_penalty, presence_penalty, tools, tool_choice } = body;

    logToolsRequest(model, tools, tool_choice);

    if (!model) {
      return c.json({
        error: {
          message: 'model is required',
          type: 'invalid_request_error',
          param: 'model',
          code: 'missing_model'
        }
      }, 400);
    }

    const clientResult = getClient(model);
    if ('error' in clientResult) {
      return c.json({
        error: {
          message: clientResult.error,
          type: 'server_error',
          param: null,
          code: 'missing_provider_key'
        }
      }, 500);
    }

    // Use OpenRouter SDK for OpenRouter models
    if (clientResult.type === 'openrouter') {
      const { client, providerName } = clientResult;

      const openrouterParams: ChatGenerationParams = {
        model,
        messages: convertMessagesToOpenRouter(messages),
        stream: stream ?? false,
        temperature: temperature ?? undefined,
        maxTokens: max_tokens ?? undefined,
        topP: top_p ?? undefined,
        frequencyPenalty: frequency_penalty ?? undefined,
        presencePenalty: presence_penalty ?? undefined,
        tools: convertToolsToOpenRouter(tools),
        toolChoice: tool_choice,
      };

      if (stream) {
        const streamResponse = await client.chat.send({
          chatGenerationParams: { ...openrouterParams, stream: true },
        });

        // Convert OpenRouter stream to SSE Response
        const encoder = new TextEncoder();
        const readable = new ReadableStream({
          async start(controller) {
            try {
              for await (const chunk of streamResponse) {
                const data = JSON.stringify(chunk);
                controller.enqueue(encoder.encode(`data: ${data}\n\n`));
              }
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
            } catch (error) {
              console.error(`[Stream Error] provider=${providerName}:`, error);
              controller.error(error);
            }
          }
        });

        return new Response(readable, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          }
        });
      }

      // Non-streaming request
      const response = await client.chat.send({
        chatGenerationParams: { ...openrouterParams, stream: false },
      });

      logToolsResponseOpenRouter(response);
      return c.json(response, 200);
    }

    // Use OpenAI SDK for voids.top
    const { client, providerName } = clientResult;

    const requestParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming | OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model,
      messages,
      stream: stream ?? false,
      temperature,
      max_tokens,
      top_p,
      frequency_penalty,
      presence_penalty,
      tools: tools && tools.length > 0 ? tools : undefined,
      tool_choice: tools && tools.length > 0 ? tool_choice : undefined,
    };

    if (stream) {
      const streamResponse = await client.chat.completions.create({
        ...requestParams,
        stream: true,
      });

      // Convert OpenAI stream to SSE Response
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of streamResponse) {
              const data = JSON.stringify(chunk);
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          } catch (error) {
            console.error(`[Stream Error] provider=${providerName}:`, error);
            controller.error(error);
          }
        }
      });

      return new Response(readable, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        }
      });
    }

    // Non-streaming request
    const response = await client.chat.completions.create({
      ...requestParams,
      stream: false,
    });

    logToolsResponseOpenAI(response);
    return c.json(response, 200);

  } catch (error) {
    console.error('Agent error:', error);

    if (error instanceof OpenAI.APIError) {
      const statusCode = (error.status || 500) as ContentfulStatusCode;
      return c.json({
        error: {
          message: error.message,
          type: error.type || 'api_error',
          param: null,
          code: error.code || null
        }
      }, statusCode);
    }

    const err = error as Error;
    return c.json({
      error: {
        message: err.message || 'Internal server error',
        type: 'server_error',
        param: null,
        code: null
      }
    }, 500);
  }
});

export { router as agentRouter };

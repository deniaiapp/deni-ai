import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ChatGenerationParams } from '@openrouter/sdk/models';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { validateAgentRequest } from '../../middleware/validateRequest';
import { validateAnthropicRequest } from '../../middleware/validateAnthropicRequest';
import { validateAgentAuth, type AgentAuthContext } from '../../middleware/validateAgentAuth';
import { incrementUsage } from '../../utils/deni';
import {
  type AgentRequest,
  getClient,
  convertMessagesToOpenRouter,
  convertMessagesToAnthropic,
  convertToolsToAnthropic,
  extractAnthropicSystemPrompt,
  convertAnthropicResponseToOpenAI,
  convertAnthropicStreamEventToOpenAI,
  convertToolsToOpenRouter,
  convertOpenRouterResponseToOpenAI,
  convertOpenRouterStreamChunkToOpenAI,
  convertAnthropicRequestToOpenRouter,
  convertOpenRouterResponseToAnthropic,
  convertOpenRouterStreamChunkToAnthropicEvents,
  openrouterClient,
} from '../../utils/agent';

const router = new Hono<{ Variables: { validatedBody: AgentRequest; agentAuth: AgentAuthContext } }>();

/**
 * POST /v1/agent/chat/completions
 * OpenAI-style agent endpoint using official SDKs
 */
router.post('/agent/chat/completions', validateAgentRequest, validateAgentAuth, async (c) => {
  try {
    const body = c.get('validatedBody');
    const { messages, model, stream, temperature, max_tokens, top_p, frequency_penalty, presence_penalty, tools, tool_choice } = body;
    const auth = c.get('agentAuth') as AgentAuthContext;

    // model is guaranteed to exist after validateAgentAuth middleware
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
                const converted = convertOpenRouterStreamChunkToOpenAI(chunk);
                const data = JSON.stringify(converted);
                controller.enqueue(encoder.encode(`data: ${data}\n\n`));
              }
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
              incrementUsage(auth.userId, auth.modelCategory).catch(() => {});
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

      incrementUsage(auth.userId, auth.modelCategory).catch(() => {});
      return c.json(convertOpenRouterResponseToOpenAI(response), 200);
    }

    // Use Anthropic SDK for direct Claude API access
    if (clientResult.type === 'anthropic') {
      const { client, providerName } = clientResult;

      const systemPrompt = extractAnthropicSystemPrompt(messages);
      const anthropicMessages = convertMessagesToAnthropic(messages);
      const anthropicTools = convertToolsToAnthropic(tools);

      const anthropicParams: Anthropic.Messages.MessageCreateParams = {
        model,
        messages: anthropicMessages,
        max_tokens: max_tokens ?? 8192,
        system: systemPrompt,
        temperature: temperature ?? undefined,
        top_p: top_p ?? undefined,
        tools: anthropicTools,
        stream: stream ?? false,
      };

      // Handle tool_choice conversion
      if (anthropicTools && anthropicTools.length > 0 && tool_choice) {
        if (tool_choice === 'auto') {
          anthropicParams.tool_choice = { type: 'auto' };
        } else if (tool_choice === 'required') {
          anthropicParams.tool_choice = { type: 'any' };
        } else if (tool_choice === 'none') {
          anthropicParams.tool_choice = { type: 'none' };
        } else if (typeof tool_choice === 'object' && tool_choice.type === 'function') {
          anthropicParams.tool_choice = { type: 'tool', name: tool_choice.function.name };
        }
      }

      if (stream) {
        const streamResponse = client.messages.stream({
          ...anthropicParams,
          stream: undefined,
        } as Anthropic.Messages.MessageCreateParamsNonStreaming);

        const encoder = new TextEncoder();
        let messageId = '';
        let responseModel = model;

        const readable = new ReadableStream({
          async start(controller) {
            try {
              for await (const event of streamResponse) {
                if (event.type === 'message_start') {
                  messageId = event.message.id;
                  responseModel = event.message.model || model;
                }

                const converted = convertAnthropicStreamEventToOpenAI(
                  event as Anthropic.Messages.RawMessageStreamEvent,
                  messageId,
                  responseModel,
                );

                if (converted) {
                  const data = JSON.stringify(converted);
                  controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                }
              }
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
              incrementUsage(auth.userId, auth.modelCategory).catch(() => {});
            } catch (error) {
              console.error(`[Stream Error] provider=${providerName}:`, error);
              controller.error(error);
            }
          },
        });

        return new Response(readable, {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });
      }

      // Non-streaming request
      const response = await client.messages.create({
        ...anthropicParams,
        stream: false,
      });

      incrementUsage(auth.userId, auth.modelCategory).catch(() => {});
      return c.json(convertAnthropicResponseToOpenAI(response, model), 200);
    }

    // Use OpenAI SDK for voids.top (fallback)
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
            incrementUsage(auth.userId, auth.modelCategory).catch(() => {});
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

    incrementUsage(auth.userId, auth.modelCategory).catch(() => {});
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

    if (error instanceof Anthropic.APIError) {
      const statusCode = (error.status || 500) as ContentfulStatusCode;
      const apiError = error as { message: string; type?: string; code?: string | null };
      return c.json({
        error: {
          message: apiError.message,
          type: apiError.type || 'api_error',
          param: null,
          code: apiError.code || null
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

/**
 * POST /v1/messages
 * Anthropic-compatible endpoint for Claude Code.
 * Routes through OpenRouter: Anthropic request → OpenRouter → Anthropic response
 */
router.post('/messages', validateAnthropicRequest, validateAgentAuth, async (c) => {
  try {
    const body = c.get('validatedBody') as Anthropic.Messages.MessageCreateParams;
    const { model, stream } = body;
    const auth = c.get('agentAuth') as AgentAuthContext;

    if (!Bun.env.OPENROUTER_API_KEY) {
      return c.json({
        error: {
          message: 'OPENROUTER_API_KEY is required for this endpoint',
          type: 'server_error',
          param: null,
          code: 'missing_provider_key',
        },
      }, 500);
    }

    // Prefix model with anthropic/ for OpenRouter routing
    const openRouterModel = model.startsWith('anthropic/') ? model : `anthropic/${model}`;
    const openrouterParams = convertAnthropicRequestToOpenRouter(body, openRouterModel);

    if (stream) {
      const streamResponse = await openrouterClient.chat.send({
        chatGenerationParams: { ...openrouterParams, stream: true },
      });

      const encoder = new TextEncoder();
      const streamState = { messageStarted: false, contentIndex: 0, model };

      const readable = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of streamResponse) {
              const anthropicEvents = convertOpenRouterStreamChunkToAnthropicEvents(chunk, streamState);
              for (const evt of anthropicEvents) {
                controller.enqueue(encoder.encode(`event: ${evt.event}\n`));
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(evt.data)}\n\n`));
              }
            }
            controller.close();
            incrementUsage(auth.userId, auth.modelCategory).catch(() => {});
          } catch (error) {
            console.error('[Stream Error] provider=openrouter (messages):', error);
            controller.error(error);
          }
        },
      });

      return new Response(readable, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    // Non-streaming request
    const response = await openrouterClient.chat.send({
      chatGenerationParams: { ...openrouterParams, stream: false },
    });

    incrementUsage(auth.userId, auth.modelCategory).catch(() => {});
    return c.json(convertOpenRouterResponseToAnthropic(response, model), 200);
  } catch (error) {
    console.error('Anthropic endpoint error:', error);

    const err = error as Error;
    return c.json({
      error: {
        message: err.message || 'Internal server error',
        type: 'server_error',
        param: null,
        code: null,
      },
    }, 500);
  }
});

export { router as agentRouter };

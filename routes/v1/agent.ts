import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ChatGenerationParams } from '@openrouter/sdk/models';
import OpenAI from 'openai';
import { validateAgentRequest } from '../../middleware/validateRequest';
import { validateAgentAuth, type AgentAuthContext } from '../../middleware/validateAgentAuth';
import {
  type AgentRequest,
  getClient,
  convertMessagesToOpenRouter,
  convertToolsToOpenRouter,
  convertOpenRouterResponseToOpenAI,
  convertOpenRouterStreamChunkToOpenAI,
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

      return c.json(convertOpenRouterResponseToOpenAI(response), 200);
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

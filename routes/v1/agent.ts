import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { validateAgentRequest } from '../../middleware/validateRequest';

interface Tool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface AgentRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
  }>;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  tools?: Tool[];
  tool_choice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
}

const router = new Hono<{ Variables: { validatedBody: AgentRequest } }>();

interface ProviderConfig {
  baseUrl: string;
  headers: Record<string, string>;
}

function getProviderConfig(model: string): { config: ProviderConfig; providerName: string } | { error: string } {
  const useOpenRouter = model.includes('/');

  if (useOpenRouter) {
    const apiKey = Bun.env.OPENROUTER_API_KEY || '';
    if (!apiKey) {
      return { error: 'OPENROUTER_API_KEY is required for OpenRouter models' };
    }
    return {
      config: {
        baseUrl: Bun.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      },
      providerName: 'openrouter'
    };
  }

  const baseUrl = Bun.env.OPENAI_COMPAT_BASE_URL || 'https://capi.voids.top/v2';
  const apiKey = Bun.env.OPENAI_COMPAT_API_KEY || 'a';

  return {
    config: {
      baseUrl,
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
    },
    providerName: 'openai-compatible'
  };
}

function buildChatCompletionsUrl(baseUrl: string) {
  const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL('chat/completions', normalized).toString();
}

function logToolsRequest(model: string, tools?: Tool[], tool_choice?: AgentRequest['tool_choice']) {
  if (!tools || tools.length === 0) return;

  const toolNames = tools.map(t => t.function.name);
  console.log(`[Tools Request] model=${model} tools=[${toolNames.join(', ')}] tool_choice=${JSON.stringify(tool_choice) || 'auto'}`);
}

function logToolsResponse(data: Record<string, unknown>) {
  const choices = data.choices as Array<{ message?: { tool_calls?: ToolCall[] } }> | undefined;
  if (!choices || choices.length === 0) return;

  const toolCalls = choices[0]?.message?.tool_calls;
  if (!toolCalls || toolCalls.length === 0) return;

  for (const tc of toolCalls) {
    console.log(`[Tools Response] id=${tc.id} function=${tc.function.name} arguments=${tc.function.arguments}`);
  }
}

/**
 * POST /v1/agent/chat/completions
 * OpenAI-style agent endpoint proxied directly to upstream providers
 */
router.post('/agent/chat/completions', validateAgentRequest, async (c) => {
  try {
    // Get validated body from context (set by middleware)
    const body = c.get('validatedBody');
    const { messages, model, stream, temperature, max_tokens, top_p, frequency_penalty, presence_penalty, tools, tool_choice, ...rest } = body;

    // Log tools request
    logToolsRequest(model, tools, tool_choice);

    // Validate model is provided
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

    const providerResult = getProviderConfig(model);
    if ('error' in providerResult) {
      return c.json({
        error: {
          message: providerResult.error,
          type: 'server_error',
          param: null,
          code: 'missing_provider_key'
        }
      }, 500);
    }

    const { config, providerName } = providerResult;
    const url = buildChatCompletionsUrl(config.baseUrl);

    const requestBody = {
      messages,
      model,
      stream,
      temperature,
      max_tokens,
      top_p,
      frequency_penalty,
      presence_penalty,
      tools,
      tool_choice,
      ...rest
    };

    const upstreamResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...config.headers
      },
      body: JSON.stringify(requestBody)
    });

    if (stream) {
      if (!upstreamResponse.ok) {
        return await handleUpstreamError(c, upstreamResponse, providerName);
      }

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: {
          'Content-Type': upstreamResponse.headers.get('Content-Type') || 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        }
      });
    }

    if (!upstreamResponse.ok) {
      return await handleUpstreamError(c, upstreamResponse, providerName);
    }

    const data = await upstreamResponse.json();
    logToolsResponse(data as Record<string, unknown>);
    return c.json(data, upstreamResponse.status as ContentfulStatusCode);
  } catch (error) {
    console.error('Agent error:', error);
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

async function handleUpstreamError(c: any, response: Response, providerName: string) {
  const contentType = response.headers.get('Content-Type') || '';
  const text = await response.text();
  if (contentType.includes('application/json')) {
    try {
      const data = JSON.parse(text);
      return c.json(data, response.status);
    } catch {
      return c.json({
        error: {
          message: text || 'Upstream error',
          type: 'server_error',
          param: null,
          code: 'upstream_error'
        }
      }, response.status);
    }
  }

  return c.json({
    error: {
      message: text || `Upstream error from ${providerName}`,
      type: 'server_error',
      param: null,
      code: 'upstream_error'
    }
  }, response.status);
}

export { router as agentRouter };

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

export type ChatToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export type ChatMessage =
  | {
      role: 'system' | 'user';
      content: string | ChatContentPart[];
    }
  | {
      role: 'assistant';
      content?: string | ChatContentPart[] | null;
      tool_calls?: ChatToolCall[];
    }
  | {
      role: 'tool';
      tool_call_id: string;
      content: string | ChatContentPart[];
    };

export type ChatTool = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ChatCompletionRequest = {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  reasoning_effort?:
    | 'none'
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh'
    | 'max';
  tools?: ChatTool[];
  tool_choice?:
    | 'none'
    | 'auto'
    | 'required'
    | { type: 'function'; function: { name: string } };
  [key: string]: unknown;
};

export type ResponsesRequest = {
  model: string;
  input?: string | unknown[];
  instructions?: string;
  previous_response_id?: string;
  stream?: boolean;
  temperature?: number;
  max_output_tokens?: number;
  reasoning?: {
    effort?:
      | 'none'
      | 'minimal'
      | 'low'
      | 'medium'
      | 'high'
      | 'xhigh'
      | 'max';
    summary?: 'auto' | 'concise' | 'detailed';
    context?: 'auto' | 'current_turn' | 'all_turns';
    mode?: 'standard' | 'pro';
  };
  tools?: Array<Record<string, unknown>>;
  tool_choice?: unknown;
  store?: boolean;
  include?: string[];
  /** Optional server-side compaction (opt-in). Prefer compactResponse() for client-driven compact. */
  context_management?: Array<{
    type: string;
    compact_threshold?: number | null;
  }> | null;
  [key: string]: unknown;
};

export type ResponsesCompactRequest = {
  model: string;
  input?: string | unknown[];
  instructions?: string;
  previous_response_id?: string;
  [key: string]: unknown;
};

export type ChatCompletionResponse = {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: ChatToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type FlixaClientOptions = {
  baseUrl?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
};

type ErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

function resolveDefaultBaseUrl() {
  const envBaseUrl =
    (typeof process !== 'undefined' && process.env?.FLIXA_API_URL) ||
    (globalThis as { Bun?: { env?: Record<string, string> } }).Bun?.env?.FLIXA_API_URL;
  return envBaseUrl || 'http://localhost:3000';
}

const FLIXA_SDK_USER_AGENT = 'flixa-sdk/1.0';

export class FlixaClient {
  private baseUrl: string;
  private headers: Record<string, string>;
  private fetcher: typeof fetch;

  constructor(options: FlixaClientOptions = {}) {
    this.baseUrl = options.baseUrl || resolveDefaultBaseUrl();
    this.headers = options.headers || {};
    this.fetcher = options.fetch || fetch;
  }

  async createChatCompletion(body: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const response = await this.request('/v1/agent/chat/completions', {
      ...body,
      stream: false,
    });
    if (!response.ok) {
      throw await this.buildError(response);
    }
    return await response.json() as ChatCompletionResponse;
  }

  async streamChatCompletion(body: ChatCompletionRequest): Promise<Response> {
    const response = await this.request('/v1/agent/chat/completions', {
      ...body,
      stream: true,
    });
    if (!response.ok) {
      throw await this.buildError(response);
    }
    return response;
  }

  /**
   * Preferred for long-running agents (OpenAI recommendation):
   * Responses API with retained reasoning + optional server-side compaction.
   */
  async createResponse(body: ResponsesRequest): Promise<unknown> {
    const response = await this.request('/v1/agent/responses', {
      ...body,
      stream: false,
    });
    if (!response.ok) {
      throw await this.buildError(response);
    }
    return await response.json();
  }

  async streamResponse(body: ResponsesRequest): Promise<Response> {
    const response = await this.request('/v1/agent/responses', {
      ...body,
      stream: true,
    });
    if (!response.ok) {
      throw await this.buildError(response);
    }
    return response;
  }

  /** Compact a long context window for the next Responses call. */
  async compactResponse(body: ResponsesCompactRequest): Promise<unknown> {
    const response = await this.request('/v1/agent/responses/compact', body);
    if (!response.ok) {
      throw await this.buildError(response);
    }
    return await response.json();
  }

  private async request(path: string, body: Record<string, unknown>) {
    const url = this.buildUrl(path);
    // Always identify as Flixa so server-side abuse prevention accepts the call.
    // Callers can still override via options.headers (spread after defaults).
    return await this.fetcher(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': FLIXA_SDK_USER_AGENT,
        'x-flixa-client': 'sdk',
        ...this.headers
      },
      body: JSON.stringify(body)
    });
  }

  private buildUrl(path: string) {
    const normalized = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`;
    return new URL(path.replace(/^\//, ''), normalized).toString();
  }

  private async buildError(response: Response) {
    const contentType = response.headers.get('Content-Type') || '';
    const text = await response.text();
    if (contentType.includes('application/json')) {
      try {
        const data = JSON.parse(text) as ErrorBody;
        const message = data.error?.message || text || 'Request failed';
        return new Error(message);
      } catch {
        return new Error(text || 'Request failed');
      }
    }
    return new Error(text || 'Request failed');
  }
}

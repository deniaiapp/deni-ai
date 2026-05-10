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
  tools?: ChatTool[];
  tool_choice?:
    | 'none'
    | 'auto'
    | 'required'
    | { type: 'function'; function: { name: string } };
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
    const response = await this.request({ ...body, stream: false });
    if (!response.ok) {
      throw await this.buildError(response);
    }
    return await response.json() as ChatCompletionResponse;
  }

  async streamChatCompletion(body: ChatCompletionRequest): Promise<Response> {
    const response = await this.request({ ...body, stream: true });
    if (!response.ok) {
      throw await this.buildError(response);
    }
    return response;
  }

  private async request(body: ChatCompletionRequest) {
    const url = this.buildUrl('/v1/agent/chat/completions');
    return await this.fetcher(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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

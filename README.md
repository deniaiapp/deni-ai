# Flixa Backend

OpenAI API style backend with `/v1/agent/chat/completions` router proxying directly to OpenRouter or an OpenAI-compatible upstream.

Built with **TypeScript**, **Hono**, and **Bun**.

## Features

- OpenAI-compatible API structure
- Direct HTTP proxying to OpenRouter or OpenAI-compatible APIs
- Streaming support (Server-Sent Events)
- Request validation
- Error handling in OpenAI format
- TypeScript for type safety
- Hono web framework (fast & lightweight)
- Bun runtime (ultra-fast JavaScript runtime)
- Support for all OpenRouter models

## Prerequisites

Install [Bun](https://bun.sh):

```bash
curl -fsSL https://bun.sh/install | bash
```

## Installation

```bash
bun install
```

### API Endpoint

#### POST `/v1/agent/chat/completions`

OpenAI-style agent endpoint (OpenRouter or OpenAI-compatible upstream).

**Request Body:**
```json
{
  "model": "openai/gpt-4",
  "messages": [
    {
      "role": "user",
      "content": "Hello, how are you?"
    }
  ],
  "stream": false,
  "temperature": 0.7,
  "max_tokens": 1000
}
```

**Note:** The `model` field should use OpenRouter model format (e.g., `openai/gpt-4`, `anthropic/claude-3-opus`, `google/gemini-pro`, etc.). See [OpenRouter Models](https://openrouter.ai/models) for available models.

#### POST `/v1/messages`

Anthropic-compatible Messages API endpoint for Claude Code. Requires a direct Anthropic API key and supports `x-api-key` authentication.

**Request Body (Anthropic format):**
```json
{
  "model": "claude-3-5-sonnet-20240620",
  "max_tokens": 1024,
  "messages": [
    { "role": "user", "content": "Hello from Claude Code" }
  ]
}
```

**Response (Non-streaming):**
```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "gpt-4",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Agent response..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 10,
    "total_tokens": 20
  }
}
```

**Streaming Response:**

Set `"stream": true` in the request body. The response will be sent as Server-Sent Events (SSE).

## Environment Variables

Create a `.env` file:

```
PORT=3000
OPENROUTER_API_KEY=your_openrouter_api_key_here
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENAI_COMPAT_BASE_URL=https://capi.voids.top/v2
OPENAI_COMPAT_API_KEY=a
ANTHROPIC_API_KEY=your_anthropic_api_key_here
# Optional performance safeguards
FLIXA_UPSTREAM_TIMEOUT_MS=120000
FLIXA_USAGE_FINALIZE_ASYNC=false
ACCESS_LOG_ENABLED=false
CLIENT_SIGNAL_ALLOWED_LOG_ENABLED=false
```

Get your OpenRouter API key from [OpenRouter](https://openrouter.ai/keys).
`OPENROUTER_API_KEY` is required when `model` includes `/` (OpenRouter format). If you use an OpenAI-compatible model name without `/`, requests go to `OPENAI_COMPAT_BASE_URL`.

`FLIXA_UPSTREAM_TIMEOUT_MS` is an upstream connect/idle timeout. Streaming
requests refresh it whenever a chunk arrives, so a healthy long-running stream
is not cut off by total duration. Set it to `0` to disable it. Access logs and
allowed client-signal console logs can be disabled independently in production;
the in-memory client-signal lookup ring buffer remains available.
`FLIXA_USAGE_FINALIZE_ASYNC=true` returns token-metered responses without waiting
for the usage upsert; use it only when a short quota visibility delay is
acceptable.

## Supported Models

This backend supports all models available through OpenRouter, including:

- OpenAI models (gpt-4, gpt-3.5-turbo, etc.)
- Anthropic models (claude-3-opus, claude-3-sonnet, etc.)
- Google models (gemini-pro, etc.)
- Meta models (llama-2, etc.)
- And many more...

See the full list at [OpenRouter Models](https://openrouter.ai/models).

## Usage

### Start Server

```bash
bun start
```

For development with auto-reload:

```bash
bun dev
```

### Type Checking

```bash
bun run typecheck
```

## Project Structure

```
flixa-backend/
├── server.ts                  # Main server file (Hono + Bun)
├── tsconfig.json              # TypeScript configuration
├── routes/
│   └── v1/
│       └── agent.ts           # Agent router (direct proxy)
├── middleware/
│   ├── validateRequest.ts     # Request validation
│   └── errorHandler.ts        # Error handling
└── package.json
```

## SDK (Local Client)

This repo includes a lightweight client in `utils/flixa-sdk.ts`.

```ts
import { FlixaClient } from './utils/flixa-sdk';

const client = new FlixaClient({ baseUrl: 'http://localhost:3000' });

const result = await client.createChatCompletion({
  model: 'openai/gpt-4',
  messages: [{ role: 'user', content: 'Hello!' }],
  temperature: 0.7
});

const streamResponse = await client.streamChatCompletion({
  model: 'openai/gpt-4',
  messages: [{ role: 'user', content: 'Stream me' }],
  stream: true
});
```

# Flixa Backend

OpenAI API style backend with `/v1/agent/chat/completions` router proxying directly to OpenRouter or an OpenAI-compatible upstream.

Built with **TypeScript**, **Hono**, and **Node.js**.

## Features

- OpenAI-compatible API structure
- Direct HTTP proxying to OpenRouter or OpenAI-compatible APIs
- Streaming support (Server-Sent Events)
- Request validation
- Error handling in OpenAI format
- TypeScript for type safety
- Hono web framework (fast & lightweight)
- Node.js 26+ runtime (TypeScript run via `tsx`, production bundle via esbuild)
- Support for all OpenRouter models

## Prerequisites

- [Node.js](https://nodejs.org) 26 or newer
- [pnpm](https://pnpm.io) 12

## Installation

```bash
pnpm install
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
DENI_AI_API_KEY=deni_your_deni_ai_api_key_here
# DENI_AI_API_BASE_URL=https://api.deniai.app/v1
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
# Local development only: bypass Flixa API/admin auth and related limits
# FLIXA_AUTH_DISABLED=true
```

Get your OpenRouter API key from [OpenRouter](https://openrouter.ai/keys).
`DENI_AI_API_KEY` is required for OpenAI models (`openai/...`), which go through Deni AI API: Chat Completions to `/v1/chat/completions` and `/v1/agent/responses` to `/v1/responses`. Deni AI API has no Responses compaction, so `/v1/agent/responses/compact` returns `400` for these models.
`OPENROUTER_API_KEY` is required when any other `model` includes `/` (OpenRouter format). If you use an OpenAI-compatible model name without `/`, requests go to `OPENAI_COMPAT_BASE_URL`.

`FLIXA_UPSTREAM_TIMEOUT_MS` is an upstream connect/idle timeout. Streaming
requests refresh it whenever a chunk arrives, so a healthy long-running stream
is not cut off by total duration. Set it to `0` to disable it. Access logs and
allowed client-signal console logs can be disabled independently in production;
the in-memory client-signal lookup ring buffer remains available.
Access logs, HTTP error logs, and client-signal logs include a redacted API key
fingerprint (`deni_xxxx…yyyy`) from `Authorization: Bearer` or `x-api-key`; the
full secret is never written. Admin lookup can filter on that fingerprint.
`FLIXA_USAGE_FINALIZE_ASYNC=true` returns token-metered responses without waiting
for settlement. The estimated usage remains reserved until settlement completes.

### Quota reservation and interrupted streams

Requests atomically reserve estimated usage units (weighted tokens; 1M units =
$0.50 of the shared monthly pool) in `usage_quota.used` before contacting a
provider. Quota rows, Flixa's `product_usage` rows, and the usage endpoint's
`unit` field all use `units`. The estimate includes the supplied output limit,
or the model catalog's maximum output (16,384 tokens when unavailable). Requests
whose estimate does not fit the remaining allowance receive 429; use a smaller
output limit or wait for in-flight requests to finish. The usage endpoint includes
active reservations in `used`.

Successful responses replace the reservation with provider-reported usage.
Rejected upstream requests refund it. Interrupted streams preserve reported usage
and estimate missing input/output from request content and received text, reasoning,
and tool-argument deltas. UTF-8 bytes / 4 is an approximation; cached history,
media, and hidden reasoning may differ, so this is not an exact provider-token
cap. Actual usage above an estimate is still recorded and blocks subsequent work.

`flixa_usage_reservation` is created automatically on first use (the DB role needs
`CREATE TABLE` permission). Its receipts make settlement idempotent and prevent old
refunds from affecting a newly reset month or tier. On process termination or a DB
settlement failure, the reserved estimate remains charged; outstanding receipts
are retained for reconciliation. Do not blindly delete/refund them: provider work
may already have completed. Receipt IDs are included in settlement failure logs.
The accounting regression tests use an isolated PostgreSQL/WASM database and never
connect to `DENI_DATABASE_URL`.

### Client IPs and reverse proxies

IP rate limits, admin audit logs, and `ADMIN_IP_ALLOWLIST` use the actual socket
peer (Node's `socket.remoteAddress`) by default. Forwarded headers are ignored unless that peer matches
`TRUSTED_PROXY_IPS` (comma-separated exact IPv4/IPv6 addresses or CIDRs).

For a local reverse proxy, for example:

```env
TRUSTED_PROXY_IPS=127.0.0.1,::1
CLIENT_IP_HEADER=x-forwarded-for
```

Use the actual proxy addresses in your deployment. The default `x-forwarded-for`
chain is walked from right to left through trusted proxies, stopping at the first
untrusted hop. `CLIENT_IP_HEADER=x-real-ip` or `cf-connecting-ip` is also supported,
but only configure these when the trusted proxy overwrites that header. If trust
is not configured behind a proxy, clients share that proxy's IP rate-limit bucket.
This setting identifies trusted infrastructure; it does not require end users to
have fixed IPs or enable the optional admin allowlist.

Basic authentication on every protected admin route shares the same IP attempt
bucket as `POST /admin/login`. Valid cookie sessions do not consume that bucket.

### Codex custom provider

Codex only sends `Authorization: Bearer` when the provider has `env_key` or
`requires_openai_auth = true`. If both are unset, Codex assumes the provider
needs no auth and POSTs `/v1/agent/responses` with no key — this backend
returns `401 missing_api_key`.

```toml
model = "gpt-5.6-luna"
model_provider = "flixa"

[model_providers.flixa]
name = "Flixa"
base_url = "https://YOUR_FLIXA_HOST/v1/agent"
wire_api = "responses"
env_key = "FLIXA_API_KEY"
requires_openai_auth = false

# Windows Codex TUI (Start menu / shortcut) often cannot see a PowerShell $env:.
# http_headers is sent on every request without an environment variable.
[model_providers.flixa.http_headers]
Authorization = "Bearer deni_..."
```

```bash
export FLIXA_API_KEY="deni_..."
```

On Windows the file is `%USERPROFILE%\.codex\config.toml`. Restart Codex TUI
after saving. A `codex-tui` 401 with `hasAuthorization: false` means this
provider block is missing or the process has an empty `FLIXA_API_KEY`.

Do not point the built-in `openai` provider at Flixa via `openai_base_url`
unless you also send a Deni API key. ChatGPT login tokens are not Flixa keys.

Set `FLIXA_AUTH_DISABLED=true` only for local development when you need to test
upstream requests without a Deni API key or database-backed account. It
bypasses Flixa API-key authentication, client-signal and ban enforcement,
billing/tier/quota checks, rate limits, and `/admin` authentication. Request
shape validation and upstream provider credentials are still required. The
server logs a prominent warning when this mode is enabled; never enable it on
an internet-facing or production instance. Optionally set
`FLIXA_AUTH_DISABLED_USER_ID` to choose the synthetic user id used internally.

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
pnpm start
```

For automatic restart after a server crash:

```bash
pnpm run start:supervised
```

Pass server arguments after `--` when needed:

```bash
pnpm run start:supervised -- --port 3000
```

The supervisor restarts only non-zero exits, uses a bounded backoff, and stops
without restarting when you press Ctrl+C.

For development with auto-reload:

```bash
pnpm dev
```

To build and run the bundled server:

```bash
pnpm run build
pnpm run start:dist
```

### Type Checking

```bash
pnpm run typecheck
```

### Tests

```bash
pnpm test
```

## Project Structure

```
flixa-backend/
├── server.ts                  # Main server file (Hono + Node.js)
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

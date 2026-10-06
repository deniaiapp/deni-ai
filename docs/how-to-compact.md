# How to compact context (Flixa)

Long-running agent sessions accumulate messages, tool results, and retained reasoning. **Compaction** shrinks that window while keeping an encrypted summary of prior state so the next turn can continue without replaying the full history.

Flixa does **not** auto-compact on every `/responses` call. The client decides when to compact.

## Codex 1M context

GPT-5.6 Sol, Terra, and Luna expose a `1,050,000`-token context window. When
Codex uses this backend with the Responses wire API, set the local Codex
context budget explicitly and leave room for automatic compaction:

```toml
model = "gpt-5.6-luna"
model_context_window = 1000000
model_auto_compact_token_limit = 900000

[model_providers.flixa]
wire_api = "responses"
```

The backend preserves Codex's Responses input, compaction settings, truncation
mode, and retained reasoning items. Use `gpt-5.6` to select the Sol alias, or
select `gpt-5.6-sol`, `gpt-5.6-terra`, or `gpt-5.6-luna` directly.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/v1/agent/responses` | Normal turn (reasoning retained via encrypted items) |
| `POST` | `/v1/agent/responses/compact` | **Explicit** compaction of the current context window |

Auth is the same as other agent routes (`validateAgentAuth`: API key / quota).

## Recommended flow (client-driven)

1. Keep a local `input` array (user messages, assistant items, tool calls/outputs, reasoning items with `encrypted_content`).
2. Call `POST /v1/agent/responses` each turn; **append every `output` item** to your history (do not drop reasoning items).
3. When the window is large (token estimate, turn count, or after a phase boundary), call **`POST /v1/agent/responses/compact`** with that full window.
4. Replace local history with the compact response’s `output` **as-is** (do not prune it).
5. Append the next user message and continue with `/responses`.

```
[client history] --compact--> [compacted.output] + new user msg --> /responses
```

### Why client-driven?

- You control **when** quality is traded for size (phase boundaries, after big tool dumps, etc.).
- Server-side auto thresholds fire mid-turn and are harder to reason about for agents.
- Matches OpenAI’s standalone compact endpoint model for ZDR-friendly, stateless apps.

## Standalone compact API

### Request

```http
POST /v1/agent/responses/compact
Content-Type: application/json
Authorization: Bearer <FLIXA_API_KEY>
```

```json
{
  "model": "openai/gpt-6-luna",
  "input": [
    { "role": "user", "content": "Plan a multi-file refactor." },
    {
      "type": "message",
      "role": "assistant",
      "status": "completed",
      "content": [{ "type": "output_text", "text": "I'll inspect the repo…" }]
    },
    {
      "type": "function_call",
      "call_id": "call_1",
      "name": "read_file",
      "arguments": "{\"path\":\"src/index.ts\"}",
      "status": "completed"
    },
    {
      "type": "function_call_output",
      "call_id": "call_1",
      "output": "…large file contents…"
    }
  ],
  "instructions": "optional system guidance"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `model` | yes | Same model family you use for subsequent `/responses` turns |
| `input` | one of | Full context window (string or item array). Chat-style `messages` also accepted and converted |
| `messages` | one of | Fallback if you still hold Chat Completions-style history |
| `instructions` | no | System / developer guidance |
| `previous_response_id` | no | Forwarded only on OpenAI-compatible stateful upstreams; **stripped on OpenRouter** (stateless) |

**Rules**

- The window you send must still **fit** the model’s context limit (compact reduces size; it is not a substitute for an already-overflowing request).
- Prefer replaying the **complete** Responses item list, including `reasoning` items with `encrypted_content`.
- Do **not** hand-edit or drop items from the compact response’s `output` before the next turn.

### Response (shape)

Upstream-compatible compacted object (typical):

```json
{
  "id": "…",
  "object": "response.compaction",
  "created_at": 0,
  "output": [
    { "role": "user", "content": "…" },
    {
      "type": "compaction",
      "encrypted_content": "…"
    }
  ],
  "usage": {
    "input_tokens": 0,
    "output_tokens": 0,
    "total_tokens": 0
  }
}
```

- `output` is the **canonical next window**: usually retained user-facing items plus a single opaque **`compaction`** item.
- `usage` is metered like other agent calls (quota applies).

### Next turn after compact

```json
{
  "model": "openai/gpt-6-luna",
  "input": [
    /* ...spread compacted.output exactly... */,
    {
      "role": "user",
      "content": "Continue with the next phase."
    }
  ],
  "store": false
}
```

Flixa defaults for `/responses` already favor retained reasoning (`store: false`, `include: reasoning.encrypted_content`, `reasoning.context: all_turns`) so multi-turn agents can keep encrypted reasoning without server storage.

## Optional: server-side `context_management` (opt-in)

If you still want the **upstream** to compact mid-request when a token threshold is hit, pass it yourself on `/v1/agent/responses`. Flixa does **not** set a default threshold.

```json
{
  "model": "openai/gpt-6-luna",
  "input": [ /* history */ ],
  "context_management": [
    {
      "type": "compaction",
      "compact_threshold": 200000
    }
  ]
}
```

| Notes | |
|-------|--|
| OpenAI-compatible upstreams | Supported when the provider implements Responses compaction |
| OpenRouter | Stateless Responses; behavior depends on provider — prefer **standalone compact** for control |
| Threshold | Choose based on model window (e.g. `200000` is OpenAI’s documented example for long runs) |

For most Flixa clients, **standalone compact** is enough; leave `context_management` unset.

## SDK

```ts
import { FlixaClient } from "./utils/flixa-sdk";

const client = new FlixaClient({
  baseUrl: process.env.FLIXA_API_URL,
  headers: { Authorization: `Bearer ${process.env.FLIXA_API_KEY}` },
});

// 1) Normal turn
const response = (await client.createResponse({
  model: "openai/gpt-6-luna",
  input: history,
})) as { output: unknown[] };

history.push(...response.output);

// 2) When large enough, compact
const compacted = (await client.compactResponse({
  model: "openai/gpt-6-luna",
  input: history,
})) as { output: unknown[] };

// 3) Replace history — do not prune
history = [...compacted.output];
history.push({ role: "user", content: nextUserMessage });
```

`curl` equivalent:

```bash
curl -sS "$FLIXA_API_URL/v1/agent/responses/compact" \
  -H "Authorization: Bearer $FLIXA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-6-luna",
    "input": [ /* full item window */ ]
  }'
```

## When to compact

Good triggers (pick what fits your agent):

- Estimated input tokens approaching a budget (e.g. 150k–400k depending on model)
- After a large tool dump (repo scan, logs, diffs)
- At phase boundaries (plan → implement → review)
- Before a long “final answer” generation if history is already huge

Avoid:

- Compacting every single turn (latency + cost)
- Compacting when the window is already over the model limit (call will fail)

## Retained reasoning (related)

Compaction preserves **state** for the next window; retained reasoning preserves **thinking continuity** across turns:

- Replay `output` items that include `type: "reasoning"` and `encrypted_content`
- Do not strip reasoning when chaining tool calls
- With `store: false` (Flixa default), clients must keep encrypted reasoning themselves

See OpenAI’s [Compaction](https://developers.openai.com/api/docs/guides/compaction) and [Reasoning](https://developers.openai.com/api/docs/guides/reasoning) guides for the upstream model semantics.

## Provider notes

| Provider path | Compact | Notes |
|---------------|---------|--------|
| OpenRouter (`model` contains `/`) | Proxied to `…/responses/compact` | Stateless; no `previous_response_id` / `store: true` |
| OpenAI-compatible (`OPENAI_COMPAT_BASE_URL`) | Proxied to `…/responses/compact` | May support more stateful features upstream |

## Checklist

- [ ] Agent uses `/v1/agent/responses` (or Chat Completions for OpenAI family, which Flixa may route via Responses internally)
- [ ] Full `output` items (including reasoning) are kept client-side
- [ ] Compact is called explicitly when the window grows
- [ ] Compact `output` is used **unchanged** as the next input base
- [ ] Optional `context_management` only if you intentionally want mid-request auto compact

import { Hono } from 'hono';
import type { Context } from 'hono';
import { validateAgentApiKey } from '../../middleware/validateAgentAuth';
import {
  ANTHROPIC_MODEL_DEFINITIONS,
  MODEL_DEFINITIONS,
} from '../../utils/agent/models';

const router = new Hono();

function hasAnthropicHeaders(headers: Headers): boolean {
  for (const [key] of headers.entries()) {
    if (key === 'anthropic-beta' || key.startsWith('anthropic-')) {
      return true;
    }
  }

  return false;
}

async function listModels(c: Context) {
  if (hasAnthropicHeaders(c.req.raw.headers)) {
    const firstModel = ANTHROPIC_MODEL_DEFINITIONS[0];
    const lastModel =
      ANTHROPIC_MODEL_DEFINITIONS[ANTHROPIC_MODEL_DEFINITIONS.length - 1];

    return c.json(
      {
        data: ANTHROPIC_MODEL_DEFINITIONS,
        has_more: false,
        first_id: firstModel?.id ?? null,
        last_id: lastModel?.id ?? null,
      },
      200,
    );
  }

  return c.json(MODEL_DEFINITIONS, 200);
}

router.get('/models', validateAgentApiKey, listModels);

// Codex-compatible providers append /models to the configured base URL.
// Keep the canonical /v1/models endpoint while also supporting a base URL of
// /v1/agent, which resolves the same request to /v1/agent/models.
router.get('/agent/models', validateAgentApiKey, listModels);

export { router as modelsRouter };

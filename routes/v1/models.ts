import { Hono } from 'hono';
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

router.get('/models', validateAgentApiKey, async (c) => {
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
});

export { router as modelsRouter };

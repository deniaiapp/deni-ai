import { Hono } from 'hono';
import { validateAgentApiKey } from '../../middleware/validateAgentAuth';
import { MODEL_DEFINITIONS } from '../../utils/agent/models';

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
    return c.json(
      {
        object: 'list',
        data: MODEL_DEFINITIONS.map((model) => ({
          id: model.id,
          object: 'model',
          created: 0,
          owned_by: model.id.includes('/') ? model.id.split('/')[0] : 'flixa',
          display_name: model.label,
          description: model.description,
          tags: model.tags,
          tier: model.tier,
          premium: model.premium ?? false,
        })),
      },
      200,
    );
  }

  return c.json(MODEL_DEFINITIONS, 200);
});

export { router as modelsRouter };

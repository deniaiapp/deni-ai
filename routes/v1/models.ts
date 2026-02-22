import { Hono } from 'hono';
import { validateAgentApiKey } from '../../middleware/validateAgentAuth';
import { MODEL_DEFINITIONS } from '../../utils/agent/models';

const router = new Hono();

router.get('/models', validateAgentApiKey, async (c) => {
  return c.json(MODEL_DEFINITIONS, 200);
});

export { router as modelsRouter };

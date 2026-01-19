import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { agentRouter } from './routes/v1/agent';
import { errorHandler } from './middleware/errorHandler';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors());

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

// API Routes
app.route('/v1', agentRouter);

// Error handling
app.onError(errorHandler);

// 404 handler
app.notFound((c) => {
  return c.json({
    error: {
      message: `Cannot ${c.req.method} ${c.req.path}`,
      type: 'invalid_request_error',
      param: null,
      code: null
    }
  }, 404);
});

export default app;

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { agentRouter } from "./routes/v1/agent";
import { deniRouter } from "./routes/v1/deni";
import { modelsRouter } from "./routes/v1/models";
import { errorHandler } from "./middleware/errorHandler";
import { logErrorResponses } from "./middleware/logErrorResponses";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", cors());
app.use("*", logErrorResponses);

// Health check
app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

// API Routes
app.route("/v1", agentRouter);
app.route("/v1", deniRouter);
app.route("/v1", modelsRouter);

// Error handling
app.onError(errorHandler);

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: {
        message: `Cannot ${c.req.method} ${c.req.path}`,
        type: "invalid_request_error",
        param: null,
        code: null,
      },
    },
    404,
  );
});

// Parse --port argument
function getPort(): number {
  const args = Bun.argv;
  const portIndex = args.indexOf("--port");
  if (portIndex !== -1 && args[portIndex + 1]) {
    const port = parseInt(args[portIndex + 1], 10);
    if (!isNaN(port)) return port;
  }
  return parseInt(process.env.PORT || "3000", 10);
}

const port = getPort();

export default {
  port,
  // Bun's default 10s idle timeout kills SSE connections when an upstream model
  // goes quiet (e.g. extended-thinking pauses) longer than that between chunks.
  // Client disconnects are already handled via ReadableStream.cancel() in agent.ts.
  fetch(req: Request, server: Bun.Server<undefined>) {
    server.timeout(req, 0);
    return app.fetch(req, { server });
  },
};

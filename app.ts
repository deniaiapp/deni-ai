import { Hono } from "hono";
import { cors } from "hono/cors";
import { agentRouter } from "./routes/v1/agent";
import { deniRouter } from "./routes/v1/deni";
import { modelsRouter } from "./routes/v1/models";
import { adminLookupRouter } from "./routes/admin/lookup";
import { adminRulesRouter } from "./routes/admin/rules";
import { adminAuthRouter } from "./routes/admin/auth";
import { adminAuth } from "./middleware/adminAuth";
import { accessLog } from "./middleware/accessLog";
import { errorHandler } from "./middleware/errorHandler";
import { logErrorResponses } from "./middleware/logErrorResponses";
import {
  adminLoginRateLimitMiddleware,
  ipRateLimitMiddleware,
} from "./middleware/rateLimit";
import { warnAdminConfigAtStartup } from "./utils/adminSecurity";

warnAdminConfigAtStartup();

const app = new Hono();

/**
 * Access logs are useful during development, but can be noisy on busy
 * production instances. Keep the existing default and allow operators to
 * disable only the request logger with ACCESS_LOG_ENABLED=false.
 */
function isAccessLogEnabled(): boolean {
  const raw = process.env.ACCESS_LOG_ENABLED?.trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "no" || raw === "off");
}

// Middleware
if (isAccessLogEnabled()) {
  app.use("*", accessLog);
}
app.use("*", cors());
app.use("*", logErrorResponses);

// Health check
app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

// Admin (cookie session via /admin/login; optional Basic for scripts)
// Login/logout are public; everything else under /admin/* requires auth.
app.use("/admin/login", adminLoginRateLimitMiddleware());
app.use("/admin/*", adminAuth);
app.route("/admin", adminAuthRouter);
app.route("/admin", adminLookupRouter);
app.route("/admin", adminRulesRouter);

// API Routes — IP rate limit before handlers (pre-auth abuse shield).
// Per-user limits run after API key validation in validateAgentAuth.
app.use("/v1/*", ipRateLimitMiddleware());
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

export default app;

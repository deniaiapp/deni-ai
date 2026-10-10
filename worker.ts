import type { DurableObjectNamespace, ExecutionContext, Hyperdrive } from "@cloudflare/workers-types";
import app from "./app";
import { configureDurableRateLimit } from "./utils/rateLimit";
import { runWithRequestRuntime } from "./utils/runtime";

export { RateLimiterDO } from "./utils/rateLimitDurableObject";

type Env = {
  DENI_DB?: Hyperdrive;
  RATE_LIMITER?: DurableObjectNamespace;
  [key: string]: unknown;
};

let configured = false;

/**
 * nodejs_compat populates process.env from string vars/secrets, but not from
 * bindings. Bridge the Hyperdrive binding into the env the DB layer reads.
 */
function configureFromBindings(env: Env): void {
  if (configured) return;
  configured = true;
  if (env.DENI_DB) {
    process.env.DENI_DATABASE_URL = env.DENI_DB.connectionString;
    process.env.DENI_DATABASE_SSL_DISABLED = "true";
  }
  // In-memory buckets are per isolate on Workers; share them via a Durable Object.
  configureDurableRateLimit(env.RATE_LIMITER ?? null);
}

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    configureFromBindings(env);
    return runWithRequestRuntime({ waitUntil: (p) => ctx.waitUntil(p) }, () =>
      app.fetch(req, { ...env, runtime: "workers" }, ctx),
    );
  },
};

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { Hono } from "hono";
import { adminAuth } from "../middleware/adminAuth";
import { adminLoginRateLimitMiddleware } from "../middleware/rateLimit";
import { clearRateLimitBuckets } from "../utils/rateLimit";

const env = {
  FLIXA_AUTH_DISABLED: "false",
  RATE_LIMIT_ENABLED: "true",
  ADMIN_USER: "admin",
  ADMIN_PASSWORD: "test-password-not-a-secret",
  ADMIN_ALLOW_BASIC: "true",
  ADMIN_IP_ALLOWLIST: "",
  RATE_LIMIT_ADMIN_LOGIN_MAX: "2",
  TRUSTED_PROXY_IPS: "",
};
const original = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
beforeEach(() => {
  Object.assign(process.env, env);
  clearRateLimitBuckets();
});
afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  clearRateLimitBuckets();
});

function app() {
  const hono = new Hono();
  hono.use("/admin/login", adminLoginRateLimitMiddleware());
  hono.use("/admin/*", adminAuth);
  hono.post("/admin/login", (c) => c.json({ login: true }));
  hono.get("/admin/lookup", (c) => c.json({ protected: true }));
  hono.get("/admin/rules", (c) => c.json({ protected: true }));
  return hono;
}

function request(hono: Hono, path: string, options: RequestInit = {}, ip = "203.0.113.5") {
  return hono.fetch(new Request(`http://localhost${path}`, options), {
    server: { requestIP: () => ({ address: ip }) },
  });
}

test("Basic auth shares the form login limit across admin routes", async () => {
  const hono = app();
  const headers = { Authorization: `Basic ${btoa("admin:wrong")}`, Accept: "application/json" };
  assert.equal((await request(hono, "/admin/lookup", { headers })).status, 401);
  assert.equal((await request(hono, "/admin/rules", { headers })).status, 401);
  const blocked = await request(hono, "/admin/lookup", { headers });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  assert.equal((await request(hono, "/admin/login", { method: "POST" })).status, 429);
  assert.equal(
    (await request(hono, "/admin/login", { method: "POST" }, "203.0.113.6")).status,
    200,
  );
});

test("forged IP headers cannot reset the login bucket or bypass allowlist", async () => {
  const hono = app();
  for (let i = 0; i < 3; i++) {
    const result = await request(hono, "/admin/login", {
      method: "POST",
      headers: { "cf-connecting-ip": `192.0.2.${i}` },
    });
    assert.equal(result.status, i < 2 ? 200 : 429);
  }
  process.env.ADMIN_IP_ALLOWLIST = "192.0.2.1";
  assert.equal(
    (await request(hono, "/admin/lookup", { headers: { "x-forwarded-for": "192.0.2.1" } })).status,
    403,
  );
});

test("valid sessions still work after the credential attempt limit is reached", async () => {
  process.env.RATE_LIMIT_ADMIN_LOGIN_MAX = "1";
  const hono = app();
  const response = await request(hono, "/admin/lookup", {
    headers: { Authorization: `Basic ${btoa(`admin:${env.ADMIN_PASSWORD}`)}` },
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  assert.equal((await request(hono, "/admin/login", { method: "POST" })).status, 429);
  assert.equal((await request(hono, "/admin/lookup", { headers: { Cookie: cookie } })).status, 200);
});

import { afterEach, beforeEach, expect, test } from "bun:test";
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
const original = Object.fromEntries(Object.keys(env).map((key) => [key, Bun.env[key]]));
beforeEach(() => {
  Object.assign(Bun.env, env);
  clearRateLimitBuckets();
});
afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete Bun.env[key];
    else Bun.env[key] = value;
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
  expect((await request(hono, "/admin/lookup", { headers })).status).toBe(401);
  expect((await request(hono, "/admin/rules", { headers })).status).toBe(401);
  const blocked = await request(hono, "/admin/lookup", { headers });
  expect(blocked.status).toBe(429);
  expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  expect((await request(hono, "/admin/login", { method: "POST" })).status).toBe(429);
  expect((await request(hono, "/admin/login", { method: "POST" }, "203.0.113.6")).status).toBe(200);
});

test("forged IP headers cannot reset the login bucket or bypass allowlist", async () => {
  const hono = app();
  for (let i = 0; i < 3; i++) {
    const result = await request(hono, "/admin/login", {
      method: "POST",
      headers: { "cf-connecting-ip": `192.0.2.${i}` },
    });
    expect(result.status).toBe(i < 2 ? 200 : 429);
  }
  Bun.env.ADMIN_IP_ALLOWLIST = "192.0.2.1";
  expect(
    (await request(hono, "/admin/lookup", { headers: { "x-forwarded-for": "192.0.2.1" } })).status,
  ).toBe(403);
});

test("valid sessions still work after the credential attempt limit is reached", async () => {
  Bun.env.RATE_LIMIT_ADMIN_LOGIN_MAX = "1";
  const hono = app();
  const response = await request(hono, "/admin/lookup", {
    headers: { Authorization: `Basic ${btoa(`admin:${env.ADMIN_PASSWORD}`)}` },
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  expect((await request(hono, "/admin/login", { method: "POST" })).status).toBe(429);
  expect((await request(hono, "/admin/lookup", { headers: { Cookie: cookie } })).status).toBe(200);
});

import { describe, expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import { adminAuth } from "../middleware/adminAuth";
import {
  assessAdminPassword,
  isAdminIpAllowed,
  logAdminAudit,
  verifyAdminCredentialsSecure,
} from "../utils/adminSecurity";

describe("isAdminIpAllowed", () => {
  test("allows all when allowlist empty", () => {
    delete Bun.env.ADMIN_IP_ALLOWLIST;
    expect(isAdminIpAllowed("1.2.3.4")).toBe(true);
    expect(isAdminIpAllowed("unknown")).toBe(true);
  });

  test("matches exact IP and CIDR", () => {
    Bun.env.ADMIN_IP_ALLOWLIST = "203.0.113.10,10.0.0.0/8";
    expect(isAdminIpAllowed("203.0.113.10")).toBe(true);
    expect(isAdminIpAllowed("10.1.2.3")).toBe(true);
    expect(isAdminIpAllowed("11.0.0.1")).toBe(false);
    expect(isAdminIpAllowed("unknown")).toBe(false);
    delete Bun.env.ADMIN_IP_ALLOWLIST;
  });

  test("handles IPv4-mapped IPv6", () => {
    Bun.env.ADMIN_IP_ALLOWLIST = "203.0.113.10";
    expect(isAdminIpAllowed("::ffff:203.0.113.10")).toBe(true);
    delete Bun.env.ADMIN_IP_ALLOWLIST;
  });
});

describe("assessAdminPassword", () => {
  test("flags short and common passwords", () => {
    expect(assessAdminPassword(undefined).ok).toBe(false);
    expect(assessAdminPassword("short").warnings.length).toBeGreaterThan(0);
    expect(assessAdminPassword("password").warnings.some((w) => w.includes("weak"))).toBe(
      true,
    );
    expect(
      assessAdminPassword("xK9$mQ2pL7vN4wR8tY1z").ok ||
        assessAdminPassword("xK9$mQ2pL7vN4wR8tY1z").warnings.length === 0,
    ).toBe(true);
  });
});

describe("verifyAdminCredentialsSecure", () => {
  test("accepts matching credentials and rejects mismatches", async () => {
    expect(
      await verifyAdminCredentialsSecure("admin", "s3cret-long", "admin", "s3cret-long"),
    ).toBe(true);
    expect(
      await verifyAdminCredentialsSecure("admin", "wrong", "admin", "s3cret-long"),
    ).toBe(false);
    expect(
      await verifyAdminCredentialsSecure("nope", "s3cret-long", "admin", "s3cret-long"),
    ).toBe(false);
    // Different lengths still return false without throwing
    expect(
      await verifyAdminCredentialsSecure("a", "b", "admin", "s3cret-long"),
    ).toBe(false);
  });
});

async function captureAudit(fn: () => unknown): Promise<string[]> {
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  const warnSpy = spyOn(console, "warn").mockImplementation(record);
  const infoSpy = spyOn(console, "info").mockImplementation(record);
  try {
    await fn();
  } finally {
    warnSpy.mockRestore();
    infoSpy.mockRestore();
  }
  return lines;
}

describe("logAdminAudit", () => {
  test("keeps ordinary audit lines unchanged", async () => {
    const lines = await captureAudit(() =>
      logAdminAudit("login_failed", {
        ip: "203.0.113.5",
        path: "/admin/login",
        username: "admin",
        reason: "form",
      }),
    );
    expect(lines).toEqual([
      "[AdminAuth] login_failed ip=203.0.113.5 path=/admin/login user=admin reason=form",
    ]);
  });

  test("escapes CR/LF in path and username", async () => {
    const lines = await captureAudit(() =>
      logAdminAudit("login_failed", {
        ip: "203.0.113.5",
        path: "/admin/x\r\n[AdminAuth] login_ok ip=1.2.3.4",
        username: "evil\n[AdminAuth] login_ok ip=1.2.3.4 user=admin",
        reason: "basic",
      }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/[\r\n]/);
    expect(lines[0]).toBe(
      "[AdminAuth] login_failed ip=203.0.113.5 path=/admin/x\\x0d\\x0a[AdminAuth] login_ok ip=1.2.3.4 " +
        "user=evil\\x0a[AdminAuth] login_ok ip=1.2.3.4 user=admin reason=basic",
    );
  });

  test("escapes other control and Unicode line-break characters", async () => {
    const lines = await captureAudit(() =>
      logAdminAudit("unauthorized", {
        path: "/admin/a\u0000b\u001bc\u007fd\u0085e\u2028f\u2029g",
      }),
    );
    expect(lines).toEqual([
      "[AdminAuth] unauthorized path=/admin/a\\x00b\\x1bc\\x7fd\\x85e\\u2028f\\u2029g",
    ]);
  });

  test("escapes array usernames from JSON bodies", async () => {
    const username = ["evil\n[AdminAuth] login_ok user=admin", "x"] as unknown as string;
    const lines = await captureAudit(() =>
      logAdminAudit("login_failed", { username, reason: "form" }),
    );
    expect(lines).toEqual([
      "[AdminAuth] login_failed user=evil\\x0a[AdminAuth] login_ok user=admin,x reason=form",
    ]);
  });

  test("caps logged path length", async () => {
    const path = `/admin/${"a".repeat(2000)}`;
    const lines = await captureAudit(() => logAdminAudit("unauthorized", { path }));
    expect(lines).toEqual([`[AdminAuth] unauthorized path=${path.slice(0, 512)}`]);
  });

  test("Basic auth failure cannot inject lines via username or decoded path", async () => {
    const env = {
      FLIXA_AUTH_DISABLED: "false",
      RATE_LIMIT_ENABLED: "false",
      ADMIN_USER: "admin",
      ADMIN_PASSWORD: "test-password-not-a-secret",
      ADMIN_ALLOW_BASIC: "true",
      ADMIN_IP_ALLOWLIST: "",
      TRUSTED_PROXY_IPS: "",
    };
    const original = Object.fromEntries(Object.keys(env).map((key) => [key, Bun.env[key]]));
    Object.assign(Bun.env, env);
    try {
      const hono = new Hono();
      hono.use("/admin/*", adminAuth);
      hono.get("/admin/*", (c) => c.json({ protected: true }));
      let status = 0;
      const lines = await captureAudit(async () => {
        const response = await hono.fetch(
          new Request("http://localhost/admin/x%1By%C2%85z", {
            headers: {
              Authorization: `Basic ${btoa("evil\n[AdminAuth] basic_ok ip=1.2.3.4:wrong")}`,
              Accept: "application/json",
            },
          }),
          { server: { requestIP: () => ({ address: "203.0.113.5" }) } },
        );
        status = response.status;
      });
      expect(status).toBe(401);
      expect(lines).toEqual([
        "[AdminAuth] login_failed ip=203.0.113.5 path=/admin/x\\x1by\\x85z " +
          "user=evil\\x0a[AdminAuth] basic_ok ip=1.2.3.4 reason=basic",
        "[AdminAuth] unauthorized ip=203.0.113.5 path=/admin/x\\x1by\\x85z",
      ]);
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete Bun.env[key];
        else Bun.env[key] = value;
      }
    }
  });
});

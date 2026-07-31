import { describe, expect, test } from "bun:test";
import {
  assessAdminPassword,
  isAdminIpAllowed,
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

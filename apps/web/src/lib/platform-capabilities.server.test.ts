import { beforeEach, expect, test, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({ BETA_ACCESS_REQUIRED: false }));
vi.mock("@/env", () => ({ env: mockEnv }));
vi.mock("@/lib/email", () => ({ isEmailConfigured: () => false }));

const { getPlatformCapabilities } = await import("@/lib/platform-capabilities.server");

beforeEach(() => {
  mockEnv.BETA_ACCESS_REQUIRED = false;
});

test("the private beta gate shows the beta UI and refuses guests", () => {
  mockEnv.BETA_ACCESS_REQUIRED = true;
  const capabilities = getPlatformCapabilities();
  expect(capabilities.privateBeta).toBe(true);
  expect(capabilities.auth.guests).toBe(false);
});

test("without the gate (after takeover) the beta UI is hidden and guests are allowed", () => {
  const capabilities = getPlatformCapabilities();
  expect(capabilities.privateBeta).toBe(false);
  expect(capabilities.auth.guests).toBe(true);
});

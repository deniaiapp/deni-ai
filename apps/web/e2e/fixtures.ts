import { randomInt } from "node:crypto";
import { test as base } from "@playwright/test";
import { CLIENT_IP_HEADER } from "./env";

export { expect } from "@playwright/test";

/**
 * Every test talks to the app from its own client address. The e2e server
 * trusts `CLIENT_IP_HEADER` (e2e/env.ts), so Better Auth's sign-in rate limit
 * (3 per 10 seconds) and the per-network sign-up caps (src/lib/signup-risk.ts)
 * apply per test instead of to one bucket shared by parallel tests, as they do
 * per visitor in production.
 */
export const test = base.extend({
  // Playwright reads a fixture's dependencies from this (empty) pattern.
  // oxlint-disable-next-line no-empty-pattern
  extraHTTPHeaders: async ({}, use) => {
    const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
    await use({ [CLIENT_IP_HEADER]: ip });
  },
});

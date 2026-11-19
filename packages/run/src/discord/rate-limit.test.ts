import { beforeEach, describe, expect, it } from "vitest";
import { assertRateLimit, RateLimitError, resetRateLimitsForTests } from "./rate-limit";

beforeEach(() => resetRateLimitsForTests());

describe("assertRateLimit", () => {
  it("allows `limit` requests per window and refuses the next", async () => {
    const now = 1_000_000;
    for (let index = 0; index < 3; index++)
      await expect(assertRateLimit("u1", "chat", 3, 60_000, now)).resolves.toBeUndefined();
    await expect(assertRateLimit("u1", "chat", 3, 60_000, now + 1)).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it("starts a new window once the old one has passed", async () => {
    await assertRateLimit("u1", "chat", 1, 60_000, 0);
    await expect(assertRateLimit("u1", "chat", 1, 60_000, 30_000)).rejects.toBeInstanceOf(
      RateLimitError,
    );
    await expect(assertRateLimit("u1", "chat", 1, 60_000, 60_000)).resolves.toBeUndefined();
  });

  it("counts users and buckets separately", async () => {
    await assertRateLimit("u1", "chat", 1, 60_000, 0);
    await expect(assertRateLimit("u2", "chat", 1, 60_000, 0)).resolves.toBeUndefined();
    await expect(assertRateLimit("u1", "upload", 1, 60_000, 0)).resolves.toBeUndefined();
  });
});

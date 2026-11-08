import { expect, test } from "vitest";
import {
  API_KEY_DISPLAY_PREFIX_LENGTH,
  API_KEY_PREFIX,
  generateApiKey,
  getKeyPrefix,
  hashApiKey,
} from "./api-key";
import { hashApiKeySync } from "./api-key-node";

test("generates deni_ keys with 40 hex characters", () => {
  const key = generateApiKey();
  expect(key).toMatch(/^deni_[0-9a-f]{40}$/);
  expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
  expect(generateApiKey()).not.toBe(key);
});

test("hashes keys to the SHA-256 hex digest", async () => {
  // printf deni_test | sha256sum
  const digest = "4d7b2b6471ad0959e15b57fbcb94d0be14c9fb64ec543a043a06afbd0b6a10c8";
  expect(await hashApiKey("deni_test")).toBe(digest);
  expect(hashApiKeySync("deni_test")).toBe(digest);
});

test("the WebCrypto and node:crypto digests match for generated keys", async () => {
  for (let i = 0; i < 5; i++) {
    const key = generateApiKey();
    expect(await hashApiKey(key)).toBe(hashApiKeySync(key));
  }
});

test("keeps the first 13 characters as the display prefix", () => {
  const key = "deni_0123456789abcdef0123456789abcdef01234567";
  expect(getKeyPrefix(key)).toBe("deni_01234567");
  expect(getKeyPrefix(key)).toHaveLength(API_KEY_DISPLAY_PREFIX_LENGTH);
});

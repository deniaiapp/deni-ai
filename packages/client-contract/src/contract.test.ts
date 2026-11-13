import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  chatListQuerySchema,
  clientApiJsonSchema,
  compareVersions,
  createChatBodySchema,
  formatClientHeader,
  parseClientHeader,
  updateChatBodySchema,
} from "./index.js";

describe("client header", () => {
  it("parses and formats desktop/<version> (<os>; <arch>)", () => {
    const identity = parseClientHeader("desktop/1.0.0-beta.2 (windows; x86_64)");
    expect(identity).toEqual({
      product: "desktop",
      version: "1.0.0-beta.2",
      os: "windows",
      arch: "x86_64",
    });
    expect(formatClientHeader(identity!)).toBe("desktop/1.0.0-beta.2 (windows; x86_64)");
    expect(parseClientHeader("desktop/1.2.3")).toMatchObject({ os: null, arch: null });
  });

  it("rejects unknown products and malformed versions", () => {
    expect(parseClientHeader("cli/1.0.0")).toBeNull();
    expect(parseClientHeader("desktop/1.0")).toBeNull();
    expect(parseClientHeader("")).toBeNull();
    expect(parseClientHeader(null)).toBeNull();
  });
});

describe("compareVersions", () => {
  it.each([
    ["1.0.0", "1.0.0", 0],
    ["1.0.1", "1.0.0", 1],
    ["0.9.9", "1.0.0", -1],
    ["1.0.0-beta.1", "1.0.0", -1],
    ["1.0.0-beta.2", "1.0.0-beta.10", -1],
    ["1.0.0-beta", "1.0.0-alpha", 1],
  ])("%s vs %s", (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign);
  });
});

describe("request bodies", () => {
  it("requires a UUID chat id", () => {
    expect(createChatBodySchema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
    expect(
      createChatBodySchema.safeParse({ id: "8f14e45f-ceea-467f-a0e6-7c3a8c1f2b11" }).success,
    ).toBe(true);
  });

  it("refuses an empty update", () => {
    expect(updateChatBodySchema.safeParse({}).success).toBe(false);
    expect(updateChatBodySchema.safeParse({ pinned: true }).success).toBe(true);
  });

  it("defaults and caps the chat page size", () => {
    expect(chatListQuerySchema.parse({}).limit).toBe(50);
    expect(chatListQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
  });
});

describe("JSON Schema", () => {
  it("is committed in schema/client-api-v1.json", () => {
    const file = fileURLToPath(new URL("../schema/client-api-v1.json", import.meta.url));
    const committed = JSON.parse(readFileSync(file, "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(clientApiJsonSchema())));
  });
});

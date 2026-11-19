import { describe, expect, it } from "vitest";
import { getAppMode } from "./app-mode";

describe("getAppMode", () => {
  it("treats /run and its children as Run mode", () => {
    expect(getAppMode("/run")).toBe("run");
    expect(getAppMode("/run/threads/abc")).toBe("run");
  });

  it("keeps every other path in chat mode", () => {
    expect(getAppMode("/chat")).toBe("chat");
    expect(getAppMode("/runner")).toBe("chat");
    expect(getAppMode("/settings/billing")).toBe("chat");
    expect(getAppMode(null)).toBe("chat");
  });
});

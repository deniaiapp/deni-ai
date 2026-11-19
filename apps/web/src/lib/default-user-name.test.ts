import { expect, test } from "vitest";
import { defaultUserName, resolveUserName } from "./default-user-name";

test("defaults to the email's local part", () => {
  expect(defaultUserName("taro.yamada@example.com")).toBe("taro.yamada");
  // The domain starts after the last @; quoted local parts may contain one.
  expect(defaultUserName('"a@b"@example.com')).toBe('"a@b"');
});

test("falls back to the whole address when the local part is empty", () => {
  expect(defaultUserName("@example.com")).toBe("@example.com");
  expect(defaultUserName("no-at-sign")).toBe("no-at-sign");
});

test("keeps a name with visible characters and replaces a blank one", () => {
  expect(resolveUserName("Taro", "taro@example.com")).toBe("Taro");
  expect(resolveUserName("", "taro@example.com")).toBe("taro");
  expect(resolveUserName("   ", "taro@example.com")).toBe("taro");
  expect(resolveUserName(undefined, "taro@example.com")).toBe("taro");
  expect(resolveUserName(null, "taro@example.com")).toBe("taro");
});

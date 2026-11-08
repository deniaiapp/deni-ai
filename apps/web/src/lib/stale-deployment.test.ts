import { describe, expect, it } from "vitest";
import { isStaleDeploymentError } from "./stale-deployment";

describe("isStaleDeploymentError", () => {
  it.each([
    "Failed to fetch dynamically imported module: https://deniai.app/assets/chat-abc123.js",
    "error loading dynamically imported module: https://deniai.app/assets/chat-abc123.js",
    "Importing a module script failed.",
    "Unable to preload CSS for /assets/chat-abc123.css",
  ])("matches stale chunk errors: %s", (message) => {
    expect(isStaleDeploymentError(new TypeError(message))).toBe(true);
  });

  it("ignores unrelated errors and non-errors", () => {
    expect(isStaleDeploymentError(new TypeError("Cannot read properties of undefined"))).toBe(
      false,
    );
    expect(isStaleDeploymentError("Importing a module script failed.")).toBe(false);
  });
});

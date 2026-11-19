import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installStaleDeploymentReload,
  isStaleDeploymentError,
  isStaleDeploymentReloadStarted,
} from "./stale-deployment";

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

describe("installStaleDeploymentReload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setup() {
    const reload = vi.fn();
    const target = Object.assign(new EventTarget(), { location: { reload } });
    const storage = new Map<string, string>();
    vi.stubGlobal("window", target);
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    installStaleDeploymentReload();
    const fire = () => {
      const event = new Event("vite:preloadError", { cancelable: true });
      target.dispatchEvent(event);
      return event;
    };
    return { reload, fire };
  }

  it("reloads once on a failed chunk preload and keeps the error from being thrown", () => {
    const { reload, fire } = setup();
    expect(isStaleDeploymentReloadStarted()).toBe(false);
    expect(fire().defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    // dynamic() reads this to wait for the reload instead of crashing on the empty import.
    expect(isStaleDeploymentReloadStarted()).toBe(true);
    // A second failure right after the reload is a real error: let it through.
    expect(fire().defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

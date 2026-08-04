import { afterEach, describe, expect, test } from "bun:test";
import { createUpstreamTimeout } from "../utils/agent/upstream";

const originalTimeout = Bun.env.FLIXA_UPSTREAM_TIMEOUT_MS;

afterEach(() => {
  if (originalTimeout === undefined) {
    delete Bun.env.FLIXA_UPSTREAM_TIMEOUT_MS;
  } else {
    Bun.env.FLIXA_UPSTREAM_TIMEOUT_MS = originalTimeout;
  }
});

describe("createUpstreamTimeout", () => {
  test("aborts after the configured idle timeout", async () => {
    Bun.env.FLIXA_UPSTREAM_TIMEOUT_MS = "20";
    const timeout = createUpstreamTimeout();

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(timeout.signal.aborted).toBe(true);
    timeout.dispose();
  });

  test("refresh postpones an otherwise pending timeout", async () => {
    Bun.env.FLIXA_UPSTREAM_TIMEOUT_MS = "50";
    const timeout = createUpstreamTimeout();

    await new Promise((resolve) => setTimeout(resolve, 15));
    timeout.refresh();
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(timeout.signal.aborted).toBe(false);

    timeout.dispose();
  });

  test("abort cancels the active request without waiting for the timer", () => {
    Bun.env.FLIXA_UPSTREAM_TIMEOUT_MS = "1000";
    const timeout = createUpstreamTimeout();

    timeout.abort();

    expect(timeout.signal.aborted).toBe(true);
    timeout.dispose();
  });
});

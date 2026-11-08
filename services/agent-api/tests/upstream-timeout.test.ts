import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { createUpstreamTimeout } from "../utils/agent/upstream";

const originalTimeout = process.env.FLIXA_UPSTREAM_TIMEOUT_MS;

afterEach(() => {
  if (originalTimeout === undefined) {
    delete process.env.FLIXA_UPSTREAM_TIMEOUT_MS;
  } else {
    process.env.FLIXA_UPSTREAM_TIMEOUT_MS = originalTimeout;
  }
});

describe("createUpstreamTimeout", () => {
  test("aborts after the configured idle timeout", async () => {
    process.env.FLIXA_UPSTREAM_TIMEOUT_MS = "20";
    const timeout = createUpstreamTimeout();

    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(timeout.signal.aborted, true);
    timeout.dispose();
  });

  test("refresh postpones an otherwise pending timeout", async () => {
    process.env.FLIXA_UPSTREAM_TIMEOUT_MS = "50";
    const timeout = createUpstreamTimeout();

    await new Promise((resolve) => setTimeout(resolve, 15));
    timeout.refresh();
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(timeout.signal.aborted, false);

    timeout.dispose();
  });

  test("abort cancels the active request without waiting for the timer", () => {
    process.env.FLIXA_UPSTREAM_TIMEOUT_MS = "1000";
    const timeout = createUpstreamTimeout();

    timeout.abort();

    assert.equal(timeout.signal.aborted, true);
    timeout.dispose();
  });
});

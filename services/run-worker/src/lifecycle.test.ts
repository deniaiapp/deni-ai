import { describe, expect, it, vi } from "vitest";
import { createWorker } from "./lifecycle";

const quiet = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("createWorker", () => {
  it("stops claiming and waits for jobs, then disconnects Discord, then closes the pool", async () => {
    const order: string[] = [];
    let finishJobs!: () => void;
    const worker = createWorker({
      startScheduler: () => () =>
        new Promise<void>((resolve) => {
          order.push("scheduler stopping");
          finishJobs = () => {
            order.push("jobs finished");
            resolve();
          };
        }),
      startDiscord: () => ({
        stop: async () => {
          order.push("discord");
        },
      }),
      close: async () => {
        order.push("pool");
      },
      logger: quiet,
      shutdownTimeoutMs: 5_000,
    });
    worker.start();
    const stopped = worker.stop();
    await Promise.resolve();
    expect(order).toEqual(["scheduler stopping"]);
    finishJobs();
    await stopped;
    expect(order).toEqual(["scheduler stopping", "jobs finished", "discord", "pool"]);
    // A second signal reuses the same shutdown.
    await worker.stop();
    expect(order).toHaveLength(4);
  });

  it("gives up waiting for jobs after the timeout and still closes everything", async () => {
    const close = vi.fn(async () => undefined);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const worker = createWorker({
      startScheduler: () => () => new Promise<void>(() => undefined),
      close,
      logger,
      shutdownTimeoutMs: 10,
    });
    worker.start();
    await worker.stop();
    expect(close).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("starts nothing that is turned off", async () => {
    const close = vi.fn(async () => undefined);
    const worker = createWorker({ close, logger: quiet, shutdownTimeoutMs: 10 });
    worker.start();
    await worker.stop();
    expect(close).toHaveBeenCalledOnce();
  });
});

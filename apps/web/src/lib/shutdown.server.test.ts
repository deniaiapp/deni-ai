import { expect, test, vi } from "vitest";
import { onShutdown, runShutdownHandlers } from "@/lib/shutdown.server";

test("handlers run once, in registration order, past a failing one", async () => {
  const order: string[] = [];
  onShutdown("first", async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    order.push("first");
  });
  onShutdown("broken", () => {
    throw new Error("boom");
  });
  onShutdown("last", () => {
    order.push("last");
  });
  const logger = { error: vi.fn() };

  await runShutdownHandlers(logger);
  expect(order).toEqual(["first", "last"]);
  expect(logger.error).toHaveBeenCalledWith("[shutdown] broken", expect.any(Error));

  await runShutdownHandlers(logger);
  expect(order).toEqual(["first", "last"]);
});

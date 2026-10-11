import { expect, test, vi } from "vitest";
import { saveComparisonSession } from "./comparison-session-save";

const notFound = Object.assign(new Error("Comparison not found."), { data: { code: "NOT_FOUND" } });

test("a saved comparison is saved over its id", async () => {
  const save = vi.fn(async (id: string | undefined) => id ?? "new");
  await expect(saveComparisonSession(save, "saved")).resolves.toEqual({
    id: "saved",
    recreated: false,
  });
  expect(save).toHaveBeenCalledExactlyOnceWith("saved");
});

test("a comparison deleted in another tab is saved as a new one instead of failing every retry", async () => {
  const save = vi.fn(async (id: string | undefined) => {
    if (id) throw notFound;
    return "new";
  });
  await expect(saveComparisonSession(save, "deleted")).resolves.toEqual({
    id: "new",
    recreated: true,
  });
  expect(save.mock.calls).toEqual([["deleted"], [undefined]]);
});

test("other failures are not retried as a new comparison", async () => {
  const tooLarge = Object.assign(new Error("Payload too large"), {
    data: { code: "PAYLOAD_TOO_LARGE" },
  });
  const save = vi.fn(async () => {
    throw tooLarge;
  });
  await expect(saveComparisonSession(save, "saved")).rejects.toBe(tooLarge);
  expect(save).toHaveBeenCalledOnce();

  // A first save has no id to lose, so its NOT_FOUND is a real failure.
  save.mockRejectedValueOnce(notFound);
  await expect(saveComparisonSession(save, undefined)).rejects.toBe(notFound);
  expect(save).toHaveBeenCalledTimes(2);
});

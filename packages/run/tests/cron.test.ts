import { it } from "vitest";
import { nextCron } from "../src/jobs/cron";

it("cron behaves as in Deni Run", async () => {
  function assert(condition: boolean, message: string) {
    if (!condition) throw new Error(message);
  }

  const tokyoMonthly = nextCron("0 0 1 * *", "Asia/Tokyo", new Date("2026-01-31T14:00:00.000Z"));
  assert(tokyoMonthly === "2026-01-31T15:00:00.000Z", `unexpected Tokyo result: ${tokyoMonthly}`);

  const leapDay = nextCron("0 9 29 2 *", "UTC", new Date("2025-03-01T00:00:00.000Z"));
  assert(leapDay === "2028-02-29T09:00:00.000Z", `unexpected leap-day result: ${leapDay}`);

  let rejected = false;
  try {
    nextCron("not cron", "UTC");
  } catch {
    rejected = true;
  }
  assert(rejected, "invalid cron was accepted");
});

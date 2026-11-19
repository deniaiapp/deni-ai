import { describe, expect, test } from "vitest";

import { addUtcMonths, usagePeriodAt, usagePeriodStart } from "./usage-period";

const at = (iso: string) => new Date(iso);

describe("usage period", () => {
  test("without a paid plan it is the UTC calendar month", () => {
    expect(usagePeriodAt(null, at("2026-11-19T10:00:00Z"))).toEqual({
      start: at("2026-11-01T00:00:00Z"),
      end: at("2026-12-01T00:00:00Z"),
    });
  });

  test("a monthly plan's period ends with its billing period", () => {
    const cycleEnd = at("2026-12-05T08:30:00Z");
    expect(usagePeriodAt(cycleEnd, at("2026-11-19T10:00:00Z"))).toEqual({
      start: at("2026-11-05T08:30:00Z"),
      end: cycleEnd,
    });
    // The calendar month turning over does not start a new period.
    expect(usagePeriodAt(cycleEnd, at("2026-12-01T00:00:00Z")).end).toEqual(cycleEnd);
  });

  test("a yearly plan gets a period per month of its billing year", () => {
    const cycleEnd = at("2027-06-15T00:00:00Z");
    expect(usagePeriodAt(cycleEnd, at("2026-11-19T10:00:00Z"))).toEqual({
      start: at("2026-11-15T00:00:00Z"),
      end: at("2026-12-15T00:00:00Z"),
    });
    expect(usagePeriodAt(cycleEnd, at("2026-12-15T00:00:00Z")).end).toEqual(
      at("2027-01-15T00:00:00Z"),
    );
  });

  test("a renewal not recorded yet still rolls the period over", () => {
    const staleCycleEnd = at("2026-11-05T08:30:00Z");
    expect(usagePeriodAt(staleCycleEnd, at("2026-11-05T08:30:00Z"))).toEqual({
      start: staleCycleEnd,
      end: at("2026-12-05T08:30:00Z"),
    });
    expect(usagePeriodAt(staleCycleEnd, at("2027-01-20T00:00:00Z")).end).toEqual(
      at("2027-02-05T08:30:00Z"),
    );
  });

  test("month steps keep the anchor day and clamp to short months", () => {
    const cycleEnd = at("2027-01-31T12:00:00Z");
    expect(addUtcMonths(cycleEnd, 1)).toEqual(at("2027-02-28T12:00:00Z"));
    // Steps are taken from the anchor, so the day returns after a short month.
    expect(addUtcMonths(cycleEnd, 2)).toEqual(at("2027-03-31T12:00:00Z"));
    expect(usagePeriodAt(cycleEnd, at("2027-03-01T00:00:00Z"))).toEqual({
      start: at("2027-02-28T12:00:00Z"),
      end: at("2027-03-31T12:00:00Z"),
    });
  });

  test("the ledger key of a period is one month before its end", () => {
    expect(usagePeriodStart(at("2026-12-01T00:00:00Z"))).toEqual(at("2026-11-01T00:00:00Z"));
    expect(usagePeriodStart(at("2027-03-31T12:00:00Z"))).toEqual(at("2027-02-28T12:00:00Z"));
  });

  test("every instant falls in exactly one period", () => {
    const cycleEnd = at("2026-08-31T23:59:59Z");
    let previousEnd: Date | null = null;
    for (let day = 0; day < 800; day++) {
      const now = new Date(Date.UTC(2026, 0, 1 + day, 7));
      const period = usagePeriodAt(cycleEnd, now);
      expect(period.end.getTime()).toBeGreaterThan(now.getTime());
      if (previousEnd && previousEnd.getTime() !== period.end.getTime()) {
        // A new period begins where the previous one ended.
        expect(previousEnd.getTime()).toBeLessThanOrEqual(now.getTime());
        expect(usagePeriodAt(cycleEnd, new Date(previousEnd.getTime() - 1)).end).toEqual(
          previousEnd,
        );
        expect(usagePeriodAt(cycleEnd, previousEnd).end).toEqual(period.end);
      }
      previousEnd = period.end;
    }
  });
});

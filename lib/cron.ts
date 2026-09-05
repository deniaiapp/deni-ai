type CronParts = {
  minutes: Set<number>;
  hours: Set<number>;
  dom: Set<number>;
  months: Set<number>;
  dow: Set<number>;
  domAny: boolean;
  dowAny: boolean;
};

export function nextCron(expr: string, timezone: string, from = new Date()): string {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("Invalid cron expression");
  const [minuteExpr, hourExpr, domExpr, monthExpr, dowExpr] = fields;
  const cron: CronParts = {
    minutes: requireCronField(minuteExpr, 0, 59),
    hours: requireCronField(hourExpr, 0, 23),
    dom: requireCronField(domExpr, 1, 31),
    months: requireCronField(monthExpr, 1, 12),
    dow: requireCronField(dowExpr, 0, 7, true),
    domAny: domExpr === "*",
    dowAny: dowExpr === "*",
  };
  const formatter = makeFormatter(timezone);
  const localFrom = partsFor(formatter, from);
  const firstDay = new Date(Date.UTC(localFrom.year, localFrom.month - 1, localFrom.day));
  const hasAllTimes = cron.minutes.size === 60 && cron.hours.size === 24;
  const hasAllCalendar = cron.domAny && cron.dowAny && cron.months.size === 12;
  if (hasAllTimes && hasAllCalendar) {
    return new Date(Math.floor(from.getTime() / 60_000) * 60_000 + 60_000).toISOString();
  }
  const sortedHours = [...cron.hours].sort((a, b) => a - b);
  const sortedMinutes = [...cron.minutes].sort((a, b) => a - b);
  // Iterate matching local calendar slots, rather than formatting every UTC minute. This
  // keeps monthly/leap-day schedules fast while preserving named-timezone DST behavior.
  for (let dayOffset = 0; dayOffset < 366 * 5; dayOffset++) {
    const day = new Date(firstDay.getTime() + dayOffset * 86_400_000);
    const month = day.getUTCMonth() + 1;
    const dayOfMonth = day.getUTCDate();
    const dayOfWeek = day.getUTCDay();
    if (!cron.months.has(month)) continue;
    const domMatches = cron.dom.has(dayOfMonth);
    const dowMatches = cron.dow.has(dayOfWeek);
    const calendarMatches =
      cron.domAny && cron.dowAny
        ? true
        : cron.domAny
          ? dowMatches
          : cron.dowAny
            ? domMatches
            : domMatches || dowMatches;
    if (!calendarMatches) continue;
    for (const hour of sortedHours) {
      for (const minute of sortedMinutes) {
        const candidate = localDateToUtc(
          formatter,
          day.getUTCFullYear(),
          month,
          dayOfMonth,
          hour,
          minute,
        );
        if (candidate && candidate.getTime() > from.getTime()) return candidate.toISOString();
      }
    }
  }
  throw new Error("Cron expression has no matching time in the next five years");
}

function makeFormatter(timezone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || "UTC",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
      hourCycle: "h23",
    });
  } catch {
    throw new Error(`Invalid timezone: ${timezone}`);
  }
}

function partsFor(formatter: Intl.DateTimeFormat, value: Date) {
  const parts = formatter.formatToParts(value);
  const number = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: number("year"),
    month: number("month"),
    day: number("day"),
    hour: number("hour"),
    minute: number("minute"),
  };
}

function localDateToUtc(
  formatter: Intl.DateTimeFormat,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
) {
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = desired;
  for (let i = 0; i < 3; i++) {
    const actual = partsFor(formatter, new Date(candidate));
    const actualWall = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    const correction = desired - actualWall;
    if (correction === 0) return new Date(candidate);
    candidate += correction;
  }
  // A spring-forward wall time does not exist; do not silently move it to another slot.
  return null;
}

function requireCronField(field: string, min: number, max: number, isDow = false) {
  const values = new Set<number>();
  for (const token of field.split(",")) {
    const [rangePart, stepPart] = token.split("/");
    const step = stepPart == null ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) throw new Error("Invalid cron expression");
    let start = min;
    let end = max;
    if (rangePart !== "*") {
      if (rangePart.includes("-")) {
        const [startRaw, endRaw] = rangePart.split("-");
        start = Number(startRaw);
        end = Number(endRaw);
      } else {
        start = Number(rangePart);
        end = start;
      }
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      throw new Error("Invalid cron expression");
    }
    for (let value = start; value <= end; value += step) values.add(isDow && value === 7 ? 0 : value);
  }
  return values;
}

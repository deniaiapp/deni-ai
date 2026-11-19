export type RoutineFrequency = "daily" | "weekdays" | "weekly" | "monthly" | "custom";
export type RoutineSchedule = {
  frequency: RoutineFrequency;
  time: string;
  weekday: string;
  day: string;
  cron: string;
};
export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function readRoutineSchedule(cron = "0 9 * * *"): RoutineSchedule {
  const value: RoutineSchedule = {
    frequency: "custom",
    time: "09:00",
    weekday: "1",
    day: "1",
    cron,
  };
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return value;
  const [minute, hour, day, month, weekday] = parts;
  if (
    !/^\d+$/.test(minute) ||
    !/^\d+$/.test(hour) ||
    Number(minute) > 59 ||
    Number(hour) > 23 ||
    month !== "*"
  )
    return value;
  value.time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  if (day === "*" && weekday === "*") value.frequency = "daily";
  else if (day === "*" && weekday === "1-5") value.frequency = "weekdays";
  else if (day === "*" && /^[0-7]$/.test(weekday)) {
    value.frequency = "weekly";
    value.weekday = String(Number(weekday) % 7);
  } else if (/^\d+$/.test(day) && Number(day) >= 1 && Number(day) <= 31 && weekday === "*") {
    value.frequency = "monthly";
    value.day = day;
  }
  return value;
}

export function routineCron(value: RoutineSchedule): string {
  if (value.frequency === "custom") return value.cron.trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) throw new Error("Choose a valid time.");
  const [hour, minute] = value.time.split(":").map(Number);
  if (value.frequency === "weekly" && !/^[0-6]$/.test(value.weekday))
    throw new Error("Choose a weekday.");
  if (
    value.frequency === "monthly" &&
    (!/^\d+$/.test(value.day) || Number(value.day) < 1 || Number(value.day) > 31)
  )
    throw new Error("Choose a day between 1 and 31.");
  return `${minute} ${hour} ${value.frequency === "monthly" ? Number(value.day) : "*"} * ${value.frequency === "weekdays" ? "1-5" : value.frequency === "weekly" ? value.weekday : "*"}`;
}

export function describeRoutineSchedule(cron: string): string {
  const schedule = readRoutineSchedule(cron);
  if (schedule.frequency === "custom") return `Custom: ${cron}`;
  const cadence =
    schedule.frequency === "daily"
      ? "Every day"
      : schedule.frequency === "weekdays"
        ? "Weekdays"
        : schedule.frequency === "weekly"
          ? `Every ${WEEKDAYS[Number(schedule.weekday)]}`
          : `Day ${schedule.day} of each month`;
  return `${cadence} at ${schedule.time}`;
}

export function formatRoutineTime(value: string | null, timezone: string, locale = "en"): string {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

import { useExtracted } from "next-intl";
import { readRoutineSchedule } from "@/lib/routine-schedule";

export function useRoutineLabels() {
  const t = useExtracted();
  const weekdays = [
    t("Sunday"),
    t("Monday"),
    t("Tuesday"),
    t("Wednesday"),
    t("Thursday"),
    t("Friday"),
    t("Saturday"),
  ];

  function describe(cron: string): string {
    const schedule = readRoutineSchedule(cron);
    const time = schedule.time;
    switch (schedule.frequency) {
      case "custom":
        return t("Custom: {cron}", { cron });
      case "daily":
        return t("Every day at {time}", { time });
      case "weekdays":
        return t("Weekdays at {time}", { time });
      case "weekly":
        return t("Every {weekday} at {time}", { weekday: weekdays[Number(schedule.weekday)], time });
      default:
        return t("Day {day} of each month at {time}", { day: schedule.day, time });
    }
  }

  return { weekdays, describe };
}

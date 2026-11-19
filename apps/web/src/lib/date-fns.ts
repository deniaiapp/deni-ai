/**
 * Subset of date-fns used by this app and by react-day-picker's DateLib.
 * Mapped over the `date-fns` package name in tsconfig paths so tsc does not
 * load the full barrel (~350 files).
 */
export { addDays } from "date-fns/addDays";
export { addMonths } from "date-fns/addMonths";
export { addWeeks } from "date-fns/addWeeks";
export { addYears } from "date-fns/addYears";
export { compareDesc } from "date-fns/compareDesc";
export { differenceInCalendarDays } from "date-fns/differenceInCalendarDays";
export { differenceInCalendarMonths } from "date-fns/differenceInCalendarMonths";
export { eachMonthOfInterval } from "date-fns/eachMonthOfInterval";
export { eachYearOfInterval } from "date-fns/eachYearOfInterval";
export { endOfISOWeek } from "date-fns/endOfISOWeek";
export { endOfMonth } from "date-fns/endOfMonth";
export { endOfWeek, type EndOfWeekOptions } from "date-fns/endOfWeek";
export { endOfYear } from "date-fns/endOfYear";
export { format, type FormatOptions } from "date-fns/format";
export { getISOWeek } from "date-fns/getISOWeek";
export { getMonth, type GetMonthOptions } from "date-fns/getMonth";
export { getWeek, type GetWeekOptions } from "date-fns/getWeek";
export { getYear, type GetYearOptions } from "date-fns/getYear";
export { isAfter } from "date-fns/isAfter";
export { isBefore } from "date-fns/isBefore";
export { isDate } from "date-fns/isDate";
export { isSameDay } from "date-fns/isSameDay";
export { isSameMonth } from "date-fns/isSameMonth";
export { isSameYear } from "date-fns/isSameYear";
export { isThisMonth } from "date-fns/isThisMonth";
export { isThisWeek } from "date-fns/isThisWeek";
export { isThisYear } from "date-fns/isThisYear";
export { isToday } from "date-fns/isToday";
export { isYesterday } from "date-fns/isYesterday";
export { max } from "date-fns/max";
export { min } from "date-fns/min";
export { setMonth } from "date-fns/setMonth";
export { setYear } from "date-fns/setYear";
export { startOfDay } from "date-fns/startOfDay";
export { startOfISOWeek } from "date-fns/startOfISOWeek";
export { startOfMonth } from "date-fns/startOfMonth";
export { startOfWeek, type StartOfWeekOptions } from "date-fns/startOfWeek";
export { startOfYear } from "date-fns/startOfYear";
export type { Locale } from "date-fns/locale";

export type Month = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export interface Interval<
  StartType extends Date | number | string = Date | number | string,
  EndType extends Date | number | string = Date | number | string,
> {
  start: StartType;
  end: EndType;
}

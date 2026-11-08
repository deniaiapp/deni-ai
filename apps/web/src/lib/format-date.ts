/** Fixed timezone so SSR and client render identical date strings. */
export const APP_DATE_TIME_ZONE = "UTC";

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

export function getAppDateFormatter(
  locale: string,
  options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  },
) {
  const normalized: Intl.DateTimeFormatOptions = {
    ...options,
    timeZone: options.timeZone ?? APP_DATE_TIME_ZONE,
  };
  const key = `${locale}:${JSON.stringify(normalized)}`;
  const cached = dateFormatters.get(key);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat(locale, normalized);
  dateFormatters.set(key, formatter);
  return formatter;
}

export function formatAppDate(
  value: Date | string | number,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
) {
  const date = value instanceof Date ? value : new Date(value);
  return getAppDateFormatter(locale, options).format(date);
}

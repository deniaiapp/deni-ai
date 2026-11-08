import { formatAppDate } from "@/lib/format-date";

const RECEIPT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

export function formatReceiptDate(value: string | Date | null, locale: string) {
  if (!value) {
    return "—";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return formatAppDate(date, locale, RECEIPT_DATE_OPTIONS);
}

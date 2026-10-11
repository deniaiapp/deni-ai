import { formatMinorCurrency } from "@/lib/currency";

export function formatCurrency(amount: number | null, currency: string | null) {
  if (amount === null || !currency) return "—";
  return formatMinorCurrency(amount, currency, {
    currencyDisplay: "code",
    minimumFractionDigits: 0,
  });
}

export const numberFormatter = new Intl.NumberFormat(undefined);

export const monthDayFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

export const monthDayYearFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

// Editable limits stay ungrouped: a grouped "500.000" (de-DE and others) would be
// read back as 500 by Number().
export function formatTokenLimit(value: number | null) {
  if (value === null) return "";
  return String(value);
}

function getGroupSeparator(locale?: Intl.LocalesArgument) {
  return (
    new Intl.NumberFormat(locale).formatToParts(1_000_000).find((part) => part.type === "group")
      ?.value ?? ","
  );
}

// Limits are whole token counts, so only the locale's digit grouping (plus spaces and
// underscores) is dropped. Anything else, such as a decimal separator, is rejected
// rather than guessed at.
export function parseTokenLimit(value: string, locale?: Intl.LocalesArgument) {
  const normalized = value.replaceAll(getGroupSeparator(locale), "").replace(/[\s_]/g, "");
  if (!normalized) return null;
  if (!/^\d+$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

// Spreadsheet apps run a cell starting with one of these as a formula even when it is
// quoted, so user-controlled text gets a leading apostrophe. Numbers stay numeric.
const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function escapeCsvCell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return '""';
  const text =
    typeof value === "string" && CSV_FORMULA_PREFIX.test(value) ? `'${value}` : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function createTeamSlug(name: string) {
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
  const base = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  return base ? `${base}-${suffix}` : `team-${suffix}`;
}

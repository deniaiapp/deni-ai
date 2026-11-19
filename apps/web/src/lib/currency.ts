const DEFAULT_CURRENCY = "USD";

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function getCurrencyFormatter(
  locale: Intl.LocalesArgument | undefined,
  currencyCode: string,
  options?: Intl.NumberFormatOptions,
) {
  const key = `${String(locale ?? "")}:${currencyCode}:${JSON.stringify(options ?? {})}`;
  const cached = currencyFormatters.get(key);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
    ...options,
  });
  currencyFormatters.set(key, formatter);
  return formatter;
}

function normalizeCurrencyCode(currency?: string | null) {
  return (currency ?? DEFAULT_CURRENCY).toUpperCase();
}

function getCurrencyFractionDigits(currency: string, locale?: Intl.LocalesArgument) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).resolvedOptions().maximumFractionDigits;
}

export function minorUnitToMajor(amountMinor: number, currency?: string | null) {
  const currencyCode = normalizeCurrencyCode(currency);
  const fractionDigits = Number(getCurrencyFractionDigits(currencyCode) ?? 2);
  return amountMinor / 10 ** fractionDigits;
}

export function formatMinorCurrency(
  amountMinor: number,
  currency?: string | null,
  options?: Intl.NumberFormatOptions,
  locale?: Intl.LocalesArgument,
) {
  const currencyCode = normalizeCurrencyCode(currency);
  return getCurrencyFormatter(locale, currencyCode, options).format(
    minorUnitToMajor(amountMinor, currencyCode),
  );
}

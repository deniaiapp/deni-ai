export type NumberFormatOptions = {
  format?: "number" | "currency" | "percent";
  currency?: string;
  decimals?: number;
  unit?: string;
};

/** Formats a calculator or chart value; non-finite results (e.g. x / 0) show as a dash. */
export function formatIntelligentUiNumber(
  value: number,
  locale: string,
  { format = "number", currency, decimals, unit }: NumberFormatOptions = {},
): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  const style =
    format === "currency" && currency ? "currency" : format === "percent" ? "percent" : "decimal";
  let formatted: string;
  try {
    formatted = new Intl.NumberFormat(locale, {
      style,
      currency: style === "currency" ? currency : undefined,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals ?? (style === "percent" ? 1 : 2),
    }).format(value);
  } catch {
    formatted = String(value);
  }
  return unit ? `${formatted} ${unit}` : formatted;
}

/** Evenly spaced, human-friendly axis ticks covering [min, max]. */
export function niceTicks(min: number, max: number, targetCount = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return [0, 1];
  }
  if (min === max) {
    if (min === 0) return [0, 1];
    const pad = Math.abs(min) * 0.5;
    return niceTicks(min - pad, max + pad, targetCount);
  }
  const rawStep = (max - min) / Math.max(targetCount - 1, 1);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step =
    (normalized <= 1
      ? 1
      : normalized <= 2
        ? 2
        : normalized <= 2.5
          ? 2.5
          : normalized <= 5
            ? 5
            : 10) * magnitude;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let tick = start; tick <= end + step / 2; tick += step) {
    // Round away floating-point drift such as 0.30000000000000004.
    ticks.push(Number(tick.toPrecision(12)));
  }
  return ticks;
}

/** Short, stable hash for keying per-block state in local storage. */
export function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

import { useLocale } from "use-intl";
import { minorUnitToMajor } from "@/lib/currency";

const NUMBER_PART_TYPES = new Set([
  "minusSign",
  "plusSign",
  "integer",
  "group",
  "decimal",
  "fraction",
]);

function getPriceFormatter(locale: string, currencyCode: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currencyCode,
    currencyDisplay: "code",
    maximumFractionDigits: 0,
  });
}

export function useFormatPriceParts() {
  const locale = useLocale();

  return (amountMinor: number, currency?: string | null) => {
    const currencyCode = (currency ?? "USD").toUpperCase();
    const formatter = getPriceFormatter(locale, currencyCode);
    const parts = formatter.formatToParts(minorUnitToMajor(amountMinor, currencyCode));

    let currencyLabel = "";
    let amount = "";
    for (const part of parts) {
      if (part.type === "currency") {
        currencyLabel += part.value;
      } else if (NUMBER_PART_TYPES.has(part.type)) {
        amount += part.value;
      }
    }

    return {
      currency: currencyLabel,
      amount,
    };
  };
}

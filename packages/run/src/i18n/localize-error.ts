import { translateError, translateMessage, translatorFor } from "./standalone";
import { USAGE_LIMIT_HEADER, type UsageLimitError } from "../billing/plans";
import { getUsageSnapshot } from "../billing/usage";

/**
 * Translate the English messages lib code throws so hosts can answer in the viewer's
 * language (the server dictionary in standalone-ja.ts). Unknown messages are returned
 * unchanged.
 */
export function localizeError(error: unknown, locale: unknown, fallback?: string): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message) return fallback ?? translatorFor(locale)("Something went wrong");
  return translateError(locale, error);
}

/** Usage limits are phrased from the Deni AI plan at the time of the request. */
export async function localizeUsageLimit(
  userId: string,
  error: UsageLimitError,
  locale: unknown,
): Promise<string> {
  const t = translatorFor(locale);
  if (error.metric === "link") return t("Connect your Deni AI account to use Deni Run.");
  const usage = await getUsageSnapshot(userId);
  if (!usage) return translateMessage(locale, error.message);
  const plan = usage.planName;
  if (error.metric === "budget") {
    return t(
      "This month's Deni AI usage is used up on {plan}. Upgrade your Deni AI plan to keep going.",
      { plan },
    );
  }
  return t(
    "Teammate limit reached ({limit} on {plan}). Upgrade your Deni AI plan to add more teammates.",
    { limit: String(usage.teammates.limit), plan },
  );
}

/**
 * A 402 whose `x-usage-limit` header names the limit that stopped the request; the body is
 * `{ error, code: "usage_limit", metric }` with the message in the viewer's language.
 */
export async function usageLimitResponse(userId: string, error: UsageLimitError, locale: unknown) {
  return Response.json(
    {
      error: await localizeUsageLimit(userId, error, locale),
      code: error.code,
      metric: error.metric,
    },
    { status: 402, headers: { [USAGE_LIMIT_HEADER]: error.metric } },
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { headTranslator } from "@/i18n/head";
import { getAuthenticatedUserId } from "@/lib/auth";
import { deniAiUrl } from "@/lib/auth/deni-ai";
import type { UsageMetric } from "@/lib/billing/plans";
import { getUsageSnapshot } from "@/lib/billing/usage";
import { UpgradeScreen } from "@/components/account/upgrade-screen";

const REASONS = new Set<string>(["teammates", "budget", "link"]);

type UpgradeSearch = { reason?: UsageMetric };

const loadUpgrade = createServerFn({ method: "GET" }).handler(async () => {
  const userId = await getAuthenticatedUserId();
  const plansUrl = `${deniAiUrl()}/settings/billing`;
  if (!userId) return { signedIn: false, usage: null, plansUrl };
  return { signedIn: true, usage: await getUsageSnapshot(userId), plansUrl };
});

export const Route = createFileRoute("/upgrade")({
  validateSearch: (search: Record<string, unknown>): UpgradeSearch => ({
    reason: typeof search.reason === "string" && REASONS.has(search.reason) ? (search.reason as UsageMetric) : undefined,
  }),
  loader: () => loadUpgrade(),
  head: ({ matches }) => {
    const t = headTranslator(matches);
    return {
      meta: [
        { title: t("Plans · Deni Run") },
        { name: "description", content: t("Deni Run is included with every Deni AI plan.") },
      ],
    };
  },
  component: UpgradePage,
});

function UpgradePage() {
  const { reason } = Route.useSearch();
  const { signedIn, usage, plansUrl } = Route.useLoaderData();
  return <UpgradeScreen reason={reason} usage={usage} signedIn={signedIn} plansUrl={plansUrl} />;
}

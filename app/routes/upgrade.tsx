import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { headTranslator } from "@/i18n/head";
import { getAuthenticatedUserId } from "@/lib/auth";
import { syncBilling } from "@/lib/billing";
import type { UsageMetric } from "@/lib/plans";
import { getUsageSnapshot } from "@/lib/usage";
import { UpgradeScreen } from "../components/upgrade-screen";

const REASONS = new Set<string>(["teammates", "tokens", "browser", "computer"]);

type UpgradeSearch = { reason?: UsageMetric; billing?: string; session_id?: string };

const loadUpgrade = createServerFn({ method: "GET" })
  .validator((sessionId: string | undefined) => sessionId)
  .handler(async ({ data: sessionId }) => {
    const userId = await getAuthenticatedUserId();
    if (!userId) return { signedIn: false, usage: null };
    await syncBilling(userId, sessionId).catch(() => undefined);
    return { signedIn: true, usage: await getUsageSnapshot(userId) };
  });

export const Route = createFileRoute("/upgrade")({
  validateSearch: (search: Record<string, unknown>): UpgradeSearch => ({
    reason: typeof search.reason === "string" && REASONS.has(search.reason) ? (search.reason as UsageMetric) : undefined,
    billing: typeof search.billing === "string" ? search.billing : undefined,
    session_id: typeof search.session_id === "string" ? search.session_id : undefined,
  }),
  loaderDeps: ({ search }) => ({ sessionId: search.session_id }),
  loader: ({ deps }) => loadUpgrade({ data: deps.sessionId }),
  head: ({ matches }) => {
    const t = headTranslator(matches);
    return {
      meta: [
        { title: t("Upgrade to Pro · Deni Run") },
        { name: "description", content: t("More teammates, tokens, and computer time on a private computer.") },
      ],
    };
  },
  component: UpgradePage,
});

function UpgradePage() {
  const { reason } = Route.useSearch();
  const { signedIn, usage } = Route.useLoaderData();
  return <UpgradeScreen reason={reason} usage={usage} signedIn={signedIn} />;
}

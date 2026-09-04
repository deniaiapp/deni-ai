import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { UpgradeScreen } from "../components/upgrade-screen";
import { syncBilling } from "@/lib/billing";
import type { UsageMetric } from "@/lib/plans";
import { getUsageSnapshot } from "@/lib/usage";

export const metadata: Metadata = {
  title: "Upgrade to Pro · Deni Run",
  description: "More teammates, tokens, and computer time on a private computer.",
};

const REASONS = new Set<string>(["teammates", "tokens", "browser", "computer"]);

export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; billing?: string; session_id?: string }>;
}) {
  const params = await searchParams;
  const reason = params.reason && REASONS.has(params.reason) ? (params.reason as UsageMetric) : undefined;
  const { userId } = await auth();
  if (userId) {
    const sessionId = typeof params.session_id === "string" ? params.session_id : undefined;
    await syncBilling(userId, sessionId).catch(() => undefined);
  }
  const usage = userId ? await getUsageSnapshot(userId) : null;
  return <UpgradeScreen reason={reason} usage={usage} signedIn={Boolean(userId)} />;
}

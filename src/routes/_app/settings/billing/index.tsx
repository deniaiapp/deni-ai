import { createFileRoute } from "@tanstack/react-router";
import { useExtracted } from "use-intl";
import { SettingsPageShell } from "@/components/settings-page-shell";
import { Spinner } from "@/components/ui/spinner";
import { dynamic } from "@/lib/dynamic";

export const Route = createFileRoute("/_app/settings/billing/")({
  component: BillingSettingsPage,
});

/** Matches the billing page's own loading state, so nothing jumps when it loads. */
function BillingLoading() {
  const t = useExtracted();
  return (
    <SettingsPageShell
      title={t("Billing")}
      description={t("Manage your subscription and usage")}
      className="max-w-6xl"
    >
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    </SettingsPageShell>
  );
}

const BillingPage = dynamic(
  () => import("@/components/billing/billing-page").then((mod) => mod.BillingPage),
  { loading: () => <BillingLoading /> },
);

function BillingSettingsPage() {
  return <BillingPage />;
}

import { createFileRoute } from "@tanstack/react-router";
import { useExtracted } from "use-intl";
import { SettingsPageShell } from "@/components/settings-page-shell";
import { dynamic } from "@/lib/dynamic";

export const Route = createFileRoute("/_app/settings/billing/")({
  component: BillingSettingsPage,
});

/** Same title block as the loaded page, so the heading does not jump. */
function BillingLoading() {
  const t = useExtracted();
  return (
    <SettingsPageShell
      title={t("Billing")}
      description={t("Manage your subscription and usage")}
      className="max-w-6xl"
    >
      <p className="py-10 text-sm text-muted-foreground">{t("Loading billing…")}</p>
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

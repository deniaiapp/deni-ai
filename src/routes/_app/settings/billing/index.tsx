import { createFileRoute } from "@tanstack/react-router";
import { dynamic } from "@/lib/dynamic";

export const Route = createFileRoute("/_app/settings/billing/")({
  component: BillingSettingsPage,
});

const BillingPage = dynamic(
  () => import("@/components/billing/billing-page").then((mod) => mod.BillingPage),
  {
    loading: () => (
      <div className="flex min-h-[60vh] w-full items-center justify-center text-sm text-muted-foreground">
        Loading billing…
      </div>
    ),
  },
);

function BillingSettingsPage() {
  return <BillingPage />;
}

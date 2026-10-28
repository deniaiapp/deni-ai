import { createFileRoute } from "@tanstack/react-router";
import { StripeCheckoutPage } from "@/components/billing/stripe-checkout-page";
import type { IndividualPlanId } from "@/lib/billing";
import { useSearchParams } from "@/lib/navigation";

export const Route = createFileRoute("/_app/settings/billing/checkout/")({
  component: BillingCheckoutSettingsPage,
});

function BillingCheckoutSettingsPage() {
  const searchParams = useSearchParams();
  const planId = searchParams.get("planId") as IndividualPlanId | null;
  const sessionId = searchParams.get("session_id");

  return <StripeCheckoutPage scope="billing" planId={planId} sessionId={sessionId} />;
}

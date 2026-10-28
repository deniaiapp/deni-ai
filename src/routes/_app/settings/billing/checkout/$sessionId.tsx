import { createFileRoute } from "@tanstack/react-router";
import { StripeCheckoutPage } from "@/components/billing/stripe-checkout-page";
import type { IndividualPlanId } from "@/lib/billing";
import { useSearchParams } from "@/lib/navigation";

export const Route = createFileRoute("/_app/settings/billing/checkout/$sessionId")({
  component: BillingCheckoutSessionPage,
});

function BillingCheckoutSessionPage() {
  const { sessionId } = Route.useParams();
  const searchParams = useSearchParams();
  const planId = searchParams.get("planId") as IndividualPlanId | null;

  return <StripeCheckoutPage scope="billing" planId={planId} sessionId={sessionId} />;
}

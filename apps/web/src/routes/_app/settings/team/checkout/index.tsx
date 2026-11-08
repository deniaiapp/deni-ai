import { createFileRoute } from "@tanstack/react-router";
import { StripeCheckoutPage } from "@/components/billing/stripe-checkout-page";
import { isTeamPlanId } from "@/lib/billing";
import { useSearchParams } from "@/lib/navigation";

export const Route = createFileRoute("/_app/settings/team/checkout/")({
  component: TeamCheckoutSettingsPage,
});

function TeamCheckoutSettingsPage() {
  const searchParams = useSearchParams();
  const organizationId = searchParams.get("organizationId");
  const rawPlanId = searchParams.get("planId");
  const planId = isTeamPlanId(rawPlanId) ? rawPlanId : null;
  const sessionId = searchParams.get("session_id");

  return (
    <StripeCheckoutPage
      scope="team"
      organizationId={organizationId}
      planId={planId}
      sessionId={sessionId}
    />
  );
}

import { createFileRoute, redirect } from "@tanstack/react-router";
import { BetaTestersSettings } from "@/components/admin/beta-testers-settings";

/** Operators only (verified ADMIN_EMAILS / ADMIN_EMAIL_DOMAINS); the procedures check again. */
export const Route = createFileRoute("/_app/settings/beta-testers")({
  beforeLoad: ({ context }) => {
    if (!context.authState.isAdmin) {
      throw redirect({ to: "/settings/appearance" });
    }
  },
  component: BetaTestersSettings,
});

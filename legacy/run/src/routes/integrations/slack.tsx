import { createFileRoute } from "@tanstack/react-router";
import { headTranslator } from "@/i18n/head";
import { ConnectorLanding } from "@/components/connectors/connector-landing";

export const Route = createFileRoute("/integrations/slack")({
  head: ({ matches }) => {
    const t = headTranslator(matches);
    return {
      meta: [
        { title: t("Deni Run for Slack") },
        { name: "description", content: t("Add Deni Run to Slack so AI teammates can search messages, catch up on threads, and post updates with your approval.") },
      ],
    };
  },
  component: SlackPage,
});

function SlackPage() {
  return <ConnectorLanding id="slack" />;
}

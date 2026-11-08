import { createFileRoute } from "@tanstack/react-router";
import { headTranslator } from "@/i18n/head";
import { ConnectorLanding } from "@/components/connectors/connector-landing";

export const Route = createFileRoute("/integrations/notion")({
  head: ({ matches }) => {
    const t = headTranslator(matches);
    return {
      meta: [
        { title: t("Deni Run for Notion") },
        { name: "description", content: t("Connect Notion so Deni Run teammates can find, read, and update pages and databases with your approval.") },
      ],
    };
  },
  component: NotionPage,
});

function NotionPage() {
  return <ConnectorLanding id="notion" />;
}

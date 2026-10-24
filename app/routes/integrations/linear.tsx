import { createFileRoute } from "@tanstack/react-router";
import { headTranslator } from "@/i18n/head";
import { ConnectorLanding } from "../../components/connector-landing";

export const Route = createFileRoute("/integrations/linear")({
  head: ({ matches }) => {
    const t = headTranslator(matches);
    return {
      meta: [
        { title: t("Deni Run for Linear") },
        { name: "description", content: t("Connect Linear so Deni Run teammates can find, create, and update issues with your approval.") },
      ],
    };
  },
  component: LinearPage,
});

function LinearPage() {
  return <ConnectorLanding id="linear" />;
}

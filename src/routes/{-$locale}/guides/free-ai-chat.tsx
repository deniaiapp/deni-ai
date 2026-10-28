import { Coins, Layers3, Scale, Sparkles } from "lucide-react";
import { useExtracted } from "use-intl";
import { createFileRoute } from "@tanstack/react-router";
import { getExtracted } from "@/i18n/extracted";
import { pageHead } from "@/lib/seo";
import {
  GuideArticle,
  GuideCallout,
  GuideCardGrid,
  GuideList,
  GuideSection,
} from "@/components/content/guide-article";

export const Route = createFileRoute("/{-$locale}/guides/free-ai-chat")({
  head: ({ match }) => {
    const { intl } = match.context;
    const t = getExtracted(intl);
    const title = t("Free AI chat with GPT, Claude, and Gemini");
    const description = t(
      "How to choose a free AI chat workspace with GPT, Claude, and Gemini: model access, limits, privacy, multi-model switching, and when paid plans are worth it.",
    );

    return pageHead({
      title,
      description,
      alternates: { path: "/guides/free-ai-chat", locale: intl.locale },
      openGraph: {
        title: `${title} — Deni AI Guides`,
        description,
      },
    });
  },
  component: FreeAiChatGuidePage,
});

function FreeAiChatGuidePage() {
  const t = useExtracted();
  const headline = t("Free AI chat with GPT, Claude, and Gemini");
  const description = t(
    "Free AI chat is no longer rare. The hard part is choosing a workspace that stays useful after the first week: enough models, clear limits, sane privacy defaults, and a workflow that matches real tasks.",
  );

  const criteria = [
    {
      icon: Layers3,
      title: t("Model flexibility"),
      body: t(
        "Can you switch models when the task changes, or are you locked into one strength profile? Multi-model access matters once you do research, writing, and coding in the same week.",
      ),
    },
    {
      icon: Coins,
      title: t("Transparent limits"),
      body: t(
        "Free tiers always have limits. Good products explain them clearly. Opaque throttles and surprise walls create frustration and make planning impossible.",
      ),
    },
    {
      icon: Scale,
      title: t("Review-friendly workflow"),
      body: t(
        "The best free tools still help you verify answers. Look for clean history, easy copy, model comparison, and public guidance that treats AI as draft material.",
      ),
    },
    {
      icon: Sparkles,
      title: t("Upgrade path that makes sense"),
      body: t(
        "Paid plans should buy capacity, stronger models, or team features you actually need. Avoid products that only improve after you accept unclear lock-in.",
      ),
    },
  ];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline,
    description,
    author: { "@type": "Organization", name: "Deni AI" },
    publisher: { "@type": "Organization", name: "Deni AI" },
    mainEntityOfPage: "https://deniai.app/guides/free-ai-chat",
  };

  return (
    <GuideArticle
      breadcrumbLabel={t("AI Guides")}
      headline={headline}
      description={description}
      jsonLd={jsonLd}
      nextLinks={[
        { href: "/models", label: t("See available models") },
        { href: "/faq", label: t("FAQ") },
        { href: "/home", label: t("Back to home") },
      ]}
    >
      <GuideCardGrid items={criteria} />

      <GuideSection title={t("Free is a product decision, not only a price")}>
        <p>
          {t(
            "A free AI chat product has to balance model costs, abuse prevention, and user experience. That means rate limits, model availability, and feature gates are normal. What matters is whether those tradeoffs are explained honestly.",
          )}
        </p>
        <p>
          {t(
            "Evaluate free workspaces the same way you evaluate notes apps or code editors: daily friction, exportability, and whether the tool helps you do better work, not only generate more text.",
          )}
        </p>
      </GuideSection>

      <GuideSection title={t("Questions to ask before you settle on a tool")}>
        <p>
          {t(
            "Can I complete my common tasks without constantly fighting the interface? Writing, summarizing, coding help, and translation should feel straightforward.",
          )}
        </p>
        <p>
          {t(
            "Can I understand privacy expectations before signup? Public policy pages, contact options, and clear account controls are signs of a product that expects real users, not only acquisition traffic.",
          )}
        </p>
        <p>
          {t(
            "Can I grow without restarting my workflow? History, projects, and team features matter once AI becomes part of weekly work.",
          )}
        </p>
      </GuideSection>

      <GuideCallout title={t("When a free plan is enough")}>
        <GuideList
          items={[
            t("You need occasional drafting, explanations, and light research help."),
            t("You can stay within published usage limits most weeks."),
            t("You review important answers yourself and do not need always-on premium models."),
            t("You want to learn multi-model habits before paying for higher capacity."),
          ]}
        />
      </GuideCallout>

      <GuideSection title={t("When paying is rational")}>
        <p>
          {t(
            "Pay when limits block real work, when stronger models save more time than they cost, or when a team needs shared access and visibility. Paying to remove mild curiosity friction is optional. Paying to protect a production workflow is often rational.",
          )}
        </p>
        <p>
          {t(
            "Also compare plan tiers and usage limits. If you rely on AI for regular work, a paid plan may be more predictable than maintaining several separate chat websites.",
          )}
        </p>
      </GuideSection>

      <GuideSection title={t("How Deni AI fits this checklist")}>
        <p>
          {t(
            "Deni AI is designed as a free-to-start multi-model workspace with public pages for models, use cases, guides, privacy, terms, and contact. The product goal is practical access and clearer model choice, not a single locked chatbot personality.",
          )}
        </p>
        <p>
          {t(
            "If you are comparing tools, read the guides on model selection and verification first. The habits matter more than any one brand name, and they transfer if your stack changes later.",
          )}
        </p>
      </GuideSection>
    </GuideArticle>
  );
}

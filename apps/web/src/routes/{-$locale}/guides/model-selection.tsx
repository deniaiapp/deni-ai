import { CheckCircle2, Gauge, GitCompare, ShieldAlert } from "lucide-react";
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

export const Route = createFileRoute("/{-$locale}/guides/model-selection")({
  head: ({ match }) => {
    const { intl } = match.context;
    const t = getExtracted(intl);
    const title = t("How to choose ChatGPT, Claude, Gemini, or Grok");
    const description = t(
      "Pick ChatGPT, Claude, Gemini, or Grok by task: fast drafts, reasoning, coding, and writing. A practical model selection guide for real work.",
    );

    return pageHead({
      title,
      description,
      alternates: { path: "/guides/model-selection", locale: intl.locale },
      openGraph: {
        title: `${title} — Deni AI Guides`,
        description,
      },
    });
  },
  component: ModelSelectionGuidePage,
});

function ModelSelectionGuidePage() {
  const t = useExtracted();
  const headline = t("How to choose ChatGPT, Claude, Gemini, or Grok");
  const description = t(
    "Most people choose AI models by reputation. A better method is to start from the task, decide the risk level, then pick the smallest model that can produce a trustworthy result.",
  );

  const decisionRules = [
    {
      icon: Gauge,
      title: t("Use fast models for exploration"),
      body: t(
        "Fast general models are useful when the cost of being wrong is low: brainstorming, first drafts, rewriting short text, summarizing familiar material, and asking for a quick explanation.",
      ),
    },
    {
      icon: ShieldAlert,
      title: t("Use reasoning models when mistakes are expensive"),
      body: t(
        "Planning, debugging, policy interpretation, product decisions, and financial or legal-adjacent summaries need slower review. A reasoning model is useful when the answer must expose assumptions and tradeoffs.",
      ),
    },
    {
      icon: CheckCircle2,
      title: t("Use coding models when output must fit a codebase"),
      body: t(
        "Coding tasks are not just text generation. The answer has to respect APIs, file boundaries, dependency versions, tests, and existing style. Start with a coding-capable model when implementation detail matters.",
      ),
    },
    {
      icon: GitCompare,
      title: t("Compare models only when comparison changes the decision"),
      body: t(
        "Running every prompt through many models wastes attention. Compare models when the task is ambiguous, the output will be published, or a wrong answer would create rework.",
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
    mainEntityOfPage: "https://deniai.app/guides/model-selection",
  };

  return (
    <GuideArticle
      breadcrumbLabel={t("AI Guides")}
      headline={headline}
      description={description}
      jsonLd={jsonLd}
      nextLinks={[
        { href: "/guides/verify-ai-answers", label: t("Next: verify AI answers") },
        { href: "/models", label: t("See available models") },
      ]}
    >
      <GuideCardGrid items={decisionRules} />

      <GuideSection title={t("Why model names are a weak starting point")}>
        <p>
          {t(
            "Brand names change faster than work does. A model that was best at coding last quarter may not be the best for your current repository, language, or review standard. The stable part of the decision is the task profile: drafting, analysis, coding, translation, research, or decision support.",
          )}
        </p>
        <p>
          {t(
            "Starting from the brand also encourages overkill. People often choose the most expensive model by default, then spend more time reading a long answer than the task required. A smaller model with a clear prompt and a short verification step is often faster end to end.",
          )}
        </p>
      </GuideSection>

      <GuideSection title={t("A simple selection workflow")}>
        <p>
          {t(
            "First, classify the task. Is it drafting, analysis, coding, translation, research, or decision support? The category matters more than the model name because it defines what a good answer looks like.",
          )}
        </p>
        <p>
          {t(
            "Second, classify the risk. Low-risk work can start with a fast model. Medium-risk work should be reviewed against requirements. High-risk work should use stronger reasoning and a separate verification pass.",
          )}
        </p>
        <p>
          {t(
            "Third, look at the failure mode. If the model might invent facts, ask for sources and verify them. If it might write invalid code, run tests. If it might flatten nuance, ask another model to critique the tone.",
          )}
        </p>
        <p>
          {t(
            "Finally, stop when the answer is good enough for the next human step. The goal is not to find a perfect model. The goal is to reduce uncertainty enough to keep moving responsibly.",
          )}
        </p>
      </GuideSection>

      <GuideSection title={t("Task profiles that show up in real work")}>
        <p>
          {t(
            "Drafting work rewards speed and iteration. Emails, outlines, meeting notes, and first-pass blog structures benefit from a model that responds quickly so you can reshape the result many times.",
          )}
        </p>
        <p>
          {t(
            "Analysis work rewards careful structure. Competitive notes, incident reviews, and product tradeoffs need assumptions listed, alternatives compared, and weak claims marked. This is where stronger reasoning usually pays for itself.",
          )}
        </p>
        <p>
          {t(
            "Coding work rewards local correctness. A good answer names files, respects existing APIs, and leaves you with something you can run. If the model cannot state constraints, treat the output as a sketch rather than a patch.",
          )}
        </p>
        <p>
          {t(
            "Translation and localization reward audience fit. Literal accuracy is only the first pass. The final text has to sound natural for the reader, which often needs a second edit focused on tone rather than dictionary correctness.",
          )}
        </p>
      </GuideSection>

      <GuideCallout title={t("Model choice checklist")}>
        <GuideList
          items={[
            t("What kind of output do I need: draft, answer, plan, code, or critique?"),
            t("What happens if the answer is wrong or incomplete?"),
            t("Can a faster model produce a usable first pass?"),
            t("Do I need a second model to challenge the assumptions?"),
            t("What human verification step will happen before this is used?"),
          ]}
        />
      </GuideCallout>

      <GuideSection title={t("Common mistakes when switching models")}>
        <p>
          {t(
            "Copying the same vague prompt into every model and ranking the answers by style. Fluent prose is not evidence. Ask for structured output, assumptions, and unknowns so answers can be compared on substance.",
          )}
        </p>
        <p>
          {t(
            "Treating disagreement as a reason to average answers. When models disagree, isolate the disputed claim and verify it outside the chat. Disagreement is useful because it points to the exact place review is needed.",
          )}
        </p>
        <p>
          {t(
            "Escalating to the strongest model for every small task. That habit raises cost, slows iteration, and trains you to outsource judgment. Keep a default fast path for low-risk work.",
          )}
        </p>
      </GuideSection>

      <GuideSection title={t("How Deni AI supports this workflow")}>
        <p>
          {t(
            "Deni AI is built for practical model switching in one workspace. You can start with a fast answer, move to a stronger model when the stakes rise, and keep related work in the same conversation history instead of juggling separate provider apps.",
          )}
        </p>
        <p>
          {t(
            "Compare models by answer quality, latency, and the usage information shown in the app rather than assuming one provider's API pricing maps directly to another.",
          )}
        </p>
      </GuideSection>
    </GuideArticle>
  );
}

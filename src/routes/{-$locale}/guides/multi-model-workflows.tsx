import { FilePenLine, GitCompareArrows, MessageSquareText, Route as RouteIcon } from "lucide-react";
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

export const Route = createFileRoute("/{-$locale}/guides/multi-model-workflows")({
  head: ({ match }) => {
    const { intl } = match.context;
    const t = getExtracted(intl);
    const title = t("When multi-model AI is actually useful");
    const description = t(
      "Concrete workflows for using multiple AI models to compare answers, improve drafts, reduce risk, and decide when one model is enough.",
    );

    return pageHead({
      title,
      description,
      alternates: { path: "/guides/multi-model-workflows", locale: intl.locale },
      openGraph: {
        title: `${title} — Deni AI Guides`,
        description,
      },
    });
  },
  component: MultiModelWorkflowsGuidePage,
});

function MultiModelWorkflowsGuidePage() {
  const t = useExtracted();
  const headline = t("When multi-model AI is actually useful");
  const description = t(
    "Using more than one AI model is not automatically better. It is useful when the second answer changes what you can see: assumptions, missing context, alternative structure, or risk.",
  );

  const workflows = [
    {
      icon: MessageSquareText,
      title: t("Second-opinion workflow"),
      body: t(
        "Use one model to create the first answer, then ask another model to identify weak claims, missing context, and possible objections. This is useful for decisions, planning, and sensitive communication.",
      ),
    },
    {
      icon: FilePenLine,
      title: t("Draft-and-editor workflow"),
      body: t(
        "Use a fast model for a rough draft, then use a stronger writing or reasoning model as the editor. Ask it to preserve intent while improving structure, clarity, and audience fit.",
      ),
    },
    {
      icon: RouteIcon,
      title: t("Router workflow"),
      body: t(
        "Send different parts of the work to different strengths: a coding model for implementation, a reasoning model for tradeoffs, and a writing model for the final explanation.",
      ),
    },
    {
      icon: GitCompareArrows,
      title: t("Disagreement workflow"),
      body: t(
        "When two models disagree, do not average the answers. Identify the exact point of disagreement, gather evidence, and decide which answer is better supported.",
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
    mainEntityOfPage: "https://deniai.app/guides/multi-model-workflows",
  };

  return (
    <GuideArticle
      breadcrumbLabel={t("AI Guides")}
      headline={headline}
      description={description}
      jsonLd={jsonLd}
      nextLinks={[
        { href: "/guides/model-selection", label: t("Back to model selection") },
        { href: "/guides/prompt-patterns", label: t("Next: prompt patterns") },
        { href: "/chat", label: t("Try a workflow") },
      ]}
    >
      <GuideCardGrid items={workflows} />

      <GuideSection title={t("When one model is enough")}>
        <p>
          {t(
            "If the task is low-risk, familiar, and easy to review, one model is usually enough. Examples include rewriting a short message, generating title ideas, or explaining a concept you already understand.",
          )}
        </p>
        <p>
          {t(
            "Adding more models has a cost: more text to read, more contradictions to resolve, and more chances to mistake variety for truth. Use comparison deliberately, not automatically.",
          )}
        </p>
      </GuideSection>

      <GuideSection title={t("When comparison is worth it")}>
        <p>
          {t(
            "Comparison is valuable when the answer will guide a decision, represent your organization, affect a customer, change code, or summarize information you have not personally verified.",
          )}
        </p>
        <p>
          {t(
            "The strongest pattern is not asking two models the same vague question. It is asking the second model to perform a specific role: critic, editor, tester, planner, translator, or simplifier.",
          )}
        </p>
        <p>
          {t(
            "When the second model finds a weakness, update the prompt or the requirements and run a focused follow-up. The benefit comes from iteration, not from collecting many unreviewed answers.",
          )}
        </p>
      </GuideSection>

      <GuideCallout title={t("A useful multi-model prompt pattern")}>
        <p className="rounded-2xl border border-border bg-background p-5">
          {t(
            "Review the previous answer as a skeptical editor. List the strongest parts, the weakest assumptions, missing evidence, and the one change that would make it more useful. Do not rewrite yet.",
          )}
        </p>
      </GuideCallout>

      <GuideSection title={t("Example: product decision memo")}>
        <p>
          {t(
            "Start with a reasoning model and ask for options, tradeoffs, risks, and a recommended default. Keep the answer structured so each claim can be checked.",
          )}
        </p>
        <p>
          {t(
            "Then switch models and ask only for critique: missing stakeholders, optimistic assumptions, and measurement gaps. Do not request a full rewrite yet. This keeps the second model focused on risk instead of style.",
          )}
        </p>
        <p>
          {t(
            "Finally, write the memo yourself using only the claims you verified. The AI work shortens research and challenge time, but the decision still needs a human owner.",
          )}
        </p>
      </GuideSection>

      <GuideSection title={t("Example: bugfix workflow")}>
        <p>
          {t(
            "Use a coding-capable model to propose a minimal patch and a test plan. Ask it to name the files it thinks are involved and the edge cases it is unsure about.",
          )}
        </p>
        <p>
          {t(
            "Then use a second model as a reviewer against the stack trace and the existing code style. Ask what would break, what is untested, and whether the patch is larger than needed.",
          )}
        </p>
        <p>
          {t(
            "Only after that review should you apply changes in a real environment. Multi-model help is useful here because implementation skill and skeptical review are different jobs.",
          )}
        </p>
      </GuideSection>

      <GuideCallout title={t("Multi-model checklist")}>
        <GuideList
          items={[
            t("Is the second model doing a different job, or only regenerating style?"),
            t("Can I name the exact claim that disagreement is about?"),
            t("What evidence will decide which answer wins?"),
            t("Am I collecting answers, or iterating toward a reviewed result?"),
            t("What human step remains after the AI passes are done?"),
          ]}
        />
      </GuideCallout>
    </GuideArticle>
  );
}

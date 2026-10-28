import { Braces, ListTree, Target, Wrench } from "lucide-react";
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

export const Route = createFileRoute("/{-$locale}/guides/prompt-patterns")({
  head: ({ match }) => {
    const { intl } = match.context;
    const t = getExtracted(intl);
    const title = t("Prompt patterns that work across AI models");
    const description = t(
      "Reusable prompt patterns for clearer goals, better constraints, structured output, and multi-model review inside an AI chat workspace.",
    );

    return pageHead({
      title,
      description,
      alternates: { path: "/guides/prompt-patterns", locale: intl.locale },
      openGraph: {
        title: `${title} — Deni AI Guides`,
        description,
      },
    });
  },
  component: PromptPatternsGuidePage,
});

function PromptPatternsGuidePage() {
  const t = useExtracted();
  const headline = t("Prompt patterns that work across AI models");
  const description = t(
    "A good prompt does not need theatrical roleplay. It needs a clear goal, useful context, explicit constraints, and a definition of done. These patterns transfer well between models and keep humans in control.",
  );

  const patterns = [
    {
      icon: Target,
      title: t("Goal-first pattern"),
      body: t(
        "State the outcome before the background. Tell the model what success looks like, who the audience is, and what format you need. Background details come second so they do not bury the request.",
      ),
    },
    {
      icon: ListTree,
      title: t("Constraint ladder"),
      body: t(
        "List hard constraints separately from preferences. Hard constraints are deadlines, legal limits, APIs, word counts, and must-include facts. Preferences are tone, style, and nice-to-have extras.",
      ),
    },
    {
      icon: Braces,
      title: t("Structured output pattern"),
      body: t(
        "Ask for sections, bullet lists, tables, or labeled fields when you need to compare or verify answers. Structure makes weak claims easier to spot and easier to hand to a second model.",
      ),
    },
    {
      icon: Wrench,
      title: t("Repair pattern"),
      body: t(
        "When an answer is almost right, do not restart from zero. Quote the weak part, explain what failed, and ask for a minimal repair. This preserves good work and reduces drift.",
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
    mainEntityOfPage: "https://deniai.app/guides/prompt-patterns",
  };

  return (
    <GuideArticle
      breadcrumbLabel={t("AI Guides")}
      headline={headline}
      description={description}
      jsonLd={jsonLd}
      nextLinks={[
        { href: "/guides/study-with-ai", label: t("Next: study with AI") },
        { href: "/guides/multi-model-workflows", label: t("Multi-model workflows") },
      ]}
    >
      <GuideCardGrid items={patterns} />

      <GuideSection title={t("A reliable prompt skeleton")}>
        <p>
          {t(
            "Use the same skeleton for most work: goal, audience, context, constraints, examples, and definition of done. You can skip empty sections, but keeping the order stable makes prompts easier to reuse.",
          )}
        </p>
        <div className="rounded-2xl border border-border bg-card p-5 text-sm leading-7">
          <p>{t("Goal: what finished work should look like.")}</p>
          <p className="mt-2">{t("Audience: who will read or use the result.")}</p>
          <p className="mt-2">{t("Context: only the facts the model cannot infer.")}</p>
          <p className="mt-2">{t("Constraints: hard limits and non-negotiables.")}</p>
          <p className="mt-2">{t("Output format: headings, bullets, code blocks, or tables.")}</p>
          <p className="mt-2">
            {t("Definition of done: how you will judge whether the answer is usable.")}
          </p>
        </div>
      </GuideSection>

      <GuideSection title={t("Patterns for higher-quality drafts")}>
        <p>
          {t(
            "Ask for options before a final answer when the decision space is large. Three labeled options with tradeoffs are usually more useful than one polished paragraph that hides alternatives.",
          )}
        </p>
        <p>
          {t(
            "Ask the model to mark uncertainty. A sentence that says what is known, assumed, and unknown is easier to verify than a confident monologue.",
          )}
        </p>
        <p>
          {t(
            "Provide one short example of the desired style when tone matters. Examples beat adjectives. Saying professional and concise is weaker than showing a two-sentence sample.",
          )}
        </p>
      </GuideSection>

      <GuideCallout title={t("Prompt anti-patterns")}>
        <GuideList
          items={[
            t("Dumping every note you have without stating the actual request."),
            t("Using long persona theatre instead of clear constraints and audience."),
            t("Asking for perfection in one shot instead of draft, critique, and repair."),
            t("Hiding hard requirements inside a paragraph of soft preferences."),
            t("Accepting the first fluent answer because it sounds finished."),
          ]}
        />
      </GuideCallout>

      <GuideSection title={t("Prompts that travel well between models")}>
        <p>
          {t(
            "Portable prompts avoid provider-specific slang and keep requirements explicit. If a prompt only works because one model guesses your unstated intent, it will fail when you switch.",
          )}
        </p>
        <p>
          {t(
            "When you compare models, keep the prompt identical for the first pass. Then specialize: ask one model to critique, another to rewrite, and another to simplify for a different audience.",
          )}
        </p>
      </GuideSection>

      <GuideSection title={t("Worked example: support reply")}>
        <p>
          {t(
            "Goal: draft a calm support reply that acknowledges the issue, explains the next step, and avoids promising a refund policy that does not exist.",
          )}
        </p>
        <p>
          {t(
            "Constraints: under 120 words, no legal claims, include a request for the account email, and offer a self-serve link only if it is real.",
          )}
        </p>
        <p>
          {t(
            "Definition of done: a human agent can send the reply after checking the account status. This definition prevents the model from inventing resolution details.",
          )}
        </p>
      </GuideSection>
    </GuideArticle>
  );
}

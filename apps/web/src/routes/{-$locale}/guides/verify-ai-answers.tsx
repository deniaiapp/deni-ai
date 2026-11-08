import { Binary, Code2, FileSearch, Languages, ListChecks } from "lucide-react";
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

export const Route = createFileRoute("/{-$locale}/guides/verify-ai-answers")({
  head: ({ match }) => {
    const { intl } = match.context;
    const t = getExtracted(intl);
    const title = t("How to verify AI answers before you rely on them");
    const description = t(
      "A practical review workflow for checking AI-generated facts, numbers, code, citations, translations, and recommendations.",
    );

    return pageHead({
      title,
      description,
      alternates: { path: "/guides/verify-ai-answers", locale: intl.locale },
      openGraph: {
        title: `${title} — Deni AI Guides`,
        description,
      },
    });
  },
  component: VerifyAiAnswersGuidePage,
});

function VerifyAiAnswersGuidePage() {
  const t = useExtracted();
  const headline = t("How to verify AI answers before you rely on them");
  const description = t(
    "AI output is useful when it shortens the path to a reviewed result. It becomes risky when a fluent answer is treated as proof. Verification turns AI from a guess into a working draft.",
  );

  const reviewAreas = [
    {
      icon: FileSearch,
      title: t("Facts and sources"),
      body: t(
        "Ask which claims need evidence, then verify those claims against primary or trusted sources. A citation is not enough; the source must actually support the statement.",
      ),
    },
    {
      icon: Binary,
      title: t("Numbers and calculations"),
      body: t(
        "Recalculate totals, dates, rates, and comparisons separately. If the answer includes a table, check both the formula and the interpretation.",
      ),
    },
    {
      icon: Code2,
      title: t("Code and commands"),
      body: t(
        "Run tests, read the changed files, and inspect edge cases. AI can produce plausible code that ignores local conventions or fails under real inputs.",
      ),
    },
    {
      icon: Languages,
      title: t("Translation and tone"),
      body: t(
        "Check whether the result sounds natural for the audience. Literal accuracy is not enough when the final text has to persuade, support, or explain.",
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
    mainEntityOfPage: "https://deniai.app/guides/verify-ai-answers",
  };

  return (
    <GuideArticle
      breadcrumbLabel={t("AI Guides")}
      headline={headline}
      description={description}
      jsonLd={jsonLd}
      nextLinks={[
        { href: "/guides/multi-model-workflows", label: t("Next: multi-model workflows") },
        { href: "/use-cases", label: t("See use cases") },
      ]}
    >
      <section className="rounded-[1.5rem] border border-border/70 bg-card p-6 md:p-8">
        <div className="inline-flex size-11 items-center justify-center rounded-2xl bg-secondary">
          <ListChecks className="size-5" />
        </div>
        <h2 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">
          {t("The verification pass")}
        </h2>
        <p className="mt-4 text-sm leading-8 text-muted-foreground">
          {t(
            "Before using an AI answer, separate it into claims, instructions, and judgments. Claims need evidence. Instructions need testing. Judgments need context. This simple split catches many mistakes that are hidden by confident wording.",
          )}
        </p>
      </section>

      <GuideCardGrid items={reviewAreas} />

      <GuideSection title={t("A five-minute review routine")}>
        <p>
          {t(
            "Start by highlighting every sentence that would matter if it were wrong. Dates, prices, names, legal obligations, medical details, and technical commands deserve extra attention.",
          )}
        </p>
        <p>
          {t(
            "Then ask the model to list its assumptions. This is not because the model knows itself perfectly, but because forcing assumptions into the open gives you a checklist for review.",
          )}
        </p>
        <p>
          {t(
            "Next, verify outside the conversation. Use documentation, source records, tests, calculators, or a second expert review. Do not let the AI answer be the only evidence for itself.",
          )}
        </p>
        <p>
          {t(
            "Finally, rewrite the answer in your own words before publishing or sending it. If you cannot explain the result without copying the model, you probably have not reviewed it enough.",
          )}
        </p>
      </GuideSection>

      <GuideSection title={t("What fluent mistakes look like")}>
        <p>
          {t(
            "Invented citations are a common failure mode. The format looks academic, the title sounds real, and the year is plausible. Always open the source or search for the exact title before relying on it.",
          )}
        </p>
        <p>
          {t(
            "Hidden scope changes are another trap. You ask for a summary of one document and the model quietly imports general knowledge. Force the answer to mark what came from the provided material and what did not.",
          )}
        </p>
        <p>
          {t(
            "Code that almost runs is especially costly. The snippet may compile in isolation while ignoring your framework version, auth middleware, or test harness. Treat untested code as a proposal, not a solution.",
          )}
        </p>
      </GuideSection>

      <GuideCallout title={t("Questions to ask before trusting an answer")}>
        <GuideList
          items={[
            t("Which claims would cause harm or rework if they were wrong?"),
            t("Can I confirm the important facts outside the AI conversation?"),
            t("Did the answer skip assumptions, constraints, or edge cases?"),
            t("Have I tested code, commands, or calculations in a real environment?"),
            t("Would a reader understand what is known, uncertain, and recommended?"),
          ]}
        />
      </GuideCallout>

      <GuideSection title={t("When verification can stay light")}>
        <p>
          {t(
            "Not every task needs a full audit. Low-risk drafting, brainstorming, and private learning notes can use a lighter pass: skim for nonsense, keep the useful parts, and move on.",
          )}
        </p>
        <p>
          {t(
            "The key is matching review depth to consequence. A social media caption and a customer refund policy do not deserve the same process. Build a habit of asking what fails if this is wrong.",
          )}
        </p>
      </GuideSection>

      <GuideSection title={t("Using a second model as a reviewer")}>
        <p>
          {t(
            "A second model is useful when you ask it to critique, not when you ask it to regenerate the same answer. Request weak claims, missing evidence, and the single highest-impact fix. Then verify those points yourself.",
          )}
        </p>
        <p>
          {t(
            "This pattern works well inside a multi-model workspace because the review stays next to the original draft. You can keep the first answer, apply only the corrections that survive human judgment, and avoid starting from zero.",
          )}
        </p>
      </GuideSection>
    </GuideArticle>
  );
}

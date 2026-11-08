import { BookOpenCheck, Brain, NotebookPen, ShieldQuestion } from "lucide-react";
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

export const Route = createFileRoute("/{-$locale}/guides/study-with-ai")({
  head: ({ match }) => {
    const { intl } = match.context;
    const t = getExtracted(intl);
    const title = t("How to study with AI without outsourcing your thinking");
    const description = t(
      "A practical study guide for using AI chat to explain concepts, quiz yourself, organize notes, and keep real learning under your control.",
    );

    return pageHead({
      title,
      description,
      alternates: { path: "/guides/study-with-ai", locale: intl.locale },
      openGraph: {
        title: `${title} — Deni AI Guides`,
        description,
      },
    });
  },
  component: StudyWithAiGuidePage,
});

function StudyWithAiGuidePage() {
  const t = useExtracted();
  const headline = t("How to study with AI without outsourcing your thinking");
  const description = t(
    "AI can accelerate learning when it explains, quizzes, and reorganizes material. It becomes harmful when it replaces retrieval practice and you only feel productive because the chat looks smart.",
  );

  const methods = [
    {
      icon: Brain,
      title: t("Explain then hide"),
      body: t(
        "Ask for an explanation, then close the answer and rewrite it from memory. Compare your version with the original. The learning happens in the rewrite, not in the first fluent summary.",
      ),
    },
    {
      icon: ShieldQuestion,
      title: t("Quiz mode"),
      body: t(
        "Ask the model to quiz you with short questions, then answer first. Only after you answer should you request the solution and a critique of your reasoning.",
      ),
    },
    {
      icon: NotebookPen,
      title: t("Notes compression"),
      body: t(
        "Paste messy notes and ask for a structured outline with definitions, examples, and open questions. Keep the open questions. They tell you what still needs practice.",
      ),
    },
    {
      icon: BookOpenCheck,
      title: t("Worked-example review"),
      body: t(
        "For math, code, or process-heavy subjects, ask for a worked example with each step labeled. Then solve a similar problem without help before asking for a check.",
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
    mainEntityOfPage: "https://deniai.app/guides/study-with-ai",
  };

  return (
    <GuideArticle
      breadcrumbLabel={t("AI Guides")}
      headline={headline}
      description={description}
      jsonLd={jsonLd}
      nextLinks={[
        { href: "/guides/privacy-when-using-ai", label: t("Next: privacy habits") },
        { href: "/guides/verify-ai-answers", label: t("Verify AI answers") },
      ]}
    >
      <GuideCardGrid items={methods} />

      <GuideSection title={t("What good AI-assisted study looks like")}>
        <p>
          {t(
            "Good use shortens the path to understanding and practice. You still read source material, attempt problems, and produce your own words. The model is a tutor and organizer, not a substitute for the exam room in your head.",
          )}
        </p>
        <p>
          {t(
            "A useful session has a goal: understand one concept, pass one quiz set, or convert notes into a study plan. Open-ended chatting without a goal often creates the feeling of progress without durable memory.",
          )}
        </p>
      </GuideSection>

      <GuideSection title={t("What weak AI-assisted study looks like")}>
        <p>
          {t(
            "Weak use means pasting the assignment, accepting the answer, and moving on. That can produce short-term completion while destroying long-term ability to solve the next variant.",
          )}
        </p>
        <p>
          {t(
            "Another weak pattern is endless re-explanation. If the third paraphrase still does not stick, switch methods: draw the idea, solve a tiny example, or teach it out loud. More text is not always more learning.",
          )}
        </p>
      </GuideSection>

      <GuideCallout title={t("Study session checklist")}>
        <GuideList
          items={[
            t("What exactly am I trying to be able to do after this session?"),
            t("Have I attempted an answer or solution before asking the model?"),
            t("Can I explain the idea without looking at the chat?"),
            t("Which claims should I verify in a textbook, paper, or official docs?"),
            t("What practice item will I do next without AI help?"),
          ]}
        />
      </GuideCallout>

      <GuideSection title={t("Subject-specific tips")}>
        <p>
          {t(
            "Languages: ask for corrections with rule labels, then rewrite the sentence yourself. Request common learner mistakes for the grammar point you are practicing.",
          )}
        </p>
        <p>
          {t(
            "Programming: describe the bug and your hypothesis before pasting code. After a fix suggestion, re-implement it from understanding and run tests. Treat untested snippets as untrusted.",
          )}
        </p>
        <p>
          {t(
            "Exams and essays: use AI to generate outlines, counterarguments, and practice prompts. Write the final answer yourself. Institutions often care about process and originality, not only final polish.",
          )}
        </p>
      </GuideSection>

      <GuideSection title={t("Why multi-model study can help")}>
        <p>
          {t(
            "One model can explain a concept simply. Another can quiz you more aggressively. A third can critique your essay structure. The value is role separation, not collecting many similar summaries.",
          )}
        </p>
        <p>
          {t(
            "If two explanations disagree, treat that as a signal to check a reliable source. Disagreement is a feature when it prevents you from memorizing a polished mistake.",
          )}
        </p>
      </GuideSection>
    </GuideArticle>
  );
}

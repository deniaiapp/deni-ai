import { Link } from "@/lib/navigation";
import { useExtracted, useLocale } from "use-intl";
import { createFileRoute } from "@tanstack/react-router";
import { getExtracted } from "@deniai/i18n/extracted";
import { localizedPath } from "@/lib/locale-path";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/{-$locale}/faq")({
  head: ({ match }) => {
    const { intl } = match.context;
    const t = getExtracted(intl);
    const title = t("FAQ");
    const description = t(
      "Answers about Deni AI and Deni Chat: how to open the site, desktop app vs APK, free access, models, privacy, billing, and teams.",
    );

    return pageHead({
      title,
      description,
      alternates: { path: "/faq", locale: intl.locale },
      openGraph: {
        title: `${title} — Deni AI`,
        description,
      },
      twitter: {
        title: `${title} | Deni AI`,
        description,
      },
    });
  },
  component: FaqPage,
});

function FaqPage() {
  const t = useExtracted();
  const locale = useLocale();

  const groups = [
    {
      title: t("Product basics"),
      items: [
        {
          question: t("What is Deni AI?"),
          answer: t(
            "Deni AI is a multi-model AI chat workspace. Instead of opening separate apps for different providers, you can switch between model families in one interface for writing, research, coding, translation, and planning.",
          ),
        },
        {
          question: t("Is Deni Chat the same as Deni AI?"),
          answer: t(
            "Yes. Deni Chat is the chat workspace of Deni AI. Both names refer to the same free multi-model AI chat site at deniai.app, with GPT, Claude, Gemini, and other models in one place.",
          ),
        },
        {
          question: t("Is there a Deni Chat APK or Android app?"),
          answer: t(
            "Deni Chat runs in the browser on any phone, so you do not need an APK. The official installable app is the Deni AI desktop app for Windows and macOS at deniai.app/desktop. Avoid third-party APK sites that claim to offer Deni Chat for Android.",
          ),
        },
        {
          question: t("Who is Deni AI for?"),
          answer: t(
            "It is for people who use AI repeatedly in real work or study: students, developers, founders, operators, writers, and small teams that want model choice without managing many separate subscriptions day to day.",
          ),
        },
        {
          question: t("Is Deni AI free to try?"),
          answer: t(
            "Yes. Free access is available with usage limits. Paid plans expand capacity and unlock higher-cost models.",
          ),
        },
        {
          question: t("How is Deni AI different from a single-model chatbot?"),
          answer: t(
            "A single-model app forces every task through one strength profile. Deni AI is designed for practical switching: fast models for exploration, stronger reasoning for high-stakes work, and coding-focused models when implementation detail matters.",
          ),
        },
      ],
    },
    {
      title: t("Models and quality"),
      items: [
        {
          question: t("Which AI models can I use?"),
          answer: t(
            "The model picker in chat lists the available models. They include major families such as GPT, Claude, Gemini and Grok, and the list changes as providers release updates.",
          ),
        },
        {
          question: t("How should I choose a model?"),
          answer: t(
            "Start from the task and the cost of being wrong. Use a fast model for low-risk drafting, a stronger reasoning model when assumptions matter, and a coding-capable model when output must fit a real codebase.",
          ),
        },
        {
          question: t("Should I trust every AI answer?"),
          answer: t(
            "No. Treat AI output as a draft. Verify facts, recalculate numbers, test code, and rewrite important text in your own words before you publish, send, or ship it.",
          ),
        },
      ],
    },
    {
      title: t("Privacy, accounts, and billing"),
      items: [
        {
          question: t("Do you use my chats to train models?"),
          answer: t(
            "We do not use your conversations to train our own models. Account, usage, billing, and submitted content may still be processed to operate the service, secure accounts, and prevent abuse. Details are in the privacy policy.",
          ),
        },
        {
          question: t("How does billing work?"),
          answer: t(
            "Paid plans are charged according to the selected offer and payment method shown at checkout. Digital services are generally non-refundable once access is delivered, as described in the commercial disclosure and terms.",
          ),
        },
        {
          question: t("Is there a team plan?"),
          answer: t(
            "Yes. Teams can subscribe to Pro for Teams with per-seat billing, shared access, usage visibility, and a consistent workspace so members do not need separate personal tools for the same workflow.",
          ),
        },
      ],
    },
    {
      title: t("Responsible use"),
      items: [
        {
          question: t("What should I not put into AI chat?"),
          answer: t(
            "Avoid pasting secrets, credentials, confidential personal data, or regulated information unless you understand the privacy policy, your own compliance rules, and the risk of putting that material into any third-party system.",
          ),
        },
        {
          question: t("Can Deni AI replace professional advice?"),
          answer: t(
            "No. AI can help draft questions, summarize options, and organize notes, but legal, medical, financial, and safety-critical decisions still need qualified human judgment and verified sources.",
          ),
        },
      ],
    },
  ];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: groups.flatMap((group) =>
      group.items.map((item) => ({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: item.answer,
        },
      })),
    ),
  };

  return (
    <main id="main-content" className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 md:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />

      <h1 className="text-3xl font-semibold text-balance">{t("Frequently asked questions")}</h1>

      <div className="mt-10 flex flex-col gap-12">
        {groups.map((group) => (
          <section key={group.title}>
            <h2 className="text-lg font-semibold">{group.title}</h2>
            <dl className="mt-4 divide-y divide-border border-y border-border">
              {group.items.map((item) => (
                <div key={item.question} className="py-4">
                  <dt className="text-sm font-medium">{item.question}</dt>
                  <dd className="mt-1.5 text-sm text-muted-foreground">{item.answer}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>

      <p className="mt-12 text-sm text-muted-foreground">
        {t("Question not answered here?")}{" "}
        <Link
          href={localizedPath("/contact", locale)}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {t("Contact us")}
        </Link>
      </p>
    </main>
  );
}

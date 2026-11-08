import { Link } from "@/lib/navigation";
import { ArrowRight, CircleHelp } from "lucide-react";
import { useExtracted } from "use-intl";
import { createFileRoute } from "@tanstack/react-router";
import { getExtracted } from "@/i18n/extracted";
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
  const headline = t("Frequently asked questions");
  const description = t(
    "This FAQ explains how Deni AI works, what is free, how model choice works, and what you should know about privacy and responsible use before you open a chat.",
  );

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
            "Yes. Free access is available with usage limits. Paid plans expand capacity and unlock higher-cost models. The public site explains features, use cases, and policies before you create an account.",
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
            "Supported model families are listed on the Models page and can change as providers release updates. The product goal is practical access to major families such as GPT, Claude, Gemini, Grok, and other capable models, not a static logo wall.",
          ),
        },
        {
          question: t("How should I choose a model?"),
          answer: t(
            "Start from the task and the cost of being wrong. Use a fast model for low-risk drafting, a stronger reasoning model when assumptions matter, and a coding-capable model when output must fit a real codebase. See the model selection guide for a full workflow.",
          ),
        },
        {
          question: t("Should I trust every AI answer?"),
          answer: t(
            "No. Treat AI output as a draft. Verify facts, recalculate numbers, test code, and rewrite important text in your own words before you publish, send, or ship it. The verification guide explains a practical review routine.",
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
        {
          question: t("Where can I learn good multi-model habits?"),
          answer: t(
            "Read the AI Guides. They cover model selection, verification, prompt patterns, privacy, and study.",
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
    <main className="min-h-screen bg-background" id="main-content">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />

      <section className="px-4 pb-12 pt-32 md:pb-16 md:pt-40">
        <div className="mx-auto max-w-3xl">
          <div className="mb-5 inline-flex size-11 items-center justify-center rounded-2xl bg-secondary">
            <CircleHelp className="size-5" />
          </div>
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
            {t("FAQ")}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
            {headline}
          </h1>
          <p className="mt-6 text-base leading-8 text-muted-foreground">{description}</p>
        </div>
      </section>

      <section className="px-4 pb-20 md:pb-28">
        <div className="mx-auto max-w-3xl space-y-12">
          {groups.map((group) => (
            <div key={group.title}>
              <h2 className="text-2xl font-semibold tracking-tight">{group.title}</h2>
              <div className="mt-6 space-y-4">
                {group.items.map((item) => (
                  <article
                    key={item.question}
                    className="rounded-[1.5rem] border border-border/70 bg-card p-6"
                  >
                    <h3 className="text-lg font-semibold tracking-tight">{item.question}</h3>
                    <p className="mt-3 text-sm leading-7 text-muted-foreground">{item.answer}</p>
                  </article>
                ))}
              </div>
            </div>
          ))}

          <div className="rounded-[1.5rem] border border-border/70 bg-secondary/20 p-6 md:p-8">
            <h2 className="text-xl font-semibold tracking-tight">{t("Still need help?")}</h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              {t(
                "If your question is not covered here, contact us or read the longer guides on model choice, verification, and multi-model workflows.",
              )}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/contact"
                className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-secondary"
              >
                {t("Contact")}
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/desktop"
                className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-secondary"
              >
                {t("Download desktop app")}
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/guides"
                className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-secondary"
              >
                {t("AI Guides")}
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

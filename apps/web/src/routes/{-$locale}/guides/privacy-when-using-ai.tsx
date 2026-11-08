import { EyeOff, FileWarning, KeyRound, Shield } from "lucide-react";
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

export const Route = createFileRoute("/{-$locale}/guides/privacy-when-using-ai")({
  head: ({ match }) => {
    const { intl } = match.context;
    const t = getExtracted(intl);
    const title = t("Privacy habits for everyday AI chat");
    const description = t(
      "Practical privacy guidance for using AI chat tools: what not to paste, how to reduce risk, and how to think about accounts, keys, and sensitive work.",
    );

    return pageHead({
      title,
      description,
      alternates: { path: "/guides/privacy-when-using-ai", locale: intl.locale },
      openGraph: {
        title: `${title} — Deni AI Guides`,
        description,
      },
    });
  },
  component: PrivacyWhenUsingAiGuidePage,
});

function PrivacyWhenUsingAiGuidePage() {
  const t = useExtracted();
  const headline = t("Privacy habits for everyday AI chat");
  const description = t(
    "AI chat is convenient because it accepts almost any text. That same convenience is why privacy needs habits. The goal is not fear. The goal is to keep sensitive material out of places that do not need it.",
  );

  const habits = [
    {
      icon: EyeOff,
      title: t("Minimize before you paste"),
      body: t(
        "Remove names, account numbers, secrets, internal URLs, and anything not required for the task. A redacted example is often enough for debugging or rewriting help.",
      ),
    },
    {
      icon: FileWarning,
      title: t("Separate private and public work"),
      body: t(
        "Do not mix personal health details, customer data, and casual brainstorming in one unbounded habit. Create a mental rule: if this text would be uncomfortable in a support ticket, rethink pasting it.",
      ),
    },
    {
      icon: KeyRound,
      title: t("Keep credentials out of prompts"),
      body: t(
        "API keys, passwords, session cookies, private keys, and recovery codes should never be pasted into chat. If a model needs a shape for a secret, use placeholders.",
      ),
    },
    {
      icon: Shield,
      title: t("Read the policy that matches your risk"),
      body: t(
        "Before high-risk use, read the product privacy policy and your own organization rules. Consumer convenience defaults are not the same as enterprise compliance requirements.",
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
    mainEntityOfPage: "https://deniai.app/guides/privacy-when-using-ai",
  };

  return (
    <GuideArticle
      breadcrumbLabel={t("AI Guides")}
      headline={headline}
      description={description}
      jsonLd={jsonLd}
      nextLinks={[
        { href: "/legal/privacy-policy", label: t("Read Deni AI privacy policy") },
        { href: "/contact", label: t("Contact") },
      ]}
    >
      <GuideCardGrid items={habits} />

      <GuideSection title={t("A practical risk ladder")}>
        <p>
          {t(
            "Low risk: public blog drafts, generic study questions, and synthetic examples. Medium risk: internal process docs with no personal data. High risk: customer records, health information, financial account details, unreleased security findings, and anything covered by a confidentiality agreement.",
          )}
        </p>
        <p>
          {t(
            "Match tools to risk. High-risk material may need approved enterprise systems, local tooling, or no AI assistance at all. Convenience is not a policy exception.",
          )}
        </p>
      </GuideSection>

      <GuideSection title={t("What to do instead of pasting secrets")}>
        <p>
          {t(
            "Replace real identifiers with stable fake values. Keep a local mapping file that never enters the chat. Ask the model to operate on the redacted version, then reapply real values yourself.",
          )}
        </p>
        <p>
          {t(
            "For code, share the failing function and the error type without environment files or tokens. For support drafts, describe the issue category without dumping the full customer record.",
          )}
        </p>
      </GuideSection>

      <GuideCallout title={t("Privacy checklist before you hit send")}>
        <GuideList
          items={[
            t("Does this text include passwords, keys, cookies, or recovery codes?"),
            t("Does it include personal data that is not required for the task?"),
            t("Would I be comfortable if this text appeared in a support review later?"),
            t("Is there a redacted example that would work just as well?"),
            t("Do my employer or school rules restrict this kind of upload?"),
          ]}
        />
      </GuideCallout>

      <GuideSection title={t("Accounts, keys, and shared devices")}>
        <p>
          {t(
            "Use a password manager and enable available account protections. On shared computers, sign out after sensitive sessions and avoid leaving long chat histories visible on screen.",
          )}
        </p>
        <p>
          {t(
            "Treat provider API keys like production secrets. Store them in your provider's secret manager, rotate them if exposure is possible, and never send them in prompts or include them in screenshots.",
          )}
        </p>
      </GuideSection>

      <GuideSection title={t("How Deni AI approaches this")}>
        <p>
          {t(
            "Deni AI publishes a privacy policy explaining what account, usage, billing, and submitted content data may be processed to run the service, secure accounts, and prevent abuse. We do not use your conversations to train our own models.",
          )}
        </p>
        <p>
          {t(
            "That statement does not replace good user habits. Even in a careful product, the safest data is the data you never needed to paste. Combine product policy with personal redaction discipline.",
          )}
        </p>
      </GuideSection>
    </GuideArticle>
  );
}

import { HOME_ALTERNATE_NAMES } from "@/lib/seo";
import { useExtracted } from "use-intl";
import { ClientHome } from "./home-client";

function HomeJsonLd() {
  const t = useExtracted();
  const webApplicationDescription = t(
    "Open Deni Chat in your browser. Deni AI gives you GPT, Claude, Gemini and more in one free workspace.",
  );
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "Deni AI",
      alternateName: [...HOME_ALTERNATE_NAMES],
      url: "https://deniai.app",
      description: webApplicationDescription,
      applicationCategory: "UtilitiesApplication",
      operatingSystem: "Web, Windows, macOS",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: t("Is Deni Chat the same as Deni AI?"),
          acceptedAnswer: {
            "@type": "Answer",
            text: t(
              "Yes. Deni Chat is the chat workspace of Deni AI. Both names refer to the same free multi-model AI chat site at deniai.app, with GPT, Claude, Gemini, and other models in one place.",
            ),
          },
        },
        {
          "@type": "Question",
          name: t("Is there a Deni Chat APK or Android app?"),
          acceptedAnswer: {
            "@type": "Answer",
            text: t(
              "Deni Chat runs in the browser on any phone, so you do not need an APK. The official installable app is the Deni AI desktop app for Windows and macOS at deniai.app/desktop. Avoid third-party APK sites that claim to offer Deni Chat for Android.",
            ),
          },
        },
        {
          "@type": "Question",
          name: t("What makes Deni AI different from a single-model chat app?"),
          acceptedAnswer: {
            "@type": "Answer",
            text: t(
              "Deni AI lets people compare and switch between multiple providers in one place so they can choose the model that fits the task.",
            ),
          },
        },
        {
          "@type": "Question",
          name: t("Who is Deni AI for?"),
          acceptedAnswer: {
            "@type": "Answer",
            text: t(
              "Deni AI is for people who use AI repeatedly in real workflows, including developers, founders, students, operators, and teams.",
            ),
          },
        },
        {
          "@type": "Question",
          name: t("Is Deni AI free to try?"),
          acceptedAnswer: {
            "@type": "Answer",
            text: t(
              "Yes. Free access is available with usage limits, and the public site explains features, guides, privacy, and policies before signup.",
            ),
          },
        },
        {
          "@type": "Question",
          name: t("Where can I learn good multi-model habits?"),
          acceptedAnswer: {
            "@type": "Answer",
            text: t(
              "The AI Guides cover model selection, answer verification, bilingual writing, when not to use AI, and practical multi-model habits.",
            ),
          },
        },
      ],
    },
  ];

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
    />
  );
}

export function HomePage() {
  return (
    <>
      <HomeJsonLd />
      <ClientHome />
    </>
  );
}

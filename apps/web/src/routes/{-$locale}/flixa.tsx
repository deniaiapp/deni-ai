import { Link } from "@/lib/navigation";
import { useExtracted, useLocale } from "use-intl";
import { createFileRoute } from "@tanstack/react-router";
import { getExtracted } from "@deniai/i18n/extracted";
import { Button } from "@deniai/ui/components/button";
import { pageHead } from "@/lib/seo";
import { supportUrl } from "@/lib/support-url";

export const Route = createFileRoute("/{-$locale}/flixa")({
  head: ({ match }) => {
    const { intl } = match.context;
    const t = getExtracted(intl);
    const title = t("Flixa — AI coding agent for VS Code and Cursor");
    const description = t(
      "Flixa is Deni AI's coding agent for VS Code, Cursor, Windsurf and Antigravity. Install the extension from the VS Code Marketplace or Open VSX.",
    );

    return pageHead({
      title,
      description,
      alternates: { path: "/flixa", locale: intl.locale },
      openGraph: {
        title: `${title} by Deni AI`,
        description,
      },
    });
  },
  component: FlixaPage,
});

const flixaJsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Flixa",
    alternateName: ["Flixa by Deni AI", "flixa.com"],
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Windows, macOS, Linux",
    url: "https://deniai.app/flixa",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    description:
      "AI coding agent extension for VS Code, Cursor, and Windsurf. Provides intelligent code completion, refactoring, and natural language commands.",
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "What is Flixa?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Flixa is an AI coding agent extension by Deni AI. It provides intelligent code completion, instant refactoring, and natural language commands directly inside your IDE.",
        },
      },
      {
        "@type": "Question",
        name: "Where is the official Flixa website?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "The official Flixa page is https://deniai.app/flixa. Flixa is a Deni AI product for VS Code, Cursor, and Windsurf — there is no separate flixa.com download site.",
        },
      },
      {
        "@type": "Question",
        name: "Which IDEs does Flixa support?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Flixa is available for VS Code (via the official marketplace), Cursor, Windsurf, and Antigravity (via Open VSX Registry).",
        },
      },
      {
        "@type": "Question",
        name: "Is Flixa free?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Yes, Flixa is powered by Deni AI and is free to use.",
        },
      },
    ],
  },
];

const VS_CODE_MARKETPLACE_URL = "https://marketplace.visualstudio.com/items?itemName=deniai.flixa";
const OPEN_VSX_URL = "https://open-vsx.org/extension/deniai/flixa";

function FlixaPage() {
  const t = useExtracted();
  const locale = useLocale();

  const editors = [
    { name: "VS Code", source: "Visual Studio Marketplace", href: VS_CODE_MARKETPLACE_URL },
    { name: "Cursor", source: "Open VSX", href: OPEN_VSX_URL },
    { name: "Windsurf", source: "Open VSX", href: OPEN_VSX_URL },
    { name: "Antigravity", source: "Open VSX", href: OPEN_VSX_URL },
  ];

  const steps = [
    t("Open the Extensions view in your editor and search for “Flixa”, or use a link below."),
    t("Install the extension published by deniai."),
    t("Open Flixa in the editor and sign in with your Deni AI account when asked."),
    t("Describe the change you want; Flixa reads your project and edits the files."),
  ];

  return (
    <main id="main-content" className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 md:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(flixaJsonLd).replace(/</g, "\\u003c") }}
      />

      <h1 className="text-3xl font-semibold text-balance">Flixa</h1>
      <p className="mt-4 max-w-[60ch] text-base text-muted-foreground">
        {t(
          "Flixa is Deni AI's coding agent. It runs as an extension in VS Code, Cursor, Windsurf and Antigravity and signs in with your Deni AI account.",
        )}
      </p>
      <div className="mt-6">
        <Button
          render={<Link href={VS_CODE_MARKETPLACE_URL} target="_blank" rel="noopener noreferrer" />}
          nativeButton={false}
        >
          {t("Install for VS Code")}
        </Button>
      </div>

      <section aria-labelledby="flixa-install" className="mt-12">
        <h2 id="flixa-install" className="text-lg font-semibold">
          {t("Install and use")}
        </h2>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="flixa-editors" className="mt-12">
        <h2 id="flixa-editors" className="text-lg font-semibold">
          {t("Editors")}
        </h2>
        <ul className="mt-4 divide-y divide-border border-y border-border">
          {editors.map((editor) => (
            <li key={editor.name} className="flex items-center justify-between gap-4 py-3 text-sm">
              <span className="font-medium">{editor.name}</span>
              <Link
                href={editor.href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline-offset-4 hover:underline"
              >
                {editor.source}
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-muted-foreground">
          {t("Using Claude Code, Codex, Zed, or opencode?")}{" "}
          <Link
            href={supportUrl(locale, "/flixa/external-tools")}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("Set up Flixa in your coding tool")}
          </Link>
        </p>
      </section>
    </main>
  );
}

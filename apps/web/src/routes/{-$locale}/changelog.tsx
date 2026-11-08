import { useExtracted, useLocale } from "use-intl";
import { createFileRoute } from "@tanstack/react-router";
import { getExtracted } from "@deniai/i18n/extracted";
import { changelogEntries } from "@/lib/changelog";
import { formatAppDate } from "@/lib/format-date";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/{-$locale}/changelog")({
  head: ({ match }) => {
    const { intl } = match.context;
    const t = getExtracted(intl);
    const title = t("Changelog");
    const description = t(
      "Release notes for Deni AI: new models, team tools, billing, and chat workspace updates.",
    );

    return pageHead({
      title,
      description,
      alternates: { path: "/changelog", locale: intl.locale },
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
  component: ChangelogPage,
});

function ChangelogPage() {
  const t = useExtracted();
  const locale = useLocale();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Deni AI Changelog",
    itemListElement: changelogEntries.map((entry, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: `Deni AI ${entry.version}`,
      description: entry.summary,
    })),
  };

  return (
    <main id="main-content" className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 md:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <h1 className="text-3xl font-semibold text-balance">{t("Changelog")}</h1>
      <p className="mt-4 max-w-[60ch] text-base text-muted-foreground">
        {t("Deni AI releases, newest first.")}
      </p>

      <ol className="mt-10 flex flex-col gap-10">
        {changelogEntries.map((entry) => (
          <li key={entry.version}>
            <article>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-lg font-semibold">
                  {entry.version}
                  {entry.codename ? ` · ${entry.codename}` : ""}
                </h2>
                <time className="text-sm text-muted-foreground" dateTime={entry.date}>
                  {formatAppDate(entry.date, locale)}
                </time>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{entry.summary}</p>
              <ul className="mt-4 flex flex-col gap-3 border-l border-border pl-4">
                {entry.highlights.map((highlight) => (
                  <li key={highlight.title}>
                    <p className="text-sm font-medium">{highlight.title}</p>
                    <p className="text-sm text-muted-foreground">{highlight.body}</p>
                  </li>
                ))}
              </ul>
            </article>
          </li>
        ))}
      </ol>
    </main>
  );
}

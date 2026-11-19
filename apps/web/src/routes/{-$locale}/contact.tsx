import { Link } from "@/lib/navigation";
import { useExtracted, useLocale } from "use-intl";
import { createFileRoute } from "@tanstack/react-router";
import { getExtracted } from "@deniai/i18n/extracted";
import { localizedPath } from "@/lib/locale-path";
import { pageHead } from "@/lib/seo";
import { supportUrl } from "@/lib/support-url";

export const Route = createFileRoute("/{-$locale}/contact")({
  head: ({ match }) => {
    const { intl } = match.context;
    const t = getExtracted(intl);
    const title = t("Contact");
    const description = t(
      "Contact Deni AI for product questions, privacy requests, billing issues, and partnership inquiries.",
    );

    return pageHead({
      title,
      description,
      alternates: { path: "/contact", locale: intl.locale },
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
  component: ContactPage,
});

function ContactPage() {
  const t = useExtracted();
  const locale = useLocale();
  const headline = t("Contact Deni AI");
  const description = t(
    "Email contact@deniai.app for account questions, billing issues, privacy requests and partnership inquiries.",
  );

  const tips = [
    t("Include the email address on the account when the issue is account-specific."),
    t("Describe what you expected, what happened, and any error message you saw."),
    t(
      "For privacy requests, state whether you want access, correction, export, or deletion guidance.",
    ),
    t(
      "For billing questions, include the approximate purchase date and the plan name if you know it.",
    ),
  ];

  const links = [
    { href: supportUrl(locale), label: t("Help Center") },
    { href: localizedPath("/faq", locale), label: t("FAQ") },
    { href: localizedPath("/legal/privacy-policy", locale), label: t("Privacy Policy") },
    { href: localizedPath("/legal/terms", locale), label: t("Terms of Service") },
    { href: localizedPath("/legal/tokusho", locale), label: t("特定商取引法") },
  ];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ContactPage",
    name: headline,
    description,
    url: "https://deniai.app/contact",
    mainEntity: {
      "@type": "Organization",
      name: "Deni AI",
      url: "https://deniai.app",
      email: "contact@deniai.app",
    },
  };

  return (
    <main id="main-content" className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 md:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      <h1 className="text-3xl font-semibold text-balance">{headline}</h1>
      <p className="mt-4 max-w-[60ch] text-base text-muted-foreground">{description}</p>
      <p className="mt-6">
        <a
          href="mailto:contact@deniai.app"
          className="text-base font-medium text-primary underline-offset-4 hover:underline"
        >
          contact@deniai.app
        </a>
      </p>

      <section aria-labelledby="contact-tips" className="mt-12">
        <h2 id="contact-tips" className="text-lg font-semibold">
          {t("What to include")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t(
            "We do not need passwords or full chat exports for most requests. Share only the details needed to identify the issue.",
          )}
        </p>
        <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm">
          {tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="contact-links" className="mt-12">
        <h2 id="contact-links" className="text-lg font-semibold">
          {t("Help and policies")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t(
            "Commercial disclosure for Japan, including operator and payment information, is on the 特定商取引法 page.",
          )}
        </p>
        <ul className="mt-4 flex flex-col gap-2 text-sm">
          {links.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="text-primary underline-offset-4 hover:underline">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

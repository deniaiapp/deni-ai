import { Link } from "@/lib/navigation";
import { Mail, MapPin, MessagesSquare, Shield } from "lucide-react";
import { useExtracted } from "use-intl";
import { createFileRoute } from "@tanstack/react-router";
import { getExtracted } from "@/i18n/extracted";
import { pageHead } from "@/lib/seo";

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
  const headline = t("Contact Deni AI");
  const description = t(
    "Use this page when you need a human response about the product, privacy, billing, or commercial disclosure. We keep support simple: one clear email address and public documentation for common questions.",
  );

  const channels = [
    {
      icon: Mail,
      title: t("Email support"),
      body: t(
        "Write to contact@deniai.app for account questions, billing issues, privacy requests, partnership notes, and commercial disclosure requests.",
      ),
      detail: "contact@deniai.app",
      href: "mailto:contact@deniai.app",
    },
    {
      icon: MessagesSquare,
      title: t("Self-serve answers"),
      body: t(
        "Many product questions are already answered in the FAQ, AI Guides, Use Cases, Terms, and Privacy Policy. Start there if you need an immediate explanation.",
      ),
      detail: t("Browse FAQ and guides"),
      href: "/faq",
    },
    {
      icon: Shield,
      title: t("Privacy and legal"),
      body: t(
        "For data handling, account security, or legal terms, review the privacy policy and terms first, then email us with the relevant account address and request type.",
      ),
      detail: t("Open privacy policy"),
      href: "/legal/privacy-policy",
    },
  ];

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
    <main className="min-h-screen bg-background" id="main-content">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />

      <section className="px-4 pb-12 pt-32 md:pb-16 md:pt-40">
        <div className="mx-auto max-w-3xl">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
            {t("Contact")}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
            {headline}
          </h1>
          <p className="mt-6 text-base leading-8 text-muted-foreground">{description}</p>
        </div>
      </section>

      <section className="px-4 pb-12">
        <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-3">
          {channels.map((channel) => {
            const Icon = channel.icon;
            return (
              <article
                key={channel.title}
                className="rounded-[1.5rem] border border-border/70 bg-card p-6"
              >
                <div className="inline-flex size-11 items-center justify-center rounded-2xl bg-secondary">
                  <Icon className="size-5" />
                </div>
                <h2 className="mt-5 text-xl font-semibold tracking-tight">{channel.title}</h2>
                <p className="mt-3 text-sm leading-7 text-muted-foreground">{channel.body}</p>
                <Link
                  href={channel.href}
                  className="mt-5 inline-flex text-sm font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {channel.detail}
                </Link>
              </article>
            );
          })}
        </div>
      </section>

      <section className="px-4 pb-20 md:pb-28">
        <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-[1.2fr_0.8fr]">
          <article className="rounded-[1.5rem] border border-border/70 bg-card p-6 md:p-8">
            <h2 className="text-2xl font-semibold tracking-tight">
              {t("How to get a useful reply faster")}
            </h2>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">
              {t(
                "Clear context helps us respond accurately. We do not need passwords or full chat exports for most requests. Share only the minimum details needed to identify the issue.",
              )}
            </p>
            <ul className="mt-6 space-y-3 text-sm leading-7 text-muted-foreground">
              {tips.map((tip) => (
                <li key={tip} className="flex gap-3">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground/50" />
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="rounded-[1.5rem] border border-border/70 bg-secondary/20 p-6 md:p-8">
            <div className="inline-flex size-11 items-center justify-center rounded-2xl bg-secondary">
              <MapPin className="size-5" />
            </div>
            <h2 className="mt-5 text-xl font-semibold tracking-tight">{t("Operator details")}</h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              {t(
                "Commercial disclosure for Japan, including operator and payment information, is published on the designated commercial transactions page.",
              )}
            </p>
            <Link
              href="/legal/tokusho"
              className="mt-5 inline-flex text-sm font-medium underline-offset-4 hover:underline"
            >
              {t("特定商取引法")}
            </Link>
            <p className="mt-6 text-sm leading-7 text-muted-foreground">
              {t("Primary contact email:")}{" "}
              <a
                href="mailto:contact@deniai.app"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                contact@deniai.app
              </a>
            </p>
          </article>
        </div>
      </section>
    </main>
  );
}

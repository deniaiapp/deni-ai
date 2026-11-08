import { createFileRoute, Link } from "@tanstack/react-router";
import { headTranslator } from "@/i18n/head";
import { useExtracted } from "@/i18n/react";
import { PublicLayout } from "@/components/marketing/public-layout";

export const Route = createFileRoute("/integrations/slack-screenshots")({
  head: ({ matches }) => {
    const t = headTranslator(matches);
    return {
      meta: [
        { title: t("Deni Run for Slack: screenshots") },
        { name: "description", content: t("Screenshots of installing Deni Run in Slack and using it, from sign-in to an approved message.") },
      ],
    };
  },
  component: SlackScreenshotsPage,
});

// Files live in public/marketplace/slack so each image also has a stable URL of its own.
const shots = ["01-landing", "02-slack-authorize", "03-summarize-channel", "04-approval-card", "05-message-sent", "06-posted-in-slack"] as const;

function SlackScreenshotsPage() {
  const t = useExtracted();
  const captions: Record<(typeof shots)[number], string> = {
    "01-landing": t("Start from the Slack page and choose Add to Slack."),
    "02-slack-authorize": t("Slack asks you to allow access. Deni Run never sees your password."),
    "03-summarize-channel": t("Ask a teammate to summarize a channel. Reading runs without interrupting you."),
    "04-approval-card": t("Before anything is posted, you see the channel and the full message, and approve it."),
    "05-message-sent": t("After you approve, the teammate posts it and links to the message."),
    "06-posted-in-slack": t("The message appears in Slack under your name."),
  };
  return (
    <PublicLayout>
      <article className="deni-rise mx-auto max-w-5xl space-y-10 px-6 pb-16 pt-6">
        <div className="space-y-2">
          <Link to="/integrations/slack" className="text-xs text-muted-foreground hover:text-foreground">
            {t("Deni Run for Slack")}
          </Link>
          <h1 className="text-2xl font-semibold">{t("Screenshots")}</h1>
        </div>
        {shots.map((shot, index) => (
          <figure key={shot} className="space-y-3">
            <a href={`/marketplace/slack/${shot}.png`} target="_blank" rel="noreferrer">
              <img
                src={`/marketplace/slack/${shot}.png`}
                alt={captions[shot]}
                width={1600}
                height={1000}
                loading={index < 2 ? "eager" : "lazy"}
                className="h-auto w-full rounded-xl border border-foreground/10"
              />
            </a>
            <figcaption className="text-sm text-secondary-foreground">
              {index + 1}. {captions[shot]}
            </figcaption>
          </figure>
        ))}
      </article>
    </PublicLayout>
  );
}

import { Link } from "@/lib/navigation";
import {
  BookOpenText,
  BrainCircuit,
  CheckCircle2,
  CircleHelp,
  Newspaper,
  ShieldCheck,
} from "lucide-react";
import { useExtracted } from "use-intl";

export function HomeTrustSection() {
  const t = useExtracted();

  const trustSignals = [
    {
      icon: ShieldCheck,
      title: t("Private by design"),
      description: t(
        "Your conversations are treated as your workspace content. We do not use chats to train our own models, and account controls are available inside the app.",
      ),
    },

    {
      icon: CheckCircle2,
      title: t("Transparent limits"),
      description: t(
        "The product explains usage limits and model cost differences so visitors can understand what changes between free and paid access.",
      ),
    },
  ];

  const resources = [
    {
      href: "/blog/chatgpt-vs-claude-vs-gemini",
      icon: Newspaper,
      title: t("ChatGPT vs Claude vs Gemini: how we pick for daily work"),
      description: t("A practical comparison based on task failure modes, not brand loyalty."),
    },
    {
      href: "/guides",
      icon: BookOpenText,
      title: t("Practical AI guides for everyday decisions"),
      description: t(
        "Evergreen methods for model choice, verification, prompt patterns, study, and privacy.",
      ),
    },
    {
      href: "/faq",
      icon: CircleHelp,
      title: t("Frequently asked questions"),
      description: t(
        "Clear answers about free access, models, privacy, billing, teams, and responsible use.",
      ),
    },
  ];

  return (
    <>
      <section className="relative px-4 py-24 md:py-28">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
              {t("Trust and access")}
            </p>
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
              {t("Useful AI should be understandable before you sign in")}
            </h2>
            <p className="mt-5 text-sm leading-7 text-muted-foreground">
              {t(
                "Visitors can read what the product does, review the available model families, check legal policies, and understand privacy expectations before opening the chat workspace.",
              )}
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {trustSignals.map((signal) => (
              <article
                key={signal.title}
                className="rounded-[1.5rem] border border-border/70 bg-card p-6"
              >
                <div className="mb-4 inline-flex size-10 items-center justify-center rounded-2xl bg-secondary">
                  <signal.icon className="size-5" />
                </div>
                <h3 className="text-lg font-semibold">{signal.title}</h3>
                <p className="mt-3 text-sm leading-7 text-muted-foreground">{signal.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="relative border-y border-border/50 bg-secondary/20 px-4 py-24 md:py-28">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
              {t("Public resources")}
            </p>
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
              {t("Learn useful AI habits before you open the chat")}
            </h2>
            <p className="mt-5 text-sm leading-7 text-muted-foreground">
              {t(
                "Deni AI publishes a public blog and original guides for model selection, answer verification, multi-model workflows, study practice, and privacy. These pages are meant to help even if you use another tool.",
              )}
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {resources.map((resource) => {
              const Icon = resource.icon;
              return (
                <Link
                  key={resource.href}
                  href={resource.href}
                  className="rounded-[1.5rem] border border-border/70 bg-card p-6 transition-transform hover:-translate-y-1"
                >
                  <Icon className="size-5 text-primary" />
                  <h3 className="mt-5 text-lg font-semibold">{resource.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-muted-foreground">
                    {resource.description}
                  </p>
                </Link>
              );
            })}
          </div>

          <div className="mt-8 flex flex-wrap gap-5">
            <Link href="/blog" className="text-sm font-medium underline-offset-4 hover:underline">
              {t("Browse the blog")}
            </Link>
            <Link href="/guides" className="text-sm font-medium underline-offset-4 hover:underline">
              {t("Browse all AI guides")}
            </Link>
          </div>
        </div>
      </section>

      <section className="relative px-4 py-24 md:py-28">
        <div className="mx-auto grid max-w-6xl gap-5 md:grid-cols-2">
          <Link
            href="/use-cases"
            className="rounded-[1.5rem] border border-border/70 bg-card p-6 transition-transform hover:-translate-y-1"
          >
            <BookOpenText className="size-5 text-primary" />
            <h3 className="mt-5 text-xl font-semibold">{t("Read a few examples")}</h3>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              {t("See a few simple examples of how Deni AI can help with everyday personal use.")}
            </p>
          </Link>
          <Link
            href="/chat"
            className="rounded-[1.5rem] border border-border/70 bg-card p-6 transition-transform hover:-translate-y-1"
          >
            <BrainCircuit className="size-5 text-primary" />
            <h3 className="mt-5 text-xl font-semibold">{t("Jump into chat")}</h3>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              {t("If you already know what you want to ask, you can open chat and start there.")}
            </p>
          </Link>
        </div>
      </section>
    </>
  );
}

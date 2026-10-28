import React from "react";
import { m } from "motion/react";
import { BellRing, Feather, Workflow } from "lucide-react";
import { useExtracted } from "use-intl";

function FeatureCard({
  icon: Icon,
  title,
  description,
  delay = 0,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  delay?: number;
}) {
  return (
    <m.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay }}
      className="group relative rounded-2xl border border-border bg-card/20 p-6 backdrop-blur-sm transition-[translate,box-shadow,background-color] hover:-translate-y-1 hover:bg-card hover:shadow-xl"
    >
      <div className="mb-4 inline-flex size-12 items-center justify-center rounded-xl bg-secondary text-foreground transition-[background-color,scale,color] duration-300 group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground">
        <Icon className="size-6" />
      </div>
      <h3 className="mb-2 text-lg font-semibold">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
    </m.div>
  );
}

function DetailCard({
  label,
  title,
  body,
  delay = 0,
}: {
  label: string;
  title: string;
  body: string;
  delay?: number;
}) {
  return (
    <m.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay }}
      className="rounded-2xl border border-border bg-card/30 p-5 backdrop-blur-sm"
    >
      <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <h3 className="mb-2 text-base font-semibold">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
    </m.div>
  );
}

export function DesktopFeaturesSection() {
  const t = useExtracted();

  return (
    <>
      <section id="features" className="relative bg-secondary/20 px-4 py-24 backdrop-blur md:py-32">
        <div className="mx-auto max-w-6xl">
          <div className="mb-20 text-center">
            <m.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mb-6 text-4xl font-semibold tracking-tight md:text-5xl"
            >
              {t("Why Use Deni AI Desktop?")}
            </m.h2>
            <m.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="mx-auto max-w-2xl text-xl text-muted-foreground"
            >
              {t(
                "Built for people who want Deni AI available in the background and ready the moment they need it.",
              )}
            </m.p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            <FeatureCard
              icon={Workflow}
              title={t("Tray")}
              description={t(
                "Keep Deni AI running in your tray so you can open, hide, and return instantly without managing browser tabs.",
              )}
              delay={0.3}
            />
            <FeatureCard
              icon={BellRing}
              title={t("Native notifications")}
              description={t(
                "Get desktop notifications for replies and important activity so you can respond at the right moment.",
              )}
              delay={0.4}
            />
            <FeatureCard
              icon={Feather}
              title={t("Lightweight")}
              description={t(
                "Designed to stay fast and unobtrusive, with a compact footprint that feels natural to keep open.",
              )}
              delay={0.5}
            />
          </div>
        </div>
      </section>

      <section className="relative px-4 py-24 md:py-32">
        <div className="mx-auto max-w-6xl">
          <div className="mb-16 text-center">
            <m.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mb-6 text-3xl font-semibold tracking-tight md:text-5xl"
            >
              {t("Desktop-first workflow")}
            </m.h2>
            <m.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="mx-auto max-w-2xl text-lg text-muted-foreground"
            >
              {t(
                "The experience is tuned for quick reopen, quiet background presence, and faster transitions back into your work.",
              )}
            </m.p>
          </div>

          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            <DetailCard
              label={t("Always ready")}
              title={t("Stay in the tray")}
              body={t("Leave Deni AI available all day and pull it forward only when you need it.")}
              delay={0.2}
            />
            <DetailCard
              label={t("Timely")}
              title={t("See updates immediately")}
              body={t(
                "Native alerts help you notice finished replies and ongoing activity without tab switching.",
              )}
              delay={0.3}
            />
            <DetailCard
              label={t("Calm")}
              title={t("Low-friction presence")}
              body={t(
                "The app stays nearby without feeling heavy, noisy, or distracting during focused work.",
              )}
              delay={0.4}
            />
            <DetailCard
              label={t("Fast return")}
              title={t("Jump back into chat")}
              body={t(
                "Open the desktop app and continue where you left off with less overhead than a full browser workspace.",
              )}
              delay={0.5}
            />
          </div>
        </div>
      </section>
    </>
  );
}

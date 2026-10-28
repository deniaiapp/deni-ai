import { useExtracted } from "@/i18n/react";
import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { FadeIn, Stagger, StaggerItem } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { easeOut } from "@/lib/motion";
import {
  DENI_TIERS,
  formatUsd,
  TIER_BUDGET_USD,
  TIER_NAMES,
  TIER_TEAMMATES,
  type UsageMetric,
  type UsageSnapshot,
} from "@/lib/plans";
import { useConnectDeniAi } from "./billing-dialog";
import { AppMark } from "./app-mark";

function useHeadline(reason: UsageMetric | undefined, usage: UsageSnapshot | null) {
  const t = useExtracted();
  if (reason === "link" || (usage && !usage.linked)) {
    return {
      title: t("Connect your Deni AI account"),
      body: t("Deni Run uses the plan of your Deni AI account. Connect one to keep using teammates, the browser, and the computer."),
    };
  }
  if (reason === "teammates" && usage) {
    return {
      title: t("Teammate limit reached"),
      body: t("You've used {used} of {limit} teammates on Deni AI {plan}. Upgrade your Deni AI plan to add more.", {
        used: String(usage.teammates.used),
        limit: String(usage.teammates.limit),
        plan: usage.planName,
      }),
    };
  }
  if (reason === "budget" && usage) {
    return {
      title: t("Monthly usage used up"),
      body: t("You've used {percent}% of this month's usage on Deni AI {plan}, shared by Deni AI chat, Flixa, and Deni Run.", {
        percent: Math.round(usage.pool.usedPercent).toString(),
        plan: usage.planName,
      }),
    };
  }
  return {
    title: t("Deni Run is included with Deni AI"),
    body: t("One Deni AI subscription covers Deni AI chat, Flixa, and Deni Run, which share the plan's monthly usage."),
  };
}

export function UpgradeScreen({
  reason,
  usage,
  signedIn,
  plansUrl,
}: {
  reason?: UsageMetric;
  usage: UsageSnapshot | null;
  signedIn: boolean;
  plansUrl: string;
}) {
  const t = useExtracted();
  const copy = useHeadline(reason, usage);
  const current = usage?.linked ? usage.plan : null;

  return (
    <main className="h-full overflow-y-auto bg-background text-foreground">
      <FadeIn>
        <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <Link to="/">
            <AppMark />
          </Link>
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            {signedIn ? t("Back to workspace") : t("Back")}
          </Link>
        </header>
      </FadeIn>

      <Stagger className="mx-auto max-w-5xl px-6 pb-12 pt-12">
        <StaggerItem>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl">{copy.title}</h1>
        </StaggerItem>
        <StaggerItem>
          <p className="mt-5 max-w-2xl text-[0.925rem] leading-relaxed text-muted-foreground">{copy.body}</p>
        </StaggerItem>
        <StaggerItem>
          <div className="mt-8 max-w-sm">
            <UpgradeActions signedIn={signedIn} usage={usage} plansUrl={plansUrl} />
          </div>
        </StaggerItem>
      </Stagger>

      <section className="mx-auto max-w-5xl px-6 pb-24">
        <FadeIn>
          <h2 className="text-lg font-semibold">{t("Deni Run on each Deni AI plan")}</h2>
        </FadeIn>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {DENI_TIERS.map((tier, index) => (
            <motion.li
              key={tier}
              className={`rounded-xl border p-5 ${tier === current ? "border-foreground/40 bg-surface-23" : "border-foreground/10 bg-surface"}`}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.4, delay: index * 0.06, ease: easeOut }}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-[0.925rem] font-semibold">{TIER_NAMES[tier]}</h3>
                {tier === current ? <span className="text-xs text-muted-foreground">{t("Current plan")}</span> : null}
              </div>
              <p className="mt-3 text-2xl font-semibold">
                {formatUsd(TIER_BUDGET_USD[tier])}
                <span className="text-sm font-normal text-muted-foreground"> {t("/ month of usage")}</span>
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("Up to {count} teammates", { count: String(TIER_TEAMMATES[tier]) })}
              </p>
            </motion.li>
          ))}
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          {t("Monthly usage is shared by Deni AI chat, Flixa, and Deni Run, and resets at the start of each UTC month. Deni Run spends it with model, browser, and computer cost. Plan prices and checkout are on Deni AI.")}
        </p>
      </section>
    </main>
  );
}

function UpgradeActions({
  signedIn,
  usage,
  plansUrl,
}: {
  signedIn: boolean;
  usage: UsageSnapshot | null;
  plansUrl: string;
}) {
  const t = useExtracted();
  const { busy, connect } = useConnectDeniAi();

  if (!signedIn) {
    return (
      <Link
        to="/sign-up"
        className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-transform hover:bg-primary/80 active:scale-[0.98]"
      >
        {t("Get started with Deni AI")}
      </Link>
    );
  }

  if (usage && !usage.linked) {
    return (
      <Button type="button" variant="primary" size="md" className="w-full" loading={busy} onClick={() => void connect()}>
        {t("Connect Deni AI account")}
      </Button>
    );
  }

  return (
    <a
      href={usage?.manageUrl ?? plansUrl}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-transform hover:bg-primary/80 active:scale-[0.98]"
    >
      {t("Manage plan on Deni AI")}
    </a>
  );
}

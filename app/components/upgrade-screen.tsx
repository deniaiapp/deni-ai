"use client";

import { useExtracted } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { Check } from "lucide-react";
import { motion } from "motion/react";
import { FadeIn, Stagger, StaggerItem } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { easeOut } from "@/lib/motion";
import { formatTokenCount, PLANS, type UsageMetric, type UsageSnapshot } from "@/lib/plans";


function meterFor(usage: UsageSnapshot, reason: UsageMetric) {
  if (reason === "tokens") return usage.tokens;
  if (reason === "browser") return usage.browserMinutes;
  if (reason === "computer") return usage.computerMinutes;
  return usage.teammates;
}

function useHeadline(reason: UsageMetric | undefined, usage: UsageSnapshot | null) {
  const t = useExtracted();
  const plan = usage?.planName ?? "Free";
  if (reason && usage) {
    const meter = meterFor(usage, reason);
    if (reason === "teammates") {
      return {
        title: t("Teammate limit reached"),
        body: t("You've used {used} of {limit} teammates on {plan}. Pro includes {pro}.", { used: String(meter.used), limit: String(meter.limit), plan, pro: String(PLANS.pro.teammates) }),
      };
    }
    if (reason === "tokens") {
      return {
        title: t("Token limit reached"),
        body: t("You've used {used} of {limit} tokens on {plan} this month.", { used: formatTokenCount(meter.used), limit: formatTokenCount(meter.limit), plan }),
      };
    }
    if (reason === "browser") {
      return {
        title: t("Browser time limit reached"),
        body: t("You've used {used} of {limit} browser minutes on {plan} this month.", { used: String(meter.used), limit: String(meter.limit), plan }),
      };
    }
    return {
      title: t("Computer time limit reached"),
      body: t("You've used {used} of {limit} computer minutes on {plan} this month.", { used: String(meter.used), limit: String(meter.limit), plan }),
    };
  }
  return {
    title: t("Upgrade to Pro"),
    body: t("Same private computer. More teammates, tokens, and time on the browser and terminal."),
  };
}

export function UpgradeScreen({
  reason,
  usage,
  signedIn,
}: {
  reason?: UsageMetric;
  usage: UsageSnapshot | null;
  signedIn: boolean;
}) {
  const t = useExtracted();
  const free = PLANS.free;
  const pro = PLANS.pro;
  const copy = useHeadline(reason, usage);
  const perks = [
    {
      title: t("25 teammates"),
      body: t("Name specialists, keep memory on each one, and hand work off instead of stretching a single bot."),
    },
    {
      title: t("200M tokens / month"),
      body: t("Longer threads, more handoffs, and routines that can finish without stopping mid-task."),
    },
    {
      title: t("10 hours of browser time"),
      body: t("600 minutes to research, fill forms, and watch the live screen — 20× Free."),
    },
    {
      title: t("10 hours of computer time"),
      body: t("600 minutes of terminal and files on your isolated sandbox."),
    },
    {
      title: t("The same private computer"),
      body: t("Browser, workspace, and Linux sandbox stay scoped to your account. Pro only raises the ceiling."),
    },
  ];
  const onPro = usage?.plan === "pro";

  return (
    <main className="h-full overflow-y-auto bg-background text-foreground">
      <FadeIn>
        <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <Link href="/" className="text-[0.925rem] font-semibold hover:text-foreground">
            Deni Run
          </Link>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            {signedIn ? t("Back to workspace") : t("Back")}
          </Link>
        </header>
      </FadeIn>

      <Stagger className="mx-auto max-w-5xl px-6 pb-12 pt-12">
        <StaggerItem>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl">
            {onPro ? t("You're on Pro") : copy.title}
          </h1>
        </StaggerItem>
        <StaggerItem>
          <p className="mt-5 max-w-2xl text-[0.925rem] leading-relaxed text-muted-foreground">
            {onPro
              ? t("Your account already has the higher monthly ceiling. Manage billing if you need invoices or cancellation.")
              : copy.body}
          </p>
        </StaggerItem>
      </Stagger>

      <section className="mx-auto grid max-w-5xl items-start gap-8 px-6 pb-24 lg:grid-cols-[1fr_22rem]">
        <div>
          <FadeIn>
            <h2 className="text-lg font-semibold">{t("What Pro includes")}</h2>
          </FadeIn>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {perks.map((perk, index) => (
              <motion.li
                key={perk.title}
                className="rounded-xl border border-foreground/10 bg-surface p-5"
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.4, delay: index * 0.06, ease: easeOut }}
                whileHover={{ y: -4 }}
              >
                <div className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-secondary-foreground" aria-hidden="true" />
                  <div>
                    <h3 className="text-[0.925rem] font-semibold">{perk.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{perk.body}</p>
                  </div>
                </div>
              </motion.li>
            ))}
          </ul>
        </div>

        <motion.aside
          className="rounded-xl border border-foreground/20 bg-surface-23 p-6 lg:sticky lg:top-6"
          initial={{ opacity: 0, x: 16 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.45, ease: easeOut }}
        >
          <p className="text-sm text-muted-foreground">{onPro ? t("Current plan") : t("Upgrade")}</p>
          <h2 className="mt-1 text-lg font-semibold">Pro</h2>
          <p className="mt-1 text-3xl font-semibold">
            ${pro.priceUsd}
            <span className="text-sm font-normal text-muted-foreground"> {t("/ month")}</span>
          </p>
          <div className="mt-5">
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 text-xs text-muted-foreground">
              <span />
              <span className="w-20 text-right">{t("Free")}</span>
              <span className="w-20 text-right text-secondary-foreground">{t("Pro")}</span>
            </div>
            <CompareRow
              label={t("Teammates")}
              free={String(free.teammates)}
              pro={String(pro.teammates)}
            />
            <CompareRow
              label={t("Tokens")}
              free={formatTokenCount(free.tokens)}
              pro={formatTokenCount(pro.tokens)}
            />
            <CompareRow
              label={t("Browser")}
              free={t("{count} min", { count: String(free.browserMinutes) })}
              pro={t("{count} min", { count: String(pro.browserMinutes) })}
            />
            <CompareRow
              label={t("Computer")}
              free={t("{count} min", { count: String(free.computerMinutes) })}
              pro={t("{count} min", { count: String(pro.computerMinutes) })}
            />
          </div>
          <div className="mt-6">
            <UpgradeActions signedIn={signedIn} usage={usage} />
          </div>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            {t("Monthly limits reset at the start of each UTC month. Cancel anytime.")}
          </p>
        </motion.aside>
      </section>
    </main>
  );
}

function CompareRow({ label, free, pro }: { label: string; free: string; pro: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-t border-foreground/10 py-2.5 text-sm">
      <span className="text-secondary-foreground">{label}</span>
      <span className="w-20 text-right text-muted-foreground">{free}</span>
      <span className="w-20 text-right text-foreground">{pro}</span>
    </div>
  );
}

function UpgradeActions({
  signedIn,
  usage,
}: {
  signedIn: boolean;
  usage: UsageSnapshot | null;
}) {
  const t = useExtracted();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pro = PLANS.pro;
  const onPro = usage?.plan === "pro";

  async function post(path: string) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(path, { method: "POST" });
      const json = (await res.json()) as { url?: string; error?: string };
      if (json.url) {
        window.location.href = json.url;
        return;
      }
      setError(json.error ?? t("Could not open billing"));
    } catch {
      setError(t("Could not open billing"));
    } finally {
      setBusy(false);
    }
  }

  if (!signedIn) {
    return (
      <Link
        href="/sign-up"
        className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-transform hover:bg-primary/80 active:scale-[0.98]"
      >
        {t("Start Pro · ${price}/mo", { price: String(pro.priceUsd) })}
      </Link>
    );
  }

  if (onPro) {
    return (
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="primary"
          size="md"
          className="w-full"
          loading={busy}
          onClick={() => post("/api/billing/portal")}
        >
          {t("Manage billing")}
        </Button>
        {error ? <p className="text-xs text-destructive-300">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="primary"
        size="md"
        className="w-full"
        loading={busy}
        disabled={!usage?.stripeConfigured}
        onClick={() => post("/api/billing/checkout")}
      >
        {t("Upgrade to Pro · ${price}/mo", { price: String(pro.priceUsd) })}
      </Button>
      {usage && !usage.stripeConfigured ? (
        <p className="text-xs text-muted-foreground">
          {t("Stripe is not configured on this deployment. Limits still apply to the Free plan.")}
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive-300">{error}</p> : null}
    </div>
  );
}

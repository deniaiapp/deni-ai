"use client";

import Link from "next/link";
import { useState } from "react";
import { Check } from "lucide-react";
import { motion } from "motion/react";
import { FadeIn, Stagger, StaggerItem } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { easeOut } from "@/lib/motion";
import { formatTokenCount, PLANS, type UsageMetric, type UsageSnapshot } from "@/lib/plans";

const PERKS = [
  {
    title: "25 teammates",
    body: "Name specialists, keep memory on each one, and hand work off instead of stretching a single bot.",
  },
  {
    title: "200M tokens / month",
    body: "Longer threads, more handoffs, and routines that can finish without stopping mid-task.",
  },
  {
    title: "10 hours of browser time",
    body: "600 minutes to research, fill forms, and watch the live screen — 20× Free.",
  },
  {
    title: "10 hours of computer time",
    body: "600 minutes of terminal and files on your isolated sandbox.",
  },
  {
    title: "The same private computer",
    body: "Browser, workspace, and Linux sandbox stay scoped to your account. Pro only raises the ceiling.",
  },
] as const;

function meterFor(usage: UsageSnapshot, reason: UsageMetric) {
  if (reason === "tokens") return usage.tokens;
  if (reason === "browser") return usage.browserMinutes;
  if (reason === "computer") return usage.computerMinutes;
  return usage.teammates;
}

function headline(reason: UsageMetric | undefined, usage: UsageSnapshot | null) {
  const plan = usage?.planName ?? "Free";
  if (reason && usage) {
    const meter = meterFor(usage, reason);
    if (reason === "teammates") {
      return {
        title: "Teammate limit reached",
        body: `You've used ${meter.used} of ${meter.limit} teammates on ${plan}. Pro includes ${PLANS.pro.teammates}.`,
      };
    }
    if (reason === "tokens") {
      return {
        title: "Token limit reached",
        body: `You've used ${formatTokenCount(meter.used)} of ${formatTokenCount(meter.limit)} tokens on ${plan} this month.`,
      };
    }
    if (reason === "browser") {
      return {
        title: "Browser time limit reached",
        body: `You've used ${meter.used} of ${meter.limit} browser minutes on ${plan} this month.`,
      };
    }
    return {
      title: "Computer time limit reached",
      body: `You've used ${meter.used} of ${meter.limit} computer minutes on ${plan} this month.`,
    };
  }
  return {
    title: "Upgrade to Pro",
    body: "Same private computer. More teammates, tokens, and time on the browser and terminal.",
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
  const free = PLANS.free;
  const pro = PLANS.pro;
  const copy = headline(reason, usage);
  const onPro = usage?.plan === "pro";

  return (
    <main className="h-full overflow-y-auto bg-background text-foreground">
      <FadeIn>
        <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <Link href="/" className="text-[0.925rem] font-semibold hover:text-foreground">
            Deni Run
          </Link>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            {signedIn ? "Back to workspace" : "Back"}
          </Link>
        </header>
      </FadeIn>

      <Stagger className="mx-auto max-w-5xl px-6 pt-8 pb-12 md:pt-14">
        <StaggerItem>
          <p className="text-sm text-muted-foreground">Pro · ${pro.priceUsd}/month</p>
        </StaggerItem>
        <StaggerItem>
          <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl">
            {onPro ? "You're on Pro" : copy.title}
          </h1>
        </StaggerItem>
        <StaggerItem>
          <p className="mt-5 max-w-2xl text-[0.925rem] leading-relaxed text-muted-foreground">
            {onPro
              ? "Your account already has the higher monthly ceiling. Manage billing if you need invoices or cancellation."
              : copy.body}
          </p>
        </StaggerItem>
      </Stagger>

      <section className="mx-auto grid max-w-5xl items-start gap-8 px-6 pb-24 lg:grid-cols-[1fr_22rem]">
        <div>
          <FadeIn>
            <h2 className="text-lg font-semibold">What Pro includes</h2>
          </FadeIn>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {PERKS.map((perk, index) => (
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
          <p className="text-sm text-muted-foreground">{onPro ? "Current plan" : "Upgrade"}</p>
          <h2 className="mt-1 text-lg font-semibold">Pro</h2>
          <p className="mt-1 text-3xl font-semibold">
            ${pro.priceUsd}
            <span className="text-sm font-normal text-muted-foreground"> / month</span>
          </p>
          <div className="mt-5">
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 text-xs text-muted-foreground">
              <span />
              <span className="w-20 text-right">Free</span>
              <span className="w-20 text-right text-secondary-foreground">Pro</span>
            </div>
            <CompareRow
              label="Teammates"
              free={String(free.teammates)}
              pro={String(pro.teammates)}
            />
            <CompareRow
              label="Tokens"
              free={formatTokenCount(free.tokens)}
              pro={formatTokenCount(pro.tokens)}
            />
            <CompareRow
              label="Browser"
              free={`${free.browserMinutes} min`}
              pro={`${pro.browserMinutes} min`}
            />
            <CompareRow
              label="Computer"
              free={`${free.computerMinutes} min`}
              pro={`${pro.computerMinutes} min`}
            />
          </div>
          <div className="mt-6">
            <UpgradeActions signedIn={signedIn} usage={usage} />
          </div>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Monthly limits reset at the start of each UTC month. Cancel anytime.
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
      setError(json.error ?? "Could not open billing");
    } catch {
      setError("Could not open billing");
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
        Start Pro · ${pro.priceUsd}/mo
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
          Manage billing
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
        Upgrade to Pro · ${pro.priceUsd}/mo
      </Button>
      {usage && !usage.stripeConfigured ? (
        <p className="text-xs text-muted-foreground">
          Stripe is not configured on this deployment. Limits still apply to the Free plan.
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive-300">{error}</p> : null}
    </div>
  );
}

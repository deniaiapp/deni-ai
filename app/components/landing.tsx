"use client";

import { useExtracted } from "next-intl";
import Link from "next/link";
import { motion } from "motion/react";
import { FadeIn, FadeInView, Stagger, StaggerItem } from "@/components/motion";
import { formatTokenCount, PLANS } from "@/lib/plans";

export function Landing({ signedIn = false }: { signedIn?: boolean }) {
  const t = useExtracted();
  const free = PLANS.free;
  const pro = PLANS.pro;
  const startHref = signedIn ? "/" : "/sign-up";

  return (
    <main className="h-full overflow-y-auto bg-background text-foreground">
      <FadeIn>
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <span className="text-[0.925rem] font-semibold">Deni Run</span>
        <div className="flex items-center gap-3 text-sm">
          <a href="#pricing" className="text-muted-foreground hover:text-foreground">
            {t("Pricing")}
          </a>
          <Link href="/upgrade" className="text-muted-foreground hover:text-foreground">
            {t("Pro")}
          </Link>
          {signedIn ? (
            <Link
              href="/"
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-transform hover:bg-primary/80 active:scale-[0.98]"
            >
              {t("Open workspace")}
            </Link>
          ) : (
            <>
              <Link href="/sign-in" className="text-muted-foreground hover:text-foreground">
                {t("Sign in")}
              </Link>
              <Link
                href="/sign-up"
                className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-transform hover:bg-primary/80 active:scale-[0.98]"
              >
                {t("Get started")}
              </Link>
            </>
          )}
        </div>
      </header>
      </FadeIn>

      <Stagger className="mx-auto max-w-5xl px-6 py-20">
        <StaggerItem>
        <p className="text-sm text-muted-foreground">{t("AI teammates with their own computer")}</p>
        </StaggerItem>
        <StaggerItem>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl">
          {t("Hand work to named teammates and let them finish it on an isolated computer.")}
        </h1>
        </StaggerItem>
        <StaggerItem>
        <p className="mt-5 max-w-2xl text-[0.925rem] leading-relaxed text-muted-foreground">
          {t("Browser, files, and terminal stay private to your account. Watch the screen, take control for logins, and keep memory, skills, and routines with each teammate.")}
        </p>
        </StaggerItem>
        <StaggerItem>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={startHref}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-transform hover:bg-primary/80 active:scale-[0.98]"
          >
            {signedIn ? t("Open workspace") : t("Start free")}
          </Link>
          <a
            href="#pricing"
            className="rounded-lg bg-foreground/10 px-4 py-2 text-sm text-foreground transition-transform hover:bg-foreground/15 active:scale-[0.98]"
          >
            {t("See plans")}
          </a>
        </div>
        </StaggerItem>
      </Stagger>

      <section className="mx-auto grid max-w-5xl gap-4 px-6 pb-20 md:grid-cols-3">
        {[
          {
            title: t("Named teammates"),
            body: t("Chief, Research, Operations — or create your own. Each keeps memory and a job."),
          },
          {
            title: t("Private computer"),
            body: t("A browser, workspace, and Linux sandbox scoped to your account. Not a shared VM."),
          },
          {
            title: t("Take control"),
            body: t("When login or 2FA is needed, drive the live browser yourself, then hand it back."),
          },
        ].map((item, index) => (
          <motion.div
            key={item.title}
            className="rounded-xl border border-foreground/10 bg-surface p-5"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.4, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ y: -4 }}
          >
            <h2 className="text-[0.925rem] font-semibold">{item.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
          </motion.div>
        ))}
      </section>

      <section id="pricing" className="mx-auto max-w-5xl px-6 pb-24">
        <FadeInView>
          <h2 className="text-2xl font-semibold">{t("Pricing")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("Monthly limits reset at the start of each UTC month.")}
          </p>
        </FadeInView>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <motion.article
            className="rounded-xl border border-foreground/10 bg-surface p-6"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ y: -4 }}
          >
            <h3 className="text-lg font-semibold">{free.name}</h3>
            <p className="mt-1 text-3xl font-semibold">$0</p>
            <ul className="mt-5 space-y-2 text-sm text-secondary-foreground">
              <li>{t("{count} tokens / month", { count: formatTokenCount(free.tokens) })}</li>
              <li>{t("{count} browser minutes", { count: String(free.browserMinutes) })}</li>
              <li>{t("{count} computer minutes", { count: String(free.computerMinutes) })}</li>
              <li>{t("Up to {count} teammates", { count: String(free.teammates) })}</li>
              <li>{t("Isolated files, browser, and terminal")}</li>
            </ul>
            <Link
              href={startHref}
              className="mt-6 inline-flex rounded-lg bg-foreground/10 px-4 py-2 text-sm transition-transform hover:bg-foreground/15 active:scale-[0.98]"
            >
              {signedIn ? t("Open workspace") : t("Create account")}
            </Link>
          </motion.article>
          <motion.article
            className="rounded-xl border border-foreground/20 bg-surface-23 p-6"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.45, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ y: -4 }}
          >
            <h3 className="text-lg font-semibold">{pro.name}</h3>
            <p className="mt-1 text-3xl font-semibold">
              ${pro.priceUsd}
              <span className="text-sm font-normal text-muted-foreground"> {t("/ month")}</span>
            </p>
            <ul className="mt-5 space-y-2 text-sm text-secondary-foreground">
              <li>{t("{count} tokens / month", { count: formatTokenCount(pro.tokens) })}</li>
              <li>{t("{count} browser minutes", { count: String(pro.browserMinutes) })}</li>
              <li>{t("{count} computer minutes", { count: String(pro.computerMinutes) })}</li>
              <li>{t("Up to {count} teammates", { count: String(pro.teammates) })}</li>
              <li>{t("Same private computer, higher ceiling")}</li>
            </ul>
            <Link
              href="/upgrade"
              className="mt-6 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-transform hover:bg-primary/80 active:scale-[0.98]"
            >
              {t("Start Pro")}
            </Link>
          </motion.article>
        </div>
      </section>

      <FadeInView>
      <footer className="border-t border-foreground/10 px-6 py-8 text-xs text-muted-foreground">
        <div className="mx-auto flex max-w-5xl flex-wrap gap-4">
          <span>Deni Run</span>
          <Link href="/terms" className="hover:text-foreground">
            {t("Terms")}
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            {t("Privacy")}
          </Link>
          <Link href="/upgrade" className="hover:text-foreground">
            {t("Upgrade")}
          </Link>
          <Link href="/account" className="hover:text-foreground">
            {t("Account")}
          </Link>
        </div>
      </footer>
      </FadeInView>
    </main>
  );
}

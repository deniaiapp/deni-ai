"use client";

import { useExtracted } from "next-intl";
import Link from "next/link";
import { formatTokenCount, PLANS } from "@/lib/plans";

const rise = "deni-rise";
const card =
  "rounded-xl border border-foreground/10 bg-surface p-5 transition-transform duration-200 hover:-translate-y-1";

function delay(ms: number) {
  return { "--deni-delay": `${ms}ms` } as React.CSSProperties;
}

export function Landing({ signedIn = false }: { signedIn?: boolean }) {
  const t = useExtracted();
  const free = PLANS.free;
  const pro = PLANS.pro;
  const startHref = signedIn ? "/" : "/sign-up";

  return (
    <main className="h-full overflow-y-auto bg-background text-foreground">
      <header className={`${rise} mx-auto flex max-w-5xl items-center justify-between px-6 py-5`}>
        <Link href="/" className="text-[0.925rem] font-semibold">
          Deni Run
        </Link>
        <nav aria-label={t("Main")} className="flex items-center gap-3 text-sm">
          <a href="#features" className="hidden text-muted-foreground hover:text-foreground sm:inline">
            {t("Features")}
          </a>
          <a href="#pricing" className="text-muted-foreground hover:text-foreground">
            {t("Pricing")}
          </a>
          <Link href="/privacy" className="hidden text-muted-foreground hover:text-foreground sm:inline">
            {t("Privacy Policy")}
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
        </nav>
      </header>

      <section className="mx-auto max-w-5xl px-6 py-20">
        <p className={`${rise} text-sm text-muted-foreground`}>
          {t("Deni Run · AI teammates with their own computer")}
        </p>
        <h1
          className={`${rise} mt-3 max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl`}
          style={delay(60)}
        >
          {t("Hand work to named teammates and let them finish it on an isolated computer.")}
        </h1>
        <p
          className={`${rise} mt-5 max-w-2xl text-[0.925rem] leading-relaxed text-muted-foreground`}
          style={delay(120)}
        >
          {t("Deni Run is a web application where you assign tasks to AI teammates. Each teammate works in a private browser, file workspace, and Linux terminal that belongs only to your account, so research, form filling, file work, and scripted jobs get done without touching your own machine.")}
        </p>
        <p
          className={`${rise} mt-3 max-w-2xl text-[0.925rem] leading-relaxed text-muted-foreground`}
          style={delay(160)}
        >
          {t("Watch the screen live, take control for logins, and keep memory, skills, and routines with each teammate.")}
        </p>
        <div className={`${rise} mt-8 flex flex-wrap gap-3`} style={delay(200)}>
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
      </section>

      <section id="features" className="mx-auto max-w-5xl px-6 pb-20">
        <h2 className="text-2xl font-semibold">{t("What Deni Run does")}</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
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
            <div key={item.title} className={`${rise} ${card}`} style={delay(index * 80)}>
              <h3 className="text-[0.925rem] font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-20">
        <h2 className="text-2xl font-semibold">{t("How it works")}</h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            t("Sign in with Google or GitHub and confirm with an authenticator app."),
            t("Give a teammate a task, such as researching a topic, filling in a form, or organizing files."),
            t("Follow the live screen, approve risky steps, and collect the results in your workspace."),
          ].map((body, index) => (
            <li key={body} className={card}>
              <span className="text-sm font-semibold text-muted-foreground">{index + 1}</span>
              <p className="mt-2 text-sm leading-relaxed text-secondary-foreground">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="google-data" className="mx-auto max-w-5xl px-6 pb-20">
        <div className="rounded-xl border border-foreground/10 bg-surface p-6">
          <h2 className="text-2xl font-semibold">{t("Google sign-in and your data")}</h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-secondary-foreground">
            {t("Deni Run uses Google Sign-In only to identify you. We request the basic profile scopes (openid, email, and profile) and receive your name, email address, and profile picture. We do not request access to Gmail, Google Drive, Calendar, Contacts, or any other Google service.")}
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-secondary-foreground">
            {t("Google account information is never sold, used for advertising, or used to train AI models. The use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.")}
          </p>
          <Link
            href="/privacy"
            className="mt-4 inline-flex text-sm font-medium text-foreground hover:underline"
          >
            {t("Read the Privacy Policy")}
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-20">
        <h2 className="text-2xl font-semibold">{t("Acceptable use")}</h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-secondary-foreground">
          {t("Deni Run must not be used to break the law, attack systems, send spam, harass people, or create or distribute sexual or intimate imagery of a real person without their consent, including AI-generated imagery. Accounts that do so are suspended.")}{" "}
          <Link href="/terms" className="font-medium text-foreground hover:underline">
            {t("Terms of Service")}
          </Link>
        </p>
      </section>

      <section id="pricing" className="mx-auto max-w-5xl px-6 pb-24">
        <h2 className="text-2xl font-semibold">{t("Pricing")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("Monthly limits reset at the start of each UTC month.")}
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <article className="rounded-xl border border-foreground/10 bg-surface p-6 transition-transform duration-200 hover:-translate-y-1">
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
          </article>
          <article className="rounded-xl border border-foreground/20 bg-surface-23 p-6 transition-transform duration-200 hover:-translate-y-1">
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
          </article>
        </div>
      </section>

      <footer className="border-t border-foreground/10 px-6 py-8 text-xs text-muted-foreground">
        <div className="mx-auto flex max-w-5xl flex-wrap gap-4">
          <span>Deni Run</span>
          <Link href="/privacy" className="hover:text-foreground">
            {t("Privacy Policy")}
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            {t("Terms")}
          </Link>
          <Link href="/upgrade" className="hover:text-foreground">
            {t("Upgrade")}
          </Link>
          <Link href="/account" className="hover:text-foreground">
            {t("Account")}
          </Link>
        </div>
      </footer>
    </main>
  );
}

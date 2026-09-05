"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { FadeIn, FadeInView, Stagger, StaggerItem } from "@/components/motion";
import { formatTokenCount, PLANS } from "@/lib/plans";

export function Landing({ signedIn = false }: { signedIn?: boolean }) {
  const free = PLANS.free;
  const pro = PLANS.pro;
  const startHref = signedIn ? "/" : "/sign-up";

  return (
    <main className="h-full overflow-y-auto bg-[#050505] text-[#f0f0f0]">
      <FadeIn>
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <span className="text-[0.925rem] font-semibold">Deni Run</span>
        <div className="flex items-center gap-3 text-sm">
          <a href="#pricing" className="text-[#8f8f8f] hover:text-[#f0f0f0]">
            Pricing
          </a>
          <Link href="/upgrade" className="text-[#8f8f8f] hover:text-[#f0f0f0]">
            Pro
          </Link>
          {signedIn ? (
            <Link
              href="/"
              className="rounded-lg bg-[#f0f0f0] px-3 py-1.5 text-sm font-medium text-[#0a0a0a] transition-transform hover:bg-white active:scale-[0.98]"
            >
              Open workspace
            </Link>
          ) : (
            <>
              <Link href="/sign-in" className="text-[#8f8f8f] hover:text-[#f0f0f0]">
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="rounded-lg bg-[#f0f0f0] px-3 py-1.5 text-sm font-medium text-[#0a0a0a] transition-transform hover:bg-white active:scale-[0.98]"
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </header>
      </FadeIn>

      <Stagger className="mx-auto max-w-5xl px-6 py-20">
        <StaggerItem>
        <p className="text-sm text-[#8f8f8f]">AI teammates with their own computer</p>
        </StaggerItem>
        <StaggerItem>
        <h1 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl">
          Hand work to named teammates and let them finish it on an isolated computer.
        </h1>
        </StaggerItem>
        <StaggerItem>
        <p className="mt-5 max-w-2xl text-[0.925rem] leading-relaxed text-[#8f8f8f]">
          Browser, files, and terminal stay private to your account. Watch the screen, take control
          for logins, and keep memory, skills, and routines with each teammate.
        </p>
        </StaggerItem>
        <StaggerItem>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={startHref}
            className="rounded-lg bg-[#f0f0f0] px-4 py-2 text-sm font-medium text-[#0a0a0a] transition-transform hover:bg-white active:scale-[0.98]"
          >
            {signedIn ? "Open workspace" : "Start free"}
          </Link>
          <a
            href="#pricing"
            className="rounded-lg bg-white/10 px-4 py-2 text-sm text-[#f0f0f0] transition-transform hover:bg-white/15 active:scale-[0.98]"
          >
            See plans
          </a>
        </div>
        </StaggerItem>
      </Stagger>

      <section className="mx-auto grid max-w-5xl gap-4 px-6 pb-20 md:grid-cols-3">
        {[
          {
            title: "Named teammates",
            body: "Chief, Research, Operations — or create your own. Each keeps memory and a job.",
          },
          {
            title: "Private computer",
            body: "A browser, workspace, and Linux sandbox scoped to your account. Not a shared VM.",
          },
          {
            title: "Take control",
            body: "When login or 2FA is needed, drive the live browser yourself, then hand it back.",
          },
        ].map((item, index) => (
          <motion.div
            key={item.title}
            className="rounded-xl border border-white/10 bg-[#111111] p-5"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.4, delay: index * 0.08, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ y: -4 }}
          >
            <h2 className="text-[0.925rem] font-semibold">{item.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#8f8f8f]">{item.body}</p>
          </motion.div>
        ))}
      </section>

      <section id="pricing" className="mx-auto max-w-5xl px-6 pb-24">
        <FadeInView>
          <h2 className="text-2xl font-semibold">Pricing</h2>
          <p className="mt-2 text-sm text-[#8f8f8f]">
            Monthly limits reset at the start of each UTC month.
          </p>
        </FadeInView>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <motion.article
            className="rounded-xl border border-white/10 bg-[#111111] p-6"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ y: -4 }}
          >
            <h3 className="text-lg font-semibold">{free.name}</h3>
            <p className="mt-1 text-3xl font-semibold">$0</p>
            <ul className="mt-5 space-y-2 text-sm text-[#c8c8c8]">
              <li>{formatTokenCount(free.tokens)} tokens / month</li>
              <li>{free.browserMinutes} browser minutes</li>
              <li>{free.computerMinutes} computer minutes</li>
              <li>Up to {free.teammates} teammates</li>
              <li>Isolated files, browser, and terminal</li>
            </ul>
            <Link
              href={startHref}
              className="mt-6 inline-flex rounded-lg bg-white/10 px-4 py-2 text-sm transition-transform hover:bg-white/15 active:scale-[0.98]"
            >
              {signedIn ? "Open workspace" : "Create account"}
            </Link>
          </motion.article>
          <motion.article
            className="rounded-xl border border-white/20 bg-[#171717] p-6"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.45, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ y: -4 }}
          >
            <h3 className="text-lg font-semibold">{pro.name}</h3>
            <p className="mt-1 text-3xl font-semibold">
              ${pro.priceUsd}
              <span className="text-sm font-normal text-[#8f8f8f]"> / month</span>
            </p>
            <ul className="mt-5 space-y-2 text-sm text-[#c8c8c8]">
              <li>{formatTokenCount(pro.tokens)} tokens / month</li>
              <li>{pro.browserMinutes} browser minutes</li>
              <li>{pro.computerMinutes} computer minutes</li>
              <li>Up to {pro.teammates} teammates</li>
              <li>Same private computer, higher ceiling</li>
            </ul>
            <Link
              href="/upgrade"
              className="mt-6 inline-flex rounded-lg bg-[#f0f0f0] px-4 py-2 text-sm font-medium text-[#0a0a0a] transition-transform hover:bg-white active:scale-[0.98]"
            >
              Start Pro
            </Link>
          </motion.article>
        </div>
      </section>

      <FadeInView>
      <footer className="border-t border-white/10 px-6 py-8 text-xs text-[#8f8f8f]">
        <div className="mx-auto flex max-w-5xl flex-wrap gap-4">
          <span>Deni Run</span>
          <Link href="/terms" className="hover:text-[#f0f0f0]">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-[#f0f0f0]">
            Privacy
          </Link>
          <Link href="/upgrade" className="hover:text-[#f0f0f0]">
            Upgrade
          </Link>
          <Link href="/account" className="hover:text-[#f0f0f0]">
            Account
          </Link>
        </div>
      </footer>
      </FadeInView>
    </main>
  );
}

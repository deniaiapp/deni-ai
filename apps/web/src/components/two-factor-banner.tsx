import { ArrowRight, Code2, ShieldCheck, ScrollText, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { Link, usePathname } from "@/lib/navigation";
import { useExtracted } from "use-intl";
import { startTransition, useEffect, useState, useSyncExternalStore } from "react";
import { authClient } from "@/lib/auth-client";
import { isCheckoutSettingsRoute } from "@/lib/settings-routes";
import { cn } from "@/lib/utils";
import { AppHeader } from "@deniai/ui/components/app-header";
import { Button } from "@deniai/ui/components/button";
import { SidebarTrigger } from "@deniai/ui/components/sidebar";

// Bump when a new announcement must reappear for previously dismissed users.
const DISMISSED_KEY = "deni-announcements-2026-08-terms";
const DISMISSED_EVENT = "deni:announcements-dismissed";
const ANNOUNCEMENT_INTERVAL_MS = 8000;

type Announcement = {
  id: string;
  message: string;
  linkLabel: string;
  href: string;
  external: boolean;
  icon: LucideIcon;
  iconClassName: string;
};

function subscribeDismissed(onStoreChange: () => void) {
  const handleChange = () => onStoreChange();
  window.addEventListener("storage", handleChange);
  window.addEventListener(DISMISSED_EVENT, handleChange);
  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(DISMISSED_EVENT, handleChange);
  };
}

function getDismissedSnapshot() {
  return window.localStorage.getItem(DISMISSED_KEY) !== null;
}

function getServerDismissedSnapshot() {
  // Hide the promo banner until the client can read localStorage.
  return true;
}

function dismissTwoFactorBanner() {
  localStorage.setItem(DISMISSED_KEY, "1");
  window.dispatchEvent(new Event(DISMISSED_EVENT));
}

/** The header bar of the app sheet: sidebar trigger plus one dismissable announcement. */
export function TwoFactorBanner() {
  const t = useExtracted();
  const pathname = usePathname();
  const session = authClient.useSession();
  const dismissed = useSyncExternalStore(
    subscribeDismissed,
    getDismissedSnapshot,
    getServerDismissedSnapshot,
  );
  const shouldReduceMotion = useReducedMotion();
  const [announcementIndex, setAnnouncementIndex] = useState(0);
  const twoFactorEnabled = Boolean(session.data?.user?.twoFactorEnabled);
  const visible = !dismissed;

  const announcements: Announcement[] = [
    {
      id: "flixa",
      message: t("Flixa - A low-cost, high-performance coding agent"),
      linkLabel: t("Download"),
      href: "/flixa",
      external: false,
      icon: Code2,
      iconClassName: "text-primary",
    },
    {
      id: "changelog",
      message: t("Updates - Check out the latest changes"),
      linkLabel: t("Read"),
      href: "/changelog",
      external: true,
      icon: ScrollText,
      iconClassName: "text-primary",
    },
    ...(!twoFactorEnabled
      ? [
          {
            id: "two-factor",
            message: t("2FA - Enhance your security with two-factor authentication"),
            linkLabel: t("Setup"),
            href: "/account/security",
            external: false,
            icon: ShieldCheck,
            iconClassName: "text-success",
          },
        ]
      : []),
  ];

  useEffect(() => {
    if (!visible || announcements.length <= 1) return;

    const shuffleAnnouncement = () => {
      startTransition(() => {
        setAnnouncementIndex((currentIndex) => {
          const count = announcements.length;
          const fromIndex = currentIndex < count ? currentIndex : 0;
          let nextIndex = Math.floor(Math.random() * count);
          if (nextIndex === fromIndex) {
            nextIndex = (nextIndex + 1) % count;
          }
          return nextIndex;
        });
      });
    };

    const intervalId = window.setInterval(shuffleAnnouncement, ANNOUNCEMENT_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [visible, announcements.length]);

  if (isCheckoutSettingsRoute(pathname) || !visible) {
    return (
      <AppHeader>
        <SidebarTrigger className="-ml-1" />
      </AppHeader>
    );
  }

  const visibleAnnouncementIndex = announcementIndex < announcements.length ? announcementIndex : 0;
  const announcement = announcements[visibleAnnouncementIndex] ?? announcements[0];
  const AnnouncementIcon = announcement.icon;

  return (
    <AppHeader className="text-sm">
      <SidebarTrigger className="-ml-1" />
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <div className="relative h-6 min-w-0 flex-1" aria-live="polite" aria-atomic="true">
          <LazyMotion features={domAnimation} strict>
            <AnimatePresence initial={false} mode="wait">
              <m.div
                key={announcement.id}
                initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: -4 }}
                transition={{ duration: shouldReduceMotion ? 0 : 0.24, ease: [0.2, 0, 0, 1] }}
                className="absolute inset-0 flex min-w-0 items-center gap-2"
              >
                <AnnouncementIcon
                  aria-hidden="true"
                  className={cn("size-4 shrink-0", announcement.iconClassName)}
                />
                <span className="min-w-0 truncate text-muted-foreground">
                  {announcement.message}
                </span>
                <Link
                  href={announcement.href}
                  target={announcement.external ? "_blank" : undefined}
                  rel={announcement.external ? "noreferrer" : undefined}
                  className="group inline-flex shrink-0 items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
                >
                  {announcement.linkLabel}
                  <ArrowRight className="size-3 transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
              </m.div>
            </AnimatePresence>
          </LazyMotion>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0"
          onClick={dismissTwoFactorBanner}
          aria-label={t("Dismiss")}
        >
          <X />
        </Button>
      </div>
    </AppHeader>
  );
}

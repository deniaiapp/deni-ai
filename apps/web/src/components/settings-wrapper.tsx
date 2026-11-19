import {
  CreditCard,
  FolderClosed,
  KeyRound,
  Megaphone,
  Palette,
  Shield,
  Sparkles,
  Upload,
  User2,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link, usePathname } from "@/lib/navigation";
import { useExtracted, useLocale } from "use-intl";
import type React from "react";
import { DocumentTitle } from "@/components/document-title";
import { Spinner } from "@deniai/ui/components/spinner";
import {
  SettingsContent,
  SettingsLayout,
  SettingsNav,
  SettingsNavFooter,
  SettingsNavGroup,
  SettingsNavItem,
} from "@deniai/ui/components/settings-layout";
import { CombinedUsageMeter } from "@/components/billing/product-usage";
import { usePlatformCapabilities } from "@/components/platform-capabilities-provider";
import { authClient } from "@/lib/auth-client";
import { formatAppDate } from "@/lib/format-date";
import { isCheckoutSettingsRoute, isStandaloneSettingsRoute } from "@/lib/settings-routes";
import { trpc } from "@/lib/trpc/react";
import { settingsUsageQueryOptions } from "@/lib/usage-query-options";
import { formatCompactUsageValue } from "@/lib/utils";
import { Progress } from "@deniai/ui/components/progress";

type SettingsNavEntry = { label: string; href: string; icon: LucideIcon };

/** Plan and usage summary under the settings nav. */
function SettingsPlanSummary() {
  const t = useExtracted();
  const locale = useLocale();
  const { features } = usePlatformCapabilities();
  const billingDisabled = !features.billing;
  const isAnonymous = Boolean(authClient.useSession().data?.user?.isAnonymous);
  const statusQuery = trpc.billing.status.useQuery(undefined, {
    enabled: !billingDisabled && !isAnonymous,
    staleTime: 60_000,
  });
  const usageQuery = trpc.billing.usage.useQuery(undefined, settingsUsageQueryOptions);

  if (usageQuery.isLoading || (!billingDisabled && !isAnonymous && statusQuery.isLoading)) {
    return (
      <div className="flex min-h-20 items-center justify-center">
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    );
  }

  const status = statusQuery.data;
  const usage = usageQuery.data;
  const usages = usage?.usage;
  const maxModeEnabled = features.billing && (usage?.maxModeEnabled ?? false);
  // Go through a verified educational address has no subscription, so no plan id or renewal.
  const isEducation = usage?.education === true;
  const plan = isEducation
    ? t("Go (free for education)")
    : status?.planId
        ?.split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ") || t("Free");

  return (
    <div className="flex flex-col gap-3 px-3 text-sm">
      {!billingDisabled ? (
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">{t("Your Plan")}</span>
          <span className="font-semibold">{plan}</span>
          <span className="text-xs text-muted-foreground">
            {isEducation
              ? t("Included with your school email")
              : t("Next update: {date}", {
                  date: status?.currentPeriodEnd
                    ? formatAppDate(status.currentPeriodEnd, locale)
                    : "—",
                })}
          </span>
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">
          {t("Resets on {date}", {
            date: usages?.[0]?.periodEnd ? formatAppDate(usages[0].periodEnd, locale) : "—",
          })}
        </span>
        {usage?.pool ? (
          <CombinedUsageMeter pool={usage.pool} maxModeEnabled={maxModeEnabled} />
        ) : (
          usages?.map((usageItem) => {
            const hasLimit = !maxModeEnabled && usageItem.limit !== null && usageItem.limit > 0;
            const usedPercent = hasLimit
              ? Math.min((usageItem.used / (usageItem.limit ?? 1)) * 100, 100)
              : 0;
            return (
              <div key={usageItem.category} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span>{t("Usage")}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {hasLimit
                      ? t("{percent}% used", { percent: usedPercent.toFixed(1) })
                      : `${formatCompactUsageValue(usageItem.used)} ${t("units")}`}
                  </span>
                </div>
                <Progress value={usedPercent} className="h-1.5" />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/**
 * Settings frame for /settings/* and /account/*: section nav on the left (a
 * scroller on narrow screens), the page on the right, plan and usage under the
 * nav. Checkout and team pages render their own layout.
 */
export default function SettingsWrapper({
  children,
  hideNav = false,
}: {
  children: React.ReactNode;
  /** Guests only see their account page. */
  hideNav?: boolean;
}) {
  const t = useExtracted();
  const pathname = usePathname();
  const isStandaloneRoute = isStandaloneSettingsRoute(pathname);
  const { features } = usePlatformCapabilities();
  const billingDisabled = !features.billing;

  // Always keep {children} in the tree so the route segment stays mounted.
  if (isStandaloneRoute) {
    return (
      <div className="mx-auto w-full max-w-5xl pt-2 pb-12">
        <DocumentTitle title={isCheckoutSettingsRoute(pathname) ? t("Checkout") : t("Team")} />
        {children}
      </div>
    );
  }

  const groups: { label: string; items: SettingsNavEntry[] }[] = [
    {
      label: t("Account"),
      items: [
        { label: t("Account"), href: "/account/settings", icon: User2 },
        { label: t("Security"), href: "/account/security", icon: Shield },
        { label: t("API Keys"), href: "/settings/api-keys", icon: KeyRound },
      ],
    },
    {
      label: t("Preferences"),
      items: [
        { label: t("Appearance"), href: "/settings/appearance", icon: Palette },
        ...(features.memory
          ? [{ label: t("Personalize"), href: "/settings/memory", icon: Sparkles }]
          : []),
        { label: t("Projects"), href: "/settings/projects", icon: FolderClosed },
        { label: t("Import"), href: "/settings/import", icon: Upload },
      ],
    },
    {
      label: t("Plan"),
      items: [
        ...(billingDisabled
          ? []
          : [{ label: t("Billing"), href: "/settings/billing", icon: CreditCard }]),
        { label: t("Ads"), href: "/settings/ads", icon: Megaphone },
        { label: t("Team"), href: "/settings/team", icon: Users },
      ],
    },
  ];

  const current = groups
    .flatMap((group) => group.items)
    .find((item) => pathname === item.href || pathname?.startsWith(`${item.href}/`));

  return (
    <SettingsLayout className="px-1 pt-2 pb-12 md:px-2">
      {current ? <DocumentTitle title={current.label} /> : null}
      {hideNav ? null : (
        // Stick at the nav's resting offset so it does not shift once a page scrolls.
        <SettingsNav aria-label={t("Settings")} className="lg:top-2">
          {groups.map((group) => (
            <SettingsNavGroup key={group.label} label={group.label}>
              {group.items.map(({ label, href, icon: Icon }) => (
                <SettingsNavItem
                  key={href}
                  active={current?.href === href}
                  // On narrow screens the nav scrolls sideways; keep the current page in view.
                  ref={
                    current?.href === href
                      ? (node: HTMLAnchorElement | null) =>
                          node?.scrollIntoView({ block: "nearest", inline: "center" })
                      : undefined
                  }
                  render={<Link href={href} />}
                >
                  <Icon aria-hidden="true" />
                  {label}
                </SettingsNavItem>
              ))}
            </SettingsNavGroup>
          ))}
          <SettingsNavFooter>
            <SettingsPlanSummary />
          </SettingsNavFooter>
        </SettingsNav>
      )}
      <SettingsContent>{children}</SettingsContent>
    </SettingsLayout>
  );
}

import { LogOut, Settings, UserIcon, UserPlus, Users, Zap } from "lucide-react";
import { Link, useRouter } from "@/lib/navigation";
import { useExtracted } from "use-intl";
import { useLocalizeError } from "@/hooks/use-localize-error";
import { useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";
import { usePlatformCapabilities } from "@/components/platform-capabilities-provider";
import { authClient } from "@/lib/auth-client";
import { CombinedUsageBar } from "@/components/billing/product-usage";
import { trpc } from "@/lib/trpc/react";
import { liveUsageQueryOptions } from "@/lib/usage-query-options";
import { cn } from "@/lib/utils";
import { versions } from "@/lib/version";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

type UsageCategoryItem = {
  category: "basic" | "premium";
  unit: "units";
  limit: number | null;
  used: number;
  remaining: number | null;
};

function AccountUsageRow({
  label,
  item,
  maxModeEnabled,
}: {
  label: string;
  item: UsageCategoryItem | undefined;
  maxModeEnabled: boolean;
}) {
  const t = useExtracted();
  if (!item) return null;

  const hasLimit = item.limit !== null && item.limit > 0;
  const usedPercent = hasLimit ? Math.min((item.used / (item.limit ?? 1)) * 100, 100) : 0;
  const remainingPercent = Math.max(100 - usedPercent, 0);
  const isUnavailable = item.limit === 0;
  const valueLabel = maxModeEnabled
    ? t("Max Mode")
    : isUnavailable
      ? t("Sign in required")
      : hasLimit
        ? t("{percent}% left", { percent: remainingPercent.toFixed(0) })
        : t("Unlimited");

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span
          className={cn(
            "tabular-nums text-foreground/80",
            maxModeEnabled && "text-amber-600 dark:text-amber-400",
          )}
        >
          {valueLabel}
        </span>
      </div>
      {hasLimit && !maxModeEnabled ? (
        <Progress value={usedPercent} className="h-1" />
      ) : (
        <div className="h-1 rounded-full bg-muted" />
      )}
    </div>
  );
}

export function AccountMenu() {
  const t = useExtracted();
  const localizeError = useLocalizeError();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isGuestSignOutOpen, setIsGuestSignOutOpen] = useState(false);
  const { push } = useRouter();
  const { isMobile } = useSidebar();
  const utils = trpc.useUtils();
  const session = authClient.useSession();
  const isAnonymous = Boolean(session.data?.user?.isAnonymous);
  const { features } = usePlatformCapabilities();
  const billingDisabled = !features.billing;
  const hasSession = Boolean(session.data?.user);
  // A guest's stored name ("Anonymous") and placeholder address are not theirs to see.
  const displayName = isAnonymous ? t("Guest") : (session.data?.user?.name ?? t("User"));

  const usageQuery = trpc.billing.usage.useQuery(undefined, {
    enabled: hasSession,
    ...liveUsageQueryOptions,
  });

  const maxModeQuery = trpc.billing.maxModeStatus.useQuery(undefined, {
    enabled: !billingDisabled && !isAnonymous,
    staleTime: 60_000,
  });

  const invalidateMaxMode = async () => {
    await Promise.all([utils.billing.maxModeStatus.invalidate(), utils.billing.usage.invalidate()]);
  };

  const enableMaxMode = trpc.billing.enableMaxMode.useMutation({
    onSuccess: async () => {
      toast.success(t("Max Mode enabled."));
      await invalidateMaxMode();
    },
    onError: (error) => toast.error(localizeError(error)),
  });

  const disableMaxMode = trpc.billing.disableMaxMode.useMutation({
    onSuccess: async () => {
      toast.success(t("Max Mode disabled."));
      await invalidateMaxMode();
    },
    onError: (error) => toast.error(localizeError(error)),
  });

  const maxModePending = enableMaxMode.isPending || disableMaxMode.isPending;
  const isMenuPending = maxModePending || isSigningOut;

  const handleSignOut = async () => {
    if (isMenuPending) return;
    setIsSigningOut(true);
    try {
      const result = await authClient.signOut();
      if (result.error) {
        toast.error(localizeError(result.error));
        return;
      }
      setIsMenuOpen(false);
      push("/");
    } catch (error) {
      toast.error(localizeError(error, String(error)));
    } finally {
      setIsSigningOut(false);
    }
  };
  const maxModeEnabled =
    !billingDisabled &&
    (disableMaxMode.isPending ||
      (!enableMaxMode.isPending &&
        (maxModeQuery.data?.enabled ?? usageQuery.data?.maxModeEnabled ?? false)));
  // Team members follow their owner's switch; only those who manage Max Mode can toggle it.
  const maxModeEligible =
    !billingDisabled &&
    (maxModeQuery.data?.canManage ?? true) &&
    (maxModeQuery.data?.eligible ?? usageQuery.data?.maxModeEligible ?? false);

  const usageItem = usageQuery.data?.usage[0];
  const usageTier = usageQuery.data?.tier ?? "free";
  const usageTierLabel =
    usageTier === "free"
      ? t("Free")
      : usageTier === "go"
        ? t("Go")
        : usageTier === "plus"
          ? t("Plus")
          : t("Pro");

  return (
    <>
      <DropdownMenu
        open={isMenuOpen}
        onOpenChange={(open) => {
          if (!isMenuPending) setIsMenuOpen(open);
        }}
      >
        <DropdownMenuTrigger render={<SidebarMenuButton className="h-auto py-2" />}>
          <div className="flex w-full items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground overflow-hidden">
              {session.data?.user?.image ? (
                <img
                  src={session.data.user.image}
                  alt={displayName}
                  className="size-full object-cover"
                  width={32}
                  height={32}
                />
              ) : (
                displayName.charAt(0).toUpperCase()
              )}
            </div>
            <span className="flex-1 truncate text-sm">{displayName}</span>
            {maxModeEnabled && (
              <span className="ml-auto inline-flex items-center gap-0.5 text-[10px] font-medium uppercase tracking-widest text-foreground/50">
                <Zap className="size-2.5" />
                Max
              </span>
            )}
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent side={isMobile ? "top" : "right"} align="start" className="w-64">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground overflow-hidden text-xs">
              {session.data?.user?.image ? (
                <img
                  src={session.data.user.image}
                  alt={displayName}
                  className="size-full object-cover"
                  width={24}
                  height={24}
                />
              ) : (
                displayName.charAt(0).toUpperCase()
              )}
            </div>
            <div className="flex-1 flex flex-col min-w-0">
              <span className="flex-1 truncate text-sm font-medium">{displayName}</span>
              <span className="flex-1 truncate text-sm">
                {isAnonymous ? t("Guest account") : (session.data?.user?.email ?? t("User"))}
              </span>
            </div>
          </div>

          {hasSession && (
            <>
              <DropdownMenuSeparator />
              <div className="space-y-2.5 px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">{t("Usage")}</span>
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {usageTierLabel}
                  </span>
                </div>
                {usageQuery.isLoading ? (
                  <div className="flex justify-center py-1">
                    <Spinner aria-label={t("Loading…")} className="text-muted-foreground" />
                  </div>
                ) : usageQuery.isError ? (
                  <p className="text-xs text-destructive">{t("Failed to load usage.")}</p>
                ) : (
                  <div className="space-y-2.5">
                    {usageQuery.data?.pool ? (
                      <CombinedUsageBar
                        pool={usageQuery.data.pool}
                        maxModeEnabled={maxModeEnabled}
                      />
                    ) : (
                      <AccountUsageRow
                        label={t("Usage")}
                        item={usageItem}
                        maxModeEnabled={maxModeEnabled}
                      />
                    )}
                  </div>
                )}
                {!isAnonymous && !billingDisabled && (
                  <Link
                    href="/settings/billing"
                    aria-disabled={isMenuPending}
                    tabIndex={isMenuPending ? -1 : undefined}
                    onClick={(event) => {
                      if (isMenuPending) event.preventDefault();
                    }}
                    className="block text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {t("View billing")}
                  </Link>
                )}
              </div>
            </>
          )}

          {(maxModeEnabled || maxModeEligible || maxModePending) && (
            <>
              <DropdownMenuSeparator />
              {maxModeEnabled && (
                <DropdownMenuItem
                  className="gap-2 text-sm text-muted-foreground"
                  closeOnClick={false}
                  disabled={isMenuPending}
                  aria-busy={disableMaxMode.isPending}
                  onClick={() => {
                    if (isMenuPending) return;
                    disableMaxMode.mutate();
                  }}
                >
                  {disableMaxMode.isPending ? (
                    <Spinner className="size-4" />
                  ) : (
                    <Zap className="size-4 text-amber-500" />
                  )}
                  <span className="flex-1">
                    {disableMaxMode.isPending ? t("Disabling…") : t("Disable Max Mode")}
                  </span>
                </DropdownMenuItem>
              )}
              {!maxModeEnabled && (maxModeEligible || enableMaxMode.isPending) && (
                <DropdownMenuItem
                  className="gap-2 text-sm text-amber-600"
                  closeOnClick={false}
                  disabled={isMenuPending}
                  aria-busy={enableMaxMode.isPending}
                  onClick={() => {
                    if (isMenuPending) return;
                    enableMaxMode.mutate();
                  }}
                >
                  {enableMaxMode.isPending ? (
                    <Spinner className="size-4" />
                  ) : (
                    <Zap className="size-4" />
                  )}
                  <span className="flex-1">
                    {enableMaxMode.isPending ? t("Enabling…") : t("Enable Max Mode")}
                  </span>
                </DropdownMenuItem>
              )}
            </>
          )}

          {
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={<div className="px-2 py-1.5 text-xs text-muted-foreground cursor-help" />}
                >
                  <span className="block">Deni AI {versions.version}</span>
                </TooltipTrigger>
                <TooltipContent side="left" align="start">
                  <div>
                    {versions.codename}, {versions.date}
                  </div>
                  <div className="font-mono text-[10px]">{versions.hash}</div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          }
          {isAnonymous && (
            <DropdownMenuItem
              className="gap-2 text-sm"
              disabled={isMenuPending}
              render={<Link href="/auth/sign-up?redirectTo=/chat" className="flex w-full" />}
            >
              <UserPlus className="size-4" />
              <span className="flex-1">{t("Sign up to keep your chats")}</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className="gap-2 text-sm"
            disabled={isMenuPending}
            render={<Link href="/account/settings" className="flex w-full" />}
          >
            <UserIcon className="size-4" />
            <span className="flex-1">{t("Account")}</span>
          </DropdownMenuItem>
          {!isAnonymous && (
            <DropdownMenuItem
              className="gap-2 text-sm"
              disabled={isMenuPending}
              render={<Link href="/settings/appearance" className="flex w-full" />}
            >
              <Settings className="size-4" />
              <span className="flex-1">{t("Settings")}</span>
            </DropdownMenuItem>
          )}
          {!isAnonymous && !billingDisabled && (
            <DropdownMenuItem
              className="gap-2 text-sm"
              disabled={isMenuPending}
              render={<Link href="/settings/team" className="flex w-full" />}
            >
              <Users className="size-4" />
              <span className="flex-1">{t("Team")}</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2 text-sm"
            closeOnClick={false}
            disabled={isMenuPending}
            aria-busy={isSigningOut}
            onClick={() => {
              if (!isAnonymous) {
                void handleSignOut();
                return;
              }
              setIsMenuOpen(false);
              setIsGuestSignOutOpen(true);
            }}
          >
            {isSigningOut ? <Spinner className="size-4" /> : <LogOut className="size-4" />}
            <span>{t("Logout")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog
        open={isGuestSignOutOpen}
        onOpenChange={(open) => {
          if (!isSigningOut) setIsGuestSignOutOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Log out of the guest account?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "A guest account cannot be signed in to again, so its chats are deleted. Sign up or sign in first to move them to an account.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSigningOut}>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isSigningOut}
              onClick={async () => {
                await handleSignOut();
                setIsGuestSignOutOpen(false);
              }}
            >
              {t("Logout")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

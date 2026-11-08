import { Bell, CalendarClock, Plus, Settings, Sparkles } from "lucide-react";
import { useExtracted } from "use-intl";
import { Button } from "@deniai/ui/components/button";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
} from "@deniai/ui/components/sidebar";
import { Link, usePathname } from "@/lib/navigation";
import { useRunState } from "./run-api";
import { TeammateAvatar } from "./teammate-avatar";

/**
 * Sidebar body for Run mode. Run keeps its own history, separate from chats: its
 * teammates, recent conversations (unread ones marked) and Run's own pages.
 */
export function RunSidebarContent() {
  const t = useExtracted();
  const pathname = usePathname();
  const { data, isLoading, isError } = useRunState();
  const threads = (data?.threads ?? [])
    .filter((thread) => !thread.hidden)
    .toSorted(
      (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
    )
    .slice(0, 30);

  const pages = [
    { href: "/run/skills", label: t("Skills"), icon: Sparkles, badge: 0 },
    { href: "/run/routines", label: t("Routines"), icon: CalendarClock, badge: 0 },
    {
      href: "/run/notifications",
      label: t("Notifications"),
      icon: Bell,
      badge: data?.unreadNotifications ?? 0,
    },
    { href: "/run/settings", label: t("Run settings"), icon: Settings, badge: 0 },
  ];

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <Button
                className="h-9 w-full justify-start gap-2 font-medium"
                render={<Link href="/run" />}
                nativeButton={false}
              >
                <Plus className="size-4" />
                {t("New task")}
              </Button>
            </SidebarMenuItem>
            {pages.map((page) => (
              <SidebarMenuItem key={page.href}>
                <SidebarMenuButton
                  isActive={pathname === page.href}
                  render={<Link href={page.href} />}
                >
                  <page.icon className="size-4" />
                  <span>{page.label}</span>
                </SidebarMenuButton>
                {page.badge > 0 ? <SidebarMenuBadge>{page.badge}</SidebarMenuBadge> : null}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>{t("Teammates")}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {isLoading ? <SidebarMenuSkeleton showIcon /> : null}
            {isError ? (
              <p className="px-2 py-1 text-sm text-muted-foreground">{t("Run is unavailable")}</p>
            ) : null}
            {data?.bots.map((bot) => {
              const dm = data.threads.find(
                (thread) => thread.kind === "dm" && thread.botIds[0] === bot.id,
              );
              const href = dm ? `/run/threads/${dm.id}` : `/run/teammates/${bot.id}`;
              return (
                <SidebarMenuItem key={bot.id}>
                  <SidebarMenuButton isActive={pathname === href} render={<Link href={href} />}>
                    <TeammateAvatar name={bot.name} icon={bot.icon} accent={bot.accent} size="sm" />
                    <span className="truncate">{bot.name}</span>
                  </SidebarMenuButton>
                  {dm?.unread ? (
                    <SidebarMenuBadge>
                      <span className="size-2 rounded-full bg-primary" aria-label={t("Unread")} />
                    </SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              );
            })}
            {data ? (
              <SidebarMenuItem>
                <SidebarMenuButton render={<Link href="/run/teammates/new" />}>
                  <Plus className="size-4" />
                  <span>{t("Add teammate")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ) : null}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>{t("Threads")}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {data && threads.length === 0 ? (
              <p className="px-2 py-1 text-sm text-muted-foreground">{t("No threads yet")}</p>
            ) : null}
            {threads.map((thread) => (
              <SidebarMenuItem key={thread.id}>
                <SidebarMenuButton
                  isActive={pathname === `/run/threads/${thread.id}`}
                  render={<Link href={`/run/threads/${thread.id}`} />}
                  className={thread.unread ? "font-semibold" : undefined}
                >
                  <span className="truncate">{thread.title}</span>
                </SidebarMenuButton>
                {thread.unread ? (
                  <SidebarMenuBadge>
                    <span className="size-2 rounded-full bg-primary" aria-label={t("Unread")} />
                  </SidebarMenuBadge>
                ) : null}
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

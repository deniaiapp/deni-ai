import { Bell, CalendarClock, Plus, Settings, Sparkles, Users } from "lucide-react";
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
 * Sidebar body for Run mode. Run keeps its own history, separate from chats.
 * Conversations are reached through who they are with: a teammate opens its DM,
 * and group conversations (several teammates) follow the teammates. There is no
 * separate thread list, so each conversation appears once.
 */
export function RunSidebarContent() {
  const t = useExtracted();
  const pathname = usePathname();
  const { data, isLoading, isError } = useRunState();
  const groups = (data?.threads ?? [])
    .filter((thread) => thread.kind === "group" && !thread.hidden)
    .toSorted(
      (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
    );

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
      <SidebarGroup className="px-1">
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
      <SidebarGroup className="px-1">
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
            {groups.map((group) => {
              const href = `/run/threads/${group.id}`;
              return (
                <SidebarMenuItem key={group.id}>
                  <SidebarMenuButton
                    isActive={pathname === href}
                    render={<Link href={href} />}
                    className={group.unread ? "font-semibold" : undefined}
                  >
                    <Users className="size-4" aria-label={t("Group")} />
                    <span className="truncate">{group.title}</span>
                  </SidebarMenuButton>
                  {group.unread ? (
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
    </>
  );
}

import { Plus } from "lucide-react";
import { useExtracted } from "use-intl";
import { Button } from "@deniai/ui/components/button";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from "@deniai/ui/components/sidebar";
import { Link } from "@/lib/navigation";

/**
 * Sidebar body for Run mode. Run keeps its own history, separate from chats;
 * the lists stay empty until Run's data lives in this app.
 */
export function RunSidebarContent() {
  const t = useExtracted();

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
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>{t("Teammates")}</SidebarGroupLabel>
        <SidebarGroupContent>
          <p className="px-2 py-1 text-sm text-muted-foreground">{t("No teammates yet")}</p>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>{t("Threads")}</SidebarGroupLabel>
        <SidebarGroupContent>
          <p className="px-2 py-1 text-sm text-muted-foreground">{t("No threads yet")}</p>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}

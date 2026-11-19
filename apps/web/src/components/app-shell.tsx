import { dynamic } from "@/lib/dynamic";
import { usePathname } from "@/lib/navigation";
import { useEffect, useState } from "react";
import { useRouteContext } from "@tanstack/react-router";
import { AppSidebar } from "@/components/app-sidebar";
import { ChatRouteHost } from "@/components/chat/chat-route-host";
import { AppHeader } from "@deniai/ui/components/app-header";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@deniai/ui/components/sidebar";
import { cn } from "@/lib/utils";
import { isSettingsAreaRoute } from "@/lib/settings-routes";
import { useGoToNewChat } from "@/hooks/use-new-chat";
import { usePreferredModelSync } from "@/hooks/use-preferred-model";
import { SIDEBAR_WIDTH_CSS_VAR, SIDEBAR_WIDTH_DEFAULT } from "@/lib/sidebar-width";

const ChatSearch = dynamic(
  () => import("@/components/chat/chat-search").then((mod) => mod.ChatSearch),
  { loading: () => null },
);
const TwoFactorBanner = dynamic(
  () => import("@/components/two-factor-banner").then((mod) => mod.TwoFactorBanner),
  {
    // Same bar as the loaded header (it always renders one), so the page below
    // does not jump down when the chunk arrives.
    loading: () => (
      <AppHeader>
        <SidebarTrigger className="-ml-1" />
      </AppHeader>
    ),
  },
);
const FlashOfferStrip = dynamic(
  () => import("@/components/billing/flash-offer-strip").then((mod) => mod.FlashOfferStrip),
  { loading: () => null },
);

export function AppShell({ children }: { children: React.ReactNode }) {
  // Track which pathname the dialog was opened for so navigation closes it
  // without a setState-in-effect (React Compiler / cascading render rule).
  const pathname = usePathname();
  const [chatSearchPath, setChatSearchPath] = useState<string | null>(null);
  const isChatSearchOpen = chatSearchPath === pathname;
  const startNewChat = useGoToNewChat();
  // The composer's default model follows the account across devices.
  usePreferredModelSync();
  const twoFactor = useRouteContext({
    from: "/_app",
    select: (context) => context.authState.twoFactor,
  });

  const setIsChatSearchOpen = (open: boolean) => {
    setChatSearchPath(open ? pathname : null);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const role = target?.getAttribute("role");
      const isEditable =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          role === "textbox");
      if (isEditable) {
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "k") {
        e.preventDefault();
        setChatSearchPath(pathname);
      }
      if (mod && key === "n") {
        e.preventDefault();
        startNewChat();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pathname, startNewChat]);

  return (
    // Cap the shell at the viewport so the chat list scrolls inside its own
    // container (auto-scroll) and the composer stays pinned to the bottom.
    <SidebarProvider
      className="h-svh"
      // User-resized width (see SidebarResizeHandle), restored before first paint.
      style={
        {
          "--sidebar-width": `var(${SIDEBAR_WIDTH_CSS_VAR}, ${SIDEBAR_WIDTH_DEFAULT}px)`,
        } as React.CSSProperties
      }
    >
      {isChatSearchOpen ? <ChatSearch open onOpenChange={setIsChatSearchOpen} /> : null}
      <AppSidebar onOpenChatSearch={() => setIsChatSearchOpen(true)} />
      <SidebarInset className="min-h-0 overflow-hidden">
        <TwoFactorBanner twoFactor={twoFactor} />
        <FlashOfferStrip />
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-3 md:p-5",
            // Settings pages differ in length; reserve the scrollbar so the
            // layout keeps its width whether or not the page scrolls.
            isSettingsAreaRoute(pathname) && "[scrollbar-gutter:stable]",
          )}
        >
          {/* Chat routes: SPA host. Everything else: the matched route. */}
          <ChatRouteHost>{children}</ChatRouteHost>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

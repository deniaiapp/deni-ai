import type { UIMessage } from "ai";
import { FolderKanban } from "lucide-react";
import { dynamic } from "@/lib/dynamic";
import { useExtracted } from "use-intl";
import { Badge } from "@/components/ui/badge";

const ChatExportMenu = dynamic(
  () => import("@/components/chat/chat-export-menu").then((mod) => mod.ChatExportMenu),
  { ssr: false },
);

export interface ChatInterfaceHeaderProps {
  chatId: string;
  messages: UIMessage[];
  initialTitle?: string | null;
  initialProjectId?: string | null;
  initialProjectName?: string | null;
}

export function ChatInterfaceHeader({
  chatId,
  messages,
  initialTitle,
  initialProjectId,
  initialProjectName,
}: ChatInterfaceHeaderProps) {
  const t = useExtracted();

  return (
    <div className="mb-3 flex items-center gap-2 min-h-7">
      {initialProjectId && initialProjectName ? (
        <Badge variant="outline" className="gap-1.5 rounded-full px-2.5 py-1 text-xs">
          <FolderKanban className="size-3.5" />
          <span className="text-muted-foreground">{t("Projects")}</span>
          <span className="text-foreground">{initialProjectName}</span>
        </Badge>
      ) : null}
      {messages.length > 0 ? (
        <div className="ml-auto">
          <ChatExportMenu chatId={chatId} messages={messages} chatTitle={initialTitle ?? null} />
        </div>
      ) : null}
    </div>
  );
}

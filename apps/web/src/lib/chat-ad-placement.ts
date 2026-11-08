import type { ChatStatus, UIMessage } from "ai";

export function shouldShowChatAd({
  status,
  lastMessage,
  isWaitingForResponse,
  hasError,
}: {
  status: ChatStatus;
  lastMessage: UIMessage | undefined;
  isWaitingForResponse: boolean;
  hasError: boolean;
}) {
  return (
    status === "ready" && !isWaitingForResponse && !hasError && lastMessage?.role === "assistant"
  );
}

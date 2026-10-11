import type { ChatStatus, UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";
import { isChatCreationPending } from "@/lib/chat-creation";
import { mergeServerWindow } from "@/lib/chat-messages";
import { trpc } from "@/lib/trpc/react";

/** Delay before re-reading the page after a failed recovery fetch (`fetch` does not retry). */
const RECOVERY_RETRY_DELAY_MS = 1000;

export function useChatPageSync(params: {
  id: string;
  status: ChatStatus;
  isWaitingForResponse: boolean;
  activeGenerationId: string | null | undefined;
  statusUpdatedAt: Date | null | undefined;
  isStatusSuccess: boolean;
  setMessages: (messages: UIMessage[] | ((current: UIMessage[]) => UIMessage[])) => void;
}) {
  const {
    id,
    status,
    isWaitingForResponse,
    activeGenerationId,
    statusUpdatedAt,
    isStatusSuccess,
    setMessages,
  } = params;
  const utils = trpc.useUtils();
  const lastRecoveredStatusRef = useRef<number | null>(null);
  const previousStatusRef = useRef(status);
  const [recoveryRetry, setRecoveryRetry] = useState(0);

  // Each poll deserializes a new Date; keying the effect on it would cancel an
  // in-flight recovery every second and the guard below would never retry it.
  const recoveredAt = statusUpdatedAt?.getTime() ?? null;

  useEffect(() => {
    if (
      !isWaitingForResponse ||
      !isStatusSuccess ||
      activeGenerationId ||
      recoveredAt === null ||
      lastRecoveredStatusRef.current === recoveredAt
    ) {
      return;
    }

    lastRecoveredStatusRef.current = recoveredAt;
    let cancelled = false;
    let settled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    // The pane loaded this page (with the pending answer) moments ago, so a
    // cached read would still be fresh and return that same pending snapshot.
    void utils.chat.getChatPage
      .fetch({ id }, { staleTime: 0 })
      .then((chat) => {
        settled = true;
        if (cancelled || !chat?.messages) {
          return;
        }

        const serverMessages = chat.messages as UIMessage[];

        setMessages((current) => {
          if (serverMessages.length === 0 && current.length > 0) {
            return current;
          }

          // Loaded history can be longer than the server's latest-message window.
          // Match the current turn, including windows containing only assistant
          // continuations, without replacing a newer local question with old data.
          const lastLocalMessage = current.at(-1);
          const lastLocalUser = current.findLast((message) => message.role === "user");
          if (
            lastLocalUser &&
            !serverMessages.some(
              (message) => message.id === lastLocalUser.id || message.id === lastLocalMessage?.id,
            )
          ) {
            return current;
          }

          return mergeServerWindow(current, serverMessages);
        });
      })
      .catch(() => {
        settled = true;
        if (!cancelled) {
          lastRecoveredStatusRef.current = null;
          // Once the answer is saved the polls stop changing, so nothing else
          // re-runs this effect for the same status.
          retryTimer = setTimeout(
            () => setRecoveryRetry((count) => count + 1),
            RECOVERY_RETRY_DELAY_MS,
          );
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      // A recovery cut short by a re-run (or a Strict Mode remount) may start again.
      if (!settled && lastRecoveredStatusRef.current === recoveredAt) {
        lastRecoveredStatusRef.current = null;
      }
    };
  }, [
    activeGenerationId,
    id,
    isStatusSuccess,
    isWaitingForResponse,
    recoveredAt,
    recoveryRetry,
    setMessages,
    utils,
  ]);

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = status;

    const hadInFlightRequest = previousStatus === "submitted" || previousStatus === "streaming";
    const requestSettled = status === "ready" || status === "error";

    if (!hadInFlightRequest || !requestSettled) {
      return;
    }

    void utils.billing.usage.invalidate();
    // A request also settles when the chat's row could not be created. The
    // server has no page for it then, and refetching would replace the seeded
    // page with null, unmounting the prompt, its attachments and the error.
    if (!isChatCreationPending(id)) {
      void utils.chat.getChatPage.invalidate({ id });
    }
  }, [id, status, utils]);
}

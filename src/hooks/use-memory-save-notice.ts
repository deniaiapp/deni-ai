import type { ChatStatus } from "ai";
import { useRouter } from "@/lib/navigation";
import { useExtracted } from "use-intl";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/react";

/**
 * Auto-memory extraction runs in an after() task once the chat SSE closes
 * (see src/server/http/chat/route.ts), so saved rows land a few seconds later and
 * cannot ride along on the response. Poll a bounded number of times instead,
 * and diff by item id so a client/DB clock skew can never hide a save.
 */
const POLL_DELAYS_MS = [2500, 4000, 6000];
/**
 * `fetch()` returns cached data while it is fresh (global staleTime is 60s), so
 * every poll would just replay the baseline. Always hit the network instead.
 */
const FRESH_FETCH = { staleTime: 0 } as const;

export function useMemorySaveNotice({
  status,
  enabled = true,
}: {
  status: ChatStatus;
  enabled?: boolean;
}) {
  const t = useExtracted();
  const router = useRouter();
  const utils = trpc.useUtils();
  const previousStatusRef = useRef(status);
  const knownIdsRef = useRef<Set<string> | null>(null);
  const autoMemoryRef = useRef(true);

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = status;

    if (!enabled) {
      knownIdsRef.current = null;
      return;
    }

    const isInFlight = status === "submitted" || status === "streaming";
    const wasInFlight = previousStatus === "submitted" || previousStatus === "streaming";

    // Baseline before the turn can add anything, so the diff below only ever
    // reports memories produced by the message that was just sent.
    if (isInFlight && !wasInFlight) {
      void utils.memory.get
        .fetch(undefined, FRESH_FETCH)
        .then((data) => {
          autoMemoryRef.current = data.profile.autoMemory;
          knownIdsRef.current = new Set(data.items.map((item) => item.id));
        })
        .catch(() => {
          knownIdsRef.current = null;
        });
      return;
    }

    const knownIds = knownIdsRef.current;
    if (status !== "ready" || !wasInFlight || !knownIds || !autoMemoryRef.current) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async (attempt: number) => {
      const data = await utils.memory.get.fetch(undefined, FRESH_FETCH).catch(() => null);
      if (cancelled || !data) {
        return;
      }

      const saved = data.items.filter((item) => !knownIds.has(item.id));
      // Refresh the baseline either way; giving up mid-poll must not leave
      // stale ids that would resurface as "new" on the next message.
      knownIdsRef.current = new Set(data.items.map((item) => item.id));

      if (saved.length > 0) {
        utils.memory.get.setData(undefined, data);
        toast.success(t("Saved to memory"), {
          description: saved.map((item) => item.content).join("\n"),
          action: {
            label: t("View"),
            onClick: () => router.push("/settings/memory"),
          },
        });
        return;
      }

      const nextDelay = POLL_DELAYS_MS[attempt + 1];
      if (nextDelay !== undefined) {
        timer = setTimeout(() => void poll(attempt + 1), nextDelay);
      }
    };

    timer = setTimeout(() => void poll(0), POLL_DELAYS_MS[0]);

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [enabled, router, status, t, utils]);
}

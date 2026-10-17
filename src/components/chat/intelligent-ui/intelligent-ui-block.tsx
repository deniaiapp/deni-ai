"use client";

import { Sparkles } from "lucide-react";
import { useExtracted } from "next-intl";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useIntelligentUiMessage } from "@/components/chat/intelligent-ui/intelligent-ui-context";
import { IntelligentUiChart } from "@/components/chat/intelligent-ui/intelligent-ui-chart";
import {
  IntelligentUiActions,
  IntelligentUiCalculator,
  IntelligentUiCards,
  IntelligentUiChecklist,
  IntelligentUiForm,
  IntelligentUiQuiz,
} from "@/components/chat/intelligent-ui/intelligent-ui-interactive";
import {
  IntelligentUiComparison,
  IntelligentUiStats,
  IntelligentUiTable,
  IntelligentUiTabs,
  IntelligentUiTimeline,
} from "@/components/chat/intelligent-ui/intelligent-ui-widgets";
import { type IntelligentUiBlock, parseIntelligentUiBlock } from "@/lib/intelligent-ui/schema";
import { cn } from "@/lib/utils";

function renderBlock(block: IntelligentUiBlock): ReactNode {
  switch (block.type) {
    case "chart":
      return <IntelligentUiChart chart={block} />;
    case "stats":
      return <IntelligentUiStats block={block} />;
    case "checklist":
      return <IntelligentUiChecklist block={block} />;
    case "actions":
      return <IntelligentUiActions block={block} />;
    case "calculator":
      return <IntelligentUiCalculator block={block} />;
    case "timeline":
      return <IntelligentUiTimeline block={block} />;
    case "comparison":
      return <IntelligentUiComparison block={block} />;
    case "table":
      return <IntelligentUiTable block={block} />;
    case "cards":
      return <IntelligentUiCards block={block} />;
    case "tabs":
      return <IntelligentUiTabs block={block} />;
    case "form":
      return <IntelligentUiForm block={block} />;
    case "quiz":
      return <IntelligentUiQuiz block={block} />;
  }
}

/** Components that read as part of the text get no card chrome. */
const BARE_TYPES = new Set<IntelligentUiBlock["type"]>(["actions", "stats", "cards"]);

/**
 * Renders a ```ui block. While the answer is still streaming an incomplete spec
 * shows a placeholder; a finished block that does not validate is handed back
 * to the caller (`fallback`) to show as an ordinary code block.
 */
export function IntelligentUiBlockView({ code, fallback }: { code: string; fallback: ReactNode }) {
  const t = useExtracted();
  const { isStreaming } = useIntelligentUiMessage();
  const parsed = parseIntelligentUiBlock(code);

  if (!parsed.ok) {
    if (isStreaming) {
      return (
        <div
          aria-busy
          className="intelligent-ui not-prose my-4 space-y-3 rounded-xl border bg-card p-4"
          role="status"
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="size-3.5 animate-pulse" />
            {t("Building interactive view…")}
          </div>
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-28 w-full" />
        </div>
      );
    }
    return fallback;
  }

  const { block } = parsed;
  const bare = BARE_TYPES.has(block.type) && !block.title && !block.description;

  return (
    <section
      aria-label={block.title}
      className={cn(
        "intelligent-ui not-prose my-4 text-card-foreground",
        !bare && "rounded-xl border bg-card p-4 shadow-xs",
      )}
      data-intelligent-ui={block.type}
    >
      {block.title || block.description ? (
        <header className="mb-3 space-y-0.5">
          {block.title ? (
            <h3 className="text-base font-semibold leading-snug">{block.title}</h3>
          ) : null}
          {block.description ? (
            <p className="text-sm text-muted-foreground">{block.description}</p>
          ) : null}
        </header>
      ) : null}
      {renderBlock(block)}
    </section>
  );
}

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import type { UIMessage } from "ai";
import type { ComponentProps, HTMLAttributes } from "react";
import { memo, useEffect, useState } from "react";
import { Streamdown } from "streamdown";

import { cn } from "@/lib/utils";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full min-w-0",
      from === "user" ? "is-user justify-end" : "is-assistant flex-col items-stretch gap-2",
      className,
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({ children, className, ...props }: MessageContentProps) => (
  <div
    className={cn(
      "flex max-w-full flex-col gap-2 text-sm",
      "group-[.is-user]:w-max group-[.is-user]:rounded-3xl group-[.is-user]:bg-neutral-80 group-[.is-user]:text-foreground",
      "group-[.is-assistant]:min-w-0 group-[.is-assistant]:w-fit group-[.is-assistant]:rounded-2xl group-[.is-assistant]:bg-surface-37 group-[.is-assistant]:text-neutral-231",
      className,
    )}
    {...props}
  >
    <div className="px-3.5 py-2.5">{children}</div>
  </div>
);

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

const basePlugins = { cjk, code };

type MathPlugin = typeof import("@streamdown/math").math;
type MermaidPlugin = typeof import("@streamdown/mermaid").mermaid;

export const MessageResponse = memo(
  ({ className, children, ...props }: MessageResponseProps) => {
    const text = typeof children === "string" ? children : "";
    const mermaidNeeded = text.includes("```mermaid");
    const mathNeeded = text.includes("$") || text.includes("\\(");
    const [loaded, setLoaded] = useState<{ math?: MathPlugin; mermaid?: MermaidPlugin }>({});

    useEffect(() => {
      const wantMath = mathNeeded && !loaded.math;
      const wantMermaid = mermaidNeeded && !loaded.mermaid;
      if (!wantMath && !wantMermaid) return;
      let cancelled = false;
      void Promise.all([
        wantMath ? import("@streamdown/math") : null,
        wantMermaid ? import("@streamdown/mermaid") : null,
      ]).then(([mathMod, mermaidMod]) => {
        if (cancelled) return;
        setLoaded((current) => ({
          ...current,
          ...(mathMod ? { math: mathMod.math } : {}),
          ...(mermaidMod ? { mermaid: mermaidMod.mermaid } : {}),
        }));
      });
      return () => {
        cancelled = true;
      };
    }, [mathNeeded, mermaidNeeded, loaded.math, loaded.mermaid]);

    const extra = {
      ...(mathNeeded && loaded.math ? { math: loaded.math } : {}),
      ...(mermaidNeeded && loaded.mermaid ? { mermaid: loaded.mermaid } : {}),
    };

    return (
      <Streamdown
        className={cn("max-w-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
        plugins={{ ...basePlugins, ...extra }}
        {...props}
      >
        {children}
      </Streamdown>
    );
  },
  (prev, next) => prev.children === next.children && prev.isAnimating === next.isAnimating,
);

MessageResponse.displayName = "MessageResponse";

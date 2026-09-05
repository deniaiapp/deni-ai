"use client";

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
      "group-[.is-user]:w-max group-[.is-user]:rounded-2xl group-[.is-user]:bg-[#272727] group-[.is-user]:text-[#f0f0f0]",
      "group-[.is-assistant]:min-w-0 group-[.is-assistant]:w-full group-[.is-assistant]:text-[#e7e7e7]",
      className,
    )}
    {...props}
  >
    <div className="group-[.is-user]:px-4 group-[.is-user]:py-3">{children}</div>
  </div>
);

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

const basePlugins = { cjk, code };

export const MessageResponse = memo(
  ({ className, children, ...props }: MessageResponseProps) => {
    const text = typeof children === "string" ? children : "";
    const mermaidNeeded = text.includes("```mermaid");
    const mathNeeded = text.includes("$") || text.includes("\\(");
    const [extra, setExtra] = useState<Record<string, unknown>>({});

    useEffect(() => {
      if (!mermaidNeeded && !mathNeeded) {
        setExtra({});
        return;
      }
      let cancelled = false;
      void Promise.all([
        mathNeeded ? import("@streamdown/math") : null,
        mermaidNeeded ? import("@streamdown/mermaid") : null,
      ]).then(([mathMod, mermaidMod]) => {
        if (cancelled) return;
        setExtra({
          ...(mathMod ? { math: mathMod.math } : {}),
          ...(mermaidMod ? { mermaid: mermaidMod.mermaid } : {}),
        });
      });
      return () => {
        cancelled = true;
      };
    }, [mathNeeded, mermaidNeeded]);

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

import { cjk } from "@streamdown/cjk";
import type { UIMessage } from "ai";
import type { ComponentProps, HTMLAttributes, RefObject } from "react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { defaultComponents, Streamdown, type ExtraProps } from "streamdown";

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

/** True once the element's content is taller than one line of its text. */
function useMultiline(ref: RefObject<HTMLElement | null>) {
  const [multiline, setMultiline] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 20;
    // contentRect excludes padding, so changing the padding never flips the result by itself.
    const observer = new ResizeObserver(([entry]) => {
      setMultiline(entry.contentRect.height > lineHeight * 1.5);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return multiline;
}

export const MessageContent = ({ children, className, ...props }: MessageContentProps) => {
  const bodyRef = useRef<HTMLDivElement>(null);
  const multiline = useMultiline(bodyRef);
  return (
    <div
      className={cn(
        "flex max-w-full flex-col gap-2 text-sm",
        // Long unbroken text such as a URL wraps inside the bubble instead of pushing it sideways.
        "group-[.is-user]:w-max group-[.is-user]:rounded-3xl group-[.is-user]:bg-neutral-80 group-[.is-user]:text-foreground group-[.is-user]:wrap-anywhere group-[.is-user]:[&_pre]:overflow-x-auto",
        "group-[.is-assistant]:min-w-0 group-[.is-assistant]:w-fit group-[.is-assistant]:rounded-2xl group-[.is-assistant]:bg-surface-37 group-[.is-assistant]:text-neutral-231",
        className,
      )}
      {...props}
    >
      <div ref={bodyRef} className={cn("min-w-0", multiline ? "px-4.5 py-3.5" : "px-3.5 py-2.5")}>
        {children}
      </div>
    </div>
  );
};

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

const basePlugins = { cjk };

type ParagraphProps = ComponentProps<"p"> & ExtraProps;

/** A paragraph that holds nothing but bold text, which models use as a small heading. */
function isBoldOnly(node: ExtraProps["node"]) {
  const children = node?.children.filter((child) => child.type !== "text" || child.value.trim() !== "") ?? [];
  return children.length === 1 && children[0].type === "element" && children[0].tagName === "strong";
}

// Bold-only lines sit closer to what they introduce: 8px below instead of the 16px gap between
// blocks. Important, because the space-y-4 rule on the container has the same specificity.
function Paragraph({ className, ...props }: ParagraphProps) {
  const DefaultParagraph = defaultComponents.p;
  return <DefaultParagraph {...props} className={cn(className, isBoldOnly(props.node) && "not-last:mb-2!")} />;
}

const components = { p: Paragraph };

// Highlighting (Shiki), math, and diagrams load the first time a message needs them, so the
// workspace bundle stays small.
type CodePlugin = typeof import("@streamdown/code").code;
type MathPlugin = typeof import("@streamdown/math").math;
type MermaidPlugin = typeof import("@streamdown/mermaid").mermaid;

export const MessageResponse = memo(
  ({ className, children, ...props }: MessageResponseProps) => {
    const text = typeof children === "string" ? children : "";
    const codeNeeded = text.includes("```");
    const mermaidNeeded = text.includes("```mermaid");
    const mathNeeded = text.includes("$") || text.includes("\\(");
    const [loaded, setLoaded] = useState<{ code?: CodePlugin; math?: MathPlugin; mermaid?: MermaidPlugin }>({});

    useEffect(() => {
      const wantCode = codeNeeded && !loaded.code;
      const wantMath = mathNeeded && !loaded.math;
      const wantMermaid = mermaidNeeded && !loaded.mermaid;
      if (!wantCode && !wantMath && !wantMermaid) return;
      let cancelled = false;
      void Promise.all([
        wantCode ? import("@streamdown/code") : null,
        wantMath ? import("@streamdown/math") : null,
        wantMermaid ? import("@streamdown/mermaid") : null,
      ]).then(([codeMod, mathMod, mermaidMod]) => {
        if (cancelled) return;
        setLoaded((current) => ({
          ...current,
          ...(codeMod ? { code: codeMod.code } : {}),
          ...(mathMod ? { math: mathMod.math } : {}),
          ...(mermaidMod ? { mermaid: mermaidMod.mermaid } : {}),
        }));
      });
      return () => {
        cancelled = true;
      };
    }, [codeNeeded, mathNeeded, mermaidNeeded, loaded.code, loaded.math, loaded.mermaid]);

    const extra = {
      ...(codeNeeded && loaded.code ? { code: loaded.code } : {}),
      ...(mathNeeded && loaded.math ? { math: loaded.math } : {}),
      ...(mermaidNeeded && loaded.mermaid ? { mermaid: loaded.mermaid } : {}),
    };

    return (
      <Streamdown
        className={cn("max-w-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
        plugins={{ ...basePlugins, ...extra }}
        components={components}
        {...props}
      >
        {children}
      </Streamdown>
    );
  },
  (prev, next) => prev.children === next.children && prev.isAnimating === next.isAnimating,
);

MessageResponse.displayName = "MessageResponse";

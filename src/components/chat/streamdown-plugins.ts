"use client";

import { cjk } from "@streamdown/cjk";
import type { MathPlugin, PluginConfig } from "streamdown";
import { useEffect, useMemo, useState } from "react";
import { streamdownCodePlugin } from "@/components/chat/streamdown-code-plugin";
import { lazyMermaid } from "@/components/chat/streamdown-mermaid-plugin";

export const streamdownPlugins: PluginConfig = {
  cjk,
  code: streamdownCodePlugin,
  mermaid: lazyMermaid,
};

/**
 * Runs on every render of every message (and each streamed chunk), so it must
 * stay linear. In the inline branch a backslash may only start a `\\.` escape:
 * letting `[^$\n]` match it too gives each escape two parses, so a line such as
 * `$env:Path = "C:\Windows;C:\Tools;..."` backtracks exponentially and freezes
 * the tab.
 */
const MATH_SYNTAX =
  /(?:\$\$[\s\S]+?\$\$|\$(?!\s)(?:\\.|[^$\n\\])+\$(?!\w)|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\])/;

export function hasMathSyntax(content: string) {
  return MATH_SYNTAX.test(content);
}

let mathPluginPromise: Promise<MathPlugin> | null = null;

function loadMathPlugin() {
  mathPluginPromise ??= import("@streamdown/math").then(({ math }) => math);
  return mathPluginPromise;
}

export function useStreamdownPlugins(content: string) {
  const hasMath = hasMathSyntax(content);
  const [math, setMath] = useState<MathPlugin | null>(null);

  useEffect(() => {
    if (!hasMath || math) {
      return;
    }

    let active = true;
    void loadMathPlugin()
      .then((plugin) => {
        if (active) {
          setMath(plugin);
        }
      })
      .catch(() => {
        // Math is an enhancement; Markdown rendering remains usable without it.
      });

    return () => {
      active = false;
    };
  }, [hasMath, math]);

  return useMemo(() => (math ? { ...streamdownPlugins, math } : streamdownPlugins), [math]);
}

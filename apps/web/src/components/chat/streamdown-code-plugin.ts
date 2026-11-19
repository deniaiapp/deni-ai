import type { PluginConfig } from "streamdown";
import { isHighlightLanguage, supportedHighlightLanguages } from "@/lib/sugar-high-highlighter";

function tokensFromCode(code: string) {
  return code.split("\n").map((line) => (line === "" ? [] : [{ content: line }]));
}

export const streamdownCodePlugin = {
  getSupportedLanguages: () => supportedHighlightLanguages,
  getThemes: () => ["github-light", "github-dark"],
  highlight({ code }: { code: string; language: string }, callback) {
    // Visual highlighting happens in CodeBlock via Sugar High HTML.
    // Streamdown still expects a token payload for its built-in body.
    const result = {
      bg: "transparent",
      fg: "inherit",
      tokens: tokensFromCode(code),
    };
    callback?.(result);
    return result;
  },
  name: "shiki",
  supportsLanguage: (language: string) => isHighlightLanguage(language),
  type: "code-highlighter",
} as NonNullable<PluginConfig["code"]>;

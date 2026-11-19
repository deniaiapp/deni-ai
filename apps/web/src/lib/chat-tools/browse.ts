import { tool } from "ai";
import { z } from "zod";
import {
  DEFAULT_BROWSE_MAX_CHARS,
  fetchPageText,
  MAX_BROWSE_MAX_CHARS,
  MIN_BROWSE_MAX_CHARS,
} from "./fetch-page";

export function createBrowseTool() {
  return tool({
    description:
      "Open a specific URL and read its page content as cleaned text. Use when the user provides a link, search snippets are insufficient, or you need details from a known page. Tries a direct fetch first, then falls back to a reader proxy if blocked.",
    inputSchema: z.object({
      url: z.url().describe("The HTTP or HTTPS URL of the page to open and read"),
      maxChars: z
        .number()
        .int()
        .min(MIN_BROWSE_MAX_CHARS)
        .max(MAX_BROWSE_MAX_CHARS)
        .optional()
        .describe(
          `Maximum characters of page text to return (default ${DEFAULT_BROWSE_MAX_CHARS}, max ${MAX_BROWSE_MAX_CHARS})`,
        ),
    }),
    execute: async ({ url, maxChars }, { abortSignal }) => {
      try {
        const page = await fetchPageText(url, {
          maxChars,
          signal: abortSignal,
        });

        if (!page.content) {
          return {
            url: page.url,
            title: page.title,
            content: "",
            truncated: false,
            contentLength: 0,
            source: page.source,
            error: "No readable text content found on this page.",
          };
        }

        return {
          url: page.url,
          title: page.title,
          content: page.content,
          truncated: page.truncated,
          contentLength: page.contentLength,
          source: page.source,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to open page";
        console.error("Browse tool error:", error);
        return {
          url,
          title: null,
          content: "",
          truncated: false,
          contentLength: 0,
          error: message,
        };
      }
    },
  });
}

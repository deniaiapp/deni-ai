// Common types, type guards, and utility functions for chat interfaces
import type { UIDataTypes, UIMessagePart, UITools } from "ai";

export type SearchResult = {
  title: string;
  url: string;
  description: string;
};

export type BrowseToolOutput = {
  url: string;
  title?: string | null;
  content: string;
  truncated?: boolean;
  contentLength?: number;
  source?: "direct" | "reader" | null;
  error?: string | null;
};

export type BrowseToolInput = {
  url?: string;
  maxChars?: number;
};

export const isSearchResultArray = (value: unknown): value is SearchResult[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      item !== null &&
      typeof item === "object" &&
      "title" in item &&
      "url" in item &&
      "description" in item,
  );

export const isBrowseToolOutput = (value: unknown): value is BrowseToolOutput => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { url?: unknown; content?: unknown };
  return typeof candidate.url === "string" && typeof candidate.content === "string";
};

export const isBrowseToolInput = (value: unknown): value is BrowseToolInput => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as { url?: unknown };
  return candidate.url === undefined || typeof candidate.url === "string";
};

// Image and video generation were retired; saved chats can still contain their results.
export const hasSuccessfulToolPart = (
  parts: UIMessagePart<UIDataTypes, UITools>[] | undefined,
  type: "tool-image" | "tool-video",
): boolean =>
  parts?.some(
    (part) => part.type === type && "state" in part && part.state === "output-available",
  ) ?? false;

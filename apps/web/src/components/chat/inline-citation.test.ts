import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { MessageResponse } from "@/components/ai-elements/message";
import { CitationSourcesProvider } from "@/components/chat/inline-citation";
import type { CitationSource } from "@/lib/chat-citations";

vi.mock("use-intl", () => import("@/test/intl-mock"));

const sources = new Map<number, CitationSource>([
  [1, { id: 1, title: "Tokyo guide", url: "https://example.com/tokyo" }],
  [2, { id: 2, title: "Osaka guide", url: "https://example.com/osaka" }],
]);

const render = (markdown: string, cited = sources) =>
  renderToStaticMarkup(
    createElement(CitationSourcesProvider, {
      sources: cited,
      children: createElement(MessageResponse, { mode: "static" }, markdown),
    }),
  );

test("a marker becomes a button that opens its source", () => {
  const html = render("Tokyo is the capital. [cite:1] Next sentence.");

  expect(html).toContain('href="https://example.com/tokyo"');
  expect(html).toContain('target="_blank"');
  expect(html).toContain("Tokyo guide");
  expect(html).not.toContain("[cite:1]");
});

test("several sources share one button that counts the rest", () => {
  const html = render("Both cities are large.[cite:1, 2]");

  expect(html).toContain("Tokyo guide");
  expect(html).toContain("+1");
  expect(html).not.toContain("[cite:");
});

test("unknown ids are hidden and code keeps markers literally", () => {
  const html = render("Unknown claim. [cite:9]\n\n`[cite:1]`");

  expect(html).not.toContain("[cite:9]");
  expect(html).toContain("<code");
  expect(html).toContain("[cite:1]");
  expect(html).not.toContain("example.com/tokyo");
});

test("footnotes still render as superscripts", () => {
  const html = render("Note[^1]\n\n[^1]: Source");

  expect(html).toContain("<sup");
  expect(html).toContain("user-content-fn-1");
});

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import { expect, test, vi } from "vitest";
import { MessageResponse } from "@/components/ai-elements/message";
import { classifyStreamdownImageSource } from "@/components/chat/streamdown-image";
import { streamdownRehypePlugins } from "@/components/chat/streamdown-rehype-plugins";

vi.mock("next-intl", () => ({
  useExtracted: () => (message: string, values?: Record<string, string>) =>
    message.replace(/\{(\w+)\}/g, (_, key: string) => values?.[key] ?? ""),
}));

const render = (markdown: string) =>
  renderToStaticMarkup(createElement(MessageResponse, { mode: "static" }, markdown));

test("image sources are only loaded without a click when nothing leaves the browser", () => {
  const origin = "https://deniai.app";
  expect(classifyStreamdownImageSource("data:image/png;base64,AAAA", origin)).toEqual({
    kind: "inline",
  });
  expect(classifyStreamdownImageSource("blob:https://deniai.app/1", origin)).toEqual({
    kind: "inline",
  });
  expect(classifyStreamdownImageSource("https://evil.example/p.png?q=secret", origin)).toEqual({
    kind: "external",
    host: "evil.example",
  });
  for (const src of [
    "/new/abc",
    "new/abc",
    "//evil.example/p.png",
    "https://deniai.app/new/abc",
    "javascript:alert(1)",
    undefined,
  ]) {
    expect(classifyStreamdownImageSource(src, origin)).toEqual({ kind: "blocked" });
  }
});

test("model images render a click-to-load placeholder instead of fetching", () => {
  const html = render(
    "![chart](https://evil.example/p.png?q=secret) ![x](/new/abc) " +
      '<picture><source srcset="https://evil.example/s.png"><img src="https://a.example/b.png"></picture>',
  );

  expect(html).not.toContain("<img");
  expect(html).not.toContain("<source");
  expect(html).not.toContain('rel="preload"');
  expect(html).toContain("Load image from evil.example");
  expect(html).toContain("Load image from a.example");
  expect(html).toContain("Image blocked: x");
});

test("model HTML cannot clobber document properties with name or id", () => {
  const html = renderToStaticMarkup(
    createElement(
      Streamdown,
      { mode: "static", rehypePlugins: streamdownRehypePlugins },
      'Done <img name="body" id="cookie" src="https://example.com/a.png"> <span id="dataLayer">x</span>',
    ),
  );

  expect(html).not.toMatch(/\b(name|id)="(body|cookie|dataLayer)"/);
  expect(html).toContain('name="user-content-body"');
  expect(html).toContain('id="user-content-cookie"');
  expect(html).toContain('id="user-content-dataLayer"');
});

test("footnote ids are not prefixed twice", () => {
  const html = render("Note[^1]\n\n[^1]: Source");

  expect(html).toContain('id="user-content-fn-1"');
  expect(html).not.toContain("user-content-user-content-");
});

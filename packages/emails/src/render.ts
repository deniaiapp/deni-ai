import type { ReactElement } from "react";

export type RenderedEmail = {
  html: string;
  text: string;
};

/**
 * Render a template to HTML and its plain-text alternative.
 *
 * react-email is loaded on first render: its entry also pulls in Tailwind,
 * Markdown and Prism, which callers should not pay for at import time.
 */
export async function renderEmail(element: ReactElement): Promise<RenderedEmail> {
  const { render } = await import("react-email");
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html, text };
}

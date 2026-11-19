import { describe, expect, test } from "vitest";
import { appDate } from "@/lib/version";
import { renderSitemap, sitemapEntries } from "./sitemap";

describe("sitemap", () => {
  test("excludes noindex legal pages such as tokusho while keeping indexed legal pages", () => {
    const entries = sitemapEntries();
    const urls = entries.map((entry) => entry.url);

    expect(urls.some((url) => url.endsWith("/legal/tokusho"))).toBe(false);
    expect(urls.some((url) => url.endsWith("/legal/terms"))).toBe(true);
    expect(urls.some((url) => url.endsWith("/ja/legal/terms"))).toBe(true);
  });

  test("uses the current appDate for standard page lastModified metadata", () => {
    const expectedDate = new Date(appDate);
    const terms = sitemapEntries().find((entry) => entry.url.endsWith("/legal/terms"));

    expect(terms?.lastModified).toEqual(expectedDate);
    expect(renderSitemap(terms ? [terms] : [])).toContain(
      `<lastmod>${expectedDate.toISOString()}</lastmod>`,
    );
  });
});

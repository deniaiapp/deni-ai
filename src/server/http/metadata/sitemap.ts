import { listPublishedManagedPosts } from "@/lib/blog/queries";
import { changelogEntries } from "@/lib/changelog";
import { absoluteUrl, hreflangLanguages } from "@/lib/locale-path";
import { PUBLIC_SITE_ORIGIN, type PublicPage, publicPages } from "@/lib/public-pages";

export type SitemapEntry = {
  url: string;
  lastModified: Date;
  changeFrequency: PublicPage["changeFrequency"];
  priority: number;
  alternates: { languages: Record<string, string> };
};

function sitemapEntry(
  path: string,
  locale: "en" | "ja",
  lastModified: Date,
  changeFrequency: SitemapEntry["changeFrequency"],
  priority: number,
): SitemapEntry {
  return {
    url: absoluteUrl(path, locale),
    lastModified,
    changeFrequency,
    priority,
    alternates: {
      languages: hreflangLanguages(path),
    },
  };
}

export async function sitemapEntries(): Promise<SitemapEntry[]> {
  const lastModified = new Date("2026-08-16");
  const changelogModified = new Date(changelogEntries[0]?.date ?? lastModified);
  const managedPosts = await listPublishedManagedPosts().catch(() => []);
  const blogPaths = managedPosts.map((post) => ({
    path: `/blog/${post.slug}`,
    lastModified: post.updatedAt,
  }));

  const publicEntries = publicPages.flatMap((page) => {
    if (page.path === "/") {
      return [];
    }
    const modified = page.path === "/changelog" ? changelogModified : lastModified;
    return [
      sitemapEntry(page.path, "en", modified, page.changeFrequency, page.priority),
      sitemapEntry(page.path, "ja", modified, page.changeFrequency, page.priority),
    ];
  });

  const blogEntries = blogPaths.flatMap((entry) => [
    sitemapEntry(entry.path, "en", entry.lastModified, "monthly", 0.8),
    sitemapEntry(entry.path, "ja", entry.lastModified, "monthly", 0.8),
  ]);

  return [
    {
      url: PUBLIC_SITE_ORIGIN,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
      alternates: {
        languages: hreflangLanguages("/home"),
      },
    },
    ...publicEntries,
    ...blogEntries,
  ];
}

/** Serialized the way Next.js rendered `MetadataRoute.Sitemap` with `alternates.languages`. */
export function renderSitemap(entries: SitemapEntry[]) {
  let content = '<?xml version="1.0" encoding="UTF-8"?>\n';
  content += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';
  content += entries.some((entry) => Object.keys(entry.alternates.languages).length > 0)
    ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
    : ">\n";
  for (const entry of entries) {
    content += `<url>\n<loc>${entry.url}</loc>\n`;
    for (const [language, href] of Object.entries(entry.alternates.languages)) {
      content += `<xhtml:link rel="alternate" hreflang="${language}" href="${href}" />\n`;
    }
    content += `<lastmod>${entry.lastModified.toISOString()}</lastmod>\n`;
    content += `<changefreq>${entry.changeFrequency}</changefreq>\n`;
    content += `<priority>${entry.priority}</priority>\n`;
    content += "</url>\n";
  }
  return `${content}</urlset>\n`;
}

export async function GET() {
  return new Response(renderSitemap(await sitemapEntries()), {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}

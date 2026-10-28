import { createFileRoute } from "@tanstack/react-router";
import { BLOG_ORIGIN, getBlogPostUrl } from "@/lib/blog/posts";

/** English-only feed; `/ja/blog/rss.xml` serves the same document. */
export const Route = createFileRoute("/{-$locale}/blog/rss.xml")({
  server: {
    handlers: {
      GET: () => blogRssResponse(),
    },
  },
});

async function blogRssResponse() {
  const { listPublishedManagedPosts } = await import("@/lib/blog/queries");
  const managedPosts = await listPublishedManagedPosts().catch(() => []);
  const items = managedPosts
    .map((post) => ({
      title: post.title,
      slug: post.slug,
      description: post.description,
      date: (post.publishedAt ?? post.createdAt).toISOString(),
    }))
    .sort((left, right) => right.date.localeCompare(left.date))
    .map((post) => {
      const url = getBlogPostUrl(post.slug);
      const pubDate = new Date(post.date).toUTCString();

      return `    <item>
      <title><![CDATA[${post.title}]]></title>
      <link>${url}</link>
      <guid>${url}</guid>
      <pubDate>${pubDate}</pubDate>
      <description><![CDATA[${post.description}]]></description>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Deni AI Blog</title>
    <link>${BLOG_ORIGIN}/blog</link>
    <description>Original notes from the Deni AI team on model choice, verification, bilingual writing, and practical multi-model work.</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}

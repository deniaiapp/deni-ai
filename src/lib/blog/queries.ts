import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/drizzle";
import { blogPost } from "@/db/schema";

export type ManagedBlogPost = typeof blogPost.$inferSelect;

/** Published posts change rarely; edits made through the blog admin clear the cache. */
const BLOG_CACHE_TTL_MS = 60 * 60 * 1000;

const blogCache = new Map<string, { expiresAt: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = blogCache.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.value as Promise<T>;
  }
  const value = load();
  blogCache.set(key, { expiresAt: now + BLOG_CACHE_TTL_MS, value });
  // A transient DB failure must not be cached.
  value.catch(() => blogCache.delete(key));
  return value;
}

/** Drops cached blog reads in this server instance after an admin edit. */
export function invalidateBlogCache() {
  blogCache.clear();
}

export function listPublishedManagedPosts() {
  return cached("list", () =>
    db
      .select()
      .from(blogPost)
      .where(eq(blogPost.status, "published"))
      .orderBy(desc(blogPost.publishedAt), desc(blogPost.updatedAt)),
  );
}

export function getFeaturedPublishedPost() {
  return cached("featured", async () => {
    const rows = await db
      .select()
      .from(blogPost)
      .where(and(eq(blogPost.status, "published"), eq(blogPost.featured, true)))
      .orderBy(desc(blogPost.publishedAt), desc(blogPost.updatedAt))
      .limit(1);
    return rows[0] ?? null;
  });
}

export function getPublishedManagedPost(slug: string) {
  return cached(`post:${slug}`, async () => {
    const rows = await db
      .select()
      .from(blogPost)
      .where(and(eq(blogPost.slug, slug), eq(blogPost.status, "published")))
      .limit(1);
    return rows[0] ?? null;
  });
}

export function pickManagedPostCopy(post: ManagedBlogPost, locale: string) {
  if (locale === "ja" && post.titleJa.trim()) {
    return {
      title: post.titleJa.trim(),
      description: post.descriptionJa.trim() || post.description,
      body: post.bodyJa.trim() || post.body,
    };
  }

  return {
    title: post.title,
    description: post.description,
    body: post.body,
  };
}

export function toIsoDate(value: Date | string | null | undefined) {
  if (!value) {
    return new Date().toISOString().slice(0, 10);
  }
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

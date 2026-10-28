import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { locales } from "@/i18n/locales";
import { getBlogPostPath, RESERVED_BLOG_SLUGS } from "@/lib/blog/posts";
import {
  getFeaturedPublishedPost,
  getPublishedManagedPost,
  listPublishedManagedPosts,
  pickManagedPostCopy,
  toIsoDate,
} from "@/lib/blog/queries";

const localeInput = z.object({ locale: z.enum(locales) });

export type BlogListItem = {
  slug: string;
  title: string;
  description: string;
  date: string;
  href: string;
  featured: boolean;
};

/** Published posts in `locale`, featured first, then newest first. */
export const listBlogPostsFn = createServerFn({ method: "GET" })
  .validator(localeInput)
  .handler(async ({ data }): Promise<BlogListItem[]> => {
    const managed = await listPublishedManagedPosts().catch(() => []);
    return managed
      .map((post) => {
        const copy = pickManagedPostCopy(post, data.locale);
        return {
          slug: post.slug,
          title: copy.title,
          description: copy.description,
          date: toIsoDate(post.publishedAt ?? post.createdAt),
          href: getBlogPostPath(post.slug),
          featured: post.featured,
        };
      })
      .sort((left, right) => {
        if (Boolean(left.featured) !== Boolean(right.featured)) {
          return left.featured ? -1 : 1;
        }
        return right.date.localeCompare(left.date);
      });
  });

/** One published post in `locale`; null for missing or reserved slugs. */
export const getBlogPostFn = createServerFn({ method: "GET" })
  .validator(localeInput.extend({ slug: z.string() }))
  .handler(async ({ data }) => {
    if (RESERVED_BLOG_SLUGS.has(data.slug)) {
      return null;
    }
    const post = await getPublishedManagedPost(data.slug);
    if (!post) {
      return null;
    }
    const copy = pickManagedPostCopy(post, data.locale);
    return {
      slug: post.slug,
      author: post.author,
      date: toIsoDate(post.publishedAt ?? post.createdAt),
      ...copy,
    };
  });

/** The homepage badge post, or null. */
export const getFeaturedBlogPostFn = createServerFn({ method: "GET" })
  .validator(localeInput)
  .handler(async ({ data }) => {
    // The badge is optional; an unreachable DB must not fail the homepage.
    const post = await getFeaturedPublishedPost().catch(() => null);
    if (!post) {
      return null;
    }
    return {
      href: getBlogPostPath(post.slug),
      title: pickManagedPostCopy(post, data.locale).title,
    };
  });

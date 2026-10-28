import { createFileRoute, notFound } from "@tanstack/react-router";
import { useExtracted, useLocale } from "use-intl";
import { BlogMarkdown } from "@/components/blog/blog-markdown";
import { BlogArticle } from "@/components/content/blog-article";
import { getBlogPostFn } from "@/lib/blog/blog-functions";
import { createBlogPostingJsonLd } from "@/lib/blog/posts";
import { formatAppDate } from "@/lib/format-date";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/{-$locale}/blog/$slug")({
  loader: async ({ context, params }) => {
    const post = await getBlogPostFn({
      data: { locale: context.intl.locale, slug: params.slug },
    });
    if (!post) {
      throw notFound();
    }
    return post;
  },
  head: ({ loaderData, match }) => {
    if (!loaderData) {
      return {};
    }
    return pageHead({
      title: loaderData.title,
      description: loaderData.description,
      alternates: { path: `/blog/${loaderData.slug}`, locale: match.context.intl.locale },
      openGraph: {
        title: `${loaderData.title} — Deni AI Blog`,
        description: loaderData.description,
      },
    });
  },
  component: ManagedBlogPostPage,
});

function ManagedBlogPostPage() {
  const t = useExtracted();
  const locale = useLocale();
  const post = Route.useLoaderData();
  const jsonLd = createBlogPostingJsonLd({
    headline: post.title,
    description: post.description,
    slug: post.slug,
    date: post.date,
  });

  return (
    <BlogArticle
      breadcrumbLabel={t("Blog")}
      headline={post.title}
      description={post.description}
      dateTime={post.date}
      dateLabel={formatAppDate(post.date, locale)}
      author={post.author}
      jsonLd={jsonLd}
      nextLinks={[
        { href: "/blog", label: t("Blog") },
        { href: "/guides", label: t("AI Guides") },
      ]}
    >
      <BlogMarkdown markdown={post.body} />
    </BlogArticle>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Newspaper } from "lucide-react";
import { useExtracted, useLocale } from "use-intl";
import { getExtracted } from "@/i18n/extracted";
import { type BlogListItem, listBlogPostsFn } from "@/lib/blog/blog-functions";
import { formatAppDate } from "@/lib/format-date";
import { Link } from "@/lib/navigation";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/{-$locale}/blog/")({
  loader: ({ context }) => listBlogPostsFn({ data: { locale: context.intl.locale } }),
  head: ({ match }) => {
    const { intl } = match.context;
    const t = getExtracted(intl);
    const title = t("Blog");
    const description = t(
      "Original notes from the Deni AI team on model choice, verification, bilingual writing, and practical multi-model work.",
    );

    const head = pageHead({
      title,
      description,
      alternates: { path: "/blog", locale: intl.locale },
      openGraph: {
        title: `${title} — Deni AI`,
        description,
      },
      twitter: {
        title: `${title} | Deni AI`,
        description,
      },
    });
    return {
      ...head,
      links: [
        ...head.links,
        {
          rel: "alternate",
          type: "application/rss+xml",
          href: "https://deniai.app/blog/rss.xml",
        },
      ],
    };
  },
  component: BlogPage,
});

function BlogPage() {
  const t = useExtracted();
  const locale = useLocale();
  const posts = Route.useLoaderData();
  const headline = t("Notes from a multi-model AI workspace");
  const description = t(
    "These posts are written by the Deni AI team from the work of running a public multi-model chat product. They are meant to be useful even if you never create an account.",
  );

  return (
    <main className="min-h-screen bg-background" id="main-content">
      <section className="px-4 pb-16 pt-32 md:pb-20 md:pt-40">
        <div className="mx-auto max-w-3xl">
          <div className="mb-5 inline-flex size-11 items-center justify-center rounded-2xl bg-secondary">
            <Newspaper className="size-5" />
          </div>
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
            {t("Blog")}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
            {headline}
          </h1>
          <p className="mt-6 text-base leading-8 text-muted-foreground">{description}</p>
          <p className="mt-4 text-sm leading-7 text-muted-foreground">
            {t(
              "If you want evergreen methods instead of dated notes, the AI Guides cover model selection, verification, prompt patterns, and privacy. This blog is for the decisions we keep seeing in real work.",
            )}
          </p>
        </div>
      </section>

      <section className="px-4 pb-20 md:pb-28">
        <div className="mx-auto max-w-3xl space-y-4">
          <BlogIndexList
            featuredLabel={t("Featured")}
            locale={locale}
            posts={posts}
            readLabel={t("Read article")}
          />
        </div>
      </section>

      <section className="border-y border-border/50 bg-secondary/20 px-4 py-16 md:py-24">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-semibold tracking-tight">{t("Why this blog exists")}</h2>
          <div className="mt-5 space-y-4 text-sm leading-7 text-muted-foreground">
            <p>
              {t(
                "Deni AI is a product, but a product page is not enough when someone is deciding which model to trust, whether to paste a document, or how to review generated code.",
              )}
            </p>
            <p>
              {t(
                "We publish these articles so visitors can inspect our methods before they sign in. The writing is original, dated, and written for people who already use AI, not only for people who want a new account.",
              )}
            </p>
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/guides"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-secondary"
            >
              {t("AI Guides")}
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-secondary"
            >
              {t("Contact")}
              <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function BlogIndexList({
  featuredLabel,
  locale,
  posts: datedPosts,
  readLabel,
}: {
  featuredLabel: string;
  locale: string;
  posts: BlogListItem[];
  readLabel: string;
}) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "Deni AI Blog",
    url: "https://deniai.app/blog",
    blogPost: datedPosts.map((post) => ({
      "@type": "BlogPosting",
      headline: post.title,
      description: post.description,
      datePublished: post.date,
      url: `https://deniai.app${post.href}`,
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      {datedPosts.map((post) => (
        <article
          key={post.href}
          className="rounded-[1.5rem] border border-border/70 bg-card p-6 transition-colors hover:border-foreground/30"
        >
          <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <time dateTime={post.date}>{formatAppDate(post.date, locale)}</time>
            {post.featured ? (
              <span className="rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold tracking-[0.16em] text-background uppercase">
                {featuredLabel}
              </span>
            ) : null}
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">
            <Link href={post.href} className="hover:underline">
              {post.title}
            </Link>
          </h2>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">{post.description}</p>
          <Link
            href={post.href}
            className="mt-5 inline-flex items-center gap-2 text-sm font-medium"
          >
            {readLabel}
            <ArrowRight className="size-4" />
          </Link>
        </article>
      ))}
    </>
  );
}

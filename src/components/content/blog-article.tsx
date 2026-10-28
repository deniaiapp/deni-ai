import { Link } from "@/lib/navigation";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type BlogLink = {
  href: string;
  label: string;
};

type BlogArticleProps = {
  breadcrumbLabel: string;
  headline: string;
  description: string;
  dateTime: string;
  dateLabel: string;
  author: string;
  jsonLd: Record<string, unknown> | Record<string, unknown>[];
  children: React.ReactNode;
  nextLinks?: BlogLink[];
  className?: string;
};

export function BlogArticle({
  breadcrumbLabel,
  headline,
  description,
  dateTime,
  dateLabel,
  author,
  jsonLd,
  children,
  nextLinks = [],
  className,
}: BlogArticleProps) {
  return (
    <main className={cn("min-h-screen bg-background", className)} id="main-content">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />

      <article className="px-4 pb-20 pt-32 md:pt-40">
        <div className="mx-auto max-w-3xl">
          <Link href="/blog" className="text-sm text-muted-foreground hover:text-foreground">
            {breadcrumbLabel}
          </Link>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
            {headline}
          </h1>
          <p className="mt-6 text-base leading-8 text-muted-foreground">{description}</p>
          <p className="mt-5 text-sm text-muted-foreground">
            <time dateTime={dateTime}>{dateLabel}</time>
            <span aria-hidden> · </span>
            <span>{author}</span>
          </p>

          <div className="mt-10 space-y-12">{children}</div>

          {nextLinks.length > 0 ? (
            <div className="mt-12 flex flex-wrap gap-3">
              {nextLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-secondary"
                >
                  {link.label}
                  <ArrowRight className="size-4" />
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </article>
    </main>
  );
}

import { Link } from "@/lib/navigation";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type GuideLink = {
  href: string;
  label: string;
};

type GuideArticleProps = {
  breadcrumbLabel: string;
  headline: string;
  description: string;
  jsonLd: Record<string, unknown> | Record<string, unknown>[];
  children: React.ReactNode;
  nextLinks?: GuideLink[];
  className?: string;
};

export function GuideArticle({
  breadcrumbLabel,
  headline,
  description,
  jsonLd,
  children,
  nextLinks = [],
  className,
}: GuideArticleProps) {
  return (
    <main className={cn("min-h-screen bg-background", className)} id="main-content">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />

      <article className="px-4 pb-20 pt-32 md:pt-40">
        <div className="mx-auto max-w-3xl">
          <Link href="/guides" className="text-sm text-muted-foreground hover:text-foreground">
            {breadcrumbLabel}
          </Link>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">
            {headline}
          </h1>
          <p className="mt-6 text-base leading-8 text-muted-foreground">{description}</p>

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

export function GuideSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 text-sm leading-8 text-muted-foreground">
      <h2 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function GuideCardGrid({
  items,
}: {
  items: Array<{
    title: string;
    body: string;
    icon?: React.ComponentType<{ className?: string }>;
  }>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <section key={item.title} className="rounded-[1.5rem] border border-border bg-card p-6">
            {Icon ? (
              <div className="inline-flex size-10 items-center justify-center rounded-2xl bg-secondary">
                <Icon className="size-5" />
              </div>
            ) : null}
            <h3
              className={cn(
                "text-lg font-semibold tracking-tight text-foreground",
                Icon ? "mt-5" : "",
              )}
            >
              {item.title}
            </h3>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">{item.body}</p>
          </section>
        );
      })}
    </div>
  );
}

export function GuideCallout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[1.5rem] border border-border/70 bg-secondary/20 p-6">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="mt-4 space-y-3 text-sm leading-7 text-muted-foreground">{children}</div>
    </section>
  );
}

export function GuideList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-3 text-sm leading-7 text-muted-foreground">
      {items.map((item) => (
        <li key={item} className="flex gap-3">
          <span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground/50" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

import { ArrowUpRight } from "lucide-react";
import { m } from "motion/react";
import { Link } from "@/lib/navigation";

export function HomeFeaturedBadgeLink({
  href,
  label,
  title,
}: {
  href: string;
  label: string;
  title: string;
}) {
  return (
    <m.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="mb-8"
    >
      <Link
        href={href}
        className="group inline-flex max-w-[min(100%,36rem)] items-center gap-2 rounded-full border border-foreground/15 bg-background/55 px-3 py-1.5 text-left shadow-[0_10px_40px_-24px_rgba(0,0,0,0.45)] backdrop-blur-md transition-colors hover:border-foreground/35 hover:bg-background/80"
      >
        <span className="shrink-0 rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold tracking-[0.16em] text-background uppercase">
          {label}
        </span>
        <span className="min-w-0 truncate text-sm font-medium text-foreground/85 group-hover:text-foreground">
          {title}
        </span>
        <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </Link>
    </m.div>
  );
}

import type { ReactNode } from "react";
import { useExtracted } from "use-intl";
import DeniAIIcon from "@/components/deni-ai-icon";
import { Link } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * Layout of the auth screens (sign-in, sign-up, two-factor setup): the indigo
 * brand panel on the left from `lg`, the form centred on the paper sheet.
 * On small screens the panel collapses to a brand row above the form.
 */
export function AuthFrame({ children, className }: { children: ReactNode; className?: string }) {
  const t = useExtracted();

  return (
    <div className="flex min-h-svh w-full bg-sidebar lg:p-2">
      <aside
        data-slot="sidebar"
        className="hidden w-[min(28rem,40vw)] shrink-0 flex-col justify-between p-10 text-sidebar-foreground lg:flex"
      >
        <Link
          href="/"
          className="flex items-center gap-2 self-start rounded-md focus-visible:outline-2 focus-visible:outline-sidebar-ring"
        >
          <DeniAIIcon className="size-7" />
          <span className="text-lg font-semibold tracking-[-0.02em]">{t("Deni AI")}</span>
        </Link>
        <div className="flex flex-col gap-4">
          <p className="text-4xl leading-[1.1] font-semibold tracking-[-0.035em] text-balance">
            {t("Ask every model from one place.")}
          </p>
          <p className="max-w-[34ch] text-base text-muted-foreground">
            {t("GPT, Claude, Gemini and more, with your chats, projects and memory kept together.")}
          </p>
        </div>
        <nav aria-label={t("Legal")} className="flex gap-4 text-sm text-muted-foreground">
          <Link href="/legal/terms" className="hover:text-sidebar-foreground hover:underline">
            {t("Terms of Service")}
          </Link>
          <Link
            href="/legal/privacy-policy"
            className="hover:text-sidebar-foreground hover:underline"
          >
            {t("Privacy Policy")}
          </Link>
        </nav>
      </aside>
      <main
        id="main-content"
        className={cn(
          "flex min-h-svh flex-1 flex-col items-center justify-center gap-4 bg-background p-4 md:p-8 lg:min-h-0 lg:rounded-sheet lg:shadow-sm",
          className,
        )}
      >
        <Link
          href="/"
          className="mb-2 flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-ring lg:hidden"
        >
          <DeniAIIcon className="size-7 text-primary" />
          <span className="text-lg font-semibold tracking-[-0.02em]">{t("Deni AI")}</span>
        </Link>
        {children}
      </main>
    </div>
  );
}

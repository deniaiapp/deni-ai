import { Link } from "@/lib/navigation";
import { useExtracted } from "use-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  const t = useExtracted();

  return (
    <main
      className="min-h-screen bg-linear-to-b from-background via-background to-muted/30"
      id="main-content"
    >
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-8 px-6 py-16 text-center">
        <Badge variant="secondary" className="px-3 py-1 text-xs uppercase tracking-[0.35em]">
          404
        </Badge>
        <div className="space-y-3">
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            {t("Page not found")}
          </h1>
          <p className="text-muted-foreground">
            {t("The page you are looking for might have been moved or deleted.")}
          </p>
        </div>
        <Button render={<Link href="/" />} nativeButton={false}>
          {t("Back to home")}
        </Button>
      </div>
    </main>
  );
}

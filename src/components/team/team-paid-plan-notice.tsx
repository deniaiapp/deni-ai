import { useExtracted } from "use-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "@/lib/navigation";

/** Shown in place of (or above) a paid team feature when the team has no active plan. */
export function TeamPaidPlanNotice({ message }: { message: string }) {
  const t = useExtracted();
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{message}</p>
        <Button
          size="sm"
          variant="outline"
          render={<Link href="/settings/team/billing" />}
          nativeButton={false}
        >
          {t("View plans")}
        </Button>
      </CardContent>
    </Card>
  );
}

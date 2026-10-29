import { Building2 } from "lucide-react";
import { useExtracted } from "use-intl";
import { toast } from "sonner";
import { usePlatformCapabilities } from "@/components/platform-capabilities-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useLocalizeError } from "@/hooks/use-localize-error";
import { trpc } from "@/lib/trpc/react";

/** Offers the team that owns the user's verified email domain, when it takes requests. */
export function TeamDomainSuggestion() {
  const t = useExtracted();
  const localizeError = useLocalizeError();
  const utils = trpc.useUtils();
  const { features } = usePlatformCapabilities();
  const suggestionQuery = trpc.teamDomains.suggestion.useQuery();
  const requestToJoin = trpc.teamDomains.requestToJoin.useMutation({
    onSuccess: async () => {
      toast.success(t("Request sent. A team admin will review it."));
      await utils.teamDomains.suggestion.invalidate();
    },
    onError: (error) => toast.error(localizeError(error)),
  });

  const suggestion = suggestionQuery.data;
  if (!suggestion) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("A team uses your email domain")}</CardTitle>
        <CardDescription>
          {t("{team} has verified the domain of your email address. You can ask to join it.", {
            team: suggestion.organization.name,
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted">
              {suggestion.organization.logo ? (
                <img src={suggestion.organization.logo} alt="" className="size-full object-cover" />
              ) : (
                <Building2 className="size-4 text-muted-foreground" />
              )}
            </div>
            <p className="truncate text-sm font-medium">{suggestion.organization.name}</p>
          </div>
          {suggestion.requested ? (
            <p className="text-sm text-muted-foreground">{t("Waiting for approval")}</p>
          ) : (
            <Button
              size="sm"
              disabled={requestToJoin.isPending}
              onClick={() => requestToJoin.mutate({ organizationId: suggestion.organization.id })}
            >
              {requestToJoin.isPending && <Spinner className="size-3.5" />}
              {t("Request to join")}
            </Button>
          )}
        </div>
        {features.billing && (
          <p className="text-xs text-muted-foreground">
            {t(
              "Joining a team with an active team plan cancels your personal subscription immediately. Unused time is credited toward future invoices, not refunded.",
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

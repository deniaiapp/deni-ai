import { useQueryClient } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { useExtracted } from "use-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useLocalizeError } from "@/hooks/use-localize-error";
import { trpc } from "@/lib/trpc/react";
import { monthDayFormatter } from "./team-utils";

/** Domain users asking to join; shown to owners and admins on the Members page. */
export function TeamJoinRequests({ organizationId }: { organizationId: string }) {
  const t = useExtracted();
  const localizeError = useLocalizeError();
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const requestsQuery = trpc.teamDomains.joinRequests.useQuery({ organizationId });
  const decide = trpc.teamDomains.decideJoinRequest.useMutation({
    onSuccess: async (_result, { approve }) => {
      toast.success(approve ? t("Request approved.") : t("Request declined."));
      await Promise.all([
        utils.teamDomains.joinRequests.invalidate({ organizationId }),
        // The member list from use-team-settings.
        approve && queryClient.invalidateQueries({ queryKey: ["team", "organization"] }),
      ]);
    },
    onError: (error) => toast.error(localizeError(error)),
  });

  const requests = requestsQuery.data ?? [];
  if (requests.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("Join requests")}</CardTitle>
        <CardDescription>
          {t("People from your verified domains who asked to join this team.")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {requests.map((request) => {
            const isDeciding = decide.isPending && decide.variables?.requestId === request.id;
            return (
              <div
                key={request.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <UserRound className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{request.name || request.email}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {request.email} · {monthDayFormatter.format(new Date(request.createdAt))}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decide.isPending}
                    onClick={() =>
                      decide.mutate({ organizationId, requestId: request.id, approve: false })
                    }
                  >
                    {t("Decline")}
                  </Button>
                  <Button
                    size="sm"
                    disabled={decide.isPending}
                    onClick={() =>
                      decide.mutate({ organizationId, requestId: request.id, approve: true })
                    }
                  >
                    {isDeciding && decide.variables?.approve && <Spinner className="size-3.5" />}
                    {t("Approve")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

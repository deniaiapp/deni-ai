import { FlaskConical, Trash2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useExtracted, useLocale } from "use-intl";
import { SettingsPageShell } from "@/components/settings-page-shell";
import { useLocalizeError } from "@/hooks/use-localize-error";
import { formatAppDate } from "@/lib/format-date";
import { trpc } from "@/lib/trpc/react";
import { Alert, AlertDescription } from "@deniai/ui/components/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@deniai/ui/components/alert-dialog";
import { Button } from "@deniai/ui/components/button";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@deniai/ui/components/empty";
import { Field, FieldGroup, FieldLabel } from "@deniai/ui/components/field";
import { Input } from "@deniai/ui/components/input";
import {
  PageSection,
  PageSectionContent,
  PageSectionDescription,
  PageSectionHeader,
  PageSectionTitle,
} from "@deniai/ui/components/page-section";
import { Spinner } from "@deniai/ui/components/spinner";

/**
 * Settings > Beta testers (operators only): who may use Deni AI v8 during the
 * private beta (`beta_access`). Grants are by email, before or after sign-up.
 */
export function BetaTestersSettings() {
  const t = useExtracted();
  const locale = useLocale();
  const localizeError = useLocalizeError();
  const utils = trpc.useUtils();
  const idPrefix = useId();
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState<{ id: string; email: string } | null>(null);

  const listQuery = trpc.betaAccess.list.useQuery();
  const grant = trpc.betaAccess.grant.useMutation({
    onSuccess: async (added) => {
      toast.success(t("{email} can now use the beta.", { email: added.email }));
      setEmail("");
      setNote("");
      await utils.betaAccess.list.invalidate();
    },
    onError: (error) =>
      toast.error(
        error.data?.code === "CONFLICT"
          ? t("This email is already a beta tester.")
          : localizeError(error),
      ),
  });
  const revoke = trpc.betaAccess.revoke.useMutation({
    onSuccess: async () => {
      toast.success(t("Beta tester removed."));
      setPendingRemoval(null);
      await utils.betaAccess.list.invalidate();
    },
    onError: (error) => toast.error(localizeError(error)),
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (grant.isPending || !email.trim()) return;
    grant.mutate({ email, note: note.trim() || undefined });
  };

  const testers = listQuery.data?.testers ?? [];

  return (
    <SettingsPageShell
      title={t("Beta testers")}
      description={t(
        "People who can use Deni AI v8 during the private beta. Add an email before or after the person signs up; their account is linked the first time they open the app.",
      )}
    >
      {listQuery.data && !listQuery.data.required ? (
        <Alert>
          <AlertDescription>
            {t(
              "The private beta gate is off on this deployment (BETA_ACCESS_REQUIRED), so every account can use it. The list still applies once the gate is on.",
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      <PageSection>
        <PageSectionHeader>
          <PageSectionTitle>{t("Add a tester")}</PageSectionTitle>
          <PageSectionDescription>
            {t("Only accounts with this verified email get access. Guests never do.")}
          </PageSectionDescription>
        </PageSectionHeader>
        <PageSectionContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`${idPrefix}-email`}>{t("Email")}</FieldLabel>
                <Input
                  id={`${idPrefix}-email`}
                  type="email"
                  autoComplete="off"
                  required
                  maxLength={320}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.com"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${idPrefix}-note`}>{t("Note (optional)")}</FieldLabel>
                <Input
                  id={`${idPrefix}-note`}
                  maxLength={500}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t("Where they came from, what to test")}
                />
              </Field>
            </FieldGroup>
            <Button
              type="submit"
              className="self-start"
              disabled={grant.isPending || !email.trim()}
            >
              {grant.isPending ? <Spinner /> : null}
              {t("Add tester")}
            </Button>
          </form>
        </PageSectionContent>
      </PageSection>

      <PageSection layout="stacked">
        <PageSectionHeader>
          <PageSectionTitle>
            {t("Testers ({count})", { count: String(testers.length) })}
          </PageSectionTitle>
        </PageSectionHeader>
        <PageSectionContent>
          {listQuery.isLoading ? (
            <div className="flex justify-center py-6">
              <Spinner className="size-5 text-muted-foreground" />
            </div>
          ) : listQuery.isError ? (
            <p className="text-sm text-destructive">{localizeError(listQuery.error)}</p>
          ) : testers.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FlaskConical />
                </EmptyMedia>
                <EmptyTitle>{t("No beta testers yet")}</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-card border border-border">
              {testers.map((tester) => (
                <li key={tester.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
                    <span className="truncate font-medium">{tester.email}</span>
                    <span className="text-muted-foreground">
                      {tester.userId
                        ? t("Linked to {account}", {
                            account: tester.linkedName
                              ? `${tester.linkedName} (${tester.linkedEmail ?? tester.userId})`
                              : (tester.linkedEmail ?? tester.userId),
                          })
                        : t("Not signed in yet")}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t("Added {date} by {admin}", {
                        date: formatAppDate(tester.createdAt, locale),
                        admin: tester.grantedByEmail ?? "—",
                      })}
                    </span>
                    {tester.note ? (
                      <span className="text-xs text-pretty text-foreground/80">{tester.note}</span>
                    ) : null}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("Remove {email}", { email: tester.email })}
                    onClick={() => setPendingRemoval({ id: tester.id, email: tester.email })}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </PageSectionContent>
      </PageSection>

      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open && !revoke.isPending) setPendingRemoval(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Remove this beta tester?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "{email} loses access to Deni AI v8 within a minute and sees the private beta screen. Their data stays, and Deni AI v7 keeps working for them.",
                { email: pendingRemoval?.email ?? "" },
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoke.isPending}>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={revoke.isPending}
              onClick={() => {
                if (pendingRemoval) revoke.mutate({ id: pendingRemoval.id });
              }}
            >
              {revoke.isPending ? <Spinner /> : null}
              {t("Remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPageShell>
  );
}

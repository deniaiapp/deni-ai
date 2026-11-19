import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useExtracted, useFormatter } from "use-intl";
import { Button } from "@deniai/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@deniai/ui/components/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@deniai/ui/components/field";
import { Input } from "@deniai/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@deniai/ui/components/select";
import { Switch } from "@deniai/ui/components/switch";
import { Textarea } from "@deniai/ui/components/textarea";
import { runFetch, useInvalidateRun, useRunState, type RunState } from "./run-api";
import { useRunErrorText } from "./run-error-text";
import { RunLoading, RunPage } from "./run-page";

function RoutineCreateForm({ state, onDone }: { state: RunState; onDone: () => void }) {
  const t = useExtracted();
  const errorText = useRunErrorText();
  const invalidate = useInvalidateRun();
  const [botId, setBotId] = useState(state.bots[0]?.id ?? "");
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [cron, setCron] = useState("0 9 * * 1");
  const [timezone, setTimezone] = useState(state.timezone);
  const [error, setError] = useState<string | null>(null);
  const bot = state.bots.find((item) => item.id === botId);
  const thread = state.threads.find((item) => item.kind === "dm" && item.botIds[0] === botId);
  const create = useMutation({
    mutationFn: () =>
      runFetch("routines", {
        body: { botId, threadId: thread?.id, name, instructions, cron, timezone },
      }),
    onSuccess: async () => {
      await invalidate();
      toast.success(t("Routine created."));
      onDone();
    },
    onError: (caught) => setError(errorText(caught)),
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        create.mutate();
      }}
      className="flex flex-col gap-4"
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="routine-teammate">{t("Teammate")}</FieldLabel>
          <Select value={botId} onValueChange={(value) => setBotId(String(value))}>
            <SelectTrigger id="routine-teammate" className="w-full">
              <SelectValue>{bot?.name ?? ""}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {state.bots.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="routine-name">{t("Name")}</FieldLabel>
          <Input
            id="routine-name"
            value={name}
            maxLength={120}
            placeholder={t("Monday inbox summary")}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="routine-instructions">{t("Instructions")}</FieldLabel>
          <Textarea
            id="routine-instructions"
            value={instructions}
            rows={4}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="routine-cron">{t("Schedule (cron)")}</FieldLabel>
            <Input
              id="routine-cron"
              value={cron}
              className="font-mono"
              onChange={(event) => setCron(event.target.value)}
            />
            <FieldDescription>
              {t("Minute hour day month weekday, e.g. 0 9 * * 1")}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="routine-timezone">{t("Time zone")}</FieldLabel>
            <Input
              id="routine-timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            />
          </Field>
        </div>
        {error ? <FieldError>{error}</FieldError> : null}
      </FieldGroup>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          {t("Cancel")}
        </Button>
        <Button type="submit" disabled={create.isPending || !thread}>
          {t("Create routine")}
        </Button>
      </div>
    </form>
  );
}

/** `/run/routines`: cron-scheduled work run in the background by the scheduler. */
export function RunRoutinesPage() {
  const t = useExtracted();
  const format = useFormatter();
  const state = useRunState();
  const errorText = useRunErrorText();
  const invalidate = useInvalidateRun();
  const [creating, setCreating] = useState(false);
  const update = useMutation({
    mutationFn: (body: { id: string; enabled: boolean }) =>
      runFetch("routines", { method: "PATCH", body }),
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(errorText(error)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => runFetch("routines", { method: "DELETE", body: { id } }),
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(errorText(error)),
  });
  if (state.isLoading || !state.data) return <RunLoading />;
  const data = state.data;
  return (
    <RunPage
      title={t("Routines")}
      actions={
        <Button onClick={() => setCreating(true)} disabled={creating}>
          <Plus className="size-4" />
          {t("New routine")}
        </Button>
      }
    >
      {creating ? (
        <Card>
          <CardContent>
            <RoutineCreateForm state={data} onDone={() => setCreating(false)} />
          </CardContent>
        </Card>
      ) : null}
      {data.routines.length === 0 && !creating ? (
        <p className="text-sm text-muted-foreground">{t("No routines yet.")}</p>
      ) : null}
      {data.routines.map((routine) => {
        const bot = data.bots.find((item) => item.id === routine.botId);
        return (
          <Card key={routine.id} size="sm">
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>{routine.name}</CardTitle>
                <CardDescription>
                  {bot?.name} · <span className="font-mono">{routine.cron}</span> ·{" "}
                  {routine.timezone}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={routine.enabled}
                  aria-label={t("Enabled")}
                  onCheckedChange={(checked) =>
                    update.mutate({ id: routine.id, enabled: Boolean(checked) })
                  }
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (window.confirm(t("Delete this routine?"))) remove.mutate(routine.id);
                  }}
                >
                  {t("Delete")}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
              <p className="line-clamp-2 whitespace-pre-wrap">{routine.instructions}</p>
              {routine.nextRunAt && routine.enabled ? (
                <p>
                  {t("Next run: {time}", {
                    time: format.dateTime(new Date(routine.nextRunAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }),
                  })}
                </p>
              ) : null}
              {routine.lastError ? (
                <p className="text-destructive">
                  {t("Last run failed: {error}", { error: routine.lastError })}
                </p>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </RunPage>
  );
}

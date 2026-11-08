import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useExtracted } from "use-intl";
import { Button } from "@deniai/ui/components/button";
import { Checkbox } from "@deniai/ui/components/checkbox";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@deniai/ui/components/field";
import { Input } from "@deniai/ui/components/input";
import { useRouter } from "@/lib/navigation";
import { runFetch, useInvalidateRun, useRunState, type Thread } from "./run-api";
import { useRunErrorText } from "./run-error-text";
import { RunLoading, RunPage } from "./run-page";
import { TeammateAvatar } from "./teammate-avatar";

/** `/run/groups/new`: a group conversation of two or more teammates. */
export function RunGroupForm() {
  const t = useExtracted();
  const state = useRunState();
  const errorText = useRunErrorText();
  const invalidate = useInvalidateRun();
  const { push } = useRouter();
  const [title, setTitle] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: () =>
      runFetch<{ thread: Thread }>("threads", {
        body: { title: title.trim() || undefined, botIds: members },
      }),
    onSuccess: async ({ thread }) => {
      await invalidate();
      push(`/run/threads/${thread.id}`);
    },
    onError: (error) => toast.error(errorText(error)),
  });
  if (state.isLoading || !state.data) return <RunLoading />;
  return (
    <RunPage
      title={t("New group")}
      description={t("Talk to several teammates at once. Each reply is attributed.")}
    >
      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="group-title">{t("Name")}</FieldLabel>
            <Input
              id="group-title"
              value={title}
              maxLength={120}
              placeholder={t("Launch team")}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <FieldSet>
            <FieldLegend variant="label">{t("Members")}</FieldLegend>
            <div className="grid gap-2 sm:grid-cols-2">
              {state.data.bots.map((bot) => (
                <Field key={bot.id} orientation="horizontal">
                  <Checkbox
                    id={`member-${bot.id}`}
                    checked={members.includes(bot.id)}
                    onCheckedChange={(checked) =>
                      setMembers((current) =>
                        checked ? [...current, bot.id] : current.filter((id) => id !== bot.id),
                      )
                    }
                  />
                  <FieldLabel htmlFor={`member-${bot.id}`} className="flex items-center gap-2">
                    <TeammateAvatar name={bot.name} icon={bot.icon} accent={bot.accent} size="sm" />
                    {bot.name}
                  </FieldLabel>
                </Field>
              ))}
            </div>
          </FieldSet>
        </FieldGroup>
        <div className="flex justify-end">
          <Button type="submit" disabled={members.length < 2 || create.isPending}>
            {t("Create group")}
          </Button>
        </div>
      </form>
    </RunPage>
  );
}

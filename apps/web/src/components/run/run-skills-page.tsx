import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useExtracted } from "use-intl";
import { Button } from "@deniai/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@deniai/ui/components/card";
import { Field, FieldLabel } from "@deniai/ui/components/field";
import { Input } from "@deniai/ui/components/input";
import { Textarea } from "@deniai/ui/components/textarea";
import { runFetch, useInvalidateRun, useRunState, type Skill } from "./run-api";
import { useRunErrorText } from "./run-error-text";
import { RunLoading, RunPage } from "./run-page";

function SkillEditor({ skill, onDone }: { skill?: Skill; onDone: () => void }) {
  const t = useExtracted();
  const errorText = useRunErrorText();
  const invalidate = useInvalidateRun();
  const [name, setName] = useState(skill?.name ?? "");
  const [body, setBody] = useState(skill?.body ?? "");
  const save = useMutation({
    mutationFn: () =>
      runFetch("skills", {
        method: skill ? "PATCH" : "POST",
        body: { ...(skill ? { id: skill.id } : {}), name, body },
      }),
    onSuccess: async () => {
      await invalidate();
      toast.success(t("Skill saved."));
      onDone();
    },
    onError: (error) => toast.error(errorText(error)),
  });
  const remove = useMutation({
    mutationFn: () => runFetch("skills", { method: "DELETE", body: { id: skill!.id } }),
    onSuccess: async () => {
      await invalidate();
      onDone();
    },
    onError: (error) => toast.error(errorText(error)),
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <Field>
        <FieldLabel htmlFor={`skill-name-${skill?.id ?? "new"}`}>{t("Name")}</FieldLabel>
        <Input
          id={`skill-name-${skill?.id ?? "new"}`}
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`skill-body-${skill?.id ?? "new"}`}>
          {t("Instructions (Markdown)")}
        </FieldLabel>
        <Textarea
          id={`skill-body-${skill?.id ?? "new"}`}
          value={body}
          rows={8}
          onChange={(event) => setBody(event.target.value)}
        />
      </Field>
      <div className="flex justify-between gap-2">
        {skill ? (
          <Button
            type="button"
            variant="ghost"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {t("Delete")}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            {t("Cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending || !name.trim() || !body.trim()}>
            {t("Save")}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** `/run/skills`: reusable procedures teammates follow (`useSkill`). */
export function RunSkillsPage() {
  const t = useExtracted();
  const state = useRunState();
  const [editing, setEditing] = useState<string | null>(null);
  if (state.isLoading || !state.data) return <RunLoading />;
  return (
    <RunPage
      title={t("Skills")}
      description={t("Reusable procedures your teammates can follow.")}
      actions={
        <Button onClick={() => setEditing("new")} disabled={editing === "new"}>
          <Plus className="size-4" />
          {t("New skill")}
        </Button>
      }
    >
      {editing === "new" ? (
        <Card>
          <CardContent>
            <SkillEditor onDone={() => setEditing(null)} />
          </CardContent>
        </Card>
      ) : null}
      {state.data.skills.length === 0 && editing !== "new" ? (
        <p className="text-sm text-muted-foreground">{t("No skills yet.")}</p>
      ) : null}
      {state.data.skills.map((skill) => (
        <Card key={skill.id} size="sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{skill.name}</CardTitle>
            {editing !== skill.id ? (
              <Button size="sm" variant="ghost" onClick={() => setEditing(skill.id)}>
                {t("Edit")}
              </Button>
            ) : null}
          </CardHeader>
          <CardContent>
            {editing === skill.id ? (
              <SkillEditor skill={skill} onDone={() => setEditing(null)} />
            ) : (
              <p className="line-clamp-3 text-sm whitespace-pre-wrap text-muted-foreground">
                {skill.body}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </RunPage>
  );
}

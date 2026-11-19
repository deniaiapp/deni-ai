import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useExtracted } from "use-intl";
import { Button } from "@deniai/ui/components/button";
import { Checkbox } from "@deniai/ui/components/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@deniai/ui/components/field";
import { Input } from "@deniai/ui/components/input";
import { Switch } from "@deniai/ui/components/switch";
import { Textarea } from "@deniai/ui/components/textarea";
import {
  COMPUTER_TOOL_GROUPS,
  TEAMMATE_TOOL_GROUPS,
  type TeammateToolGroup,
} from "@deniai/run/teammates/tools";
import { useRouter } from "@/lib/navigation";
import { runFetch, useInvalidateRun, useRunState, type Bot, type Thread } from "./run-api";
import { useRunErrorText } from "./run-error-text";
import { RunLoading, RunPage } from "./run-page";
import { TEAMMATE_CHARACTER_ICONS, TeammateAvatar } from "./teammate-avatar";

const DEFAULT_IDS = ["chief", "research", "ops"];

function useToolLabels() {
  const t = useExtracted();
  const labels: Record<TeammateToolGroup, { label: string; description: string }> = {
    files: { label: t("Files"), description: t("Read and write files in the workspace") },
    shell: { label: t("Terminal"), description: t("Run commands in the sandbox") },
    browser: { label: t("Browser"), description: t("Open and operate web pages") },
    web: { label: t("Web search"), description: t("Search the web") },
    mcp: { label: t("Connectors"), description: t("Use connected MCP servers") },
    memory: { label: t("Memory"), description: t("Remember facts across conversations") },
    skills: { label: t("Skills"), description: t("Follow saved procedures") },
    routines: { label: t("Routines"), description: t("Schedule recurring work") },
    handoff: { label: t("Handoffs"), description: t("Ask other teammates for help") },
  };
  return labels;
}

/** Create (`teammateId` undefined) or edit a teammate. */
export function TeammateForm({ teammateId }: { teammateId?: string }) {
  const t = useExtracted();
  const state = useRunState();
  const existing = teammateId ? state.data?.bots.find((bot) => bot.id === teammateId) : undefined;
  if (state.isLoading) return <RunLoading />;
  if (teammateId && !existing)
    return (
      <RunPage title={t("Teammate not found")}>
        <p className="text-sm text-muted-foreground">
          {t("This teammate does not exist or was deleted.")}
        </p>
      </RunPage>
    );
  return (
    <TeammateFormBody
      key={existing?.id ?? "new"}
      existing={existing}
      limit={state.data?.teammateLimit.limit ?? null}
      count={state.data?.bots.length ?? 0}
    />
  );
}

function TeammateFormBody({
  existing,
  limit,
  count,
}: {
  existing: Bot | undefined;
  limit: number | null;
  count: number;
}) {
  const t = useExtracted();
  const errorText = useRunErrorText();
  const toolLabels = useToolLabels();
  const invalidate = useInvalidateRun();
  const { push } = useRouter();
  const [name, setName] = useState(existing?.name ?? "");
  const [job, setJob] = useState(existing?.job ?? "");
  const [instructions, setInstructions] = useState(existing?.instructions ?? "");
  const [icon, setIcon] = useState<string | null>(existing?.icon ?? null);
  const [emoji, setEmoji] = useState("");
  const [tools, setTools] = useState<TeammateToolGroup[]>(
    (existing?.tools as TeammateToolGroup[] | null | undefined) ?? [...TEAMMATE_TOOL_GROUPS],
  );
  const [computerAccess, setComputerAccess] = useState(existing?.computerAccess !== false);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        job,
        instructions,
        icon,
        tools: tools.length === TEAMMATE_TOOL_GROUPS.length ? null : tools,
        computerAccess,
      };
      return existing
        ? runFetch<{ bot: Bot }>(`teammates/${existing.id}`, { method: "PATCH", body })
        : runFetch<{ bot: Bot; thread: Thread }>("teammates", { body });
    },
    onSuccess: async (result) => {
      await invalidate();
      toast.success(existing ? t("Teammate saved.") : t("Teammate added."));
      if (!existing && "thread" in result)
        push(`/run/threads/${(result as { thread: Thread }).thread.id}`);
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const remove = useMutation({
    mutationFn: () => runFetch(`teammates/${existing!.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await invalidate();
      toast.success(t("Teammate deleted."));
      push("/run");
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const forget = useMutation({
    mutationFn: (ids: string[]) =>
      runFetch(`teammates/${existing!.id}/memory`, { method: "DELETE", body: { ids } }),
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(errorText(error)),
  });

  const atLimit = !existing && limit !== null && count >= limit;

  return (
    <RunPage
      title={existing ? t("Edit {name}", { name: existing.name }) : t("Add teammate")}
      description={
        // Only while adding, and only with room left; at the limit the form says so below.
        !existing && limit !== null && count < limit
          ? t(
              "{remaining, plural, one {You can add # more teammate on your plan.} other {You can add # more teammates on your plan.}}",
              {
                remaining: limit - count,
              },
            )
          : undefined
      }
    >
      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <FieldGroup>
          <div className="flex items-center gap-4">
            <TeammateAvatar name={name || "?"} icon={icon} accent={existing?.accent} size="lg" />
            <div className="flex flex-wrap gap-2">
              {TEAMMATE_CHARACTER_ICONS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  aria-pressed={icon === value}
                  aria-label={t("Character icon")}
                  onClick={() => setIcon(value)}
                >
                  <TeammateAvatar
                    name=""
                    icon={value}
                    size="md"
                    className={icon === value ? "ring-primary" : undefined}
                  />
                </button>
              ))}
              <Input
                className="w-24"
                value={emoji}
                maxLength={8}
                placeholder={t("Emoji")}
                aria-label={t("Emoji icon")}
                onChange={(event) => {
                  setEmoji(event.target.value);
                  setIcon(event.target.value.trim() || null);
                }}
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => setIcon(null)}>
                {t("Use initial")}
              </Button>
            </div>
          </div>
          <Field>
            <FieldLabel htmlFor="teammate-name">{t("Name")}</FieldLabel>
            <Input
              id="teammate-name"
              value={name}
              maxLength={80}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="teammate-job">{t("Role")}</FieldLabel>
            <Input
              id="teammate-job"
              value={job}
              maxLength={120}
              placeholder={t("Research and reports")}
              onChange={(event) => setJob(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="teammate-instructions">{t("Instructions")}</FieldLabel>
            <Textarea
              id="teammate-instructions"
              value={instructions}
              rows={6}
              maxLength={20_000}
              onChange={(event) => setInstructions(event.target.value)}
            />
            <FieldDescription>
              {t("How this teammate works: its focus, tone, and what it should ask before doing.")}
            </FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <Switch
              id="teammate-computer"
              checked={computerAccess}
              onCheckedChange={(checked) => setComputerAccess(Boolean(checked))}
            />
            <FieldLabel htmlFor="teammate-computer">
              {t("Can use the shared computer (files, terminal, browser)")}
            </FieldLabel>
          </Field>
          <FieldSet>
            <FieldLegend variant="label">{t("Tools")}</FieldLegend>
            <div className="grid gap-3 sm:grid-cols-2">
              {TEAMMATE_TOOL_GROUPS.map((group) => {
                const disabled = !computerAccess && COMPUTER_TOOL_GROUPS.includes(group);
                return (
                  <Field key={group} orientation="horizontal" data-disabled={disabled || undefined}>
                    <Checkbox
                      id={`tool-${group}`}
                      checked={tools.includes(group) && !disabled}
                      disabled={disabled}
                      onCheckedChange={(checked) =>
                        setTools((current) =>
                          checked
                            ? TEAMMATE_TOOL_GROUPS.filter(
                                (item) => item === group || current.includes(item),
                              )
                            : current.filter((item) => item !== group),
                        )
                      }
                    />
                    <div className="flex flex-col">
                      <FieldLabel htmlFor={`tool-${group}`}>{toolLabels[group].label}</FieldLabel>
                      <FieldDescription>{toolLabels[group].description}</FieldDescription>
                    </div>
                  </Field>
                );
              })}
            </div>
          </FieldSet>
        </FieldGroup>

        {existing && existing.memory.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">{t("Memory")}</h2>
            <ul className="divide-y rounded-lg border">
              {existing.memory.map((entry) => (
                <li key={entry.id} className="flex items-start justify-between gap-3 px-3 py-2">
                  <span className="text-sm">{entry.text}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={forget.isPending}
                    onClick={() => forget.mutate([entry.id])}
                  >
                    {t("Forget")}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {atLimit ? (
          <p className="text-sm text-destructive">
            {t("You have reached your plan's teammate limit. Upgrade your plan to add more.")}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-between gap-2">
          {existing && !DEFAULT_IDS.includes(existing.id) ? (
            <Button
              type="button"
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    t("Delete {name}? Its conversation is deleted too.", { name: existing.name }),
                  )
                )
                  remove.mutate();
              }}
            >
              {t("Delete teammate")}
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={save.isPending || !name.trim() || atLimit}>
            {existing ? t("Save") : t("Add teammate")}
          </Button>
        </div>
      </form>
    </RunPage>
  );
}

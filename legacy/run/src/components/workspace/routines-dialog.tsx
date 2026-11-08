import { useExtracted, useLocale } from "@/i18n/react";
import { translateMessage } from "@/i18n/standalone";
import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowLeft, Clock3, Pencil, Plus, Trash2 } from "lucide-react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Bot, Routine, Thread } from "@/lib/types";
import { formatRoutineTime, readRoutineSchedule, routineCron, type RoutineFrequency } from "@/lib/jobs/routine-schedule";
import { useRoutineLabels } from "@/components/workspace/routine-labels";

type RoutineInput = { id?: string; botId?: string; threadId?: string; name: string; instructions: string; cron: string; timezone: string; enabled: boolean };
const hours = Array.from({ length: 24 }, (_, hour) => ({ value: String(hour).padStart(2, "0"), label: String(hour).padStart(2, "0") }));
const minutes = Array.from({ length: 60 }, (_, minute) => ({ value: String(minute).padStart(2, "0"), label: String(minute).padStart(2, "0") }));
function normalizeTime(value: string) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : null;
}
const commonTimezones = ["Asia/Tokyo", "UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Singapore", "Australia/Sydney"];
const timezones = [...new Set([...commonTimezones, ...Intl.supportedValuesOf("timeZone")])];

export function RoutinesDialog({ open, routines, bots, threads, initialRoutineId, defaultBotId, defaultThreadId, onClose, onSaved, onDeleted, onSync }: {
  open: boolean; routines: Routine[]; bots: Bot[]; threads: Thread[];
  initialRoutineId?: string | null; defaultBotId?: string; defaultThreadId?: string;
  onClose: () => void; onSaved: (routine: Routine) => void; onDeleted: (id: string) => void; onSync: (routines: Routine[]) => void;
}) {
  const t = useExtracted();
  const locale = useLocale();
  const { describe } = useRoutineLabels();
  const initial = routines.find((item) => item.id === initialRoutineId) ?? null;
  const [editing, setEditing] = useState<Routine | null>(initial);
  const [view, setView] = useState<"list" | "form">(initial || initialRoutineId === "new" ? "form" : "list");
  const [deleting, setDeleting] = useState<Routine | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const revision = useRef(0);
  const dialogContentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    setEditing(routines.find((item) => item.id === initialRoutineId) ?? null);
    setView(initialRoutineId === "new" || routines.some((item) => item.id === initialRoutineId) ? "form" : "list");
    setDeleting(null);
    setError(null);
    // Only reset when a new dialog session opens, not when the list refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const startedAt = revision.current;
    void fetch("/api/routines", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(t("Could not refresh routines."));
      const data = await response.json() as { routines: Routine[]; timezone: string };
      if (!controller.signal.aborted && startedAt === revision.current) { onSync(data.routines); setTimezone(data.timezone || "UTC"); }
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [open, onSync, t]);

  async function request(method: string, body: object) {
    ++revision.current;
    const response = await fetch("/api/routines", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t("Could not update routine."));
    return data as { routine: Routine; deleted?: string };
  }
  async function save(value: RoutineInput) {
    setBusy("save"); setError(null);
    try { const data = await request(value.id ? "PATCH" : "POST", value); onSaved(data.routine); setEditing(null); setView("list"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not save routine.")); }
    finally { setBusy(null); }
  }
  async function toggle(routine: Routine) {
    setBusy(routine.id); setError(null);
    onSaved({ ...routine, enabled: !routine.enabled, nextRunAt: null });
    try { onSaved((await request("PATCH", { id: routine.id, enabled: !routine.enabled })).routine); }
    catch (cause) { onSaved(routine); setError(cause instanceof Error ? cause.message : t("Could not update routine.")); }
    finally { setBusy(null); }
  }
  async function remove() {
    if (!deleting) return;
    setBusy("delete"); setError(null);
    try { await request("DELETE", { id: deleting.id }); onDeleted(deleting.id); setDeleting(null); setEditing(null); setView("list"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Could not delete routine.")); }
    finally { setBusy(null); }
  }
  return <Dialog open={open} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent ref={dialogContentRef} className="max-h-[90dvh] max-w-xl overflow-y-auto">
      <DialogTitle>{deleting ? t("Delete routine") : view === "form" ? editing ? t("Edit routine") : t("New routine") : t("Routines")}</DialogTitle>
      <DialogDescription>{t("Set up recurring work and manage it here. Changes apply to future runs; a task already running continues.")}</DialogDescription>
      {error ? <p role="alert" className="rounded-lg bg-destructive-500/10 px-3 py-2 text-sm text-destructive-300">{error}</p> : null}
      {deleting ? <div className="space-y-5 py-2">
        <p className="text-sm text-neutral-300">{t.rich("Delete <strong>{name}</strong>? Its schedule will be removed. Existing conversations and files will remain.", { name: deleting.name, strong: (chunks) => <strong className="text-foreground">{chunks}</strong> })}</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => { setDeleting(null); setError(null); }}>{t("Cancel")}</Button><Button type="button" variant="secondary-destructive" loading={busy === "delete"} onClick={() => void remove()}>{t("Delete routine")}</Button></div>
      </div> : view === "form" ? <>
        <Button type="button" variant="ghost" size="xs" icon={ArrowLeft} className="w-fit" disabled={Boolean(busy)} onClick={() => { setEditing(null); setView("list"); setError(null); }}>{t("All routines")}</Button>
        <RoutineForm key={editing?.id ?? "new"} routine={editing} bots={bots} threads={threads} defaultBotId={defaultBotId} defaultThreadId={defaultThreadId} defaultTimezone={timezone} popupContainer={dialogContentRef} busy={Boolean(busy)} onSave={save} onDelete={editing ? () => { setDeleting(editing); setError(null); } : undefined} />
      </> : <>
        <div className="flex items-center justify-between gap-3"><span className="text-xs text-neutral-500">{t("{count, plural, one {# routine} other {# routines}}", { count: routines.length })}</span><Button type="button" size="sm" icon={Plus} disabled={!bots.length || !threads.length || Boolean(busy)} onClick={() => { setEditing(null); setView("form"); setError(null); }}>{t("New routine")}</Button></div>
        {!routines.length ? <div className="flex flex-col items-center gap-3 py-10 text-center text-neutral-500"><Clock3 size={28} /><p className="text-sm">{t("Create a routine to schedule recurring work.")}</p></div> : <div className="space-y-3">
          {routines.map((routine) => <div key={routine.id} className="rounded-xl border border-foreground/10 bg-foreground/[0.025] p-3">
            <div className="flex items-center justify-between gap-3"><button type="button" disabled={Boolean(busy)} onClick={() => { setEditing(routine); setView("form"); setError(null); }} className="min-w-0 truncate text-left text-sm font-medium hover:underline">{routine.name}</button><RoutineSwitch checked={routine.enabled} disabled={Boolean(busy)} label={routine.enabled ? t("Turn off {name}", { name: routine.name }) : t("Turn on {name}", { name: routine.name })} onChange={() => void toggle(routine)} /></div>
            <p className="mt-1 text-[11px] text-neutral-500">{bots.find((bot) => bot.id === routine.botId)?.name ?? t("Teammate")}</p>
            <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-neutral-400">{routine.instructions}</p>
            <p className="mt-3 text-xs text-neutral-300">{describe(routine.cron)}</p>
            <p className="mt-1 text-xs text-neutral-500">{routine.timezone} · {routine.enabled ? t("Next {time}", { time: formatRoutineTime(routine.nextRunAt, routine.timezone, locale) }) : t("Off")}</p>
            {routine.lastError ? <p className="mt-2 text-xs text-warning-300">{translateMessage(locale, routine.lastError)}</p> : null}
            <div className="mt-3 flex justify-end gap-1"><Button type="button" variant="ghost" size="xs" icon={Pencil} disabled={Boolean(busy)} onClick={() => { setEditing(routine); setView("form"); setError(null); }}>{t("Edit")}</Button><Button type="button" variant="ghost" size="xs" icon={Trash2} className="text-destructive-300" disabled={Boolean(busy)} onClick={() => { setDeleting(routine); setError(null); }}>{t("Delete")}</Button></div>
          </div>)}
        </div>}
      </>}
    </DialogContent>
  </Dialog>;
}

function RoutineSwitch({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: () => void }) {
  const t = useExtracted();
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange} className="flex shrink-0 items-center gap-2 rounded-md text-xs text-neutral-400 outline-none focus-visible:ring-2 focus-visible:ring-foreground/40 disabled:opacity-40">
    <span>{checked ? t("On") : t("Off")}</span><span className={`flex h-5 w-9 items-center rounded-full px-0.5 transition-colors ${checked ? "bg-success-600" : "bg-neutral-700"}`}><span className={`size-4 rounded-full bg-white transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`} /></span>
  </button>;
}

function RoutineForm({ routine, bots, threads, defaultBotId, defaultThreadId, defaultTimezone, popupContainer, busy, onSave, onDelete }: {
  routine: Routine | null; bots: Bot[]; threads: Thread[]; defaultBotId?: string; defaultThreadId?: string; defaultTimezone: string; popupContainer: RefObject<HTMLDivElement | null>; busy: boolean;
  onSave: (value: RoutineInput) => Promise<void>; onDelete?: () => void;
}) {
  const t = useExtracted();
  const { weekdays } = useRoutineLabels();
  const frequencyOptions = [
    { value: "daily", label: t("Every day") },
    { value: "weekdays", label: t("Weekdays (Mon–Fri)") },
    { value: "weekly", label: t("Every week") },
    { value: "monthly", label: t("Every month") },
    { value: "custom", label: t("Custom schedule (cron)") },
  ];
  const [name, setName] = useState(routine?.name ?? "");
  const [instructions, setInstructions] = useState(routine?.instructions ?? "");
  const [botId, setBotId] = useState(routine?.botId ?? defaultBotId ?? bots[0]?.id ?? "");
  const [threadId, setThreadId] = useState(() => routine?.threadId ?? threads.find((thread) => thread.id === defaultThreadId && thread.botIds.includes(botId))?.id ?? threads.find((thread) => thread.botIds.includes(botId) && thread.kind === "dm")?.id ?? threads.find((thread) => thread.botIds.includes(botId))?.id ?? "");
  const [schedule, setSchedule] = useState(() => readRoutineSchedule(routine?.cron));
  const [timeInput, setTimeInput] = useState(() => readRoutineSchedule(routine?.cron).time);
  const [timezone, setTimezone] = useState(routine?.timezone || defaultTimezone);
  const [enabled, setEnabled] = useState(routine?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const eligibleThreads = threads.filter((thread) => thread.botIds.includes(botId));
  function chooseTime(time: string) {
    setTimeInput(time);
    setSchedule((value) => ({ ...value, time }));
  }
  return <form className="space-y-4" onSubmit={(event) => {
    event.preventDefault(); setError(null);
    try { void onSave({ ...(routine ? { id: routine.id } : { botId, threadId }), name, instructions, cron: routineCron(schedule), timezone, enabled }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("Check your schedule.")); }
  }}>
    <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
      <div className="space-y-1.5"><Label htmlFor="routine-name">{t("Name")}</Label><Input id="routine-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required placeholder={t("Morning news")} /></div>
      <div className="space-y-1.5"><Label htmlFor="routine-instruction">{t("Instruction")}</Label><Textarea id="routine-instruction" value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={20000} required rows={4} className="max-h-52 min-h-28" placeholder={t("Find today's important news and send me a concise summary with sources.")} /></div>
      {!routine ? <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="routine-bot">{t("Teammate")}</Label><Select id="routine-bot" value={botId} options={bots.map((bot) => ({ value: bot.id, label: bot.name }))} onValueChange={(id) => { setBotId(id); setThreadId(threads.find((thread) => thread.botIds.includes(id) && thread.kind === "dm")?.id ?? threads.find((thread) => thread.botIds.includes(id))?.id ?? ""); }} /></div>
        <div className="space-y-1.5"><Label htmlFor="routine-thread">{t("Conversation")}</Label><Select id="routine-thread" value={threadId} options={eligibleThreads.map((thread) => ({ value: thread.id, label: thread.title }))} onValueChange={setThreadId} placeholder={t("No conversation available")} disabled={!eligibleThreads.length} /></div>
      </div> : null}
      <div className="space-y-1.5"><Label htmlFor="routine-frequency">{t("When to run")}</Label><Select id="routine-frequency" value={schedule.frequency} options={frequencyOptions} onValueChange={(frequency) => setSchedule((value) => ({ ...value, frequency: frequency as RoutineFrequency }))} /></div>
      {schedule.frequency === "custom" ? <div className="space-y-1.5"><Label htmlFor="routine-cron">{t("Cron expression")}</Label><Input id="routine-cron" value={schedule.cron} onChange={(event) => setSchedule((value) => ({ ...value, cron: event.target.value }))} required maxLength={160} placeholder="0 9 * * 1-5" className="font-mono" /><p className="text-xs text-neutral-500">{t("Minute · hour · day of month · month · weekday")}</p></div> : <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="routine-time">{t("Time")}</Label><div className="flex items-center gap-2"><Input id="routine-time" type="text" inputMode="numeric" value={timeInput} onChange={(event) => { const text = event.target.value; setTimeInput(text); const time = normalizeTime(text); if (time) setSchedule((value) => ({ ...value, time })); }} onBlur={() => { const time = normalizeTime(timeInput); if (time) setTimeInput(time); }} pattern="(?:[01]?[0-9]|2[0-3]):[0-5][0-9]" title={t("Enter a time between 00:00 and 23:59")} maxLength={5} required placeholder="HH:mm" className="w-20 shrink-0 rounded-xl px-2 text-center" /><Select id="routine-hour" ariaLabel={t("Choose hour")} value={schedule.time.slice(0, 2)} options={hours} onValueChange={(hour) => chooseTime(`${hour}:${schedule.time.slice(3, 5)}`)} className="min-w-0 flex-1 px-2" /><span aria-hidden="true">:</span><Select id="routine-minute" ariaLabel={t("Choose minute")} value={schedule.time.slice(3, 5)} options={minutes} onValueChange={(minute) => chooseTime(`${schedule.time.slice(0, 2)}:${minute}`)} className="min-w-0 flex-1 px-2" /></div></div>
        {schedule.frequency === "weekly" ? <div className="space-y-1.5"><Label htmlFor="routine-weekday">{t("Day")}</Label><Select id="routine-weekday" value={schedule.weekday} options={weekdays.map((day, index) => ({ value: String(index), label: day }))} onValueChange={(weekday) => setSchedule((value) => ({ ...value, weekday }))} /></div> : null}
        {schedule.frequency === "monthly" ? <div className="space-y-1.5"><Label htmlFor="routine-day">{t("Day of month")}</Label><Select id="routine-day" value={schedule.day} options={Array.from({ length: 31 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))} onValueChange={(day) => setSchedule((value) => ({ ...value, day }))} /><p className="text-xs text-neutral-500">{t("Months without this day are skipped.")}</p></div> : null}
      </div>}
      <div className="space-y-1.5">
        <Label htmlFor="routine-timezone">{t("Timezone")}</Label>
        <Autocomplete.Root items={timezones} value={timezone} onValueChange={setTimezone} openOnInputClick limit={30}>
          <Autocomplete.Input id="routine-timezone" required maxLength={100} placeholder={t("Search timezones…")} className="h-9 w-full rounded-xl border border-foreground/15 bg-surface-input px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-3 focus-visible:ring-primary/20" />
          <Autocomplete.Portal container={popupContainer} className="pointer-events-none absolute inset-0">
            <Autocomplete.Positioner side="top" sideOffset={2} collisionPadding={8} className="pointer-events-auto z-[70] outline-none">
              <Autocomplete.Popup className="w-[var(--anchor-width)] overflow-hidden rounded-xl border border-foreground/10 bg-surface-raised p-1 text-foreground shadow-xl">
                <Autocomplete.Empty className="text-sm text-muted-foreground"><span className="block px-3 py-2">{t("No matching timezone. You can enter one manually.")}</span></Autocomplete.Empty>
                <Autocomplete.List className="max-h-48 overflow-y-auto py-1 overscroll-contain">
                  {(zone: string) => <Autocomplete.Item key={zone} value={zone} className="cursor-default rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-primary/15">{zone}</Autocomplete.Item>}
                </Autocomplete.List>
              </Autocomplete.Popup>
            </Autocomplete.Positioner>
          </Autocomplete.Portal>
        </Autocomplete.Root>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-foreground/10 p-3"><span className="text-sm">{t("Enabled")}</span><RoutineSwitch checked={enabled} label={t("Enable routine")} onChange={() => setEnabled((value) => !value)} /></div>
    </fieldset>
    {error ? <p role="alert" className="text-sm text-destructive-300">{error}</p> : null}
    <div className="flex items-center justify-between gap-3 border-t border-foreground/10 pt-4"><div>{onDelete ? <Button type="button" size="sm" variant="ghost" icon={Trash2} className="text-destructive-300" disabled={busy} onClick={onDelete}>{t("Delete")}</Button> : null}</div><Button type="submit" loading={busy} disabled={!name.trim() || !instructions.trim() || !botId || !threadId}>{routine ? t("Save changes") : t("Create routine")}</Button></div>
  </form>;
}

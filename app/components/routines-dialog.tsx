"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Clock3, Pencil, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Bot, Routine, Thread } from "@/lib/types";
import { describeRoutineSchedule, formatRoutineTime, readRoutineSchedule, routineCron, WEEKDAYS, type RoutineFrequency } from "@/lib/routine-schedule";

type RoutineInput = { id?: string; botId?: string; threadId?: string; name: string; instructions: string; cron: string; timezone: string; enabled: boolean };
const selectClass = "h-10 w-full min-w-0 rounded-lg border border-white/15 bg-[#151515] px-3 text-sm text-neutral-200 outline-none focus:border-white/30";

export function RoutinesDialog({ routines, bots, threads, initialRoutineId, defaultBotId, defaultThreadId, onClose, onSaved, onDeleted, onSync }: {
  routines: Routine[]; bots: Bot[]; threads: Thread[];
  initialRoutineId?: string | null; defaultBotId?: string; defaultThreadId?: string;
  onClose: () => void; onSaved: (routine: Routine) => void; onDeleted: (id: string) => void; onSync: (routines: Routine[]) => void;
}) {
  const initial = routines.find((item) => item.id === initialRoutineId) ?? null;
  const [editing, setEditing] = useState<Routine | null>(initial);
  const [view, setView] = useState<"list" | "form">(initial || initialRoutineId === "new" ? "form" : "list");
  const [deleting, setDeleting] = useState<Routine | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const revision = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const startedAt = revision.current;
    void fetch("/api/routines", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Could not refresh routines.");
      const data = await response.json() as { routines: Routine[]; timezone: string };
      if (!controller.signal.aborted && startedAt === revision.current) { onSync(data.routines); setTimezone(data.timezone || "UTC"); }
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [onSync]);

  async function request(method: string, body: object) {
    ++revision.current;
    const response = await fetch("/api/routines", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not update routine.");
    return data as { routine: Routine; deleted?: string };
  }
  async function save(value: RoutineInput) {
    setBusy("save"); setError(null);
    try { const data = await request(value.id ? "PATCH" : "POST", value); onSaved(data.routine); setEditing(null); setView("list"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save routine."); }
    finally { setBusy(null); }
  }
  async function toggle(routine: Routine) {
    setBusy(routine.id); setError(null);
    onSaved({ ...routine, enabled: !routine.enabled, nextRunAt: null });
    try { onSaved((await request("PATCH", { id: routine.id, enabled: !routine.enabled })).routine); }
    catch (cause) { onSaved(routine); setError(cause instanceof Error ? cause.message : "Could not update routine."); }
    finally { setBusy(null); }
  }
  async function remove() {
    if (!deleting) return;
    setBusy("delete"); setError(null);
    try { await request("DELETE", { id: deleting.id }); onDeleted(deleting.id); setDeleting(null); setEditing(null); setView("list"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete routine."); }
    finally { setBusy(null); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
      <DialogTitle>{deleting ? "Delete routine" : view === "form" ? editing ? "Edit routine" : "New routine" : "Routines"}</DialogTitle>
      <DialogDescription>Set up recurring work and manage it here. Changes apply to future runs; a task already running continues.</DialogDescription>
      {error ? <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p> : null}
      {deleting ? <div className="space-y-5 py-2">
        <p className="text-sm text-neutral-300">Delete <strong className="text-white">{deleting.name}</strong>? Its schedule will be removed. Existing conversations and files will remain.</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => { setDeleting(null); setError(null); }}>Cancel</Button><Button type="button" variant="secondary-destructive" loading={busy === "delete"} onClick={() => void remove()}>Delete routine</Button></div>
      </div> : view === "form" ? <>
        <Button type="button" variant="ghost" size="xs" icon={ArrowLeft} className="w-fit" disabled={Boolean(busy)} onClick={() => { setEditing(null); setView("list"); setError(null); }}>All routines</Button>
        <RoutineForm key={editing?.id ?? "new"} routine={editing} bots={bots} threads={threads} defaultBotId={defaultBotId} defaultThreadId={defaultThreadId} defaultTimezone={timezone} busy={Boolean(busy)} onSave={save} onDelete={editing ? () => { setDeleting(editing); setError(null); } : undefined} />
      </> : <>
        <div className="flex items-center justify-between gap-3"><span className="text-xs text-neutral-500">{routines.length} routine{routines.length === 1 ? "" : "s"}</span><Button type="button" size="sm" icon={Plus} disabled={!bots.length || !threads.length || Boolean(busy)} onClick={() => { setEditing(null); setView("form"); setError(null); }}>New routine</Button></div>
        {!routines.length ? <div className="flex flex-col items-center gap-3 py-10 text-center text-neutral-500"><Clock3 size={28} /><p className="text-sm">Create a routine to schedule recurring work.</p></div> : <div className="space-y-3">
          {routines.map((routine) => <div key={routine.id} className="rounded-xl border border-white/10 bg-white/[0.025] p-3">
            <div className="flex items-center justify-between gap-3"><button type="button" disabled={Boolean(busy)} onClick={() => { setEditing(routine); setView("form"); setError(null); }} className="min-w-0 truncate text-left text-sm font-medium hover:underline">{routine.name}</button><RoutineSwitch checked={routine.enabled} disabled={Boolean(busy)} label={`${routine.enabled ? "Turn off" : "Turn on"} ${routine.name}`} onChange={() => void toggle(routine)} /></div>
            <p className="mt-1 text-[11px] text-neutral-500">{bots.find((bot) => bot.id === routine.botId)?.name ?? "Teammate"}</p>
            <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-neutral-400">{routine.instructions}</p>
            <p className="mt-3 text-xs text-neutral-300">{describeRoutineSchedule(routine.cron)}</p>
            <p className="mt-1 text-xs text-neutral-500">{routine.timezone} · {routine.enabled ? `Next ${formatRoutineTime(routine.nextRunAt, routine.timezone)}` : "Off"}</p>
            {routine.lastError ? <p className="mt-2 text-xs text-amber-300">{routine.lastError}</p> : null}
            <div className="mt-3 flex justify-end gap-1"><Button type="button" variant="ghost" size="xs" icon={Pencil} disabled={Boolean(busy)} onClick={() => { setEditing(routine); setView("form"); setError(null); }}>Edit</Button><Button type="button" variant="ghost" size="xs" icon={Trash2} className="text-red-300" disabled={Boolean(busy)} onClick={() => { setDeleting(routine); setError(null); }}>Delete</Button></div>
          </div>)}
        </div>}
      </>}
    </DialogContent>
  </Dialog>;
}

function RoutineSwitch({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: () => void }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange} className="flex shrink-0 items-center gap-2 rounded-md text-xs text-neutral-400 outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:opacity-40">
    <span>{checked ? "On" : "Off"}</span><span className={`flex h-5 w-9 items-center rounded-full px-0.5 transition-colors ${checked ? "bg-emerald-600" : "bg-neutral-700"}`}><span className={`size-4 rounded-full bg-white transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`} /></span>
  </button>;
}

function RoutineForm({ routine, bots, threads, defaultBotId, defaultThreadId, defaultTimezone, busy, onSave, onDelete }: {
  routine: Routine | null; bots: Bot[]; threads: Thread[]; defaultBotId?: string; defaultThreadId?: string; defaultTimezone: string; busy: boolean;
  onSave: (value: RoutineInput) => Promise<void>; onDelete?: () => void;
}) {
  const [name, setName] = useState(routine?.name ?? "");
  const [instructions, setInstructions] = useState(routine?.instructions ?? "");
  const [botId, setBotId] = useState(routine?.botId ?? defaultBotId ?? bots[0]?.id ?? "");
  const [threadId, setThreadId] = useState(() => routine?.threadId ?? threads.find((thread) => thread.id === defaultThreadId && thread.botIds.includes(botId))?.id ?? threads.find((thread) => thread.botIds.includes(botId) && thread.kind === "dm")?.id ?? threads.find((thread) => thread.botIds.includes(botId))?.id ?? "");
  const [schedule, setSchedule] = useState(() => readRoutineSchedule(routine?.cron));
  const [timezone, setTimezone] = useState(routine?.timezone || defaultTimezone);
  const [enabled, setEnabled] = useState(routine?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const eligibleThreads = threads.filter((thread) => thread.botIds.includes(botId));
  return <form className="space-y-4" onSubmit={(event) => {
    event.preventDefault(); setError(null);
    try { void onSave({ ...(routine ? { id: routine.id } : { botId, threadId }), name, instructions, cron: routineCron(schedule), timezone, enabled }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Check your schedule."); }
  }}>
    <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
      <div className="space-y-1.5"><Label htmlFor="routine-name">Name</Label><Input id="routine-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required placeholder="Morning news" /></div>
      <div className="space-y-1.5"><Label htmlFor="routine-instruction">Instruction</Label><Textarea id="routine-instruction" value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={20000} required rows={4} className="max-h-52 min-h-28" placeholder="Find today's important news and send me a concise summary with sources." /></div>
      {!routine ? <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="routine-bot">Teammate</Label><select id="routine-bot" className={selectClass} value={botId} onChange={(event) => { const id = event.target.value; setBotId(id); setThreadId(threads.find((thread) => thread.botIds.includes(id) && thread.kind === "dm")?.id ?? threads.find((thread) => thread.botIds.includes(id))?.id ?? ""); }} required>{bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></div>
        <div className="space-y-1.5"><Label htmlFor="routine-thread">Conversation</Label><select id="routine-thread" className={selectClass} value={threadId} onChange={(event) => setThreadId(event.target.value)} required>{!eligibleThreads.length ? <option value="">No conversation available</option> : eligibleThreads.map((thread) => <option key={thread.id} value={thread.id}>{thread.title}</option>)}</select></div>
      </div> : null}
      <div className="space-y-1.5"><Label htmlFor="routine-frequency">When to run</Label><select id="routine-frequency" className={selectClass} value={schedule.frequency} onChange={(event) => setSchedule((value) => ({ ...value, frequency: event.target.value as RoutineFrequency }))}><option value="daily">Every day</option><option value="weekdays">Weekdays (Mon–Fri)</option><option value="weekly">Every week</option><option value="monthly">Every month</option><option value="custom">Custom schedule (cron)</option></select></div>
      {schedule.frequency === "custom" ? <div className="space-y-1.5"><Label htmlFor="routine-cron">Cron expression</Label><Input id="routine-cron" value={schedule.cron} onChange={(event) => setSchedule((value) => ({ ...value, cron: event.target.value }))} required maxLength={160} placeholder="0 9 * * 1-5" className="font-mono" /><p className="text-xs text-neutral-500">Minute · hour · day of month · month · weekday</p></div> : <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="routine-time">Time</Label><Input id="routine-time" type="time" value={schedule.time} required onChange={(event) => setSchedule((value) => ({ ...value, time: event.target.value }))} /></div>
        {schedule.frequency === "weekly" ? <div className="space-y-1.5"><Label htmlFor="routine-weekday">Day</Label><select id="routine-weekday" className={selectClass} value={schedule.weekday} onChange={(event) => setSchedule((value) => ({ ...value, weekday: event.target.value }))}>{WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></div> : null}
        {schedule.frequency === "monthly" ? <div className="space-y-1.5"><Label htmlFor="routine-day">Day of month</Label><Input id="routine-day" type="number" min={1} max={31} required value={schedule.day} onChange={(event) => setSchedule((value) => ({ ...value, day: event.target.value }))} /><p className="text-xs text-neutral-500">Months without this day are skipped.</p></div> : null}
      </div>}
      <div className="space-y-1.5"><Label htmlFor="routine-timezone">Timezone</Label><Input id="routine-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} required maxLength={100} list="routine-timezones" placeholder="Asia/Tokyo" /><datalist id="routine-timezones">{["Asia/Tokyo", "UTC", "America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Singapore", "Australia/Sydney"].map((zone) => <option key={zone} value={zone} />)}</datalist></div>
      <div className="flex items-center justify-between rounded-lg border border-white/10 p-3"><span className="text-sm">Enabled</span><RoutineSwitch checked={enabled} label="Enable routine" onChange={() => setEnabled((value) => !value)} /></div>
    </fieldset>
    {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
    <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-4"><div>{onDelete ? <Button type="button" size="sm" variant="ghost" icon={Trash2} className="text-red-300" disabled={busy} onClick={onDelete}>Delete</Button> : null}</div><Button type="submit" loading={busy} disabled={!name.trim() || !instructions.trim() || !botId || !threadId}>{routine ? "Save changes" : "Create routine"}</Button></div>
  </form>;
}

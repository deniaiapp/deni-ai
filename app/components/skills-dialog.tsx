"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Skill } from "@/lib/types";

export function SkillsDialog({ open, skills, onClose, onSaved, onDeleted, onSync }: { open: boolean; skills: Skill[]; onClose: () => void; onSaved: (skill: Skill) => void; onDeleted: (id: string) => void; onSync: (skills: Skill[]) => void }) {
  const [editing, setEditing] = useState<Skill | null>(null);
  const [deleting, setDeleting] = useState<Skill | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const startedAt = revision.current;
    void fetch("/api/skills", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Could not refresh skills.");
      const data = await response.json() as { skills: Skill[] };
      if (!controller.signal.aborted && startedAt === revision.current) onSync(data.skills);
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [open, onSync]);
  function edit(skill: Skill | null) { setEditing(skill); setName(skill?.name ?? ""); setBody(skill?.body ?? ""); setError(null); setFormOpen(true); }
  async function save() {
    ++revision.current;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/skills", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(editing ? { id: editing.id } : {}), name, body }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save skill.");
      onSaved(data.skill); setFormOpen(false); setEditing(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save skill."); }
    finally { setBusy(false); }
  }
  function cancelDelete() { setDeleting(null); setError(null); }
  async function remove() {
    if (!deleting || busy) return;
    ++revision.current;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/skills", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: deleting.id }) });
      if (!response.ok && response.status !== 404) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Could not delete skill.");
      }
      onDeleted(deleting.id);
      setDeleting(null); setEditing(null); setFormOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete skill."); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={(open) => { if (!open && !busy) { if (deleting) cancelDelete(); else onClose(); } }}><DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
    <div key={deleting ? "delete" : formOpen ? "form" : "list"} className="deni-dialog-view grid gap-4">
    <DialogTitle>{deleting ? "Delete skill?" : formOpen ? editing ? "Edit skill" : "New skill" : "Skills"}</DialogTitle>
    <DialogDescription>{deleting ? `Delete “${deleting.name}”? This cannot be undone.` : "Reusable instructions for your teammates. Saved changes apply when a skill is read again."}</DialogDescription>
    {error ? <p role="alert" className="text-sm text-destructive-300">{error}</p> : null}
    {deleting ? <div className="flex justify-end gap-2">
      <Button type="button" variant="secondary" disabled={busy} onClick={cancelDelete}>Cancel</Button>
      <Button type="button" variant="destructive" icon={Trash2} loading={busy} onClick={() => void remove()}>Delete skill</Button>
    </div> : formOpen ? <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <Button type="button" variant="ghost" size="xs" icon={ArrowLeft} disabled={busy} onClick={() => { setFormOpen(false); setError(null); }}>All skills</Button>
      <div className="space-y-1.5"><Label htmlFor="skill-name">Name</Label><Input id="skill-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required disabled={busy} /></div>
      <div className="space-y-1.5"><Label htmlFor="skill-body">Instructions (Markdown)</Label><Textarea id="skill-body" value={body} onChange={(event) => setBody(event.target.value)} maxLength={100000} required disabled={busy} rows={14} className="max-h-[55vh] min-h-64 font-mono text-sm" placeholder="When to use this skill, steps to follow, and how to verify the result…" /></div>
      <div className="flex justify-between gap-2"><div>{editing ? <Button type="button" variant="secondary-destructive" icon={Trash2} disabled={busy} onClick={() => { setDeleting(editing); setError(null); }}>Delete skill</Button> : null}</div><Button type="submit" loading={busy} disabled={!name.trim() || !body.trim()}>{editing ? "Save changes" : "Create skill"}</Button></div>
    </form> : <>
      <div className="flex justify-end"><Button type="button" size="sm" icon={Plus} onClick={() => edit(null)}>New skill</Button></div>
      {!skills.length ? <p className="py-8 text-center text-sm text-neutral-500">No skills yet.</p> : <div className="space-y-2">{skills.map((skill) => <div key={skill.id} className="flex items-start gap-1 rounded-xl border border-foreground/10 bg-foreground/[0.025] pr-2">
        <button type="button" onClick={() => edit(skill)} className="min-w-0 flex-1 rounded-xl p-3 text-left hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-foreground/40">
        <span className="flex items-center justify-between gap-3"><span className="font-medium">{skill.name}</span><Pencil size={14} className="shrink-0 text-neutral-500" /></span>
        <span className="mt-2 line-clamp-3 block whitespace-pre-wrap text-xs text-neutral-400">{skill.body}</span>
        </button><Button type="button" variant="ghost" shape="square" icon={Trash2} className="mt-2 text-neutral-500 hover:text-destructive-300" aria-label={`Delete ${skill.name}`} title="Delete skill" onClick={() => { setDeleting(skill); setError(null); }} />
      </div>)}</div>}
    </>}
    </div>
  </DialogContent></Dialog>;
}

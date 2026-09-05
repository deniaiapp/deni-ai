"use client";

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Check, Copy, Reply, MoreHorizontal, Smile } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import * as Tooltip from "@radix-ui/react-tooltip";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { MessageReaction } from "@/lib/message-actions";
import { QUICK_REACTIONS } from "@/lib/emoji-catalog";
import ReactionPicker from "./reaction-picker";

export function MessageActions({ text, reactions, onReply, onReact, children, disabled = false }: {
  text: string;
  reactions: string[];
  onReply: () => void;
  onReact: (emoji: MessageReaction, selected: boolean) => Promise<void>;
  children: ReactNode;
  disabled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const reduceMotion = useReducedMotion();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const buttonClass = "inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-[#929292] transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white/50 disabled:opacity-50";

  async function copy() {
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Could not copy. Select the message text and copy it manually.");
    }
  }

  async function react(emoji: MessageReaction) {
    setError(null);
    setOpen(false);
    setExpanded(false);
    try { await onReact(emoji, !reactions.includes(emoji)); }
    catch { setError("Could not save the reaction. Please try again."); }
  }

  return <Tooltip.Provider delayDuration={220} skipDelayDuration={100}><div className="flex min-w-0 max-w-full flex-col gap-1">
    <div className="flex min-w-0 max-w-full items-start gap-1.5">
      <div className="min-w-0 flex-1">{children}</div>
      <div className={`flex shrink-0 items-center gap-0.5 pt-1 transition-opacity duration-150 ${disabled ? "invisible pointer-events-none" : open || copied ? "opacity-100" : "pointer-events-none opacity-0 group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"}`} role="group" aria-label="Message actions">
      <ActionTooltip label="Reply"><button type="button" className={buttonClass} aria-label="Reply" disabled={disabled} onClick={onReply}><Reply size={15} /></button></ActionTooltip>
      <Popover.Root open={open} onOpenChange={(value) => { setOpen(value); if (!value) setExpanded(false); }}>
        <ActionTooltip label="React"><Popover.Trigger asChild>
          <button type="button" className={buttonClass} aria-label="React" disabled={disabled}><Smile size={15} /></button>
        </Popover.Trigger></ActionTooltip>
        <Popover.Portal>
          <Popover.Content aria-label="Choose a reaction" align="start" side="top" sideOffset={8} collisionPadding={16} className="z-50 overflow-hidden rounded-2xl border border-white/10 bg-[#202020] shadow-[0_8px_32px_#0008] outline-none">
            {expanded ? <ReactionPicker onSelect={(emoji) => void react(emoji)} onBack={() => setExpanded(false)} /> : <div className="flex items-center gap-0.5 p-1.5" role="group" aria-label="Quick reactions">
              {QUICK_REACTIONS.map((emoji) => <button key={emoji} type="button" aria-label={`React ${emoji}`} aria-pressed={reactions.includes(emoji)} onClick={() => void react(emoji)} className="flex size-9 items-center justify-center rounded-xl text-[22px] transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white/40 aria-pressed:bg-white/10">{emoji}</button>)}
              <button type="button" aria-label="More emoji" title="More emoji" onClick={() => setExpanded(true)} className="ml-1 flex size-9 items-center justify-center rounded-xl border-l border-white/10 text-neutral-400 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-white/40"><MoreHorizontal size={18} /></button>
            </div>}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <ActionTooltip label={copied ? "Copied" : "Copy"}><button type="button" className={buttonClass} disabled={disabled} onClick={() => void copy()} aria-label={copied ? "Copied" : "Copy"}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={copied ? "copied" : "copy"} className={`inline-flex items-center gap-1.5 ${copied ? "text-emerald-300" : ""}`} initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 4, scale: 0.85 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -3, scale: 0.9 }} transition={{ duration: reduceMotion ? 0 : 0.16 }}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </motion.span>
        </AnimatePresence>
      </button></ActionTooltip>
      <span className="sr-only" role="status">{copied ? "Message copied" : ""}</span>
      </div>
    </div>
    {reactions.length ? <div className="flex flex-wrap gap-1">{reactions.map((emoji) => <motion.button key={emoji} type="button" aria-label={`Remove ${emoji} reaction`} aria-pressed="true" onClick={() => void react(emoji)} initial={{ scale: reduceMotion ? 1 : 0.65 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 450, damping: 24 }} className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-sm hover:bg-white/10">{emoji}</motion.button>)}</div> : null}
    {error ? <p role="alert" className="max-w-xs text-xs text-amber-300">{error}</p> : null}
  </div></Tooltip.Provider>;
}

function ActionTooltip({ label, children }: { label: string; children: ReactElement }) {
  return <Tooltip.Root>
    <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content side="top" sideOffset={6} collisionPadding={8} className="z-[60] rounded-md border border-white/10 bg-[#292929] px-2 py-1 text-[11px] text-[#eeeeee] shadow-lg">
        {label}
        <Tooltip.Arrow className="fill-[#292929]" />
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>;
}

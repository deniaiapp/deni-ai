import { useExtracted } from "@/i18n/react";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Check, Copy, Reply, MoreHorizontal, Smile } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { Tooltip } from "@base-ui/react/tooltip";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { MessageReaction } from "@/lib/message-actions";
import { QUICK_REACTIONS } from "@/lib/emoji-catalog";
import ReactionPicker from "./reaction-picker";

export function MessageActions({ text, reactions, onReply, onReact, children, disabled = false, side = "start" }: {
  text: string;
  /**
   * The side the bubble sits on. The person's own messages ("end") always have the actions under
   * the bubble; replies have them beside it, and under it on touch screens.
   */
  side?: "start" | "end";
  reactions: string[];
  onReply: () => void;
  onReact: (emoji: MessageReaction, selected: boolean) => Promise<void>;
  children: ReactNode;
  disabled?: boolean;
}) {
  const t = useExtracted();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const reduceMotion = useReducedMotion();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const buttonClass = "inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-neutral-146 transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground/50 disabled:opacity-50";

  async function copy() {
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(t("Could not copy. Select the message text and copy it manually."));
    }
  }

  async function react(emoji: MessageReaction) {
    setError(null);
    setOpen(false);
    setExpanded(false);
    try { await onReact(emoji, !reactions.includes(emoji)); }
    catch { setError(t("Could not save the reaction. Please try again.")); }
  }

  return <Tooltip.Provider delay={220} timeout={100}><div className="flex min-w-0 max-w-full flex-col gap-1">
    {/* Touch screens show the actions all the time, so they sit under the message instead of
        taking width beside it. */}
    <div className={side === "end" ? "flex min-w-0 max-w-full flex-col items-end gap-0.5" : "flex min-w-0 max-w-full items-start gap-1.5 [@media(hover:none)]:flex-col [@media(hover:none)]:gap-0.5"}>
      <div className={side === "end" ? "min-w-0 max-w-full" : "min-w-0 flex-1 [@media(hover:none)]:max-w-full [@media(hover:none)]:flex-none"}>{children}</div>
      <div className={`flex shrink-0 items-center gap-0.5 ${side === "end" ? "" : "pt-1 [@media(hover:none)]:pt-0"} transition-opacity duration-150 ${disabled ? "invisible pointer-events-none" : open || copied ? "opacity-100" : "pointer-events-none opacity-0 group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"}`} role="group" aria-label={t("Message actions")}>
      <ActionTooltip label={t("Reply")}><button type="button" className={buttonClass} aria-label={t("Reply")} disabled={disabled} onClick={onReply}><Reply size={15} /></button></ActionTooltip>
      <Popover.Root open={open} onOpenChange={(value) => { setOpen(value); if (!value) setExpanded(false); }}>
        <ActionTooltip label={t("React")}><Popover.Trigger className={buttonClass} aria-label={t("React")} disabled={disabled}>
          <Smile size={15} />
        </Popover.Trigger></ActionTooltip>
        <Popover.Portal>
          <Popover.Positioner align="start" side="top" sideOffset={8} collisionPadding={16} className="z-50">
          <Popover.Popup aria-label={t("Choose a reaction")} className="overflow-hidden rounded-2xl border border-foreground/10 bg-surface-32 shadow-[0_8px_32px_color-mix(in_srgb,var(--color-black)_53%,transparent)] outline-none">
            {expanded ? <ReactionPicker onSelect={(emoji) => void react(emoji)} onBack={() => setExpanded(false)} /> : <div className="flex items-center gap-0.5 p-1.5" role="group" aria-label={t("Quick reactions")}>
              {QUICK_REACTIONS.map((emoji) => <button key={emoji} type="button" aria-label={t("React {emoji}", { emoji })} aria-pressed={reactions.includes(emoji)} onClick={() => void react(emoji)} className="flex size-9 items-center justify-center rounded-xl text-[22px] transition-colors hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-foreground/40 aria-pressed:bg-foreground/10">{emoji}</button>)}
              <button type="button" aria-label={t("More emoji")} title={t("More emoji")} onClick={() => setExpanded(true)} className="ml-1 flex size-9 items-center justify-center rounded-xl border-l border-foreground/10 text-neutral-400 hover:bg-foreground/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground/40"><MoreHorizontal size={18} /></button>
            </div>}
          </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <ActionTooltip label={copied ? t("Copied") : t("Copy")}><button type="button" className={buttonClass} disabled={disabled} onClick={() => void copy()} aria-label={copied ? t("Copied") : t("Copy")}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={copied ? "copied" : "copy"} className={`inline-flex items-center gap-1.5 ${copied ? "text-success-300" : ""}`} initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 4, scale: 0.85 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -3, scale: 0.9 }} transition={{ duration: reduceMotion ? 0 : 0.16 }}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </motion.span>
        </AnimatePresence>
      </button></ActionTooltip>
      <span className="sr-only" role="status">{copied ? t("Message copied") : ""}</span>
      </div>
    </div>
    {reactions.length ? <div className={`flex flex-wrap gap-1 ${side === "end" ? "justify-end" : ""}`}>{reactions.map((emoji) => <motion.button key={emoji} type="button" aria-label={t("Remove {emoji} reaction", { emoji })} aria-pressed="true" onClick={() => void react(emoji)} initial={{ scale: reduceMotion ? 1 : 0.65 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 450, damping: 24 }} className="rounded-full border border-foreground/15 bg-foreground/5 px-2 py-0.5 text-sm hover:bg-foreground/10">{emoji}</motion.button>)}</div> : null}
    {error ? <p role="alert" className="max-w-xs text-xs text-warning-300">{error}</p> : null}
  </div></Tooltip.Provider>;
}

function ActionTooltip({ label, children }: { label: string; children: ReactElement }) {
  return <Tooltip.Root>
    <Tooltip.Trigger render={children} />
    <Tooltip.Portal>
      <Tooltip.Positioner side="top" sideOffset={6} collisionPadding={8} className="z-[60]">
        <Tooltip.Popup className="rounded-md border border-foreground/10 bg-surface-41 px-2 py-1 text-[11px] text-neutral-238 shadow-lg">
          {label}
          <Tooltip.Arrow className="data-[side=top]:-bottom-1 data-[side=bottom]:-top-1 size-2 rotate-45 border-foreground/10 bg-surface-41 data-[side=top]:border-r data-[side=top]:border-b data-[side=bottom]:border-t data-[side=bottom]:border-l" />
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>
  </Tooltip.Root>;
}

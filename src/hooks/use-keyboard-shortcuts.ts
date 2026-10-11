import { useEffect } from "react";

interface KeyboardShortcutsOptions {
  enabled?: boolean;
  onFocusComposer?: () => void;
  onNewChat?: () => void;
  onNavigateUp?: () => void;
  onNavigateDown?: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  if (target.getAttribute("role") === "textbox") return true;
  return false;
}

export function useKeyboardShortcuts({
  enabled = true,
  onFocusComposer,
  onNewChat,
  onNavigateUp,
  onNavigateDown,
}: KeyboardShortcutsOptions) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      // With Shift (or Caps Lock) held, `key` is the upper-case letter.
      const key = e.key.toLowerCase();

      // "/" — focus composer. Ctrl/Cmd+K belongs to AppShell's chat search.
      if (
        key === "/" &&
        !isCtrlOrCmd &&
        !e.altKey &&
        !e.defaultPrevented &&
        !isEditableTarget(e.target)
      ) {
        e.preventDefault();
        onFocusComposer?.();
        return;
      }

      // Ctrl+Shift+C / Cmd+Shift+C — new chat
      if (isCtrlOrCmd && e.shiftKey && key === "c") {
        // Don't intercept if typing in an input
        if (!isEditableTarget(e.target)) {
          e.preventDefault();
          onNewChat?.();
        }
        return;
      }

      // Alt+ArrowUp / Alt+ArrowDown — navigate messages
      if (e.altKey && !isEditableTarget(e.target)) {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          onNavigateUp?.();
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          onNavigateDown?.();
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, onFocusComposer, onNewChat, onNavigateUp, onNavigateDown]);
}

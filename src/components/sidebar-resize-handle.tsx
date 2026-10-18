"use client";

import { useExtracted } from "next-intl";
import { useRef, useSyncExternalStore } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import {
  clampSidebarWidth,
  getServerSidebarWidth,
  getSidebarWidth,
  persistSidebarWidth,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  setSidebarWidth,
  subscribeSidebarWidth,
} from "@/lib/sidebar-width";

const KEYBOARD_STEP = 16;
/** Set on <html> while dragging so the sidebar skips its width transition. */
const RESIZING_ATTRIBUTE = "data-sidebar-resizing";

/** Drag handle on the sidebar's inline-end edge. Double-click resets the width. */
export function SidebarResizeHandle() {
  const t = useExtracted();
  const { isMobile, state } = useSidebar();
  const width = useSyncExternalStore(subscribeSidebarWidth, getSidebarWidth, getServerSidebarWidth);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);

  if (isMobile || state === "collapsed") {
    return null;
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    delete event.currentTarget.dataset.resizing;
    document.documentElement.removeAttribute(RESIZING_ATTRIBUTE);
    persistSidebarWidth(getSidebarWidth());
  };

  const resizeBy = (delta: number) => {
    const next = clampSidebarWidth(getSidebarWidth() + delta);
    setSidebarWidth(next);
    persistSidebarWidth(next);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("Resize sidebar")}
      aria-valuemin={SIDEBAR_WIDTH_MIN}
      aria-valuemax={SIDEBAR_WIDTH_MAX}
      aria-valuenow={width}
      tabIndex={0}
      title={t("Drag to resize, double-click to reset")}
      data-slot="sidebar-resize-handle"
      className="absolute inset-y-0 -right-1.5 z-20 w-3 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:transition-colors hover:after:bg-sidebar-ring/60 focus-visible:after:bg-sidebar-ring data-[resizing=true]:after:bg-sidebar-ring"
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.dataset.resizing = "true";
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: getSidebarWidth(),
        };
        document.documentElement.setAttribute(RESIZING_ATTRIBUTE, "");
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) {
          return;
        }
        setSidebarWidth(clampSidebarWidth(drag.startWidth + event.clientX - drag.startX));
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => {
        setSidebarWidth(null);
        persistSidebarWidth(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          resizeBy(-KEYBOARD_STEP);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          resizeBy(KEYBOARD_STEP);
        } else if (event.key === "Home") {
          event.preventDefault();
          resizeBy(-Infinity);
        } else if (event.key === "End") {
          event.preventDefault();
          resizeBy(Infinity);
        }
      }}
    />
  );
}

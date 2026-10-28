import { ChevronDown } from "lucide-react";
import { type ReactNode, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

type HeaderMegaMenuProps = {
  label: string;
  menuLabel: string;
  children: ReactNode;
};

export function HeaderMegaMenu({ label, menuLabel, children }: HeaderMegaMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
      onFocusCapture={() => setIsOpen(true)}
      onBlurCapture={(event) => {
        const nextFocusedElement = event.relatedTarget;

        if (nextFocusedElement && containerRef.current?.contains(nextFocusedElement)) {
          return;
        }

        setIsOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") {
          return;
        }

        setIsOpen(false);
        const trigger = event.currentTarget.querySelector("button");
        if (trigger instanceof HTMLButtonElement) {
          trigger.focus();
        }
      }}
    >
      <Button
        type="button"
        variant="outline"
        className="rounded-4xl"
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span>{label}</span>
        <ChevronDown
          className={cn(
            "size-3.5 text-primary transition-transform duration-200",
            isOpen && "rotate-180",
          )}
        />
      </Button>

      <div
        id={menuId}
        role="menu"
        aria-label={menuLabel}
        aria-hidden={!isOpen}
        inert={!isOpen}
        className={cn(
          "absolute left-0 top-full pt-3 transition duration-200",
          isOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <div
          className={cn(
            "w-[min(88vw,760px)] rounded-xl border border-border bg-popover/96 p-4 text-popover-foreground shadow-2xl backdrop-blur-xl transition duration-200",
            isOpen ? "translate-y-0 scale-100" : "-translate-y-1 scale-[0.98]",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

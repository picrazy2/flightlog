import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

interface Props {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "start" | "end";
  className?: string;
}

// Renders its content in a body portal with fixed positioning so it always floats
// above all map chrome (glass elements create stacking contexts that would otherwise
// trap an absolutely-positioned dropdown).
export function Popover({ trigger, children, align = "start", className }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number }>({ top: 0, left: 0, maxHeight: 0 });

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const cw = contentRef.current?.offsetWidth ?? 0;
    const ch = contentRef.current?.scrollHeight ?? 0; // natural (uncapped) height
    const M = 8; // keep this clear of the viewport edges
    // align the content to the trigger, then clamp so it never spills off-screen
    let left = align === "end" ? r.right - cw : r.left;
    left = Math.max(M, Math.min(left, window.innerWidth - cw - M));
    // open below the trigger; if it doesn't fit and there's more room above, flip up.
    // Either way cap the height to the space on that side so a long list can scroll.
    const spaceBelow = window.innerHeight - (r.bottom + 8) - M;
    const spaceAbove = r.top - 8 - M;
    let top: number, maxHeight: number;
    if (ch <= spaceBelow || spaceBelow >= spaceAbove) {
      top = r.bottom + 8;
      maxHeight = Math.max(80, spaceBelow);
    } else {
      maxHeight = Math.max(80, spaceAbove);
      top = r.top - 8 - Math.min(ch, maxHeight);
    }
    setPos({ top, left, maxHeight });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !contentRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <span ref={triggerRef} className="inline-flex">
        {trigger({ open, toggle: () => setOpen((o) => !o) })}
      </span>
      {open &&
        createPortal(
          <div
            ref={contentRef}
            style={{ position: "fixed", top: pos.top, left: pos.left, maxHeight: pos.maxHeight || undefined, zIndex: 1000 }}
            className={cn("glass animate-fade-in overflow-y-auto rounded-xl p-2", className)}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </>
  );
}

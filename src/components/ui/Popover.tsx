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
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const cw = contentRef.current?.offsetWidth ?? 0;
    const ch = contentRef.current?.offsetHeight ?? 0;
    const M = 8; // keep this clear of the viewport edges
    // align the content to the trigger, then clamp so it never spills off-screen
    let left = align === "end" ? r.right - cw : r.left;
    left = Math.max(M, Math.min(left, window.innerWidth - cw - M));
    // open below the trigger; flip above if it would overflow the bottom edge
    let top = r.bottom + 8;
    if (ch && top + ch > window.innerHeight - M) {
      top = r.top - 8 - ch >= M ? r.top - 8 - ch : Math.max(M, window.innerHeight - ch - M);
    }
    setPos({ top, left });
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
            style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 1000 }}
            className={cn("glass animate-fade-in rounded-xl p-2", className)}
          >
            {children(() => setOpen(false))}
          </div>,
          document.body,
        )}
    </>
  );
}

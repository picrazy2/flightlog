import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

interface Props {
  title: string;
  headline?: ReactNode; // big stat in the header
  onClose: () => void;
  onReset?: () => void; // clears active filters; shown when provided
  children: ReactNode;
  className?: string;
}

// A module renders its always-visible action buttons inside <PanelFooter>; they portal
// into the panel's fixed footer slot (outside the scroll area) while keeping their state
// in the module tree. Falls back to inline rendering when there's no panel (mobile).
const FooterSlot = createContext<HTMLElement | null>(null);
export function PanelFooter({ children }: { children: ReactNode }) {
  const node = useContext(FooterSlot);
  if (node) return createPortal(children, node);
  // mobile fallback (no fixed footer slot): render inline and let it scroll with the
  // content rather than sticking to the bottom of the drawer
  return <div className="-mx-5 -mb-4 mt-3 border-t border-border bg-surface-1 px-4 py-3">{children}</div>;
}

// Bottom-left detail panel: header → scrollable body → (optional) fixed footer.
export function Panel({ title, headline, onClose, onReset, children, className }: Props) {
  const [footerEl, setFooterEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-label={title}
      className={cn(
        "glass animate-panel-in flex max-h-[72vh] w-[420px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl",
        className,
      )}
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 pb-3 pt-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-title text-ink">{title}</h2>
          {headline}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onReset && (
            <button onClick={onReset} className="focus-ring text-caption text-accent hover:underline">
              Reset
            </button>
          )}
          <Button variant="ghost" size="sm" iconOnly aria-label="Close" onClick={onClose}>
            ✕
          </Button>
        </div>
      </header>
      <FooterSlot.Provider value={footerEl}>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">{children}</div>
      </FooterSlot.Provider>
      {/* fixed footer slot — stays hidden until a PanelFooter portals content in */}
      <div ref={setFooterEl} className="shrink-0 border-t border-border bg-surface-1 px-5 py-3 empty:hidden" />
    </div>
  );
}

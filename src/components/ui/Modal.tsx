import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { Button } from "./Button";
import { Chevron } from "./Icon";
import { useIsMobile } from "@/lib/useIsMobile";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function Modal({ title, onClose, children, actions, className }: Props) {
  const mobile = useIsMobile();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  // Mobile: full-screen sheet with a back button. Desktop: centered card.
  const body = mobile ? (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-0" role="dialog" aria-modal="true" aria-label={title} style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <header className="flex items-center gap-2 border-b border-border px-3 py-3">
        <button onClick={onClose} aria-label="Back" className="focus-ring -ml-1 grid h-9 w-9 place-items-center rounded-full text-ink hover:bg-surface-2">
          <Chevron dir="left" size={16} />
        </button>
        <h2 className="min-w-0 flex-1 truncate font-display text-title font-semibold text-ink">{title}</h2>
        {actions}
      </header>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  ) : (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="animate-fade-in absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} />
      <div className={cn("glass animate-panel-in relative flex max-h-[88vh] w-[min(960px,95vw)] flex-col overflow-hidden rounded-xl", className)}>
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <h2 className="font-display text-title font-semibold text-ink">{title}</h2>
          <div className="flex items-center gap-2">
            {actions}
            <Button variant="ghost" size="sm" iconOnly aria-label="Close" onClick={onClose}>
              ✕
            </Button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );

  // portal to <body> so it isn't clipped/offset by an ancestor's transform or backdrop-filter
  return createPortal(body, document.body);
}

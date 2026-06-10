import { useEffect, type ReactNode } from "react";
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

// Bottom-left detail panel: header → (controls) → chart → secondary section.
export function Panel({ title, headline, onClose, onReset, children, className }: Props) {
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
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 pb-3 pt-4">
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
      <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">{children}</div>
    </div>
  );
}

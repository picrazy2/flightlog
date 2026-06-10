import { cn } from "@/lib/cn";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
}

// Canonical multi-option toggle: pill track + sliding thumb under the active item.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
  ...aria
}: Props<T>) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const h = size === "sm" ? "h-7" : "h-[34px]";
  return (
    <div
      role="radiogroup"
      aria-label={aria["aria-label"]}
      className={cn(
        "relative inline-grid items-center rounded-full border border-border bg-surface-2 p-0.5",
        h,
        className,
      )}
      // equal-width columns so the thumb (which assumes equal widths) always aligns,
      // regardless of how long individual labels are
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}
    >
      {/* sliding thumb — accounts for the 2px track padding on each side */}
      <div
        className="absolute inset-y-0.5 rounded-full border border-border-strong bg-surface-3 transition-[left,width] duration-200 ease-in-out"
        style={{
          left: `calc(${idx} * (100% - 4px) / ${options.length} + 2px)`,
          width: `calc((100% - 4px) / ${options.length})`,
        }}
      />
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "focus-ring relative z-10 w-full min-w-0 truncate rounded-full px-3 text-label font-medium transition-colors duration-150",
              size === "sm" ? "py-1 text-caption" : "py-1.5",
              active ? "text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

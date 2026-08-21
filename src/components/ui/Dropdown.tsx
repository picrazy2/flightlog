import { Popover } from "./Popover";
import { Chevron } from "./Icon";
import { cn } from "@/lib/cn";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface Props<T extends string> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  // accent (blue) styling when this represents a non-default / active selection
  active?: boolean;
  // widen the menu for long labels (airline names); default suits short metric labels
  menuWidth?: string;
  "aria-label"?: string;
}

// Compact themed dropdown (Popover-based) — used for the metric selector.
export function Dropdown<T extends string>({ value, options, onChange, size = "sm", active, menuWidth, ...aria }: Props<T>) {
  const current = options.find((o) => o.value === value);
  const h = size === "sm" ? "h-7 text-caption" : "h-[34px] text-label";
  return (
    <Popover
      align="end"
      trigger={({ toggle, open }) => (
        <button
          aria-label={aria["aria-label"]}
          onClick={toggle}
          className={cn(
            "focus-ring inline-flex items-center gap-1.5 rounded-full border px-3 font-medium",
            h,
            active
              ? "border-accent bg-[rgba(91,157,255,0.14)] text-accent hover:bg-[rgba(91,157,255,0.22)]"
              : "border-border bg-surface-2 text-ink hover:bg-surface-3",
            open && !active && "border-border-strong",
          )}
        >
          {current?.label ?? value}
          <Chevron dir={open ? "up" : "down"} size={11} color={active ? "var(--accent)" : "var(--ink-faint)"} />
        </button>
      )}
    >
      {(close) => (
        // capped and scrollable: a long option list (every airline flown) would otherwise
        // render taller than the viewport with no way to reach the bottom
        <div className={cn(menuWidth ?? "w-[130px]", "max-h-[min(60vh,340px)] overflow-y-auto")}>
          {options.map((o) => (
            <button
              key={o.value}
              disabled={o.disabled}
              onClick={() => {
                if (o.disabled) return;
                onChange(o.value);
                close();
              }}
              className={cn(
                "focus-ring block w-full rounded-md px-2.5 py-1.5 text-left text-label",
                o.disabled
                  ? "cursor-not-allowed text-ink-faint opacity-50"
                  : o.value === value
                  ? "text-accent hover:bg-surface-2"
                  : "text-ink hover:bg-surface-2",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

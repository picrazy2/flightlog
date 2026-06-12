import { Popover } from "./Popover";
import { Chevron } from "./Icon";
import { cn } from "@/lib/cn";

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  // accent (blue) styling when this represents a non-default / active selection
  active?: boolean;
  "aria-label"?: string;
}

// Compact themed dropdown (Popover-based) — used for the metric selector.
export function Dropdown<T extends string>({ value, options, onChange, size = "sm", active, ...aria }: Props<T>) {
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
        <div className="w-[130px]">
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => {
                onChange(o.value);
                close();
              }}
              className={cn(
                "focus-ring block w-full rounded-md px-2.5 py-1.5 text-left text-label hover:bg-surface-2",
                o.value === value ? "text-accent" : "text-ink",
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

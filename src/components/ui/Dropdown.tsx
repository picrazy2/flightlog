import { Popover } from "./Popover";
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
  "aria-label"?: string;
}

// Compact themed dropdown (Popover-based) — used for the metric selector.
export function Dropdown<T extends string>({ value, options, onChange, size = "sm", ...aria }: Props<T>) {
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
            "focus-ring inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 font-medium text-ink hover:bg-surface-3",
            h,
            open && "border-border-strong",
          )}
        >
          {current?.label ?? value}
          <span className="text-ink-faint">▾</span>
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

import { cn } from "@/lib/cn";

interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  id?: string;
}

// Binary on/off (settings: km↔mi, great-circle on/off).
export function Switch({ checked, onChange, label, id }: Props) {
  return (
    <label htmlFor={id} className="inline-flex cursor-pointer select-none items-center gap-2">
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "focus-ring relative h-5 w-9 rounded-full border border-border transition-colors duration-200",
          checked ? "bg-accent" : "bg-surface-3",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-[left] duration-200 ease-in-out",
            checked ? "left-[18px]" : "left-0.5",
          )}
        />
      </button>
      {label && <span className="text-label text-ink-muted">{label}</span>}
    </label>
  );
}

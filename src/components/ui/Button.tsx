import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  iconOnly?: boolean;
}

const variants: Record<Variant, string> = {
  primary: "bg-accent text-[var(--accent-ink)] hover:bg-accent-press",
  secondary: "bg-surface-2 text-ink border border-border hover:bg-surface-3",
  ghost: "bg-transparent text-ink-muted hover:bg-surface-2 hover:text-ink",
  danger: "bg-transparent text-negative hover:bg-[rgba(248,113,113,0.12)]",
};
const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-caption",
  md: "h-[34px] px-3.5 text-label",
  lg: "h-10 px-4 text-body",
};
const iconSizes: Record<Size, string> = { sm: "h-7 w-7", md: "h-[34px] w-[34px]", lg: "h-10 w-10" };

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "secondary", size = "md", iconOnly, className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "focus-ring inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-[background-color,transform,color] duration-150 ease-out active:scale-[.98] disabled:pointer-events-none disabled:opacity-40",
        variants[variant],
        iconOnly ? iconSizes[size] : sizes[size],
        className,
      )}
      {...props}
    />
  );
});

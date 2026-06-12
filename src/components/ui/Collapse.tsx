import type { ReactNode } from "react";

// Smoothly expand/collapse content height. Uses the grid-rows 0fr→1fr trick so it works
// without measuring or a fixed max-height. Children stay mounted while collapsing.
export function Collapse({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <div
      className={`grid transition-[grid-template-rows] duration-200 ease-out ${className ?? ""}`}
      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

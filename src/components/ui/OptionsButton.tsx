import type { ReactNode } from "react";
import { Popover } from "./Popover";
import { Button } from "./Button";

// "⋯ Options" overflow for panels with more toggles than fit the header row.
export function OptionsButton({ children }: { children: ReactNode }) {
  return (
    <Popover
      align="end"
      trigger={({ toggle }) => (
        <Button variant="ghost" size="sm" iconOnly aria-label="Options" onClick={toggle}>
          ⋯
        </Button>
      )}
    >
      {() => <div className="flex w-[180px] flex-col gap-2.5 p-1">{children}</div>}
    </Popover>
  );
}

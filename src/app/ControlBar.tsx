import { DateRangePicker } from "./DateRangePicker";
import { FilterChips } from "./FilterChips";
import { SearchBox } from "./SearchBox";
import { SettingsMenu } from "./SettingsMenu";
import { UserMenu } from "./UserMenu";
import { OverflowMenu } from "./mobile/OverflowMenu";
import { Wordmark } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useStore } from "@/state/store";
import { useIsMobile } from "@/lib/useIsMobile";
import type { StatContext } from "@/stats/types";

export function ControlBar({ ctx }: { ctx: StatContext }) {
  // tablet (768–1024): collapse the inline map/account controls into the hamburger
  const compact = useIsMobile(1024);
  const setDbOpen = useStore((s) => s.setDbOpen);
  return (
    <div className="glass pointer-events-auto relative z-40 flex items-center gap-3 rounded-xl px-4 py-2.5">
      <div className="pr-1">
        <Wordmark markSize={30} />
      </div>
      <div className="h-5 w-px bg-border" />
      {/* date is the first "chip"; year drill-downs update it, other filters add chips */}
      <DateRangePicker ctx={ctx} />
      <div className="flex min-w-0 shrink items-center gap-2 overflow-x-auto">
        <FilterChips />
      </div>
      <SearchBox ctx={ctx} />
      {/* spacer pushes the map/account controls to the right */}
      <div className="min-w-0 flex-1" />
      {compact ? (
        <div className="shrink-0">
          <OverflowMenu />
        </div>
      ) : (
        <>
          {/* only the Add button + the gear (settings) stay visible; everything else
              (map/display prefs, About) lives inside the gear menu */}
          <div className="flex shrink-0 items-center gap-1.5">
            {/* Named, not a bare "+": this opens the whole flights/bookings database —
                browsing and editing as much as adding — and a plus reads write-only. */}
            <Button
              variant="ghost"
              size="lg"
              aria-label="Flights"
              title="Flights, bookings and import"
              className="rounded-full bg-[rgba(91,157,255,0.14)] text-accent hover:scale-105 hover:bg-[rgba(91,157,255,0.28)]"
              onClick={() => setDbOpen(true)}
            >
              <Icon name="plane" color="currentColor" size={18} />
              Flights
            </Button>
            <SettingsMenu />
          </div>
          <div className="h-5 w-px shrink-0 bg-border" />
          <div className="shrink-0">
            <UserMenu />
          </div>
        </>
      )}
    </div>
  );
}

import { useStore } from "@/state/store";
import { Wordmark } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { StatCardsRow } from "../StatCardsRow";
import { SearchBox } from "../SearchBox";
import { FilterChips } from "../FilterChips";
import { OverflowMenu } from "./OverflowMenu";
import { DrawerStack } from "./DrawerStack";
import type { StatContext, MapEncoding } from "@/stats/types";

// Mobile chrome over the full-screen map: a solid header, floating stat cards, a
// search icon + fullscreen button, and the bottom drawer stack.
export function MobileShell({ ctx, encoding }: { ctx: StatContext; encoding: MapEncoding | undefined }) {
  const immersive = useStore((s) => s.immersive);
  const toggleImmersive = useStore((s) => s.toggleImmersive);

  const onFullscreen = () => {
    toggleImmersive();
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  };

  if (immersive) {
    return (
      <div className="pointer-events-auto fixed right-3 top-3 z-40" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <Button variant="secondary" size="md" iconOnly aria-label="Exit fullscreen" onClick={onFullscreen}>
          ✕
        </Button>
      </div>
    );
  }

  return (
    <>
      {/* top chrome: header is solid; cards + search/fullscreen float over the map */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-40">
        <header
          className="pointer-events-auto flex items-center justify-between gap-2 border-b border-border bg-surface-1 px-3 py-2"
          style={{ paddingTop: "max(0.5rem, env(safe-area-inset-top))" }}
        >
          <Wordmark markSize={26} />
          <OverflowMenu />
        </header>
        {/* full-bleed cards: they run to both edges (bleed right) to signal scroll */}
        <div className="pt-2">
          <StatCardsRow ctx={ctx} mobile />
        </div>
        {/* filter chips (left) + search icon, then fullscreen on the right */}
        <div className="flex items-center gap-2 px-3 pt-2">
          <div className="pointer-events-auto flex min-w-0 items-center gap-2 overflow-x-auto no-scrollbar">
            <FilterChips />
          </div>
          <div className="pointer-events-auto shrink-0">
            <SearchBox ctx={ctx} iconOnly />
          </div>
          <div className="flex-1" />
          <button
            onClick={onFullscreen}
            aria-label="Fullscreen"
            className="focus-ring pointer-events-auto grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-surface-1 text-ink shadow-1"
          >
            ⛶
          </button>
        </div>
      </div>

      <DrawerStack ctx={ctx} encoding={encoding} />
    </>
  );
}

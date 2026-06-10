import { useLayoutEffect, useRef, useState } from "react";
import { REGISTRY } from "@/stats/registry";
import { useStore } from "@/state/store";
import { StatCard } from "@/components/ui/StatCard";
import type { StatContext } from "@/stats/types";

// Generic: iterate the registry. No knowledge of any specific stat.
// The row scales up so the cards fill the full window width (never leaving a gap).
// `mobile` makes it edge-to-edge tap-scroll: hidden scrollbar, no upscaling, cards
// bleed off the right edge to signal scrollability (left padding at the start).
export function StatCardsRow({ ctx, mobile }: { ctx: StatContext; mobile?: boolean }) {
  const { activeModuleId, setActiveModule, settings } = useStore();
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number>();

  useLayoutEffect(() => {
    const fit = () => {
      if (!outer.current || !inner.current) return;
      // mobile: never upscale, no scrollbar reservation — cards bleed off the edge
      if (mobile) {
        setScale(1);
        setHeight(inner.current.offsetHeight);
        return;
      }
      const avail = outer.current.clientWidth;
      const natural = inner.current.scrollWidth;
      if (!natural) return;
      // epsilon avoids a subpixel horizontal overflow when the row fills exactly
      const s = Math.max(1, Math.min(2, (avail - 2) / natural));
      setScale((p) => (Math.abs(p - s) > 0.005 ? s : p));
      // reserve space for the horizontal scrollbar ONLY when the row actually overflows
      const overflow = natural > avail + 1;
      setHeight(Math.ceil(inner.current.offsetHeight * s) + (overflow ? 18 : 0));
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (outer.current) ro.observe(outer.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, [mobile]);

  return (
    <div
      ref={outer}
      className={`pointer-events-auto w-full overflow-x-auto overflow-y-hidden${mobile ? " no-scrollbar" : ""}`}
      style={{ height }}
    >
      <div
        ref={inner}
        className={`flex w-max gap-2.5 pt-px${mobile ? " px-3" : ""}`}
        style={{ transform: `scale(${scale})`, transformOrigin: "left top" }}
      >
        {REGISTRY.map((m) => (
          <StatCard
            key={m.id}
            model={m.card(ctx)}
            settings={settings}
            compareMode={ctx.compareMode}
            active={m.id === activeModuleId}
            onClick={() => setActiveModule(m.id)}
          />
        ))}
      </div>
    </div>
  );
}

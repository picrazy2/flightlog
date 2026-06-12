import { useLayoutEffect, useRef, useState } from "react";
import { REGISTRY } from "@/stats/registry";
import { useStore } from "@/state/store";
import { StatCard } from "@/components/ui/StatCard";
import type { StatContext } from "@/stats/types";

// Generic: iterate the registry. No knowledge of any specific stat.
// The row scales up so the cards fill the full window width (never leaving a gap).
// `mobile` makes it edge-to-edge tap-scroll: hidden scrollbar, no upscaling, cards
// bleed off the right edge to signal scrollability (left padding at the start).
const MAX_SCALE = 2; // cap on the upscale (and therefore the font size)

export function StatCardsRow({ ctx, mobile }: { ctx: StatContext; mobile?: boolean }) {
  const { activeModuleId, setActiveModule, settings } = useStore();
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number>();
  // once the upscale hits MAX_SCALE and there's still room, widen the cards (flex-grow)
  // to fill the rest of the width instead of leaving a gap. `fillWidth` is the layout
  // width handed to the (then-2×-scaled) inner row.
  const [fillWidth, setFillWidth] = useState<number>();
  const fillingRef = useRef(false);
  const naturalRef = useRef(0);

  useLayoutEffect(() => {
    const fit = () => {
      if (!outer.current || !inner.current) return;
      // mobile: never upscale, no scrollbar reservation — cards bleed off the edge
      if (mobile) {
        setScale(1);
        setFillWidth(undefined);
        setHeight(inner.current.offsetHeight);
        return;
      }
      const avail = outer.current.clientWidth;
      // while filling, the inner is stretched, so scrollWidth no longer reports the cards'
      // natural width — fall back to the value cached the last time the row was un-stretched
      const wasFilling = fillingRef.current;
      const natural = wasFilling ? naturalRef.current : inner.current.scrollWidth;
      if (!natural) return;
      const ratio = (avail - 2) / natural;
      const s = Math.max(1, Math.min(MAX_SCALE, ratio));
      const fill = ratio > MAX_SCALE + 0.01; // cap reached with width to spare
      fillingRef.current = fill;
      if (!fill && !wasFilling) naturalRef.current = inner.current.scrollWidth; // trust it only when un-stretched
      setScale((p) => (Math.abs(p - s) > 0.005 ? s : p));
      setFillWidth(fill ? Math.floor((avail - 1) / s) : undefined);
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
        style={{ transform: `scale(${scale})`, transformOrigin: "left top", width: fillWidth }}
      >
        {REGISTRY.map((m) => (
          <StatCard
            key={m.id}
            model={m.card(ctx)}
            settings={settings}
            compareMode={ctx.compareMode}
            active={m.id === activeModuleId}
            onClick={() => setActiveModule(m.id)}
            className={fillWidth ? "grow" : undefined}
          />
        ))}
      </div>
    </div>
  );
}

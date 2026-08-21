import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { moduleById } from "@/stats/registry";
import { useStore, type DrawerId, type MapSelection } from "@/state/store";
import { Legend } from "@/components/ui/Legend";
import { Chevron, Icon } from "@/components/ui/Icon";
import { color } from "@/lib/palette";
import { FlightPopup } from "../FlightPopup";
import { RouteAggPopup } from "../RouteAggPopup";
import { AirportPopupChart } from "../AirportPopupChart";
import { routeKeyUndirected } from "@/lib/geo";
import type { StatContext, MapEncoding } from "@/stats/types";

const COLLAPSED = 52; // height of a collapsed drawer handle
const EASE = "cubic-bezier(.4,0,.2,1)";

// Up to three stacked bottom drawers (legend / stats panel / selected feature). Only
// one expands at a time; opening pushes the drawers above it up. The open drawer sizes
// to its content up to a cap. Each drawer's background extends all the way to the
// bottom of the screen, so it fills behind the lower drawers' rounded corners — no map
// peeks between drawers. The bottom-most drawer is drawn in front.
export function DrawerStack({ ctx, encoding }: { ctx: StatContext; encoding: MapEncoding | undefined }) {
  const { activeModuleId, setActiveModule, mapSelection, setMapSelection, mobileOpen, setMobileOpen } = useStore();
  const legend = encoding?.legend?.(ctx);
  const mod = moduleById(activeModuleId);

  const drawers: { id: DrawerId; title: string; icon?: ReactNode; onClose?: () => void; content: ReactNode }[] = [];
  // drawer header is "Legend"; the dimension (e.g. "Year") is the legend's own header
  if (legend) drawers.push({ id: "legend", title: "Legend", content: <Legend model={legend} fluid /> });
  if (mod) {
    const m = mod.card(ctx);
    drawers.push({
      id: "stats",
      title: m.headline ?? m.title ?? m.eyebrow,
      onClose: () => setActiveModule(null),
      // mirror the desktop Panel's vertical spacing between controls/charts/sections
      content: (
        <div className="flex flex-col gap-4">
          <mod.Panel ctx={ctx} />
        </div>
      ),
    });
  }
  if (mapSelection) {
    const icon =
      mapSelection.kind === "airport" ? <Icon name="plane" size={14} color={color.accent} /> : <Icon name="route" size={14} color={color.secondary} />;
    drawers.push({ id: "popup", title: popupTitle(ctx, mapSelection), icon, onClose: () => setMapSelection(null), content: <PopupContent ctx={ctx} sel={mapSelection} /> });
  }

  const openId = drawers.some((d) => d.id === mobileOpen) ? mobileOpen : null;
  const [openContentH, setOpenContentH] = useState(0);
  const [drag, setDrag] = useState<{ id: DrawerId; dy: number } | null>(null);
  useEffect(() => setOpenContentH(0), [openId]); // remeasure when the open drawer changes
  if (drawers.length === 0) return null;

  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const cap = Math.round(vh * 0.62);
  // openContentH is the open drawer's measured full height (handle + content); before
  // it's measured, fall back to the collapsed handle height
  const openTotal = openContentH ? Math.min(cap, openContentH) : COLLAPSED;

  // How far a drag has carried the sheet, 0 = collapsed, 1 = fully open. A drag on the
  // open drawer starts at 1 and falls as you pull down; a drag on a collapsed handle
  // starts at 0 and rises as you pull up. A collapsed drawer's open height isn't measured
  // yet, so the cap stands in as its travel — which is what it will open to for any panel
  // taller than the cap, i.e. most of them.
  const travelFor = (id: DrawerId) => (id === openId ? openTotal : cap) - COLLAPSED;
  const progress = (id: DrawerId, dy: number) =>
    Math.max(0, Math.min(1, (id === openId ? 1 : 0) + -dy / Math.max(1, travelFor(id))));
  const p = drag ? progress(drag.id, drag.dy) : null;

  const lerp = (to: number, t: number) => COLLAPSED + (to - COLLAPSED) * t;

  // cumulative top of each drawer (its visible handle/content sits in the top `vis`px;
  // the container itself extends from that top down to the screen bottom)
  let top = 0;
  const n = drawers.length;
  const positioned = drawers.map((d, i) => {
    const open = d.id === openId;
    let vis = open ? openTotal : COLLAPSED;
    if (drag && p != null) {
      if (d.id === drag.id) vis = lerp(d.id === openId ? openTotal : cap, p);
      // dragging a collapsed handle open steals the height from whichever drawer is open,
      // so the stack keeps its total and nothing is pushed off-screen mid-drag
      else if (open) vis = lerp(openTotal, 1 - p);
    }
    top += vis;
    return { ...d, open, vis, top, z: 30 + (n - 1 - i) };
  });

  // dy === null means the pointer never travelled far enough to be a drag — treat as a tap.
  const endDrag = (id: DrawerId, dy: number | null) => {
    setDrag(null);
    if (dy === null) return setMobileOpen(openId === id ? null : id);
    const settled = progress(id, dy);
    // asymmetric on purpose: a quarter of the travel commits in either direction, so
    // neither opening nor closing demands a half-screen pull
    if (id === openId) setMobileOpen(settled < 0.75 ? null : id);
    else setMobileOpen(settled > 0.25 ? id : openId);
  };

  return (
    <>
      {positioned.map((d) => (
        <Drawer
          key={d.id}
          {...d}
          dragging={drag != null}
          onDragMove={(dy) => setDrag({ id: d.id, dy })}
          onDragEnd={(dy) => endDrag(d.id, dy)}
          onMeasure={d.open ? setOpenContentH : undefined}
        />
      ))}
    </>
  );
}

function Drawer({
  title,
  icon,
  content,
  open,
  vis,
  top,
  z,
  dragging,
  onDragMove,
  onDragEnd,
  onClose,
  onMeasure,
}: {
  title: string;
  icon?: ReactNode;
  content: ReactNode;
  open: boolean;
  vis: number;
  top: number;
  z: number;
  dragging: boolean;
  onDragMove: (dy: number) => void;
  onDragEnd: (dy: number | null) => void;
  onClose?: () => void;
  onMeasure?: (h: number) => void;
}) {
  const handleRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !onMeasure) return;
    const measure = () => onMeasure((handleRef.current?.offsetHeight ?? COLLAPSED) + (innerRef.current?.offsetHeight ?? 0));
    const ro = new ResizeObserver(measure);
    if (handleRef.current) ro.observe(handleRef.current);
    if (innerRef.current) ro.observe(innerRef.current);
    measure();
    return () => ro.disconnect();
  }, [open, onMeasure]);

  const startY = useRef<number | null>(null);
  const moved = useRef(false);
  const onDown = (e: React.PointerEvent) => {
    startY.current = e.clientY;
    moved.current = false;
    // capture so the sheet keeps following once the finger leaves the handle
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (startY.current == null) return;
    const dy = e.clientY - startY.current;
    if (!moved.current && Math.abs(dy) > 6) moved.current = true; // past the tap slop
    if (moved.current) onDragMove(dy);
  };
  const onUp = (e: React.PointerEvent) => {
    if (startY.current == null) return;
    const dy = e.clientY - startY.current;
    startY.current = null;
    onDragEnd(moved.current ? dy : null);
  };

  return (
    <div
      className="glass fixed inset-x-0 bottom-0 flex flex-col rounded-t-2xl border-t border-border shadow-3"
      style={{ height: top, zIndex: z, transition: dragging ? "none" : `height .32s ${EASE}` }}
    >
      {/* visible handle + content occupies the top `vis`px; the rest is background fill */}
      <div className="flex shrink-0 flex-col overflow-hidden" style={{ height: vis, transition: dragging ? "none" : `height .32s ${EASE}` }}>
        <div ref={handleRef} className="shrink-0 touch-none select-none px-4 pb-2 pt-2" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-border" />
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2 text-title text-ink">
              {icon}
              <span className="truncate">{title}</span>
            </span>
            <div className="flex items-center gap-1.5">
              {onClose && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                  }}
                  aria-label="Close"
                  className="grid h-7 w-7 place-items-center rounded-full text-ink-muted hover:bg-surface-2"
                >
                  ✕
                </button>
              )}
              <Chevron dir={open ? "up" : "down"} size={12} color="var(--ink-faint)" />
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div ref={innerRef} className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{content}</div>
        </div>
      </div>
    </div>
  );
}

function popupTitle(ctx: StatContext, sel: MapSelection): string {
  if (sel.kind === "airport") return `${sel.iata}${sel.city ? ` · ${sel.city}` : ""}`;
  if (sel.kind === "routeAgg") return `${sel.dep} → ${sel.arr}`;
  const f = ctx.flights.find((x) => x.id === sel.flightId);
  return f ? `${f.dep_iata} → ${f.arr_iata}` : "Flight";
}

function PopupContent({ ctx, sel }: { ctx: StatContext; sel: MapSelection }) {
  if (sel.kind === "airport") {
    const years = [...new Set(ctx.flights.map((f) => Number(f.flight_date.slice(0, 4))))].sort((a, b) => a - b);
    return <AirportPopupChart flights={ctx.flights} iata={sel.iata} name={sel.name} city={sel.city} visits={sel.visits} years={years} fluid hideHeader />;
  }
  if (sel.kind === "routeAgg") {
    const flights = ctx.flights.filter((x) => routeKeyUndirected(x.dep_iata, x.arr_iata) === sel.rk);
    return <RouteAggPopup flights={flights} dep={sel.dep} arr={sel.arr} settings={ctx.settings} fluid hideHeader />;
  }
  const f = ctx.flights.find((x) => x.id === sel.flightId);
  return f ? <FlightPopup flight={f} settings={ctx.settings} fluid hideHeader /> : null;
}

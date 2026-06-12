import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState } from "react";
import type { StatModule } from "../types";
import type { Flight, Settings } from "@/lib/types";
import { FlightPopup } from "@/app/FlightPopup";
import { formatPct, formatDuration, actualArr, arrivalDelayMin, departureDelayMin } from "@/lib/format";
import { BarsH } from "@/components/charts/BarsH";
import { MiniStats } from "@/components/ui/MiniStat";
import { PanelFooter } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { ChartLegend } from "@/components/charts/ChartLegend";
import { CHART, axisTick } from "@/components/charts/chartTheme";
import { color } from "@/lib/palette";
import { useStore } from "@/state/store";
import { airlineFilter } from "../filters";

const VERY_MIN = 60; // > 1h late = "very delayed"
const GREEN = "#34D399";
const RED = "#FB7185";
// "delayed" = arrived even a minute late (on-time merged in); a flight is only
// counted early when it beats schedule outright
const delayMin = (f: Flight): number | null => arrivalDelayMin(f);

export const delays: StatModule = {
  id: "delays",
  order: 8,
  card: (ctx) => {
    const pctLate = (fs: Flight[]) => {
      const wa = fs.filter((f) => actualArr(f));
      const late = wa.filter((f) => (delayMin(f) ?? 0) > 0).length;
      return wa.length ? (late / wa.length) * 100 : 0;
    };
    return {
      eyebrow: "Delayed",
      title: "Delays",
      stats: [
        { value: pctLate(ctx.flights), format: (n) => formatPct(n), compareValue: ctx.compareFlights ? pctLate(ctx.compareFlights) : null },
      ],
    };
  },
  Panel: ({ ctx }) => {
    // second chart metric: avg minutes late vs % of flights delayed, per airline
    const [airlineMetric, setAirlineMetric] = useState<"mins" | "pct">("mins");
    const [showList, setShowList] = useState(false);
    const { toggleCrossFilter } = useStore();

    // average departure vs arrival delay (min) by year over all timed flights
    const depD = (f: Flight) => departureDelayMin(f);
    const byYear = new Map<string, { dep: number; depN: number; arr: number; arrN: number; late: number }>();
    for (const f of ctx.flights) {
      const y = f.flight_date.slice(0, 4);
      const cur = byYear.get(y) ?? { dep: 0, depN: 0, arr: 0, arrN: 0, late: 0 };
      const d = depD(f);
      const a = delayMin(f);
      if (d != null) {
        cur.dep += d;
        cur.depN += 1;
      }
      if (a != null) {
        cur.arr += a;
        cur.arrN += 1;
        if (a > 0) cur.late += 1;
      }
      byYear.set(y, cur);
    }
    const rows = [...byYear.entries()]
      .filter(([, v]) => v.arrN || v.depN)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([y, v]) => ({
        id: y,
        label: y,
        "Departure delay": v.depN ? Math.round(v.dep / v.depN) : 0,
        "Arrival delay": v.arrN ? Math.round(v.arr / v.arrN) : 0,
        "% delayed": v.arrN ? Math.round((v.late / v.arrN) * 100) : 0,
      }));
    // per-airline arrival performance — airlines with >= 10 timed flights
    const byAirline = new Map<string, { label: string; sum: number; n: number; late: number }>();
    for (const f of ctx.flights) {
      const d = delayMin(f);
      if (d == null) continue;
      const cur = byAirline.get(f.airline_iata) ?? { label: f.airline_name ?? f.airline_iata, sum: 0, n: 0, late: 0 };
      cur.n += 1;
      cur.sum += d;
      if (d > 0) cur.late += 1;
      byAirline.set(f.airline_iata, cur);
    }
    const worst = [...byAirline.entries()]
      .filter(([, a]) => a.n >= 8)
      .map(([iata, a]) => ({
        id: iata,
        label: a.label,
        value: airlineMetric === "mins" ? Math.round(a.sum / a.n) : Math.round((a.late / a.n) * 100),
        sub: `${a.late} of ${a.n} flights delayed`,
      }))
      .sort((a, b) => b.value - a.value);

    // distribution of arrival punctuality across timed flights
    const timed = ctx.flights.filter((f) => actualArr(f));
    let early = 0, delayed = 0, veryLate = 0, netMin = 0;
    for (const f of timed) {
      const d = delayMin(f) ?? 0;
      netMin += d; // net of early arrivals (signed)
      if (d < 0) early++;
      else if (d <= VERY_MIN) delayed++;
      else veryLate++;
    }
    const totTimed = timed.length || 1;
    const pct = (n: number) => `${Math.round((n / totTimed) * 100)}%`;
    const netDur = formatDuration(Math.abs(netMin)).value;
    const delayVals = timed.map((f) => delayMin(f) ?? 0);
    const maxDelay = delayVals.length ? Math.max(...delayVals) : 0;
    const minDelay = delayVals.length ? Math.min(...delayVals) : 0;
    const cards = [
      { label: "Early", value: pct(early), color: GREEN },
      { label: "Delayed (≤1h)", value: pct(delayed), color: color.secondary },
      { label: "Very delayed (>1h)", value: pct(veryLate), color: RED },
      { label: "Most delayed", value: maxDelay > 0 ? `+${formatDuration(maxDelay).value}` : "—", color: RED },
      { label: "Earliest", value: minDelay < 0 ? `−${formatDuration(-minDelay).value}` : "—", color: GREEN },
      { label: netMin >= 0 ? "Net time lost" : "Net time saved", value: `${netMin >= 0 ? "+" : "−"}${netDur}`, color: netMin >= 0 ? RED : GREEN },
    ];

    // most/least-delayed modal: delayed flights on one side, early/on-time on the other
    const ranked = timed.map((f) => ({ f, d: delayMin(f) ?? 0 }));
    const mostDelayed = ranked.filter((x) => x.d > 0).sort((a, b) => b.d - a.d);
    const mostEarly = ranked.filter((x) => x.d <= 0).sort((a, b) => a.d - b.d);

    if (rows.length === 0) {
      return (
        <>
          <MiniStats items={cards} cols={3} />
          <p className="text-label text-ink-muted">No actual-time data in this range.</p>
        </>
      );
    }
    const lineSeries = [
      { key: "Departure delay", name: "Departure delay (min)", color: color.accent },
      { key: "Arrival delay", name: "Arrival delay (min)", color: color.routeIntl },
      { key: "% delayed", name: "% delayed", color: "#A78BFA" },
    ];
    // delay (min) axis extent → tint above 0 red (late = bad), below 0 green (early);
    // tight domain (no fudge) so the baseline sits at 0
    const minVals = rows.flatMap((r) => [r["Departure delay"], r["Arrival delay"]]);
    const axisMax = Math.max(1, ...minVals);
    const axisMin = Math.min(0, ...minVals);
    return (
      <>
        <MiniStats items={cards} cols={3} />
        <ChartLegend series={lineSeries} />
        <div style={{ height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ left: -16, right: -8, top: 6, bottom: 2 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <ReferenceArea yAxisId="min" y1={0} y2={axisMax} fill="#FB7185" fillOpacity={0.07} stroke="none" />
              <ReferenceArea yAxisId="min" y1={axisMin} y2={0} fill="#34D399" fillOpacity={0.07} stroke="none" />
              <ReferenceLine yAxisId="min" y={0} stroke={CHART.axis} strokeDasharray="2 2" />
              <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis yAxisId="min" domain={[axisMin, axisMax]} tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}m`} />
              <YAxis
                yAxisId="pct"
                orientation="right"
                tick={axisTick}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: CHART.cursor }} />
              <Bar yAxisId="pct" dataKey="% delayed" fill="#A78BFA" fillOpacity={0.35} radius={[3, 3, 0, 0]} />
              <Line yAxisId="min" type="monotone" dataKey="Departure delay" stroke={color.accent} strokeWidth={2} dot={false} />
              <Line yAxisId="min" type="monotone" dataKey="Arrival delay" stroke={color.routeIntl} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {worst.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-eyebrow tracking-[0.01em] text-ink-faint">By airline (≥8)</span>
              <Segmented
                aria-label="Airline metric"
                size="sm"
                className="w-[210px] shrink-0"
                value={airlineMetric}
                onChange={setAirlineMetric}
                options={[
                  { value: "mins", label: "Avg mins" },
                  { value: "pct", label: "% delayed" },
                ]}
              />
            </div>
            <BarsH
              rows={worst}
              series={[{ key: "value", name: airlineMetric === "mins" ? "min" : "%", color: color.routeIntl }]}
              unit={airlineMetric === "mins" ? "min" : "%"}
              cap={10}
              onPick={(id) => {
                const a = worst.find((x) => x.id === id);
                if (a) toggleCrossFilter(airlineFilter(id, a.label));
              }}
            />
          </div>
        )}
        <PanelFooter>
          <Button variant="secondary" size="sm" className="w-full" onClick={() => setShowList(true)}>
            Most &amp; least delayed flights
          </Button>
        </PanelFooter>
        {showList && (
          <Modal title="Most & least delayed flights" onClose={() => setShowList(false)} className="w-[min(720px,95vw)]">
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 p-5 sm:grid-cols-2">
              <DelayColumn title={`Delayed (${mostDelayed.length})`} rows={mostDelayed} settings={ctx.settings} />
              <DelayColumn title={`Early / on-time (${mostEarly.length})`} rows={mostEarly} settings={ctx.settings} />
            </div>
          </Modal>
        )}
      </>
    );
  },
  // Per-flight colouring by arrival punctuality.
  map: {
    colorFlight: (f) => DELAY_COLORS[delayBucket(f)],
    flightLegendId: (f) => delayBucket(f),
    legend: () => ({
      title: "Punctuality",
      items: [
        { id: "early", label: "Early", color: DELAY_COLORS.early, swatch: "line" },
        { id: "delayed", label: "Delayed (≤1h)", color: DELAY_COLORS.delayed, swatch: "line" },
        { id: "very", label: "Very delayed (>1h)", color: DELAY_COLORS.very, swatch: "line" },
        { id: "none", label: "No data", color: DELAY_COLORS.none, swatch: "line" },
      ],
    }),
  },
};

// signed delay label: "+2h 14m" / "−18 min"
function fmtDelay(d: number): string {
  const sign = d > 0 ? "+" : d < 0 ? "−" : "";
  return `${sign}${formatDuration(Math.abs(d)).value}`;
}

function DelayColumn({ title, rows, settings }: { title: string; rows: { f: Flight; d: number }[]; settings: Settings }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <div className="mb-1.5 text-eyebrow tracking-[0.01em] text-ink-faint">{title}</div>
      <div className="overflow-y-auto pr-1" style={{ maxHeight: "60vh" }}>
        {rows.map(({ f, d }, i) => {
          const approx = !(f.actual_arr && f.provider_sched_arr);
          const isOpen = open === f.id;
          return (
            <div key={f.id} className="border-b border-border/60">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : f.id)}
                className="flex w-full items-center gap-3 py-1.5 text-left hover:opacity-80"
              >
                <span className="tnum w-5 shrink-0 text-right text-caption text-ink-faint">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-label text-ink">
                    {f.dep_iata} → {f.arr_iata}{" "}
                    <span className="text-ink-faint">{f.airline_iata}{f.flight_number}</span>
                  </div>
                  <div className="text-caption text-ink-faint">{f.flight_date}{approx ? " · approx" : ""}</div>
                </div>
                <div className="tnum shrink-0 text-label font-semibold" style={{ color: d > 0 ? RED : GREEN }}>
                  {fmtDelay(d)}
                </div>
                <span className={`shrink-0 text-ink-faint transition-transform ${isOpen ? "rotate-90" : ""}`}>›</span>
              </button>
              {isOpen && (
                <div className="rounded-lg bg-surface-1/60 px-3 pb-3 pt-1">
                  <FlightPopup flight={f} settings={settings} fluid />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type DelayBucket = "early" | "delayed" | "very" | "none";
const DELAY_COLORS: Record<DelayBucket, string> = {
  early: GREEN,
  delayed: color.secondary,
  very: RED,
  none: "#5C6575",
};
function delayBucket(f: Flight): DelayBucket {
  const d = delayMin(f);
  if (d == null) return "none";
  if (d < 0) return "early";
  if (d <= VERY_MIN) return "delayed";
  return "very";
}

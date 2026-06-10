import { useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { StatModule } from "../types";
import type { CabinClass, Flight } from "@/lib/types";
import { totalCash, totalPoints } from "@/lib/aggregate";
import { formatUSD, formatPoints, compact, flightDistanceMi, flightMinutes } from "@/lib/format";
import { toUSD } from "@/lib/fx";
import { Segmented } from "@/components/ui/Segmented";
import { Switch } from "@/components/ui/Switch";
import { OptionsButton } from "@/components/ui/OptionsButton";
import { BarsH } from "@/components/charts/BarsH";
import { ChartLegend } from "@/components/charts/ChartLegend";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { CHART, axisTick } from "@/components/charts/chartTheme";
import { useStore, ALL_TIME } from "@/state/store";
import { classFilter, yearRange, yearOfRange } from "../filters";
import { color } from "@/lib/palette";

type Metric = "cash" | "points";
type Group = "year" | "class";
type Basis = "total" | "flight" | "km" | "hour";

const CLASS_ORDER: CabinClass[] = ["economy", "premium_economy", "lie_flat_business", "recliner_first", "international_first"];
const CLASS_LABELS: Record<CabinClass, string> = {
  economy: "Economy",
  premium_economy: "Prem. economy",
  lie_flat_business: "Business",
  recliner_first: "First (recliner)",
  international_first: "First",
};

const cashUSD = (f: Flight) => (f.cost_cash_segment ?? 0) * toUSD((f.cost_currency ?? "USD").toUpperCase());
const hasPoints = (f: Flight) => (f.cost_points_segment ?? 0) > 0;

export const cost: StatModule = {
  id: "cost",
  order: 11,
  card: (ctx) => {
    const priced = ctx.flights.filter((f) => f.cost_cash_segment != null || f.cost_points_segment != null).length;
    const cmp = ctx.compareFlights;
    return {
      eyebrow: `Cost (from ${priced} flights)`,
      stats: [
        { value: totalCash(ctx.flights, toUSD), format: (n) => formatUSD(n), compareValue: cmp ? totalCash(cmp, toUSD) : null },
        { value: totalPoints(ctx.flights), format: (n) => formatPoints(n), compareValue: cmp ? totalPoints(cmp) : null },
      ],
    };
  },
  Panel: ({ ctx }) => {
    const [metric, setMetric] = useState<Metric>("cash");
    const [group, setGroup] = useState<Group>("year");
    const [basis, setBasis] = useState<Basis>("total");
    const [percent, setPercent] = useState(false);
    const { settings, toggleCrossFilter, crossFilters, range, setRange } = useStore();

    const km = settings.units === "km";
    const distOf = (f: Flight) => flightDistanceMi(f) * (km ? 1.60934 : 1);
    const hoursOf = (f: Flight) => flightMinutes(f) / 60;

    // priced flights for the active metric:
    //  cash  → has a cash segment, EXCLUDING award-tax legs (<$50 cash + points)
    //  points → booked with points
    const priced = (f: Flight) =>
      metric === "cash" ? f.cost_cash_segment != null && !(cashUSD(f) < 50 && hasPoints(f)) : hasPoints(f);
    const value = (f: Flight) => (metric === "cash" ? cashUSD(f) : f.cost_points_segment ?? 0);

    const buckets = new Map<string, { label: string; dom: number; intl: number; flights: number; dist: number; hours: number; sort: number }>();
    for (const f of ctx.flights) {
      if (!priced(f)) continue;
      let key: string, label: string, sort: number;
      if (group === "year") {
        key = f.flight_date.slice(0, 4);
        label = key;
        sort = Number(key);
      } else {
        key = f.cabin_class ?? "unknown";
        label = CLASS_LABELS[key as CabinClass] ?? "Unknown";
        sort = CLASS_ORDER.indexOf(key as CabinClass);
      }
      const b = buckets.get(key) ?? { label, dom: 0, intl: 0, flights: 0, dist: 0, hours: 0, sort };
      const v = value(f);
      if (f.trip_type === "international") b.intl += v;
      else b.dom += v;
      b.flights += 1;
      b.dist += distOf(f);
      b.hours += hoursOf(f);
      buckets.set(key, b);
    }
    const denom = (b: { flights: number; dist: number; hours: number }) =>
      basis === "total" ? 1 : basis === "flight" ? b.flights || 1 : basis === "km" ? b.dist || 1 : b.hours || 1;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    let rows = [...buckets.entries()]
      .map(([id, b]) => ({ id, label: b.label, domestic: r2(b.dom / denom(b)), international: r2(b.intl / denom(b)), flights: b.flights }))
      .sort((a, b) => (buckets.get(a.id)!.sort - buckets.get(b.id)!.sort));
    if (percent) {
      rows = rows.map((r) => {
        const t = r.domestic + r.international || 1;
        return { ...r, domestic: r2((r.domestic / t) * 100), international: r2((r.international / t) * 100) };
      });
    }

    const unit = metric === "cash" ? "$" : "pts";
    const activeId =
      group === "year"
        ? yearOfRange(range)
        : crossFilters.find((c) => c.id.startsWith("class:"))?.id.split(":")[1] ?? null;
    const onPick = (id: string) => {
      if (group === "year") setRange(yearOfRange(range) === id ? ALL_TIME : yearRange(id));
      else toggleCrossFilter(classFilter(id, CLASS_LABELS[id as CabinClass] ?? id));
    };

    const series = [
      { key: "domestic", name: "Domestic", color: color.accent },
      { key: "international", name: "International", color: color.secondary },
      { key: "flights", name: "Priced flights", color: "#A78BFA" },
    ];

    // booking-method mix per class (always shown)
    const methods = new Map<string, { label: string; cashOnly: number; pointsOnly: number; pointsCash: number; sort: number }>();
    for (const f of ctx.flights) {
      if (!f.cabin_class) continue;
      const c = cashUSD(f);
      const p = hasPoints(f);
      let kind: "cashOnly" | "pointsOnly" | "pointsCash" | null = null;
      if (p && c < 30) kind = "pointsOnly";
      else if (p) kind = "pointsCash";
      else if (f.cost_cash_segment != null && c > 0) kind = "cashOnly";
      if (!kind) continue;
      const key = f.cabin_class;
      const m = methods.get(key) ?? { label: CLASS_LABELS[key], cashOnly: 0, pointsOnly: 0, pointsCash: 0, sort: CLASS_ORDER.indexOf(key) };
      m[kind] += 1;
      methods.set(key, m);
    }
    const methodRows = [...methods.entries()]
      .map(([id, m]) => ({ id, label: m.label, cashOnly: m.cashOnly, pointsOnly: m.pointsOnly, pointsCash: m.pointsCash }))
      .sort((a, b) => methods.get(a.id)!.sort - methods.get(b.id)!.sort);

    return (
      <>
        <div className="flex items-center justify-between gap-2">
          <Segmented
            aria-label="Cost metric"
            size="sm"
            value={metric}
            onChange={setMetric}
            options={[
              { value: "cash", label: "Cash" },
              { value: "points", label: "Points" },
            ]}
          />
          <div className="flex items-center gap-2">
            <Segmented
              aria-label="Group by"
              size="sm"
              value={group}
              onChange={setGroup}
              options={[
                { value: "year", label: "By year" },
                { value: "class", label: "By class" },
              ]}
            />
            <OptionsButton>
              <div className="flex items-center justify-between">
                <span className="text-label text-ink-muted">100% stacked</span>
                <Switch checked={percent} onChange={setPercent} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-label text-ink-muted">Basis</span>
                {/* native select avoids a portal-in-popover outside-click conflict */}
                <select
                  aria-label="Basis"
                  value={basis}
                  onChange={(e) => setBasis(e.target.value as Basis)}
                  className="focus-ring rounded-md border border-border bg-surface-2 px-2 py-1 text-caption text-ink"
                >
                  <option value="total">Total</option>
                  <option value="flight">Per flight</option>
                  <option value="km">{km ? "Per km" : "Per mi"}</option>
                  <option value="hour">Per hour</option>
                </select>
              </div>
            </OptionsButton>
          </div>
        </div>

        <ChartLegend series={series} />
        <div style={{ height: 210 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ left: -12, right: -10, top: 6, bottom: 2 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
              <YAxis
                yAxisId="cost"
                tick={axisTick}
                axisLine={false}
                tickLine={false}
                domain={percent ? [0, 100] : undefined}
                tickFormatter={percent ? (v) => `${v}%` : (v) => compact(Number(v))}
              />
              <YAxis yAxisId="count" orientation="right" tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ fill: CHART.cursor }} />
              <Bar yAxisId="cost" dataKey="domestic" name="Domestic" stackId="a" fill={color.accent} isAnimationActive={false}
                cursor="pointer" onClick={(_: unknown, i: number) => onPick(rows[i].id)} />
              <Bar yAxisId="cost" dataKey="international" name="International" stackId="a" fill={color.secondary} radius={[3, 3, 0, 0]} isAnimationActive={false}
                cursor="pointer" onClick={(_: unknown, i: number) => onPick(rows[i].id)} />
              <Line yAxisId="count" type="monotone" dataKey="flights" name="Priced flights" stroke="#A78BFA" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {activeId && <p className="text-caption text-ink-faint">Filtering: {activeId}</p>}

        {methodRows.length > 0 && (
          <div>
            <div className="mb-1.5 text-eyebrow tracking-[0.01em] text-ink-faint">Booking method by class · flights</div>
            <BarsH
              rows={methodRows}
              series={[
                { key: "cashOnly", name: "Cash only", color: color.accent },
                { key: "pointsCash", name: "Points + cash", color: "#A78BFA" },
                { key: "pointsOnly", name: "Points only", color: color.secondary },
              ]}
              unit="flights"
            />
          </div>
        )}
      </>
    );
  },
  // Per-flight colouring by booking method.
  map: {
    colorFlight: (f) => METHOD_COLORS[bookingMethod(f)],
    flightLegendId: (f) => bookingMethod(f),
    legend: () => ({
      title: "Booking",
      items: [
        { id: "cashOnly", label: "Cash only", color: METHOD_COLORS.cashOnly, swatch: "line" },
        { id: "pointsCash", label: "Points + cash", color: METHOD_COLORS.pointsCash, swatch: "line" },
        { id: "pointsOnly", label: "Points only", color: METHOD_COLORS.pointsOnly, swatch: "line" },
        { id: "none", label: "No cost data", color: METHOD_COLORS.none, swatch: "line" },
      ],
    }),
  },
};

type BookingMethod = "cashOnly" | "pointsCash" | "pointsOnly" | "none";
const METHOD_COLORS: Record<BookingMethod, string> = {
  cashOnly: color.accent,
  pointsCash: "#A78BFA",
  pointsOnly: color.secondary,
  none: "#5C6575",
};
function bookingMethod(f: Flight): BookingMethod {
  const c = cashUSD(f);
  const p = hasPoints(f);
  if (p && c < 30) return "pointsOnly";
  if (p) return "pointsCash";
  if (f.cost_cash_segment != null && c > 0) return "cashOnly";
  return "none";
}

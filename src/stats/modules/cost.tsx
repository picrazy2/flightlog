import { useLayoutEffect, useRef, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { StatModule } from "../types";
import type { Flight } from "@/lib/types";
import { totalCash, totalPoints } from "@/lib/aggregate";
import { formatMoney, formatPoints, compact, flightDistanceMi, flightMinutes } from "@/lib/format";
import { toUSD, fromUSD, currencySymbol, CURRENCIES } from "@/lib/fx";
import { Segmented } from "@/components/ui/Segmented";
import { Dropdown } from "@/components/ui/Dropdown";
import { BarsH } from "@/components/charts/BarsH";
import { ChartLegend } from "@/components/charts/ChartLegend";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { CHART, axisTick } from "@/components/charts/chartTheme";
import { useStore, ALL_TIME } from "@/state/store";
import { yearRange, yearOfRange } from "../filters";
import { color } from "@/lib/palette";
import { programLabel } from "@/lib/loyalty";
import { useIsMobile } from "@/lib/useIsMobile";

type Metric = "flights" | "spend";
type Basis = "total" | "flight" | "km" | "hour";

const CASH_COLOR = color.accent; // blue
const POINTS_COLOR = color.secondary; // gold reads as points/miles and is distinct from cash-blue

// historical USD (converted at the flight date) when available; else static present-day rate
const cashUSD = (f: Flight) => f.cost_cash_segment_usd ?? (f.cost_cash_segment ?? 0) * toUSD((f.cost_currency ?? "USD").toUpperCase());
const hasPoints = (f: Flight) => (f.cost_points_segment ?? 0) > 0;

export const cost: StatModule = {
  id: "cost",
  order: 8.6, // right after Premium (cabin, 8.5)
  card: (ctx) => {
    const priced = ctx.flights.filter((f) => f.cost_cash_segment != null || f.cost_points_segment != null).length;
    const cmp = ctx.compareFlights;
    return {
      eyebrow: `Cost (from ${priced} flights)`,
      stats: [
        { value: totalCash(ctx.flights, toUSD), format: (n, s) => formatMoney(n, s.currency), compareValue: cmp ? totalCash(cmp, toUSD) : null },
        { value: totalPoints(ctx.flights), format: (n) => formatPoints(n), compareValue: cmp ? totalPoints(cmp) : null },
      ],
    };
  },
  Panel: ({ ctx }) => {
    const [metric, setMetric] = useState<Metric>("spend");
    const [chartType, setChartType] = useState<"bar" | "pie">("bar");
    const [basis, setBasis] = useState<Basis>("total");
    const [breakdown2, setBreakdown2] = useState<"currency" | "program">("currency");
    const { settings, range, setRange } = useStore();
    const km = settings.units === "km";
    const cur = settings.currency;
    const sym = currencySymbol(cur).trim() || cur;
    const distOf = (f: Flight) => flightDistanceMi(f) * (km ? 1.60934 : 1);
    const hoursOf = (f: Flight) => flightMinutes(f) / 60;
    const r2 = (n: number) => Math.round(n * 100) / 100;

    type Agg = { cashSpend: number; pointsSpend: number; cashFlights: number; pointsFlights: number; cashDist: number; pointsDist: number; cashHours: number; pointsHours: number };
    const blank = (): Agg => ({ cashSpend: 0, pointsSpend: 0, cashFlights: 0, pointsFlights: 0, cashDist: 0, pointsDist: 0, cashHours: 0, pointsHours: 0 });
    const byYear = new Map<string, Agg>();
    const t = blank();
    const byCurrency = new Map<string, { flights: number; spend: number }>();
    const byProgram = new Map<string, { flights: number; points: number }>(); // points programs
    const totalFlightsByYear = new Map<string, number>(); // all flights/year → "priced of total" hover
    for (const f of ctx.flights) totalFlightsByYear.set(f.flight_date.slice(0, 4), (totalFlightsByYear.get(f.flight_date.slice(0, 4)) ?? 0) + 1);
    for (const f of ctx.flights) {
      const hasCash = f.cost_cash_segment != null;
      const pts = hasPoints(f);
      if (!hasCash && !pts) continue;
      const a = byYear.get(f.flight_date.slice(0, 4)) ?? blank();
      byYear.set(f.flight_date.slice(0, 4), a);
      const cashDisp = fromUSD(cashUSD(f), cur);
      if (pts) {
        a.pointsFlights++; t.pointsFlights++;
        a.pointsSpend += f.cost_points_segment ?? 0; t.pointsSpend += f.cost_points_segment ?? 0;
        a.pointsDist += distOf(f); t.pointsDist += distOf(f);
        a.pointsHours += hoursOf(f); t.pointsHours += hoursOf(f);
        if (f.points_program) {
          const e = byProgram.get(f.points_program) ?? { flights: 0, points: 0 };
          e.flights++; e.points += f.cost_points_segment ?? 0;
          byProgram.set(f.points_program, e);
        }
      } else if (hasCash && cashUSD(f) > 0) {
        a.cashFlights++; t.cashFlights++;
        a.cashDist += distOf(f); t.cashDist += distOf(f);
        a.cashHours += hoursOf(f); t.cashHours += hoursOf(f);
      }
      // cash spend (incl. the cash portion of award tickets) + per-currency tally
      if (hasCash) {
        a.cashSpend += cashDisp; t.cashSpend += cashDisp;
        if (f.cost_currency) {
          const c = f.cost_currency.toUpperCase();
          const e = byCurrency.get(c) ?? { flights: 0, spend: 0 };
          e.flights++; e.spend += cashDisp;
          byCurrency.set(c, e);
        }
      }
    }
    const spendBasis = (spend: number, flights: number, dist: number, hours: number) =>
      basis === "total" ? spend : basis === "flight" ? (flights ? spend / flights : 0) : basis === "km" ? (dist ? spend / dist : 0) : hours ? spend / hours : 0;

    // grouped cash + points per year
    const rows = [...byYear.keys()].sort().map((y) => {
      const a = byYear.get(y)!;
      const priced = a.cashFlights + a.pointsFlights;
      return {
        id: y,
        label: y,
        cash: metric === "flights" ? a.cashFlights : r2(spendBasis(a.cashSpend, a.cashFlights, a.cashDist, a.cashHours)),
        points: metric === "flights" ? a.pointsFlights : Math.round(spendBasis(a.pointsSpend, a.pointsFlights, a.pointsDist, a.pointsHours)),
        sub: `Based on ${priced} of ${totalFlightsByYear.get(y) ?? priced} flights`,
      };
    });
    const yearActive = yearOfRange(range);
    // on touch (mobile/tablet) a tap is the only way to read a bar's value, so don't filter
    const noPick = useIsMobile(1024);
    const onYear = (id: string) => setRange(yearActive === id ? ALL_TIME : yearRange(id));
    // pie compares cash vs points by flight share — only meaningful for the flights metric
    const showPie = metric === "flights" && chartType === "pie";

    // many years → make the grouped bars horizontally scrollable, opened at the most
    // recent (right-most) year
    const PER_YEAR = 42;
    const scrollRef = useRef<HTMLDivElement>(null);
    const scrollable = !showPie && rows.length > 10;
    useLayoutEffect(() => {
      const el = scrollRef.current;
      if (scrollable && el) el.scrollLeft = el.scrollWidth;
    }, [scrollable, rows.length]);

    const cashName = metric === "flights" ? "Cash flights" : "Cash spend";
    const pointsName = metric === "flights" ? "Points flights" : "Points";
    const legend = [
      { key: "cash", name: cashName, color: CASH_COLOR },
      { key: "points", name: pointsName, color: POINTS_COLOR },
    ];
    const tipUnits = metric === "flights" ? { cash: "flights", points: "flights" } : { cash: cur, points: "pts" };

    // pie: cash vs points collapsed across years — sized by flight share (one common unit),
    // labelled with the active metric (counts, or cash $ / points pts).
    const pieData = [
      { id: "cash", name: cashName, value: t.cashFlights, color: CASH_COLOR },
      { id: "points", name: pointsName, value: t.pointsFlights, color: POINTS_COLOR },
    ].filter((s) => s.value > 0);

    // second chart: top currencies (cash) or points programs, following the flights/spend toggle
    const CUR_NAME: Record<string, string> = Object.fromEntries(CURRENCIES.map((c) => [c.code, c.name]));
    const curRows = [...byCurrency.entries()]
      .map(([c, e]) => ({ id: c, label: CUR_NAME[c] ?? c, value: metric === "flights" ? e.flights : r2(e.spend) }))
      .sort((a, b) => b.value - a.value);
    const progRows = [...byProgram.entries()]
      .map(([p, e]) => ({ id: p, label: programLabel(p), value: metric === "flights" ? e.flights : Math.round(e.points) }))
      .sort((a, b) => b.value - a.value);

    const title =
      metric === "flights"
        ? "Flights booked with cash vs points, by year"
        : `Spend — cash (${sym}) vs points, by year${basis !== "total" ? ` · per ${basis === "km" ? (km ? "km" : "mi") : basis}` : ""}`;

    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented
            aria-label="Metric"
            size="sm"
            value={metric}
            onChange={setMetric}
            options={[
              { value: "spend", label: "Spend" },
              { value: "flights", label: "Flights" },
            ]}
          />
          <div className="flex items-center gap-2">
            {metric === "spend" && (
              <Dropdown
                aria-label="Basis"
                size="sm"
                value={basis}
                onChange={setBasis}
                options={[
                  { value: "total", label: "Total" },
                  { value: "flight", label: "Per flight" },
                  { value: "km", label: km ? "Per km" : "Per mi" },
                  { value: "hour", label: "Per hour" },
                ]}
              />
            )}
            {metric === "flights" && (
              <Segmented
                aria-label="Chart"
                size="sm"
                value={chartType}
                onChange={setChartType}
                options={[
                  { value: "bar", label: "Bar" },
                  { value: "pie", label: "Pie" },
                ]}
              />
            )}
          </div>
        </div>

        <div className="text-eyebrow tracking-[0.01em] text-ink-faint">{showPie ? title.replace(", by year", " — all time") : title}</div>
        <ChartLegend series={legend} />
        {showPie ? (
          <div style={{ height: 210 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2} stroke="none" isAnimationActive={false}>
                  {pieData.map((s) => <Cell key={s.id} fill={s.color} />)}
                </Pie>
                <Tooltip content={<ChartTooltip unit="flights" />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div ref={scrollRef} className={scrollable ? "overflow-x-auto" : ""} style={{ height: 210 }}>
            <div style={{ width: scrollable ? rows.length * PER_YEAR : "100%", height: "100%" }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} barGap={2} barCategoryGap="22%" margin={{ left: -10, right: metric === "spend" ? -10 : 8, top: 6, bottom: 2 }}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval={scrollable ? 0 : "preserveStartEnd"} minTickGap={16} />
                  <YAxis yAxisId="cash" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => compact(Number(v))} />
                  {metric === "spend" && (
                    <YAxis yAxisId="points" orientation="right" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => compact(Number(v))} />
                  )}
                  <Tooltip content={<ChartTooltip units={tipUnits} />} cursor={{ fill: CHART.cursor }} />
                  <Bar yAxisId="cash" dataKey="cash" name={cashName} fill={CASH_COLOR} radius={[3, 3, 0, 0]} isAnimationActive={false}
                    cursor={noPick ? undefined : "pointer"} onClick={noPick ? undefined : (_: unknown, i: number) => onYear(rows[i].id)} />
                  <Bar yAxisId={metric === "spend" ? "points" : "cash"} dataKey="points" name={pointsName} fill={POINTS_COLOR} radius={[3, 3, 0, 0]} isAnimationActive={false}
                    cursor={noPick ? undefined : "pointer"} onClick={noPick ? undefined : (_: unknown, i: number) => onYear(rows[i].id)} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {(() => {
          const rows = breakdown2 === "currency" ? curRows : progRows;
          const spendUnit = metric === "flights" ? "flights" : breakdown2 === "currency" ? `spend (${sym})` : "points";
          return rows.length > 0 ? (
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-eyebrow tracking-[0.01em] text-ink-faint">
                  Top {breakdown2 === "currency" ? "currencies" : "programs"} · {spendUnit}
                </span>
                <Segmented
                  aria-label="Breakdown"
                  size="sm"
                  value={breakdown2}
                  onChange={setBreakdown2}
                  options={[
                    { value: "currency", label: "Currencies" },
                    { value: "program", label: "Programs" },
                  ]}
                />
              </div>
              <BarsH
                rows={rows.map((r) => ({ id: r.id, label: r.label, value: r.value }))}
                series={[{ key: "value", name: metric === "flights" ? "flights" : breakdown2 === "currency" ? sym : "pts", color: color.accent }]}
                unit={metric === "flights" ? "flights" : breakdown2 === "currency" ? cur : "pts"}
                title={breakdown2 === "currency" ? "Top currencies" : "Top programs"}
                cap={6}
              />
            </div>
          ) : null;
        })()}
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
  cashOnly: color.accent, // blue (cash)
  pointsCash: "#F472B6", // pink — the mix; distinct from cash-blue and points-gold
  pointsOnly: color.secondary, // gold (points)
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

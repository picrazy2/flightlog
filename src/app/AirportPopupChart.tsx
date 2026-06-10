import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltip } from "@/components/charts/ChartTooltip";
import { CHART, axisTick } from "@/components/charts/chartTheme";
import { Icon } from "@/components/ui/Icon";
import { color } from "@/lib/palette";
import type { Flight } from "@/lib/types";
import { PopupFlightTable } from "./PopupFlightTable";

const CONNECTION_MS = 16 * 60 * 60 * 1000;

// Per-year dep/arr/connections for one airport over the full year span (fills 0s).
function yearly(flights: Flight[], iata: string, years: number[]) {
  const m = new Map<number, { dep: number; arr: number; conn: number }>();
  for (const y of years) m.set(y, { dep: 0, arr: 0, conn: 0 });
  const ensure = (y: number) => m.get(y) ?? m.set(y, { dep: 0, arr: 0, conn: 0 }).get(y)!;
  for (const f of flights) {
    const y = Number(f.flight_date.slice(0, 4));
    if (f.dep_iata === iata) ensure(y).dep++;
    if (f.arr_iata === iata) ensure(y).arr++;
  }
  const chrono = [...flights].sort((a, b) => a.sched_dep.localeCompare(b.sched_dep));
  for (let i = 0; i < chrono.length - 1; i++) {
    if (chrono[i].arr_iata !== iata || chrono[i + 1].dep_iata !== iata) continue;
    const gap = new Date(chrono[i + 1].sched_dep).getTime() - new Date(chrono[i].sched_arr).getTime();
    if (gap >= 0 && gap <= CONNECTION_MS) ensure(Number(chrono[i].flight_date.slice(0, 4))).conn++;
  }
  return [...m.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, v]) => ({
      label: String(year),
      Departures: Math.max(0, v.dep - v.conn),
      Arrivals: Math.max(0, v.arr - v.conn),
      Connections: v.conn,
    }));
}

interface Props {
  flights: Flight[];
  iata: string;
  name: string;
  city: string;
  visits: number;
  years: number[];
  fluid?: boolean;
  hideHeader?: boolean;
}

export function AirportPopupChart({ flights, iata, name, city, visits, years, fluid, hideHeader }: Props) {
  const touching = flights.filter((f) => f.dep_iata === iata || f.arr_iata === iata);
  const rows = yearly(flights, iata, years);
  // totals for the dep/arr/connections breakdown line
  const tot = rows.reduce(
    (s, r) => ({ dep: s.dep + r.Departures, arr: s.arr + r.Arrivals, conn: s.conn + r.Connections }),
    { dep: 0, arr: 0, conn: 0 },
  );
  const areas = [
    { key: "Departures", color: color.accent },
    { key: "Arrivals", color: color.secondary },
    { key: "Connections", color: "#A78BFA" },
  ];
  return (
    <div style={{ width: fluid ? "100%" : 264 }}>
      {!hideHeader && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <Icon name="plane" size={13} color={color.accent} />
          <span>
            <b>{iata}</b> · {name}
          </span>
        </div>
      )}
      <div style={{ fontSize: 12, color: "var(--ink-muted)", marginBottom: 4 }}>
        {city} · {visits} visits
      </div>
      <div style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--ink-muted)", marginBottom: 6 }}>
        <span><b style={{ color: color.accent }}>{tot.dep}</b> dep</span>
        <span><b style={{ color: color.secondary }}>{tot.arr}</b> arr</span>
        <span><b style={{ color: "#A78BFA" }}>{tot.conn}</b> conn</span>
      </div>
      {touching.length > 5 ? (
        <div style={{ height: 130 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ left: -22, right: 4, top: 4, bottom: 0 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ ...axisTick, fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ ...axisTick, fontSize: 10 }} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} />
              {areas.map((a) => (
                <Area key={a.key} type="monotone" dataKey={a.key} stackId="1" stroke={a.color} fill={a.color} fillOpacity={0.5} strokeWidth={1.5} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <PopupFlightTable
          rows={touching
            .slice()
            .sort((a, b) => b.sched_dep.localeCompare(a.sched_dep))
            .map((f) => ({ id: f.id, date: f.flight_date, code: `${f.airline_iata}${f.flight_number}`, route: `${f.dep_iata}→${f.arr_iata}` }))}
        />
      )}
    </div>
  );
}

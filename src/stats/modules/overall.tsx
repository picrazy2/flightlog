import { useState } from "react";
import type { StatModule } from "../types";
import type { Flight } from "@/lib/types";
import { sumDistanceMi, routesFrom } from "@/lib/aggregate";
import { formatDistance, formatDuration, flightDistanceMi, flightMinutes, schedDep, schedArr } from "@/lib/format";
import { Segmented } from "@/components/ui/Segmented";
import { Dropdown } from "@/components/ui/Dropdown";
import { BarsV } from "@/components/charts/BarsV";
import { Lines } from "@/components/charts/Lines";
import { FactList, type Fact, type FactAction } from "@/components/ui/FactList";
import type { DateRange } from "@/state/store";
import { useStore, ALL_TIME } from "@/state/store";
import { yearRange, yearOfRange, airportFilter, airlineFilter, routeFilter } from "../filters";
import { airlineKey, airlineNameOf } from "@/lib/airlines";
import { metricName } from "../useMetric";
import { color } from "@/lib/palette";

const monthRange = (ym: string): DateRange => {
  const [y, mo] = ym.split("-").map(Number);
  const end = new Date(y, mo, 0).getDate(); // day 0 of next month = last day of this one
  return { start: `${ym}-01`, end: `${ym}-${String(end).padStart(2, "0")}`, label: `${MONTHS[mo - 1]} ${y}` };
};

const EARTH_CIRC_MI = 24901;
const MOON_MI = 238855;

function mode<T>(items: T[], key: (t: T) => string | null | undefined): { key: string; n: number } | null {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  let best: { key: string; n: number } | null = null;
  for (const [k, n] of m) if (!best || n > best.n) best = { key: k, n };
  return best;
}

// A grab-bag of playful lifetime facts (longest/shortest flights live in Routes).
function funFacts(flights: Flight[], settings: { units: "mi" | "km" }): Fact[] {
  if (flights.length === 0) return [];
  const totalMi = flights.reduce((s, f) => s + flightDistanceMi(f), 0);
  const totalMin = flights.reduce((s, f) => s + flightMinutes(f), 0);
  const facts: Fact[] = [];

  facts.push({ label: "Times around the Earth", value: `${(totalMi / EARTH_CIRC_MI).toFixed(1)}×` });
  facts.push({ label: "Distance to the Moon", value: `${Math.round((totalMi / MOON_MI) * 100)}%` });
  facts.push({ label: "Days in the air", value: `${(totalMin / 1440).toFixed(1)}`, sub: "days" });

  const home = mode(flights, (f) => f.dep_iata);
  if (home) facts.push({ label: "Home base", value: home.key, sub: `${home.n} departures`, action: { kind: "filter", filter: airportFilter(home.key) } });

  // go-to airline, with the two-code carriers (e.g. Ryanair FR/RK) merged
  const alCount = new Map<string, { name: string; n: number }>();
  for (const f of flights) {
    const k = airlineKey(f.airline_iata);
    if (!k) continue;
    const cur = alCount.get(k) ?? { name: airlineNameOf(f), n: 0 };
    cur.n++;
    alCount.set(k, cur);
  }
  let topAl: { key: string; name: string; n: number } | null = null;
  for (const [k, v] of alCount) if (!topAl || v.n > topAl.n) topAl = { key: k, name: v.name, n: v.n };
  if (topAl) facts.push({ label: "Go-to airline", value: topAl.name, sub: `${topAl.n} flights`, action: { kind: "filter", filter: airlineFilter(topAl.key, topAl.name) } });

  const busiestMonth = mode(flights, (f) => f.flight_date.slice(0, 7));
  if (busiestMonth) {
    const [y, mo] = busiestMonth.key.split("-");
    facts.push({ label: "Busiest month", value: `${MONTHS[Number(mo) - 1]} ${y}`, sub: `${busiestMonth.n} flights`, action: { kind: "range", range: monthRange(busiestMonth.key) } });
  }

  const km = settings.units === "km";
  const conv = (mi: number) => Math.round(mi * (km ? 1.60934 : 1)).toLocaleString();
  const u = km ? "km" : "mi";
  const avgMi = totalMi / flights.length;
  facts.push({ label: "Average flight length", value: `${conv(avgMi)} ${u}` });

  // fastest flight (ground speed) — only flights with a real track + air time
  let fastest: { mph: number; label: string; id: string } | null = null;
  for (const f of flights) {
    if (f.flown_distance_mi == null) continue;
    const min = flightMinutes(f);
    if (min <= 0) continue;
    const mph = (flightDistanceMi(f) * 60) / min;
    if (!fastest || mph > fastest.mph) fastest = { mph, label: `${f.dep_iata}–${f.arr_iata}`, id: f.id };
  }
  if (fastest) {
    const spd = Math.round(fastest.mph * (km ? 1.60934 : 1));
    facts.push({ label: "Fastest flight", value: `${spd.toLocaleString()} ${km ? "km/h" : "mph"}`, sub: fastest.label, action: { kind: "flight", flightId: fastest.id } });
  }

  // biggest detour — flight whose flown path most exceeds the great-circle distance
  let detour: { ratio: number; label: string; id: string } | null = null;
  for (const f of flights) {
    const gc = f.distance_mi ?? 0;
    if (f.flown_distance_mi == null || gc < 100) continue; // skip short hops where the ratio is noisy
    const ratio = f.flown_distance_mi / gc;
    if (ratio < 1.02) continue;
    if (!detour || ratio > detour.ratio) detour = { ratio, label: `${f.dep_iata}–${f.arr_iata}`, id: f.id };
  }
  if (detour) facts.push({ label: "Biggest detour", value: `${detour.ratio.toFixed(2)}× direct`, sub: detour.label, action: { kind: "flight", flightId: detour.id } });
  // route whose per-leg distance is closest to the average
  let closest: { label: string; per: number; d: number; dep: string; arr: string } | null = null;
  for (const r of routesFrom(flights, false).values()) {
    const per = r.distanceMi / r.flights;
    const d = Math.abs(per - avgMi);
    if (!closest || d < closest.d) closest = { label: `${r.dep}–${r.arr}`, per, d, dep: r.dep, arr: r.arr };
  }
  if (closest) facts.push({ label: "Closest route to avg length", value: closest.label, sub: `${conv(closest.per)} ${u}`, action: { kind: "filter", filter: routeFilter(closest.dep, closest.arr) } });

  // shortest layover from connections (arrive→depart same airport within 16h). Use the
  // provider (airline) scheduled times when present — manually-imported flights often have
  // 00:00 placeholder sched times that would otherwise produce bogus 0-min layovers.
  const chrono = [...flights].sort((a, b) => schedDep(a).localeCompare(schedDep(b)));
  let shortLay: { min: number; iata: string; date: string } | null = null;
  for (let i = 0; i < chrono.length - 1; i++) {
    if (chrono[i].arr_iata !== chrono[i + 1].dep_iata) continue;
    // only trust a pair when BOTH legs have real airline-provided times
    if (!chrono[i].provider_sched_arr || !chrono[i + 1].provider_sched_dep) continue;
    const gap = (new Date(schedDep(chrono[i + 1])).getTime() - new Date(schedArr(chrono[i])).getTime()) / 60000;
    if (gap <= 0 || gap > 16 * 60) continue;
    if (!shortLay || gap < shortLay.min) shortLay = { min: gap, iata: chrono[i].arr_iata, date: chrono[i + 1].flight_date };
  }
  if (shortLay) {
    const d = formatDuration(shortLay.min);
    const v = d.unit === "m" ? `${d.value} min` : d.value;
    facts.push({ label: "Shortest layover", value: v, sub: `${shortLay.iata} · ${shortLay.date}` });
  }

  return facts;
}

type Metric = "flights" | "distance" | "time";
type Group = "year" | "season" | "month" | "weekday";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SEASONS = ["Spring", "Summer", "Fall", "Winter"];
const seasonOf = (mo: number) => (mo >= 2 && mo <= 4 ? 0 : mo >= 5 && mo <= 7 ? 1 : mo >= 8 && mo <= 10 ? 2 : 3);

const metricValue = (f: Flight, m: Metric) =>
  m === "flights" ? 1 : m === "distance" ? flightDistanceMi(f) : flightMinutes(f);

function bucket(flights: Flight[], group: Group, metric: Metric, today: string) {
  // split each bucket into already-flown vs future (not-yet-flown)
  const m = new Map<string, { flown: number; future: number; label: string; sort: string }>();
  for (const f of flights) {
    const d = new Date(schedDep(f));
    const y = f.flight_date.slice(0, 4);
    let key: string, label: string, sort: string;
    if (group === "year") {
      key = y;
      label = y;
      sort = y;
    } else if (group === "season") {
      const mo = d.getMonth();
      const si = seasonOf(mo);
      // meteorological winter (Dec–Feb): Jan/Feb belong to the previous December's year
      const sYear = si === 3 && mo <= 1 ? String(Number(y) - 1) : y;
      key = `${sYear} ${SEASONS[si]}`;
      sort = `${sYear}-${si}`;
      label = `${sYear} ${SEASONS[si]}`;
    } else if (group === "month") {
      const mi = d.getMonth();
      key = MONTHS[mi];
      label = MONTHS[mi];
      sort = String(mi).padStart(2, "0");
    } else {
      key = WEEKDAYS[d.getDay()];
      label = key;
      sort = String(d.getDay());
    }
    const cur = m.get(key) ?? { flown: 0, future: 0, label, sort };
    const v = metricValue(f, metric);
    if (f.flight_date > today) cur.future += v;
    else cur.flown += v;
    m.set(key, cur);
  }
  return [...m.entries()]
    .sort(([, a], [, b]) => a.sort.localeCompare(b.sort))
    .map(([id, v]) => ({ id, label: v.label, flown: Math.round(v.flown), future: Math.round(v.future) }));
}

export const overall: StatModule = {
  id: "overall",
  order: 1,
  card: (ctx) => {
    const flights = ctx.flights.length;
    const dist = sumDistanceMi(ctx.flights);
    const prev = ctx.compareFlights;
    return {
      eyebrow: "Overall",
      stats: [
        { value: flights, unit: "flights", compareValue: prev ? prev.length : null },
        { value: dist, format: (n, s) => formatDistance(n, s), compareValue: prev ? sumDistanceMi(prev) : null },
      ],
    };
  },
  Panel: ({ ctx }) => {
    const [metric, setMetric] = useState<Metric>("flights");
    const [group, setGroup] = useState<Group>("year");
    const { range, setRange, toggleCrossFilter } = useStore();
    const today = new Date().toISOString().slice(0, 10);
    const activeYear = yearOfRange(range);
    const runFact = (a: FactAction) => {
      if (a.kind === "filter") toggleCrossFilter(a.filter);
      else if (a.kind === "range") setRange(a.range);
      else {
        // open this flight's popup on the map (mirrors the flight-number search action)
        window.dispatchEvent(new CustomEvent("journia:closepopup"));
        window.dispatchEvent(new CustomEvent("journia:showflight", { detail: { flightId: a.flightId } }));
      }
    };

    return (
      <>
        <div className="flex items-center justify-between gap-3">
          <Segmented
            aria-label="Group"
            size="sm"
            value={group}
            onChange={setGroup}
            options={[
              { value: "year", label: "Year" },
              { value: "season", label: "Season" },
              { value: "month", label: "Month" },
              { value: "weekday", label: "DoW" },
            ]}
          />
          <Dropdown
            aria-label="Metric"
            size="sm"
            value={metric}
            onChange={setMetric}
            options={[
              { value: "flights", label: "Flights" },
              { value: "distance", label: "Distance" },
              { value: "time", label: "Time" },
            ]}
          />
        </div>
        {group === "season" ? (
          <Lines
            rows={bucket(ctx.flights, group, metric, today)}
            series={[
              { key: "flown", name: "Flown", color: color.accent },
              { key: "future", name: "Upcoming", color: color.upcoming },
            ]}
            unit={metricName[metric]}
            height={200}
          />
        ) : (
          <BarsV
            rows={bucket(ctx.flights, group, metric, today)}
            series={[
              { key: "flown", name: "Flown", color: color.accent },
              { key: "future", name: "Upcoming", color: color.upcoming },
            ]}
            unit={metricName[metric]}
            activeId={group === "year" ? activeYear : null}
            onPick={group === "year" ? (id) => setRange(activeYear === id ? ALL_TIME : yearRange(id)) : undefined}
          />
        )}
        <FactList title="Fun facts" facts={funFacts(ctx.flights, ctx.settings)} onAction={runFact} />
      </>
    );
  },
};

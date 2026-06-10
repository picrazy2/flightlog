import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Popover } from "@/components/ui/Popover";
import { routesFrom } from "@/lib/aggregate";
import { useStore } from "@/state/store";
import { airportFilter, routeFilter, cityFilter, countryFilter, airlineFilter, aircraftFilter } from "@/stats/filters";
import { Icon } from "@/components/ui/Icon";
import type { StatContext } from "@/stats/types";

interface Suggestion {
  key: string;
  cat: string; // Airport / Route / City / Country / Airline / Aircraft
  label: string;
  sub: string;
  hay: string;
  weight: number;
  run: () => void;
}

// Fly/fit the map by dispatching a window event MapHost listens for (keeps the
// search box decoupled from the map instance).
function focusAirport(lng: number, lat: number) {
  window.dispatchEvent(new CustomEvent("journia:flyto", { detail: { lng, lat, zoom: 5 } }));
}
function focusRoute(bounds: [[number, number], [number, number]]) {
  window.dispatchEvent(new CustomEvent("journia:fit", { detail: { bounds } }));
}

export function SearchBox({ ctx, iconOnly }: { ctx: StatContext; iconOnly?: boolean }) {
  const [q, setQ] = useState("");
  const toggleCrossFilter = useStore((s) => s.toggleCrossFilter);

  const index = useMemo<Suggestion[]>(() => {
    const out: Suggestion[] = [];

    // airports (fly to + filter)
    for (const a of ctx.airports.values()) {
      if (a.lng == null || a.lat == null) continue;
      out.push({
        key: `airport:${a.iata}`,
        cat: "Airport",
        label: `${a.iata} · ${a.city ?? a.name ?? ""}`,
        sub: a.countryName ?? "",
        hay: `${a.iata} ${a.city ?? ""} ${a.name ?? ""} ${a.countryName ?? ""}`.toLowerCase(),
        weight: a.visits,
        run: () => {
          focusAirport(a.lng!, a.lat!);
          toggleCrossFilter(airportFilter(a.iata));
        },
      });
    }

    // routes (fit + filter)
    for (const r of routesFrom(ctx.flights, false).values()) {
      const f = r.sampleFlight;
      out.push({
        key: `route:${r.key}`,
        cat: "Route",
        label: `${r.dep} → ${r.arr}`,
        sub: `${r.flights} flights`,
        hay: `${r.dep} ${r.arr}`.toLowerCase(),
        weight: r.flights,
        run: () => {
          focusRoute([
            [Math.min(f.dep_lng ?? 0, f.arr_lng ?? 0), Math.min(f.dep_lat ?? 0, f.arr_lat ?? 0)],
            [Math.max(f.dep_lng ?? 0, f.arr_lng ?? 0), Math.max(f.dep_lat ?? 0, f.arr_lat ?? 0)],
          ]);
          toggleCrossFilter(routeFilter(r.dep, r.arr));
        },
      });
    }

    // cities & countries (from the airport aggregates)
    const cities = new Map<string, { country: string; visits: number }>();
    const countries = new Map<string, { name: string; visits: number }>();
    for (const a of ctx.airports.values()) {
      if (a.city) {
        const c = cities.get(a.city) ?? { country: a.countryName ?? "", visits: 0 };
        c.visits += a.visits;
        cities.set(a.city, c);
      }
      if (a.country) {
        const c = countries.get(a.country) ?? { name: a.countryName ?? a.country, visits: 0 };
        c.visits += a.visits;
        countries.set(a.country, c);
      }
    }
    for (const [city, c] of cities) {
      out.push({ key: `city:${city}`, cat: "City", label: city, sub: c.country, hay: `${city} ${c.country}`.toLowerCase(), weight: c.visits, run: () => toggleCrossFilter(cityFilter(city)) });
    }
    for (const [iso, c] of countries) {
      out.push({ key: `country:${iso}`, cat: "Country", label: c.name, sub: iso, hay: `${c.name} ${iso}`.toLowerCase(), weight: c.visits, run: () => toggleCrossFilter(countryFilter(iso, c.name)) });
    }

    // airlines & aircraft (from the flights)
    const airlines = new Map<string, { name: string; n: number }>();
    const aircraft = new Map<string, { name: string; n: number }>();
    for (const f of ctx.flights) {
      if (f.airline_iata) {
        const a = airlines.get(f.airline_iata) ?? { name: f.airline_name ?? f.airline_iata, n: 0 };
        a.n += 1;
        airlines.set(f.airline_iata, a);
      }
      if (f.aircraft_type_code) {
        const a = aircraft.get(f.aircraft_type_code) ?? { name: f.aircraft_type_name ?? f.aircraft_type_code, n: 0 };
        a.n += 1;
        aircraft.set(f.aircraft_type_code, a);
      }
    }
    for (const [iata, a] of airlines) {
      out.push({ key: `airline:${iata}`, cat: "Airline", label: a.name, sub: `${a.n} flights`, hay: `${iata} ${a.name}`.toLowerCase(), weight: a.n, run: () => toggleCrossFilter(airlineFilter(iata, a.name)) });
    }
    for (const [code, a] of aircraft) {
      out.push({ key: `aircraft:${code}`, cat: "Aircraft", label: a.name, sub: code, hay: `${code} ${a.name}`.toLowerCase(), weight: a.n, run: () => toggleCrossFilter(aircraftFilter(code, a.name)) });
    }

    return out;
  }, [ctx, toggleCrossFilter]);

  const results = useMemo(() => {
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    // every token must appear in the haystack (so "sfo jfk" finds the SFO↔JFK route)
    return index.filter((s) => tokens.every((t) => s.hay.includes(t))).sort((a, b) => b.weight - a.weight).slice(0, 24);
  }, [q, index]);

  const resultList = (close: () => void) => (
    <ul className="max-h-[300px] overflow-y-auto">
      {results.map((s) => (
        <li key={s.key}>
          <button
            onClick={() => {
              s.run();
              close();
            }}
            className="focus-ring flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-surface-2"
          >
            <span className="w-14 shrink-0 text-caption uppercase tracking-[0.04em] text-ink-faint">{s.cat}</span>
            <span className="min-w-0 flex-1 truncate text-label text-ink">{s.label}</span>
            <span className="shrink-0 text-caption text-ink-faint">{s.sub}</span>
          </button>
        </li>
      ))}
      {q && results.length === 0 && <li className="px-2.5 py-2 text-caption text-ink-faint">No matches</li>}
    </ul>
  );

  // Mobile: a full-width search bar + results that drop down from the top, not anchored
  // to the icon.
  if (iconOnly) {
    return <MobileSearch q={q} setQ={setQ}>{resultList}</MobileSearch>;
  }

  return (
    <Popover
      align="start"
      trigger={({ toggle, open }) => (
        <button
          onClick={() => {
            if (!open) setQ(""); // don't remember the previous query when reopening
            toggle();
          }}
          aria-label="Search"
          className={
            iconOnly
              ? "focus-ring grid h-10 w-10 place-items-center rounded-full border border-border bg-surface-1 text-ink shadow-1"
              : "focus-ring inline-flex h-[34px] min-w-[180px] shrink-0 items-center gap-2 rounded-full border border-border bg-surface-2 px-3.5 text-label text-ink-muted hover:bg-surface-3"
          }
        >
          <Icon name="magnifying-glass" size={iconOnly ? 18 : 14} />
          {!iconOnly && <span>Search</span>}
        </button>
      )}
    >
      {(close) => (
        <div className="w-[300px]">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search airport, city, airline, aircraft…"
            className="focus-ring mb-2 w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-label text-ink placeholder:text-ink-faint"
          />
          {resultList(close)}
        </div>
      )}
    </Popover>
  );
}

function MobileSearch({ q, setQ, children }: { q: string; setQ: (v: string) => void; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <button
        onClick={() => {
          setQ("");
          setOpen(true);
        }}
        aria-label="Search"
        className="focus-ring grid h-[34px] w-[34px] place-items-center rounded-full border border-border bg-surface-2 text-ink"
      >
        <Icon name="magnifying-glass" size={16} />
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50" onClick={close}>
            <div className="animate-fade-in absolute inset-0 bg-black/40" />
            <div
              className="glass animate-panel-in absolute inset-x-0 top-0 p-3 shadow-3"
              style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2">
                <Icon name="magnifying-glass" size={16} className="shrink-0" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search airport, city, airline, aircraft…"
                  className="min-w-0 flex-1 bg-transparent py-1.5 text-label text-ink placeholder:text-ink-faint focus:outline-none"
                />
                <button onClick={close} className="focus-ring shrink-0 px-1 text-label text-accent">
                  Cancel
                </button>
              </div>
              <div className="mt-2">{children(close)}</div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

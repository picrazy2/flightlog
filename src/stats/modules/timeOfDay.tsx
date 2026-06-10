import type { StatModule } from "../types";
import type { Flight } from "@/lib/types";
import { Lines, type ChartBand } from "@/components/charts/Lines";
import { MiniStats } from "@/components/ui/MiniStat";
import { formatPct, localHour, actualDep, actualArr } from "@/lib/format";
import { color } from "@/lib/palette";

const isMorning = (h: number) => h >= 5 && h < 12;

// Four parts of the day, keyed by local departure hour. Bands tint the chart bg.
const WINDOWS = [
  { id: "redeye", label: "Red-eye", sub: "10pm–5am", color: "#FB7185", test: (h: number) => h >= 22 || h < 5 },
  { id: "morning", label: "Morning", sub: "5am–12pm", color: "#FFC061", test: (h: number) => h >= 5 && h < 12 },
  { id: "afternoon", label: "Afternoon", sub: "12pm–6pm", color: "#5B9DFF", test: (h: number) => h >= 12 && h < 18 },
  { id: "evening", label: "Evening", sub: "6pm–10pm", color: "#A78BFA", test: (h: number) => h >= 18 && h < 22 },
];

// Faint background regions over the 0–23 hour axis (categories "00".."23").
// Adjacent bands SHARE a boundary category so there are no gaps between them.
const BANDS: ChartBand[] = [
  { x1: "00", x2: "05", color: "rgba(251,113,133,0.08)" }, // red-eye (wraps)
  { x1: "05", x2: "12", color: "rgba(255,192,97,0.08)" }, // morning
  { x1: "12", x2: "18", color: "rgba(91,157,255,0.08)" }, // afternoon
  { x1: "18", x2: "22", color: "rgba(167,139,250,0.10)" }, // evening
  { x1: "22", x2: "23", color: "rgba(251,113,133,0.08)" }, // red-eye (wrap)
];

// Hour histogram (0–23) for a scheduled + actual time pair, over flights that have
// the actual time (past flights).
function hourPair(
  flights: Flight[],
  sched: (f: Flight) => string,
  actual: (f: Flight) => string | null,
  tz: (f: Flight) => string | null,
) {
  const s = new Array(24).fill(0) as number[];
  const a = new Array(24).fill(0) as number[];
  for (const f of flights) {
    const act = actual(f);
    if (!act) continue; // past flights only (need the actual time)
    s[localHour(sched(f), tz(f))]++;
    a[localHour(act, tz(f))]++;
  }
  return Array.from({ length: 24 }, (_, h) => ({ id: String(h), label: String(h).padStart(2, "0"), Scheduled: s[h], Actual: a[h] }));
}

export const timeOfDay: StatModule = {
  id: "time-of-day",
  order: 9,
  card: (ctx) => {
    const pctAM = (fs: Flight[]) => {
      let morning = 0;
      for (const f of fs) if (isMorning(localHour(f.sched_dep, f.dep_timezone))) morning++;
      return fs.length ? (morning / fs.length) * 100 : 0;
    };
    return {
      eyebrow: "Morning flights",
      title: "Time of day",
      stats: [
        { value: pctAM(ctx.flights), format: (n) => formatPct(n), compareValue: ctx.compareFlights ? pctAM(ctx.compareFlights) : null },
      ],
    };
  },
  Panel: ({ ctx }) => {
    const dep = hourPair(ctx.flights, (f) => f.sched_dep, (f) => actualDep(f), (f) => f.dep_timezone);
    const arr = hourPair(ctx.flights, (f) => f.sched_arr, (f) => actualArr(f), (f) => f.arr_timezone);
    const series = [
      { key: "Scheduled", name: "Scheduled", color: color.accent },
      { key: "Actual", name: "Actual", color: color.secondary },
    ];

    // % of all flights (by local departure hour) in each part of the day
    const counts = new Array(WINDOWS.length).fill(0) as number[];
    for (const f of ctx.flights) {
      const h = localHour(f.sched_dep, f.dep_timezone);
      const idx = WINDOWS.findIndex((w) => w.test(h));
      if (idx >= 0) counts[idx]++;
    }
    const total = ctx.flights.length || 1;
    const cards = WINDOWS.map((w, i) => ({
      label: w.label,
      value: `${Math.round((counts[i] / total) * 100)}%`,
      color: w.color,
    }));

    const hasData = dep.some((r) => r.Scheduled || r.Actual) || arr.some((r) => r.Scheduled || r.Actual);

    return (
      <>
        <MiniStats items={cards} />
        {hasData ? (
          <>
            <div>
              <div className="mb-1.5 text-eyebrow tracking-[0.01em] text-ink-faint">Departures · by local hour</div>
              <Lines rows={dep} series={series} height={170} syncId="tod" bands={BANDS} />
            </div>
            <div>
              <div className="mb-1.5 text-eyebrow tracking-[0.01em] text-ink-faint">Arrivals · by local hour</div>
              <Lines rows={arr} series={series} height={170} syncId="tod" bands={BANDS} />
            </div>
          </>
        ) : (
          <p className="text-label text-ink-muted">No actual-time data in this range.</p>
        )}
      </>
    );
  },
  // Per-flight colouring by local departure window.
  map: {
    colorFlight: (f) => WINDOWS.find((w) => w.test(localHour(f.sched_dep, f.dep_timezone)))?.color ?? "#5C6575",
    flightLegendId: (f) => WINDOWS.find((w) => w.test(localHour(f.sched_dep, f.dep_timezone)))?.id ?? "other",
    legend: () => ({
      title: "Departure",
      items: WINDOWS.map((w) => ({ id: w.id, label: `${w.label} · ${w.sub}`, color: w.color, swatch: "line" as const })),
    }),
  },
};

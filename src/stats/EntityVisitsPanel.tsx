import { useState } from "react";
import { Segmented } from "@/components/ui/Segmented";
import { Switch } from "@/components/ui/Switch";
import { OptionsButton } from "@/components/ui/OptionsButton";
import { EntityChart } from "./EntityChart";
import { useChartType } from "./useChartType";
import { useStore } from "@/state/store";
import type { CrossFilter } from "@/state/store";
import type { StatContext } from "./types";
import { buildStack, buildCount, buildTypeStack, buildVisitTypeStack, buildVisits, type EntityLevel } from "./entityBreakdown";

export type Breakdown = "airport" | "city" | "type" | "visitType";

const LABELS: Record<Breakdown, string> = {
  airport: "Airport",
  city: "City",
  type: "Dom·Intl",
  visitType: "Visit type",
};

// ISO-3166 alpha-2 → flag emoji (regional indicator letters).
function flagEmoji(iso: string): string {
  if (!/^[A-Za-z]{2}$/.test(iso)) return "";
  const cps = [...iso.toUpperCase()].map((c) => 0x1f1e6 + (c.charCodeAt(0) - 65));
  return String.fromCodePoint(...cps);
}

interface Props {
  ctx: StatContext;
  level: EntityLevel;
  facet: string; // cross-filter prefix, e.g. "city" / "country"
  breakdowns: Breakdown[];
  filterFor: (id: string, name: string) => CrossFilter;
}

// Shared Cities/Countries panel: visits, broken down by a configurable dimension,
// as a stacked bar (with the breakdown toggle) or a top-N + Other pie.
export function EntityVisitsPanel({ ctx, level, facet, breakdowns, filterFor }: Props) {
  const [breakdown, setBreakdown] = useState<Breakdown>(breakdowns[0]);
  const [countMode, setCountMode] = useState(false); // visits vs # of unique airports/cities
  const { chartType, control: chartControl } = useChartType();
  const { toggleCrossFilter, crossFilters } = useStore();
  // the unique-count metric only applies to the airport/city stacked breakdowns
  const canCount = chartType === "bar" && (breakdown === "airport" || breakdown === "city");
  const metric = canCount && countMode ? "count" : "visits";
  const activeId = crossFilters.find((c) => c.id.startsWith(`${facet}:`))?.id.split(":")[1] ?? null;
  const unit = metric === "count" ? (breakdown === "airport" ? "airports" : "cities") : "visits";

  // pie has no breakdown — just visit totals; bar uses the selected breakdown.
  // visits are connection-deduped (AirportAgg.visits / connection-aware dom-intl).
  const built =
    chartType === "pie"
      ? buildVisits(ctx.airports, level)
      : metric === "count"
        ? buildCount(ctx.airports, level, breakdown === "city" ? "city" : "airport")
        : breakdown === "airport"
          ? buildStack(ctx.airports, level, "airport")
          : breakdown === "city"
            ? buildStack(ctx.airports, level, "city")
            : breakdown === "type"
              ? buildTypeStack(ctx.flights, level)
              : buildVisitTypeStack(ctx.airports, level);

  // country bars/slices get a flag emoji prefix (row id = ISO code at country level)
  const rows =
    level === "country"
      ? built.rows.map((r) => ({ ...r, label: `${flagEmoji(String(r.id))} ${r.label}`.trim() }))
      : built.rows;

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        {chartType === "bar" ? (
          <Segmented
            aria-label="Breakdown"
            size="sm"
            value={breakdown}
            onChange={setBreakdown}
            options={breakdowns.map((b) => ({ value: b, label: LABELS[b] }))}
          />
        ) : (
          <span />
        )}
        <OptionsButton>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-label text-ink-muted">Chart</span>
              {chartControl}
            </div>
            {canCount && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-label text-ink-muted">Count unique {breakdown === "airport" ? "airports" : "cities"}</span>
                <Switch checked={countMode} onChange={setCountMode} />
              </div>
            )}
          </div>
        </OptionsButton>
      </div>
      <EntityChart
        rows={rows}
        series={built.series}
        chartType={chartType}
        activeId={activeId}
        unit={unit}
        onPick={(id) => toggleCrossFilter(filterFor(id, built.names.get(id) ?? id))}
      />
    </>
  );
}

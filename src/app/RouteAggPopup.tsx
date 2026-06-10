import { Icon } from "@/components/ui/Icon";
import { color } from "@/lib/palette";
import { formatDistance } from "@/lib/format";
import { cabinLabel, segmentCost, gmailLink } from "@/lib/cabin";
import type { Flight, Settings } from "@/lib/types";

// Popup for an untracked great-circle that represents multiple flights on a route —
// instead of one flight's times, summarise the route and list each flight.
export function RouteAggPopup({ flights, dep, arr, settings, fluid, hideHeader }: { flights: Flight[]; dep: string; arr: string; settings: Settings; fluid?: boolean; hideHeader?: boolean }) {
  const rows = [...flights].sort((a, b) => b.flight_date.localeCompare(a.flight_date));
  const totalMi = rows.reduce((s, f) => s + (f.route_distance_mi ?? f.distance_mi ?? 0), 0);
  const dist = totalMi ? formatDistance(totalMi, settings) : null;

  return (
    <div style={{ width: fluid ? "100%" : 258 }}>
      {!hideHeader && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <Icon name="route" size={13} color={color.secondary} />
          <span><b>{dep} → {arr}</b></span>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "var(--ink-muted)", marginTop: 1, marginBottom: 4 }}>
        {rows.length} flights{dist ? ` · ${dist.value} ${dist.unit} total` : ""}
      </div>

      <div style={{ maxHeight: 240, overflowY: "auto", margin: "0 -2px" }}>
        {rows.map((f) => {
          const cost = segmentCost(f);
          const costStr = [cost.cash, cost.points].filter(Boolean).join(" + ");
          const email = f.emails?.find((e) => e.kind === "booking") ?? f.emails?.[0] ?? null;
          const sameDir = f.dep_iata === dep;
          return (
            <div
              key={f.id}
              style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, padding: "4px 2px", borderTop: "1px solid var(--border)" }}
            >
              <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.3, minWidth: 0 }}>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {f.flight_date}
                  {!sameDir && <span style={{ color: "var(--ink-faint)" }}> ·  {f.dep_iata}→{f.arr_iata}</span>}
                </span>
                <span style={{ color: "var(--ink-muted)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.airline_iata}{f.flight_number}
                  {f.cabin_class ? ` · ${cabinLabel(f.cabin_class)}` : ""}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", textAlign: "right", lineHeight: 1.3 }}>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{costStr || "—"}</span>
                {email && (
                  <a href={gmailLink(email.message_id)} target="_blank" rel="noreferrer" style={{ color: color.accent, textDecoration: "none", fontSize: 11 }}>
                    Gmail ↗
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

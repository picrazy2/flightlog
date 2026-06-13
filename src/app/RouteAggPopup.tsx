import { Icon } from "@/components/ui/Icon";
import { color } from "@/lib/palette";
import { formatDistance, flightDistanceMi, schedDate } from "@/lib/format";
import { cabinLabel, segmentCost, gmailLink } from "@/lib/cabin";
import type { Flight, Settings } from "@/lib/types";

// Popup for an untracked great-circle that represents multiple flights on a route —
// instead of one flight's times, summarise the route and list each flight.
export function RouteAggPopup({ flights, dep, arr, settings, fluid, hideHeader }: { flights: Flight[]; dep: string; arr: string; settings: Settings; fluid?: boolean; hideHeader?: boolean }) {
  const rows = [...flights].sort((a, b) => b.flight_date.localeCompare(a.flight_date));
  const totalMi = rows.reduce((s, f) => s + flightDistanceMi(f), 0);
  const dist = totalMi ? formatDistance(totalMi, settings) : null;

  return (
    <div style={{ width: fluid ? "100%" : 258 }}>
      {!hideHeader && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, paddingRight: 38 }}>
          <Icon name="route" size={13} color={color.secondary} />
          <span><b>{dep} → {arr}</b></span>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "var(--ink-muted)", marginTop: 1, marginBottom: 4 }}>
        {rows.length} flights{dist ? ` · ${dist.value} ${dist.unit} total` : ""}
      </div>

      <div style={{ maxHeight: 240, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <tbody>
            {rows.map((f) => {
              const cost = segmentCost(f);
              const costStr = [cost.cash, cost.points].filter(Boolean).join(" + ");
              const email = f.emails?.find((e) => e.kind === "booking") ?? f.emails?.[0] ?? null;
              const sameDir = f.dep_iata === dep;
              return (
                <tr key={f.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "4px 6px 4px 0", color: "var(--ink-muted)", whiteSpace: "nowrap", verticalAlign: "top", fontVariantNumeric: "tabular-nums" }}>
                    {schedDate(f)}
                  </td>
                  {/* middle column absorbs the slack so cost hugs the right (no big gap) */}
                  <td style={{ padding: "4px 6px", width: "100%", verticalAlign: "top", lineHeight: 1.3 }}>
                    <span style={{ fontFamily: "Geist Mono, monospace" }}>{f.airline_iata}{f.flight_number}</span>
                    {!sameDir && <span style={{ color: "var(--ink-faint)" }}> {f.dep_iata}→{f.arr_iata}</span>}
                    {f.cabin_class ? <span style={{ color: "var(--ink-muted)" }}> · {cabinLabel(f.cabin_class)}</span> : null}
                  </td>
                  <td style={{ padding: "4px 0", textAlign: "right", whiteSpace: "nowrap", verticalAlign: "top", fontVariantNumeric: "tabular-nums" }}>
                    <div>{costStr || "—"}</div>
                    {email && (
                      <a href={gmailLink(email.message_id)} target="_blank" rel="noreferrer" style={{ color: color.accent, textDecoration: "none", fontSize: 11 }}>
                        Gmail ↗
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

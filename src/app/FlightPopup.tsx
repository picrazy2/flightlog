import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { color } from "@/lib/palette";
import { restGet } from "@/lib/supabase";
import { formatDistance, formatDuration, durationMin, schedDep, schedArr, departureDelayMin, arrivalDelayMin } from "@/lib/format";
import { cabinLabel, segmentCost, bookingCost, isMultiLeg, gmailLink } from "@/lib/cabin";
import type { Flight, Settings } from "@/lib/types";

const PersonIcon = ({ size = 11 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
    <circle cx="12" cy="7.5" r="4" />
    <path d="M3.5 20.5c0-4.4 3.8-7 8.5-7s8.5 2.6 8.5 7z" />
  </svg>
);

// Other logged users who were on this exact flight (same date + airline + number + route).
function useCoTravelers(f: Flight): string[] {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const q = [
          `flight_date=eq.${f.flight_date}`,
          `airline_iata=eq.${f.airline_iata}`,
          `flight_number=eq.${f.flight_number}`,
          `dep_iata=eq.${f.dep_iata}`,
          `arr_iata=eq.${f.arr_iata}`,
          `user_id=neq.${f.user_id}`,
          "select=user_id",
        ].join("&");
        const rows = await restGet<{ user_id: string }[]>(`v_flights_with_airports?${q}`);
        const ids = [...new Set(rows.map((r) => r.user_id))].filter(Boolean);
        if (!ids.length) {
          if (!cancelled) setNames([]);
          return;
        }
        const users = await restGet<{ id: string; name: string }[]>(`users?select=id,name&id=in.(${ids.join(",")})`);
        if (!cancelled) setNames(users.map((u) => u.name));
      } catch {
        if (!cancelled) setNames([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [f.id]);
  return names;
}

const GREEN = "#34D399";
const RED = "#FB7185";

function clock(iso: string | null, tz: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz ?? "UTC" }).format(new Date(iso));
  } catch {
    return "—";
  }
}
const delayColor = (d: number | null) => (d == null ? "var(--ink)" : d > 0 ? RED : GREEN);
const mins = (a: string | null, b: string | null) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 60000) : null);

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12, padding: "1.5px 0" }}>
    <span style={{ color: "var(--ink-muted)" }}>{label}</span>
    <span style={{ fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{children}</span>
  </div>
);
const Section = ({ title }: { title: string }) => (
  <div style={{ fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--ink-faint)", marginTop: 6, marginBottom: 1 }}>{title}</div>
);
const Strike = ({ children }: { children: React.ReactNode }) => (
  <span style={{ color: "var(--ink-faint)", textDecoration: "line-through", marginRight: 5 }}>{children}</span>
);

// [struck scheduled] actual [delay]
function TimeRow({ label, sched, actual, tz, delay }: { label: string; sched: string | null; actual: string | null; tz: string | null; delay?: number | null }) {
  if (!actual) return <Row label={label}>{sched ? clock(sched, tz) : "—"}</Row>;
  return (
    <Row label={label}>
      {sched && <Strike>{clock(sched, tz)}</Strike>}
      {clock(actual, tz)}
      {delay != null && <span style={{ color: delayColor(delay), marginLeft: 5 }}>{delay >= 0 ? "+" : ""}{delay}m</span>}
    </Row>
  );
}
function DurRow({ label, sched, actual }: { label: string; sched: number | null; actual: number | null }) {
  // green = faster than expected, red = slower
  const col = actual != null && sched != null ? (actual <= sched ? GREEN : RED) : "var(--ink)";
  return (
    <Row label={label}>
      {actual != null ? (
        <>{sched != null && <Strike>{formatDuration(sched).value}</Strike>}<span style={{ color: col }}>{formatDuration(actual).value}</span></>
      ) : sched != null ? (
        formatDuration(sched).value
      ) : (
        "—"
      )}
    </Row>
  );
}
function TaxiRow({ label, sched, actual }: { label: string; sched: number | null; actual: number | null }) {
  if (actual == null && sched == null) return null;
  return (
    <Row label={label}>
      {sched != null && actual != null && <Strike>{sched}m</Strike>}
      {actual != null ? `${actual}m` : `${sched}m`}
    </Row>
  );
}

export function FlightPopup({ flight, settings, fluid, hideHeader }: { flight: Flight; settings: Settings; fluid?: boolean; hideHeader?: boolean }) {
  const f = flight;
  const coTravelers = useCoTravelers(f);
  const rich = f.actual_dep != null || f.actual_arr != null; // AeroAPI gate data
  const depActual = f.actual_dep ?? f.actual_takeoff;
  const arrActual = f.actual_arr ?? f.actual_landing;
  const schedBlock = durationMin(schedDep(f), schedArr(f)); // gate-to-gate scheduled
  const actualBlock = f.actual_dep && f.actual_arr ? durationMin(f.actual_dep, f.actual_arr) : null;
  const schedAir = f.provider_sched_takeoff && f.provider_sched_landing ? durationMin(f.provider_sched_takeoff, f.provider_sched_landing) : null;
  const actualAir = f.actual_takeoff && f.actual_landing ? durationMin(f.actual_takeoff, f.actual_landing) : null;
  // non-rich fallback: prefer air, else block
  const actMins = actualAir ?? (depActual && arrActual ? durationMin(depActual, arrActual) : null);
  const gc = f.distance_mi != null ? formatDistance(f.distance_mi, settings) : null;
  // actual flown track distance (incl. GC fillers) preferred, else filed route distance
  const realMi = f.flown_distance_mi ?? f.route_distance_mi;
  const rt = realMi != null ? formatDistance(realMi, settings) : null;
  const cost = segmentCost(f);
  const full = bookingCost(f);
  const multiLeg = isMultiLeg(f);
  const costStr = [cost.cash, cost.points].filter(Boolean).join(" + ");
  const fullStr = [full.cash, full.points].filter(Boolean).join(" + ");
  const bookingEmail = f.emails?.find((e) => e.kind === "booking") ?? f.emails?.[0] ?? null;
  const hasBooking = !!(f.cabin_class || costStr || bookingEmail);

  // delay is "apples to apples" only when comparing actual gate to scheduled gate
  const depApprox = departureDelayMin(f) != null && !(f.actual_dep && f.provider_sched_dep);
  const arrApprox = arrivalDelayMin(f) != null && !(f.actual_arr && f.provider_sched_arr);
  const noProvider = !f.provider_sched_dep && !f.provider_sched_arr;
  const note = depApprox || arrApprox
    ? noProvider
      ? "Schedule from manual entry — delay approximate"
      : "Wheels vs scheduled gate — delay approximate"
    : null;

  return (
    <div style={{ width: fluid ? "100%" : 250 }}>
      {!hideHeader && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <Icon name="route" size={13} color={color.secondary} />
          <span><b>{f.dep_iata} → {f.arr_iata}</b></span>
          {f.diverted && <span style={{ color: RED, fontSize: 11 }}>· diverted</span>}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, marginBottom: 3 }}>
        <img
          src={`https://pics.avs.io/120/48/${f.airline_iata}.png`}
          alt=""
          // recolour the logo to light grey so it sits on the dark popup without a chip
          style={{ height: 30, filter: "brightness(0) invert(1)", opacity: 0.85 }}
          onError={(e) => (e.currentTarget.style.display = "none")}
        />
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.35, fontSize: 12, color: "var(--ink-muted)" }}>
          <span>{f.airline_iata}{f.flight_number} · {f.flight_date}</span>
          {f.aircraft_type_name && <span>{f.aircraft_type_name}</span>}
        </div>
      </div>

      {coTravelers.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: color.accent, padding: "2px 0" }}>
          <PersonIcon />
          <span>Also flown by {coTravelers.join(", ")}</span>
        </div>
      )}

      {rich ? (
        <>
          <Section title="Departure" />
          <TimeRow label="Gate out" sched={schedDep(f)} actual={f.actual_dep} tz={f.dep_timezone} delay={departureDelayMin(f)} />
          <TimeRow label="Wheels up" sched={f.provider_sched_takeoff} actual={f.actual_takeoff} tz={f.dep_timezone} delay={mins(f.provider_sched_takeoff, f.actual_takeoff)} />
          <TaxiRow label="Taxi out" sched={mins(f.provider_sched_dep, f.provider_sched_takeoff)} actual={mins(f.actual_dep, f.actual_takeoff)} />
          <Section title="Arrival" />
          <TimeRow label="Wheels down" sched={f.provider_sched_landing} actual={f.actual_landing} tz={f.arr_timezone} delay={mins(f.provider_sched_landing, f.actual_landing)} />
          <TimeRow label="Gate in" sched={schedArr(f)} actual={f.actual_arr} tz={f.arr_timezone} delay={arrivalDelayMin(f)} />
          <TaxiRow label="Taxi in" sched={mins(f.provider_sched_landing, f.provider_sched_arr)} actual={mins(f.actual_landing, f.actual_arr)} />
          <Section title="Trip" />
        </>
      ) : (
        <div style={{ marginTop: 4 }}>
          <TimeRow label="Departed" sched={schedDep(f)} actual={depActual} tz={f.dep_timezone} delay={departureDelayMin(f)} />
          <TimeRow label="Arrived" sched={schedArr(f)} actual={arrActual} tz={f.arr_timezone} delay={arrivalDelayMin(f)} />
        </div>
      )}

      {rich ? (
        <>
          <DurRow label="Block (gate)" sched={schedBlock} actual={actualBlock} />
          <DurRow label="Air time" sched={schedAir} actual={actualAir} />
        </>
      ) : (
        <DurRow label="Duration" sched={schedBlock} actual={actMins} />
      )}
      <Row label="Distance">
        {rt ? <><Strike>{gc?.value} {gc?.unit}</Strike>{rt.value} {rt.unit}</> : gc ? `${gc.value} ${gc.unit}` : "—"}
      </Row>
      {hasBooking && (
        <>
          <Section title="Booking" />
          {f.cabin_class && <Row label="Class">{cabinLabel(f.cabin_class)}</Row>}
          {costStr && (
            <Row label={multiLeg ? "Cost (est)" : "Cost"}>
              {costStr}
              {multiLeg && fullStr && <span style={{ color: "var(--ink-faint)", marginLeft: 5 }}>({fullStr} trip)</span>}
            </Row>
          )}
          {bookingEmail && (
            <Row label="Email">
              <a href={gmailLink(bookingEmail.message_id)} target="_blank" rel="noreferrer" style={{ color: color.accent, textDecoration: "none" }}>
                Open in Gmail ↗
              </a>
            </Row>
          )}
        </>
      )}
      {note && (
        <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 6, lineHeight: 1.3 }}>⚠ {note}</div>
      )}
    </div>
  );
}

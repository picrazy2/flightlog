# Journia — Product Spec (feature backlog, source of truth for behavior)

Captures the full intended behavior from product direction. Items marked **[v1]** are in
the first scaffold; **[next]** are designed-for but not yet built. The architecture
(registry, §ARCHITECTURE.md) must absorb all of these without shell branching.

## Layout [v1 shell]
- Full-bleed dark map canvas; all UI floats over it (glass).
- Top floating **control bar**: wordmark "Alex's Flight Log" · date-range pill (with
  compare) · **search** (route/airport autocomplete) · settings cluster.
- **Stat cards row** under the bar (canonical order, DESIGN_SYSTEM §8). Each card shows the
  value(s) **and a small delta** vs the comparison period (▲ green / ▼ red / – grey).
- **Detail panel** bottom-left (opens on card click). **Legend** bottom-right (interactive).
- Right-edge floating buttons: settings, fullscreen, globe/flat, **＋** (table/add modal).

## Map [v1: routes + airports + popups]
- Dark basemap. Routes = great-circle by default; actual track when present + toggle on.
- Airports sized by visits; recolored by the active module (country/year/airline).
- Hover popup (tiny: route/airport + key number). Click popup (bigger: times, cabin, cost,
  aircraft, PNR; **[next]** mini chart e.g. airport flights-over-time sparkline).
- **[next]** choropleth country layer; globe/flat projection toggle; actual-track rendering.

## Search [next]
- A search box (in/near the control bar) with **autocomplete** for a specific **route or
  airport**. Selecting flies the map to it, filters the app, and can open the relevant popup.
- Suggestions ranked by visit frequency; show IATA + name/city; routes as `AAA → BBB`.

## Stat cards — delta + comparison [partly v1]
- Under each stat: small arrow + number comparing to the comparison period.
  - green when up, red when down, **grey when ~0 or no valid comparison**.
- **Defaults:** normal date range = **All time**; comparison period = **last year**.
- **Comparison logic depends on the normal range** (must be encoded centrally, not per-card):
  - Bounded range (a year/quarter/custom): compare to the immediately-preceding equal-length
    period (non-overlapping) by default; "last year" = same period shifted −1 year.
  - All-time / unbounded: a strict "previous period" is undefined → either compare
    last-12-months vs prior-12-months, or render deltas grey. Pick per range; never show a
    misleading delta.
  - Guard against overlapping windows (e.g. range already = last 12 months) — choose the
    non-overlapping prior window or grey out.

## Detail panels (per module; DESIGN_SYSTEM §6 structure) [v1 basic → next rich]
Header (title + headline stat + close) → controls (segmented toggles) → primary chart →
secondary section (rankings / fun facts / secondary chart).
- **Charts must be interactive** [next]: hover tooltips, click a bar/series to filter the
  app (cross-filtering the map + other panels), keyboard focusable.
- **Stacked bar charts** [next]: e.g. Airports panel bars stacked by departures / arrivals /
  connections; **with a "100% stacked" toggle**. When a panel accrues too many toggles,
  collapse the extra controls into a **popover** ("⋯ / Options") rather than crowding the header.
- Module specifics (see prior direction): Overall (flights/distance/time toggle, by
  year/month/weekday, fun-facts incl. longest/shortest), Airports & Airlines (top-N bars,
  all/country/year group, dep/arr/conn, airline logos as labels), Cities (≈airports),
  Countries (choropleth + ranked bars), Routes (unique/directed, flights/dist/time,
  longest/shortest by time & distance), Domestic/Intl (split, country-pair breakdown),
  Delays (line: scheduled vs actual, dep/arr), Time of day (line by hour, dep/arr),
  Aircraft (bars by type, registrations), Cost (USD + points, by year).

## Database modal [next]
- ＋ opens a modal: viewable **table of flights + bookings**; manual add / edit / delete that
  call existing edge functions (create-flight / update-flight / delete-flight / import-csv) —
  no new backend.

## Settings [partly v1]
- Units km↔mi (Switch), 12h↔24h clock. Great-circle vs actual-track. Globe/flat. Theme dark
  (light extensible later).

## Cross-cutting rules
- Registry-driven, zero per-stat branching in the shell (ARCHITECTURE.md).
- Tokens only; reusable leaf components (Segmented/Switch/Card/StatCard/Panel/Legend/
  BarList/SearchBox/Popover/Chart wrappers).
- Interactive legend (click filter, shift-click isolate) drives both map and panels.

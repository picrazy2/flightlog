# Journia — Design System

The visual + interaction language for the flight-log app. Everything in `src/` should
trace back to a token or rule here. Goal: **dark, modern, bold, editorial — not "AI
default."**

---

## 0. Anti-patterns (what makes UI look AI-generated — never do these)

- ❌ `ALL-CAPS HEADINGS` with wide `letter-spacing`. Banned for headings. (All-caps is
  allowed *only* for tiny eyebrow labels at ≤11px, and even then with normal tracking.)
- ❌ Purple→pink gradients on everything, glow/neon overload.
- ❌ Generic Inter-everywhere with no display face.
- ❌ Three accent colors fighting. We have **one primary + one secondary**, period.
- ❌ Emoji as iconography in the UI chrome.
- ❌ Center-aligned everything; perfectly even card grids with no hierarchy.

We counter these with a real display typeface, restrained color, asymmetric hierarchy,
and motion that feels physical.

---

## 1. Brand

- **Product name:** Journia.
- **Wordmark in the control bar:** the `J` brand mark + `Journia` (display face, weight
  600). The wordmark is text, not all-caps.
- **Voice:** precise, understated, a little aviation-nerdy. Numbers are the hero.

---

## 2. Typography

Two families. No third.

| Role | Family | Notes |
|------|--------|-------|
| Display / wordmark / **stat numerals** | **Space Grotesk** | Geometric, characterful, excellent tabular figures. Weights 500/600/700. |
| UI / body / labels | **Geist Sans** (fallback `Inter`, system) | Clean, legible at small sizes. Weights 400/500/600. |
| Code / PNRs / registrations | **Geist Mono** (fallback `ui-monospace`) | Monospace for confirmation codes, tail numbers. |

Load via Google Fonts (`Space Grotesk`, `Geist`/`Geist Mono`). Self-host in production if
FOUT is an issue.

### Type scale (rem, 16px root)

| Token | size / line | weight | family | use |
|-------|-------------|--------|--------|-----|
| `display-xl` | 3rem / 1.05 | 700 | Space Grotesk | hero stat numbers in panels |
| `display-lg` | 2.25rem / 1.1 | 700 | Space Grotesk | big stat-card number |
| `display-md` | 1.5rem / 1.15 | 600 | Space Grotesk | panel headings, secondary stats |
| `title` | 1.125rem / 1.3 | 600 | Geist | section titles |
| `body` | 0.9375rem / 1.5 | 400 | Geist | default text |
| `label` | 0.8125rem / 1.4 | 500 | Geist | control labels, axis labels |
| `caption` | 0.75rem / 1.4 | 500 | Geist | muted meta |
| `eyebrow` | 0.6875rem / 1 | 600 | Geist | tiny section kicker; **only place caps/tracking is allowed**, tracking ≤ 0.04em |

**Numerals:** stat values use Space Grotesk with `font-feature-settings: "tnum" 1`
(tabular) so digits don't jitter when values animate. Units (km, h, $) are set in Geist at
~55% the numeral size, muted color, weight 500.

Headings are **title/sentence case**, normal tracking (`-0.01em` optical tightening on
display sizes only).

---

## 3. Color

Dark-first. Defined as CSS variables in `:root` (see `src/index.css`). HSL-ish hexes given
for reference.

### Surfaces & ink

| Token | Hex | Use |
|-------|-----|-----|
| `--bg` | `#0A0C12` | app background (behind the map; map is darker still) |
| `--surface-1` | `#11141C` | floating panels / cards base |
| `--surface-2` | `#171B25` | nested surfaces, popovers, inputs |
| `--surface-3` | `#1F2430` | hover state of surface-2 |
| `--border` | `rgba(255,255,255,0.08)` | hairline borders |
| `--border-strong` | `rgba(255,255,255,0.14)` | focus / active outlines |
| `--ink` | `#EAEDF3` | primary text |
| `--ink-muted` | `#98A2B3` | secondary text |
| `--ink-faint` | `#5C6575` | tertiary / disabled |

### Accents (one primary, one secondary — that's all)

| Token | Hex | Use |
|-------|-----|-----|
| `--accent` | `#5B9DFF` | primary: active controls, selection, focus rings, wordmark dot, primary CTA |
| `--accent-press` | `#3D82F0` | pressed primary |
| `--secondary` | `#FFC061` | secondary highlight: "compare" series, special emphasis, hover sparkles |

### Semantic / map data colors

| Token | Hex | Use |
|-------|-----|-----|
| `--route-domestic` | `#34D399` | domestic route lines (default route coloring) |
| `--route-intl` | `#FB7185` | international route lines (default route coloring) |
| `--airport` | `#CBD5E1` | airport marker fill (recolored by active panel) |
| `--positive` | `#34D399` | on-time, gains |
| `--warning` | `#FBBF24` | minor delay |
| `--negative` | `#F87171` | delay, losses |

### Categorical palette (years / countries / airlines / aircraft)

Ordered, colorblind-aware, all legible on `--bg`:

```
#5B9DFF #FFC061 #34D399 #FB7185 #A78BFA #22D3EE #F472B6 #A3E635 #FB923C #94A3B8
```

Use sequentially; wrap with a subtle lightness step if > 10 categories. A **sequential**
ramp (for choropleth) interpolates `#0E2A3F → #5B9DFF → #BFE0FF`.

### Rule: route + airport coloring is **panel-driven**

- Default (no panel / overall): routes = domestic/intl colors; airports = `--airport`
  uniform, **sized by visit count**.
- Country panel open → choropleth layer on; airports + routes recolored by country.
- Year panel/filter → recolor by year from the categorical palette.
- Airline panel → recolor routes by airline.
Color logic lives in one place (`src/map/colorBy.ts`) keyed off the active panel.

---

## 4. Spacing, radius, elevation

**Spacing** — 4px base scale: `2,4,6,8,12,16,20,24,32,40,48,64`. Components use the named
steps, never magic numbers.

**Radius**

| Token | px | use |
|-------|----|-----|
| `--r-sm` | 8 | inputs, small buttons, chips |
| `--r-md` | 12 | buttons, toggles, list rows |
| `--r-lg` | 16 | cards, stat cards |
| `--r-xl` | 20 | floating panels, control bar |
| `--r-full` | 9999 | pills, avatars, the date pill |

**Elevation** — floating surfaces use border + soft shadow + optional blur, not heavy
drop shadows.

| Token | value |
|-------|-------|
| `--shadow-1` | `0 1px 2px rgba(0,0,0,.4)` |
| `--shadow-2` | `0 8px 24px -8px rgba(0,0,0,.55)` (cards) |
| `--shadow-3` | `0 16px 48px -12px rgba(0,0,0,.6)` (panels, popovers) |
| `--blur` | `backdrop-filter: blur(16px) saturate(140%)` on floating chrome over the map |

Floating chrome (control bar, panels, legend) = `--surface-1` at ~`88%` opacity +
`--blur` + `--border` + `--shadow-3`. Tasteful glass, not frosted-glass-everything.

---

## 5. Motion

Physical, quick, never bouncy-cute.

| Token | curve / duration | use |
|-------|------------------|-----|
| `--ease-out` | `cubic-bezier(.16,1,.3,1)`, 200ms | most enter/hover |
| `--ease-in-out` | `cubic-bezier(.65,0,.35,1)`, 240ms | toggles, layout shifts |
| panel open | spring-ish: translateY(12px)+fade → 0, 260ms `--ease-out` | bottom-left detail panel |
| number roll | 600ms count-up on stat values when the range changes | stat cards |
| map fly | MapLibre `flyTo`, 800ms, on selecting a route/airport | |
| hover | 120ms color/scale (`scale 1.02` max) | interactive items |

Respect `prefers-reduced-motion`: drop count-ups, fly-to easing → jump, panel = fade only.

---

## 6. Component guidelines (the "leaf" components)

All are in `src/components/ui/`, typed, controlled, theme-token only. No inline hex.

### Button / IconButton
- Variants: `primary` (accent fill, ink-on-accent `#06101F`), `secondary` (surface-2 +
  border), `ghost` (transparent, hover surface-2), `danger` (negative text/fill).
- Sizes: `sm` (28px), `md` (34px), `lg` (40px). Radius `--r-md`. Icon-only → square, radius
  `--r-md`, 1px border in ghost.
- Focus: 2px `--accent` ring offset 2px. Active: scale .98.

### Toggle / SegmentedControl (used constantly — distance/time/#flights)
- The **segmented** control is the canonical multi-option toggle: a pill track
  (`--surface-2`, radius `--r-full`) with an animated **sliding thumb** (`--surface-3` +
  `--border-strong`) under the active segment; active label `--ink`, inactive `--ink-muted`.
- Thumb slides with `--ease-in-out`. 2–4 options. Used for: Distance/Time/#Flights,
  Departures/Arrivals/Connections, All/Country/Year, Shortest/Longest, By distance/By time.
- A binary **Switch** (on/off) exists separately for settings (km↔mi, great-circle on/off).
- Both fully keyboard-operable (arrow keys move selection), `role="tablist"`/`radiogroup`.

### Card / StatCard
- Card: `--surface-1`, `--border`, radius `--r-lg`, padding 16–20, `--shadow-2`.
- StatCard: compact. Eyebrow label (muted, optional caps) + big `display-lg` numeral +
  unit + optional delta chip (▲/▼ vs comparison period, `--positive`/`--negative`).
  Entire card is a button → opens the detail panel. Hover: border→`--border-strong`,
  slight lift (translateY -1px). Selected: 1px `--accent` inset ring.
- Grouped stat cards (e.g. Cost = USD + points; Overall = flights+distance+time) render as
  one card with 2–3 internal stat columns separated by a hairline.

### Panel (bottom-left detail)
- Floating glass panel, radius `--r-xl`, max-width ~420px, max-height ~70vh, scrolls.
- Structure (top→bottom): **header** (title + headline stat + close) → optional
  **secondary stats / controls row** (segmented toggles) → **primary chart** (+ its
  controls) → optional **secondary section** (rankings / fun facts / secondary chart).
- Opens from the stat card; only one open at a time; Esc closes; click-away closes.

### Legend (bottom-right, map)
- Glass card. Items are **interactive**: clicking a legend item filters the app to that
  series (e.g. click "International" → show only intl). Active items full color; muted
  items dimmed to ~35% with a strikethrough-free "off" state. Shift-click = isolate.
- Shows the current color encoding (domestic/intl, or the active panel's scale: a country
  swatch list, a year ramp, etc.). Title reflects the encoding ("Routes", "Countries").

### DateRangePicker (in the control bar)
- A **pill** showing the active range (`Jan 2015 – Jun 2026`, or `All time`). Click → popover
  with: preset list (All time, This year, Last 12 months, YTD, each Year, each Quarter),
  a two-month calendar for custom, and a **Compare** toggle ("Compare to previous period")
  that, when on, drives the delta chips on stat cards and a secondary series on charts
  (drawn in `--secondary`).

### Popups (map)
- **Hover popup:** tiny, 1–2 lines, no chrome — route `AAA→BBB`, airline, date; or airport
  IATA + name + visit count. Follows cursor, 120ms fade.
- **Click popup:** larger card anchored to the feature — more detail (times, cabin, cost,
  aircraft, PNR) and possibly a mini chart (e.g. an airport's flights-over-time sparkline).
  Has a close button; one open at a time.

### Chips / Tags
- Pills, radius `--r-full`, `--surface-2`, `--border`. Delta chips colored by sign.

---

## 7. Layout

```
┌───────────────────────────────────────────────────────────────┐
│ J Journia   [ All time ▾ ]   ⌕ Search          …             │ ← floating control bar (top, glass)
│ ┌Overall──┐ ┌Airports┐ ┌Airlines┐ ┌Cities┐ ┌Countries┐ …      │ ← stat cards row (scrolls horiz on small)
│                                                                 │
│                         M A P                          ┌──────┐ │
│                    (routes + airports)                 │floating│← right-edge buttons:
│                                                        │buttons │  settings, fullscreen,
│ ┌──────────────┐                                       └──────┘ │  globe/flat, + (add/table)
│ │ detail panel │                              ┌──────────────┐  │
│ │ (on card     │                              │   legend     │  │ ← bottom-right
│ │  click)      │                              └──────────────┘  │
│ └──────────────┘                                                │ ← bottom-left
└───────────────────────────────────────────────────────────────┘
```

- The map is the full-bleed canvas. All UI floats over it with glass + blur.
- Control bar: wordmark left, date pill next to it, overflow/settings cluster right.
- Stat cards: horizontal row under the bar; the order is fixed (see §8). Wrap/scroll on
  narrow widths.
- Detail panel bottom-left; legend bottom-right; map tool buttons stacked at right edge.
- Generous outer gutter (16–20px) so glass never touches the viewport edge.

---

## 8. Stat cards — canonical order & grouping

1. **Overall** (grouped): # flights · distance · time
2. **Airports** (count)
3. **Cities** (count)
4. **Countries** (count)
5. **Continents** (count)
6. **Airlines** (count)
7. **Routes** (count; dup / unique)
8. **Delays** (% delayed)
9. **Premium** (% of flight time in premium cabins)
10. **Cost** (grouped): total cash · total points
11. **Aircraft types** (count)
12. **Time of day** (morning / evening split)
13. **Domestic / International** (split) — last

Order is driven by each module's `order` field in the registry. Each card → a detail
panel (§6). Units (km/mi) and display currency follow Settings.

---

## 9. Map styling tokens

- Base: MapLibre + **CARTO dark-matter** basemap (already dark; water `#0A0C12`, land
  `#0E1118`, borders `rgba(255,255,255,.06)`, labels `--ink-faint`, minimal POIs). The map
  must recede so data pops.
- Routes: 1.5px lines, `--route-domestic` / `--route-intl` default; hovered route → 2.5px +
  `--accent`; selected → 3px + white halo. Great-circle arcs (turf) unless actual track
  exists and the track toggle is on.
- Airports: circle markers, radius scaled by visit count (4–14px), fill `--airport`,
  1px `--bg` stroke; a small plane/airport glyph at higher zoom. Hover → `--accent` ring.
- Choropleth (country panel): country polygons filled from the sequential ramp, 60% opacity,
  above land/below labels.
- Globe ↔ flat toggle uses MapLibre projection.

---

## 10. Accessibility & states

- Contrast ≥ 4.5:1 for text on its surface (palette is tuned for this).
- Every interactive element: visible focus ring (`--accent`, 2px, offset 2px), keyboard
  operable, `aria-*` roles (tablist/radiogroup/dialog).
- Loading: skeleton shimmer in `--surface-2`→`--surface-3`. Empty: muted one-liner + hint.
- Hit targets ≥ 32px. Reduced-motion honored (§5).

---

## 11. Implementation rules

- Tokens only — components never hardcode hex/px outside the scale. Tailwind theme maps to
  the CSS vars; arbitrary values are a smell.
- One component = one file in `src/components/ui/` (leaf) or `src/features/*` (composed).
- Color-by logic, stats math, and formatting are pure functions in `src/lib/` — never
  inline in components.
- Charts (Recharts) inherit tokens via a shared `chartTheme.ts` (grid `--border`, text
  `--ink-muted`, series from the categorical palette, compare series `--secondary`).

import { createClient } from "npm:@supabase/supabase-js@2";

type AirportRow = {
  iata: string;
  icao: string | null;
  name: string;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  boundary_geojson: unknown | null;
};

const DEFAULT_IATAS = ["AAA", "AAB", "AAC", "AAD", "AAE", "AAF", "AAH", "AAI", "SFO"];
const DEFAULT_OUTPUT = "supabase/scripts/logs/airport-boundary-inspection.html";

const args = parseArgs(Deno.args);
const supabase = createAdminClient();
await ensureDirectory(args.output);

const { data, error } = await supabase
  .from("airports")
  .select("iata, icao, name, city, country, latitude, longitude, boundary_geojson")
  .in("iata", args.iatas)
  .order("iata", { ascending: true });

if (error) {
  throw new Error(`Failed to load airport boundaries: ${error.message}`);
}

const rows = ((data ?? []) as AirportRow[]).map((row) => ({
  ...row,
  has_boundary: row.boundary_geojson !== null,
}));

const missing = args.iatas.filter((iata) => !rows.some((row) => row.iata === iata));
const html = renderHtml(rows, missing);
await Deno.writeTextFile(args.output, html);

console.log(JSON.stringify({
  ok: true,
  output: args.output,
  requested_iatas: args.iatas,
  rows_found: rows.length,
  rows_with_boundary: rows.filter((row) => row.has_boundary).length,
  missing_iatas: missing,
}, null, 2));

function createAdminClient() {
  const url = getRequiredEnv("SUPABASE_URL");
  const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function parseArgs(rawArgs: string[]) {
  let output = DEFAULT_OUTPUT;
  let iatas = [...DEFAULT_IATAS];

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    const next = rawArgs[index + 1];

    switch (arg) {
      case "--output":
        if (!next?.trim()) {
          throw new Error("--output expects a path");
        }
        output = next.trim();
        index += 1;
        break;
      case "--iatas":
        if (!next?.trim()) {
          throw new Error("--iatas expects a comma-separated list");
        }
        iatas = next.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
        index += 1;
        break;
      case "--help":
        printHelpAndExit();
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (iatas.length === 0) {
    throw new Error("At least one IATA is required");
  }

  return { iatas, output };
}

function printHelpAndExit(): never {
  console.log(`
Usage:
  deno run --allow-net --allow-read --allow-write --allow-env supabase/scripts/generate-airport-boundary-inspection.ts [options]

Required env:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Options:
  --iatas <list>   Comma-separated list of IATA codes
  --output <path>  Output HTML path
  --help           Show this message
`);
  Deno.exit(0);
}

function renderHtml(rows: Array<AirportRow & { has_boundary: boolean }>, missing: string[]) {
  const payload = JSON.stringify({ rows, missing });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Airport Boundary Inspection</title>
    <link
      rel="stylesheet"
      href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
      crossorigin=""
    />
    <style>
      :root {
        color-scheme: light;
        --bg: #f7f3eb;
        --panel: rgba(255, 252, 245, 0.92);
        --ink: #1b1a17;
        --muted: #5f5a51;
        --border: rgba(27, 26, 23, 0.12);
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(210, 184, 145, 0.24), transparent 28%),
          linear-gradient(180deg, #f6f0e5 0%, #efe7d8 100%);
      }

      .layout {
        display: grid;
        grid-template-columns: 360px 1fr 420px;
        min-height: 100vh;
      }

      .sidebar {
        padding: 24px;
        background: var(--panel);
        border-right: 1px solid var(--border);
        overflow: auto;
        backdrop-filter: blur(12px);
      }

      h1 {
        margin: 0 0 8px;
        font-size: 28px;
        line-height: 1.1;
      }

      p {
        margin: 0 0 18px;
        color: var(--muted);
      }

      #map {
        min-height: 100vh;
        background: #d9d4c8;
      }

      .inspector {
        padding: 24px;
        background: rgba(248, 244, 236, 0.92);
        border-left: 1px solid var(--border);
        overflow: auto;
        backdrop-filter: blur(12px);
      }

      .airport {
        display: block;
        width: 100%;
        padding: 14px 0;
        border-top: 1px solid var(--border);
        background: transparent;
        border-left: 0;
        border-right: 0;
        border-bottom: 0;
        text-align: left;
        cursor: pointer;
      }

      .airport:hover {
        opacity: 0.82;
      }

      .airport.is-active {
        padding-left: 10px;
        border-left: 3px solid currentColor;
      }

      .airport:first-of-type {
        border-top: 0;
      }

      .airport strong {
        display: inline-block;
        margin-bottom: 4px;
        font-size: 16px;
      }

      .meta {
        margin: 2px 0;
        font-size: 14px;
        color: var(--muted);
      }

      .chip {
        display: inline-block;
        margin-top: 8px;
        padding: 3px 8px;
        border-radius: 999px;
        font-size: 12px;
        letter-spacing: 0.02em;
        background: rgba(27, 26, 23, 0.07);
      }

      .missing {
        margin-top: 18px;
        padding-top: 18px;
        border-top: 1px solid var(--border);
      }

      .hint {
        margin-top: 12px;
        font-size: 13px;
        color: var(--muted);
      }

      pre {
        margin: 12px 0 0;
        padding: 14px;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: rgba(27, 26, 23, 0.04);
        color: var(--ink);
        overflow: auto;
        font-size: 12px;
        line-height: 1.45;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .leaflet-tile-pane {
        filter: grayscale(1) brightness(0.58) contrast(0.82) saturate(0.2);
        opacity: 0.52;
      }

      .leaflet-overlay-pane svg {
        filter: drop-shadow(0 0 10px rgba(0, 0, 0, 0.28));
      }

      @media (max-width: 900px) {
        .layout {
          grid-template-columns: 1fr;
        }

        .sidebar {
          border-right: 0;
          border-bottom: 1px solid var(--border);
        }

        .inspector {
          border-left: 0;
          border-top: 1px solid var(--border);
        }

        #map {
          min-height: 70vh;
        }
      }
    </style>
  </head>
  <body>
    <div class="layout">
      <aside class="sidebar">
        <h1>Airport Boundary Inspection</h1>
        <p>Plotted from the current rows in <code>public.airports.boundary_geojson</code>.</p>
        <div class="hint">Click an airport in the sidebar to jump to its marker or boundary.</div>
        <div id="summary"></div>
      </aside>
      <main id="map"></main>
      <aside class="inspector">
        <h1>GeoJSON</h1>
        <p>Raw stored boundary payload for the selected airport.</p>
        <div id="inspector-meta" class="meta">Select an airport.</div>
        <pre id="inspector-json">No airport selected.</pre>
      </aside>
    </div>

    <script
      src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
      integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="
      crossorigin=""
    ></script>
    <script>
      const payload = ${payload};
      const colors = ["#b23a48", "#3d5a80", "#2a9d8f", "#f4a261", "#6d597a", "#264653", "#8d6a9f", "#9c6644", "#577590"];

      const map = L.map("map", { preferCanvas: true });
      map.createPane("debugBounds");
      map.getPane("debugBounds").style.zIndex = "650";
      map.createPane("airportBoundaries");
      map.getPane("airportBoundaries").style.zIndex = "660";
      map.createPane("airportMarkers");
      map.getPane("airportMarkers").style.zIndex = "670";

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);

      const bounds = [];
      const summary = document.getElementById("summary");
      const inspectorMeta = document.getElementById("inspector-meta");
      const inspectorJson = document.getElementById("inspector-json");
      const airportLayers = new Map();
      const airportMarkers = new Map();
      const airportDebugBounds = new Map();
      const airportRows = new Map(payload.rows.map((row) => [row.iata, row]));

      summary.innerHTML = payload.rows.map((row, index) => {
        const color = colors[index % colors.length];
        return \`
          <button class="airport" data-iata="\${row.iata}" style="color: \${color}">
            <strong style="color: \${color}">\${row.iata}</strong>
            <div class="meta">\${row.name}</div>
            <div class="meta">\${row.city ?? "Unknown city"}, \${row.country ?? "Unknown country"}</div>
            <div class="meta">ICAO: \${row.icao ?? "None"}</div>
            <div class="chip">\${row.has_boundary ? "Boundary present" : "Boundary missing"}</div>
          </button>
        \`;
      }).join("");

      if (payload.missing.length > 0) {
        summary.innerHTML += \`
          <section class="missing">
            <strong>Requested but not found</strong>
            <div class="meta">\${payload.missing.join(", ")}</div>
          </section>
        \`;
      }

      payload.rows.forEach((row, index) => {
        const color = colors[index % colors.length];

        const geometry = normalizeGeoJson(row.boundary_geojson);

        if (geometry) {
          const layer = L.geoJSON(geometry, {
            pane: "airportBoundaries",
            style: {
              color,
              weight: 6,
              fillColor: color,
              fillOpacity: 0.5,
              opacity: 1,
              dashArray: "10 6",
            },
          }).addTo(map);

          layer.bindPopup(\`<strong>\${row.iata}</strong><br />\${row.name}<br />\${row.city ?? "Unknown city"}, \${row.country ?? "Unknown country"}\`);
          const layerBounds = layer.getBounds();
          if (layerBounds.isValid()) {
            bounds.push(layerBounds);

            const debugBounds = L.rectangle(layerBounds, {
              pane: "debugBounds",
              color: "#ffffff",
              weight: 2,
              opacity: 0.95,
              fill: false,
              dashArray: "6 6",
            }).addTo(map);

            airportDebugBounds.set(row.iata, debugBounds);
          }

          airportLayers.set(row.iata, layer);
        }

        if (row.latitude !== null && row.longitude !== null) {
          const marker = L.circleMarker([row.latitude, row.longitude], {
            pane: "airportMarkers",
            radius: 8,
            color: "#ffffff",
            fillColor: color,
            fillOpacity: 1,
            weight: 3,
          }).addTo(map);

          marker.bindTooltip(row.iata, { permanent: true, direction: "top", offset: [0, -6] });
          marker.bindPopup(\`<strong>\${row.iata}</strong><br />\${row.name}<br />\${row.city ?? "Unknown city"}, \${row.country ?? "Unknown country"}\`);
          airportMarkers.set(row.iata, marker);
        }
      });

      const sidebarItems = Array.from(document.querySelectorAll(".airport"));

      function setActive(iata) {
        sidebarItems.forEach((item) => {
          item.classList.toggle("is-active", item.dataset.iata === iata);
        });
      }

      function updateInspector(iata) {
        const row = airportRows.get(iata);
        if (!row) {
          inspectorMeta.textContent = "Airport not found.";
          inspectorJson.textContent = "No row found.";
          return;
        }

        const geometry = normalizeGeoJson(row.boundary_geojson);
        inspectorMeta.textContent =
          geometry
            ? \`\${row.iata} • boundary present • \${geometry.type}\`
            : \`\${row.iata} • boundary missing\`;

        inspectorJson.textContent = geometry
          ? JSON.stringify(geometry, null, 2)
          : "null";
      }

      function focusAirport(iata) {
        const layer = airportLayers.get(iata);
        const marker = airportMarkers.get(iata);

        setActive(iata);
        updateInspector(iata);

        if (layer) {
          layer.setStyle({
            weight: 8,
            fillOpacity: 0.62,
            opacity: 1,
          });

          airportLayers.forEach((otherLayer, otherIata) => {
            if (otherIata !== iata) {
              otherLayer.setStyle({
                weight: 4,
                fillOpacity: 0.22,
                opacity: 0.78,
              });
            }
          });

          airportDebugBounds.forEach((debugLayer, otherIata) => {
            debugLayer.setStyle({
              opacity: otherIata === iata ? 0.95 : 0.18,
            });
          });

          const layerBounds = layer.getBounds();
          if (layerBounds.isValid()) {
            map.fitBounds(layerBounds.pad(0.2));
          }
          layer.openPopup();
        } else if (marker) {
          airportDebugBounds.forEach((debugLayer) => {
            debugLayer.setStyle({ opacity: 0.18 });
          });
          map.setView(marker.getLatLng(), 12);
          marker.openPopup();
        }

        airportMarkers.forEach((otherMarker, otherIata) => {
          otherMarker.setStyle({
            radius: otherIata === iata ? 11 : 6,
            weight: otherIata === iata ? 4 : 2,
            fillOpacity: otherIata === iata ? 1 : 0.72,
          });
        });
      }

      sidebarItems.forEach((item) => {
        item.addEventListener("click", () => focusAirport(item.dataset.iata));
      });

      if (bounds.length > 0) {
        const group = L.featureGroup(bounds.map((bound) => L.rectangle(bound))).getBounds();
        map.fitBounds(group.pad(0.1));
      } else {
        map.setView([20, 0], 2);
      }

      const initialRow = payload.rows.find((row) => row.has_boundary) ?? payload.rows[0];
      if (initialRow) {
        focusAirport(initialRow.iata);
      }

      function normalizeGeoJson(value) {
        if (!value) {
          return null;
        }

        let parsed = value;
        if (typeof parsed === "string") {
          try {
            parsed = JSON.parse(parsed);
          } catch {
            return null;
          }
        }

        if (!parsed || typeof parsed !== "object") {
          return null;
        }

        if (parsed.type === "Feature") {
          return parsed;
        }

        if (parsed.type === "FeatureCollection") {
          return parsed;
        }

        if (parsed.type === "Polygon" || parsed.type === "MultiPolygon") {
          return {
            type: "Feature",
            properties: {},
            geometry: parsed,
          };
        }

        return null;
      }
    </script>
  </body>
</html>`;
}

async function ensureDirectory(path: string) {
  const directory = dirname(path);
  if (!directory || directory === ".") {
    return;
  }

  await Deno.mkdir(directory, { recursive: true });
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) {
    return ".";
  }
  if (lastSlash === 0) {
    return "/";
  }
  return normalized.slice(0, lastSlash);
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

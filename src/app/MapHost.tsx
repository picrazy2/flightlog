import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import maplibregl from "maplibre-gl";
import { DARK_STYLE } from "@/map/darkStyle";
import { computeInitialView } from "@/map/initialView";
import { buildFeatures } from "@/map/features";
import { useStore } from "@/state/store";
import { useFlights } from "@/data/useFlights";
import { useFlightTracks } from "@/data/useFlightTracks";
import { useAirportBoundaries } from "@/data/useAirportBoundaries";
import { AirportPopupChart } from "./AirportPopupChart";
import { FlightPopup } from "./FlightPopup";
import { RouteAggPopup } from "./RouteAggPopup";
import { routeKeyUndirected } from "@/lib/geo";
import type { StatContext, MapEncoding } from "@/stats/types";
import { defaultEncodingModule } from "@/stats/registry";
import { geoFilterFillColors } from "@/stats/modules/continents";

const COUNTRIES_URL = `${import.meta.env.BASE_URL}world-countries.geojson`;
const ICON_BASE = `${import.meta.env.BASE_URL}icons`;

// Inline recolorable icon (CSS mask) for the raw-HTML hover popups.
function iconHtml(name: string, color: string, size = 13) {
  // single quotes inside url() — this string lives in a style="…" attribute, so double
  // quotes here would close the attribute early and break the mask
  const url = `url('${ICON_BASE}/${name}.png')`;
  return `<span style="display:inline-block;width:${size}px;height:${size}px;vertical-align:-2px;background-color:${color};-webkit-mask-image:${url};mask-image:${url};-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;-webkit-mask-size:contain;mask-size:contain"></span>`;
}

// Switch a popup's tint class (airport = accent, route = secondary).
function tint(popup: maplibregl.Popup, kind: "airport" | "route") {
  popup.removeClassName("popup-airport");
  popup.removeClassName("popup-route");
  popup.addClassName(`popup-${kind}`);
}

interface Props {
  ctx: StatContext;
  encoding: MapEncoding | undefined;
  isMobile?: boolean;
}

export function MapHost({ ctx, encoding, isMobile }: Props) {
  const isMobileRef = useRef(isMobile);
  isMobileRef.current = isMobile;
  const restoreHighlightRef = useRef<(() => void) | null>(null);
  const mapSelection = useStore((s) => s.mapSelection);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false); // reactive mirror of readyRef so style effects re-run once layers exist
  const choroAddedRef = useRef(false);
  const hoverPopup = useRef<maplibregl.Popup | null>(null);
  const clickPopup = useRef<maplibregl.Popup | null>(null);
  const popupRoot = useRef<Root | null>(null);
  const showFlightRef = useRef<((flightId: string) => void) | null>(null);
  const projection = useStore((s) => s.projection);
  const crossFilters = useStore((s) => s.crossFilters);
  const showAirports = useStore((s) => s.showAirports);
  const showTracks = useStore((s) => s.settings.showTracks);
  const markEstimated = useStore((s) => s.settings.markEstimated);
  const tracks = useFlightTracks().data;
  // Grey trackless routes only when a real (non-default) colour mode is active. Modules
  // without their own map encoding fall back to the default (dom/intl) encoding, which is
  // knowable without a track — so don't grey those.
  const dimTrackless = showTracks && encoding !== defaultEncodingModule.map;
  // All airports the user has ever touched (stable, unfiltered) → fetch footprints once.
  const allFlights = useFlights().data;
  const allIatas = allFlights
    ? [...new Set(allFlights.flatMap((f) => [f.dep_iata, f.arr_iata]))]
    : [];
  const boundaries = useAirportBoundaries(allIatas);
  // Latest ctx for event handlers bound once on map load.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  // init once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    // open per the viewport aspect ratio (flat fitted to the world width, or globe)
    const view = computeInitialView(
      containerRef.current.clientWidth || window.innerWidth,
      containerRef.current.clientHeight || window.innerHeight,
      ctxRef.current,
    );
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_STYLE,
      center: view.center,
      zoom: view.zoom,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    hoverPopup.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
    // closeOnClick:false so clicking another feature SWITCHES the popup instead of
    // the map-click first closing it.
    clickPopup.current = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 10, maxWidth: "320px" });

    map.on("load", () => {
      map.addSource("routes", { type: "geojson", data: emptyFC() });
      map.addSource("airports", { type: "geojson", data: emptyFC() });
      map.addSource("airport-boundaries", { type: "geojson", data: emptyFC() });

      // Airport footprints — only when zoomed in, subtle accent fill + outline.
      map.addLayer({
        id: "airport-fill",
        type: "fill",
        source: "airport-boundaries",
        minzoom: 8,
        paint: {
          "fill-color": "#5B9DFF",
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0, 8, 0.2],
        },
      });
      map.addLayer({
        id: "airport-outline",
        type: "line",
        source: "airport-boundaries",
        minzoom: 4,
        paint: {
          "line-color": "#5B9DFF",
          "line-width": 1,
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0, 8, 0.7],
        },
      });

      // real (actual track) line segments — solid
      map.addLayer({
        id: "routes",
        type: "line",
        source: "routes",
        filter: ["!=", ["get", "estimated"], true],
        layout: { "line-cap": "round" },
        paint: { "line-color": ["get", "color"], "line-width": ["get", "width"], "line-opacity": 0.85 },
      });
      // estimated segments (great-circle: trackless flights, future flights, gap/airport
      // fillers) — dashed+thin only when "Est." is on
      map.addLayer({
        id: "routes-estimated",
        type: "line",
        source: "routes",
        filter: ["==", ["get", "estimated"], true],
        layout: { "line-cap": "round" },
        paint: { "line-color": ["get", "color"], "line-width": ["get", "width"], "line-opacity": 0.85 },
      });
      // transparent wide layer purely for a bigger hover/click target on thin/dashed lines
      map.addLayer({
        id: "routes-hit",
        type: "line",
        source: "routes",
        layout: { "line-cap": "round" },
        paint: { "line-color": "#000000", "line-opacity": 0, "line-width": 12 },
      });
      // Airport markers use the plane icon (loaded as SDF so it recolors per panel).
      // plane.png is full-color → build a white plane with a black outline on a
      // canvas (recolored silhouette + offset black copies as a stroke).
      const planeImg = new Image();
      planeImg.onload = () => {
        const W = planeImg.width;
        const silhouette = (col: string) => {
          const c = document.createElement("canvas");
          c.width = W;
          c.height = W;
          const x = c.getContext("2d")!;
          x.drawImage(planeImg, 0, 0);
          x.globalCompositeOperation = "source-in";
          x.fillStyle = col;
          x.fillRect(0, 0, W, W);
          return c;
        };
        const black = silhouette("#000000");
        const white = silhouette("#ffffff");
        const out = document.createElement("canvas");
        out.width = W;
        out.height = W;
        const ox = out.getContext("2d")!;
        const stroke = W * 0.03;
        for (let a = 0; a < 360; a += 30) {
          ox.drawImage(black, Math.cos((a * Math.PI) / 180) * stroke, Math.sin((a * Math.PI) / 180) * stroke);
        }
        ox.drawImage(white, 0, 0);
        const id = ox.getImageData(0, 0, W, W);
        if (!map.hasImage("plane-icon")) {
          map.addImage("plane-icon", { width: id.width, height: id.height, data: new Uint8Array(id.data) });
        }
        if (!map.getLayer("airports")) {
          map.addLayer({
            id: "airports",
            type: "symbol",
            source: "airports",
            layout: {
              "icon-image": "plane-icon",
              // size by visits (√-scaled), shrunk at very low zoom. Zoom must be the
              // top-level interpolate input; per-feature size goes in the outputs.
              "icon-size": [
                "interpolate",
                ["linear"],
                ["zoom"],
                1,
                ["/", ["*", ["get", "r"], 1.08], W],
                4,
                ["/", ["*", ["get", "r"], 2.4], W],
              ],
              "icon-rotate": -45, // CCW 45°
              "icon-rotation-alignment": "viewport",
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
            },
            paint: { "icon-opacity": 0.95 },
          });
        }
      };
      planeImg.src = `${import.meta.env.BASE_URL}icons/plane.png`;

      readyRef.current = true;
      setReady(true);
      map.setProjection({ type: view.projection });
      if (useStore.getState().projection !== view.projection) useStore.setState({ projection: view.projection });
      pushData();

      // publish bearing/pitch so the reset-north button can show + reflect the heading
      const syncOrient = () => useStore.getState().setMapView(map.getBearing(), map.getPitch());
      map.on("rotate", syncOrient);
      map.on("pitch", syncOrient);
      map.on("moveend", syncOrient);
      syncOrient();

      // hover popups
      map.on("mousemove", "airports", (e) => {
        if (isMobileRef.current) return; // no hover popups on touch
        map.getCanvas().style.cursor = "pointer";
        const p = e.features?.[0]?.properties as Record<string, unknown> | undefined;
        if (!p) return;
        tint(hoverPopup.current!, "airport");
        hoverPopup.current!
          .setLngLat(e.lngLat)
          .setHTML(
            `<div style="font-size:12px">${iconHtml("plane", "#5B9DFF")} <b>${p.iata}</b> ${p.city ?? ""}<br/><span style="color:var(--ink-muted)">${p.visits} visits</span></div>`,
          )
          .addTo(map);
      });
      map.on("mouseleave", "airports", () => {
        map.getCanvas().style.cursor = "";
        hoverPopup.current!.remove();
      });
      const routeHover = (e: maplibregl.MapLayerMouseEvent) => {
        if (isMobileRef.current) return; // no hover popups on touch
        // airports win: if one is under the cursor, let its handler show the popup
        if (map.queryRenderedFeatures(e.point, { layers: ["airports"] }).length) return;
        // prefer the wide multi-flight great-circle if one is under the cursor
        const feats = map.queryRenderedFeatures(e.point, { layers: ["routes-hit"] });
        const aggFeat = feats.find((ff) => Number(ff.properties?.rc) > 1);
        const p = (aggFeat ?? e.features?.[0])?.properties as Record<string, unknown> | undefined;
        if (!p) return;
        const rc = Number(p.rc);
        const sub = rc > 1 ? `${rc} flights` : String(p.date ?? "");
        map.getCanvas().style.cursor = "pointer";
        tint(hoverPopup.current!, "route");
        hoverPopup.current!
          .setLngLat(e.lngLat)
          .setHTML(`<div style="font-size:12px">${iconHtml("route", "#FFC061")} <b>${p.dep} → ${p.arr}</b><br/><span style="color:var(--ink-muted)">${sub}</span></div>`)
          .addTo(map);
      };
      const routeLeave = () => {
        map.getCanvas().style.cursor = "";
        hoverPopup.current!.remove();
      };
      map.on("mousemove", "routes-hit", routeHover);
      map.on("mouseleave", "routes-hit", routeLeave);
      // React-rendered click popups (chart >5 flights / table ≤5)
      const yearSpan = () => {
        const fs = ctxRef.current.flights;
        if (!fs.length) return [];
        let lo = 9999, hi = 0;
        for (const f of fs) {
          const y = Number(f.flight_date.slice(0, 4));
          if (y < lo) lo = y;
          if (y > hi) hi = y;
        }
        return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
      };
      const showReactPopup = (lngLat: maplibregl.LngLatLike, kind: "airport" | "route", node: React.ReactNode) => {
        popupRoot.current?.unmount();
        const div = document.createElement("div");
        popupRoot.current = createRoot(div);
        popupRoot.current.render(node);
        tint(clickPopup.current!, kind);
        clickPopup.current!.setLngLat(lngLat).setDOMContent(div).addTo(map);
      };

      // when a popup is open, dim everything except the selected airport/route — but
      // keep a route's two endpoint airports lit, and an airport's to/from routes lit.
      const expr = (e: unknown) => e as unknown as maplibregl.ExpressionSpecification;
      type HL =
        | { kind: "route"; field: string; id: string; dep: string; arr: string }
        | { kind: "airport"; iata: string };
      const setHighlight = (hl: HL) => {
        // route lines
        const lineOpacity = expr(
          hl.kind === "route"
            ? ["case", ["==", ["get", hl.field], hl.id], 0.95, 0.08]
            // airport: keep routes that touch this airport
            : ["case", ["any", ["==", ["get", "dep"], hl.iata], ["==", ["get", "arr"], hl.iata]], 0.9, 0.08],
        );
        for (const layer of ["routes", "routes-estimated"]) {
          if (map.getLayer(layer)) map.setPaintProperty(layer, "line-opacity", lineOpacity);
        }
        // airport markers
        if (map.getLayer("airports")) {
          const iconOpacity = expr(
            hl.kind === "airport"
              ? ["case", ["==", ["get", "iata"], hl.iata], 1, 0.12]
              // route: keep the two endpoint airports
              : ["case", ["in", ["get", "iata"], ["literal", [hl.dep, hl.arr]]], 1, 0.12],
          );
          map.setPaintProperty("airports", "icon-opacity", iconOpacity);
        }
      };
      const restoreHighlight = () => {
        if (map.getLayer("routes")) map.setPaintProperty("routes", "line-opacity", 0.85);
        if (map.getLayer("routes-estimated")) map.setPaintProperty("routes-estimated", "line-opacity", 0.85);
        if (map.getLayer("airports")) map.setPaintProperty("airports", "icon-opacity", 0.95);
      };
      restoreHighlightRef.current = restoreHighlight;
      clickPopup.current!.on("close", restoreHighlight);

      // search-by-flight-number → open this flight's popup (instead of cross-filtering).
      // Fits the route, highlights it, and shows the FlightPopup at the route midpoint.
      showFlightRef.current = (flightId: string) => {
        const flight = ctxRef.current.flights.find((x) => x.id === flightId);
        if (!flight) return;
        const dLng = flight.dep_lng, dLat = flight.dep_lat, aLng = flight.arr_lng, aLat = flight.arr_lat;
        const mid: [number, number] =
          dLng != null && aLng != null ? [(dLng + aLng) / 2, ((dLat ?? 0) + (aLat ?? 0)) / 2] : [aLng ?? dLng ?? 0, aLat ?? dLat ?? 0];
        if (isMobileRef.current) {
          if (dLng != null) map.flyTo({ center: mid, zoom: 3.5, duration: 700 });
          useStore.getState().setMapSelection({ kind: "flight", flightId: flight.id });
          return;
        }
        try {
          if (dLng != null && aLng != null) {
            map.fitBounds(
              [[Math.min(dLng, aLng), Math.min(dLat ?? 0, aLat ?? 0)], [Math.max(dLng, aLng), Math.max(dLat ?? 0, aLat ?? 0)]],
              { padding: 140, duration: 700, maxZoom: 6 },
            );
          } else if (dLng != null || aLng != null) {
            map.flyTo({ center: mid, zoom: 4, duration: 700 });
          }
        } catch {
          map.flyTo({ center: mid, zoom: 3.5, duration: 700 });
        }
        setHighlight({ kind: "route", field: "fid", id: flight.id, dep: flight.dep_iata, arr: flight.arr_iata });
        showReactPopup(mid, "route", <FlightPopup flight={flight} settings={ctxRef.current.settings} />);
      };

      map.on("click", "airports", (e) => {
        const p = e.features?.[0]?.properties as Record<string, unknown> | undefined;
        if (!p) return;
        if (isMobileRef.current) {
          useStore.getState().setMapSelection({ kind: "airport", iata: String(p.iata), name: String(p.name), city: String(p.city), visits: Number(p.visits) });
          setHighlight({ kind: "airport", iata: String(p.iata) });
          return;
        }
        showReactPopup(
          e.lngLat,
          "airport",
          <AirportPopupChart
            flights={ctxRef.current.flights}
            iata={String(p.iata)}
            name={String(p.name)}
            city={String(p.city)}
            visits={Number(p.visits)}
            years={yearSpan()}
          />,
        );
        setHighlight({ kind: "airport", iata: String(p.iata) });
      });

      const routeClick = (e: maplibregl.MapLayerMouseEvent) => {
        if (map.queryRenderedFeatures(e.point, { layers: ["airports"] }).length) return; // airports win
        // a single flight's track can render on top of a wide multi-flight great-circle;
        // prefer the aggregate feature when one is under the cursor
        const feats = map.queryRenderedFeatures(e.point, { layers: ["routes-hit"] });
        const aggFeat = feats.find((ff) => Number(ff.properties?.rc) > 1);
        const p = (aggFeat ?? feats[0])?.properties as Record<string, unknown> | undefined;
        if (!p) return;
        // multiple untracked flights overlap here → summarise the whole route
        if (Number(p.rc) > 1) {
          const rk = String(p.rk);
          const flights = ctxRef.current.flights.filter((x) => routeKeyUndirected(x.dep_iata, x.arr_iata) === rk);
          if (!flights.length) return;
          setHighlight({ kind: "route", field: "rk", id: rk, dep: String(p.dep), arr: String(p.arr) });
          if (isMobileRef.current) {
            useStore.getState().setMapSelection({ kind: "routeAgg", rk, dep: String(p.dep), arr: String(p.arr) });
            return;
          }
          showReactPopup(
            e.lngLat,
            "route",
            <RouteAggPopup flights={flights} dep={String(p.dep)} arr={String(p.arr)} settings={ctxRef.current.settings} />,
          );
          return;
        }
        const flight = ctxRef.current.flights.find((x) => x.id === String(p.fid));
        if (!flight) return;
        setHighlight({ kind: "route", field: "fid", id: String(p.fid), dep: String(p.dep), arr: String(p.arr) });
        if (isMobileRef.current) {
          useStore.getState().setMapSelection({ kind: "flight", flightId: flight.id });
          return;
        }
        showReactPopup(e.lngLat, "route", <FlightPopup flight={flight} settings={ctxRef.current.settings} />);
      };
      map.on("click", "routes-hit", routeClick);

      // clicking empty map (no airport/route under cursor) closes the popup; clicking
      // another feature is handled above and switches it instead
      map.on("click", (e) => {
        const layers = ["airports", "routes-hit"].filter((l) => map.getLayer(l));
        if (map.queryRenderedFeatures(e.point, { layers }).length === 0) {
          if (isMobileRef.current) useStore.getState().setMapSelection(null);
          else clickPopup.current?.remove();
        }
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // push data whenever ctx/encoding/tracks/legend change
  useEffect(() => {
    pushData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, encoding, showTracks, tracks, dimTrackless, crossFilters]);

  // airport footprints (loaded once, async)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !boundaries.data) return;
    (map.getSource("airport-boundaries") as maplibregl.GeoJSONSource | undefined)?.setData(boundaries.data);
  }, [boundaries.data]);

  // globe ↔ flat projection
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setProjection({ type: projection });
  }, [projection, ready]);

  // dash + thin the estimated (great-circle / filler) segments only when tracks + "Est."
  // are both on; otherwise they render solid like everything else
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getLayer("routes-estimated")) return;
    const dash = showTracks && markEstimated;
    map.setPaintProperty("routes-estimated", "line-dasharray", dash ? [1.5, 1.5] : [1, 0]);
    // when dashed, thin the lines but keep them proportional so a multi-flight
    // great-circle (wider) stays visibly wider than a single one / gap filler
    map.setPaintProperty(
      "routes-estimated",
      "line-width",
      (dash ? ["*", ["get", "width"], 0.6] : ["get", "width"]) as unknown as maplibregl.ExpressionSpecification,
    );
  }, [markEstimated, showTracks, ready]);

  // airport marker visibility (legend toggle)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getLayer("airports")) return;
    map.setLayoutProperty("airports", "visibility", showAirports ? "visible" : "none");
  }, [showAirports, ready]);

  // mobile: restore the dimmed map when the popup drawer's selection is cleared
  useEffect(() => {
    if (isMobile && !mapSelection) restoreHighlightRef.current?.();
  }, [isMobile, mapSelection, ready]);

  // search box → fly/fit
  useEffect(() => {
    const fly = (e: Event) => {
      const d = (e as CustomEvent).detail as { lng: number; lat: number; zoom?: number };
      mapRef.current?.flyTo({ center: [d.lng, d.lat], zoom: d.zoom ?? 5, duration: 800 });
    };
    const fit = (e: Event) => {
      const d = (e as CustomEvent).detail as { bounds: [[number, number], [number, number]] };
      mapRef.current?.fitBounds(d.bounds, { padding: 120, duration: 800, maxZoom: 6 });
    };
    const showFlight = (e: Event) => {
      const d = (e as CustomEvent).detail as { flightId: string };
      showFlightRef.current?.(d.flightId);
    };
    // dismiss any open popup + undim before a new search action takes effect, so the
    // previous selection's highlight doesn't linger over the new one
    const closePopup = () => {
      clickPopup.current?.remove(); // fires 'close' → restoreHighlight
      if (isMobileRef.current) useStore.getState().setMapSelection(null);
      else restoreHighlightRef.current?.();
    };
    // reset-north button → face north (bearing 0) and drop the tilt to 2D (pitch 0);
    // projection (globe vs flat) is left untouched
    const resetNorth = () => mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 400 });
    window.addEventListener("journia:flyto", fly);
    window.addEventListener("journia:fit", fit);
    window.addEventListener("journia:showflight", showFlight as EventListener);
    window.addEventListener("journia:closepopup", closePopup);
    window.addEventListener("journia:resetnorth", resetNorth);
    return () => {
      window.removeEventListener("journia:flyto", fly);
      window.removeEventListener("journia:fit", fit);
      window.removeEventListener("journia:showflight", showFlight as EventListener);
      window.removeEventListener("journia:closepopup", closePopup);
      window.removeEventListener("journia:resetnorth", resetNorth);
    };
  }, []);

  function pushData() {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const { routes, airports } = buildFeatures(ctx, encoding, { showTracks, tracks, dimTrackless });
    (map.getSource("routes") as maplibregl.GeoJSONSource | undefined)?.setData(routes);
    (map.getSource("airports") as maplibregl.GeoJSONSource | undefined)?.setData(airports);
    if (boundaries.data) {
      (map.getSource("airport-boundaries") as maplibregl.GeoJSONSource | undefined)?.setData(boundaries.data);
    }
    updateChoropleth(map);
  }

  // Lazily add the country polygons + fill layer the first time a module asks for the
  // choropleth, then drive its colors with a data-driven match expression.
  function updateChoropleth(map: maplibregl.Map) {
    // An active geo cross-filter (country / region / continent) tints its countries on
    // the map, taking priority over (and working without) a module's own choropleth.
    const geo = geoFilterFillColors(crossFilters);
    const moduleChoro = encoding?.layers?.includes("choropleth") ? encoding.choropleth : undefined;
    if (geo.size === 0 && !moduleChoro) {
      if (choroAddedRef.current) map.setLayoutProperty("choropleth", "visibility", "none");
      return;
    }
    if (!choroAddedRef.current) {
      map.addSource("countries", { type: "geojson", data: COUNTRIES_URL });
      map.addLayer(
        {
          id: "choropleth",
          type: "fill",
          source: "countries",
          paint: { "fill-color": "rgba(0,0,0,0)", "fill-opacity": 0.55 },
        },
        "routes", // beneath route lines
      );
      choroAddedRef.current = true;
    }
    map.setLayoutProperty("choropleth", "visibility", "visible");
    const entries = geo.size > 0 ? [...geo].map(([iso, color]) => ({ iso, color })) : moduleChoro!(ctx);
    const fallback = geo.size > 0 ? "rgba(0,0,0,0)" : "rgba(255,255,255,0.04)"; // only highlight the filtered geography
    const match: (string | string[])[] = ["match", ["get", "ISO_A2"]];
    for (const e of entries) match.push(e.iso, e.color);
    match.push(fallback);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.setPaintProperty("choropleth", "fill-color", match as any);
  }

  return <div ref={containerRef} className="absolute inset-0" />;
}

function emptyFC() {
  return { type: "FeatureCollection" as const, features: [] };
}

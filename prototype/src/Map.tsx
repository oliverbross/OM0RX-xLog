import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import geometryUrl from "../../Sources/XLogCore/Resources/dxcc-boundaries.geojson?url";
import { type Spot } from "./model";
import { acceptanceActive, interiorLandProbe, landPixelMatches } from "./acceptance";
import { bearingAndDistance, grayline, greatCircle, solarPosition, type Coordinate } from "./MapGeography";
import { clusterBandColors, clusterStatusColors, paletteColor } from "./live/clusterPalette";
import "./Map.css";
// MapLibre 6 resolves its default worker relative to import.meta.url. Vite's
// optimized module and packaged bundle do not preserve that adjacent path.
// Emit the standalone worker as a local asset and configure it before any map.
maplibregl.setWorkerUrl(new URL(workerUrl, window.location.href).href);
type MapSpot = Spot & { adif?: number | null; bandHex?: string; statusHex?: string; callStatus?: string };
type MapPoint = { call?: string; lat: number; lon: number; grid?: string; country?: string };
type OverlayMode = "Spots" | "DXCC" | "Both";
type MapAppearance = "Hybrid" | "Satellite" | "Standard";
type MapPreset = "Simple" | "Detailed" | "DX";
type DXCCStatus = "needed" | "worked" | "confirmed";
type GeoJSONGeometry = { type: "MultiPolygon" | "Polygon"; coordinates: number[][][][] | number[][][] };
type DXCCFeature = { properties: { dxcc_entity_code: number; dxcc_name: string | null; dxcc_prefix: string | null }; geometry: GeoJSONGeometry };
const imageryTiles = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/2004-08-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg";
const emptyLines = { type: "FeatureCollection" as const, features: [] };

function lineFeatures(lines: Coordinate[][]) {
  return { type: "FeatureCollection" as const, features: lines.map((line) => ({
    type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: line },
  })) };
}

function representativePoint(feature: DXCCFeature): Coordinate | null {
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates as number[][][]]
    : feature.geometry.coordinates as number[][][][];
  let best: number[][] | null = null;
  let bestArea = 0;
  for (const polygon of polygons) {
    const ring = polygon[0];
    if (!ring?.length) continue;
    let area = 0;
    for (let i = 1; i < ring.length; i++) area += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
    if (Math.abs(area) > bestArea) { bestArea = Math.abs(area); best = ring; }
  }
  if (!best) return null;
  const longitudes = best.map(point => point[0]);
  const latitudes = best.map(point => point[1]);
  return [(Math.min(...longitudes) + Math.max(...longitudes)) / 2,
    (Math.min(...latitudes) + Math.max(...latitudes)) / 2];
}

function shortPrefix(prefix: string | null) {
  return (prefix ?? "").replaceAll("_", "/").split(",", 1)[0].split("-", 1)[0].trim();
}

export default function WorldMap({
  selected,
  onSpot,
  data = [],
  fixture = false,
  home,
  target,
  dxccStatuses,
  palette,
  longPath: initialLongPath = false,
  compact = false,
}: {
  selected: string | null;
  onSpot?: (spot: MapSpot) => void;
  data?: MapSpot[];
  fixture?: boolean;
  home?: MapPoint | null;
  target?: MapPoint | null;
  dxccStatuses?: Record<number, DXCCStatus> | null;
  palette?: { status?: Record<string, string>; band?: Record<string, string> } | null;
  longPath?: boolean;
  compact?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [error, setError] = useState("");
  const [imageryUnavailable, setImageryUnavailable] = useState(false);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>(fixture || acceptanceActive ? "Spots" : "Both");
  const [appearance, setAppearance] = useState<MapAppearance>(fixture || acceptanceActive ? "Standard" : "Hybrid");
  const [preset, setPreset] = useState<MapPreset>(fixture || acceptanceActive ? "Simple" : "Detailed");
  const [showSun, setShowSun] = useState(!(fixture || acceptanceActive));
  const [showGrayline, setShowGrayline] = useState(!(fixture || acceptanceActive));
  const [longPath, setLongPath] = useState(initialLongPath);
  useEffect(() => { setLongPath(initialLongPath); }, [initialLongPath]);
  const [statusFilter, setStatusFilter] = useState<DXCCStatus[]>(["needed", "worked", "confirmed"]);
  const [solarDate, setSolarDate] = useState(() => new Date());
  const callback = useRef(onSpot);
  const selection = useRef(selected);
  const preserveCamera = useRef(Boolean(selected));
  const spotsRef = useRef(data);
  const homeRef = useRef(home);
  const labelsRef = useRef<{ id: number; label: string; name: string; coordinate: Coordinate }[]>([]);
  const markersRef = useRef(new Map<string, maplibregl.Marker>());
  const redrawRef = useRef(() => {});
  const appearanceRef = useRef(appearance);
  const overlayRef = useRef(overlayMode);
  const statusFilterRef = useRef(statusFilter);
  const dxccRef = useRef(dxccStatuses);
  const paletteRef = useRef(palette);
  appearanceRef.current = appearance;
  overlayRef.current = overlayMode;
  statusFilterRef.current = statusFilter;
  dxccRef.current = dxccStatuses;
  paletteRef.current = palette;
  spotsRef.current = data;
  homeRef.current = home;
  callback.current = onSpot;
  selection.current = selected;
  useEffect(() => {
    if (!container.current) return;
    const element = container.current;
    let map: maplibregl.Map;
    let disposed = false;
    let landFeatures = 0;
    let captureRequested = acceptanceActive;
    const redrawLabels = () => {
      if (disposed) return;
      const width = map.getContainer().clientWidth, height = map.getContainer().clientHeight;
      const occupied: { x: number; y: number }[] = [];
      const visible = new Set<string>();
      const displayLabel = (id: string, coordinate: Coordinate, className: string, value: string, title: string, color: string) => {
        visible.add(id);
        let marker = markersRef.current.get(id);
        if (!marker) {
          const element = document.createElement("span");
          element.className = className;
          marker = new maplibregl.Marker({ element, anchor: "left" }).setLngLat(coordinate).addTo(map);
          markersRef.current.set(id, marker);
        }
        const element = marker.getElement();
        if (element.textContent !== value) element.textContent = value;
        if (element.title !== title) element.title = title;
        if (element.style.color !== color) element.style.color = color;
        marker.setLngLat(coordinate);
      };
      if (overlayRef.current !== "Spots") {
        for (const entity of labelsRef.current) {
          const status = dxccRef.current?.[entity.id] ?? "unknown";
          if (status !== "unknown" && !statusFilterRef.current.includes(status)) continue;
          const position = map.project(entity.coordinate);
          if (position.x < 8 || position.x > width - 55 || position.y < 8 || position.y > height - 20) continue;
          if (occupied.some(other => Math.abs(other.x - position.x) < 88 && Math.abs(other.y - position.y) < 26)) continue;
          occupied.push({ x: position.x, y: position.y });
          displayLabel(`dxcc-${entity.id}`, entity.coordinate, "map-dxcc-label", entity.label,
            `${entity.name} · DXCC ${entity.id} · ${status}`,
            status === "unknown" ? "#8fa7c0" :
              status === "needed" ? "#8fb3d9" : status === "worked" ? "#ff9d2e" : "#12d6a0");
        }
      }
      if (overlayRef.current !== "DXCC" && map.getZoom() >= 4) {
        const seen = new Set<string>();
        for (const spot of spotsRef.current) {
          const call = spot.call.trim().toUpperCase();
          if (!call || seen.has(call)) continue;
          seen.add(call);
          const coordinate: Coordinate = [spot.lon, spot.lat];
          const position = map.project(coordinate);
          if (position.x < 8 || position.x > width - 110 || position.y < 8 || position.y > height - 20) continue;
          if (occupied.some(other => Math.abs(other.x - position.x) < 145 && Math.abs(other.y - position.y) < 23)) continue;
          occupied.push({ x: position.x, y: position.y });
          displayLabel(`spot-${call}`, coordinate, "map-spot-label", call,
            `${call} · ${spot.band} · ${spot.mode} · ${spot.callStatus ?? spot.state}`,
            paletteColor(spot.callStatus ?? "Unknown", paletteRef.current?.status, clusterStatusColors));
        }
      }
      for (const [id, marker] of markersRef.current) {
        if (!visible.has(id)) { marker.remove(); markersRef.current.delete(id); }
      }
    };
    redrawRef.current = redrawLabels;
    const repaint = () => {
      if (disposed) return;
      map.resize();
      map.triggerRepaint();
    };
    const requestEvidence = () => {
      if (!acceptanceActive || disposed) return;
      captureRequested = true;
      element.dataset.capturedAt = "0";
      repaint();
    };
    const evidence = () => {
      if (disposed || !acceptanceActive || !captureRequested) return;
      const canvas = map.getCanvas();
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      element.dataset.canvasWidth = String(canvas.width);
      element.dataset.canvasHeight = String(canvas.height);
      element.dataset.webgl = String(Boolean(gl && !gl.isContextLost() && gl.getError() === gl.NO_ERROR));
      element.dataset.landFeatures = String(landFeatures);
      element.dataset.renderedLandFeatures = String(map.isStyleLoaded() ? map.queryRenderedFeatures(undefined, { layers: ["land"] }).length : 0);
      element.dataset.mapLoaded = String(map.isStyleLoaded() && map.isSourceLoaded("land") && landFeatures > 0);
      element.dataset.tilesLoaded = String(map.areTilesLoaded());
      if (!gl || !landFeatures || !map.isStyleLoaded() || !map.isSourceLoaded("land") || !map.areTilesLoaded()) return;
      let probes = 0;
      let matches = 0;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const pixels = new Uint8Array(36);
      const mismatches: { x: number; y: number; rgba: number[] }[] = [];
      const framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // A distributed grid catches missing GPU tiles even when the CPU feature
      // index still contains the complete geography. Only acceptance reads pixels.
      for (let row = 0; row < 16; row++) {
        for (let column = 0; column < 24; column++) {
          const point: [number, number] = [(column + 0.5) * width / 24, (row + 0.5) * height / 16];
          if (!interiorLandProbe(point, (neighbor, layers) => map.queryRenderedFeatures(neighbor, { layers }).length > 0)) continue;
          probes++;
          const x = Math.max(0, Math.min(canvas.width - 3, Math.round(point[0] * canvas.width / width) - 1));
          const y = Math.max(0, Math.min(canvas.height - 3, canvas.height - Math.round(point[1] * canvas.height / height) - 1));
          gl.readPixels(x, y, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          if (landPixelMatches(pixels)) matches++;
          else if (mismatches.length < 4) mismatches.push({ x: point[0], y: point[1], rgba: [...pixels.slice(16, 20)] });
        }
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      element.dataset.landPixelProbes = String(probes);
      element.dataset.matchedLandPixels = String(matches);
      element.dataset.pixelMismatches = JSON.stringify(mismatches);
      element.dataset.webgl = String(!gl.isContextLost() && gl.getError() === gl.NO_ERROR);
      element.dataset.capturedAt = String(Date.now());
      captureRequested = false;
    };
    const fitFixture = () => {
      const station = homeRef.current;
      if (!fixture && station) {
        map.jumpTo({ center: [station.lon, station.lat], zoom: 2.55 });
        return;
      }
      const points = spotsRef.current;
      const bounds: [[number, number], [number, number]] = points.length ?
        [[Math.min(...points.map(s => s.lon)), Math.min(...points.map(s => s.lat))],
         [Math.max(...points.map(s => s.lon)), Math.max(...points.map(s => s.lat))]] : [[-170, -55], [175, 75]];
      map.fitBounds(bounds, {
        padding: { top: 24, right: 48, bottom: 75, left: 24 },
        duration: 0,
        maxZoom: 2,
      });
    };
    try {
      map = new maplibregl.Map({
        container: container.current,
        center: [-15, 38],
        zoom: 1.65,
        attributionControl: false,
        style: {
          version: 8,
          sources: {
            land: { type: "geojson", data: geometryUrl, promoteId: "dxcc_entity_code" },
            imagery: { type: "raster", tiles: [imageryTiles], tileSize: 256, maxzoom: 8,
              attribution: '<a href="https://www.earthdata.nasa.gov/data/visualization/worldview" target="_blank" rel="noopener noreferrer">NASA GIBS Blue Marble</a>' },
            route: { type: "geojson", data: emptyLines },
            grayline: { type: "geojson", data: emptyLines },
            landmarks: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            spots: {
              type: "geojson",
              data: {
                type: "FeatureCollection",
                features: spotsRef.current.map((s) => ({
                  type: "Feature",
                  properties: { id: s.id, state: s.state, bandColor: paletteColor(s.band, paletteRef.current?.band, clusterBandColors) },
                  geometry: { type: "Point", coordinates: [s.lon, s.lat] },
                })),
              },
            },
          },
          layers: [
            {
              id: "ocean",
              type: "background",
              paint: { "background-color": "#123347" },
            },
            { id: "imagery", type: "raster", source: "imagery", layout: { visibility: appearanceRef.current === "Standard" ? "none" : "visible" },
              paint: { "raster-opacity": 0.84, "raster-fade-duration": 0 } },
            {
              id: "land",
              type: "fill",
              source: "land",
              paint: { "fill-color": "#314741", "fill-opacity": appearanceRef.current === "Standard" ? 1 : 0.08 },
            },
            {
              id: "borders",
              type: "line",
              source: "land",
              paint: { "line-color": "#a4b3be", "line-opacity": appearanceRef.current === "Satellite" ? 0 : 0.65, "line-width": 0.7 },
            },
            { id: "dxcc-status", type: "fill", source: "land", paint: {
              "fill-color": ["match", ["feature-state", "status"], "needed", "#8FB3D9", "worked", "#FF9D2E", "confirmed", "#12D6A0", "#61758D"],
              "fill-opacity": 0.12,
            } },
            { id: "grayline-band", type: "line", source: "grayline", paint: { "line-color": "#07111f", "line-opacity": 0.42, "line-width": 30 } },
            { id: "grayline-edge", type: "line", source: "grayline", paint: { "line-color": "#a9b6c8", "line-opacity": 0.78, "line-width": 1.25, "line-dasharray": [4, 5] } },
            { id: "route-line", type: "line", source: "route", paint: { "line-color": "#35c8f5", "line-width": 3, "line-opacity": 0.95, "line-dasharray": [8, 5] } },
            {
              id: "spots",
              type: "circle",
              source: "spots",
              paint: {
                "circle-radius": 5,
                "circle-color": ["get", "bandColor"],
                "circle-stroke-color": "#07111f",
                "circle-stroke-width": 1.5,
              },
            },
            { id: "landmarks", type: "circle", source: "landmarks", paint: {
              "circle-radius": ["match", ["get", "kind"], "sun", 9, "home", 8, 8],
              "circle-color": ["get", "color"], "circle-stroke-color": "#e6edf6", "circle-stroke-width": 1.5,
            } },
          ],
        },
      });
      mapRef.current = map;
      map.on("load", () => {
        fetch(geometryUrl).then(response => {
          if (!response.ok) throw new Error(`DXCC geometry HTTP ${response.status}`);
          return response.json();
        }).then((data: { type: string; features?: DXCCFeature[] }) => {
          if (disposed) return;
          landFeatures = data.type === "FeatureCollection" ? data.features?.length ?? 0 : 0;
          if (data.type === "FeatureCollection" && data.features) {
            labelsRef.current = data.features.flatMap(feature => {
              const coordinate = representativePoint(feature);
              const label = shortPrefix(feature.properties.dxcc_prefix);
              return coordinate && label && Number.isFinite(feature.properties.dxcc_entity_code) ? [{ id: feature.properties.dxcc_entity_code,
                label, name: feature.properties.dxcc_name ?? "DXCC entity", coordinate }] : [];
            }).sort((a, b) => a.id - b.id);
            for (const entity of labelsRef.current) map.setFeatureState({ source: "land", id: entity.id },
              { status: dxccRef.current?.[entity.id] ?? "unknown" });
            redrawLabels();
          }
          element.dataset.mapError = "";
          setError("");
          requestEvidence();
        }).catch((cause: unknown) => {
          if (!disposed) {
            element.dataset.mapError = cause instanceof Error ? cause.message : "Loaded geography could not be read back";
            setError("Map geography could not be read back. Try reloading the map.");
          }
        });
      });
      // Read framebuffer pixels synchronously at the end of a requested frame,
      // before the browser discards its non-preserved drawing buffer.
      map.on("render", evidence);
      map.on("moveend", redrawLabels);
      document.addEventListener("xlog-native-acceptance", requestEvidence);
      document.addEventListener("xlog-native-map-evidence", requestEvidence);
      window.addEventListener("focus", repaint);
      fitFixture();
      map.on("movestart", (event) => {
        if (event.originalEvent) preserveCamera.current = true;
      });
      map.addControl(
        new maplibregl.NavigationControl({ showCompass: true }),
        "top-right",
      );
      map.addControl(
        new maplibregl.AttributionControl({
          compact: false,
          customAttribution:
            '<a href="https://github.com/amazingproducer/dxcc-world-map" target="_blank" rel="noopener noreferrer">DXCC geometry: amazingproducer/dxcc-world-map</a>',
        }),
        "bottom-right",
      );
      map.addControl(
        new maplibregl.ScaleControl({ unit: "metric" }),
        "top-right",
      );
      map.on("click", "spots", (e) => {
        const id = e.features?.[0]?.properties?.id;
        const s = spotsRef.current.find((s) => s.id === id);
        if (s) callback.current?.(s);
      });
      map.on("mouseenter", "spots", () => {
        if (callback.current) map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "spots", () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("error", (event) => {
        // Raster failures must not hide the bundled DXCC geography.
        const sourceId = (event as unknown as { sourceId?: string }).sourceId;
        const imageryError = sourceId === "imagery" || String(event.error ?? "").includes("gibs.earthdata.nasa.gov");
        if (imageryError && appearanceRef.current !== "Standard") {
          setImageryUnavailable(true);
          appearanceRef.current = "Standard";
          if (map.getLayer("imagery")) map.setLayoutProperty("imagery", "visibility", "none");
          if (map.getLayer("land")) map.setPaintProperty("land", "fill-opacity", 1);
        } else if (!imageryError) {
          element.dataset.mapError = "Map data could not render";
          setError("Map data could not render. Logging and cluster selection remain available.");
        }
      });
      const resize = new ResizeObserver(() => {
        map.resize();
        if (!preserveCamera.current && !selection.current) fitFixture();
      });
      resize.observe(container.current);
      return () => {
        disposed = true;
        document.removeEventListener("xlog-native-acceptance", requestEvidence);
        document.removeEventListener("xlog-native-map-evidence", requestEvidence);
        window.removeEventListener("focus", repaint);
        resize.disconnect();
        markersRef.current.forEach(marker => marker.remove());
        markersRef.current.clear();
        redrawRef.current = () => {};
        map.remove();
        mapRef.current = null;
      };
    } catch (e) {
      element.dataset.mapError = e instanceof Error ? e.message : String(e);
      setError(
        `Map unavailable: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, []);
  useEffect(() => {
    const s = spotsRef.current.find((s) => s.id === selected);
    if (s && mapRef.current) {
      preserveCamera.current = true;
      mapRef.current.easeTo({
        center: [s.lon, s.lat],
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 180,
      });
    }
  }, [selected]);
  useEffect(() => {
    const map = mapRef.current;
    if (!fixture && home && map && !preserveCamera.current && !selected) {
      map.easeTo({ center: [home.lon, home.lat], zoom: 2.55, duration: 0 });
    }
  }, [fixture, home?.lat, home?.lon, selected]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      if (!map.getLayer("imagery")) return;
      const offline = appearance === "Standard" || imageryUnavailable;
      map.setLayoutProperty("imagery", "visibility", offline ? "none" : "visible");
      map.setPaintProperty("land", "fill-opacity", offline ? 1 : 0.08);
      map.setPaintProperty("borders", "line-opacity", appearance === "Satellite" && !offline ? 0 : 0.65);
    };
    if (map.isStyleLoaded()) update(); else map.once("load", update);
    return () => { map.off("load", update); };
  }, [appearance, imageryUnavailable]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      if (!map.getLayer("spots")) return;
      map.setLayoutProperty("spots", "visibility", overlayMode === "DXCC" ? "none" : "visible");
      map.setLayoutProperty("dxcc-status", "visibility", overlayMode === "Spots" ? "none" : "visible");
      map.setPaintProperty("dxcc-status", "fill-opacity", ["case",
        ["in", ["feature-state", "status"], ["literal", statusFilter]], 0.12,
        ["==", ["feature-state", "status"], "unknown"], 0.07, 0]);
      redrawRef.current();
    };
    if (map.isStyleLoaded()) update(); else map.once("load", update);
    return () => { map.off("load", update); };
  }, [overlayMode, statusFilter]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      if (!map.getSource("land")) return;
      for (const entity of labelsRef.current) map.setFeatureState({ source: "land", id: entity.id },
        { status: dxccStatuses?.[entity.id] ?? "unknown" });
      redrawRef.current();
    };
    if (map.isSourceLoaded("land")) update(); else map.once("load", update);
    return () => { map.off("load", update); };
  }, [dxccStatuses]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      const sun = solarPosition(solarDate);
      const route = home && target ? greatCircle([home.lon, home.lat], [target.lon, target.lat], longPath) : [];
      (map.getSource("route") as maplibregl.GeoJSONSource | undefined)?.setData(lineFeatures(route));
      (map.getSource("grayline") as maplibregl.GeoJSONSource | undefined)?.setData(lineFeatures(showGrayline ? grayline(solarDate) : []));
      map.setLayoutProperty("grayline-band", "visibility", showGrayline ? "visible" : "none");
      map.setLayoutProperty("grayline-edge", "visibility", showGrayline ? "visible" : "none");
      map.setPaintProperty("route-line", "line-color", longPath ? "#f47ac4" : "#35c8f5");
      (map.getSource("landmarks") as maplibregl.GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection", features: [
          ...(home ? [{ type: "Feature" as const, properties: { kind: "home", color: "#12d6a0", call: home.call ?? "My station" },
            geometry: { type: "Point" as const, coordinates: [home.lon, home.lat] } }] : []),
          ...(target ? [{ type: "Feature" as const, properties: { kind: "target", color: "#f3b23c", call: target.call ?? "Active DX" },
            geometry: { type: "Point" as const, coordinates: [target.lon, target.lat] } }] : []),
          ...(showSun ? [{ type: "Feature" as const, properties: { kind: "sun", color: "#ffd75a", call: "Sun" },
            geometry: { type: "Point" as const, coordinates: sun } }] : []),
        ],
      });
    };
    if (map.isStyleLoaded()) update(); else map.once("load", update);
    return () => { map.off("load", update); };
  }, [home, target, showSun, showGrayline, solarDate, longPath]);
  useEffect(() => {
    const timer = window.setInterval(() => setSolarDate(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      const source = map.getSource("spots") as maplibregl.GeoJSONSource | undefined;
      source?.setData({ type: "FeatureCollection", features: data.map(s => ({
        type: "Feature", properties: { id: s.id, state: s.state,
          bandColor: paletteColor(s.band, palette?.band, clusterBandColors) },
        geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      })) });
      redrawRef.current();
    };
    if (map.isStyleLoaded()) update(); else map.once("load", update);
    return () => { map.off("load", update); };
  }, [data, palette]);
  const routeSummary = home && target ? bearingAndDistance([home.lon, home.lat], [target.lon, target.lat]) : null;
  const activeBands = [...new Set(data.map(spot => spot.band))].slice(0, 9);
  const changePreset = (next: MapPreset) => {
    setPreset(next);
    if (next === "Simple") { setOverlayMode("Spots"); setShowSun(false); setShowGrayline(false); }
    else if (next === "Detailed") { setOverlayMode("Both"); setShowSun(true); setShowGrayline(true); }
    else { setOverlayMode("DXCC"); setShowSun(true); setShowGrayline(true); }
  };
  return (
    <div className={`map-wrap${compact ? " map-compact" : ""}`}>
      <div
        ref={container}
        className="map"
        role="region"
        aria-label="Interactive world map, arrow keys pan, plus and minus zoom"
      />
      {!compact && <div className="map-toolbar" aria-label="World map controls">
        <strong>World map</strong>
        <label>Preset <select aria-label="Map preset" value={preset} onChange={event => changePreset(event.target.value as MapPreset)}>
          <option>Simple</option><option>Detailed</option><option>DX</option>
        </select></label>
        <label>Overlay <select aria-label="Map overlay" value={overlayMode} onChange={event => setOverlayMode(event.target.value as OverlayMode)}>
          <option>Spots</option><option>DXCC</option><option>Both</option>
        </select></label>
        <label>Map <select aria-label="Map appearance" value={appearance} onChange={event => { setImageryUnavailable(false); setAppearance(event.target.value as MapAppearance); }}>
          <option>Hybrid</option><option>Satellite</option><option>Standard</option>
        </select></label>
        <button type="button" aria-pressed={showSun} onClick={() => setShowSun(!showSun)}>Sun</button>
        <button type="button" aria-pressed={showGrayline} onClick={() => setShowGrayline(!showGrayline)}>Greyline</button>
        <button type="button" aria-pressed={longPath} onClick={() => setLongPath(!longPath)} title="Switch the displayed great-circle path; does not move the rotor">{longPath ? "Long path" : "Short path"}</button>
        <span className="map-count">{data.length} mapped</span>
      </div>}
      {imageryUnavailable && appearance !== "Standard" && <p className="map-offline" role="status">Imagery unavailable · showing bundled map</p>}
      {error && (
        <p className="map-error" role="alert">
          {error}
        </p>
      )}
      {!compact && <div className="map-legend">
        {routeSummary ? <strong>{target?.call} · {Math.round(routeSummary.distanceKm).toLocaleString()} km · SP {Math.round(routeSummary.shortBearing).toString().padStart(3, "0")}° · LP {Math.round(routeSummary.longBearing).toString().padStart(3, "0")}°</strong>
          : !home && !fixture ? <span>Set your station grid to draw accurate DX paths.</span> : null}
        <span>{fixture ? "Offline geography · fixture spots" : "CTY approximate spot locations"}</span>
        <div className="map-legend-items">
          {overlayMode !== "DXCC" && activeBands.map(band => <span key={band}><i style={{ backgroundColor: paletteColor(band, palette?.band, clusterBandColors) }} />{band}</span>)}
          {overlayMode !== "Spots" && (["needed", "worked", "confirmed"] as DXCCStatus[]).map(status =>
            <button key={status} type="button" aria-pressed={statusFilter.includes(status)} onClick={() => setStatusFilter(current =>
              current.includes(status) ? current.filter(item => item !== status) : [...current, status])}>
              <i style={{ backgroundColor: status === "needed" ? "#8fb3d9" : status === "worked" ? "#ff9d2e" : "#12d6a0" }} />{status[0].toUpperCase() + status.slice(1)}
            </button>)}
          {showSun && <span><i style={{ backgroundColor: "#ffd75a" }} />Sun</span>}
          {showGrayline && <span><i style={{ backgroundColor: "#a9b6c8" }} />Greyline</span>}
        </div>
      </div>}
    </div>
  );
}

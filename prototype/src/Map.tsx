import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import geometryUrl from "../../Sources/XLogCore/Resources/dxcc-boundaries.geojson?url";
import { dxccPrefixLabel, mapSpotBounds, mapSpotDetails, normalizedMapCall, normalizeMapSpots, type MapSpot } from "./MapSpots";
import { describeMapError } from "./MapErrors";
import { acceptanceActive, interiorLandProbe, landPixelMatches } from "./acceptance";
import { bearingAndDistance, grayline, greatCircle, nightHemisphere, solarPosition, type Coordinate } from "./MapGeography";
import { clusterBandColors, clusterStatusColors, paletteColor } from "./live/clusterPalette";
import "./Map.css";
// MapLibre 6 resolves its default worker relative to import.meta.url. Vite's
// optimized module and packaged bundle do not preserve that adjacent path.
// Emit the standalone worker as a local asset and configure it before any map.
maplibregl.setWorkerUrl(new URL(workerUrl, window.location.href).href);
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

// The geography helper splits at the antimeridian for MapLibre, but does not
// include the crossing itself. Complete both sides so the displayed route and
// its camera bounds include the whole great circle, including its endpoints.
function completeRoute(from: Coordinate, to: Coordinate, longPath: boolean): Coordinate[][] {
  const sections = greatCircle(from, to, longPath).map(section => [...section]);
  if (!sections.length) return [];
  const samePoint = (a: Coordinate, b: Coordinate) =>
    Math.abs(a[0] - b[0] - 360 * Math.round((a[0] - b[0]) / 360)) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
  if (!samePoint(sections[0][0], from)) {
    if (Math.abs(sections[0][0][0] - from[0]) > 180) sections.unshift([from]);
    else sections[0].unshift(from);
  } else if (Math.abs(sections[0][0][0] - from[0]) < 180) sections[0][0] = from;
  const last = sections[sections.length - 1];
  if (!samePoint(last[last.length - 1], to)) {
    if (Math.abs(last[last.length - 1][0] - to[0]) > 180) sections.push([to]);
    else last.push(to);
  } else if (Math.abs(last[last.length - 1][0] - to[0]) < 180) last[last.length - 1] = to;
  for (let index = 0; index < sections.length - 1; index++) {
    const before = sections[index];
    const after = sections[index + 1];
    const a = before[before.length - 1], b = after[0];
    const crossing = a[0] > 0 ? 180 : -180;
    const bUnwrapped = b[0] + (crossing > 0 ? 360 : -360);
    const fraction = (crossing - a[0]) / (bUnwrapped - a[0]);
    const latitude = a[1] + fraction * (b[1] - a[1]);
    before.push([crossing, latitude]);
    after.unshift([-crossing, latitude]);
  }
  return sections;
}

export function routeBounds(from: Coordinate, to: Coordinate, longPath: boolean): [[number, number], [number, number]] | null {
  const sections = completeRoute(from, to, longPath);
  if (!sections.length) return null;
  // Unwrap adjacent samples instead of taking min/max of wrapped longitude:
  // 179°E to 179°W is a 2° short path, not a 358° viewport.
  let previous = from[0];
  let west = previous, east = previous, south = from[1], north = from[1];
  for (const point of sections.flat()) {
    const longitude = point[0] + 360 * Math.round((previous - point[0]) / 360);
    previous = longitude;
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, point[1]);
    north = Math.max(north, point[1]);
  }
  return [[west, south], [east, north]];
}

export function routeLabelPosition(sections: Coordinate[][]): { point: Coordinate; before: Coordinate; after: Coordinate } | null {
  const total = sections.reduce((count, section) => count + Math.max(0, section.length - 1), 0);
  if (!total) return null;
  const halfway = total / 2;
  let traversed = 0;
  for (const section of sections) {
    const edges = Math.max(0, section.length - 1);
    if (edges && halfway <= traversed + edges) {
      const middle = Math.max(0, Math.min(section.length - 1, Math.round(halfway - traversed)));
      return { point: section[middle], before: section[Math.max(0, middle - 2)],
        after: section[Math.min(section.length - 1, middle + 2)] };
    }
    traversed += edges;
  }
  return null;
}

export function routeFrequencyLabel(frequencyHz?: number): string | null {
  if (typeof frequencyHz !== "number" || !Number.isSafeInteger(frequencyHz) || frequencyHz <= 0) return null;
  const mhz = (frequencyHz / 1_000_000).toFixed(6);
  return `${mhz.slice(0, -3)}.${mhz.slice(-3)} MHz`;
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
  frequencyHz,
  spotActionLabel = "Activate to tune",
  locationLabel = "CTY approximate spot locations",
  fitToDataKey,
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
  frequencyHz?: number;
  spotActionLabel?: string;
  locationLabel?: string;
  fitToDataKey?: string;
}) {
  const mappedSpots = useMemo(() => normalizeMapSpots(data), [data]);
  const detailID = useId();
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [viewportRevision, setViewportRevision] = useState(0);
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
  const actionLabel = useRef(spotActionLabel); actionLabel.current = spotActionLabel;
  const fitDataRef = useRef(fitToDataKey); fitDataRef.current = fitToDataKey;
  const fittedDataKey = useRef<string | null>(null);
  const selection = useRef(selected);
  const preserveCamera = useRef(Boolean(selected));
  const fittedRouteKey = useRef<string | null>(null);
  const centeredSelectionKey = useRef<string | null>(null);
  const spotsRef = useRef(mappedSpots);
  const selectedCallRef = useRef<string | null>(null);
  const previousSelectionRef = useRef(selected);
  const currentSelected = data.find(spot => spot.id === selected);
  if (currentSelected) selectedCallRef.current = normalizedMapCall(currentSelected.call);
  else if (previousSelectionRef.current !== selected || selected === null) selectedCallRef.current = null;
  previousSelectionRef.current = selected;
  const selectedSpot = mappedSpots.find(spot => spot.id === selected || spot.call === selectedCallRef.current);
  const homeRef = useRef(home);
  const targetRef = useRef(target);
  const routeLabelPointRef = useRef<Coordinate | null>(null);
  const labelsRef = useRef<{ id: number; label: string; name: string; coordinate: Coordinate }[]>([]);
  const entityIDsRef = useRef<number[]>([]);
  const markersRef = useRef(new Map<string, maplibregl.Marker>());
  const spotMarkersRef = useRef(new Map<string, maplibregl.Marker>());
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
  spotsRef.current = mappedSpots;
  homeRef.current = home;
  targetRef.current = target;
  callback.current = onSpot;
  selection.current = selected;
  useEffect(() => {
    if (!container.current) return;
    const element = container.current;
    let constructionWidth = 0, constructionHeight = 0;
    let map: maplibregl.Map;
    let disposed = false;
    let landFeatures = 0;
    let captureRequested = acceptanceActive;
    let inspectedCall: string | null = null;
    let popup: maplibregl.Popup | null = null;
    const hideDetails = () => { popup?.remove(); popup = null; inspectedCall = null; };
    const showDetails = (call: string, refresh = false) => {
      const spot = spotsRef.current.find(value => value.call === call);
      if (!spot || overlayRef.current === "DXCC") { hideDetails(); return; }
      if (inspectedCall === call && popup && !refresh) return;
      inspectedCall = call;
      const content = document.createElement("div");
      content.className = "map-spot-details";
      content.id = detailID;
      content.setAttribute("role", "tooltip");
      const heading = document.createElement("strong");
      heading.textContent = spot.call;
      heading.style.color = paletteColor(spot.callStatus ?? "Unknown", paletteRef.current?.status, clusterStatusColors);
      content.append(heading);
      for (const [index, text] of mapSpotDetails(spot).entries()) {
        const line = document.createElement("span");
        line.className = index === 0 ? "map-spot-frequency" : "";
        line.textContent = text;
        content.append(line);
      }
      popup ??= new maplibregl.Popup({ closeButton: false, closeOnClick: false, maxWidth: "280px", offset: 12, className: "map-spot-popup" });
      popup.setLngLat([spot.lon, spot.lat]).setDOMContent(content).addTo(map);
    };
    const redrawLabels = () => {
      if (disposed) return;
      const width = map.getContainer().clientWidth, height = map.getContainer().clientHeight;
      const occupied: { x: number; y: number }[] = [];
      // Endpoint callsigns and the route annotation remain primary; lower
      // priority spot/DXCC labels must move out of their immediate vicinity.
      for (const point of [homeRef.current, targetRef.current]) {
        if (point?.call?.trim() && Number.isFinite(point.lon) && Number.isFinite(point.lat))
          occupied.push(map.project([point.lon, point.lat]));
      }
      if (routeLabelPointRef.current) occupied.push(map.project(routeLabelPointRef.current));
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
      const drawDXCCLabels = () => { if (overlayRef.current !== "Spots") {
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
      } };
      if (overlayRef.current !== "DXCC" && map.getZoom() >= 3) {
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
      // Callsigns take priority over approximate country labels at regional zoom.
      drawDXCCLabels();
      for (const [id, marker] of markersRef.current) {
        if (!visible.has(id)) { marker.remove(); markersRef.current.delete(id); }
      }
      // Focusable hit targets sit over the existing palette-coloured circles.
      // Hover and focus inspect only; activation retains the existing tune action.
      const visibleSpots = new Set<string>();
      if (overlayRef.current !== "DXCC") for (const spot of spotsRef.current) {
        const position = map.project([spot.lon, spot.lat]);
        if (position.x < 0 || position.x > width || position.y < 0 || position.y > height) continue;
        visibleSpots.add(spot.call);
        let marker = spotMarkersRef.current.get(spot.call);
        if (!marker) {
          const button = document.createElement("button");
          const call = spot.call;
          button.type = "button";
          button.className = "map-spot-hit";
          button.setAttribute("aria-describedby", detailID);
          button.addEventListener("mouseenter", () => showDetails(call));
          button.addEventListener("focus", () => showDetails(call));
          button.addEventListener("mouseleave", () => { if (document.activeElement !== button) hideDetails(); });
          button.addEventListener("blur", hideDetails);
          button.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); hideDetails(); } });
          button.addEventListener("click", event => {
            event.stopPropagation();
            const current = spotsRef.current.find(value => value.call === call);
            if (current) callback.current?.(current);
          });
          marker = new maplibregl.Marker({ element: button, anchor: "center" }).setLngLat([spot.lon, spot.lat]).addTo(map);
          spotMarkersRef.current.set(call, marker);
        }
        const button = marker.getElement();
        button.setAttribute("aria-label", `${spot.call} · ${mapSpotDetails(spot)[0]}${callback.current ? `. ${actionLabel.current}.` : ". Inspect spot."}`);
        button.setAttribute("aria-current", selectedCallRef.current === spot.call ? "true" : "false");
        marker.setLngLat([spot.lon, spot.lat]);
      }
      for (const [call, marker] of spotMarkersRef.current) {
        if (!visibleSpots.has(call)) { marker.remove(); spotMarkersRef.current.delete(call); }
      }
      if (inspectedCall) {
        if (visibleSpots.has(inspectedCall)) showDetails(inspectedCall, true); else hideDetails();
      }
    };
    redrawRef.current = redrawLabels;
    const repaint = () => {
      if (disposed || !element.clientWidth || !element.clientHeight) return;
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
      if (!fixture && station && !fitDataRef.current) {
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
        // This retained map has one visible-size owner below. MapLibre's own
        // observer otherwise resizes hidden panes to its 400x300 fallback.
        trackResize: false,
        // This is a world overview, not a slippy map that should repeat the
        // same countries. A transient fallback camera must never render
        // multiple wrapped copies while the Desk is returning.
        renderWorldCopies: false,
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
            night: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            landmarks: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
            spots: {
              type: "geojson",
              data: {
                type: "FeatureCollection",
                features: spotsRef.current.map((s) => ({
                  type: "Feature",
                  id: `spot-${s.call}`, properties: { id: s.id, state: s.state, bandColor: paletteColor(s.band, paletteRef.current?.band, clusterBandColors) },
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
            { id: "night-fill", type: "fill", source: "night", layout: { visibility: showGrayline ? "visible" : "none" },
              paint: { "fill-color": "#c7d0d8", "fill-opacity": 0.27 } },
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
      constructionWidth = element.clientWidth;
      constructionHeight = element.clientHeight;
      map.on("load", () => {
        fetch(geometryUrl).then(response => {
          if (!response.ok) throw new Error(`DXCC geometry HTTP ${response.status}`);
          return response.json();
        }).then((data: { type: string; features?: DXCCFeature[] }) => {
          if (disposed) return;
          landFeatures = data.type === "FeatureCollection" ? data.features?.length ?? 0 : 0;
          if (data.type === "FeatureCollection" && data.features) {
            entityIDsRef.current = [...new Set(data.features.map(feature => feature.properties.dxcc_entity_code).filter(Number.isFinite))];
            labelsRef.current = data.features.flatMap(feature => {
              const coordinate = representativePoint(feature);
              const label = dxccPrefixLabel(feature.properties.dxcc_prefix);
              return coordinate && label && Number.isFinite(feature.properties.dxcc_entity_code) ? [{ id: feature.properties.dxcc_entity_code,
                label, name: feature.properties.dxcc_name ?? "DXCC entity", coordinate }] : [];
            }).sort((a, b) => a.id - b.id);
            for (const id of entityIDsRef.current) map.setFeatureState({ source: "land", id },
              { status: dxccRef.current?.[id] ?? "unknown" });
            redrawLabels();
          }
          // Loading bundled geography only resolves its own failure. It is
          // not evidence that a different source or the renderer recovered.
          if (!element.dataset.mapError || element.dataset.mapErrorSource === "land") {
            element.dataset.mapError = "";
            element.dataset.mapErrorSource = "";
            setError("");
          }
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
      const visible = () => { if (document.visibilityState === "visible") repaint(); };
      document.addEventListener("visibilitychange", visible);
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
      map.on("mousemove", "spots", (event) => {
        const spot = spotsRef.current.find(value => value.id === event.features?.[0]?.properties?.id);
        if (spot) showDetails(spot.call);
      });
      map.on("mouseleave", "spots", () => {
        if (!container.current?.contains(document.activeElement) || !document.activeElement?.classList.contains("map-spot-hit")) hideDetails();
      });
      map.on("error", (event) => {
        // Raster failures must not hide the bundled DXCC geography.
        const diagnostic = describeMapError(event);
        if (diagnostic.imagery) {
          setImageryUnavailable(true);
          appearanceRef.current = "Standard";
          if (map.getLayer("imagery")) map.setLayoutProperty("imagery", "visibility", "none");
          if (map.getLayer("land")) map.setPaintProperty("land", "fill-opacity", 1);
        } else {
          const message = `Map error (${diagnostic.source}): ${diagnostic.detail}`;
          element.dataset.mapError = message;
          element.dataset.mapErrorSource = diagnostic.source;
          setError(`${message} Logging and cluster selection remain available.`);
        }
      });
      let resizeFrame: number | null = null;
      let initialViewportFinalized = false;
      const scheduleResize = () => {
        // A retained Desk map can be hidden or change split rows several times
        // in one layout pass. Measure its final visible size before resizing
        // WebGL. Do not infer MapLibre's viewport from the CSS canvas size: on
        // route return those dimensions can agree while its transform is still
        // the hidden/fallback size.
        if (resizeFrame !== null) return;
        resizeFrame = window.requestAnimationFrame(() => {
          resizeFrame = null;
          if (disposed) return;
          const nextWidth = element.clientWidth, nextHeight = element.clientHeight;
          if (!nextWidth || !nextHeight) return;
          map.resize();
          if (!initialViewportFinalized) {
            initialViewportFinalized = true;
            const fallbackConstruction = !constructionWidth || !constructionHeight
              || constructionWidth === 400 && constructionHeight === 300;
            if (fallbackConstruction && (nextWidth !== constructionWidth || nextHeight !== constructionHeight)) {
              // Camera effects may have run against MapLibre's 400x300
              // construction fallback before the returning Desk settled.
              // Repeat only those automatic fits once at the actual size;
              // ordinary operator resizes must continue to preserve camera.
              fittedRouteKey.current = null;
              fittedDataKey.current = null;
              if (!preserveCamera.current) fitFixture();
              setViewportRevision(value => value + 1);
            }
          }
          // A layout change only updates the viewport. Refitting a shallow
          // split can zoom out to several wrapped worlds and discard the camera.
          map.triggerRepaint();
          redrawLabels();
        });
      };
      const resize = new ResizeObserver(scheduleResize);
      resize.observe(element);
      // MapLibre can be constructed while an incoming route is still hidden.
      // Resize once after layout even when ResizeObserver coalesces that reveal.
      scheduleResize();
      return () => {
        disposed = true;
        document.removeEventListener("xlog-native-acceptance", requestEvidence);
        document.removeEventListener("xlog-native-map-evidence", requestEvidence);
        document.removeEventListener("visibilitychange", visible);
        window.removeEventListener("focus", repaint);
        resize.disconnect();
        if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
        markersRef.current.forEach(marker => marker.remove());
        markersRef.current.clear();
        spotMarkersRef.current.forEach(marker => marker.remove());
        spotMarkersRef.current.clear();
        hideDetails();
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
    const s = selectedSpot;
    const key = selected && s ? `${selected}:${s.call}` : null;
    if (s && key && key !== centeredSelectionKey.current && !(home && target) && mapRef.current) {
      preserveCamera.current = true;
      mapRef.current.easeTo({
        center: [s.lon, s.lat],
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 180,
      });
    }
    centeredSelectionKey.current = key;
    redrawRef.current();
  }, [selected, selectedSpot?.call, home?.lat, home?.lon, target?.lat, target?.lon]);
  const routeKey = home && target && [home.lon, home.lat, target.lon, target.lat].every(Number.isFinite)
    ? `${home.call?.trim().toUpperCase() ?? ""}:${home.lon},${home.lat}:${target.call?.trim().toUpperCase() ?? ""}:${target.lon},${target.lat}:${longPath}` : null;
  useEffect(() => {
    const map = mapRef.current;
    if (!routeKey || !home || !target || !map) {
      fittedRouteKey.current = null;
      return;
    }
    if (fittedRouteKey.current === routeKey) return;
    const bounds = routeBounds([home.lon, home.lat], [target.lon, target.lat], longPath);
    if (!bounds) return;
    fittedRouteKey.current = routeKey;
    preserveCamera.current = true;
    map.fitBounds(bounds, {
      padding: compact ? { top: 28, right: 34, bottom: 34, left: 34 }
        : { top: 74, right: 54, bottom: 100, left: 54 },
      maxZoom: 6,
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 350,
    });
  }, [routeKey, home?.lon, home?.lat, target?.lon, target?.lat, longPath, compact, viewportRevision]);
  useEffect(() => {
    const map = mapRef.current;
    if (fitToDataKey == null || !map || !mappedSpots.length || fittedDataKey.current === fitToDataKey) return;
    const fit = () => {
      const bounds = mapSpotBounds(mappedSpots);
      if (!bounds) return;
      fittedDataKey.current = fitToDataKey; preserveCamera.current = true;
      map.fitBounds(bounds, { padding: { top: 38, right: 38, bottom: 38, left: 38 }, maxZoom: 5,
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 220 });
    };
    if (map.isStyleLoaded()) fit(); else map.once("load", fit);
    return () => { map.off("load", fit); };
  }, [fitToDataKey, mappedSpots, viewportRevision]);
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
      if (mapRef.current !== map || !map.getSource("land")) return;
      for (const id of entityIDsRef.current) map.setFeatureState({ source: "land", id },
        { status: dxccStatuses?.[id] ?? "unknown" });
      redrawRef.current();
    };
    // Source existence is the safe probe: isSourceLoaded emits an error before
    // registration, while isStyleLoaded can become false during later tile work
    // even though the source remains ready and the initial load will not repeat.
    if (map.getSource("land")) update(); else map.once("load", update);
    return () => { map.off("load", update); };
  }, [dxccStatuses]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      const sun = solarPosition(solarDate);
      const route = home && target ? completeRoute([home.lon, home.lat], [target.lon, target.lat], longPath) : [];
      (map.getSource("route") as maplibregl.GeoJSONSource | undefined)?.setData(lineFeatures(route));
      (map.getSource("grayline") as maplibregl.GeoJSONSource | undefined)?.setData(lineFeatures(showGrayline ? grayline(solarDate) : []));
      (map.getSource("night") as maplibregl.GeoJSONSource | undefined)?.setData({
        type: "FeatureCollection", features: showGrayline ? [{ type: "Feature", properties: {},
          geometry: { type: "Polygon", coordinates: nightHemisphere(sun) } }] : [],
      });
      map.setLayoutProperty("night-fill", "visibility", showGrayline ? "visible" : "none");
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
    const map = mapRef.current;
    if (!map) return;
    const markers: maplibregl.Marker[] = [];
    routeLabelPointRef.current = null;
    const endpoint = (point: MapPoint | null | undefined, kind: "home" | "target") => {
      const call = point?.call?.trim();
      if (!point || !call || !Number.isFinite(point.lon) || !Number.isFinite(point.lat)) return;
      const label = document.createElement("span");
      label.className = `map-route-endpoint map-route-${kind}`;
      label.textContent = call;
      label.setAttribute("aria-label", `${kind === "home" ? "Home station" : "Target"} ${call}`);
      markers.push(new maplibregl.Marker({ element: label, anchor: kind === "home" ? "bottom" : "top",
        offset: [0, kind === "home" ? -14 : 14] })
        .setLngLat([point.lon, point.lat]).addTo(map));
    };
    endpoint(home, "home");
    endpoint(target, "target");
    let orient = () => {};
    if (home && target && [home.lon, home.lat, target.lon, target.lat].every(Number.isFinite)) {
      const sections = completeRoute([home.lon, home.lat], [target.lon, target.lat], longPath);
      const position = routeLabelPosition(sections);
      if (position) {
        routeLabelPointRef.current = position.point;
        const distance = bearingAndDistance([home.lon, home.lat], [target.lon, target.lat]).distanceKm;
        const pathDistance = longPath ? 2 * Math.PI * 6371.0088 - distance : distance;
        const frequency = routeFrequencyLabel(frequencyHz);
        const markerElement = document.createElement("div");
        markerElement.className = "map-route-annotation";
        markerElement.setAttribute("role", "note");
        markerElement.setAttribute("aria-label", `${longPath ? "Long" : "Short"} path ${Math.round(pathDistance).toLocaleString()} kilometres${frequency ? `, ${frequency}` : ""}`);
        const inner = document.createElement("div");
        inner.className = "map-route-annotation-inner";
        const distanceLabel = document.createElement("span");
        distanceLabel.className = "map-route-distance";
        distanceLabel.textContent = `${longPath ? "LP" : "SP"} · ${Math.round(pathDistance).toLocaleString()} km`;
        inner.append(distanceLabel);
        const gap = document.createElement("span");
        gap.className = "map-route-label-gap";
        inner.append(gap);
        if (frequency) {
          const frequencyLabel = document.createElement("span");
          frequencyLabel.className = "map-route-frequency";
          frequencyLabel.textContent = frequency;
          inner.append(frequencyLabel);
        }
        markerElement.append(inner);
        markers.push(new maplibregl.Marker({ element: markerElement, anchor: "center" })
          .setLngLat(position.point).addTo(map));
        redrawRef.current();
        orient = () => {
          const before = map.project(position.before), after = map.project(position.after);
          let angle = Math.atan2(after.y - before.y, after.x - before.x) * 180 / Math.PI;
          if (angle > 90) angle -= 180;
          if (angle < -90) angle += 180;
          inner.style.transform = `rotate(${Math.max(-70, Math.min(70, angle))}deg)`;
        };
        orient();
        map.on("moveend", orient);
      }
    }
    return () => { map.off("moveend", orient); markers.forEach(marker => marker.remove()); routeLabelPointRef.current = null; };
  }, [home?.call, home?.lon, home?.lat, target?.call, target?.lon, target?.lat, longPath, frequencyHz]);
  useEffect(() => {
    const timer = window.setInterval(() => setSolarDate(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const update = () => {
      const source = map.getSource("spots") as maplibregl.GeoJSONSource | undefined;
      source?.setData({ type: "FeatureCollection", features: mappedSpots.map(s => ({
        type: "Feature", id: `spot-${s.call}`, properties: { id: s.id, state: s.state,
          bandColor: paletteColor(s.band, palette?.band, clusterBandColors) },
        geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      })) });
      redrawRef.current();
    };
    if (map.isStyleLoaded()) update(); else map.once("load", update);
    return () => { map.off("load", update); };
  }, [mappedSpots, palette]);
  const routeSummary = home && target ? bearingAndDistance([home.lon, home.lat], [target.lon, target.lat]) : null;
  const activeBands = [...new Set(mappedSpots.map(spot => spot.band))].slice(0, 9);
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
        <span className="map-count">{mappedSpots.length} mapped</span>
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
        <span>{fixture ? "Offline geography · fixture spots" : locationLabel}</span>
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

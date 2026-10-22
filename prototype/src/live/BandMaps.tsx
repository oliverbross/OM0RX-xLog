import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { ArrowDown, ArrowUp, RotateCcw, Settings, X, ZoomIn, ZoomOut } from "lucide-react";
import { clusterBandColors, clusterStatusCode, clusterStatusColors, paletteColor } from "./clusterPalette";
import { countryDisplay } from "./countryDisplay";
import "./BandMaps.css";

export type BandMapSpot = Record<string, any> & { id?: unknown };
// An explicit host slot lets compact maps share the workspace toolbar without
// changing ownership, remounting charts, or searching/moving DOM nodes.
export const BandMapsToolbarContext = createContext<HTMLElement | null>(null);
export const BAND_MAP_MODES = ["cw", "data", "phone"] as const;
export type BandMapMode = typeof BAND_MAP_MODES[number];
export const BAND_MAP_RESOLUTIONS = [1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 40] as const;
export const BAND_MAP_AGES = [15, 30, 45, 60] as const;
export type BandMapResolution = "full" | "custom" | typeof BAND_MAP_RESOLUTIONS[number];
// Fit readable charts to the viewport; excess bands are paged, never clipped.
export function bandMapCapacity(width: number, height: number, singleRow: boolean, count: number) {
  const columns = Math.max(1, Math.min(count, Math.floor((Math.max(0, width - 20) + 10) / 270)));
  const rows = singleRow ? 1 : Math.max(1, Math.floor((Math.max(0, height - 20) + 10) / 240));
  return { columns, capacity: Math.max(1, columns * rows) };
}
export type BandMapViewPreferences = { bands: string[]; followRadio: boolean; layout: "row" | "grid"; fontScale: number; modes?: BandMapMode[] };
type Props = { spots: BandMapSpot[]; onSelect: (spot: BandMapSpot) => void; radioFrequencyHz?: number; compact?: boolean;
  observedReceiveBandwidthHz?: number | null;
  preferences?: BandMapViewPreferences; onPreferencesChange?: (next: BandMapViewPreferences) => void; onDock?: () => void; onUndock?: () => void; selectionHint?: string;
  focusedBand?: string; onFocusedBandChange?: (band: string) => void; storageNamespace?: string;
  selectedSpotId?: string | null; onSpotContextMenu?: (spot: BandMapSpot, event: ReactMouseEvent<HTMLElement>) => void;
  contestPresentation?: boolean };
type Allocation = { name: "CW" | "Data" | "Phone"; low: number; high: number };
type Range = { low: number; high: number; allocations: Allocation[] };
type ViewRange = { low: number; high: number };
type PlacedSpot = { spot: BandMapSpot; top: number; anchorTop: number; lane: number; key: string };
export function panBandRange(view: ViewRange, full: ViewRange, delta: number): ViewRange {
  const span = view.high - view.low;
  const low = Math.max(full.low, Math.min(full.high - span, view.low + delta));
  return { low, high: low + span };
}

// kHz; these are visual guides inherited from the native band maps, not transmission permissions.
const SEGMENTS: Record<string, [number, number, number, number]> = {
  "160m": [1800, 1840, 1850, 2000], "80m": [3500, 3570, 3600, 4000],
  "60m": [5250, 5330, 5405, 5500], "40m": [7000, 7040, 7100, 7300],
  "30m": [10100, 10130, 10150, 10150], "20m": [14000, 14070, 14112, 14350],
  "17m": [18068, 18095, 18110, 18168], "15m": [21000, 21070, 21150, 21450],
  "12m": [24890, 24915, 24930, 24990], "10m": [28000, 28070, 28300, 29700],
  "6m": [50000, 50100, 50300, 54000], "2m": [144000, 144100, 144500, 148000],
  "70cm": [420000, 420100, 433000, 450000],
};
export const BAND_ORDER = Object.keys(SEGMENTS);
export const BAND_RANGES: Record<string, Range> = Object.fromEntries(Object.entries(SEGMENTS).map(([band, [low, cwHigh, dataHigh, high]]) => [band, {
  low, high, allocations: ([
    { name: "CW", low, high: cwHigh },
    { name: "Data", low: cwHigh, high: dataHigh },
    { name: "Phone", low: dataHigh, high },
  ] as Allocation[]).filter((part) => part.high > part.low),
}]));

const hex = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
const text = (value: unknown): string => typeof value === "string" ? value : "";
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const APPLE_REFERENCE_SECONDS = 978_307_200;

function receivedAtMilliseconds(value: unknown): number | null {
  const numeric = finite(value);
  if (numeric === null || numeric <= 0) return null;
  if (numeric >= 1e12) return numeric;
  if (numeric >= 1e9) return numeric * 1000;
  return (numeric + APPLE_REFERENCE_SECONDS) * 1000;
}

export function filterRecentBandMapSpots(spots: BandMapSpot[], ageMinutes: number, nowMs = Date.now()): BandMapSpot[] {
  const cutoff = nowMs - ageMinutes * 60_000;
  return spots.filter(spot => {
    if (spot.marked === true) return true;
    const timestamp = receivedAtMilliseconds(spot.receivedAt);
    return timestamp === null || timestamp >= cutoff && timestamp <= nowMs + 300_000;
  });
}

export function deduplicateBandMapSpots(spots: BandMapSpot[]): BandMapSpot[] {
  const groups = new Map<string, { spot: BandMapSpot; timestamp: number; index: number; tie: string }>();
  spots.forEach((spot, index) => {
    const callsign = text(spot.callsign).trim().toUpperCase();
    const frequency = finite(spot.frequencyKHz);
    // Cluster and WSJT-X projections can report the same observation through
    // more than one feed. One-Hz normalization removes those copies without
    // hiding a real QSY by the same callsign elsewhere in the band.
    const key = callsign && frequency !== null ? `${callsign}\u0000${Math.round(frequency * 1000)}` : `unkeyed\u0000${index}`;
    const timestamp = receivedAtMilliseconds(spot.receivedAt) ?? -Infinity;
    const tie = text(spot.id);
    const match = groups.get(key);
    if (!match) groups.set(key, { spot, timestamp, index, tie });
    else if (timestamp > match.timestamp || timestamp === match.timestamp && (tie > match.tie || tie === match.tie && index > match.index)) {
      match.spot = spot;
      match.timestamp = timestamp;
      match.tie = tie;
    }
  });
  return [...groups.values()].sort((a, b) => a.index - b.index).map(group => group.spot);
}

export function formatBandMapFrequency(frequencyKHz: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: Number.isInteger(frequencyKHz) ? 0 : 1, maximumFractionDigits: 1 }).format(frequencyKHz);
}

export function bandMapFrequencyTicks(view: ViewRange, chartHeight = 208, fontScale = 1): number[] {
  const span = Math.max(1, view.high - view.low);
  // Match traditional band maps: enough kHz labels to tune confidently, while
  // retaining at least one readable text line between adjacent major ticks.
  const target = span / Math.max(2, Math.floor(chartHeight / (20 * fontScale)));
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const normalized = target / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;
  const ticks = [view.low];
  for (let value = Math.ceil(view.low / step) * step; value < view.high; value += step) {
    if (value - view.low >= step * 0.65 && view.high - value >= step * 0.65) ticks.push(+value.toFixed(3));
  }
  if (Math.abs(ticks[ticks.length - 1] - view.high) > 0.001) ticks.push(view.high);
  return ticks;
}
const storageKey = (compact: boolean, name: string, namespace?: string) => `xlog.integration.bandMaps.${namespace || (compact ? "desk" : "workspace")}.${name}`;
const controlStorageKey = (compact: boolean, focused: boolean, name: string, namespace?: string) =>
  `xlog.integration.bandMaps.${namespace || (focused ? "focused" : compact ? "desk" : "workspace")}.${name}`;
function storedBands(compact: boolean, namespace?: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(compact, "bands", namespace)) || "null");
    if (Array.isArray(value)) {
      const bands = [...new Set(value.filter((band): band is string => typeof band === "string" && band in BAND_RANGES))];
      if (bands.length) return bands;
    }
  } catch { /* Invalid or unavailable storage uses the native 20 m default. */ }
  return ["20m"];
}
function storedFlag(compact: boolean, name: string, fallback: boolean, namespace?: string): boolean {
  try { const value = localStorage.getItem(storageKey(compact, name, namespace)); return value === null ? fallback : value === "true"; }
  catch { return fallback; }
}
function storedNumber<T extends number>(key: string, choices: readonly T[], fallback: T): T {
  try { const value = Number(localStorage.getItem(key)); return choices.includes(value as T) ? value as T : fallback; }
  catch { return fallback; }
}
function storeAt(key: string, value: unknown): void {
  try { localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value)); }
  catch { /* Storage failure must not interrupt a live operating view. */ }
}
function store(compact: boolean, name: string, value: unknown, namespace?: string): void {
  try { localStorage.setItem(storageKey(compact, name, namespace), typeof value === "string" ? value : JSON.stringify(value)); }
  catch { /* Storage failure must not interrupt a live operating view. */ }
}
export function bandForRadio(frequencyHz?: number): string | null {
  if (frequencyHz == null || !Number.isFinite(frequencyHz)) return null;
  const khz = frequencyHz / 1000;
  return BAND_ORDER.find((band) => khz >= BAND_RANGES[band].low && khz <= BAND_RANGES[band].high) ?? null;
}
function opportunityStatus(spot: BandMapSpot): string {
  const call = text(spot.callStatus);
  const dxcc = text(spot.dxccStatus);
  if (dxcc === "ATNO" || dxcc.includes("/New ")) return dxcc;
  if (call.startsWith("New ")) return call;
  if (dxcc === "Confirmed" || call === "Confirmed") return "Confirmed";
  if (dxcc === "Worked" || call === "Worked") return "Worked";
  return dxcc || call || "Unknown";
}
export function opportunityCode(spot: BandMapSpot): string {
  const status = opportunityStatus(spot);
  return status === "Unknown" ? "--" : clusterStatusCode(status);
}
export function bandMapSpotColor(spot: BandMapSpot): string {
  if (hex(spot.statusHex)) return spot.statusHex;
  return paletteColor(opportunityStatus(spot), undefined, clusterStatusColors);
}
export function contestBandMapSpotWorked(spot:BandMapSpot):boolean{
  const status=opportunityStatus(spot).toLowerCase();
  return (finite(spot.workedBefore)??0)>0||spot.contestPoints===0||status.includes("worked")||status.includes("confirmed");
}
export function contestBandMapSpotColor(spot:BandMapSpot):string{
  if(contestBandMapSpotWorked(spot))return "#8b98a5";
  const points=finite(spot.contestPoints);return points===1?"#4da3ff":points===3?"#ff5b5b":points!==null?"#f4b942":bandMapSpotColor(spot);
}
function contestPointDescription(spot:BandMapSpot):string{
  const points=finite(spot.contestPoints);if(points===null)return "Contest points unavailable";
  return `${points} contest point${points===1?"":"s"} · ${points===0?"worked or zero-point":points===1?"blue":points===3?"red":"other-point"}`;
}
function bandColor(band: string, spots: BandMapSpot[]): string {
  const configured = spots.find((spot) => spot.band === band && hex(spot.bandHex))?.bandHex;
  return hex(configured) ? configured : clusterBandColors[band] ?? clusterBandColors.Unknown;
}
function modeGroup(mode: string): "cw" | "phone" | "data" {
  const upper = mode.toUpperCase();
  if (upper === "CW" || upper === "CWR") return "cw";
  if (["SSB", "USB", "LSB", "AM", "FM", "NFM"].includes(upper)) return "phone";
  return "data";
}
function matchesStatus(spot: BandMapSpot, scope: string): boolean {
  if (scope === "all") return true;
  const both = `${text(spot.callStatus)} ${text(spot.dxccStatus)}`.toLowerCase();
  if (scope === "needed") return both.includes("new") || both.includes("atno") || both.includes("need");
  if (scope === "confirmed") return both.includes("confirmed");
  if (scope === "worked") return both.includes("worked") && !both.includes("confirmed");
  return (finite(spot.score) ?? 0) >= 50 || (Array.isArray(spot.specialTags) && spot.specialTags.length > 0);
}
function normalizeSpots(spots: BandMapSpot[], band: string, view: ViewRange): BandMapSpot[] {
  return spots.filter((spot) => spot.band === band && finite(spot.frequencyKHz) !== null
    && spot.frequencyKHz >= view.low && spot.frequencyKHz <= view.high
    && text(spot.callsign).trim().length > 0);
}

export function bandMapLaneGeometry(width: number, fontScale = 1, minimumLaneWidth = 112 * fontScale) {
  // A grouped kHz label (14,023.7) and its tick must fit at every scale.
  const desiredAxis = Math.max(70, Math.ceil(8 * 9 * fontScale * 0.64 + 18));
  const axis = Math.min(desiredAxis, Math.max(54, width - 48));
  const laneCount = Math.max(1, Math.min(6, Math.floor((Math.max(180, width) - axis - 12) / Math.max(1,minimumLaneWidth))));
  return { axis, laneCount, laneWidth: (width - axis - 8) / laneCount };
}

export function bandMapOverflowHeight(fontScale = 1): number {
  // One explicit 1.3em line, padding/borders, bottom inset and label clearance.
  return Math.ceil(12 * fontScale * 0.8 * 1.3) + 16;
}

export function bandMapSpotWidth(spots: BandMapSpot[], laneWidth: number, fontScale = 1, contestPresentation = false): number {
  // Monospace glyphs are normally 0.6em wide; 0.64em leaves room for font
  // fallback/rounding without measuring text during live cluster updates.
  // The status uses 0.86 of the callsign font; padding, border and gap add 15px.
  const contentWidth = Math.max(0, ...spots.map(spot =>
    (text(spot.callsign).length + (contestPresentation?0:opportunityCode(spot).length * 0.86)) * 10 * fontScale * 0.64));
  return Math.min(Math.ceil(contentWidth + 15), Math.max(0, laneWidth - 5));
}

// Fixed-size lanes guarantee non-overlapping labels even when many spots share one frequency.
export function placeSpots(spots: BandMapSpot[], view: ViewRange, width: number, height: number, fontScale = 1,
    minimumLaneWidth?:number): { placed: PlacedSpot[]; hidden: number } {
  const { laneCount } = bandMapLaneGeometry(width, fontScale, minimumLaneWidth);
  const slotHeight = Math.max(25, 23 * fontScale);
  const slotsIn = (available: number) => Math.max(0, Math.floor(Math.min(available, Math.max(100, available - 8)) / slotHeight));
  // A notice needs its own space only when the full chart cannot fit the spots.
  const usableHeight = spots.length > laneCount * slotsIn(height) ? Math.max(0, height - bandMapOverflowHeight(fontScale)) : height;
  const slotCount = slotsIn(usableHeight);
  const occupied = Array.from({ length: laneCount }, () => new Set<number>());
  const ordered = [...spots].sort((a, b) => b.frequencyKHz - a.frequencyKHz || text(a.callsign).localeCompare(text(b.callsign)));
  const placed: PlacedSpot[] = [];
  let hidden = 0;
  for (const [index, spot] of ordered.entries()) {
    const fraction = (spot.frequencyKHz - view.low) / Math.max(1, view.high - view.low);
    const desired = Math.max(0, Math.min(slotCount - 1, Math.round(fraction * (slotCount - 1))));
    let best: { lane: number; slot: number; cost: number } | null = null;
    for (let lane = 0; lane < laneCount; lane++) {
      for (let slot = 0; slot < slotCount; slot++) {
        if (occupied[lane].has(slot)) continue;
        const cost = Math.abs(slot - desired) * 10 + lane;
        if (!best || cost < best.cost) best = { lane, slot, cost };
      }
    }
    if (!best) { hidden++; continue; }
    occupied[best.lane].add(best.slot);
    placed.push({ spot, lane: best.lane, top: (best.slot + 0.5) * slotHeight,
      anchorTop: Math.max(1, Math.min(Math.max(1, usableHeight - 1), fraction * usableHeight)),
      key: `${text(spot.id) || text(spot.callsign)}-${index}` });
  }
  return { placed, hidden };
}

function BandPanel({ band, spots, onSelect, onRemove, canRemove, compact, fontScale, resolution, onManualView, focusFrequencyKHz, hidden: panelHidden = false, modeSettings,
    selectedSpotId, onSpotContextMenu, contestPresentation = false }: {
  band: string; spots: BandMapSpot[]; onSelect: Props["onSelect"]; onRemove: () => void;
  canRemove: boolean; compact: boolean; fontScale: number; resolution: BandMapResolution; onManualView: () => void; focusFrequencyKHz?: number; hidden?: boolean; modeSettings?: { modes: readonly BandMapMode[]; setModes: (modes: BandMapMode[]) => void };
  selectedSpotId?: string | null; onSpotContextMenu?: Props["onSpotContextMenu"];
  contestPresentation?: boolean;
}) {
  const full = BAND_RANGES[band];
  const [view, setView] = useState<ViewRange>({ low: full.low, high: full.high });
  const [width, setWidth] = useState(340);
  const chartRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view); viewRef.current = view;
  const drag = useRef<{ id: number; y: number; view: ViewRange; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const zoomed = view.high - view.low < full.high - full.low;
  const [chartHeight, setChartHeight] = useState(compact ? 336 : 520);
  const focusRef = useRef(focusFrequencyKHz); focusRef.current = focusFrequencyKHz;
  const previousResolution = useRef<BandMapResolution | null>(null);
  useEffect(() => {
    const target = chartRef.current;
    if (!target) return;
    const update = () => {
      setWidth(target.clientWidth || 340);
      if (target.clientHeight > 0) setChartHeight(target.clientHeight);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(target);
    return () => observer.disconnect();
  }, [compact]);
  useEffect(() => {
    const changed = previousResolution.current !== resolution;
    previousResolution.current = resolution;
    if (resolution === "custom") return;
    if (resolution === "full") { if (changed) setView({ low: full.low, high: full.high }); return; }
    setView(current => {
      const span = Math.min(full.high - full.low, Math.max(2, chartHeight / resolution));
      const centre = changed && focusRef.current != null ? focusRef.current : (current.low + current.high) / 2;
      const low = Math.max(full.low, Math.min(full.high - span, centre - span / 2));
      return { low, high: low + span };
    });
  }, [resolution, chartHeight, full.low, full.high]);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const wheel = (event: WheelEvent) => {
      const current = viewRef.current;
      const span = current.high - current.low;
      if (event.ctrlKey || span >= full.high - full.low || !event.deltaY) return;
      event.preventDefault();
      const height = chart.clientHeight || 520;
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
      onManualView();
      setView(value => panBandRange(value, full, Math.max(-height, Math.min(height, pixels)) / height * span));
    };
    chart.addEventListener("wheel", wheel, { passive: false });
    return () => chart.removeEventListener("wheel", wheel);
  }, [full, onManualView]);
  const visible = useMemo(() => normalizeSpots(spots, band, view), [spots, band, view]);
  const contestSpotWidth=contestPresentation?bandMapSpotWidth(visible,Number.POSITIVE_INFINITY,fontScale,true):undefined;
  const { placed, hidden } = useMemo(() => placeSpots(visible, view, width, chartHeight, fontScale,contestSpotWidth), [visible, view, width, chartHeight, fontScale,contestSpotWidth]);
  const { axis, laneWidth } = bandMapLaneGeometry(width, fontScale,contestSpotWidth);
  const spotWidth = bandMapSpotWidth(visible, laneWidth, fontScale,contestPresentation);
  // Allocation captions can use the chart's right gutter only if a complete
  // PHONE label fits clear of the last lane; the legend/select cover tight maps.
  const allocationCaptionsFit = !placed.length || 8 + (laneWidth - spotWidth) / 2 >= Math.ceil(5 * 12 * 0.67 * fontScale * 0.64 + 12);
  const allBandCount = spots.filter((spot) => spot.band === band && finite(spot.frequencyKHz) !== null).length;
  const selectedSegment = full.allocations.find((part) => part.low === view.low && part.high === view.high);
  const segmentName = selectedSegment ? `${selectedSegment.name} portion` : view.low === full.low && view.high === full.high ? "Full band" : "Custom range";
  const rangeLabel = `${(view.low / 1000).toFixed(3)}–${(view.high / 1000).toFixed(3)} MHz`;
  const pan = (direction: number) => { onManualView(); setView((current) => {
    const span = current.high - current.low;
    return panBandRange(current, full, direction * span * 0.3);
  }); };
  const zoom = (factor: number) => { onManualView(); setView((current) => {
    const span = Math.min(full.high - full.low, Math.max(2, (full.high - full.low) / 80, (current.high - current.low) * factor));
    const centre = (current.low + current.high) / 2;
    const low = Math.max(full.low, Math.min(full.high - span, centre - span / 2));
    return { low, high: low + span };
  }); };
  return <section className="band-map-panel" hidden={panelHidden} aria-label={`${band} band map`} style={{ "--band-accent": bandColor(band, spots), "--band-font-scale": fontScale } as CSSProperties}>
    <header className="band-map-panel-head"><span className="band-map-accent" aria-hidden="true" /><strong>{band}</strong><small>{visible.length}/{allBandCount} spots</small>{modeSettings ? <details className="band-maps-mode-picker band-map-settings" onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
      <summary aria-label={`${band} mode visibility settings`} title="Mode visibility"><Settings size={15} /></summary>
      <div className="band-maps-mode-options" role="group" aria-label={`${band} visible modes`}>{BAND_MAP_MODES.map(mode => <label key={mode}><input type="checkbox" checked={modeSettings.modes.includes(mode)} onChange={event => modeSettings.setModes(BAND_MAP_MODES.filter(item => item === mode ? event.target.checked : modeSettings.modes.includes(item)))} />{mode === "cw" ? "CW" : mode === "phone" ? "SSB / Phone" : "Data"}</label>)}</div>
    </details> : <button type="button" title={`Close ${band} band map`} aria-label={`Close ${band} band map`} disabled={!canRemove} onClick={onRemove}><X size={13} /></button>}</header>
    <div className="band-map-panel-tools"><label><span className="sr-only">{band} allocation</span><select aria-label={`${band} allocation`} value={segmentName} onChange={(event) => {
      const part = full.allocations.find((item) => `${item.name} portion` === event.target.value);
      onManualView();
      setView(part ? { low: part.low, high: part.high } : { low: full.low, high: full.high });
    }}><option>Full band</option>{full.allocations.map((part) => <option key={part.name}>{part.name} portion</option>)}{segmentName === "Custom range" && <option>Custom range</option>}</select></label>
      <div className="band-map-tool-buttons"><button type="button" aria-label={`Pan ${band} lower`} title="Lower frequencies" onClick={() => pan(-1)}><ArrowUp size={13} /></button><button type="button" aria-label={`Pan ${band} higher`} title="Higher frequencies" onClick={() => pan(1)}><ArrowDown size={13} /></button><button type="button" aria-label={`Zoom ${band} out`} title="Zoom out" onClick={() => zoom(1.55)}>{contestPresentation ? "−" : <ZoomOut size={13} />}</button><button type="button" aria-label={`Zoom ${band} in`} title="Zoom in" onClick={() => zoom(0.62)}>{contestPresentation ? "+" : <ZoomIn size={13} />}</button><button type="button" aria-label={`Reset ${band} range`} title="Full band" onClick={() => { onManualView(); setView({ low: full.low, high: full.high }); }}><RotateCcw size={13} /></button></div>
    </div>
    <div className={`band-map-chart${zoomed ? " is-zoomed" : ""}${dragging ? " is-dragging" : ""}`} ref={chartRef} aria-label={`${band} spectrum, ${rangeLabel}`} style={{ "--band-axis-width": `${axis}px` } as CSSProperties}
      onPointerDown={event => {
        if (drag.current) return;
        suppressClick.current = false;
        if (!zoomed || event.button !== 0) return;
        drag.current = { id: event.pointerId, y: event.clientY, view, moved: false };
      }}
      onPointerMove={event => {
        const start = drag.current;
        if (!start || start.id !== event.pointerId) return;
        const delta = event.clientY - start.y;
        if (!start.moved && Math.abs(delta) < 5) return;
        if (!start.moved) { start.moved = true; suppressClick.current = true; setDragging(true); onManualView(); event.currentTarget.setPointerCapture(event.pointerId); }
        event.preventDefault();
        setView(panBandRange(start.view, full, -delta / (event.currentTarget.clientHeight || 520) * (start.view.high - start.view.low)));
      }}
      onPointerUp={event => {
        if (drag.current?.id !== event.pointerId) return;
        drag.current = null; setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={event => { if (drag.current?.id === event.pointerId) { drag.current = null; setDragging(false); } }}
      onLostPointerCapture={event => { if (drag.current?.id === event.pointerId) { drag.current = null; setDragging(false); } }}
      onClickCapture={event => { if (suppressClick.current && event.detail !== 0) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}>
      {full.allocations.map((part) => {
        const low = Math.max(view.low, part.low);
        const high = Math.min(view.high, part.high);
        if (high <= low) return null;
        const span = view.high - view.low;
        return <div key={part.name} className={`band-map-allocation band-map-${part.name.toLowerCase()}`} style={{ top: `${((low - view.low) / span) * 100}%`, height: `${((high - low) / span) * 100}%` }} aria-hidden="true">{allocationCaptionsFit && <span>{part.name.toUpperCase()}</span>}</div>;
      })}
      {bandMapFrequencyTicks(view, chartHeight, fontScale).map((frequency, index, ticks) => {
        const fraction = (frequency - view.low) / (view.high - view.low);
        return <div key={frequency} className="band-map-gridline" data-edge={index === 0 ? "upper" : index === ticks.length - 1 ? "lower" : undefined} style={{ top: `${fraction * 100}%` }} aria-hidden="true"><span>{formatBandMapFrequency(frequency)}</span></div>;
      })}
      {placed.map(({ spot, lane, top, anchorTop, key }) => {
        const color = contestPresentation?contestBandMapSpotColor(spot):bandMapSpotColor(spot);
        const code = contestPresentation?"":opportunityCode(spot);
        const tooltip = `${text(spot.callsign)} · ${(spot.frequencyKHz / 1000).toFixed(6)} MHz · ${text(spot.mode)} · ${text(spot.callStatus)} · ${text(spot.dxccStatus)}${contestPresentation?` · ${contestPointDescription(spot)}`:""}${spot.country ? ` · ${countryDisplay(spot.country)}` : ""}${spot.comment ? ` · ${text(spot.comment)}` : ""}`;
        const centre = axis + laneWidth * (lane + 0.5);
        return <Fragment key={key}><span className="band-map-spot-anchor" aria-hidden="true" style={{ top: anchorTop, left: axis - 4, width: Math.max(8, centre - axis + 4), color }} />
          <button type="button" className={`band-map-spot${spot.marked ? " is-marked" : ""}${selectedSpotId === String(spot.id) ? " is-selected" : ""}`}
            style={{ top, left: centre, width: spotWidth, color }} title={tooltip} aria-label={`${tooltip}${spot.marked ? " · Marked" : ""}`}
            aria-current={selectedSpotId === String(spot.id) ? "true" : undefined} onClick={() => onSelect(spot)}
             onContextMenu={event => onSpotContextMenu?.(spot, event)}><strong>{text(spot.callsign)}</strong>{spot.marked && <span aria-label="Marked">★</span>}{code&&<b>{code}</b>}</button></Fragment>;
      })}
      {hidden > 0 && <span className="band-map-overflow" role="status" aria-label={`${hidden} more spots; zoom in to separate labels`} title={`${hidden} more spots; zoom in to separate labels`}>{hidden} more · zoom in</span>}
    </div>
    <footer className="band-map-panel-foot"><div className="band-map-legend"><span>CW</span><span>Data</span><span>Phone</span></div><output>{rangeLabel}</output></footer>
  </section>;
}

export function BandMaps({ spots, onSelect, radioFrequencyHz, observedReceiveBandwidthHz, compact = false, preferences, onPreferencesChange, onDock, onUndock, focusedBand, onFocusedBandChange,
  storageNamespace, selectedSpotId, onSpotContextMenu, contestPresentation = false, selectionHint = "Select a marker to load it into the logger." }: Props) {
  const toolbarHost = useContext(BandMapsToolbarContext);
  const radioBand = bandForRadio(radioFrequencyHz);
  const [contestBand, setContestBand] = useState(() => radioBand ?? "20m");
  const activeFocusedBand = focusedBand ?? (contestPresentation ? contestBand : undefined);
  const controlKey = (name: string) => controlStorageKey(compact, Boolean(activeFocusedBand), name, storageNamespace);
  const [localBands, setLocalBands] = useState(() => storedBands(compact, storageNamespace));
  const [localFollow, setLocalFollow] = useState(() => storedFlag(compact, "followRadio", false, storageNamespace));
  const [localLayout, setLocalLayout] = useState<"row" | "grid">(() => {
    try { return localStorage.getItem(storageKey(compact, "layout", storageNamespace)) === "row" ? "row" : "grid"; }
    catch { return "grid"; }
  });
  const [localFontScale, setLocalFontScale] = useState(() => {
    try { const value = Number(localStorage.getItem(storageKey(compact, "fontScale", storageNamespace))); return value >= 0.8 && value <= 2 ? value : 1; }
    catch { return 1; }
  });
  const [resolution, setResolution] = useState<BandMapResolution>(() => {
    try {
      const stored = localStorage.getItem(controlKey("resolution"));
      if (stored === "full") return "full";
      const value = Number(stored);
      return BAND_MAP_RESOLUTIONS.includes(value as typeof BAND_MAP_RESOLUTIONS[number]) ? value as typeof BAND_MAP_RESOLUTIONS[number] : "full";
    } catch { return "full"; }
  });
  const [spotAgeMinutes, setSpotAgeMinutes] = useState(() => storedNumber(controlKey("ageMinutes"), BAND_MAP_AGES, 30));
  const [showWorked,setShowWorked]=useState(()=>storedFlag(compact,"showWorked",false,storageNamespace));
  const [ageClock, setAgeClock] = useState(() => Date.now());
  const bands = activeFocusedBand ? [activeFocusedBand] : preferences?.bands ?? localBands;
  const follow = activeFocusedBand ? false : preferences?.followRadio ?? localFollow;
  const layout = preferences?.layout ?? localLayout;
  const fontScale = preferences?.fontScale ?? localFontScale;
  const panelsRef = useRef<HTMLDivElement>(null);
  const [panelSize, setPanelSize] = useState({ width: 1100, height: 600 });
  const [page, setPage] = useState(0);
  useEffect(() => {
    const target = panelsRef.current;
    if (!target) return;
    const measure = () => {
      if (target.clientWidth > 0 && target.clientHeight > 0) {
        const width = target.clientWidth, height = target.clientHeight;
        setPanelSize(old => old.width === width && old.height === height ? old : { width, height });
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure); observer.observe(target);
    return () => observer.disconnect();
  }, []);
  const { columns, capacity } = bandMapCapacity(panelSize.width, panelSize.height, compact || layout === "row", bands.length);
  const pages = Math.max(1, Math.ceil(bands.length / capacity));
  const visiblePage = Math.min(page, pages - 1), firstBand = visiblePage * capacity;
  const visibleCount = Math.min(capacity, bands.length - firstBand);
  const setBands = (next: string[] | ((current: string[]) => string[])) => {
    const value = typeof next === "function" ? next(bands) : next;
    if (preferences) onPreferencesChange?.({ ...preferences, bands: value });
    else setLocalBands(value);
  };
  const setFollow = (value: boolean) => {
    if (preferences) onPreferencesChange?.({ ...preferences, followRadio: value });
    else setLocalFollow(value);
  };
  const setLayout = (value: "row" | "grid") => {
    if (preferences) onPreferencesChange?.({ ...preferences, layout: value });
    else setLocalLayout(value);
  };
  const setFontScale = (next: number | ((current: number) => number)) => {
    const value = typeof next === "function" ? next(fontScale) : next;
    if (preferences) onPreferencesChange?.({ ...preferences, fontScale: value });
    else setLocalFontScale(value);
  };
  const selectBands = (nextBands: string[]) => {
    if (preferences) onPreferencesChange?.({ ...preferences, bands: nextBands, followRadio: false });
    else { setLocalFollow(false); setLocalBands(nextBands); }
  };
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [localModes, setLocalModes] = useState<BandMapMode[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey(compact, "modes", storageNamespace)) || "null");
      if (Array.isArray(saved) && saved.every(mode => BAND_MAP_MODES.includes(mode))) return [...new Set(saved)] as BandMapMode[];
    } catch { /* Missing or invalid legacy preference means all modes. */ }
    return [...BAND_MAP_MODES];
  });
  const modes = preferences ? preferences.modes ?? BAND_MAP_MODES : localModes;
  const setModes = (value: BandMapMode[]) => {
    if (preferences) onPreferencesChange?.({ ...preferences, modes: value });
    else setLocalModes(value);
  };
  const [selected, setSelected] = useState<BandMapSpot | null>(null);
  useEffect(() => { if (contestPresentation && radioBand) setContestBand(radioBand); }, [contestPresentation, radioBand]);
  useEffect(() => { if (follow && radioBand && (bands.length !== 1 || bands[0] !== radioBand)) setBands([radioBand]); }, [follow, radioBand, bands]);
  useEffect(() => { if (!preferences) store(compact, "bands", bands, storageNamespace); }, [bands, compact, preferences, storageNamespace]);
  useEffect(() => { if (!preferences) store(compact, "followRadio", follow, storageNamespace); }, [follow, compact, preferences, storageNamespace]);
  useEffect(() => { if (!preferences) store(compact, "layout", layout, storageNamespace); }, [layout, compact, preferences, storageNamespace]);
  useEffect(() => { if (!preferences) store(compact, "fontScale", String(fontScale), storageNamespace); }, [fontScale, compact, preferences, storageNamespace]);
  useEffect(() => { if (!preferences) store(compact, "modes", modes, storageNamespace); }, [modes, compact, preferences, storageNamespace]);
  useEffect(() => { if (resolution !== "custom") storeAt(controlKey("resolution"), String(resolution)); }, [resolution, compact, activeFocusedBand]);
  useEffect(() => { storeAt(controlKey("ageMinutes"), String(spotAgeMinutes)); }, [spotAgeMinutes, compact, activeFocusedBand]);
  useEffect(()=>{if(contestPresentation)store(compact,"showWorked",showWorked,storageNamespace);},[compact,contestPresentation,showWorked,storageNamespace]);
  useEffect(() => { const timer = window.setInterval(() => setAgeClock(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const recentUnique = useMemo(() => deduplicateBandMapSpots(filterRecentBandMapSpots(spots, spotAgeMinutes, ageClock)), [spots, spotAgeMinutes, ageClock]);
  const contestVisible=useMemo(()=>contestPresentation&&!showWorked?recentUnique.filter(spot=>!contestBandMapSpotWorked(spot)):recentUnique,
    [contestPresentation,recentUnique,showWorked]);
  const filtered = useMemo(() => compact ? contestVisible : contestVisible.filter((spot) => {
    const needle = query.trim().toLowerCase();
    return (!needle || [spot.callsign, spot.country, spot.comment, spot.source].some((part) => text(part).toLowerCase().includes(needle)))
      && matchesStatus(spot, status) && modes.includes(modeGroup(text(spot.mode)));
  }), [contestVisible, compact, query, status, modes]);
  const add = (band: string) => {
    if (!(band in BAND_RANGES)) return;
    const next = bands.includes(band) ? bands : [...bands, band];
    const nextCapacity = bandMapCapacity(panelSize.width, panelSize.height, compact || layout === "row", next.length).capacity;
    setPage(Math.floor(next.indexOf(band) / nextCapacity));
    selectBands(next);
  };
  const remove = (band: string) => { if (bands.length <= 1) return; selectBands(bands.filter((item) => item !== band)); };
  const choose = (spot: BandMapSpot) => { setSelected(spot); onSelect(spot); };
  const markCustom = useCallback(() => setResolution(current => current === "custom" ? current : "custom"), []);
  const toolbarControls = <div className="band-maps-head-controls"><label className="band-maps-follow"><input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} /> Follow radio</label>
        {typeof observedReceiveBandwidthHz === "number" && Number.isFinite(observedReceiveBandwidthHz) && observedReceiveBandwidthHz > 0 &&
          <output aria-label="Observed receive-filter bandwidth">RX filter {new Intl.NumberFormat("en-US").format(observedReceiveBandwidthHz)} Hz</output>}
        <div className="band-maps-scale"><button type="button" aria-label="Decrease band map text size" disabled={fontScale <= 0.8} onClick={() => setFontScale((value) => Math.max(0.8, +(value - 0.1).toFixed(1)))}>A−</button><output>{Math.round(fontScale * 100)}%</output><button type="button" aria-label="Increase band map text size" disabled={fontScale >= 2} onClick={() => setFontScale((value) => Math.min(2, +(value + 0.1).toFixed(1)))}>A+</button></div>
        {!compact && <div className="band-maps-layout" role="group" aria-label="Band map layout"><button type="button" aria-pressed={layout === "row"} onClick={() => setLayout("row")}>Single row</button><button type="button" aria-pressed={layout === "grid"} onClick={() => setLayout("grid")}>Adaptive grid</button></div>}
        {pages > 1 && <div className="band-maps-pages" role="group" aria-label="Band map pages"><button type="button" aria-label="Previous band maps" disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>‹</button><output aria-live="polite">{visiblePage + 1} / {pages}</output><button type="button" aria-label="Next band maps" disabled={visiblePage === pages - 1} onClick={() => setPage(visiblePage + 1)}>›</button></div>}
        <label className="band-maps-add"><span className="sr-only">Add band map</span><select aria-label="Add band map" value="" onChange={(event) => { const value = event.target.value; if (value === "all") selectBands(BAND_ORDER); else add(value); event.target.value = ""; }}><option value="">Add band map</option><option value="all">All bands</option>{BAND_ORDER.filter((band) => !bands.includes(band)).map((band) => <option key={band} value={band}>{band}</option>)}</select></label>
        {onUndock && <button type="button" onClick={onUndock}>Undock</button>}
        {onDock && <button type="button" onClick={onDock}>Dock back</button>}
      </div>;
  return <section className={`band-maps${compact ? " band-maps-compact" : ""}${activeFocusedBand ? " band-maps-focused" : ""}${contestPresentation ? " band-maps-contest" : ""}`} aria-label="Band maps">
    {!activeFocusedBand && (compact && toolbarHost ? createPortal(toolbarControls, toolbarHost) : <header className="band-maps-head"><div><h2>Band maps</h2></div>{toolbarControls}</header>)}
    {!compact && !activeFocusedBand && <div className="band-maps-intelligence"><label className="band-maps-search">Search <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Call, country or note" /></label><label>Status <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All</option><option value="needed">Needed</option><option value="worked">Worked</option><option value="confirmed">Confirmed</option><option value="priority">Priority</option></select></label>
      <details className="band-maps-mode-picker" onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
        <summary>Modes · {modes.length === 3 ? "All" : modes.length === 0 ? "None" : modes.map(mode => mode === "cw" ? "CW" : mode === "data" ? "Data" : "Phone").join(" + ")}</summary>
        <div className="band-maps-mode-options" role="group" aria-label="Band map modes">
          <label><input type="checkbox" checked={modes.length === 3} onChange={event => setModes(event.target.checked ? [...BAND_MAP_MODES] : [])} />All modes</label>
          {BAND_MAP_MODES.map(mode => <label key={mode}><input type="checkbox" checked={modes.includes(mode)} onChange={event => setModes(BAND_MAP_MODES.filter(item => item === mode ? event.target.checked : modes.includes(item)))} />{mode === "cw" ? "CW" : mode === "data" ? "Data" : "Phone"}</label>)}
        </div>
      </details>
      <span className="band-maps-count">{filtered.length} of {recentUnique.length} spots</span><span className="band-maps-selected">{selected ? `${text(selected.callsign)} · ${opportunityCode(selected)} · ${clusterStatusCode(text(selected.callStatus))} · ${clusterStatusCode(text(selected.dxccStatus))}` : selectionHint}</span>{(query || status !== "all" || modes.length !== 3) && <button type="button" onClick={() => { setQuery(""); setStatus("all"); setModes([...BAND_MAP_MODES]); }}>Clear filters</button>}</div>}
    <div ref={panelsRef} className={`band-maps-panels band-maps-${compact || layout === "row" ? "row" : "grid"}`} style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(columns, visibleCount))}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.max(1, Math.ceil(visibleCount / columns))}, minmax(0, 1fr))` }}>
      {bands.map((band, index) => <BandPanel key={band} band={band} spots={filtered} onSelect={choose} onRemove={() => remove(band)} canRemove={bands.length > 1} compact={compact} fontScale={fontScale} resolution={resolution}
        onManualView={markCustom}
      focusFrequencyKHz={radioBand === band && radioFrequencyHz ? radioFrequencyHz / 1000 : finite(filtered.find(spot => spot.band === band)?.frequencyKHz) ?? undefined}
      selectedSpotId={selectedSpotId} onSpotContextMenu={onSpotContextMenu}
        hidden={index < firstBand || index >= firstBand + capacity} modeSettings={activeFocusedBand ? { modes, setModes } : undefined} contestPresentation={contestPresentation} />)}
    </div>
    <footer className="band-maps-quick-controls" aria-label="Band map view controls">
      {activeFocusedBand && typeof observedReceiveBandwidthHz === "number" && Number.isFinite(observedReceiveBandwidthHz) && observedReceiveBandwidthHz > 0 &&
        <output aria-label="Observed receive-filter bandwidth">RX filter {new Intl.NumberFormat("en-US").format(observedReceiveBandwidthHz)} Hz</output>}
      {activeFocusedBand && <label>Band<select aria-label="Band" value={activeFocusedBand} onChange={event => onFocusedBandChange ? onFocusedBandChange(event.target.value) : setContestBand(event.target.value)}>{BAND_ORDER.map(band => <option key={band}>{band}</option>)}</select></label>}
      <label>Resolution<select aria-label="Band map resolution" value={resolution} onChange={event => setResolution(event.target.value === "full" ? "full" : Number(event.target.value) as BandMapResolution)}><option value="full">Full band</option>{resolution === "custom" && <option value="custom">Custom</option>}{BAND_MAP_RESOLUTIONS.map(value => <option key={value} value={value}>{value} px/kHz</option>)}</select></label>
      <label>{contestPresentation ? "Clear older" : "Spot age"}<select aria-label="Spot age" value={spotAgeMinutes} onChange={event => setSpotAgeMinutes(Number(event.target.value) as typeof BAND_MAP_AGES[number])}>{BAND_MAP_AGES.map(value => <option key={value} value={value}>{value} min</option>)}</select></label>
      {contestPresentation&&<label><input type="checkbox" checked={showWorked} onChange={event=>setShowWorked(event.target.checked)}/>Show worked</label>}
    </footer>
  </section>;
}

export default BandMaps;

import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { ArrowDown, ArrowUp, RotateCcw, Settings, X, ZoomIn, ZoomOut } from "lucide-react";
import { clusterBandColors, clusterStatusCode, clusterStatusColors, paletteColor } from "./clusterPalette";
import { countryDisplay } from "./countryDisplay";
import { BAND_ORDER, BAND_RANGES, bandForRadio } from "./band";
export { BAND_ORDER, BAND_RANGES, bandForRadio } from "./band";
import { contestModeForSpot, visibleContestBandRange, type ContestBandMode, type ContestBandPlanEntry } from "../contesting/contestBandPlan";
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
  contestPresentation?: boolean; contestBandPlan?: ContestBandPlanEntry[]; contestBands?: readonly string[];
  contestAllowedModes?: readonly ContestBandMode[]; showWorked?: boolean; onShowWorkedChange?: (showWorked: boolean) => void };
type ViewRange = { low: number; high: number };
type PlacedSpot = { spot: BandMapSpot; top: number; anchorTop: number; lane: number; key: string };
export function panBandRange(view: ViewRange, full: ViewRange, delta: number): ViewRange {
  const span = view.high - view.low;
  const low = Math.max(full.low, Math.min(full.high - span, view.low + delta));
  return { low, high: low + span };
}

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

export function deduplicateBandMapSpots<T extends BandMapSpot>(spots: T[], latestCallOnly = false): T[] {
  const groups = new Map<string, { rows: Array<{ spot: T; timestamp: number; index: number; tie: string }>; index: number }>();
  spots.forEach((spot, index) => {
    const callsign = text(spot.callsign).trim().toUpperCase();
    const frequency = finite(spot.frequencyKHz);
    const mode = text(spot.mode).trim().toUpperCase();
    // Contest band maps keep only the latest report for a callsign on a band;
    // normal maps retain a real QSY and merge only the displayed 100 Hz slot.
    const band = text(spot.band).trim().toUpperCase();
    const key = callsign && frequency !== null ? latestCallOnly
      ? `${callsign}\u0000${mode}\u0000${band}`
      : `${callsign}\u0000${mode}\u0000${Math.round(frequency * 10)}` : `unkeyed\u0000${index}`;
    const timestamp = receivedAtMilliseconds(spot.receivedAt) ?? -Infinity;
    const tie = text(spot.id);
    const match = groups.get(key);
    if (!match) groups.set(key, { rows: [{ spot, timestamp, index, tie }], index });
    else match.rows.push({ spot, timestamp, index, tie });
  });
  return [...groups.values()].sort((a, b) => a.index - b.index).map(group => {
    const rows = [...group.rows].sort((a, b) => b.timestamp - a.timestamp || b.tie.localeCompare(a.tie) || b.index - a.index);
    const latest = rows[0].spot;
    // A feed copy with a missing contest preview must never override another
    // copy that already carries the authoritative worked/multiplier result.
    // A just-logged QSO can race another feed copy whose earlier preview still
    // says the occurrence is workable. Worked is monotonic within this one
    // callsign/frequency/mode occurrence: retain the fresh duplicate result as
    // soon as any authoritative copy carries it, then let the next complete
    // projection reconcile the remaining scoring fields.
    const classified = rows.find(row => row.spot.contestDupe === true) ??
      rows.find(row => row.spot.contestDupe !== null && row.spot.contestDupe !== undefined);
    return classified ? { ...latest,
      contestPoints: classified.spot.contestPoints,
      contestDupe: classified.spot.contestDupe,
      contestMultiplierCount: classified.spot.contestMultiplierCount,
      contestCountryMultiplier: classified.spot.contestCountryMultiplier,
      contestZoneMultiplier: classified.spot.contestZoneMultiplier } : latest;
  });
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
  return spot.contestDupe===true;
}
export function contestNeededMultiplierCount(spot:BandMapSpot):number|null{
  if(typeof spot.contestCountryMultiplier==="boolean"&&typeof spot.contestZoneMultiplier==="boolean")
    return Number(spot.contestCountryMultiplier)+Number(spot.contestZoneMultiplier);
  return finite(spot.contestMultiplierCount);
}
export function contestBandMapMultiplierLabel(spot:BandMapSpot):string{
  if(spot.contestCountryMultiplier===true&&spot.contestZoneMultiplier===true)return "C+Z";
  if(spot.contestCountryMultiplier===true&&spot.contestZoneMultiplier===false)return "C";
  if(spot.contestCountryMultiplier===false&&spot.contestZoneMultiplier===true)return "Z";
  if(spot.contestCountryMultiplier===false&&spot.contestZoneMultiplier===false)return "—";
  const count=finite(spot.contestMultiplierCount);return count===null?"?":count===0?"—":String(count);
}
export function contestBandMapSpotColor(spot:BandMapSpot):string{
  if(contestBandMapSpotWorked(spot))return "#aeb5b7";
  const multipliers=contestNeededMultiplierCount(spot);
  if(multipliers!==null&&multipliers>1)return "#00e51b";
  if(multipliers===1)return "#ff5267";
  if(multipliers===0&&spot.contestDupe===false)return "#3da5f4";
  return "#aeb5b7";
}
function contestPointDescription(spot:BandMapSpot):string{
  const points=finite(spot.contestPoints),pointLabel=points===null?"Points unavailable":`${points} pt`;
  if(spot.contestDupe===true)return `${pointLabel} · duplicate · grey`;
  const multipliers=contestNeededMultiplierCount(spot),country=spot.contestCountryMultiplier,zone=spot.contestZoneMultiplier;
  const needed=country===true&&zone===true?"country and CQ zone multipliers":country===true?"country multiplier":zone===true?"CQ zone multiplier":
    country===false&&zone===false?"no needed multiplier":`${multipliers??"?"} needed multiplier${multipliers===1?"":"s"}`;
  const color=multipliers!==null&&multipliers>1?"green":multipliers===1?"red":multipliers===0&&spot.contestDupe===false?"blue":"grey";
  return `${pointLabel} · ${needed} · ${color}`;
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
const contestModeLabel = (mode: ContestBandMode) => mode === "cw" ? "CW" : mode === "data" ? "Data" : "SSB";
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
    minimumLaneWidth?:number, contestPresentation = false): { placed: PlacedSpot[]; hidden: number } {
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
    const desired = Math.max(0, Math.min(slotCount - 1, Math.round(contestPresentation
      ? fraction * height / slotHeight - 0.5 : fraction * (slotCount - 1))));
    let best: { lane: number; slot: number; cost: number } | null = null;
    for (let lane = 0; lane < laneCount; lane++) {
      for (let slot = 0; slot < slotCount; slot++) {
        if (occupied[lane].has(slot)) continue;
        // In contest view, stack nearby calls vertically before spilling into
        // another column; their leaders retain the precise frequency anchor.
        const cost = Math.abs(slot - desired) * 10 + lane * (contestPresentation ? 30 : 1);
        if (!best || cost < best.cost) best = { lane, slot, cost };
      }
    }
    if (!best) { hidden++; continue; }
    occupied[best.lane].add(best.slot);
    placed.push({ spot, lane: best.lane, top: (best.slot + 0.5) * slotHeight,
      anchorTop: contestPresentation ? Math.max(0, Math.min(height, fraction * height))
        : Math.max(1, Math.min(Math.max(1, usableHeight - 1), fraction * usableHeight)),
      key: `${text(spot.id) || text(spot.callsign)}-${index}` });
  }
  return { placed, hidden };
}

function BandPanel({ band, spots, onSelect, onRemove, canRemove, compact, fontScale, resolution, onManualView, focusFrequencyKHz, hidden: panelHidden = false, modeSettings,
    radioFrequencyKHz, selectedSpotId, onSpotContextMenu, contestPresentation = false, contestBandPlan }: {
  band: string; spots: BandMapSpot[]; onSelect: Props["onSelect"]; onRemove: () => void;
  canRemove: boolean; compact: boolean; fontScale: number; resolution: BandMapResolution; onManualView: () => void; focusFrequencyKHz?: number; radioFrequencyKHz?: number; hidden?: boolean; modeSettings?: { modes: readonly BandMapMode[]; availableModes: readonly BandMapMode[]; setModes: (modes: BandMapMode[]) => void };
  selectedSpotId?: string | null; onSpotContextMenu?: Props["onSpotContextMenu"];
  contestPresentation?: boolean; contestBandPlan?: ContestBandPlanEntry[];
}) {
  const full = contestPresentation ? visibleContestBandRange(contestBandPlan?.find(entry => entry.band === band), modeSettings?.modes ?? BAND_MAP_MODES) ?? BAND_RANGES[band] : BAND_RANGES[band];
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
    if (resolution === "full") { setView(current => current.low === full.low && current.high === full.high ? current : { low: full.low, high: full.high }); return; }
    setView(current => {
      // Resolution is a stable operator zoom preset, not a request to expand
      // the frequency span again when the window becomes unusually tall.
      const densityHeight = Math.min(chartHeight, compact ? 336 : 520);
      const span = Math.min(full.high - full.low, Math.max(2, densityHeight / resolution));
      const centre = changed && focusRef.current != null ? focusRef.current : (current.low + current.high) / 2;
      const low = Math.max(full.low, Math.min(full.high - span, centre - span / 2));
      return { low, high: low + span };
    });
  }, [resolution, chartHeight, compact, full.low, full.high]);
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
  const { placed, hidden } = useMemo(() => placeSpots(visible, view, width, chartHeight, fontScale,contestSpotWidth,contestPresentation), [visible, view, width, chartHeight, fontScale,contestSpotWidth,contestPresentation]);
  const { axis, laneWidth } = bandMapLaneGeometry(width, fontScale,contestSpotWidth);
  const spotWidth = bandMapSpotWidth(visible, laneWidth, fontScale,contestPresentation);
  // Allocation captions can use the chart's right gutter only if a complete
  // PHONE label fits clear of the last lane; the legend/select cover tight maps.
  const allocationCaptionsFit = !placed.length || 8 + (laneWidth - spotWidth) / 2 >= Math.ceil(5 * 12 * 0.67 * fontScale * 0.64 + 12);
  const allBandCount = spots.filter((spot) => spot.band === band && finite(spot.frequencyKHz) !== null).length;
  const selectedSegment = full.allocations.find((part) => part.low === view.low && part.high === view.high);
  const segmentName = selectedSegment ? `${selectedSegment.name} portion` : view.low === full.low && view.high === full.high ? "Full band" : "Custom range";
  const rangeLabel = `${(view.low / 1000).toFixed(3)}–${(view.high / 1000).toFixed(3)} MHz`;
  const observedRadioFrequency = finite(radioFrequencyKHz);
  const visibleRadioFrequency = contestPresentation && observedRadioFrequency !== null
    && observedRadioFrequency >= view.low && observedRadioFrequency <= view.high
    ? observedRadioFrequency : null;
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
      <div className="band-maps-mode-options" role="group" aria-label={`${band} visible modes`}>{modeSettings.availableModes.map(mode => <label key={mode}><input type="checkbox" checked={modeSettings.modes.includes(mode)} onChange={event => modeSettings.setModes(modeSettings.availableModes.filter(item => item === mode ? event.target.checked : modeSettings.modes.includes(item)))} />{mode === "cw" ? "CW" : mode === "phone" ? "SSB / Phone" : "Data"}</label>)}</div>
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
      {visibleRadioFrequency !== null && <span className="band-map-vfo-marker" role="img"
        aria-label={`Current VFO ${(visibleRadioFrequency / 1000).toFixed(6)} MHz`}
        title={`Current VFO ${(visibleRadioFrequency / 1000).toFixed(6)} MHz`}
        style={{ top: `${((visibleRadioFrequency - view.low) / (view.high - view.low)) * 100}%`, left: axis - 5 }} />}
      {contestPresentation && <svg className="band-map-spot-leaders" aria-hidden="true" width={width} height={chartHeight}>
        {placed.map(({spot,lane,top,anchorTop,key}) => {
          const left=axis+laneWidth*(lane+0.5)-spotWidth/2;
          return <g key={key} style={{color:contestBandMapSpotColor(spot)}}>
            <path data-spot-id={String(spot.id)} d={`M ${axis} ${anchorTop} L ${left} ${top}`} />
            <circle cx={axis} cy={anchorTop} r={2} />
          </g>;
        })}
      </svg>}
      {placed.map(({ spot, lane, top, anchorTop, key }) => {
        const color = contestPresentation?contestBandMapSpotColor(spot):bandMapSpotColor(spot);
        const code = contestPresentation ? "" : opportunityCode(spot);
        const tooltip = `${text(spot.callsign)} · ${(spot.frequencyKHz / 1000).toFixed(6)} MHz · ${text(spot.mode)} · ${text(spot.callStatus)} · ${text(spot.dxccStatus)}${contestPresentation?` · ${contestPointDescription(spot)}`:""}${spot.country ? ` · ${countryDisplay(spot.country)}` : ""}${spot.comment ? ` · ${text(spot.comment)}` : ""}`;
        const centre = axis + laneWidth * (lane + 0.5);
        return <Fragment key={key}>{!contestPresentation && <span className="band-map-spot-anchor" aria-hidden="true" style={{ top: anchorTop, left: axis - 4, width: Math.max(8, centre - axis + 4), color }} />}
          <button type="button" className={`band-map-spot${contestPresentation && contestBandMapSpotWorked(spot) ? " is-worked" : ""}${spot.marked ? " is-marked" : ""}${selectedSpotId === String(spot.id) ? " is-selected" : ""}`}
            style={{ top, left: centre, width: spotWidth, color }} title={tooltip} aria-label={`${tooltip}${spot.marked ? " · Marked" : ""}`}
            aria-current={selectedSpotId === String(spot.id) ? "true" : undefined} onClick={() => onSelect(spot)}
             onContextMenu={event => onSpotContextMenu?.(spot, event)}><strong>{text(spot.callsign)}</strong>{spot.marked && !contestPresentation && <span aria-label="Marked">★</span>}{code&&<b>{code}</b>}</button></Fragment>;
      })}
      {hidden > 0 && <span className="band-map-overflow" role="status" aria-label={`${hidden} more spots; zoom in to separate labels`} title={`${hidden} more spots; zoom in to separate labels`}>{hidden} more · zoom in</span>}
    </div>
    <footer className="band-map-panel-foot"><div className="band-map-legend"><span>CW</span><span>Data</span><span>Phone</span></div><output>{rangeLabel}</output></footer>
  </section>;
}

export function BandMaps({ spots, onSelect, radioFrequencyHz, observedReceiveBandwidthHz, compact = false, preferences, onPreferencesChange, onDock, onUndock, focusedBand, onFocusedBandChange,
  storageNamespace, selectedSpotId, onSpotContextMenu, contestPresentation = false, contestBandPlan, contestBands, contestAllowedModes,
  showWorked: controlledShowWorked, onShowWorkedChange,
  selectionHint = "Select a marker to load it into the logger." }: Props) {
  const toolbarHost = useContext(BandMapsToolbarContext);
  const radioBand = bandForRadio(radioFrequencyHz);
  const availableContestBands = useMemo(() => {
    const configured = contestBands?.filter((band, index, values) => band in BAND_RANGES && values.indexOf(band) === index) ?? [];
    return contestPresentation && configured.length ? configured : BAND_ORDER;
  }, [contestBands, contestPresentation]);
  const allowedContestModes = useMemo<BandMapMode[]>(() => {
    const configured = contestAllowedModes?.filter((mode, index, values): mode is BandMapMode =>
      BAND_MAP_MODES.includes(mode as BandMapMode) && values.indexOf(mode) === index) ?? [];
    return contestPresentation && configured.length ? configured : [...BAND_MAP_MODES];
  }, [contestAllowedModes, contestPresentation]);
  const [contestBand, setContestBand] = useState(() => radioBand && availableContestBands.includes(radioBand) ? radioBand : availableContestBands[0] ?? "20m");
  const activeFocusedBand = focusedBand && availableContestBands.includes(focusedBand) ? focusedBand : contestPresentation ? contestBand : focusedBand;
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
  const [localShowWorked,setLocalShowWorked]=useState(()=>storedFlag(compact,"showWorked",false,storageNamespace));
  const showWorked=controlledShowWorked??localShowWorked;
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
      if (Array.isArray(saved) && saved.every(mode => BAND_MAP_MODES.includes(mode))) {
        const admitted = [...new Set(saved)].filter(mode => allowedContestModes.includes(mode)) as BandMapMode[];
        if (admitted.length || saved.length === 0) return admitted;
      }
    } catch { /* Missing or invalid legacy preference means all modes. */ }
    return [...allowedContestModes];
  });
  const requestedModes = preferences ? preferences.modes ?? allowedContestModes : localModes;
  const requestedAllowedModes = requestedModes.filter(mode => allowedContestModes.includes(mode));
  const modes = requestedAllowedModes.length || requestedModes.length === 0 ? requestedAllowedModes : allowedContestModes;
  const allAllowedModesSelected = modes.length === allowedContestModes.length && allowedContestModes.every(mode => modes.includes(mode));
  const setModes = (value: BandMapMode[]) => {
    const admitted = value.filter(mode => allowedContestModes.includes(mode));
    if (preferences) onPreferencesChange?.({ ...preferences, modes: admitted });
    else setLocalModes(admitted);
    setResolution("full");
  };
  const [selected, setSelected] = useState<BandMapSpot | null>(null);
  useEffect(() => {
    if (!contestPresentation) return;
    setContestBand(current => radioBand && availableContestBands.includes(radioBand) ? radioBand : availableContestBands.includes(current) ? current : availableContestBands[0] ?? "20m");
  }, [availableContestBands, contestPresentation, radioBand]);
  useEffect(() => {
    if (preferences) return;
    setLocalModes(current => {
      const admitted = current.filter(mode => allowedContestModes.includes(mode));
      if (admitted.length || current.length === 0) return admitted;
      return [...allowedContestModes];
    });
  }, [allowedContestModes, preferences]);
  useEffect(() => { if (follow && radioBand && (bands.length !== 1 || bands[0] !== radioBand)) setBands([radioBand]); }, [follow, radioBand, bands]);
  useEffect(() => { if (!preferences) store(compact, "bands", bands, storageNamespace); }, [bands, compact, preferences, storageNamespace]);
  useEffect(() => { if (!preferences) store(compact, "followRadio", follow, storageNamespace); }, [follow, compact, preferences, storageNamespace]);
  useEffect(() => { if (!preferences) store(compact, "layout", layout, storageNamespace); }, [layout, compact, preferences, storageNamespace]);
  useEffect(() => { if (!preferences) store(compact, "fontScale", String(fontScale), storageNamespace); }, [fontScale, compact, preferences, storageNamespace]);
  useEffect(() => { if (!preferences) store(compact, "modes", modes, storageNamespace); }, [modes, compact, preferences, storageNamespace]);
  useEffect(() => { if (resolution !== "custom") storeAt(controlKey("resolution"), String(resolution)); }, [resolution, compact, activeFocusedBand]);
  useEffect(() => { storeAt(controlKey("ageMinutes"), String(spotAgeMinutes)); }, [spotAgeMinutes, compact, activeFocusedBand]);
  useEffect(()=>{if(contestPresentation&&controlledShowWorked===undefined)store(compact,"showWorked",showWorked,storageNamespace);},
    [compact,contestPresentation,controlledShowWorked,showWorked,storageNamespace]);
  useEffect(() => { const timer = window.setInterval(() => setAgeClock(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const classifiedSpots = useMemo(() => contestPresentation ? spots.map(spot => {
    const entry = contestBandPlan?.find(item => item.band === spot.band);
    const frequency = finite(spot.frequencyKHz);
    const mode = !entry || frequency === null ? modeGroup(text(spot.mode)) : contestModeForSpot(entry,frequency,allowedContestModes,spot.comment);
    return { ...spot, mode: contestModeLabel(mode) };
  }) : spots, [allowedContestModes,contestBandPlan, contestPresentation, spots]);
  const recentUnique = useMemo(() => deduplicateBandMapSpots(filterRecentBandMapSpots(classifiedSpots, spotAgeMinutes, ageClock),contestPresentation),
    [classifiedSpots,spotAgeMinutes,ageClock,contestPresentation]);
  const contestVisible=useMemo(()=>contestPresentation&&!showWorked?recentUnique.filter(spot=>!contestBandMapSpotWorked(spot)):recentUnique,
    [contestPresentation,recentUnique,showWorked]);
  const filtered = useMemo(() => contestVisible.filter((spot) => {
    const needle = query.trim().toLowerCase();
    return modes.includes(modeGroup(text(spot.mode))) && (compact || ((!needle || [spot.callsign, spot.country, spot.comment, spot.source].some((part) => text(part).toLowerCase().includes(needle)))
      && matchesStatus(spot, status)));
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
        <summary>Modes · {allAllowedModesSelected ? "All" : modes.length === 0 ? "None" : modes.map(mode => mode === "cw" ? "CW" : mode === "data" ? "Data" : "Phone").join(" + ")}</summary>
        <div className="band-maps-mode-options" role="group" aria-label="Band map modes">
          <label><input type="checkbox" checked={modes.length === allowedContestModes.length} onChange={event => setModes(event.target.checked ? [...allowedContestModes] : [])} />All modes</label>
          {allowedContestModes.map(mode => <label key={mode}><input type="checkbox" checked={modes.includes(mode)} onChange={event => setModes(allowedContestModes.filter(item => item === mode ? event.target.checked : modes.includes(item)))} />{mode === "cw" ? "CW" : mode === "data" ? "Data" : "Phone"}</label>)}
        </div>
      </details>
      <span className="band-maps-count">{filtered.length} of {recentUnique.length} spots</span><span className="band-maps-selected">{selected ? `${text(selected.callsign)} · ${opportunityCode(selected)} · ${clusterStatusCode(text(selected.callStatus))} · ${clusterStatusCode(text(selected.dxccStatus))}` : selectionHint}</span>{(query || status !== "all" || !allAllowedModesSelected) && <button type="button" onClick={() => { setQuery(""); setStatus("all"); setModes([...allowedContestModes]); }}>Clear filters</button>}</div>}
    <div ref={panelsRef} className={`band-maps-panels band-maps-${compact || layout === "row" ? "row" : "grid"}`} style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(columns, visibleCount))}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.max(1, Math.ceil(visibleCount / columns))}, minmax(0, 1fr))` }}>
      {bands.map((band, index) => <BandPanel key={band} band={band} spots={filtered} onSelect={choose} onRemove={() => remove(band)} canRemove={bands.length > 1} compact={compact} fontScale={fontScale} resolution={resolution}
        onManualView={markCustom}
      focusFrequencyKHz={radioBand === band && radioFrequencyHz ? radioFrequencyHz / 1000 : finite(filtered.find(spot => spot.band === band)?.frequencyKHz) ?? undefined}
      radioFrequencyKHz={radioBand === band && radioFrequencyHz ? radioFrequencyHz / 1000 : undefined}
      selectedSpotId={selectedSpotId} onSpotContextMenu={onSpotContextMenu}
        hidden={index < firstBand || index >= firstBand + capacity} modeSettings={activeFocusedBand ? { modes, availableModes: allowedContestModes, setModes } : undefined} contestPresentation={contestPresentation} contestBandPlan={contestBandPlan} />)}
    </div>
    <footer className="band-maps-quick-controls" aria-label="Band map view controls">
      {contestPresentation&&<div className="contest-band-map-legend" aria-label="Contest spot colors">
        <span className="is-double">Double multiplier</span><span className="is-single">Single multiplier</span>
        <span className="is-qso">Valid QSO</span><span className="is-dupe">Dupe / non-workable</span>
      </div>}
      {activeFocusedBand && typeof observedReceiveBandwidthHz === "number" && Number.isFinite(observedReceiveBandwidthHz) && observedReceiveBandwidthHz > 0 &&
        <output aria-label="Observed receive-filter bandwidth">RX filter {new Intl.NumberFormat("en-US").format(observedReceiveBandwidthHz)} Hz</output>}
      {activeFocusedBand && <label>Band<select aria-label="Band" value={activeFocusedBand} onChange={event => onFocusedBandChange ? onFocusedBandChange(event.target.value) : setContestBand(event.target.value)}>{availableContestBands.map(band => <option key={band}>{band}</option>)}</select></label>}
      <label>Resolution<select aria-label="Band map resolution" value={resolution} onChange={event => setResolution(event.target.value === "full" ? "full" : Number(event.target.value) as BandMapResolution)}><option value="full">Full band</option>{resolution === "custom" && <option value="custom">Custom</option>}{BAND_MAP_RESOLUTIONS.map(value => <option key={value} value={value}>{value} px/kHz</option>)}</select></label>
      <label>{contestPresentation ? "Clear older" : "Spot age"}<select aria-label="Spot age" value={spotAgeMinutes} onChange={event => setSpotAgeMinutes(Number(event.target.value) as typeof BAND_MAP_AGES[number])}>{BAND_MAP_AGES.map(value => <option key={value} value={value}>{value} min</option>)}</select></label>
      {contestPresentation&&<label><input type="checkbox" checked={showWorked} onChange={event=>{
        const next=event.target.checked;if(controlledShowWorked===undefined)setLocalShowWorked(next);onShowWorkedChange?.(next);
      }}/>Show worked</label>}
    </footer>
  </section>;
}

export default BandMaps;

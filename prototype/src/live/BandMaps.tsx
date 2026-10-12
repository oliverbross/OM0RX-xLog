import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import { ArrowDown, ArrowUp, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { clusterBandColors, clusterStatusColors, paletteColor } from "./clusterPalette";
import "./BandMaps.css";

export type BandMapSpot = Record<string, any>;
// An explicit host slot lets compact maps share the workspace toolbar without
// changing ownership, remounting charts, or searching/moving DOM nodes.
export const BandMapsToolbarContext = createContext<HTMLElement | null>(null);
export const BAND_MAP_MODES = ["cw", "data", "phone"] as const;
export type BandMapMode = typeof BAND_MAP_MODES[number];
// Fit readable charts to the viewport; excess bands are paged, never clipped.
export function bandMapCapacity(width: number, height: number, singleRow: boolean, count: number) {
  const columns = Math.max(1, Math.min(count, Math.floor((Math.max(0, width - 20) + 10) / 270)));
  const rows = singleRow ? 1 : Math.max(1, Math.floor((Math.max(0, height - 20) + 10) / 240));
  return { columns, capacity: Math.max(1, columns * rows) };
}
export type BandMapViewPreferences = { bands: string[]; followRadio: boolean; layout: "row" | "grid"; fontScale: number; modes?: BandMapMode[] };
type Props = { spots: BandMapSpot[]; onSelect: (spot: BandMapSpot) => void; radioFrequencyHz?: number; compact?: boolean;
  preferences?: BandMapViewPreferences; onPreferencesChange?: (next: BandMapViewPreferences) => void; onDock?: () => void; onUndock?: () => void };
type Allocation = { name: "CW" | "Data" | "Phone"; low: number; high: number };
type Range = { low: number; high: number; allocations: Allocation[] };
type ViewRange = { low: number; high: number };
type PlacedSpot = { spot: BandMapSpot; top: number; lane: number; key: string };
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
const storageKey = (compact: boolean, name: string) => `xlog.integration.bandMaps.${compact ? "desk" : "workspace"}.${name}`;
function storedBands(compact: boolean): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(compact, "bands")) || "null");
    if (Array.isArray(value)) {
      const bands = [...new Set(value.filter((band): band is string => typeof band === "string" && band in BAND_RANGES))];
      if (bands.length) return bands;
    }
  } catch { /* Invalid or unavailable storage uses the native 20 m default. */ }
  return ["20m"];
}
function storedFlag(compact: boolean, name: string, fallback: boolean): boolean {
  try { const value = localStorage.getItem(storageKey(compact, name)); return value === null ? fallback : value === "true"; }
  catch { return fallback; }
}
function store(compact: boolean, name: string, value: unknown): void {
  try { localStorage.setItem(storageKey(compact, name), typeof value === "string" ? value : JSON.stringify(value)); }
  catch { /* Storage failure must not interrupt a live operating view. */ }
}
export function bandForRadio(frequencyHz?: number): string | null {
  if (frequencyHz == null || !Number.isFinite(frequencyHz)) return null;
  const khz = frequencyHz / 1000;
  return BAND_ORDER.find((band) => khz >= BAND_RANGES[band].low && khz <= BAND_RANGES[band].high) ?? null;
}
export function opportunityCode(spot: BandMapSpot): string {
  const call = text(spot.callStatus).toLowerCase();
  const dxcc = text(spot.dxccStatus).toLowerCase();
  const both = `${call} ${dxcc}`;
  if (both.includes("atno")) return "ATNO";
  if (both.includes("new band+mode") || both.includes("new band + mode")) return "NB+NM";
  if (both.includes("new band")) return "NB";
  if (both.includes("new mode")) return "NM";
  if (call.includes("new call")) return "NC";
  if (both.includes("confirmed")) return "C";
  if (both.includes("worked")) return "W";
  return "--";
}
function statusColor(spot: BandMapSpot): string {
  if (hex(spot.statusHex)) return spot.statusHex;
  return paletteColor(text(spot.dxccStatus) || text(spot.callStatus), undefined, clusterStatusColors);
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

// Fixed-size lanes guarantee non-overlapping labels even when many spots share one frequency.
export function placeSpots(spots: BandMapSpot[], view: ViewRange, width: number, height: number, fontScale = 1): { placed: PlacedSpot[]; hidden: number } {
  const axis = 54;
  const laneCount = Math.max(1, Math.min(6, Math.floor((Math.max(180, width) - axis - 12) / (112 * fontScale))));
  const slotHeight = Math.max(25, 23 * fontScale);
  const slotCount = Math.max(1, Math.floor(Math.max(100, height - 8) / slotHeight));
  const occupied = Array.from({ length: laneCount }, () => new Set<number>());
  const ordered = [...spots].sort((a, b) => b.frequencyKHz - a.frequencyKHz || text(a.callsign).localeCompare(text(b.callsign)));
  const placed: PlacedSpot[] = [];
  let hidden = 0;
  for (const [index, spot] of ordered.entries()) {
    const fraction = (view.high - spot.frequencyKHz) / Math.max(1, view.high - view.low);
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
    placed.push({ spot, lane: best.lane, top: (best.slot + 0.5) * slotHeight, key: `${text(spot.id) || text(spot.callsign)}-${index}` });
  }
  return { placed, hidden };
}

function BandPanel({ band, spots, onSelect, onRemove, canRemove, compact, fontScale, hidden: panelHidden = false }: {
  band: string; spots: BandMapSpot[]; onSelect: Props["onSelect"]; onRemove: () => void;
  canRemove: boolean; compact: boolean; fontScale: number; hidden?: boolean;
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
    const chart = chartRef.current;
    if (!chart) return;
    const wheel = (event: WheelEvent) => {
      const current = viewRef.current;
      const span = current.high - current.low;
      if (event.ctrlKey || span >= full.high - full.low || !event.deltaY) return;
      event.preventDefault();
      const height = chart.clientHeight || 520;
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1);
      setView(value => panBandRange(value, full, -Math.max(-height, Math.min(height, pixels)) / height * span));
    };
    chart.addEventListener("wheel", wheel, { passive: false });
    return () => chart.removeEventListener("wheel", wheel);
  }, [full]);
  const visible = useMemo(() => normalizeSpots(spots, band, view), [spots, band, view]);
  const { placed, hidden } = useMemo(() => placeSpots(visible, view, width, chartHeight, fontScale), [visible, view, width, chartHeight, fontScale]);
  const allBandCount = spots.filter((spot) => spot.band === band && finite(spot.frequencyKHz) !== null).length;
  const selectedSegment = full.allocations.find((part) => part.low === view.low && part.high === view.high);
  const segmentName = selectedSegment ? `${selectedSegment.name} portion` : view.low === full.low && view.high === full.high ? "Full band" : "Custom range";
  const rangeLabel = `${(view.low / 1000).toFixed(3)}–${(view.high / 1000).toFixed(3)} MHz`;
  const pan = (direction: number) => setView((current) => {
    const span = current.high - current.low;
    return panBandRange(current, full, direction * span * 0.3);
  });
  const zoom = (factor: number) => setView((current) => {
    const span = Math.min(full.high - full.low, Math.max(2, (full.high - full.low) / 80, (current.high - current.low) * factor));
    const centre = (current.low + current.high) / 2;
    const low = Math.max(full.low, Math.min(full.high - span, centre - span / 2));
    return { low, high: low + span };
  });
  return <section className="band-map-panel" hidden={panelHidden} aria-label={`${band} band map`} style={{ "--band-accent": bandColor(band, spots), "--band-font-scale": fontScale } as CSSProperties}>
    <header className="band-map-panel-head"><span className="band-map-accent" aria-hidden="true" /><strong>{band}</strong><small>{visible.length}/{allBandCount} spots</small><button type="button" title={`Close ${band} band map`} aria-label={`Close ${band} band map`} disabled={!canRemove} onClick={onRemove}><X size={13} /></button></header>
    <div className="band-map-panel-tools"><label><span className="sr-only">{band} allocation</span><select aria-label={`${band} allocation`} value={segmentName} onChange={(event) => {
      const part = full.allocations.find((item) => `${item.name} portion` === event.target.value);
      setView(part ? { low: part.low, high: part.high } : { low: full.low, high: full.high });
    }}><option>Full band</option>{full.allocations.map((part) => <option key={part.name}>{part.name} portion</option>)}{segmentName === "Custom range" && <option>Custom range</option>}</select></label>
      <div className="band-map-tool-buttons"><button type="button" aria-label={`Pan ${band} up`} title="Pan up" onClick={() => pan(1)}><ArrowUp size={13} /></button><button type="button" aria-label={`Pan ${band} down`} title="Pan down" onClick={() => pan(-1)}><ArrowDown size={13} /></button><button type="button" aria-label={`Zoom ${band} out`} title="Zoom out" onClick={() => zoom(1.55)}><ZoomOut size={13} /></button><button type="button" aria-label={`Zoom ${band} in`} title="Zoom in" onClick={() => zoom(0.62)}><ZoomIn size={13} /></button><button type="button" aria-label={`Reset ${band} range`} title="Full band" onClick={() => setView({ low: full.low, high: full.high })}><RotateCcw size={13} /></button></div>
    </div>
    <div className={`band-map-chart${zoomed ? " is-zoomed" : ""}${dragging ? " is-dragging" : ""}`} ref={chartRef} aria-label={`${band} spectrum, ${rangeLabel}`}
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
        if (!start.moved) { start.moved = true; suppressClick.current = true; setDragging(true); event.currentTarget.setPointerCapture(event.pointerId); }
        event.preventDefault();
        setView(panBandRange(start.view, full, delta / (event.currentTarget.clientHeight || 520) * (start.view.high - start.view.low)));
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
        return <div key={part.name} className={`band-map-allocation band-map-${part.name.toLowerCase()}`} style={{ top: `${((view.high - high) / span) * 100}%`, height: `${((high - low) / span) * 100}%` }} aria-hidden="true"><span>{part.name.toUpperCase()}</span></div>;
      })}
      {Array.from({ length: 9 }, (_, index) => {
        const fraction = index / 8;
        return <div key={index} className="band-map-gridline" data-edge={index === 0 ? "upper" : index === 8 ? "lower" : undefined} style={{ top: `${fraction * 100}%` }} aria-hidden="true"><span>{((view.high - (view.high - view.low) * fraction) / 1000).toFixed(3)}</span></div>;
      })}
      {placed.map(({ spot, lane, top, key }) => {
        const color = statusColor(spot);
        const code = opportunityCode(spot);
        const tooltip = `${text(spot.callsign)} · ${(spot.frequencyKHz / 1000).toFixed(6)} MHz · ${text(spot.mode)} · ${text(spot.callStatus)} · ${text(spot.dxccStatus)}${spot.comment ? ` · ${text(spot.comment)}` : ""}`;
        const lanes = Math.max(1, Math.min(6, Math.floor((Math.max(180, width) - 66) / (112 * fontScale))));
        const laneWidth = (width - 62) / lanes;
        return <button key={key} type="button" className="band-map-spot" style={{ top, left: 54 + laneWidth * (lane + 0.5), width: Math.min(126 * fontScale, Math.max(72, laneWidth - 5)), color, borderColor: color, backgroundColor: `${color}28` }} title={tooltip} aria-label={tooltip} onClick={() => onSelect(spot)}><strong>{text(spot.callsign)}</strong><b>{code}</b></button>;
      })}
      {hidden > 0 && <span className="band-map-overflow" role="status">{hidden} more spots; zoom in to separate labels</span>}
    </div>
    <footer className="band-map-panel-foot"><div className="band-map-legend"><span>CW</span><span>Data</span><span>Phone</span></div><output>{rangeLabel}</output></footer>
  </section>;
}

export function BandMaps({ spots, onSelect, radioFrequencyHz, compact = false, preferences, onPreferencesChange, onDock, onUndock }: Props) {
  const toolbarHost = useContext(BandMapsToolbarContext);
  const [localBands, setLocalBands] = useState(() => storedBands(compact));
  const [localFollow, setLocalFollow] = useState(() => storedFlag(compact, "followRadio", false));
  const [localLayout, setLocalLayout] = useState<"row" | "grid">(() => {
    try { return localStorage.getItem(storageKey(compact, "layout")) === "row" ? "row" : "grid"; }
    catch { return "grid"; }
  });
  const [localFontScale, setLocalFontScale] = useState(() => {
    try { const value = Number(localStorage.getItem(storageKey(compact, "fontScale"))); return value >= 0.8 && value <= 2 ? value : 1; }
    catch { return 1; }
  });
  const bands = preferences?.bands ?? localBands;
  const follow = preferences?.followRadio ?? localFollow;
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
      const saved = JSON.parse(localStorage.getItem(storageKey(compact, "modes")) || "null");
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
  const radioBand = bandForRadio(radioFrequencyHz);
  useEffect(() => { if (follow && radioBand && (bands.length !== 1 || bands[0] !== radioBand)) setBands([radioBand]); }, [follow, radioBand, bands]);
  useEffect(() => { if (!preferences) store(compact, "bands", bands); }, [bands, compact, preferences]);
  useEffect(() => { if (!preferences) store(compact, "followRadio", follow); }, [follow, compact, preferences]);
  useEffect(() => { if (!preferences) store(compact, "layout", layout); }, [layout, compact, preferences]);
  useEffect(() => { if (!preferences) store(compact, "fontScale", String(fontScale)); }, [fontScale, compact, preferences]);
  useEffect(() => { if (!preferences) store(compact, "modes", modes); }, [modes, compact, preferences]);
  const filtered = useMemo(() => compact ? spots : spots.filter((spot) => {
    const needle = query.trim().toLowerCase();
    return (!needle || [spot.callsign, spot.country, spot.comment, spot.source].some((part) => text(part).toLowerCase().includes(needle)))
      && matchesStatus(spot, status) && modes.includes(modeGroup(text(spot.mode)));
  }), [spots, compact, query, status, modes]);
  const add = (band: string) => {
    if (!(band in BAND_RANGES)) return;
    const next = bands.includes(band) ? bands : [...bands, band];
    const nextCapacity = bandMapCapacity(panelSize.width, panelSize.height, compact || layout === "row", next.length).capacity;
    setPage(Math.floor(next.indexOf(band) / nextCapacity));
    selectBands(next);
  };
  const remove = (band: string) => { if (bands.length <= 1) return; selectBands(bands.filter((item) => item !== band)); };
  const choose = (spot: BandMapSpot) => { setSelected(spot); onSelect(spot); };
  const toolbarControls = <div className="band-maps-head-controls"><label className="band-maps-follow"><input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} /> Follow radio</label>
        <div className="band-maps-scale"><button type="button" aria-label="Decrease band map text size" disabled={fontScale <= 0.8} onClick={() => setFontScale((value) => Math.max(0.8, +(value - 0.1).toFixed(1)))}>A−</button><output>{Math.round(fontScale * 100)}%</output><button type="button" aria-label="Increase band map text size" disabled={fontScale >= 2} onClick={() => setFontScale((value) => Math.min(2, +(value + 0.1).toFixed(1)))}>A+</button></div>
        {!compact && <div className="band-maps-layout" role="group" aria-label="Band map layout"><button type="button" aria-pressed={layout === "row"} onClick={() => setLayout("row")}>Single row</button><button type="button" aria-pressed={layout === "grid"} onClick={() => setLayout("grid")}>Adaptive grid</button></div>}
        {pages > 1 && <div className="band-maps-pages" role="group" aria-label="Band map pages"><button type="button" aria-label="Previous band maps" disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>‹</button><output aria-live="polite">{visiblePage + 1} / {pages}</output><button type="button" aria-label="Next band maps" disabled={visiblePage === pages - 1} onClick={() => setPage(visiblePage + 1)}>›</button></div>}
        <label className="band-maps-add"><span className="sr-only">Add band map</span><select aria-label="Add band map" value="" onChange={(event) => { const value = event.target.value; if (value === "all") selectBands(BAND_ORDER); else add(value); event.target.value = ""; }}><option value="">Add band map</option><option value="all">All bands</option>{BAND_ORDER.filter((band) => !bands.includes(band)).map((band) => <option key={band} value={band}>{band}</option>)}</select></label>
        {onUndock && <button type="button" onClick={onUndock}>Undock</button>}
        {onDock && <button type="button" onClick={onDock}>Dock back</button>}
      </div>;
  return <section className={`band-maps${compact ? " band-maps-compact" : ""}`} aria-label="Band maps">
    {compact && toolbarHost ? createPortal(toolbarControls, toolbarHost) : <header className="band-maps-head"><div><h2>Band maps</h2></div>{toolbarControls}</header>}
    {!compact && <div className="band-maps-intelligence"><label className="band-maps-search">Search <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Call, country or note" /></label><label>Status <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All</option><option value="needed">Needed</option><option value="worked">Worked</option><option value="confirmed">Confirmed</option><option value="priority">Priority</option></select></label>
      <details className="band-maps-mode-picker" onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
        <summary>Modes · {modes.length === 3 ? "All" : modes.length === 0 ? "None" : modes.map(mode => mode === "cw" ? "CW" : mode === "data" ? "Data" : "Phone").join(" + ")}</summary>
        <div className="band-maps-mode-options" role="group" aria-label="Band map modes">
          <label><input type="checkbox" checked={modes.length === 3} onChange={event => setModes(event.target.checked ? [...BAND_MAP_MODES] : [])} />All modes</label>
          {BAND_MAP_MODES.map(mode => <label key={mode}><input type="checkbox" checked={modes.includes(mode)} onChange={event => setModes(BAND_MAP_MODES.filter(item => item === mode ? event.target.checked : modes.includes(item)))} />{mode === "cw" ? "CW" : mode === "data" ? "Data" : "Phone"}</label>)}
        </div>
      </details>
      <span className="band-maps-count">{filtered.length} of {spots.length} spots</span><span className="band-maps-selected">{selected ? `${text(selected.callsign)} · ${opportunityCode(selected)} · ${text(selected.callStatus)} · ${text(selected.dxccStatus)}` : "Select a marker to load it into the logger."}</span>{(query || status !== "all" || modes.length !== 3) && <button type="button" onClick={() => { setQuery(""); setStatus("all"); setModes([...BAND_MAP_MODES]); }}>Clear filters</button>}</div>}
    <div ref={panelsRef} className={`band-maps-panels band-maps-${compact || layout === "row" ? "row" : "grid"}`} style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(columns, visibleCount))}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.max(1, Math.ceil(visibleCount / columns))}, minmax(0, 1fr))` }}>
      {bands.map((band, index) => <BandPanel key={band} band={band} spots={filtered} onSelect={choose} onRemove={() => remove(band)} canRemove={bands.length > 1} compact={compact} fontScale={fontScale} hidden={index < firstBand || index >= firstBand + capacity} />)}
    </div>
  </section>;
}

export default BandMaps;

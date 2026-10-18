import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MapSpot } from "../MapSpots";
import "./OpportunitiesPanel.css";
const OpportunityMap = lazy(() => import("../Map"));

export type Opportunity = {
  activation?: { sourceEpoch: string; spotVersion: string };
  id: string; kind: string; callsign: string; reference: string; name: string;
  frequency_hz: number | null; mode: string; observed_at: string; expires_at: string;
  source: string; source_url: string; comment: string; reference_status: string;
  worked_count: number; confirmed_count: number;
  latitude?: number | null; longitude?: number | null; location_source?: string;
  programmes?: string[]; reference_kind?: string; activity?: string; location_accuracy?: string;
  starts_at?: string | null; ends_at?: string | null; latest_spot_at?: string | null;
  dxcc_history?: { adif: number; entity: string; worked_modes: string[]; confirmed_modes: string[] } | null;
  callsign_history?: { worked_count: number; confirmed_count: number; worked_modes: string[]; confirmed_modes: string[] };
  band_modes?: { band: string; mode: string; worked_count: number; confirmed_count: number }[];
};
type Source = { source: string; state: string; count: number; source_url: string; refreshing?: boolean;
  last_success: string | null; last_attempt: string | null; safe_error: string | null };
type Snapshot = { generated_at: string; items: Opportunity[]; total_available: number;
  history_state: string; sources: Source[]; selection_tunes: false; transmit: false };
type Request = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
const kinds = ["all", "dxpedition", "pota", "sota", "wwff", "wwbota", "iota", "castle", "special_event"] as const;
const labels: Record<string, string> = { all: "All", pota: "POTA", sota: "SOTA", wwff: "WWFF",
  wwbota: "WWBOTA", iota: "IOTA", castle: "Castles", dxpedition: "DXpeditions", special_event: "Special events" };
const officialHosts = new Set(["api.pota.app", "api2.sota.org.uk", "spots.wwff.co", "api.wwbota.org", "www.425dxn.org"]);
function officialLink(value: string): string | undefined {
  try { const url = new URL(value); return url.protocol === "https:" && officialHosts.has(url.hostname) ? url.toString() : undefined; }
  catch { return undefined; }
}
const timeFormatter = new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
const dateFormatter = new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", timeZone: "UTC" });
function time(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? timeFormatter.format(date) : "Time unavailable";
}
function mhz(hz: number | null): string { return hz != null && Number.isFinite(hz) ? `${(hz / 1_000_000).toFixed(3)} MHz` : "Frequency not supplied"; }
function activity(item: Opportunity): string {
  if (item.activity === "spotted_operation") return "Live cluster spot · scheduled operation";
  if (item.activity !== "scheduled" && item.kind !== "dxpedition" && item.kind !== "special_event") return "Live spot";
  const date = (value: string) => dateFormatter.format(new Date(value));
  return item.starts_at && item.ends_at && Number.isFinite(Date.parse(item.starts_at)) && Number.isFinite(Date.parse(item.ends_at))
    ? `Scheduled ${date(item.starts_at)}–${date(item.ends_at)}` : "Scheduled operation";
}
type HistoryState = "confirmed" | "worked" | "wanted" | "unknown";
type DXCCNeed = { text: string; state: HistoryState; title: string; segments: { text: string; state: HistoryState }[] };
export function opportunityDXCCNeed(item: Opportunity): DXCCNeed {
  const history = item.dxcc_history;
  if (!history || !Number.isInteger(history.adif) || history.adif < 1) {
    const text = "DXCC history unavailable";
    return { text, state: "unknown", title: "This callsign could not be resolved to a DXCC entity.", segments: [{ text, state: "unknown" }] };
  }
  const modes = (values: unknown) => Array.isArray(values) ? [...new Set(values.filter((value): value is string =>
    typeof value === "string" && value.trim().length > 0).map(value => value.trim().toUpperCase()))] : [];
  const confirmed = modes(history.confirmed_modes);
  const confirmedSet = new Set(confirmed);
  const worked = modes(history.worked_modes).filter(value => !confirmedSet.has(value));
  const entity = typeof history.entity === "string" && history.entity.trim() ? history.entity.trim() : "DXCC entity";
  const context = `${entity} · DXCC ${history.adif}`;
  if (!confirmed.length && !worked.length) {
    const text = "DXCC All Time New One · Wanted";
    return { text, state: "wanted", title: `${context} · All Time New One · Wanted`, segments: [{ text, state: "wanted" }] };
  }
  const segments = [
    ...(confirmed.length ? [{ text: `DXCC Confirmed on ${confirmed.join(", ")}`, state: "confirmed" as const }] : []),
    ...(worked.length ? [{ text: `DXCC Worked on ${worked.join(", ")}`, state: "worked" as const }] : []),
  ];
  const text = segments.map(part => part.text).join(" · ");
  return { text, state: worked.length ? "worked" : "confirmed", title: `${context} · ${text}`, segments };
}
export function opportunityBand(hz: number | null): string {
  if (hz == null) return "";
  const mhz = hz / 1_000_000;
  return ([[1.8, 2, "160m"], [3.5, 4, "80m"], [5, 5.5, "60m"], [7, 7.3, "40m"], [10.1, 10.15, "30m"], [14, 14.35, "20m"], [18.068, 18.168, "17m"], [21, 21.45, "15m"], [24.89, 24.99, "12m"], [28, 29.7, "10m"], [50, 54, "6m"], [144, 148, "2m"], [420, 450, "70cm"]] as const).find(([low, high]) => mhz >= low && mhz <= high)?.[2] ?? "Other";
}
const preferencesKey = "xlog.integration.chaser.v1";
const columnWidthsKey = "xlog.integration.chaser-column-widths.v1";
const opportunityColumns = [
  ["call", "Call / operation", 300, 180], ["reference", "Reference", 190, 120],
  ["band", "Band / mode", 160, 105], ["evidence", "Evidence", 200, 120],
  ["history", "History", 170, 120], ["action", "Action", 105, 84],
] as const;
type OpportunityColumn = typeof opportunityColumns[number][0];
type OpportunityColumnWidths = Record<OpportunityColumn, number>;
function boundColumnWidth(column: OpportunityColumn, width: number): number {
  const minimum = opportunityColumns.find(([id]) => id === column)![3];
  return Math.max(minimum, Math.min(600, Math.round(width)));
}
function loadColumnWidths(): OpportunityColumnWidths {
  const widths = Object.fromEntries(opportunityColumns.map(([id, , width]) => [id, width])) as OpportunityColumnWidths;
  try {
    const raw = localStorage.getItem(columnWidthsKey);
    if (!raw || raw.length > 1024) return widths;
    const saved = JSON.parse(raw);
    if (!saved || saved.version !== 1 || !saved.widths || typeof saved.widths !== "object") return widths;
    for (const [id] of opportunityColumns) if (typeof saved.widths[id] === "number" && Number.isFinite(saved.widths[id]))
      widths[id] = boundColumnWidth(id, saved.widths[id]);
  } catch { /* Presentation preferences cannot block live opportunities. */ }
  return widths;
}
function OpportunityColumnHeader({ column, label, width, onWidth, children }: {
  column: OpportunityColumn; label: string; width: number;
  onWidth: (column: OpportunityColumn, width: number) => void; children?: ReactNode;
}) {
  const drag = useRef<{ x: number; width: number; scale: number } | null>(null);
  return <th scope="col">{children ?? label}<span className="opportunities-column-resizer" role="separator" tabIndex={0}
    aria-label={`Resize ${label} column`} aria-orientation="vertical"
    aria-valuemin={opportunityColumns.find(([id]) => id === column)![3]} aria-valuemax={600} aria-valuenow={width}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture?.(event.pointerId);
      const actual = event.currentTarget.parentElement?.getBoundingClientRect().width ?? width;
      drag.current = { x: event.clientX, width, scale: actual > 0 ? width / actual : 1 };
    }}
    onPointerMove={event => { if (drag.current) onWidth(column, drag.current.width + (event.clientX - drag.current.x) * drag.current.scale); }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
    onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={event => {
      const next = event.key === "ArrowLeft" ? width - 10 : event.key === "ArrowRight" ? width + 10
        : event.key === "Home" ? 0 : event.key === "End" ? 600 : null;
      if (next === null) return;
      event.preventDefault(); onWidth(column, next);
    }} /></th>;
}
const feedNames = ["pota", "sota", "wwff", "wwbota", "425dxn"];
function priorityFeed(kind: string): string {
  return ["dxpedition", "special_event", "iota"].includes(kind) ? "425dxn" : feedNames.includes(kind) ? kind : "pota";
}
type Preferences = { kind: typeof kinds[number]; band: string; mode: string; sort: string; map: boolean };
function preferences(): Preferences {
  const defaults: Preferences = { kind: "all", band: "all", mode: "all", sort: "newest", map: false };
  try {
    const raw = localStorage.getItem(preferencesKey);
    if (!raw || raw.length > 2048) return defaults;
    const value = JSON.parse(raw);
    if (kinds.includes(value?.kind)) defaults.kind = value.kind;
    for (const key of ["band", "mode"] as const) if (typeof value?.[key] === "string" && value[key].length < 24) defaults[key] = value[key];
    if (["newest", "callsign", "reference", "frequency", "unworked"].includes(value?.sort)) defaults.sort = value.sort;
    defaults.map = value?.map === true;
  } catch { /* Invalid preferences do not block live data. */ }
  return defaults;
}

export function OpportunitiesPanel({ request, onSelect, onDock, refresh = 0, home, taskOnly = false }: { request: Request; onSelect?: (item: Opportunity) => void; onDock?: () => void; refresh?: number; home?: { call?: string; lat: number; lon: number } | null; taskOnly?: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [prefs, setPrefs] = useState(preferences);
  const { kind, band, mode, sort, map: showMap } = prefs;
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingSources, setPendingSources] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0), [pageSize, setPageSize] = useState(12);
  const [selected, setSelected] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] = useState<OpportunityColumnWidths>(loadColumnWidths);
  const tableRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(request); requestRef.current = request;
  const kindRef = useRef(kind); kindRef.current = kind;
  const reloadRef = useRef<(automatic: boolean) => void>(() => {});
  const inFlight = useMemo(() => new Map<string, Promise<unknown>>(), [request]);
  const responseOrder = useRef(0), acceptedOrder = useRef(0);
  useEffect(() => {
    let active = true, refreshing = false;
    setError("");
    const load = (key: string, method: string, params?: Record<string, unknown>) => {
      const pending = inFlight.get(key);
      if (pending) return pending;
      const next = params ? requestRef.current(method, params) : requestRef.current(method);
      inFlight.set(key, next);
      void next.then(() => {}, () => {}).finally(() => {
        if (inFlight.get(key) === next) inFlight.delete(key);
      });
      return next;
    };
    const accept = (value: unknown, order: number) => {
      const next = value as Snapshot;
      if (!active || !Array.isArray(next?.items) || !Number.isFinite(Date.parse(next.generated_at))) return;
      setSnapshot(prior => {
        if (!active) return prior;
        const newer = !prior || Date.parse(next.generated_at) > Date.parse(prior.generated_at);
        if (!newer && (next.generated_at !== prior?.generated_at || order < acceptedOrder.current)) return prior;
        acceptedOrder.current = order;
        return next;
      });
    };
    const read = () => {
      const order = ++responseOrder.current;
      return load("snapshot", "opportunities_snapshot").then(value => accept(value, order))
        .catch(() => { if (active) setError("Opportunities could not be loaded. Automatic refresh will retry."); });
    };
    const reload = (automatic: boolean) => {
      if (!active || refreshing) return;
      refreshing = true; setBusy(true); setError("");
      const priority = priorityFeed(kindRef.current);
      const sources = automatic ? [priority, "all"] : ["all"];
      setPendingSources(feedNames);
      // The selected programme can paint first while the backend refreshes the
      // remaining feeds as one batch. This avoids rebuilding the full 68k-QSO
      // history projection once per feed.
      void Promise.allSettled(sources.map(source => {
        const order = ++responseOrder.current;
        return load(`refresh:${source}:${automatic}`, "opportunities_refresh", { source, automatic }).then(value => accept(value, order))
          .catch(() => { if (active) setError("Feeds could not be refreshed. Previous data is retained; automatic refresh will retry."); });
      })).then(() => { refreshing = false; if (active) { setBusy(false); setPendingSources([]); } });
    };
    reloadRef.current = reload;
    // Local retained data wins the first paint. Network refresh begins only
    // after that snapshot settles, so opening this view is never gated by feeds.
    void read().finally(() => { if (active) reload(true); });
    const localTimer = window.setInterval(read, 15_000);
    const feedTimer = window.setInterval(() => reload(true), 60_000);
    return () => { active = false; window.clearInterval(localTimer); window.clearInterval(feedTimer); };
  }, [refresh, inFlight]);
  useEffect(() => { try { localStorage.setItem(preferencesKey, JSON.stringify(prefs)); } catch { /* Session-only fallback. */ } }, [prefs]);
  useEffect(() => {
    try { localStorage.setItem(columnWidthsKey, JSON.stringify({ version: 1, widths: columnWidths })); }
    catch { /* Keep the resized columns in memory for this session. */ }
  }, [columnWidths]);
  useEffect(() => { setPage(0); }, [kind, band, mode, sort, query]);
  useEffect(() => {
    const element = tableRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => {
      const height = entries[0]?.contentRect.height ?? 0;
      if (height > 0) setPageSize(Math.max(1, Math.floor((height - 36) / 76)));
    });
    observer.observe(element); return () => observer.disconnect();
  }, [snapshot != null]);
  const search = query.trim().toUpperCase();
  const rows = useMemo(() => (snapshot?.items ?? []).filter(item =>
    (kind === "all" || item.kind === kind || item.programmes?.includes(kind)) &&
    (band === "all" || opportunityBand(item.frequency_hz) === band) && (mode === "all" || item.mode === mode) &&
    `${item.callsign} ${item.reference} ${item.name}`.toUpperCase().includes(search)).sort((a, b) =>
      sort === "callsign" ? a.callsign.localeCompare(b.callsign) : sort === "reference" ? a.reference.localeCompare(b.reference) :
      sort === "frequency" ? (a.frequency_hz ?? Infinity) - (b.frequency_hz ?? Infinity) :
      sort === "unworked" ? a.worked_count - b.worked_count || b.observed_at.localeCompare(a.observed_at) : b.observed_at.localeCompare(a.observed_at)), [snapshot, kind, band, mode, sort, search]);
  const bands = useMemo(() => [...new Set([band, ...(snapshot?.items ?? []).map(item => opportunityBand(item.frequency_hz))])].filter(value => value && value !== "all"), [snapshot, band]);
  const modes = useMemo(() => [...new Set([mode, ...(snapshot?.items ?? []).map(item => item.mode)])].filter(value => value && value !== "all").sort(), [snapshot, mode]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
  const pageRows = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const mapSpots = useMemo<MapSpot[]>(() => !showMap ? [] : rows.filter(item => typeof item.latitude === "number" && typeof item.longitude === "number").map(item => ({
    id: item.id, call: item.callsign, mhz: (item.frequency_hz ?? 0) / 1_000_000, locationOnly: item.frequency_hz == null, mode: item.mode as MapSpot["mode"], band: opportunityBand(item.frequency_hz),
    country: item.name, grid: "", lat: item.latitude!, lon: item.longitude!, reporter: item.source, note: `${item.reference} · ${activity(item)} · ${item.location_source}`,
    receivedAt: new Date(item.observed_at).valueOf(), state: item.callsign_history?.confirmed_count ? "confirmed" : item.callsign_history?.worked_count ? "worked" : "needed",
  })), [rows, showMap]);
  const choose = (item: Opportunity) => { if (!onSelect) return; setSelected(item.id); onSelect(item); };
  const visibleColumns = opportunityColumns.filter(([id]) => onSelect || id !== "action");
  const totalColumnWidth = visibleColumns.reduce((total, [id]) => total + columnWidths[id], 0);
  const resizeColumn = (column: OpportunityColumn, width: number) =>
    setColumnWidths(current => ({ ...current, [column]: boundColumnWidth(column, width) }));
  return <section className="opportunities" aria-label="Chaser and DX calendar">
    <header className="opportunities-head">{!taskOnly && <h2>Chaser & DX</h2>}<span>Automatic live feeds · 60s</span>
      <button type="button" aria-pressed={showMap} onClick={() => setPrefs(current => ({ ...current, map: !current.map }))}>{showMap ? "Hide map" : "Show map"}</button>
      <button type="button" disabled={busy} onClick={() => reloadRef.current(false)}>{busy ? "Refreshing…" : "Refresh feeds"}</button>
      {onDock && <button type="button" onClick={onDock}>Dock back</button>}</header>
    {!onSelect && <p className="secondary">Read-only independent view. Dock back before loading an opportunity into the shared QSO draft.</p>}
    <div className="opportunities-sources" aria-label="Live feed status — not reference databases">
      {(snapshot?.sources ?? []).map(source => <div className="opportunities-source" key={source.source} title="Live feed health. Complete park and summit directories are managed in Settings → Reference data.">
        <strong>{source.source === "425dxn" ? "DX calendar" : source.source.toUpperCase()} feed</strong>
        <span className={`opportunities-state opportunities-state-${source.state}`}>{source.refreshing || pendingSources.includes(source.source) ? "Updating" : source.state}</span>
        <small>{source.safe_error ? "Retrying automatically · " : ""}{source.last_success ? `${source.count} live · ${time(source.last_success)}` : pendingSources.includes(source.source) ? "Loading automatically…" : "Waiting for automatic retry"}</small>
      </div>)}
      {!snapshot && <p>Loading live feeds…</p>}
    </div>
    {error && <p className="opportunities-error" role="alert">{error}</p>}
    <div className="opportunities-tabs" role="tablist" aria-label="Programme">{kinds.map((value, index) => <button type="button" key={value} role="tab" aria-selected={kind === value} tabIndex={kind === value ? 0 : -1}
      onClick={() => setPrefs(current => ({ ...current, kind: value }))} onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? kinds.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + kinds.length) % kinds.length;
        setPrefs(current => ({ ...current, kind: kinds[next] })); (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus();
      }}>{labels[value]}</button>)}</div>
    {snapshot && <>
      <div className="opportunities-filters">
      <label className="opportunities-search">Search call or reference<input value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label>Band<select value={band} onChange={event => setPrefs(current => ({ ...current, band: event.target.value }))}><option value="all">All bands</option>{bands.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Mode<select value={mode} onChange={event => setPrefs(current => ({ ...current, mode: event.target.value }))}><option value="all">All modes</option>{modes.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Sort<select value={sort} onChange={event => setPrefs(current => ({ ...current, sort: event.target.value }))}><option value="newest">Newest</option><option value="callsign">Callsign</option><option value="reference">Reference</option><option value="frequency">Frequency</option><option value="unworked">Unworked first</option></select></label>
      <span aria-live="polite">{rows.length} matching · {snapshot.total_available} available</span></div>
      {snapshot.history_state !== "ready" && <p className="opportunities-warning">Logbook history is unavailable; worked and confirmed labels are withheld.</p>}
      <div className="opportunities-table-wrap" ref={tableRef}><table><colgroup>{visibleColumns.map(([id]) =>
        <col key={id} style={{ width: `${columnWidths[id] / totalColumnWidth * 100}%` }} />)}</colgroup><thead><tr>
        {visibleColumns.map(([id, label]) => <OpportunityColumnHeader key={id} column={id} label={label}
          width={columnWidths[id]} onWidth={resizeColumn} />)}</tr></thead>
        <tbody>{pageRows.map(item => { const dxcc = opportunityDXCCNeed(item); const station = item.callsign_history; return <tr key={item.id} className={selected === item.id ? "is-selected" : ""}><td className="opportunities-call"><strong>{item.callsign}</strong><small title={item.name}>{item.name || (item.kind === "dxpedition" || item.kind === "special_event" ? item.source : "Name unavailable")}</small><span className="opportunities-dxcc-need" title={dxcc.title}>{dxcc.segments.map((part, index) => <span key={part.text} className={`is-${part.state}`}>{index ? " · " : ""}{part.text}</span>)}</span></td>
          <td><span className={item.reference_status === "verified" ? "opportunities-verified" : ""}>{item.reference ? `${labels[item.reference_kind || item.kind] || item.kind} · ${item.reference}` : labels[item.kind] || item.kind}</span><small title={item.location_source}>{item.location_accuracy === "reference_area" ? "Approximate IOTA group area" : item.reference_status === "not_found" ? "Not in installed directory" : item.reference_status === "not_installed" ? "Directory not installed" : ""}</small></td>
          <td title={activity(item)}>{item.frequency_hz == null ? activity(item) : mhz(item.frequency_hz)}<small>{item.frequency_hz == null ? "Not a live frequency report" : `${item.mode || "Mode not supplied"} · ${activity(item)}`}</small></td>
          <td>{item.latest_spot_at ? `Cluster · ${time(item.latest_spot_at)}` : time(item.observed_at)}<small>{officialLink(item.source_url) ? <a href={officialLink(item.source_url)} target="_blank" rel="noreferrer">{item.source}</a> : item.source}</small></td>
          <td className="opportunities-history" title={station ? `${item.callsign}: ${station.worked_count} worked${station.worked_modes.length ? ` on ${station.worked_modes.join(", ")}` : ""}; ${station.confirmed_count} confirmed${station.confirmed_modes.length ? ` on ${station.confirmed_modes.join(", ")}` : ""}` : undefined}>{snapshot.history_state === "ready" ? station ? <>
            <span className={station?.worked_count ? "is-worked" : "is-zero"}>{station?.worked_count ?? 0} worked</span>
            <small className={station?.confirmed_count ? "is-confirmed" : "is-zero"}>{station?.confirmed_count ?? 0} confirmed{station?.confirmed_modes.length ? ` on ${station.confirmed_modes.join(", ")}` : ""}</small>
          </> : <span className="is-zero">Operation history unavailable</span> : "Unknown"}</td>
          {onSelect && <td><button type="button" onClick={() => choose(item)} aria-label={`Load ${item.callsign} into QSO draft`}>Load QSO</button></td>}</tr>})}
          {!rows.length && <tr><td colSpan={onSelect ? 6 : 5} className="opportunities-empty">{(kind === "all" ? busy : kind !== "castle" && pendingSources.includes(priorityFeed(kind))) ? `Loading ${kind === "all" ? "live feeds" : labels[kind]}…` : kind === "iota" ? "No matching IOTA spots or scheduled island operations. Recent cluster comments must contain an IOTA reference." : kind === "castle" ? "No recent castle-tagged cluster spots match these filters." : "No matching activity. Feeds refresh automatically; try another programme or filter."}</td></tr>}
        </tbody></table></div>
      <nav className="opportunities-pagination" aria-label="Chaser pages"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>{rows.length ? currentPage * pageSize + 1 : 0}–{Math.min((currentPage + 1) * pageSize, rows.length)} of {rows.length}</span><button type="button" disabled={(currentPage + 1) * pageSize >= rows.length} onClick={() => setPage(currentPage + 1)}>Next</button>{showMap && <span>{mapSpots.length} located · {rows.length - mapSpots.length} without published coordinates · selection loads a draft only</span>}</nav>
      {showMap && <div className="opportunities-map"><Suspense fallback={<p>Loading map…</p>}><OpportunityMap selected={selected} data={mapSpots} home={home} compact fitToDataKey={`${kind}:${band}:${mode}:${query}`}
        spotActionLabel={onSelect ? "Load QSO draft only" : undefined} locationLabel="Published reference locations · IOTA group centres are approximate"
        onSpot={onSelect ? spot => { const item = rows.find(row => row.id === spot.id); if (item) choose(item); } : undefined} /></Suspense></div>}
    </>}
  </section>;
}

export default OpportunitiesPanel;

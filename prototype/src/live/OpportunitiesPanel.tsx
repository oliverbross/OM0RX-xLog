import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
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
function time(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(date) : "Time unavailable";
}
function mhz(hz: number | null): string { return hz != null && Number.isFinite(hz) ? `${(hz / 1_000_000).toFixed(3)} MHz` : "Frequency not supplied"; }
function activity(item: Opportunity): string {
  if (item.activity === "spotted_operation") return "Live cluster spot · scheduled operation";
  if (item.activity !== "scheduled" && item.kind !== "dxpedition" && item.kind !== "special_event") return "Live spot";
  const date = (value: string) => new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(value));
  return item.starts_at && item.ends_at && Number.isFinite(Date.parse(item.starts_at)) && Number.isFinite(Date.parse(item.ends_at))
    ? `Scheduled ${date(item.starts_at)}–${date(item.ends_at)}` : "Scheduled operation";
}
export function opportunityBand(hz: number | null): string {
  if (hz == null) return "";
  const mhz = hz / 1_000_000;
  return ([[1.8, 2, "160m"], [3.5, 4, "80m"], [5, 5.5, "60m"], [7, 7.3, "40m"], [10.1, 10.15, "30m"], [14, 14.35, "20m"], [18.068, 18.168, "17m"], [21, 21.45, "15m"], [24.89, 24.99, "12m"], [28, 29.7, "10m"], [50, 54, "6m"], [144, 148, "2m"], [420, 450, "70cm"]] as const).find(([low, high]) => mhz >= low && mhz <= high)?.[2] ?? "Other";
}
const preferencesKey = "xlog.integration.chaser.v1";
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
  const tableRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(request); requestRef.current = request;
  const kindRef = useRef(kind); kindRef.current = kind;
  const reloadRef = useRef<(automatic: boolean) => void>(() => {});
  const inFlight = useRef(new Map<string, Promise<unknown>>());
  const responseOrder = useRef(0), acceptedOrder = useRef(0);
  useEffect(() => {
    let active = true, refreshing = false;
    setError("");
    const load = (key: string, method: string, params?: Record<string, unknown>) => {
      const pending = inFlight.current.get(key);
      if (pending) return pending;
      const next = params ? requestRef.current(method, params) : requestRef.current(method);
      inFlight.current.set(key, next);
      void next.then(() => {}, () => {}).finally(() => {
        if (inFlight.current.get(key) === next) inFlight.current.delete(key);
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
      void load("snapshot", "opportunities_snapshot").then(value => accept(value, order))
        .catch(() => { if (active) setError("Opportunities could not be loaded. Automatic refresh will retry."); });
    };
    const reload = (automatic: boolean) => {
      if (!active || refreshing) return;
      refreshing = true; setBusy(true); setError("");
      const priority = priorityFeed(kindRef.current);
      const sources = [priority, ...feedNames.filter(source => source !== priority)];
      setPendingSources(sources);
      // Start the selected programme first; publish each result independently.
      // A calendar timeout must never hold a ready park/summit feed off screen.
      void Promise.allSettled(sources.map(source => {
        const order = ++responseOrder.current;
        return load(source, "opportunities_refresh", { source, automatic }).then(value => accept(value, order))
          .catch(() => { if (active) setError("Feeds could not be refreshed. Previous data is retained; automatic refresh will retry."); })
          .finally(() => { if (active) setPendingSources(prior => prior.filter(value => value !== source)); });
      })).then(() => { refreshing = false; if (active) setBusy(false); });
    };
    reloadRef.current = reload;
    read(); reload(true);
    const localTimer = window.setInterval(read, 15_000);
    const feedTimer = window.setInterval(() => reload(true), 60_000);
    return () => { active = false; window.clearInterval(localTimer); window.clearInterval(feedTimer); };
  }, [refresh]);
  useEffect(() => { try { localStorage.setItem(preferencesKey, JSON.stringify(prefs)); } catch { /* Session-only fallback. */ } }, [prefs]);
  useEffect(() => { setPage(0); }, [kind, band, mode, sort, query]);
  useEffect(() => {
    const element = tableRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => {
      const height = entries[0]?.contentRect.height ?? 0;
      if (height > 0) setPageSize(Math.max(1, Math.floor((height - 36) / 68)));
    });
    observer.observe(element); return () => observer.disconnect();
  }, [snapshot != null]);
  const rows = useMemo(() => (snapshot?.items ?? []).filter(item =>
    (kind === "all" || item.kind === kind || item.programmes?.includes(kind)) &&
    (band === "all" || opportunityBand(item.frequency_hz) === band) && (mode === "all" || item.mode === mode) &&
    `${item.callsign} ${item.reference} ${item.name}`.toUpperCase().includes(query.trim().toUpperCase())).sort((a, b) =>
      sort === "callsign" ? a.callsign.localeCompare(b.callsign) : sort === "reference" ? a.reference.localeCompare(b.reference) :
      sort === "frequency" ? (a.frequency_hz ?? Infinity) - (b.frequency_hz ?? Infinity) :
      sort === "unworked" ? a.worked_count - b.worked_count || b.observed_at.localeCompare(a.observed_at) : b.observed_at.localeCompare(a.observed_at)), [snapshot, kind, band, mode, sort, query]);
  const bands = [...new Set([band, ...(snapshot?.items ?? []).map(item => opportunityBand(item.frequency_hz))])].filter(value => value && value !== "all");
  const modes = [...new Set([mode, ...(snapshot?.items ?? []).map(item => item.mode)])].filter(value => value && value !== "all").sort();
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
  const pageRows = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const mapSpots = useMemo<MapSpot[]>(() => rows.filter(item => typeof item.latitude === "number" && typeof item.longitude === "number").map(item => ({
    id: item.id, call: item.callsign, mhz: (item.frequency_hz ?? 0) / 1_000_000, locationOnly: item.frequency_hz == null, mode: item.mode as MapSpot["mode"], band: opportunityBand(item.frequency_hz),
    country: item.name, grid: "", lat: item.latitude!, lon: item.longitude!, reporter: item.source, note: `${item.reference} · ${activity(item)} · ${item.location_source}`,
    receivedAt: new Date(item.observed_at).valueOf(), state: item.confirmed_count ? "confirmed" : item.worked_count ? "worked" : "needed",
  })), [rows]);
  const choose = (item: Opportunity) => { if (!onSelect) return; setSelected(item.id); onSelect(item); };
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
      <div className="opportunities-table-wrap" ref={tableRef}><table><thead><tr><th>Call / operation</th><th>Reference</th><th>Band / mode</th><th>Evidence</th><th>History</th>{onSelect && <th>Action</th>}</tr></thead>
        <tbody>{pageRows.map(item => <tr key={item.id} className={selected === item.id ? "is-selected" : ""}><td><strong>{item.callsign}</strong><small title={item.name}>{item.name || (item.kind === "dxpedition" || item.kind === "special_event" ? item.source : "Name unavailable")}</small></td>
          <td><span className={item.reference_status === "verified" ? "opportunities-verified" : ""}>{item.reference ? `${labels[item.reference_kind || item.kind] || item.kind} · ${item.reference}` : labels[item.kind] || item.kind}</span><small title={item.location_source}>{item.location_accuracy === "reference_area" ? "Approximate IOTA group area" : item.reference_status === "not_found" ? "Not in installed directory" : item.reference_status === "not_installed" ? "Directory not installed" : ""}</small></td>
          <td title={activity(item)}>{item.frequency_hz == null ? activity(item) : mhz(item.frequency_hz)}<small>{item.frequency_hz == null ? "Not a live frequency report" : `${item.mode || "Mode not supplied"} · ${activity(item)}`}</small></td>
          <td>{item.latest_spot_at ? `Cluster · ${time(item.latest_spot_at)}` : time(item.observed_at)}<small>{officialLink(item.source_url) ? <a href={officialLink(item.source_url)} target="_blank" rel="noreferrer">{item.source}</a> : item.source}</small></td>
          <td title={item.band_modes?.map(cell => `${cell.band} ${cell.mode}: ${cell.worked_count} worked, ${cell.confirmed_count} confirmed`).join(" · ")}>{!item.reference ? "No reference history" : snapshot.history_state === "ready" ? <>{item.worked_count ? `${item.worked_count} worked` : "Unworked reference"}<small>{item.confirmed_count} confirmed</small></> : "Unknown"}</td>
          {onSelect && <td><button type="button" onClick={() => choose(item)} aria-label={`Load ${item.callsign} into QSO draft`}>Load QSO</button></td>}</tr>)}
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

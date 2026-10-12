import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { MapSpot } from "../MapSpots";
import "./OpportunitiesPanel.css";
const OpportunityMap = lazy(() => import("../Map"));

export type Opportunity = {
  id: string; kind: string; callsign: string; reference: string; name: string;
  frequency_hz: number | null; mode: string; observed_at: string; expires_at: string;
  source: string; source_url: string; comment: string; reference_status: string;
  worked_count: number; confirmed_count: number;
  latitude?: number | null; longitude?: number | null; location_source?: string;
  band_modes?: { band: string; mode: string; worked_count: number; confirmed_count: number }[];
};
type Source = { source: string; state: string; count: number; source_url: string; refreshing?: boolean;
  last_success: string | null; last_attempt: string | null; safe_error: string | null };
type Snapshot = { generated_at: string; items: Opportunity[]; total_available: number;
  history_state: string; sources: Source[]; selection_tunes: false; transmit: false };
type Request = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
const kinds = ["all", "pota", "sota", "wwff", "wwbota", "iota", "castle", "dxpedition", "special_event"] as const;
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
export function opportunityBand(hz: number | null): string {
  if (hz == null) return "";
  const mhz = hz / 1_000_000;
  return ([[1.8, 2, "160m"], [3.5, 4, "80m"], [5, 5.5, "60m"], [7, 7.3, "40m"], [10.1, 10.15, "30m"], [14, 14.35, "20m"], [18.068, 18.168, "17m"], [21, 21.45, "15m"], [24.89, 24.99, "12m"], [28, 29.7, "10m"], [50, 54, "6m"], [144, 148, "2m"], [420, 450, "70cm"]] as const).find(([low, high]) => mhz >= low && mhz <= high)?.[2] ?? "Other";
}
const preferencesKey = "xlog.integration.chaser.v1";
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

export function OpportunitiesPanel({ request, onSelect, refresh = 0, home }: { request: Request; onSelect: (item: Opportunity) => void; refresh?: number; home?: { call?: string; lat: number; lon: number } | null }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [prefs, setPrefs] = useState(preferences);
  const { kind, band, mode, sort, map: showMap } = prefs;
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0), [pageSize, setPageSize] = useState(12);
  const [selected, setSelected] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null), mounted = useRef(false), refreshing = useRef(false);
  const requestRef = useRef(request); requestRef.current = request;
  const accept = (value: unknown) => {
    const next = value as Snapshot;
    if (mounted.current && Array.isArray(next?.items)) setSnapshot(prior => !prior || next.generated_at >= prior.generated_at ? next : prior);
  };
  const reload = async () => {
    if (refreshing.current) return;
    refreshing.current = true; setBusy(true); setError("");
    try { accept(await requestRef.current("opportunities_refresh", { source: "all" })); }
    catch { if (mounted.current) setError("Feeds could not be refreshed. Previous data is retained; automatic refresh will retry."); }
    finally { refreshing.current = false; if (mounted.current) setBusy(false); }
  };
  useEffect(() => {
    mounted.current = true;
    setError("");
    const read = () => void requestRef.current("opportunities_snapshot").then(accept)
      .catch(() => { if (mounted.current) setError("Opportunities could not be loaded. Automatic refresh will retry."); });
    read(); void reload();
    const localTimer = window.setInterval(read, 15_000);
    const feedTimer = window.setInterval(() => void reload(), 60_000);
    return () => { mounted.current = false; window.clearInterval(localTimer); window.clearInterval(feedTimer); };
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
    (kind === "all" || item.kind === kind) &&
    (band === "all" || opportunityBand(item.frequency_hz) === band) && (mode === "all" || item.mode === mode) &&
    `${item.callsign} ${item.reference} ${item.name}`.toUpperCase().includes(query.trim().toUpperCase())).sort((a, b) =>
      sort === "callsign" ? a.callsign.localeCompare(b.callsign) : sort === "reference" ? a.reference.localeCompare(b.reference) :
      sort === "frequency" ? (a.frequency_hz ?? Infinity) - (b.frequency_hz ?? Infinity) :
      sort === "unworked" ? a.worked_count - b.worked_count || b.observed_at.localeCompare(a.observed_at) : b.observed_at.localeCompare(a.observed_at)), [snapshot, kind, band, mode, sort, query]);
  const bands = [...new Set([band, ...(snapshot?.items ?? []).map(item => opportunityBand(item.frequency_hz))])].filter(value => value && value !== "all");
  const modes = [...new Set([mode, ...(snapshot?.items ?? []).map(item => item.mode)])].filter(value => value && value !== "all").sort();
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
  const pageRows = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const mapSpots = useMemo<MapSpot[]>(() => rows.filter(item => item.frequency_hz != null && typeof item.latitude === "number" && typeof item.longitude === "number").map(item => ({
    id: item.id, call: item.callsign, mhz: item.frequency_hz! / 1_000_000, mode: item.mode as MapSpot["mode"], band: opportunityBand(item.frequency_hz),
    country: item.name, grid: "", lat: item.latitude!, lon: item.longitude!, reporter: item.source, note: `${item.reference} · ${item.location_source}`,
    receivedAt: new Date(item.observed_at).valueOf(), state: item.confirmed_count ? "confirmed" : item.worked_count ? "worked" : "needed",
  })), [rows]);
  const choose = (item: Opportunity) => { setSelected(item.id); onSelect(item); };
  return <section className="opportunities" aria-label="Chaser and DX calendar">
    <header className="opportunities-head"><h2>Chaser & DX</h2><span>Automatic live feeds · 60s</span>
      <button type="button" aria-pressed={showMap} onClick={() => setPrefs(current => ({ ...current, map: !current.map }))}>{showMap ? "Hide map" : "Show map"}</button>
      <button type="button" disabled={busy} onClick={() => void reload()}>{busy ? "Refreshing…" : "Refresh feeds"}</button></header>
    <div className="opportunities-sources" aria-label="Live feed status — not reference databases">
      {(snapshot?.sources ?? []).map(source => <div className="opportunities-source" key={source.source} title="Live feed health. Complete park and summit directories are managed in Settings → Reference data.">
        <strong>{source.source === "425dxn" ? "DX calendar" : source.source.toUpperCase()} feed</strong>
        <span className={`opportunities-state opportunities-state-${source.state}`}>{source.refreshing ? "Updating" : source.state}</span>
        <small>{source.safe_error ? "Retrying automatically · " : ""}{source.last_success ? `${source.count} live · ${time(source.last_success)}` : busy ? "Loading automatically…" : "Waiting for automatic retry"}</small>
      </div>)}
      {!snapshot && <p>Loading live feeds…</p>}
    </div>
    {error && <p className="opportunities-error" role="alert">{error}</p>}
    {snapshot && <><div className="opportunities-tabs" role="tablist" aria-label="Programme">{kinds.map((value, index) => <button type="button" key={value} role="tab" aria-selected={kind === value} tabIndex={kind === value ? 0 : -1}
      onClick={() => setPrefs(current => ({ ...current, kind: value }))} onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? kinds.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + kinds.length) % kinds.length;
        setPrefs(current => ({ ...current, kind: kinds[next] })); (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus();
      }}>{labels[value]}</button>)}</div>
      <div className="opportunities-filters">
      <label className="opportunities-search">Search call or reference<input value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label>Band<select value={band} onChange={event => setPrefs(current => ({ ...current, band: event.target.value }))}><option value="all">All bands</option>{bands.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Mode<select value={mode} onChange={event => setPrefs(current => ({ ...current, mode: event.target.value }))}><option value="all">All modes</option>{modes.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Sort<select value={sort} onChange={event => setPrefs(current => ({ ...current, sort: event.target.value }))}><option value="newest">Newest</option><option value="callsign">Callsign</option><option value="reference">Reference</option><option value="frequency">Frequency</option><option value="unworked">Unworked first</option></select></label>
      <span aria-live="polite">{rows.length} matching · {snapshot.total_available} available</span></div>
      {snapshot.history_state !== "ready" && <p className="opportunities-warning">Logbook history is unavailable; worked and confirmed labels are withheld.</p>}
      <div className="opportunities-table-wrap" ref={tableRef}><table><thead><tr><th>Call / operation</th><th>Reference</th><th>Band / mode</th><th>Evidence</th><th>History</th><th>Action</th></tr></thead>
        <tbody>{pageRows.map(item => <tr key={item.id} className={selected === item.id ? "is-selected" : ""}><td><strong>{item.callsign}</strong><small title={item.name}>{item.name || (item.kind === "dxpedition" || item.kind === "special_event" ? item.source : "Name unavailable")}</small></td>
          <td><span className={item.reference_status === "verified" ? "opportunities-verified" : ""}>{item.reference ? `${labels[item.kind] || item.kind} · ${item.reference}` : labels[item.kind] || item.kind}</span><small>{item.reference_status === "not_found" ? "Not in installed directory" : item.reference_status === "not_installed" ? "Directory not installed" : ""}</small></td>
          <td>{mhz(item.frequency_hz)}<small>{item.mode || "Mode not supplied"}</small></td>
          <td>{time(item.observed_at)}<small>{officialLink(item.source_url) ? <a href={officialLink(item.source_url)} target="_blank" rel="noreferrer">{item.source}</a> : item.source}</small></td>
          <td title={item.band_modes?.map(cell => `${cell.band} ${cell.mode}: ${cell.worked_count} worked, ${cell.confirmed_count} confirmed`).join(" · ")}>{!item.reference ? "No reference history" : snapshot.history_state === "ready" ? <>{item.worked_count ? `${item.worked_count} worked` : "Unworked reference"}<small>{item.confirmed_count} confirmed</small></> : "Unknown"}</td>
          <td><button type="button" onClick={() => choose(item)} aria-label={`Load ${item.callsign} into QSO draft`}>Load QSO</button></td></tr>)}
          {!rows.length && <tr><td colSpan={6} className="opportunities-empty">{busy ? "Loading live feeds…" : "No matching live observations. Feeds refresh automatically; try another programme or filter."}</td></tr>}
        </tbody></table></div>
      <nav className="opportunities-pagination" aria-label="Chaser pages"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>{rows.length ? currentPage * pageSize + 1 : 0}–{Math.min((currentPage + 1) * pageSize, rows.length)} of {rows.length}</span><button type="button" disabled={(currentPage + 1) * pageSize >= rows.length} onClick={() => setPage(currentPage + 1)}>Next</button>{showMap && <span>{mapSpots.length} located observations · selection loads a draft only</span>}</nav>
      {showMap && <div className="opportunities-map"><Suspense fallback={<p>Loading map…</p>}><OpportunityMap selected={selected} data={mapSpots} home={home} compact
        spotActionLabel="Load QSO draft only" locationLabel="Park / summit coordinates · public feed or installed directory"
        onSpot={spot => { const item = rows.find(row => row.id === spot.id); if (item) choose(item); }} /></Suspense></div>}
    </>}
  </section>;
}

export default OpportunitiesPanel;

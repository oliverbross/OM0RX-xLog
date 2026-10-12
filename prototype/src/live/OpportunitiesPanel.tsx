import { useEffect, useMemo, useRef, useState } from "react";
import "./OpportunitiesPanel.css";

export type Opportunity = {
  id: string; kind: string; callsign: string; reference: string; name: string;
  frequency_hz: number | null; mode: string; observed_at: string; expires_at: string;
  source: string; source_url: string; comment: string; reference_status: string;
  worked_count: number; confirmed_count: number;
  band_modes?: { band: string; mode: string; worked_count: number; confirmed_count: number }[];
};
type Source = { source: string; state: string; count: number; source_url: string;
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

export function OpportunitiesPanel({ request, onSelect, refresh = 0 }: { request: Request; onSelect: (item: Opportunity) => void; refresh?: number }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [kind, setKind] = useState<(typeof kinds)[number]>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const requestRef = useRef(request); requestRef.current = request;
  useEffect(() => {
    let active = true;
    setError("");
    void requestRef.current("opportunities_snapshot").then(value => {
      if (active) setSnapshot(value as Snapshot);
    }).catch(() => { if (active) setError("Opportunities could not be loaded. Check the workspace and retry."); });
    return () => { active = false; };
  }, [refresh]);
  const reload = async (source?: string) => {
    setBusy(source ?? "snapshot"); setError("");
    try {
      const value = await requestRef.current(source ? "opportunities_refresh" : "opportunities_snapshot", source ? { source } : undefined);
      setSnapshot(value as Snapshot);
    } catch { setError(source ? `${source.toUpperCase()} could not be checked. The earlier snapshot is retained.` : "Opportunities could not be loaded."); }
    finally { setBusy(""); }
  };
  const rows = useMemo(() => (snapshot?.items ?? []).filter(item =>
    (kind === "all" || item.kind === kind) &&
    `${item.callsign} ${item.reference} ${item.name}`.toUpperCase().includes(query.trim().toUpperCase())), [snapshot, kind, query]);
  return <section className="opportunities" aria-label="Chaser and DX calendar">
    <header className="opportunities-head"><div><h2>Chaser & DX calendar</h2><p>Live observations and dated operations. Select loads a QSO draft; it never tunes or transmits.</p></div>
      <button type="button" disabled={Boolean(busy)} onClick={() => void reload()}>Refresh view</button></header>
    <div className="opportunities-sources" aria-label="Public source status">
      {(snapshot?.sources ?? []).map(source => <div className="opportunities-source" key={source.source}>
        <strong>{source.source === "425dxn" ? "425DXN" : source.source.toUpperCase()}</strong>
        <span className={`opportunities-state opportunities-state-${source.state}`}>{source.state}</span>
        <small>{source.safe_error ? "Last check failed · " : ""}{source.last_success ? `Last good ${time(source.last_success)}` : "No verified snapshot"}</small>
        <button type="button" disabled={Boolean(busy)} onClick={() => void reload(source.source)} aria-label={`Check ${source.source.toUpperCase()} source`}>{busy === source.source ? "Checking…" : "Check"}</button>
      </div>)}
      {!snapshot && <p>Loading local and previously checked source evidence…</p>}
    </div>
    {error && <p className="opportunities-error" role="alert">{error}</p>}
    {snapshot && <><div className="opportunities-filters"><label>Programme<select value={kind} onChange={event => setKind(event.target.value as typeof kind)}>{kinds.map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></label>
      <label className="opportunities-search">Search call or reference<input value={query} onChange={event => setQuery(event.target.value)} /></label>
      <span aria-live="polite">{rows.length} shown · {snapshot.total_available} available</span></div>
      {snapshot.history_state !== "ready" && <p className="opportunities-warning">Logbook history is unavailable; worked and confirmed labels are withheld.</p>}
      <div className="opportunities-table-wrap"><table><thead><tr><th>Call / operation</th><th>Reference</th><th>Band / mode</th><th>Evidence</th><th>History</th><th>Action</th></tr></thead>
        <tbody>{rows.map(item => <tr key={item.id}><td><strong>{item.callsign}</strong><small>{item.name || (item.kind === "dxpedition" || item.kind === "special_event" ? item.source : "Name unavailable")}</small></td>
          <td><span className={item.reference_status === "verified" ? "opportunities-verified" : ""}>{item.reference || labels[item.kind] || item.kind}</span><small>{item.reference_status === "not_found" ? "Not in installed directory" : item.reference_status === "not_installed" ? "Directory not installed" : ""}</small></td>
          <td>{mhz(item.frequency_hz)}<small>{item.mode || "Mode not supplied"}</small></td>
          <td>{time(item.observed_at)}<small>{officialLink(item.source_url) ? <a href={officialLink(item.source_url)} target="_blank" rel="noreferrer">{item.source}</a> : item.source}</small></td>
          <td>{!item.reference ? "No reference history" : snapshot.history_state === "ready" ? <>{item.worked_count ? `${item.worked_count} worked` : "Unworked reference"}<small>{item.confirmed_count} confirmed</small>{item.band_modes?.length ? <small>{item.band_modes.map(cell => `${cell.band} ${cell.mode}: ${cell.worked_count} worked, ${cell.confirmed_count} confirmed`).join(" · ")}</small> : null}</> : "Unknown"}</td>
          <td><button type="button" onClick={() => onSelect(item)} aria-label={`Load ${item.callsign} into QSO draft`}>Load QSO</button></td></tr>)}
          {!rows.length && <tr><td colSpan={6} className="opportunities-empty">No matching observations. Check a public source explicitly or review the DX cluster connection.</td></tr>}
        </tbody></table></div>
      <footer><span>Public source data is best-effort; ages and directory status remain visible. Loading a row is not a radio command.</span></footer>
    </>}
  </section>;
}

export default OpportunitiesPanel;

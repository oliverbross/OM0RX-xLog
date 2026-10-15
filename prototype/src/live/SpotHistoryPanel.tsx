import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react";
import { useLogbookCapacity } from "./logbookCapacity";
import { SpotHistoryColumnHeader, SpotHistoryColumns, useSpotHistoryColumns } from "./SpotHistoryColumns";
import { spotHistoryColumns, type SpotHistoryColumn } from "./spotHistoryColumnPreferences";
import "./SpotHistoryPanel.css";

type Request = (method: string, params?: Record<string, unknown>) => Promise<any>;
export type SpotHistoryObservation = {
  id: string; sessionID: string; sequence: number; clusterID: string; clusterName: string; clusterHost: string;
  arrivedAt: string; reportedAt: string | null; timeBasis: string; recordKind: string;
  callsign: string; spotter: string; frequencyKHz: number; frequencyText: string;
  band: string; mode: string; source: string; country: string; adif: number | null;
  comment: string; specialTags: string[]; callStatus: string; dxccStatus: string;
  rawLine?: string; classificationJSON?: string; commentTruncated?: boolean; metadataTruncated?: boolean;
};
type Page = { rows: SpotHistoryObservation[]; nextCursor: string | null; watermark: number; revision: number };
type Bucket = { key: string; count: number };
type Stats = { total: number; distinctCalls: number; distinctSpotters: number; bands: Bucket[]; modes: Bucket[];
  countries: Bucket[]; sources: Bucket[]; spotters: Bucket[]; hourly: { hour: string; count: number }[];
  earliest: string | null; latest: string | null; watermark: number; revision: number; bucketsTruncated: boolean };
type Status = { status: { revision: number; total: number; earliest: string | null; latest: string | null;
  lastCommit: string | null; schemaVersion: number; fileBytes: number } | null;
  recording: { state: "recording" | "idle" | "degraded" | "unavailable" | "stopped"; queued: number;
    unrecorded: number; errorCode: string | null; startedAt: string;
    connections: { sessionID: string; clusterID: string; clusterName: string; phase: string; at: string }[];
    events?: { id: string; occurredAt: string; kind: string; payloadJSON: string }[]; retainedGap?: boolean; unknownGap?: boolean } };
type Draft = { call: string; spotter: string; match: "exact" | "prefix"; range: "24h" | "custom" | "all";
  from: string; to: string; band: string; mode: string; source: string };
type Browse = { cursor?: string; watermark?: number; previous: (string | undefined)[]; index: number; limit: number; resized?: boolean };
const firstPage: Browse = { previous: [], index: 0, limit: 100 };
const bands = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "2m", "70cm"];
const modes = ["CW", "SSB", "FT8", "FT4", "FT2", "RTTY", "PSK", "DIGI", "AM", "FM"];
function result<T>(raw: any): T { return (raw && typeof raw === "object" && "result" in raw ? raw.result : raw) as T; }
export function spotHistoryUTC(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 19).replace("T", " ");
}
function initialDraft(): Draft {
  const now = new Date();
  return { call: "", spotter: "", match: "exact", range: "24h", from: new Date(now.getTime() - 86_400_000).toISOString().slice(0, 16),
    to: now.toISOString().slice(0, 16), band: "", mode: "", source: "" };
}
export function spotHistoryFilters(draft: Draft, now = new Date()): Record<string, unknown> {
  const filters: Record<string, unknown> = { match: draft.match };
  for (const key of ["call", "spotter", "band", "mode", "source"] as const) {
    const value = draft[key].trim();
    if (value) filters[key] = key === "call" || key === "spotter" ? value.toUpperCase() : value;
  }
  if (draft.range === "24h") {
    filters.from = new Date(now.getTime() - 86_400_000).toISOString(); filters.to = now.toISOString();
  } else if (draft.range === "custom") {
    const parse = (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw new Error("Enter both UTC dates and times.");
      const date = new Date(`${value}Z`);
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, value.length) !== value) throw new Error("Enter valid UTC dates and times.");
      return date.toISOString();
    };
    filters.from = parse(draft.from); filters.to = parse(draft.to);
    if (String(filters.from) >= String(filters.to)) throw new Error("From UTC must be earlier than To UTC.");
  }
  return filters;
}
function Distribution({ label, buckets }: { label: string; buckets: Bucket[] }) {
  return <div><dt>{label}</dt><dd>{buckets.length ? buckets.map(bucket => `${bucket.key || "Unknown"} ${bucket.count.toLocaleString()}`).join(" · ") : "No values"}</dd></div>;
}

export function SpotHistoryPanel({ request }: { request: Request }) {
  const id = useId();
  const [columnPreferences, setColumnPreferences] = useSpotHistoryColumns();
  const [columnsOpen, setColumnsOpen] = useState(false);
  const visibleColumns = new Set(columnPreferences.columns);
  const tableWidth = columnPreferences.columns.reduce((sum, column) => sum + columnPreferences.widths[column], 0);
  const resizeColumn = (column: SpotHistoryColumn, width: number) => setColumnPreferences(current => ({ ...current, widths: { ...current.widths, [column]: width } }));
  const [draft, setDraft] = useState(initialDraft);
  const [scope, setScope] = useState(() => spotHistoryFilters(initialDraft()));
  const [scopeRange, setScopeRange] = useState<Draft["range"]>("24h");
  const [browse, setBrowse] = useState<Browse>(firstPage);
  const [reload, setReload] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [loading, setLoading] = useState(true), [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState(""), [statsError, setStatsError] = useState(""), [validation, setValidation] = useState("");
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<SpotHistoryObservation | null>(null);
  const [detailOpen, setDetailOpen] = useState(false), [detail, setDetail] = useState<SpotHistoryObservation | null>(null);
  const [detailLoading, setDetailLoading] = useState(false), [detailError, setDetailError] = useState("");
  const [detailReload, setDetailReload] = useState(0);
  const requestRef = useRef(request); requestRef.current = request;
  const queryVersion = useRef(0), detailVersion = useRef(0);
  const statsCache = useRef<{ key: string; stats: Stats } | null>(null);
  const rows = useRef(new Map<string, HTMLTableRowElement>());
  const tableArea = useRef<HTMLDivElement>(null);
  const detailToggle = useRef<HTMLButtonElement>(null);
  const capacity = useLogbookCapacity(tableArea, page?.rows.length ?? 0);
  const selected = page?.rows.find(row => row.id === selectedID) ?? selectedReport;
  const selectionOnPage = page?.rows.some(row => row.id === selectedID) ?? false;
  useLayoutEffect(() => {
    if (capacity === browse.limit) return;
    queryVersion.current++;
    // Cursors exclude the limit, so resizing keeps the report position and
    // snapshot. An open report stays inspectable even outside the resized page.
    setBrowse(current => ({ ...current, watermark: page?.watermark ?? current.watermark, limit: capacity, resized: true }));
  }, [capacity, browse.limit, page?.watermark]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = result<Status>(await requestRef.current("spot_history_status", {}));
        if (!response?.recording) throw new Error("Missing archive status");
        if (active) { setStatus(response); setStatusError(false); }
      } catch { if (active) setStatusError(true); }
      finally { if (active) timer = setTimeout(poll, 5000); }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, []);

  useEffect(() => {
    const version = ++queryVersion.current;
    setLoading(true); setStatsLoading(false); setError(""); setStatsError("");
    if (!browse.resized) { setSelectedID(null); setSelectedReport(null); setDetailOpen(false); }
    const read = async () => {
      try {
        const params = { ...scope, limit: browse.limit, ...(browse.cursor ? { cursor: browse.cursor } : {}),
          ...(browse.watermark !== undefined ? { watermark: browse.watermark } : {}) };
        const response = result<{ page: Page }>(await requestRef.current("spot_history_query", params));
        if (version !== queryVersion.current) return;
        if (!response?.page || !Array.isArray(response.page.rows)) throw new Error("Missing archive page");
        const next = response.page;
        setPage(next); setLoading(false);
        const statsKey = JSON.stringify([scope, next.watermark]);
        if (statsCache.current?.key === statsKey) { setStats(statsCache.current.stats); return; }
        setStatsLoading(true); setStats(null);
        try {
          const summary = result<{ stats: Stats }>(await requestRef.current("spot_history_stats", { ...scope, watermark: next.watermark }));
          if (version !== queryVersion.current) return;
          if (!summary?.stats || summary.stats.watermark !== next.watermark) throw new Error("Archive summary snapshot changed");
          statsCache.current = { key: statsKey, stats: summary.stats }; setStats(summary.stats);
        } catch { if (version === queryVersion.current) setStatsError("Statistics could not be read. Retry to calculate this scope."); }
        finally { if (version === queryVersion.current) setStatsLoading(false); }
      } catch { if (version === queryVersion.current) { setPage(null); setStats(null); setError("Spot history could not be read. Check archive status and retry."); setLoading(false); } }
    };
    void read();
    return () => { queryVersion.current++; };
  }, [scope, browse, reload]);

  useEffect(() => {
    const version = ++detailVersion.current;
    setDetail(null); setDetailError(""); setDetailLoading(false);
    if (!detailOpen || !selectedID) return;
    setDetailLoading(true);
    requestRef.current("spot_history_detail", { id: selectedID }).then(raw => {
      if (version !== detailVersion.current) return;
      const response = result<{ observation: SpotHistoryObservation | null }>(raw);
      if (!response?.observation || response.observation.id !== selectedID) setDetailError("This report is unavailable. Retry or select another report.");
      else setDetail(response.observation);
    }).catch(() => { if (version === detailVersion.current) setDetailError("Report details could not be read. Retry to open the original source."); })
      .finally(() => { if (version === detailVersion.current) setDetailLoading(false); });
    return () => { detailVersion.current++; };
  }, [detailOpen, selectedID, detailReload]);

  function reset(nextScope: Record<string, unknown>) {
    queryVersion.current++; detailVersion.current++;
    statsCache.current = null; setStats(null); setPage(null);
    setScope(nextScope); setBrowse({ ...firstPage, limit: capacity }); setReload(value => value + 1); setValidation("");
  }
  function search(event: FormEvent) {
    event.preventDefault();
    try { const filters = spotHistoryFilters(draft); setScopeRange(draft.range); reset(filters); } catch (cause) { setValidation(cause instanceof Error ? cause.message : "Check the UTC range."); }
  }
  function refresh() {
    const nextScope = { ...scope };
    if (scopeRange === "24h") {
      // Keep unapplied fields out of Refresh; only advance the active rolling window.
      const now = new Date(); nextScope.from = new Date(now.getTime() - 86_400_000).toISOString(); nextScope.to = now.toISOString(); reset(nextScope);
    } else reset(nextScope);
  }
  function move(direction: "next" | "previous") {
    if (!page) return;
    queryVersion.current++; detailVersion.current++;
    setBrowse(current => direction === "next"
      ? { cursor: page.nextCursor ?? undefined, watermark: page.watermark, previous: [...current.previous, current.cursor], index: current.index + 1, limit: current.limit }
      : { cursor: current.previous.at(-1), watermark: page.watermark, previous: current.previous.slice(0, -1), index: current.index - 1, limit: current.limit });
  }
  function select(row: SpotHistoryObservation) { detailVersion.current++; setSelectedID(row.id); setSelectedReport(row); setDetailOpen(false); }
  function rowKey(event: KeyboardEvent, row: SpotHistoryObservation, index: number) {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); detailVersion.current++; setSelectedID(row.id); setSelectedReport(row); setDetailOpen(open => selectedID === row.id ? !open : true); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const next = page?.rows[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (next) { select(next); rows.current.get(next.id)?.focus(); }
  }
  const unavailable = status?.recording.state === "unavailable" || (!!status && status.status === null);
  const gap = (status?.recording.unrecorded ?? 0) > 0 || !!status?.recording.retainedGap;
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }));

  return <section className="spot-history" aria-label="Spot history archive">
    <form className="spot-history-filters" onSubmit={search}>
      <label>Callsign<input aria-label="History callsign" value={draft.call} onChange={event => update("call", event.target.value)} placeholder="e.g. OM0RX/P" autoCapitalize="characters" spellCheck={false} /></label>
      <label>Spotter<input aria-label="History spotter" value={draft.spotter} onChange={event => update("spotter", event.target.value)} placeholder="Any spotter" autoCapitalize="characters" spellCheck={false} /></label>
      <label>Match<select value={draft.match} onChange={event => update("match", event.target.value as Draft["match"])}><option value="exact">Exact</option><option value="prefix">Prefix</option></select></label>
      <label>UTC range<select value={draft.range} onChange={event => update("range", event.target.value as Draft["range"])}><option value="24h">Last 24 hours</option><option value="custom">Custom UTC</option><option value="all">All retained</option></select></label>
      {draft.range === "custom" && <Fragment><label>From UTC<input type="datetime-local" value={draft.from} onChange={event => update("from", event.target.value)} /></label><label>To UTC<input type="datetime-local" value={draft.to} onChange={event => update("to", event.target.value)} /></label></Fragment>}
      <label>Band<select value={draft.band} onChange={event => update("band", event.target.value)}><option value="">All bands</option>{bands.map(band => <option key={band}>{band}</option>)}</select></label>
      <label>Mode<select value={draft.mode} onChange={event => update("mode", event.target.value)}><option value="">All modes</option>{modes.map(mode => <option key={mode}>{mode}</option>)}</select></label>
      <label>Source<input aria-label="History source" value={draft.source} onChange={event => update("source", event.target.value)} placeholder="Any source" /></label>
      <button type="submit"><Search size={13} aria-hidden="true" />Search</button>
      <button type="button" onClick={refresh} disabled={loading}><RefreshCw size={13} aria-hidden="true" />Refresh</button>
      <button type="button" aria-expanded={columnsOpen} aria-controls={`${id}-columns`} onClick={() => setColumnsOpen(open => !open)}>Columns</button>
    </form>
    {columnsOpen && <SpotHistoryColumns id={`${id}-columns`} preferences={columnPreferences} onChange={setColumnPreferences} onDone={() => setColumnsOpen(false)} />}
    {validation && <p className="spot-history-message error" role="alert">{validation}</p>}
    <div className="spot-history-health" role="status">
      <span className={unavailable || statusError ? "error" : status?.recording.state === "degraded" || gap ? "warning" : status?.recording.state === "recording" ? "recording" : ""}>
        {statusError ? "Archive status unavailable" : !status ? "Checking archive status…" : unavailable ? "History unavailable" : status.recording.state === "degraded" ? "Recording degraded" : status.recording.state === "recording" ? "Recording" : status.recording.state === "stopped" ? "Recording stopped" : "Recording idle"}
      </span>
      {status?.status && <span>{status.status.total.toLocaleString()} retained{status.recording.queued > 0 ? ` · ${status.recording.queued.toLocaleString()} queued` : ""}</span>}
      {gap && <span className="warning">{status!.recording.unrecorded > 0 ? `Known archive gap: ${status!.recording.unrecorded.toLocaleString()} unrecorded reports` : "Known archive gap: inspect recorded coverage events"}</span>}
      {status?.recording.unknownGap && <span className="warning">A recording interruption has an unknown extent.</span>}
      <span className="spot-history-local-note">Reports received locally; disconnected periods are not backfilled.</span>
      {status && <details><summary>Recording details</summary><div className="spot-history-health-details">
        <span>Started UTC: {spotHistoryUTC(status.recording.startedAt)}</span>
        <span>Last commit UTC: {spotHistoryUTC(status.status?.lastCommit)}</span>
        {status.recording.errorCode && <span>Recording code: {status.recording.errorCode}</span>}
        {status.recording.connections.length ? status.recording.connections.map(connection => <span key={connection.sessionID}>{connection.clusterName}: {connection.phase} · {spotHistoryUTC(connection.at)} UTC</span>) : <span>No cluster connections recorded in this session.</span>}
        {!!status.recording.events?.length && <div className="spot-history-coverage" aria-label="Recorded coverage events"><strong>Recorded coverage events</strong>{status.recording.events.slice(-128).map(event => <details key={event.id}><summary>{spotHistoryUTC(event.occurredAt)} UTC · {event.kind}</summary><pre>{event.payloadJSON}</pre></details>)}</div>}
      </div></details>}
    </div>
    <div className="spot-history-summary" aria-live="polite">
      {stats ? <><span><strong>{stats.total.toLocaleString()}</strong> reports in scope</span><span>{stats.distinctCalls.toLocaleString()} callsigns</span><span>{stats.distinctSpotters.toLocaleString()} spotters</span>
        <details><summary>Statistics</summary><dl className="spot-history-distributions">
          <Distribution label="Bands" buckets={stats.bands} /><Distribution label="Modes" buckets={stats.modes} />
          <Distribution label="Countries" buckets={stats.countries} /><Distribution label="Sources" buckets={stats.sources} /><Distribution label="Top spotters" buckets={stats.spotters} />
          <div><dt>Hourly activity UTC</dt><dd>{stats.hourly.length ? stats.hourly.map(bucket => `${spotHistoryUTC(bucket.hour)}: ${bucket.count.toLocaleString()}`).join(" · ") : "No activity"}</dd></div>
          <div><dt>Observed interval UTC</dt><dd>{spotHistoryUTC(stats.earliest)} — {spotHistoryUTC(stats.latest)}</dd></div>
          {stats.bucketsTruncated && <div><dt>Bucket limit</dt><dd>Top groups are shown; report and distinct totals cover the complete scope.</dd></div>}
        </dl></details></> : <span>{statsLoading ? "Calculating statistics for the complete scope…" : statsError ? statsError : loading ? "Reading archive…" : "Statistics unavailable"}</span>}
      {statsError && <button onClick={() => { queryVersion.current++; setReload(value => value + 1); }}>Retry statistics</button>}
    </div>
    <p className="spot-history-scope">{scope.from ? `${spotHistoryUTC(String(scope.from))} — ${spotHistoryUTC(String(scope.to))} UTC` : "All retained dates"} · Newest received first{page ? ` · Snapshot ${page.watermark}` : ""}{browse.resized ? " · Layout resized; report position and snapshot retained" : ""}</p>
    {detailOpen && selected && <section id={`${id}-details`} className="spot-history-detail" aria-label={`Report details for ${selected.callsign}`}>
      <div className="spot-history-detail-head"><strong>{selected.callsign} · report details</strong><button onClick={() => { detailVersion.current++; setDetailOpen(false); detailToggle.current?.focus(); }}>Close details</button></div>
      {detailLoading ? <p role="status">Reading original report…</p> : detailError ? <p className="error" role="alert">{detailError} <button onClick={() => setDetailReload(value => value + 1)}>Retry details</button></p> : detail && <dl>
        <div><dt>Callsign / Spotter</dt><dd>{detail.callsign} / {detail.spotter}</dd></div><div><dt>Frequency / Band / Mode</dt><dd>{detail.frequencyText || detail.frequencyKHz} kHz · {detail.band || "Unknown"} · {detail.mode || "Unknown"}</dd></div>
        <div><dt>Received UTC</dt><dd>{spotHistoryUTC(detail.arrivedAt)}</dd></div><div><dt>Reported UTC / Time basis</dt><dd>{spotHistoryUTC(detail.reportedAt)} · {detail.timeBasis}</dd></div>
        <div><dt>Cluster / Host / Source</dt><dd>{detail.clusterName} · {detail.clusterHost} · {detail.source}</dd></div><div><dt>Country / ADIF</dt><dd>{detail.country || "Unknown"} · {detail.adif ?? "—"}</dd></div>
        <div><dt>Stored classification</dt><dd>{detail.callStatus || "Unknown"} · {detail.dxccStatus || "Unknown"} · {detail.specialTags?.join(", ") || "No special tags"}</dd></div><div><dt>Session / Sequence / Record kind</dt><dd>{detail.sessionID} · {detail.sequence} · {detail.recordKind}</dd></div>
        <div className="spot-history-detail-wide"><dt>Full comment</dt><dd>{detail.comment || "No comment"}</dd></div>
        <div className="spot-history-detail-wide"><dt>Decoded source line</dt><dd><pre>{detail.rawLine || "Not retained"}</pre></dd></div>
        <div className="spot-history-detail-wide"><dt>Classification provenance</dt><dd><pre>{detail.classificationJSON || "Not retained"}</pre></dd></div>
      </dl>}
    </section>}
    <div ref={tableArea} className="spot-history-table-wrap" tabIndex={0} aria-label="History reports table" aria-busy={loading}>
      <table className="spot-history-table" style={{ width: tableWidth, minWidth: "100%" }}><caption className="spot-history-sr-only">Individual cluster reports, newest received first. Select a report and open Details to read all stored fields.</caption>
        <colgroup>{columnPreferences.columns.map(column => <col key={column} style={{ width: columnPreferences.widths[column] }} />)}</colgroup>
        <thead><tr>{spotHistoryColumns.filter(([column]) => visibleColumns.has(column)).map(([column, label]) => <SpotHistoryColumnHeader key={column} column={column} label={label} width={columnPreferences.widths[column]} onWidth={resizeColumn} />)}</tr></thead>
        <tbody>{page?.rows.map((row, index) => <tr key={row.id} ref={node => { if (node) rows.current.set(row.id, node); else rows.current.delete(row.id); }}
          aria-selected={selectedID === row.id} tabIndex={selectedID === row.id || (!selectionOnPage && index === 0) ? 0 : -1} onClick={() => select(row)} onDoubleClick={() => { setSelectedID(row.id); setSelectedReport(row); setDetailOpen(true); }} onKeyDown={event => rowKey(event, row, index)}>
          <td hidden={!visibleColumns.has("utc")} data-label="Received UTC" title={`${spotHistoryUTC(row.arrivedAt)} UTC`} className="history-data">{spotHistoryUTC(row.arrivedAt)}</td><td hidden={!visibleColumns.has("call")} data-label="Callsign" className="history-call-value" title={row.callsign}>{row.callsign}</td><td hidden={!visibleColumns.has("frequency")} data-label="kHz" className="history-frequency-value history-data">{row.frequencyText || row.frequencyKHz}</td><td hidden={!visibleColumns.has("bandMode")} data-label="Band / Mode">{row.band || "—"} / {row.mode || "—"}</td>
          <td hidden={!visibleColumns.has("spotter")} data-label="Spotter" title={row.spotter}>{row.spotter}</td><td hidden={!visibleColumns.has("source")} data-label="Source / Cluster" title={`${row.source} / ${row.clusterName}`}>{row.source} / {row.clusterName}</td><td hidden={!visibleColumns.has("country")} data-label="Country" title={row.country}>{row.country || "—"}</td><td hidden={!visibleColumns.has("comment")} data-label="Comment" title={`${row.comment}${row.commentTruncated ? " (shortened; open Details)" : ""}`}>{row.comment}</td>
        </tr>)}</tbody>
      </table>
      {(!page?.rows.length || loading || error) && <div className="spot-history-empty" role={error ? "alert" : "status"}>
        {loading ? <><div className="spot-history-skeleton" aria-hidden="true" /><p>Reading retained reports…</p></> : error ? <><p>{error}</p><button onClick={() => setReload(value => value + 1)}>Retry history</button></> : unavailable ? <><strong>History is unavailable</strong><p>The archive cannot be read. Check recording details, then retry.</p><button onClick={refresh}>Retry history</button></> : status?.status?.total === 0 ? <><strong>No reports retained yet</strong><p>Reports from enabled cluster connections will appear here as they arrive.</p></> : <><strong>No reports match this search</strong><p>Broaden the callsign, spotter or UTC range, then Search.</p></>}
      </div>}
    </div>
    <footer className="spot-history-footer"><span>{page?.rows.length ? `Page ${browse.index + 1} · ${page.rows.length.toLocaleString()} reports shown` : "No reports shown"}{selected?.commentTruncated || selected?.metadataTruncated ? " · Summary shortened; open Details for full stored fields" : ""}</span><div>
      <button ref={detailToggle} disabled={!selected} aria-expanded={detailOpen} aria-controls={`${id}-details`} onClick={() => setDetailOpen(open => !open)}>Details</button>
      <button disabled={browse.index === 0 || loading || !page} onClick={() => move("previous")}><ChevronLeft size={14} aria-hidden="true" />Previous</button>
      <button disabled={!page?.nextCursor || loading} onClick={() => move("next")}>Next<ChevronRight size={14} aria-hidden="true" /></button>
    </div></footer>
  </section>;
}

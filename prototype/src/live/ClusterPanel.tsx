import { useEffect, useId, useRef, useState } from "react";
import { clusterBandColors, clusterModeColors, clusterStatusColors, paletteColor, specialTagColors } from "./clusterPalette";
import { boundColumnWidth, compactClusterColumns, defaultWorkspacePreferences, readWorkspacePreferences, type CompactColumn } from "./operatorWorkspacePreferences";
import { useSettingsSaveToast } from "./SettingsSaveToast";
import { formatSpotAge, useSpotAgeClock } from "./spotAge";
import "./ClusterPanel.css";

type Request = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
export type LiveClusterSpot = {
  id: string; receivedAt: number; clusterName: string; spotter: string;
  frequencyKHz: number; frequencyText: string; callsign: string; comment: string;
  band: string; mode: string; country: string; adif?: number | null;
  continent: string; cqZone?: number | null; ituZone?: number | null;
  callStatus: string; dxccStatus: string; workedBefore?: number | null;
  specialTags: string[]; score: number; scoreReasons: string[];
  aggregateCount: number; aggregateSpotters: string[]; source: string;
  statusHex: string; bandHex: string; modeHex: string;
  activation?: { sourceEpoch: string; spotVersion: string };
};
type Connection = { serverID: string; serverName: string; phase: string; error?: string | null };
type ConsoleEntry = { receivedAt: number; source: string; text: string; isCommand: boolean };
type Snapshot = { connectedClusters: number; loadedSpots: number; contactCount: number;
  contactRevision: number; logbookDataLoaded: boolean; countryDataLoaded: boolean; connections: Connection[];
  spots: LiveClusterSpot[]; console: ConsoleEntry[] };
type Server = { id: string; name: string; host: string; port: number; callsign: string; enabled: boolean };
type Rule = { id: string; name: string; keywords: string[]; referenceFormat: string; advancedPattern: string; enabled: boolean };
type Filter = { query: string; bands: string[]; modes: string[]; continents: string[];
  callStatuses: string[]; dxccStatuses: string[]; specials: string[];
  sources: string[]; worked: string[]; sort: string };
export type ClusterPalette = { status: Record<string, string>; band: Record<string, string>; mode: Record<string, string> };
type Palette = ClusterPalette;
type CommandPreset = { id: string; name: string; command: string };
type Configuration = { servers: Server[]; reconnect: boolean; requestSkimmer: boolean;
  showWorkedBandModeSpots: boolean; hideWSPRSpots: boolean; maximumSpots: number; specialRules: Rule[];
  palette: Palette; filter: Filter; commandPresets: CommandPreset[]; forwardSpotsToFlex: boolean; radioSpotColorPolicy?: "callsign" | "dxcc" };
type Forwarding = { accepted_count: number; status: string };
type Response = { configuration?: Configuration; snapshot?: Snapshot; password_servers?: string[];
  password_storage_available?: boolean; flex_forwarding_available?: boolean;
  forwarding?: Forwarding; snapshot_truncated?: boolean };
type HistoryRow = { id: string; date: string; call: string; band: string; mode: string;
  rstSent: string; rstReceived: string; grid: string; lotwSent: string; lotwReceived: string; confirmed: boolean };
type History = { call: string; previous_count: number; previous: HistoryRow[]; adif?: number | null;
  country: string; cq_zone?: number | null; grid: string; dxcc_contact_count: number;
  matrix: { band: string; mode: string; worked: boolean; confirmed: boolean }[] };
type Props = { snapshot: unknown; onRequest: Request; onSelect: (spot: LiveClusterSpot) => void;
  passive?: boolean; onUndock?: () => void; onDock?: () => void; passwordControlsEnabled?: boolean; selectedSpotId?: string | null; taskOnly?: boolean };

const bands = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "2m", "70cm"];
const modes = ["CW", "SSB", "FT8", "FT4", "FT2", "RTTY", "PSK", "DIGI", "AM", "FM"];
const callStatuses = ["New Call", "New Band", "New Mode", "New Band+Mode", "Worked", "Confirmed", "Unknown"];
const dxccStatuses = ["ATNO", "C/New Band", "C/New Mode", "C/New Band+Mode", "W/New Band", "W/New Mode", "W/New Band+Mode", "Worked", "Confirmed", "Unknown"];
const formatDate = (value?: number | null) => value == null ? "—" : new Date((value + 978_307_200) * 1000).toLocaleString();
export const clusterRowTint = (status: string): string | undefined => {
  if (status === "ATNO") return "#FF8C0026";
  if (status.includes("Band+Mode")) return "#E91E6326";
  if (status.includes("New Band")) return "#00BFFF26";
  if (status.includes("New Mode")) return "#FFC00026";
  if (status === "Worked") return "#B0B0B01A";
  if (status === "Confirmed") return "#6464641A";
  return undefined;
};
const emptyFilter: Filter = { query: "", bands: [], modes: [], continents: [], callStatuses: [], dxccStatuses: [],
  specials: [], sources: ["cluster", "rbl"], worked: [], sort: "newest" };
export const fullClusterColumnsKey = "xlog.integration.full-cluster-columns.v1";
const defaultColumns = () => ({ ...defaultWorkspacePreferences(), columns: compactClusterColumns.map(([id]) => id) });
function ColumnWidthInput({ label, width, disabled, onCommit }: { label: string; width: number; disabled: boolean; onCommit: (width: number) => void }) {
  const [draft, setDraft] = useState(String(width));
  useEffect(() => { setDraft(String(width)); }, [width]);
  const commit = () => {
    const parsed = draft.trim() ? Number(draft) : NaN;
    const next = Number.isFinite(parsed) ? boundColumnWidth(parsed) : width;
    setDraft(String(next)); onCommit(next);
  };
  return <input type="number" aria-label={`${label} column width`} min={48} max={480} step={10} disabled={disabled}
    value={draft} onChange={event => setDraft(event.currentTarget.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />;
}
export function ClusterPanel({ snapshot, onRequest, onSelect, passive = false, onUndock, onDock, passwordControlsEnabled = true, selectedSpotId, taskOnly = false }: Props) {
  const saveToast = useSettingsSaveToast();
  const ageClock = useSpotAgeClock();
  const panelId = useId();
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [columnPreferences, setColumnPreferences] = useState(() => {
    try { const raw = localStorage.getItem(fullClusterColumnsKey); return raw ? readWorkspacePreferences(raw) : defaultColumns(); }
    catch { return defaultColumns(); }
  });
  const columnDrag = useRef<{ id: CompactColumn; x: number; width: number; scale: number } | null>(null);
  const visibleColumns = new Set(columnPreferences.columns);
  const totalColumnWidth = columnPreferences.columns.reduce((sum, id) => sum + columnPreferences.widths[id], 0);
  const resizeColumn = (id: CompactColumn, width: number) => {
    if (Number.isFinite(width)) setColumnPreferences(current => ({ ...current, widths: { ...current.widths, [id]: boundColumnWidth(width) } }));
  };
  useEffect(() => {
    try { localStorage.setItem(fullClusterColumnsKey, JSON.stringify(columnPreferences)); } catch { /* Keep usable in memory if storage is unavailable. */ }
  }, [columnPreferences]);
  const [consoleOpen, setConsoleOpen] = useState(false), [settingsOpen, setSettingsOpen] = useState(false);
  const requestRef = useRef(onRequest);
  const filterVersion = useRef(0);
  const lastRemoteFilter = useRef("");
  const lastRemoteConfiguration = useRef("");
  const draftBaseConfiguration = useRef<Configuration | null>(null);
  const historyVersion = useRef(0);
  const historyRevision = useRef<number | null>(null);
  const [live, setLive] = useState<Snapshot | null>((snapshot as Response | null)?.snapshot ?? null);
  const [configuration, setConfiguration] = useState<Configuration | null>(null);
  const [filter, setFilter] = useState<Filter>(emptyFilter);
  const [passwordServers, setPasswordServers] = useState<string[]>([]);
  const [passwordStorageAvailable, setPasswordStorageAvailable] = useState((snapshot as Response | null)?.password_storage_available !== false);
  const [, setForwardingAvailable] = useState((snapshot as Response | null)?.flex_forwarding_available !== false);
  const canEditPasswords = passwordControlsEnabled && passwordStorageAvailable;
  const passwordUnavailableReason = !passwordStorageAvailable ? "Secure password storage is unavailable on this platform" : "Dock back to manage passwords";
  const [savedServerIDs, setSavedServerIDs] = useState<string[]>([]);
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [activePicker, setActivePicker] = useState<keyof Filter | null>(null);
  const [command, setCommand] = useState("");
  const [commandTarget, setCommandTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<History | null>(null);
  const [historySpot, setHistorySpot] = useState<LiveClusterSpot | null>(null);
  const [selectedSpot, setSelectedSpot] = useState<LiveClusterSpot | null>(null);
  const [, setForwarding] = useState<Forwarding | null>(null);
  const [snapshotTruncated, setSnapshotTruncated] = useState(false);

  useEffect(() => {
    const next = snapshot as Response | null;
    if (next?.password_storage_available != null) setPasswordStorageAvailable(next.password_storage_available);
    if (next?.snapshot) setLive(next.snapshot);
    if (next?.configuration) {
      const remoteConfiguration = JSON.stringify(next.configuration);
      const localConfiguration = configuration ? JSON.stringify(configuration) : "";
      if (!configuration || localConfiguration === lastRemoteConfiguration.current || localConfiguration === remoteConfiguration) {
        setConfiguration(next.configuration);
        draftBaseConfiguration.current = next.configuration;
        setSavedServerIDs(next.configuration.servers.map(server => server.id));
        setPasswordServers(next.password_servers ?? []);
      }
      lastRemoteConfiguration.current = remoteConfiguration;
      const remoteFilter = JSON.stringify(next.configuration.filter);
      if (remoteFilter !== lastRemoteFilter.current) {
        lastRemoteFilter.current = remoteFilter;
        setFilter(next.configuration.filter);
      }
    }
    if (next?.snapshot_truncated != null) setSnapshotTruncated(next.snapshot_truncated);
  }, [snapshot]);
  useEffect(() => { requestRef.current = onRequest; }, [onRequest]);
  useEffect(() => {
    if (selectedSpotId === undefined) return;
    setSelectedSpot(live?.spots.find(spot => spot.id === selectedSpotId) ?? null);
  }, [selectedSpotId, live?.spots]);
  useEffect(() => {
    if (passive) return;
    let active = true;
    requestRef.current("cluster_snapshot", {}).then((raw) => {
      if (!active) return;
      const next = raw as Response;
      if (next.password_storage_available != null) setPasswordStorageAvailable(next.password_storage_available);
      if (next.flex_forwarding_available != null) setForwardingAvailable(next.flex_forwarding_available);
      if (next.configuration) { setConfiguration(next.configuration); draftBaseConfiguration.current = next.configuration; lastRemoteConfiguration.current = JSON.stringify(next.configuration); setFilter(next.configuration.filter); setSavedServerIDs(next.configuration.servers.map((s) => s.id)); }
      if (next.snapshot) setLive(next.snapshot);
      setPasswordServers(next.password_servers ?? []);
      if (next.forwarding) setForwarding(next.forwarding);
      if (next.snapshot_truncated != null) setSnapshotTruncated(next.snapshot_truncated);
    }).catch(() => { if (active) setError("Cluster state is unavailable. Check the worker and retry."); });
    const timer = window.setInterval(() => {
      requestRef.current("cluster_snapshot", {}).then((raw) => {
        if (active && (raw as Response).password_storage_available != null) setPasswordStorageAvailable((raw as Response).password_storage_available!);
        if (active && (raw as Response).flex_forwarding_available != null) setForwardingAvailable((raw as Response).flex_forwarding_available!);
        if (active && (raw as Response).snapshot) {
          setLive((raw as Response).snapshot ?? null);
          if ((raw as Response).forwarding) setForwarding((raw as Response).forwarding ?? null);
          if ((raw as Response).snapshot_truncated != null) setSnapshotTruncated((raw as Response).snapshot_truncated ?? false);
        }
      }).catch(() => {});
    }, 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [passive]);

  const accept = (raw: unknown) => {
    const next = raw as Response;
    if (next.password_storage_available != null) setPasswordStorageAvailable(next.password_storage_available);
    if (next.flex_forwarding_available != null) setForwardingAvailable(next.flex_forwarding_available);
    if (next.configuration) { setConfiguration(next.configuration); draftBaseConfiguration.current = next.configuration; lastRemoteConfiguration.current = JSON.stringify(next.configuration); }
    if (next.snapshot) setLive(next.snapshot);
    if (next.password_servers) setPasswordServers(next.password_servers);
    if (next.forwarding) setForwarding(next.forwarding);
    if (next.snapshot_truncated != null) setSnapshotTruncated(next.snapshot_truncated);
  };
  const request = async (method: string, params: Record<string, unknown> = {}, success = ""): Promise<boolean> => {
    setBusy(true); setError(""); setMessage("");
    try {
      accept(await onRequest(method, params));
      if (success) method === "cluster_password_set" ? saveToast.show(success) : setMessage(success);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cluster request failed. Check settings and retry.");
      return false;
    } finally { setBusy(false); }
  };
  const changeFilter = (next: Filter) => {
    setFilter(next);
    setConfiguration(current => current ? { ...current, filter: next } : current);
    const version = ++filterVersion.current;
    onRequest("cluster_filter", { filter: next }).then((raw) => {
      if (version === filterVersion.current && (raw as Response).snapshot) setLive((raw as Response).snapshot ?? null);
    }).catch(() => { if (version === filterVersion.current) setError("Could not apply cluster filters."); });
  };
  const saveConfig = async () => {
    if (!configuration) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const base = draftBaseConfiguration.current;
      if (!base) throw new Error("Current cluster settings are unavailable. Refresh and retry.");
      accept(await onRequest("cluster_configure", { configuration, base_configuration: base }));
      setSavedServerIDs(configuration.servers.map((server) => server.id));
      saveToast.show("Cluster settings saved. Received spots retained.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cluster settings could not be saved. Check settings and retry.");
    } finally { setBusy(false); }
  };
  const updateServer = (id: string, patch: Partial<Server>) => {
    setConfiguration((current) => current && ({ ...current, servers: current.servers.map((s) => s.id === id ? { ...s, ...patch } : s) }));
  };
  const openHistory = async (spot: LiveClusterSpot) => {
    const version = ++historyVersion.current;
    setHistorySpot(spot);
    setError("");
    try {
      const result = await onRequest("cluster_history", { call: spot.callsign,
        ...(spot.adif ? { adif: spot.adif } : {}) }) as { history?: History };
      if (version === historyVersion.current && result.history) setHistory(result.history);
    } catch { if (version === historyVersion.current) setError("Previous QSOs are unavailable. Open the integrated logbook workspace first."); }
  };
  useEffect(() => {
    const revision = live?.contactRevision;
    if (revision == null) return;
    if (historyRevision.current != null && revision !== historyRevision.current && historySpot) {
      void openHistory(historySpot);
    }
    historyRevision.current = revision;
  }, [live?.contactRevision, historySpot]);
  const allConnections = live?.connections ?? [];
  const connected = live?.connectedClusters ?? 0;
  const specialNames = configuration?.specialRules.filter((r) => r.enabled).map((r) => r.name) ?? [];
  const filterOptions: Partial<Record<keyof Filter, string[]>> = {
    bands, modes, continents: ["AF", "AN", "AS", "EU", "NA", "OC", "SA"],
    callStatuses, dxccStatuses, specials: specialNames,
    sources: ["cluster", "rbl"], worked: ["Worked before", "Not worked"],
  };
  const filterLabels: Partial<Record<keyof Filter, string>> = {
    bands: "Bands", modes: "Modes", continents: "Continent", callStatuses: "Call status",
    dxccStatuses: "DXCC status", specials: "Special", sources: "Source", worked: "Worked",
  };

  return <section className="live-cluster" aria-label="Live DX Cluster">
    <header className="live-cluster-head">
      <div>{!taskOnly && <h2>DX Cluster</h2>}<p>{connected} live · {live?.spots.length ?? 0} shown / {live?.loadedSpots ?? 0} received · {live?.contactCount ?? 0} log contacts</p></div>
      <div className="live-cluster-actions">
        <div className="live-cluster-connection-summary" role="status" aria-label="Cluster connections">{allConnections.length ? allConnections.map(connection => {
          const phase = connection.phase.toLowerCase(), label = phase.charAt(0).toUpperCase() + phase.slice(1);
          return <span key={connection.serverID} className={phase === "connected" ? "live-cluster-connected" : "live-cluster-disconnected"}><i className={`phase-${phase}`} />{connection.serverName} · {label}{connection.error && <small className="live-cluster-connection-error"> · {connection.error}</small>}</span>;
        }) : <span className={connected ? "live-cluster-connected" : "live-cluster-disconnected"}>{connected ? `${connected} cluster${connected === 1 ? "" : "s"} · Connected` : "Disconnected"}</span>}</div>
        <button type="button" disabled={busy || !configuration?.servers.some((s) => s.enabled)} onClick={() => void request("cluster_connect", {}, "Connecting to configured clusters…")}>Connect</button>
        <button type="button" disabled={busy || !live?.connections?.length} onClick={() => void request("cluster_disconnect", {}, "Disconnected")}>Disconnect</button>
        <button type="button" disabled={busy} onClick={() => void request("cluster_snapshot")}>Refresh</button>
        <button type="button" aria-expanded={consoleOpen} aria-controls={`${panelId}-console`} onClick={() => setConsoleOpen(value => !value)}>Console</button>
        <button type="button" aria-expanded={settingsOpen} aria-controls={`${panelId}-settings`} onClick={() => setSettingsOpen(value => !value)}>Settings</button>
        {onUndock && <button type="button" onClick={onUndock}>Undock</button>}
        {onDock && <button type="button" onClick={onDock}>Dock back</button>}
      </div>
    </header>
    {!live?.logbookDataLoaded && <p className="live-cluster-note">No integrated logbook is open; worked and confirmed status remains Unknown.</p>}
    {!live?.countryDataLoaded && <p className="live-cluster-note">Country reference data is unavailable; DXCC status stays Unknown.</p>}
    {snapshotTruncated && <p className="live-cluster-note">The live snapshot exceeded the worker limit; older console lines or spots are hidden. Narrow filters to view more.</p>}
    {error && <p className="live-cluster-error" role="alert">{error}</p>}
    {message && <p className="live-cluster-message" role="status">{message}</p>}{saveToast.toast}
    {renderToolbarPanels()}

    <div className="live-cluster-filter-container"><div className="live-cluster-filterrail" aria-label="Spot filters">
      <input aria-label="Search spots" placeholder="Callsign, country or note" value={filter.query} maxLength={128}
        onChange={(event) => changeFilter({ ...filter, query: event.target.value })} />
      {(Object.keys(filterLabels) as (keyof Filter)[]).map((key) => {
        const values = filter[key] as string[];
        return <button type="button" key={key} data-filter={key} aria-expanded={activePicker === key}
          onClick={() => setActivePicker(activePicker === key ? null : key)}>
          {filterLabels[key]}{values.length && !(key === "sources" && values.length === 2) ? ` · ${values.length}` : ""}
        </button>;
      })}
      <select data-filter="sort" aria-label="Sort spots" value={filter.sort} onChange={(event) => changeFilter({ ...filter, sort: event.target.value })}>
        <option value="newest">Newest</option><option value="score">Score</option><option value="frequency">Frequency</option><option value="callsign">Callsign</option>
      </select>
      <button type="button" onClick={() => changeFilter(emptyFilter)}>Clear filters</button>
      <button type="button" aria-expanded={columnsOpen} aria-controls={`${panelId}-columns`} onClick={() => setColumnsOpen(value => !value)}>Columns</button>
    </div>
    {activePicker && filterOptions[activePicker] && <div className="live-cluster-picker" role="group" aria-label={filterLabels[activePicker]}>
      <div><strong>{filterLabels[activePicker]}</strong><button type="button" onClick={() => setActivePicker(null)}>Done</button></div>
      <div className="live-cluster-picker-options">
        {filterOptions[activePicker]?.map((option) => {
          const selected = filter[activePicker] as string[];
          return <label key={option}><input type="checkbox" checked={selected.includes(option)} onChange={(event) => {
            const next = event.target.checked ? [...selected, option] : selected.filter((value) => value !== option);
            changeFilter({ ...filter, [activePicker]: next });
          }} />{option === "rbl" ? "RBN / Skimmer" : option === "cluster" ? "DX Cluster" : option}</label>;
        })}
      </div>
      <button type="button" onClick={() => changeFilter({ ...filter, [activePicker]: activePicker === "sources" ? ["cluster", "rbl"] : [] })}>All</button>
    </div>}</div>

    {columnsOpen && <section id={`${panelId}-columns`} className="live-cluster-columns" aria-label="Full cluster columns">
      <div className="live-cluster-column-fields">{compactClusterColumns.map(([id, label]) => <div key={id}>
        <label><input type="checkbox" aria-label={`Show ${label} column`} checked={visibleColumns.has(id)} disabled={visibleColumns.size === 1 && visibleColumns.has(id)}
          onChange={event => { const checked = event.target.checked; setColumnPreferences(current => ({ ...current, columns: compactClusterColumns.map(([key]) => key).filter(key => key === id ? checked : current.columns.includes(key)) })); }} />{label}</label>
        <ColumnWidthInput label={label} width={columnPreferences.widths[id]} disabled={!visibleColumns.has(id)} onCommit={width => resizeColumn(id, width)} />
      </div>)}</div>
      <div className="live-cluster-column-actions"><span>Drag column edges or use arrow keys. Widths scale to fit the window.</span><button type="button" onClick={() => setColumnPreferences(defaultColumns())}>Reset columns</button><button type="button" onClick={() => setColumnsOpen(false)}>Done</button></div>
    </section>}
    <div className="table-scroll live-cluster-table"><table aria-label="Live cluster spots"><colgroup>{columnPreferences.columns.map(id => <col key={id} style={{ width: `${columnPreferences.widths[id] / totalColumnWidth * 100}%` }} />)}</colgroup><thead><tr>
      {compactClusterColumns.filter(([id]) => visibleColumns.has(id)).map(([id, label]) => <th key={id}><span title={label}>{label}</span>
        <span className="live-cluster-column-resizer" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={`Resize ${label} column`} aria-valuemin={48} aria-valuemax={480} aria-valuenow={columnPreferences.widths[id]}
          onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); columnDrag.current = { id, x: event.clientX, width: columnPreferences.widths[id], scale: columnPreferences.widths[id] / Math.max(1, event.currentTarget.parentElement!.getBoundingClientRect().width) }; }}
          onPointerMove={event => { const drag = columnDrag.current; if (drag?.id === id) resizeColumn(id, drag.width + (event.clientX - drag.x) * drag.scale); }}
          onPointerUp={() => { columnDrag.current = null; }} onPointerCancel={() => { columnDrag.current = null; }} onLostPointerCapture={() => { columnDrag.current = null; }}
          onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); resizeColumn(id, event.key === "Home" ? 48 : event.key === "End" ? 480 : columnPreferences.widths[id] + (event.key === "ArrowRight" ? 10 : -10)); }} />
      </th>)}
    </tr></thead><tbody>{(live?.spots ?? []).map((spot, index) => <tr key={spot.id}
      className={`${(selectedSpotId ?? selectedSpot?.id) === spot.id ? "is-selected" : ""} ${index % 2 ? "is-odd" : "is-even"}`}
      style={{ backgroundColor: (selectedSpotId ?? selectedSpot?.id) === spot.id ? undefined : clusterRowTint(spot.dxccStatus) }}
      onClick={() => { setSelectedSpot(spot); onSelect(spot); }} title="Load this spot into the logger and tune through xCat">
      <td hidden={!visibleColumns.has("time")} className="mono live-cluster-age">{formatSpotAge(spot.receivedAt, ageClock)}</td>
      <td hidden={!visibleColumns.has("score")}><span className={`live-cluster-score ${spot.score >= 80 ? "priority" : spot.score >= 55 ? "high" : spot.score >= 30 ? "medium" : "low"}`}>{spot.score}</span></td>
      <td hidden={!visibleColumns.has("band")}><span className="live-cluster-category" style={{ color: paletteColor(spot.band, configuration?.palette.band, clusterBandColors) }}>{spot.band}</span></td>
      <td hidden={!visibleColumns.has("frequency")} className="cyan mono">{(spot.frequencyKHz / 1000).toFixed(6)}</td>
      <td hidden={!visibleColumns.has("callsign")}><button type="button" className="call-button live-cluster-call" onClick={(event) => { event.stopPropagation(); void openHistory(spot); }} title="Show previous QSOs">{spot.callsign}</button></td>
      <td hidden={!visibleColumns.has("mode")}><span className="live-cluster-category" style={{ color: paletteColor(spot.mode, configuration?.palette.mode, clusterModeColors) }}>{spot.mode}</span></td>
      <td hidden={!visibleColumns.has("country")} title={spot.country}>{spot.country}</td><td hidden={!visibleColumns.has("cq")}>{spot.cqZone ?? "—"}</td>
      <td hidden={!visibleColumns.has("spotter")} title={`${spot.source === "rbl" ? "RBN" : "DX Cluster"} · ${spot.clusterName}`}>{spot.aggregateCount > 1 ? `${spot.spotter} +${spot.aggregateCount - 1}` : spot.spotter}</td>
      <td hidden={!visibleColumns.has("callStatus")} title={spot.callStatus} className="live-cluster-status" style={{ color: paletteColor(spot.callStatus, configuration?.palette.status, clusterStatusColors) }}>{spot.callStatus}</td>
      <td hidden={!visibleColumns.has("dxccStatus")} title={spot.dxccStatus} className="live-cluster-status" style={{ color: paletteColor(spot.dxccStatus, configuration?.palette.status, clusterStatusColors) }}>{spot.dxccStatus}</td>
      <td hidden={!visibleColumns.has("special")} className="live-cluster-special">{spot.specialTags.length ? spot.specialTags.slice(0, 2).map(tag => <span className="live-cluster-special-tag" style={specialTagColors(tag)} key={tag}>{tag}</span>) : "—"}</td>
      <td hidden={!visibleColumns.has("workedBefore")} title={formatDate(spot.workedBefore)} className="live-cluster-worked-before">{spot.workedBefore == null ? "—" : `✓ ${formatDate(spot.workedBefore)}`}</td>
      <td hidden={!visibleColumns.has("comment")} title={spot.comment}>{spot.comment || "—"}</td>
    </tr>)}</tbody></table>
      {!live?.spots.length && <p className="empty">{connected ? "No live spots match the current filters." : configuration?.servers.some(server => server.enabled) ? "Your cluster is configured. Use Connect to resume live spots; the radio can remain offline." : "Configure a cluster, then connect to receive live spots."}</p>}
    </div>
    {selectedSpot && <div className="live-cluster-inspector" aria-label="Selected spot details">
      <div><strong>{selectedSpot.callsign}</strong><span>{selectedSpot.country}</span></div>
      <div><small>Frequency</small><span>{(selectedSpot.frequencyKHz / 1000).toFixed(6)} MHz</span></div>
      <div><small>Path</small><span>{selectedSpot.spotter} · {selectedSpot.clusterName}</span></div>
      <div><small>Priority</small><span>{selectedSpot.score} · {selectedSpot.scoreReasons.join(", ") || "No score reasons"}</span></div>
      <div><small>Comment</small><span>{selectedSpot.comment || "No cluster comment"}</span></div>
    </div>}

    {history && <aside className="live-cluster-history" aria-label={`Previous QSOs for ${history.call}`}>
      <div><h3>Previous QSOs · {history.call}</h3><button type="button" onClick={() => { historyVersion.current += 1; setHistory(null); setHistorySpot(null); }}>Close</button></div>
      <p>{history.previous_count ? `${history.previous_count} contact${history.previous_count === 1 ? "" : "s"} worked before` : "Not worked before"}</p>
      <p>DXCC {history.country} · ADIF {history.adif ?? "—"} · CQ {history.cq_zone ?? "—"} · Grid {history.grid || "Unknown"}</p>
      {history.previous.length ? <div className="table-scroll"><table><thead><tr><th>Date</th><th>Call</th><th>Band</th><th>Mode</th><th>RST sent</th><th>RST received</th><th>LoTW sent</th><th>LoTW received</th></tr></thead><tbody>
        {history.previous.map((qso) => <tr key={qso.id}><td>{new Date(qso.date).toLocaleString()}</td><td>{qso.call}</td><td>{qso.band}</td><td>{qso.mode}</td><td>{qso.rstSent || "—"}</td><td>{qso.rstReceived || "—"}</td><td>{qso.lotwSent || "—"}</td><td>{qso.lotwReceived || "—"}</td></tr>)}
      </tbody></table></div> : <p className="empty">No previous contact with this callsign in the integrated logbook.</p>}
      {history.previous_count > 20 && <p>Most recent 20 QSOs shown.</p>}
      {history.adif && <div className="live-cluster-matrix"><h4>DXCC band / mode history · ADIF {history.adif}</h4>
        <p>{history.dxcc_contact_count} integrated logbook contacts with this entity</p>
        <div className="table-scroll"><table><thead><tr><th>Mode</th>{bands.map((band) => <th key={band}>{band}</th>)}</tr></thead><tbody>
          {modes.map((mode) => <tr key={mode}><th>{mode}</th>{bands.map((band) => {
            const cell = history.matrix.find((item) => item.band === band && item.mode === mode);
            return <td key={band} className={cell?.confirmed ? "live-cluster-confirmed" : cell ? "live-cluster-worked" : ""}>{cell ? cell.confirmed ? "Confirmed" : "Worked" : "—"}</td>;
          })}</tr>)}
        </tbody></table></div>
      </div>}
    </aside>}

  </section>;

  // Local render helper keeps console/configuration inputs mounted while placing
  // their controlled panels next to the toolbar, ahead of the tall spot table.
  function renderToolbarPanels() {
    return <div className="live-cluster-toolbar-panels">
    <section className="live-cluster-console" id={`${panelId}-console`} hidden={!consoleOpen} aria-labelledby={`${panelId}-console-title`}><h3 id={`${panelId}-console-title`}>Cluster console · {live?.console.length ?? 0} lines</h3>
      <div className="live-cluster-console-controls">
        <select aria-label="Command target" value={commandTarget} onChange={(event) => setCommandTarget(event.target.value)}><option value="">All connected clusters</option>{configuration?.servers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}</select>
        <select aria-label="Command preset" onChange={(event) => { if (event.target.value) setCommand(event.target.value); }} defaultValue=""><option value="">Command preset</option>{configuration?.commandPresets.map((preset) => <option key={preset.id} value={preset.command}>{preset.name}</option>)}</select>
        <input aria-label="Cluster command" value={command} maxLength={160} onChange={(event) => setCommand(event.target.value)} placeholder="Cluster command" />
        <button type="button" disabled={busy || !connected || !command.trim()} onClick={() => { void request("cluster_command", { command, ...(commandTarget ? { server_id: commandTarget } : {}) }, "Command sent"); setCommand(""); }}>Send</button>
        <button type="button" disabled={busy || !live?.console.length} onClick={() => void request("cluster_console_clear")}>Clear</button>
        <button type="button" disabled={!live?.console.length} onClick={() => { void navigator.clipboard.writeText((live?.console ?? []).map((line) => `${formatDate(line.receivedAt)} · ${line.source} · ${line.text}`).join("\n")).then(() => setMessage("Transcript copied")).catch(() => setError("Could not copy the transcript.")); }}>Copy</button>
      </div>
      <div className="live-cluster-transcript" role="log" aria-live="polite">{live?.console.length ? live.console.map((line, index) => <p key={`${line.receivedAt}-${index}`}><time>{formatDate(line.receivedAt)}</time><b>{line.source}</b><span>{line.text}</span></p>) : <p>No cluster replies yet.</p>}</div>
    </section>

    <section className="live-cluster-settings" id={`${panelId}-settings`} hidden={!settingsOpen} aria-labelledby={`${panelId}-settings-title`}><h3 id={`${panelId}-settings-title`}>Cluster settings</h3>
      {configuration && <div className="live-cluster-settings-body">
        <div className="live-cluster-setting-row"><label>Maximum visible spots <select value={configuration.maximumSpots} onChange={(event) => setConfiguration({ ...configuration, maximumSpots: Number(event.target.value) })}>{[50, 100, 200, 500].map((count) => <option key={count}>{count}</option>)}</select></label>
          <label><input type="checkbox" checked={configuration.reconnect} onChange={(event) => setConfiguration({ ...configuration, reconnect: event.target.checked })} /> Reconnect automatically, including after app restart</label>
          <label><input type="checkbox" checked={configuration.requestSkimmer} onChange={(event) => setConfiguration({ ...configuration, requestSkimmer: event.target.checked })} /> Request RBN / Skimmer</label>
          <label><input type="checkbox" checked={configuration.showWorkedBandModeSpots} onChange={(event) => setConfiguration({ ...configuration, showWorkedBandModeSpots: event.target.checked })} /> Show already-worked combinations</label>
          <label><input type="checkbox" checked={configuration.hideWSPRSpots} onChange={(event) => setConfiguration({ ...configuration, hideWSPRSpots: event.target.checked })} /> Hide WSPR spots</label></div>
        <p>Radio spot destinations and colours are configured in Settings → Radio spots.</p>
        <h3>Servers</h3><p>Configured servers connect together. Saving settings disconnects active sessions.</p>
        {configuration.servers.map((server) => <div className="live-cluster-server" key={server.id}>
          <label><input type="checkbox" checked={server.enabled} onChange={(event) => updateServer(server.id, { enabled: event.target.checked })} /> Enabled</label>
          <label>Name<input aria-label={`${server.name} name`} value={server.name} maxLength={80} onChange={(event) => updateServer(server.id, { name: event.target.value })} /></label>
          <label>Host<input aria-label={`${server.name} host`} value={server.host} maxLength={253} onChange={(event) => updateServer(server.id, { host: event.target.value })} /></label>
          <label>Port<input aria-label={`${server.name} port`} type="number" min="1" max="65535" value={server.port} onChange={(event) => updateServer(server.id, { port: Number(event.target.value) })} /></label>
          <label>Login callsign<input aria-label={`${server.name} callsign`} value={server.callsign} maxLength={24} onChange={(event) => updateServer(server.id, { callsign: event.target.value.toUpperCase() })} /></label>
          <button type="button" onClick={() => setConfiguration({ ...configuration, servers: configuration.servers.filter((item) => item.id !== server.id) })}>Remove</button>
          <label className="live-cluster-password">Password · {passwordServers.includes(server.id) ? "saved securely" : "none"}<input type="password" autoComplete="new-password" disabled={!canEditPasswords} value={passwordDrafts[server.id] ?? ""} maxLength={256} onChange={(event) => setPasswordDrafts({ ...passwordDrafts, [server.id]: event.target.value })} /></label>
          <button type="button" disabled={!canEditPasswords || busy || !passwordDrafts[server.id] || !savedServerIDs.includes(server.id)} title={!canEditPasswords ? passwordUnavailableReason : !savedServerIDs.includes(server.id) ? "Save cluster settings first" : undefined} onClick={() => { void request("cluster_password_set", { server_id: server.id, password: passwordDrafts[server.id] }, "Password saved securely"); setPasswordDrafts((drafts) => ({ ...drafts, [server.id]: "" })); }}>Save password</button>
          <button type="button" disabled={!canEditPasswords || busy || !passwordServers.includes(server.id)} title={!canEditPasswords ? passwordUnavailableReason : undefined} onClick={() => void request("cluster_password_set", { server_id: server.id, password: "" }, "Password removed")}>Remove password</button>
        </div>)}
        {!passwordStorageAvailable ? <p>Secure password storage is not yet available on this platform. Callsign-only clusters can still connect.</p> : !passwordControlsEnabled && <p>Manage passwords in the main workspace.</p>}
        <button type="button" disabled={configuration.servers.length >= 16} onClick={() => setConfiguration({ ...configuration, servers: [...configuration.servers, { id: crypto.randomUUID(), name: "", host: "", port: 7300, callsign: "", enabled: true }] })}>Add server</button>
        <details><summary>Command presets</summary><div className="live-cluster-rules"><p>Saved commands are stored with cluster settings. Do not put passwords or tokens in presets.</p>{configuration.commandPresets.map((preset) => <div key={preset.id}>
          <label>Name<input value={preset.name} maxLength={80} onChange={(event) => setConfiguration({ ...configuration, commandPresets: configuration.commandPresets.map((item) => item.id === preset.id ? { ...item, name: event.target.value } : item) })} /></label>
          <label>Command<input value={preset.command} maxLength={160} onChange={(event) => setConfiguration({ ...configuration, commandPresets: configuration.commandPresets.map((item) => item.id === preset.id ? { ...item, command: event.target.value } : item) })} /></label>
          <button type="button" onClick={() => setConfiguration({ ...configuration, commandPresets: configuration.commandPresets.filter((item) => item.id !== preset.id) })}>Remove</button>
        </div>)}<button type="button" disabled={configuration.commandPresets.length >= 32} onClick={() => setConfiguration({ ...configuration, commandPresets: [...configuration.commandPresets, { id: crypto.randomUUID(), name: "", command: "" }] })}>Add command preset</button></div></details>
        <details><summary>Special station rules</summary><div className="live-cluster-rules">{configuration.specialRules.map((rule) => <div key={rule.id}>
          <label><input type="checkbox" checked={rule.enabled} onChange={(event) => setConfiguration({ ...configuration, specialRules: configuration.specialRules.map((item) => item.id === rule.id ? { ...item, enabled: event.target.checked } : item) })} /> Enabled</label>
          <label>Name<input value={rule.name} onChange={(event) => setConfiguration({ ...configuration, specialRules: configuration.specialRules.map((item) => item.id === rule.id ? { ...item, name: event.target.value } : item) })} /></label>
          <label>Keywords<input value={rule.keywords.join(", ")} onChange={(event) => setConfiguration({ ...configuration, specialRules: configuration.specialRules.map((item) => item.id === rule.id ? { ...item, keywords: event.target.value.split(",").map((s) => s.trim()).filter(Boolean) } : item) })} /></label>
          <label>Reference format<select value={rule.referenceFormat} onChange={(event) => setConfiguration({ ...configuration, specialRules: configuration.specialRules.map((item) => item.id === rule.id ? { ...item, referenceFormat: event.target.value } : item) })}>{["none", "pota", "sota", "iota", "wwff", "bunker", "castle"].map((format) => <option key={format}>{format}</option>)}</select></label>
          <label>Expert pattern<input value={rule.advancedPattern} onChange={(event) => setConfiguration({ ...configuration, specialRules: configuration.specialRules.map((item) => item.id === rule.id ? { ...item, advancedPattern: event.target.value } : item) })} /></label>
          <button type="button" onClick={() => setConfiguration({ ...configuration, specialRules: configuration.specialRules.filter((item) => item.id !== rule.id) })}>Remove rule</button>
        </div>)}<button type="button" disabled={configuration.specialRules.length >= 64} onClick={() => setConfiguration({ ...configuration, specialRules: [...configuration.specialRules, { id: crypto.randomUUID(), name: "", keywords: [], referenceFormat: "none", advancedPattern: "", enabled: true }] })}>Add special rule</button></div></details>
        <details><summary>Status, band and mode colours</summary>{(["status", "band", "mode"] as const).map((family) => <div className="live-cluster-colours" key={family}><h4>{family}</h4>{Object.entries(configuration.palette[family]).map(([name, colour]) => <label key={name}>{name}<input type="color" value={colour} onChange={(event) => setConfiguration({ ...configuration, palette: { ...configuration.palette, [family]: { ...configuration.palette[family], [name]: event.target.value } } })} /></label>)}</div>)}</details>
        <button type="button" disabled={busy} onClick={() => void saveConfig()}>Save cluster settings</button>
      </div>}
    </section>
    </div>;
  }
}

export default ClusterPanel;

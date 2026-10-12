import { useCallback, useEffect, useRef, useState } from "react";
import { Radio, BookOpen, Network, Map as MapIcon, Settings, Activity, Award, LayoutDashboard, ExternalLink, RefreshCw } from "lucide-react";
import { workerRequest, openMonitor } from "./worker";
import WorldMap from "./Map";
import type { Spot } from "./model";
import { ClusterPanel } from "./live/ClusterPanel";
import { LogbookPanel } from "./live/LogbookPanel";
import StationPanel from "./live/StationPanel";
import { DataManagementPanel } from "./live/DataManagementPanel";
import Conditions from "./live/Conditions";
import Monitor from "./live/Monitor";
import "./live/live.css";

type Data = Record<string, any>;
type Request = (method: string, params?: Data) => Promise<any>;
const navigation = [
  ["Operator Desk", LayoutDashboard], ["Logbook", BookOpen], ["DX Cluster", Network],
  ["World Map", MapIcon], ["Band Maps", Activity], ["Awards", Award],
  ["Station Control", Radio], ["Sync", RefreshCw], ["Settings", Settings],
] as const;
const monitor = new URLSearchParams(location.search).get("view") === "monitor";
const frequency = (hz?: number) => typeof hz === "number" && Number.isFinite(hz) ? (hz / 1e6).toFixed(6) : "—";
const newDraft = () => localStorage.removeItem("xlog.integration.draft");

export default function LiveApp() {
  const [view, setView] = useState<string>("Operator Desk");
  const [workspace, setWorkspace] = useState<Data | null>(null);
  const [settings, setSettings] = useState<Data | null>(null);
  const [draft, setDraft] = useState<Data | null>(null);
  const [station, setStation] = useState<Data | null>(null);
  const [cluster, setCluster] = useState<Data | null>(null);
  const [stats, setStats] = useState<Data | null>(null);
  const [lookup, setLookup] = useState<Data | null>(null);
  const [previous, setPrevious] = useState<Data[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [autoRotor, setAutoRotor] = useState(false);
  const provider = useRef(localStorage.getItem("xlog.integration.provider") || "xcat_loopback");
  const pendingTune = useRef(false);
  const selection = useRef(0);
  const editing = useRef(false);
  const polling = useRef(false);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === "xlog.integration.provider" && event.newValue) { provider.current = event.newValue; setStation(null); }
    };
    window.addEventListener("storage", changed); return () => window.removeEventListener("storage", changed);
  }, []);
  const request: Request = useCallback(async (method, params = {}) => {
    try {
      const isStation = method.startsWith("station_");
      if (isStation && params.provider) { provider.current = params.provider; localStorage.setItem("xlog.integration.provider", params.provider); }
      const requestedProvider = provider.current;
      const requestedSelection = selection.current;
      const result = (await workerRequest(method, isStation ? { provider: provider.current, ...params } : params)).result as Data;
      if (method.startsWith("cluster_") && result?.snapshot) setCluster(result);
      if (requestedProvider === provider.current && requestedSelection === selection.current) {
        if (method === "station_snapshot" || method === "station_connect" || method === "station_disconnect" || method === "station_reconnect") setStation(result);
        if (result?.state) setStation(result.state);
      }
      return result;
    } catch (e) { throw new Error(e instanceof Error ? e.message : "Operation failed"); }
  }, []);
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : "Operation failed"); }
    finally { setBusy(false); }
  };
  const reload = useCallback(async () => {
    const state = await request("workspace_status");
    setWorkspace(state);
    if (state.workspace_exists) {
      const [s, totals, blank] = await Promise.all([request("settings_load"), request("logbook_stats"), request("logbook_draft")]);
      setSettings(s.settings); setStats(totals);
      setDraft(current => {
        if (current) return current;
        try { const saved = JSON.parse(localStorage.getItem("xlog.integration.draft") || "null"); return saved?.id && saved?.start ? saved : blank.qso; }
        catch { return blank.qso; }
      });
    }
  }, [request]);
  useEffect(() => { if (!monitor) void reload().catch(e => setError(e.message)); }, [reload, refresh]);
  useEffect(() => { if (!monitor && draft) localStorage.setItem("xlog.integration.draft", JSON.stringify(draft)); }, [draft]);
  useEffect(() => {
    let disposed = false;
    const poll = async () => {
      if (polling.current) return;
      polling.current = true;
      const polledProvider = provider.current;
      const polledSelection = selection.current;
      try {
        const [radio, spots] = await Promise.allSettled([request("station_snapshot"), request("cluster_snapshot")]);
        if (disposed || polledProvider !== provider.current || polledSelection !== selection.current) return;
        if (radio.status === "fulfilled") {
          const state = radio.value; setStation(state);
          if (follow && !pendingTune.current && !editing.current && state.radio?.observed && state.radio?.connected) {
            setDraft(d => d ? { ...d, frequencyHz: state.radio.frequency_hz,
              band: state.station?.band || d.band, mode: state.radio.mode === "USB" || state.radio.mode === "LSB" ? "SSB" : state.radio.mode } : d);
          }
        } else setStation(s => s ? { ...s, available: false, radio: { ...s.radio, connected: false }, connection_error: "Station connection unavailable" } : null);
        if (spots.status === "fulfilled") setCluster(spots.value);
      } finally { polling.current = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 1000);
    return () => { disposed = true; clearInterval(timer); };
  }, [request, follow]);
  useEffect(() => {
    const call = String(draft?.call || "").trim(); let disposed = false;
    if (!call || !workspace?.workspace_exists) { setLookup(null); setPrevious([]); return; }
    const timer = setTimeout(() => {
      void Promise.all([request("lookup_call", { call }), request("logbook_previous", { call, limit: 10 })])
        .then(([info, history]) => { if (!disposed) { setLookup(info); setPrevious(history.qsos); } })
        .catch(e => { if (!disposed) setLookup({ call, source: e.message }); });
    }, 400);
    return () => { disposed = true; clearTimeout(timer); };
  }, [draft?.call, request, workspace?.workspace_exists]);
  const clear = async () => { editing.current = false; newDraft(); setDraft((await request("logbook_draft")).qso); setSelected(null); };
  const save = () => run(async () => {
    if (!draft) return;
    const result = await request("logbook_save", { qso: draft });
    setMessage(`${result.qso.call} saved to the integrated logbook. Original logbook unchanged.`);
    await clear(); setRefresh(n => n + 1);
  });
  const selectSpot = (spot: Data) => {
    if (monitor) return;
    const generation = ++selection.current; const hz = Math.round(spot.frequencyKHz * 1000);
    pendingTune.current = true; editing.current = false; setSelected(spot.id);
    setDraft(d => d ? { ...d, call: spot.callsign, frequencyHz: hz, band: spot.band, mode: spot.mode,
      country: spot.country || "", dxcc: spot.adif ?? null } : d);
    setMessage(`Tuning ${spot.callsign} · waiting for observed radio state`); setError("");
    void request("station_tune", { frequency_hz: hz, mode: spot.mode }).then(async result => {
      if (selection.current !== generation) return;
      setMessage(result.confirmed ? `${spot.callsign} · radio frequency and mode confirmed` : `${spot.callsign} · request accepted; awaiting observation`);
      if (autoRotor && result.confirmed) {
        const target = await request("lookup_call", { call: spot.callsign });
        if (selection.current === generation && typeof target.bearing === "number")
          await request(provider.current === "direct_agent" ? "station_rotor_goto" : "station_action", provider.current === "direct_agent" ? { bearing: target.bearing } : { action: "rotor_goto", bearing: target.bearing, band: spot.band });
      }
    }).catch(e => { if (selection.current === generation) setError(e.message); })
      .finally(() => { if (selection.current === generation) pendingTune.current = false; });
  };
  const liveSpots: Data[] = cluster?.snapshot?.spots || [];
  const mapSpots: Spot[] = liveSpots.filter(s => typeof s.latitude === "number" && typeof s.longitude === "number").map(s => ({
    id: s.id, call: s.callsign, mhz: s.frequencyKHz / 1000, mode: s.mode, band: s.band,
    country: s.country, grid: "", lon: s.longitude, lat: s.latitude, reporter: s.spotter, note: s.comment,
    state: s.callStatus === "Confirmed" ? "confirmed" : s.callStatus === "Worked" ? "worked" : "needed",
  }));
  const map = <WorldMap data={mapSpots} selected={selected} onSpot={spot => { const real = liveSpots.find(s => s.id === spot.id); if (real) selectSpot(real); }} />;
  if (monitor) return <Monitor snapshot={station} map={map} />;
  return <div className="app live">
    <header className="station-rail"><strong className="brand teal">OM0RX-xLog</strong><span className="cyan">{frequency(station?.radio?.frequency_hz)} MHz · {station?.radio?.mode || "Radio offline"}</span>
      <span className={station?.radio?.connected ? "teal" : "amber"}>{station?.radio?.connected ? "Connected" : "Disconnected"}</span>
      <span>{cluster?.snapshot?.connectedClusters || 0} clusters · {liveSpots.length} spots</span>
      <span className="rail-end">{stats?.stats?.qso_count?.toLocaleString() ?? "—"} contacts · Integrated logbook</span>
      <button onClick={() => void openMonitor().catch(e => setError(e.message))}><ExternalLink size={14} />Monitor</button>
    </header>
    <aside className="sidebar"><nav>{navigation.map(([name, Icon]) => <button key={name} className={view === name ? "active" : ""} onClick={() => setView(name)}><Icon size={17} />{name}</button>)}</nav>
      <div className="live-station-brief"><strong className="cyan">{frequency(station?.radio?.frequency_hz)}</strong><span>{station?.station?.kpa_operate === true ? "KPA OPERATE" : station?.station?.kpa_operate === false ? "KPA STBY" : "KPA unavailable"}</span>
        <span>Output {station?.station?.tx_power_watts ?? "—"} W · SWR {station?.station?.swr ?? "—"}</span><span>{station?.station?.route_detail || "Route unavailable"}</span>
        <span>{station?.station?.kpa_detail_primary}</span><span>{station?.station?.kpa_detail_secondary}</span><span>{station?.station?.kat_detail_primary}</span>
        {(station?.station?.allowed_actions || []).includes(station?.station?.kpa_operate ? "standby" : "operate") && <button onClick={() => void run(async () => { await request("station_action", { action: station?.station?.kpa_operate ? "standby" : "operate" }); })}>{station?.station?.kpa_operate ? "Standby" : "Operate"}</button>}
      </div><div className="sidebar-foot">{settings?.stationCall || "Station not configured"}<br />{settings?.gridSquare || "Set station grid"}<br /><span className="secondary">Original apps preserved</span></div>
    </aside>
    <main><div className="workspace-heading"><h1>{view}</h1><span className="secondary">{workspace?.workspace_exists ? "Your isolated working logbook · manual sync" : "Choose a logbook to begin"}</span></div>
      {workspace?.workspace_exists && <Conditions propagation={station?.propagation || null} request={request} />}
      {error && <div className="live-error" role="alert">{error}<button onClick={() => setError("")}>Dismiss</button></div>}
      {message && <p className="live-message" role="status">{message}</p>}
      {!workspace?.workspace_exists ? <section className="live-onboarding"><h2>Bring your logbook into the integrated app</h2><p>Create a verified copy of your existing xLog database, or begin with an empty logbook. Your original database, settings and installed apps are not modified. Existing remote sync credentials are not copied.</p>
        <div className="live-actions"><button className="primary" disabled={busy || !workspace?.native_log_exists} onClick={() => void run(async () => { await request("workspace_create", { mode: "copy_native" }); await reload(); })}>Copy my existing xLog logbook</button>
        <button disabled={busy || !workspace} onClick={() => void run(async () => { await request("workspace_create", { mode: "empty" }); await reload(); })}>Create empty logbook</button>
        <button onClick={() => void run(reload)}>Retry connection</button></div><p className="secondary">No sample contacts, spots or station readings are loaded.</p></section> : <>
      {view === "Operator Desk" && <><div className="live-desk-top"><QSOEditor draft={draft} setDraft={setDraft} save={save} clear={() => void run(clear)} busy={busy} lookup={lookup} previous={previous} follow={follow} setFollow={setFollow} />
        <section className="live-context"><h2>Station</h2><p className="radio-frequency">{frequency(station?.radio?.frequency_hz)}</p><p>{station?.radio?.mode || "No radio observation"} · {station?.station?.interlock_state || "Interlock unknown"}</p>
        <p>{station?.station?.route_detail}</p><p className="amber">{station?.station?.alarm_summary}</p><label><input type="checkbox" checked={autoRotor} onChange={e => setAutoRotor(e.target.checked)} />Turn rotor after confirmed spot tune</label><p className="secondary">Uses your station grid and a resolved destination; no bearing is invented.</p>
        <button onClick={() => setView("Station Control")}>Open station controls</button></section></div><div className="live-desk-bottom"><div className="live-map">{map}</div><SpotList spots={liveSpots.slice(0, 50)} onSelect={selectSpot} /></div></>}
      {view === "Logbook" && <LogbookPanel onRequest={request} refreshKey={refresh} onEdit={qso => { editing.current = true; setDraft(qso); setFollow(false); setView("Operator Desk"); }} />}
      {view === "DX Cluster" && <ClusterPanel snapshot={cluster} onRequest={request} onSelect={selectSpot} />}
      {view === "World Map" && <div className="live-map full">{map}</div>}
      {view === "Band Maps" && <LiveBands spots={liveSpots} onSelect={selectSpot} />}
      {view === "Station Control" && <StationPanel snapshot={station} onRequest={request} onSnapshot={setStation} />}
      {view === "Awards" && <AwardsPanel request={request} refresh={refresh} />}
      {view === "Settings" && settings && <><SettingsPanel values={settings} request={request} onSaved={setSettings} /><DataManagementPanel onRequest={request} onChanged={() => setRefresh(n => n + 1)} /></>}
      {view === "Sync" && <SyncPanel request={request} onChanged={() => setRefresh(n => n + 1)} />}
      </>}
    </main></div>;
}

const fieldGroups: Record<string, [string, string][]> = {
  QSO: [["call", "Callsign"], ["frequencyHz", "Frequency MHz"], ["band", "Band"], ["mode", "Mode"], ["submode", "Submode"], ["start", "Start UTC"], ["end", "End UTC"], ["rstSent", "RST sent"], ["rstReceived", "RST received"]],
  Station: [["stationLocation", "Station location"], ["radio", "Radio"], ["txPower", "Power W"], ["operatorCall", "Operator"], ["myCall", "Station call"], ["myGrid", "Station grid"], ["receiveFrequencyHz", "RX frequency MHz"], ["receiveBand", "RX band"], ["propagationMode", "Propagation"], ["antennaPath", "Antenna path"]],
  General: [["name", "Name"], ["gridSquare", "Grid"], ["country", "Country"], ["dxcc", "DXCC"], ["continent", "Continent"], ["cqZone", "CQ zone"], ["ituZone", "ITU zone"], ["state", "State"], ["county", "County"], ["qth", "QTH"], ["email", "Email"]],
  References: [["iota", "IOTA"], ["sotaReference", "SOTA"], ["potaReference", "POTA"], ["wwffReference", "WWFF"], ["sig", "SIG"], ["sigInfo", "SIG info"], ["dok", "DOK"]],
  Notes: [["comment", "Comment"], ["notes", "Notes"]],
  QSL: [["qslSent", "QSL sent"], ["qslReceived", "QSL received"], ["qslMethod", "QSL method"], ["qslVia", "QSL via"], ["qslMessage", "QSL message"], ["lotwSent", "LoTW sent"], ["lotwReceived", "LoTW received"]],
};
function QSOEditor({ draft, setDraft, save, clear, busy, lookup, previous, follow, setFollow }: any) {
  const [tab, setTab] = useState("QSO");
  const callRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { const handler = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") callRef.current?.focus(); }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, [save]);
  if (!draft) return <p>Opening logbook…</p>;
  const update = (key: string, value: string) => setDraft((d: Data) => ({ ...d, [key]: key.endsWith("Hz") ? value ? Math.round(Number(value) * 1e6) : null : key === "dxcc" ? value ? Number(value) : null : key === "end" ? value || null : value }));
  return <section className="live-editor"><h2>Log QSO</h2><nav className="live-tabs" aria-label="QSO fields">{Object.keys(fieldGroups).map(name => <button key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>{name}</button>)}</nav>
    <form onSubmit={e => { e.preventDefault(); if (!busy) save(); }}><div className="live-fields">{fieldGroups[tab].map(([key, label]) => <label key={key}>{label}<input ref={key === "call" ? callRef : undefined} value={key.endsWith("Hz") ? draft[key] ? draft[key] / 1e6 : "" : draft[key] ?? ""} onChange={e => update(key, key === "call" ? e.target.value.toUpperCase() : e.target.value)} required={key === "call" || key === "band" || key === "mode"} autoComplete="off" spellCheck={false} /></label>)}</div>
    <div className="live-actions"><label><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} />Follow radio</label><button type="button" onClick={clear}>Clear</button><button className="primary" disabled={busy || !draft.call}>Save QSO · ⌘↵</button></div></form>
    <div className="live-intelligence"><strong>{lookup?.country || draft.country || "Callsign intelligence"}</strong><span>{lookup?.source || "Enter a callsign"}{typeof lookup?.bearing === "number" ? ` · ${Math.round(lookup.bearing)}° · ${Math.round(lookup.distance_km)} km` : ""}</span>
    {lookup && <button onClick={() => setDraft((d: Data) => { const next = { ...d }; for (const key of ["name", "gridSquare", "country", "dxcc", "continent", "cqZone", "ituZone", "state", "county", "qth", "email"]) if (!next[key] && lookup[key]) next[key] = lookup[key]; return next; })}>Fill empty fields from lookup</button>}
    <span>{previous.length ? `${previous.length} previous contacts · ${previous[0].band} ${previous[0].mode} · ${previous[0].start}` : "No previous contacts for this call"}</span></div>
  </section>;
}
function SpotList({ spots, onSelect }: { spots: Data[]; onSelect: (spot: Data) => void }) {
  return <div className="live-spot-list"><table><thead><tr><th>Callsign</th><th>MHz</th><th>Band / Mode</th><th>Call</th><th>DXCC</th></tr></thead><tbody>{spots.map(s => <tr key={s.id} onDoubleClick={() => onSelect(s)}><td><button className="call-button" onClick={() => onSelect(s)}>{s.callsign}</button></td><td>{(s.frequencyKHz / 1000).toFixed(4)}</td><td>{s.band} {s.mode}</td><td style={{ color: s.statusHex }}>{s.callStatus}</td><td>{s.dxccStatus}</td></tr>)}</tbody></table>{spots.length === 0 && <p className="empty">No live spots. Configure and connect a server in DX Cluster.</p>}</div>;
}
const ranges: Record<string, [number, number]> = { "160m": [1800, 2000], "80m": [3500, 4000], "60m": [5250, 5450], "40m": [7000, 7300], "30m": [10100, 10150], "20m": [14000, 14350], "17m": [18068, 18168], "15m": [21000, 21450], "12m": [24890, 24990], "10m": [28000, 29700], "6m": [50000, 54000] };
function LiveBands({ spots, onSelect }: { spots: Data[]; onSelect: (spot: Data) => void }) {
  const [band, setBand] = useState("20m"); const [zoom, setZoom] = useState(1); const [pan, setPan] = useState(0);
  const [min, max] = ranges[band]; const width = (max - min) / zoom; const bottom = min + (max - min - width) * pan;
  const visible = spots.filter(s => s.band === band && s.frequencyKHz >= bottom && s.frequencyKHz <= bottom + width).sort((a, b) => b.frequencyKHz - a.frequencyKHz);
  return <section className="live-bands"><div className="live-actions"><label>Band <select value={band} onChange={e => { setBand(e.target.value); setPan(0); }}>{Object.keys(ranges).map(b => <option key={b}>{b}</option>)}</select></label><label>Zoom <input type="range" min={1} max={10} value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label><label>Range <input type="range" min={0} max={1} step={0.01} value={pan} onChange={e => setPan(Number(e.target.value))} /></label><span>{bottom.toFixed(1)}–{(bottom + width).toFixed(1)} kHz</span></div>
    <div className="live-spectrum">{Array.from({ length: 11 }, (_, i) => <div className="live-frequency-line" key={i} style={{ top: `${i * 10}%` }}><span>{((bottom + width * (1 - i / 10)) / 1000).toFixed(3)}</span></div>)}{visible.map((s, i) => <button key={s.id} title={`${s.frequencyText} ${s.mode}`} style={{ top: `${(1 - (s.frequencyKHz - bottom) / width) * 100}%`, left: `${12 + (i % 5) * 17}%`, color: s.statusHex }} onClick={() => onSelect(s)}>{s.callsign} · {s.dxccStatus === "ATNO" ? "ATNO" : s.callStatus.replace("New Band+Mode", "NB+NM").replace("New Band", "NB").replace("New Mode", "NM").replace("New Call", "NC")}</button>)}</div></section>;
}
function AwardsPanel({ request, refresh }: { request: Request; refresh: number }) {
  const [catalog, setCatalog] = useState<Data | null>(null); const [offset, setOffset] = useState(0); const [error, setError] = useState("");
  const [search, setSearch] = useState(""); const [delivery, setDelivery] = useState("");
  useEffect(() => { let current = true; const timer = setTimeout(() => { void request("logbook_catalog", { offset, limit: 20, search, delivery_state: delivery }).then(c => { if (current) setCatalog(c); }).catch(e => { if (current) setError(e.message); }); }, 250); return () => { current = false; clearTimeout(timer); }; }, [request, refresh, offset, search, delivery]);
  return <section className="live-awards">{error && <p role="alert">{error}</p>}<h2>Calculated award progress</h2><table><thead><tr><th>Award</th><th>Worked</th><th>Eligible</th><th>Target</th><th>Basis</th></tr></thead><tbody>{catalog?.items?.map((a: Data) => <tr key={a.code}><td>{a.title}</td><td>{a.worked}</td><td>{a.current}</td><td>{a.target} {a.unit}</td><td className="wrap">{a.detail}</td></tr>)}</tbody></table><h2>Worldwide programme library</h2><p className="secondary">Delivery state distinguishes computed awards, tracking and programmes requiring sponsor evidence.</p>
    <div className="live-actions"><label>Search programmes <input value={search} maxLength={120} onChange={e => { setSearch(e.target.value); setOffset(0); }} placeholder="Award, sponsor, geography…" /></label><label>Delivery <select value={delivery} onChange={e => { setDelivery(e.target.value); setOffset(0); }}><option value="">All states</option><option value="implemented">Calculated</option><option value="trackingOnly">Tracking</option><option value="blocked">Blocked</option><option value="historical">Historical</option></select></label></div>
    {catalog?.programmes?.map((p: Data, i: number) => <details key={p.record?.id || i}><summary>{p.record?.name} · {p.delivery_state === "trackingOnly" ? "Tracking" : p.delivery_state}</summary><p>{p.delivery_detail}</p><dl>{Object.entries(p.record || {}).map(([k, v]) => <div key={k}><dt>{k.replaceAll("_", " ")}</dt><dd>{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd></div>)}</dl></details>)}<div className="live-actions"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Previous</button><span>{catalog ? `${catalog.total_programmes ? offset + 1 : 0}–${Math.min(offset + 20, catalog.total_programmes)} / ${catalog.total_programmes}` : "Loading catalogue…"}</span><button disabled={offset + 20 >= (catalog?.total_programmes || 0)} onClick={() => setOffset(offset + 20)}>Next</button></div></section>;
}
function SettingsPanel({ values, request, onSaved }: { values: Data; request: Request; onSaved: (value: Data) => void }) {
  const [form, setForm] = useState(values); const [message, setMessage] = useState(""); const [credentials, setCredentials] = useState<Data>({});
  const fields = [["operatorCall", "Operator call"], ["stationCall", "Station call"], ["gridSquare", "Station grid"], ["stationLocation", "Station location"], ["defaultPower", "Default power W"], ["defaultRadio", "Radio name"], ["wavelogURL", "Wavelog URL"], ["wavelogStationID", "Wavelog station ID"], ["qrzUsername", "QRZ username"], ["clubLogCTYURL", "Club Log CTY URL"], ["lotwActivityURL", "LoTW activity URL"]];
  return <section className="live-settings"><form onSubmit={e => { e.preventDefault(); void request("settings_save", { settings: form }).then(r => { onSaved(r.settings); setMessage("Settings saved. Automatic sync remains off for this independent logbook."); }).catch(e => setMessage(e.message)); }}><div className="live-fields">{fields.map(([key, name]) => <label key={key}>{name}<input value={form[key] ?? ""} onChange={e => setForm({ ...form, [key]: key === "wavelogStationID" ? Number(e.target.value) : e.target.value })} /></label>)}</div><label><input type="checkbox" checked={form.qrzEnabled} onChange={e => setForm({ ...form, qrzEnabled: e.target.checked })} />Use QRZ XML lookup</label><div className="live-actions"><button className="primary">Save settings</button></div></form>
    <h2>Private credentials</h2><p>Stored only in the integrated app’s macOS Keychain service. Existing application credentials are not changed.</p>{[["wavelog-token", "Wavelog API v2 token"], ["qrz-password", "QRZ password"], ["clublog-api-key", "Club Log API key"]].map(([account, label]) => <form className="live-secret" key={account} onSubmit={e => { e.preventDefault(); void request("secret_save", { account, value: credentials[account] || "" }).then(() => { setCredentials(c => ({ ...c, [account]: "" })); setMessage(`${label} saved in Keychain`); }).catch(e => setMessage(e.message)); }}><label>{label}<input type="password" autoComplete="off" value={credentials[account] || ""} onChange={e => setCredentials({ ...credentials, [account]: e.target.value })} /></label><button disabled={!credentials[account]}>Save credential</button></form>)}<p role="status">{message}</p></section>;
}
function SyncPanel({ request, onChanged }: { request: Request; onChanged: () => void }) {
  const [state, setState] = useState<Data | null>(null); const [confirmed, setConfirmed] = useState(false); const [error, setError] = useState("");
  const read = useCallback(() => request("sync_status").then(setState).catch(e => setError(e.message)), [request]);
  useEffect(() => { void read(); const timer = setInterval(() => void read(), 3000); return () => clearInterval(timer); }, [read]);
  const act = async (method: string, params: Data) => { try { await request(method, params); await read(); onChanged(); } catch (e) { setError((e as Error).message); } };
  return <section className="live-sync"><h2>Wavelog synchronization</h2><p>This is an independent copy with its own outbox. Close the original xLog and any other sync writer before using it as your active Wavelog logbook. Sync can push local changes and reconcile remote edits/deletions.</p><label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I have stopped the other sync applications; this logbook is the only writer.</label><div className="live-actions"><button disabled={!confirmed || state?.running} onClick={() => void act("sync_run", { confirm_single_writer: true })}>Synchronize now</button><span>{state?.status}</span></div>{error && <p role="alert">{error}</p>}
    <h2>Conflicts</h2>{state?.conflicts?.length === 0 && <p>No unresolved conflicts.</p>}{state?.conflicts?.map((c: Data) => <details key={c.id}><summary>{c.localQSO.call} · local / remote conflict</summary><div className="live-conflict"><pre>{JSON.stringify(c.localQSO, null, 2)}</pre><pre>{JSON.stringify(c.remoteQSO, null, 2)}</pre></div><div className="live-actions"><button onClick={() => void act("sync_resolve", { id: c.id, use_remote: false })}>Keep local</button><button onClick={() => void act("sync_resolve", { id: c.id, use_remote: true })}>Use remote</button></div></details>)}
    <h2>Pending outbox</h2><table><thead><tr><th>Call</th><th>Attempts</th><th>State</th><th>Action</th></tr></thead><tbody>{state?.outbox?.map((o: Data) => <tr key={o.id}><td>{o.call}</td><td>{o.attempt_count}</td><td>{o.waiting ? "Waiting" : o.has_error ? "Failed" : "Queued"}</td><td><button onClick={() => void act("sync_retry", { id: o.id })}>Requeue</button></td></tr>)}</tbody></table></section>;
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Radio, BookOpen, Network, Map as MapIcon, Settings, Activity, Award, LayoutDashboard, ExternalLink, RefreshCw } from "lucide-react";
import { workerRequest, openMonitor, openDetachedMap, detachedMapKind, findDetachedSpot,
  onDetachedSpot, onDetachedReady, onDetachedProjection, announceDetachedReady,
  publishDetachedProjection, requestDetachedSpot,
  onMonitorProjection, onMonitorReady, announceMonitorReady, publishMonitorProjection,
  type DetachedMapKind, type DetachedMapProjection, type MonitorProjection } from "./worker";
import WorldMap from "./Map";
import type { Spot } from "./model";
import { ClusterPanel } from "./live/ClusterPanel";
import { LogbookPanel } from "./live/LogbookPanel";
import StationPanel from "./live/StationPanel";
import { DataManagementPanel } from "./live/DataManagementPanel";
import Conditions from "./live/Conditions";
import Monitor from "./live/Monitor";
import HamlibPanel from "./live/HamlibPanel";
import { hamlibStationRequest } from "./live/hamlibStation";
import BandMaps from "./live/BandMaps";
import IntegratedAwards from "./live/AwardsPanel";
import QSOEditor from "./live/QSOEditor";
import SyncPanel from "./live/SyncPanel";
import { logMode } from "./live/draftRadio";
import { retireStationProvider } from "./live/stationHandover";
import "./live/live.css";

type Data = Record<string, any>;
type Request = (method: string, params?: Data) => Promise<any>;
const navigation = [
  ["Operator Desk", LayoutDashboard], ["Log QSO", Radio], ["Logbook", BookOpen], ["DX Cluster", Network],
  ["World Map", MapIcon], ["Band Maps", Activity], ["Awards", Award],
  ["Station Control", Radio], ["Sync", RefreshCw], ["Settings", Settings],
] as const;
const monitor = new URLSearchParams(location.search).get("view") === "monitor";
const detached = detachedMapKind(new URLSearchParams(location.search).get("view"));
const frequency = (hz?: number) => typeof hz === "number" && Number.isFinite(hz) ? (hz / 1e6).toFixed(6) : "—";
const emptySpots: Data[] = [];
const newDraft = () => localStorage.removeItem("xlog.integration.draft");

export default function LiveApp() {
  if (detached) return <DetachedMapSurface kind={detached} />;
  if (monitor) return <MonitorSurface />;
  return <MainLiveApp />;
}

function MainLiveApp() {
  const [view, setView] = useState<string>("Operator Desk");
  const [workspace, setWorkspace] = useState<Data | null>(null);
  const [settings, setSettings] = useState<Data | null>(null);
  const [draft, setDraft] = useState<Data | null>(null);
  const [station, setStation] = useState<Data | null>(null);
  const [cluster, setCluster] = useState<Data | null>(null);
  const [stats, setStats] = useState<Data | null>(null);
  const [propagation, setPropagation] = useState<Data | null>(null);
  const [lookup, setLookup] = useState<Data | null>(null);
  const [previous, setPrevious] = useState<Data[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const latestFollow = useRef(follow);
  latestFollow.current = follow;
  const setFollowImmediate = (value: boolean) => { latestFollow.current = value; setFollow(value); };
  const [autoRotor, setAutoRotor] = useState(false);
  const provider = useRef(localStorage.getItem("xlog.integration.provider") === "hamlib" ? "hamlib" : "direct_agent");
  const [stationProvider, setStationProvider] = useState(provider.current);
  const pendingTune = useRef(false);
  const providerTransition = useRef(false);
  const selection = useRef(0);
  const editing = useRef(false);
  const stationPolling = useRef(false);
  const clusterPolling = useRef(false);
  const latestSpots = useRef<Data[]>([]);
  const selectCurrentSpot = useRef<(spot: Data) => void>(() => {});
  const latestProjection = useRef<DetachedMapProjection>({ spots: [] });
  const latestMonitorProjection = useRef<MonitorProjection>({ spots: [], station: null, provider: "direct_agent", controlsEnabled: false });
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === "xlog.integration.provider" && event.newValue) { selection.current++; pendingTune.current = false; provider.current = event.newValue; setStationProvider(event.newValue); setStation(null); }
    };
    window.addEventListener("storage", changed); return () => window.removeEventListener("storage", changed);
  }, []);
  const request: Request = useCallback(async (method, params = {}) => {
    try {
      const isStation = method.startsWith("station_");
      if (providerTransition.current && ((isStation && method !== "station_snapshot") || method === "hamlib_connect" || method === "hamlib_reconnect" || method === "hamlib_control"))
        throw new Error("Wait for station handover to finish before sending another control.");
      if (isStation && params.provider) { provider.current = params.provider; setStationProvider(params.provider); localStorage.setItem("xlog.integration.provider", params.provider); }
      const requestedProvider = provider.current;
      const requestedSelection = selection.current;
      const result = isStation && requestedProvider === "hamlib"
        ? await hamlibStationRequest(method, params, async (name, args) => (await workerRequest(name, args)).result as Data)
        : (await workerRequest(method, isStation ? { provider: provider.current, ...params } : params)).result as Data;
      if (method.startsWith("cluster_") && result?.snapshot) setCluster(result);
      if (requestedProvider === provider.current && requestedSelection === selection.current) {
        if (method === "station_snapshot" || method === "station_connect" || method === "station_disconnect" || method === "station_reconnect") setStation(result);
        if (result?.state && typeof result.state === "object" && result.state.source) setStation(result.state);
      }
      return result;
    } catch (e) { throw new Error(e instanceof Error ? e.message : "Operation failed"); }
  }, []);
  const readRadioIntoDraft = useCallback(async () => {
    if (providerTransition.current) throw new Error("Wait for station handover before reading the radio.");
    const generation = selection.current, source = provider.current;
    const state = await request("station_snapshot");
    if (generation !== selection.current || source !== provider.current)
      throw new Error("Station changed during radio readback. Read again.");
    if (!state?.radio?.observed || !state.radio.connected)
      throw new Error("Radio frequency and mode are not currently observed.");
    latestFollow.current = false; setFollow(false);
    setDraft(current => current ? { ...current, frequencyHz: state.radio.frequency_hz,
      band: state.station?.band || current.band, mode: logMode(state.radio.mode, current.mode || "") } : current);
    setMessage("Observed radio frequency and mode copied into the QSO draft.");
  }, [request]);
  useEffect(() => {
    if (monitor) return;
    const focusAfterView = (selector: string) => window.setTimeout(() => document.querySelector<HTMLElement>(selector)?.focus(), 0);
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "l" && !event.shiftKey) {
        event.preventDefault(); setView("Log QSO"); focusAfterView('.qso-call input');
      } else if (key === "s" && event.shiftKey) {
        event.preventDefault(); setView("Sync"); focusAfterView('.live-sync input[type="checkbox"]');
      } else if (key === "r" && event.shiftKey) {
        event.preventDefault();
        void readRadioIntoDraft().catch(cause => setError(cause instanceof Error ? cause.message : "Radio readback unavailable."));
      }
    };
    window.addEventListener("keydown", shortcut); return () => window.removeEventListener("keydown", shortcut);
  }, [readRadioIntoDraft]);
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : "Operation failed"); }
    finally { setBusy(false); }
  };
  const changeProvider = async (next: string) => {
    if (provider.current === next || providerTransition.current) return;
    providerTransition.current = true;
    selection.current++; pendingTune.current = false; setAutoRotor(false);
    setBusy(true); setError("");
    try {
      await retireStationProvider(provider.current, async (method, params) => workerRequest(method, params));
      provider.current = next; setStationProvider(next);
      localStorage.setItem("xlog.integration.provider", next); setStation(null);
      setMessage("Previous station disconnected. Connect the selected station explicitly.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Station handover failed."); }
    finally { providerTransition.current = false; setBusy(false); }
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
  useEffect(() => {
    if (monitor) return;
    let active = true;
    const update = () => void request("propagation_snapshot").then(value => { if (active) setPropagation(value); }).catch(() => {});
    update(); const timer = setInterval(update, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [request]);
  useEffect(() => { if (!monitor && draft) localStorage.setItem("xlog.integration.draft", JSON.stringify(draft)); }, [draft]);
  useEffect(() => {
    let disposed = false;
    const pollStation = async () => {
      if (stationPolling.current) return;
      stationPolling.current = true;
      const polledProvider = provider.current;
      const polledSelection = selection.current;
      try {
        const state = await request("station_snapshot");
        if (disposed || polledProvider !== provider.current || polledSelection !== selection.current) return;
        setStation(state);
        if (latestFollow.current && !pendingTune.current && !editing.current && state.radio?.observed && state.radio?.connected) {
          setDraft(d => {
            if (!d) return d;
            const band = state.station?.band || d.band;
            const mode = logMode(state.radio.mode, d.mode || "");
            return d.frequencyHz === state.radio.frequency_hz && d.band === band && d.mode === mode
              ? d : { ...d, frequencyHz: state.radio.frequency_hz, band, mode };
          });
        }
      } catch {
        if (!disposed && polledProvider === provider.current && polledSelection === selection.current)
          setStation(s => s ? { ...s, available: false, radio: { ...s.radio, connected: false }, connection_error: "Station connection unavailable" } : null);
      } finally { stationPolling.current = false; }
    };
    void pollStation(); const timer = setInterval(() => void pollStation(), stationProvider === "hamlib" ? 1000 : 250);
    return () => { disposed = true; clearInterval(timer); };
  }, [request, stationProvider]);
  useEffect(() => {
    let disposed = false;
    const pollCluster = async () => {
      if (clusterPolling.current) return;
      clusterPolling.current = true;
      try { const spots = await request("cluster_snapshot"); if (!disposed) setCluster(spots); }
      catch { /* Keep the last verified cluster projection until reconnect. */ }
      finally { clusterPolling.current = false; }
    };
    void pollCluster(); const timer = setInterval(() => void pollCluster(), 1000);
    return () => { disposed = true; clearInterval(timer); };
  }, [request]);
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
    const selectedProvider = provider.current;
    pendingTune.current = true; editing.current = false; setSelected(spot.id);
    setDraft(d => d ? { ...d, call: spot.callsign, frequencyHz: hz, band: spot.band, mode: spot.mode,
      country: spot.country || "", dxcc: spot.adif ?? null } : d);
    setMessage(`Tuning ${spot.callsign} · waiting for observed radio state`); setError("");
    void request("station_tune", { frequency_hz: hz, mode: spot.mode }).then(async result => {
      if (selection.current !== generation || provider.current !== selectedProvider) return;
      setMessage(result.confirmed ? `${spot.callsign} · radio frequency and mode confirmed` : `${spot.callsign} · request accepted; awaiting observation`);
      if (autoRotor && result.confirmed) {
        const target = await request("lookup_call", { call: spot.callsign });
        if (selection.current === generation && provider.current === selectedProvider && typeof target.bearing === "number")
          await request(provider.current === "direct_agent" ? "station_rotor_goto" : "station_action", provider.current === "direct_agent" ? { bearing: target.bearing, label: spot.callsign } : { action: "rotor_goto", bearing: target.bearing, band: spot.band });
      }
    }).catch(e => { if (selection.current === generation && provider.current === selectedProvider) setError(e.message); })
      .finally(() => { if (selection.current === generation) pendingTune.current = false; });
  };
  const liveSpots: Data[] = cluster?.snapshot?.spots || emptySpots;
  const mapTarget = useMemo(() => draft?.call && lookup?.call === draft.call &&
    typeof lookup?.latitude === "number" && typeof lookup?.longitude === "number"
      ? { call: draft.call, lat: lookup.latitude, lon: lookup.longitude, country: lookup.country } : undefined,
    [draft?.call, lookup?.call, lookup?.latitude, lookup?.longitude, lookup?.country]);
  latestSpots.current = liveSpots;
  selectCurrentSpot.current = selectSpot;
  latestProjection.current = { spots: liveSpots, palette: cluster?.configuration?.palette,
    home: stats?.map_home, dxccStatuses: stats?.dxcc_statuses,
    radioFrequencyHz: station?.radio?.frequency_hz, selected, target: mapTarget };
  latestMonitorProjection.current = { ...latestProjection.current, station,
    provider: provider.current === "hamlib" ? "hamlib" : "direct_agent",
    controlsEnabled: !providerTransition.current && !busy && station?.source === provider.current };
  useEffect(() => {
    if (monitor) return;
    let active = true; const subscriptions: Array<() => void> = [];
    void Promise.allSettled([
      onDetachedSpot(payload => { const spot = findDetachedSpot(payload, latestSpots.current); if (spot) selectCurrentSpot.current(spot); }),
      onDetachedReady(kind => { void publishDetachedProjection(kind, latestProjection.current).catch(() => {}); }),
      onMonitorReady(() => { void publishMonitorProjection(latestMonitorProjection.current).catch(() => {}); }),
    ]).then(results => { for (const result of results) if (result.status === "fulfilled") { if (active) subscriptions.push(result.value); else result.value(); } });
    return () => { active = false; subscriptions.forEach(unlisten => unlisten()); };
  }, []);
  useEffect(() => {
    if (monitor) return;
    void publishDetachedProjection("world-map", latestProjection.current).catch(() => {});
  }, [cluster, stats, selected, mapTarget]);
  useEffect(() => {
    if (monitor) return;
    void publishDetachedProjection("band-maps", latestProjection.current).catch(() => {});
  }, [cluster, station?.radio?.frequency_hz, selected]);
  useEffect(() => {
    void publishMonitorProjection(latestMonitorProjection.current).catch(() => {});
  }, [station, cluster, stats, selected, mapTarget, stationProvider, busy]);
  const mapSpots: Spot[] = useMemo(() => liveSpots.filter(s => typeof s.latitude === "number" && typeof s.longitude === "number").map(s => ({
    id: s.id, call: s.callsign, mhz: s.frequencyKHz / 1000, mode: s.mode, band: s.band,
    country: s.country, grid: "", lon: s.longitude, lat: s.latitude, reporter: s.spotter, note: s.comment,
    state: s.callStatus === "Confirmed" ? "confirmed" : s.callStatus === "Worked" ? "worked" : "needed",
    adif: s.adif, callStatus: s.callStatus, statusHex: s.statusHex, bandHex: s.bandHex,
  })), [liveSpots]);
  const map = <WorldMap data={mapSpots} selected={selected} palette={cluster?.configuration?.palette}
    home={stats?.map_home} dxccStatuses={stats?.dxcc_statuses}
    target={mapTarget}
    onSpot={spot => { const real = liveSpots.find(s => s.id === spot.id); if (real) selectSpot(real); }} />;
  return <div className="app live">
    <header className="station-rail"><strong className="brand teal">OM0RX-xLog</strong><span className="cyan">{frequency(station?.radio?.frequency_hz)} MHz · {station?.radio?.mode || "Radio offline"}</span>
      <span className={station?.radio?.connected ? "teal" : "amber"}>{station?.radio?.connected ? "Connected" : "Disconnected"}</span>
      <span>{cluster?.snapshot?.connectedClusters || 0} clusters · {liveSpots.length} spots</span>
      <span className="rail-end">{stats?.stats?.qso_count?.toLocaleString() ?? "—"} contacts · Integrated logbook</span>
      <button onClick={() => void openMonitor().catch(e => setError(e.message))}><ExternalLink size={14} />Monitor</button>
    </header>
    <aside className="sidebar"><nav>{navigation.map(([name, Icon], i) => <div key={name}>{(i === 0 || name === "Station Control") && <div className="nav-group">{i === 0 ? "Station log" : "Services"}</div>}<button aria-current={view === name ? "page" : undefined} onClick={() => setView(name)}><Icon size={17} />{name}</button></div>)}</nav>
      <SidebarStation snapshot={station} busy={busy} onAction={action => void run(async () => { await request("station_action", { action }); })} />
      <div className="sidebar-foot"><strong className="teal">{settings?.stationCall || "Station not configured"}</strong><span>{settings?.gridSquare || "Set station grid"}</span></div>
    </aside>
    <main><div className="workspace-heading"><h1>{view}</h1><span className="secondary">{workspace?.workspace_exists ? "Your isolated working logbook · manual sync" : "Choose a logbook to begin"}</span></div>
      {workspace?.workspace_exists && <Conditions propagation={propagation?.bands?.length ? propagation : station?.propagation || null} request={request} />}
      {error && <div className="live-error" role="alert">{error}<button onClick={() => setError("")}>Dismiss</button></div>}
      {message && <p className="live-message" role="status">{message}</p>}
      {!workspace?.workspace_exists ? <section className="live-onboarding"><h2>Bring your logbook into the integrated app</h2><p>Create a verified copy of your existing xLog database, or begin with an empty logbook. Your original database, settings and installed apps are not modified. Existing remote sync credentials are not copied.</p>
        <div className="live-actions"><button className="primary" disabled={busy || !workspace?.native_log_exists} onClick={() => void run(async () => { await request("workspace_create", { mode: "copy_native" }); await reload(); })}>Copy my existing xLog logbook</button>
        <button disabled={busy || !workspace} onClick={() => void run(async () => { await request("workspace_create", { mode: "empty" }); await reload(); })}>Create empty logbook</button>
        <button onClick={() => void run(reload)}>Retry connection</button></div><p className="secondary">No sample contacts, spots or station readings are loaded.</p></section> : <>
      {view === "Operator Desk" && <><div className="live-desk-top"><DeskQSO draft={draft} setDraft={setDraft} save={save} busy={busy} onEditor={() => setView("Log QSO")} follow={follow} setFollow={setFollowImmediate} />
        <section className="live-context callsign-context"><h2>Callsign intelligence</h2><strong>{lookup?.country || "Enter a callsign"}</strong><span>{lookup?.source || "CTY / QRZ"}</span><p>{lookup?.bearing != null ? `${Math.round(lookup.bearing)}° · ${Math.round(lookup.distance_km)} km` : "Bearing unavailable"}</p><span className="teal">{previous.length ? `${previous.length}${previous.length === 10 ? "+" : ""} previous contacts` : "No previous contacts"}</span><p className="secondary">{previous[0] ? `${previous[0].band} · ${previous[0].mode} · ${new Date(previous[0].start).toLocaleDateString()}` : "No QSO is saved until you log it."}</p></section>
        <section className="live-context station-pulse"><h2>Station pulse</h2><span>Radio <b>{station?.radio?.connected ? station.radio.mode : "Offline"}</b></span><span>xCluster <b>{liveSpots.length} spots</b></span><span>Logbook <b>{stats?.stats?.qso_count?.toLocaleString() ?? "—"}</b></span><label><input type="checkbox" checked={autoRotor} onChange={e => setAutoRotor(e.target.checked)} />Auto rotor</label><button onClick={() => setView("Station Control")}>Station controls</button></section></div>
        <div className="live-desk-bottom"><div className="live-map">{map}</div><BandMaps spots={liveSpots} onSelect={selectSpot} radioFrequencyHz={station?.radio?.frequency_hz} compact /></div></>}
      {view === "Log QSO" && <QSOEditor draft={draft} setDraft={setDraft} save={save} clear={() => void run(clear)} busy={busy} lookup={lookup} previous={previous} follow={follow} setFollow={setFollowImmediate} request={request} onReadRadio={readRadioIntoDraft} />}
      {view === "Logbook" && <LogbookPanel onRequest={request} refreshKey={refresh} onEdit={qso => { editing.current = true; setDraft(qso); setFollowImmediate(false); setView("Log QSO"); }} />}
      {view === "DX Cluster" && <ClusterPanel snapshot={cluster} onRequest={request} onSelect={selectSpot} />}
      {view === "World Map" && <><div className="live-actions"><button type="button" onClick={() => void openDetachedMap("world-map").catch(e => setError(e.message))}><ExternalLink size={14} />Open World Map window</button></div><div className="live-map full">{map}</div></>}
      {view === "Band Maps" && <><div className="live-actions"><button type="button" onClick={() => void openDetachedMap("band-maps").catch(e => setError(e.message))}><ExternalLink size={14} />Open Band Maps window</button></div><BandMaps spots={liveSpots} onSelect={selectSpot} radioFrequencyHz={station?.radio?.frequency_hz} /></>}
      {view === "Station Control" && <><div className="live-station-provider" role="group" aria-label="Station connection type">
        {[["direct_agent", "Remote station · embedded xCat"], ["hamlib", "Local station · Hamlib"]].map(([id, label]) => <button key={id} className={stationProvider === id ? "selected" : ""} aria-pressed={stationProvider === id} disabled={busy} onClick={() => void changeProvider(id)}>{label}</button>)}
        <span>Switching station type disconnects the previous owner. Connect the new station explicitly.</span></div>
        {stationProvider === "hamlib" ? <HamlibPanel request={request} snapshot={station} /> : <StationPanel snapshot={station} onRequest={request} onSnapshot={setStation} />}</>}
      {view === "Awards" && <IntegratedAwards request={request} refresh={refresh} />}
      {view === "Settings" && settings && <><SettingsPanel values={settings} request={request} onSaved={setSettings} /><DataManagementPanel onRequest={request} onChanged={() => setRefresh(n => n + 1)} /></>}
      {view === "Sync" && <SyncPanel request={request} onChanged={() => setRefresh(n => n + 1)} />}
      </>}
    </main></div>;
}

function DetachedMapSurface({ kind }: { kind: DetachedMapKind }) {
  const [projection, setProjection] = useState<DetachedMapProjection>({ spots: [] });
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true; let unlisten: (() => void) | null = null;
    void onDetachedProjection(value => {
      if (active && value && Array.isArray(value.spots)) setProjection(value);
    }).then(stop => {
      if (!active) { stop(); return; }
      unlisten = stop;
      void announceDetachedReady(kind).catch(cause => setError(cause instanceof Error ? cause.message : "Map projection unavailable."));
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Map projection unavailable."); });
    return () => { active = false; unlisten?.(); };
  }, [kind]);
  const spots = projection.spots;
  const mapSpots: Spot[] = spots.filter(s => typeof s.latitude === "number" && typeof s.longitude === "number").map(s => ({
    id: s.id, call: s.callsign, mhz: s.frequencyKHz / 1000, mode: s.mode, band: s.band,
    country: s.country, grid: "", lon: s.longitude, lat: s.latitude, reporter: s.spotter, note: s.comment,
    state: s.callStatus === "Confirmed" ? "confirmed" : s.callStatus === "Worked" ? "worked" : "needed",
    adif: s.adif, callStatus: s.callStatus, statusHex: s.statusHex, bandHex: s.bandHex,
  }));
  const select = (spot: { id?: unknown }) => {
    if (typeof spot.id === "string") void requestDetachedSpot(kind, spot.id).catch(cause => setError(cause instanceof Error ? cause.message : "Spot selection could not reach the main window."));
  };
  return <div className="app live monitor-app" style={{ display: "flex", flexDirection: "column" }}>
    <header className="station-rail"><strong className="brand teal">OM0RX-xLog</strong><span className="cyan">{kind === "world-map" ? "World Map" : "Band Maps"}</span><span className="rail-end">{spots.length} live spots · selection handled by main window</span></header>
    <main style={{ flex: 1, minHeight: 0, padding: 14 }}>
      {error && <p className="live-error" role="alert">{error}</p>}
      {kind === "world-map" ? <div className="live-map full"><WorldMap data={mapSpots} selected={projection.selected ?? null}
        palette={projection.palette} home={projection.home} dxccStatuses={projection.dxccStatuses}
        target={projection.target}
        onSpot={select} /></div> : <BandMaps spots={spots} onSelect={select} radioFrequencyHz={projection.radioFrequencyHz} />}
      <p className="secondary">This window displays the main app’s latest read-only projection. Spot selection is validated and handled by the main window.</p>
    </main>
  </div>;
}

function MonitorSurface() {
  const [projection, setProjection] = useState<MonitorProjection>({ spots: [], station: null, provider: "direct_agent", controlsEnabled: false });
  const [error, setError] = useState("");
  const [receivedAt, setReceivedAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let active = true; let unlisten: (() => void) | null = null;
    void onMonitorProjection(value => { if (active) { setProjection(value); setReceivedAt(Date.now()); setClock(Date.now()); } }).then(stop => {
      if (!active) { stop(); return; }
      unlisten = stop;
      void announceMonitorReady().catch(cause => setError(cause instanceof Error ? cause.message : "Monitor state unavailable."));
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Monitor state unavailable."); });
    return () => { active = false; unlisten?.(); };
  }, []);
  const mapSpots: Spot[] = useMemo(() => projection.spots.filter(s => typeof s.latitude === "number" && typeof s.longitude === "number").map(s => ({
    id: s.id, call: s.callsign, mhz: s.frequencyKHz / 1000, mode: s.mode, band: s.band,
    country: s.country, grid: "", lon: s.longitude, lat: s.latitude, reporter: s.spotter, note: s.comment,
    state: s.callStatus === "Confirmed" ? "confirmed" : s.callStatus === "Worked" ? "worked" : "needed",
    adif: s.adif, callStatus: s.callStatus, statusHex: s.statusHex, bandHex: s.bandHex,
  })), [projection.spots]);
  const generatedAt = projection.station?.generated_at;
  const stale = receivedAt === 0 || clock - receivedAt > 5_000 ||
    (typeof generatedAt === "number" && Number.isFinite(generatedAt) &&
      (clock - generatedAt * 1_000 > 5_000 || generatedAt * 1_000 - clock > 5_000));
  const displayedStation = stale && projection.station ? { ...projection.station,
    radio: { ...projection.station.radio, observed: false },
    station: { ...projection.station.station, radio_stale: true },
    rotor: { ...projection.station.rotor, connected: false } } : projection.station;
  const monitorRequest: Request = async (method, params = {}) => {
    if (stale || !projection.controlsEnabled || !projection.station?.radio?.connected) throw new Error("Main station is changing or unavailable.");
    const source = projection.provider;
    if (method === "station_action" && source === "direct_agent") {
      const action = params.action;
      if (!["operate", "standby", "tune", "cancel"].includes(action) ||
          !projection.station.station?.allowed_actions?.includes(action)) throw new Error("Station action is unavailable.");
      const result = (await workerRequest(method, { provider: source, action })).result as Data;
      if (result?.accepted !== true) throw new Error("Station action was not accepted.");
      return result;
    }
    if ((method === "station_rotor_goto" || method === "station_rotor_stop") && projection.station.rotor?.connected) {
      if (method === "station_rotor_goto" &&
          (typeof params.bearing !== "number" || !Number.isFinite(params.bearing) || params.bearing < 0 || params.bearing > 360))
        throw new Error("Rotor bearing must be between 0 and 360 degrees.");
      if (source === "hamlib") {
        const result = (await workerRequest("hamlib_control", { device: "rotor", action: method === "station_rotor_goto" ? "goto" : "stop",
          ...(method === "station_rotor_goto" ? { azimuth: params.bearing, elevation: 0 } : {}) })).result as Data;
        if (result?.state !== "accepted") throw new Error("Rotor command was not accepted.");
        return { accepted: true, confirmed: false };
      }
      const result = (await workerRequest(method, { provider: source,
        ...(method === "station_rotor_goto" ? { bearing: params.bearing } : {}) })).result as Data;
      if (result?.accepted !== true) throw new Error("Rotor command was not accepted.");
      return result;
    }
    throw new Error("This monitor command is unavailable.");
  };
  const map = <WorldMap data={mapSpots} selected={projection.selected ?? null} palette={projection.palette}
    home={projection.home} dxccStatuses={projection.dxccStatuses} target={projection.target} />;
  return <>{error && <p className="live-error" role="alert">{error}</p>}
    {stale && <p className="live-error" role="status">Main station observation is stale. Reopen the main window before using monitor controls.</p>}
    <Monitor snapshot={displayedStation} map={map} onRequest={!stale && projection.controlsEnabled ? monitorRequest : undefined} /></>;
}

function SidebarStation({ snapshot, busy, onAction }: { snapshot: Data | null; busy: boolean; onAction: (action: string) => void }) {
  const s = snapshot?.station, local = snapshot?.source === "hamlib";
  const detail = (text: string | undefined, prefix: string) => text?.split(/[|·]/).map(v => v.trim()).find(v => v.toUpperCase().startsWith(prefix + " "))?.slice(prefix.length).trim();
  const band = (text: string | undefined) => text?.split(/[|·]/).map(v => v.trim()).find(v => /^\d+(\.\d+)?[cm]+$/i.test(v));
  const antenna = s?.kat_detail_primary?.match(/\bANT\s*\d+\b/)?.[0];
  const action = s?.kpa_operate ? "standby" : "operate";
  const items = local ? [["FREQUENCY", frequency(snapshot?.radio?.frequency_hz), "cyan"], ["MODE", snapshot?.radio?.mode || "—", "teal"], ["ROTOR", snapshot?.rotor?.azimuth == null ? "—" : `${Math.round(snapshot.rotor.azimuth)}°`, "cyan"]]
    : [["OUTPUT", detail(s?.kpa_detail_primary, "OUT") || (s?.tx_power_watts == null ? "—" : `${s.tx_power_watts} W`), "orange"],
      [s?.swr_is_live ? "SWR LIVE" : "SWR LAST", s?.swr?.toFixed(2) || "—", "teal"], ["KPA BAND", band(s?.kpa_detail_primary) || s?.band || "—", "amber"],
      ["KPA TEMP", detail(s?.kpa_detail_secondary, "TEMP") || "—", "amber"], ["KAT BAND", band(s?.kat_detail_primary) || s?.band || "—", "cyan"], ["ANTENNA", antenna || "—", "cyan"]];
  return <section className="live-station-brief"><div className="nav-group">Station</div><strong className={local ? "cyan" : "amber"}>{local ? "LOCAL · HAMLIB" : `KPA500 · ${s?.kpa_operate == null ? "OFFLINE" : s.kpa_operate ? "OPERATE" : "STANDBY"}`}</strong>
    {!local && <button className={s?.kpa_operate ? "teal" : "orange"} disabled={busy || !s?.allowed_actions?.includes(action)} onClick={() => onAction(action)}>Switch to {action}</button>}
    <div className="sidebar-metrics">{items.map(([title, text, color]) => <div key={title} className={color}><small>{title}</small><b>{text}</b></div>)}</div></section>;
}
function DeskQSO({ draft, setDraft, save, busy, onEditor, follow, setFollow }: any) {
  if (!draft) return <section className="live-editor">Opening logbook…</section>;
  const field = (key: string, label: string, className = "") => <label className={className}>{label}<input aria-label={`Desk ${label}`} value={key === "frequencyHz" ? draft[key] ? draft[key] / 1e6 : "" : draft[key] || ""} onChange={e => { if (["frequencyHz", "band", "mode"].includes(key)) setFollow(false); setDraft((d: Data) => ({ ...d, [key]: key === "frequencyHz" ? e.target.value ? Math.round(Number(e.target.value) * 1e6) : null : key === "call" ? e.target.value.toUpperCase() : e.target.value })); }} autoComplete="off" spellCheck={false} /></label>;
  return <section className="live-editor compact-editor"><h2>Active QSO</h2><form onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); if (!busy && draft.call) save(); } else if (e.key === "Escape") { e.preventDefault(); e.currentTarget.querySelector<HTMLInputElement>('input[aria-label="Desk Callsign"]')?.focus(); } }} onSubmit={e => { e.preventDefault(); if (!busy && draft.call) save(); }}>
    <div className="desk-qso-primary">{field("call", "Callsign", "desk-call")}{field("frequencyHz", "Frequency MHz")}<label>Band<select value={draft.band} onChange={e => { setFollow(false); setDraft((d: Data) => ({ ...d, band: e.target.value })); }}>{["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "4m", "2m", "70cm"].map(b => <option key={b}>{b}</option>)}</select></label><label>Mode<select value={draft.mode} onChange={e => { setFollow(false); setDraft((d: Data) => ({ ...d, mode: e.target.value })); }}>{["CW", "SSB", "AM", "FM", "RTTY", "FT8", "FT4", "FT2", "PSK", "DIGI"].map(m => <option key={m}>{m}</option>)}</select></label></div>
    <div className="desk-qso-secondary">{field("name", "Name")}{field("comment", "Comment / spot note")}{field("rstSent", "Sent")}{field("rstReceived", "Received")}</div>
    <div className="live-actions"><button type="button" onClick={onEditor}>Full editor</button><label><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} />Follow radio</label><button className="primary" disabled={busy || !draft.call}>Log QSO</button></div></form></section>;
}

function SettingsPanel({ values, request, onSaved }: { values: Data; request: Request; onSaved: (value: Data) => void }) {
  const [form, setForm] = useState(values); const [message, setMessage] = useState(""); const [credentials, setCredentials] = useState<Data>({});
  const fields = [["operatorCall", "Operator call"], ["stationCall", "Station call"], ["gridSquare", "Station grid"], ["stationLocation", "Station location"], ["defaultPower", "Default power W"], ["defaultRadio", "Radio name"], ["wavelogURL", "Wavelog URL"], ["wavelogStationID", "Wavelog station ID"], ["qrzUsername", "QRZ username"], ["clubLogCTYURL", "Club Log CTY URL"], ["lotwActivityURL", "LoTW activity URL"]];
  return <section className="live-settings"><form onSubmit={e => { e.preventDefault(); void request("settings_save", { settings: form }).then(r => { onSaved(r.settings); setMessage("Settings saved. Automatic sync remains off for this independent logbook."); }).catch(e => setMessage(e.message)); }}><div className="live-fields">{fields.map(([key, name]) => <label key={key}>{name}<input value={form[key] ?? ""} onChange={e => setForm({ ...form, [key]: key === "wavelogStationID" ? Number(e.target.value) : e.target.value })} /></label>)}</div><label><input type="checkbox" checked={form.qrzEnabled} onChange={e => setForm({ ...form, qrzEnabled: e.target.checked })} />Use QRZ XML lookup</label><div className="live-actions"><button className="primary">Save settings</button></div></form>
    <h2>Private credentials</h2><p>Stored only in the integrated app’s macOS Keychain service. Existing application credentials are not changed.</p>{[["wavelog-token", "Wavelog API v2 token"], ["qrz-password", "QRZ password"], ["clublog-api-key", "Club Log API key"]].map(([account, label]) => <form className="live-secret" key={account} onSubmit={e => { e.preventDefault(); void request("secret_save", { account, value: credentials[account] || "" }).then(() => { setCredentials(c => ({ ...c, [account]: "" })); setMessage(`${label} saved in Keychain`); }).catch(e => setMessage(e.message)); }}><label>{label}<input type="password" autoComplete="off" value={credentials[account] || ""} onChange={e => setCredentials({ ...credentials, [account]: e.target.value })} /></label><button disabled={!credentials[account]}>Save credential</button></form>)}<p role="status">{message}</p></section>;
}

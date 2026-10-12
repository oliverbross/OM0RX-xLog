import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Radio, BookOpen, Network, Map as MapIcon, Settings, Activity, Award, LayoutDashboard, ExternalLink, RefreshCw } from "lucide-react";
import { workerRequest, openMonitor, openDetachedMap, detachedMapKind, findDetachedSpot,
  onDetachedSpot, onDetachedReady, onDetachedProjection, announceDetachedReady,
  publishDetachedProjection, requestDetachedSpot, onDetachedBandMapPreferences, requestDetachedBandMapPreferences,
  onMonitorProjection, onMonitorReady, announceMonitorReady, publishMonitorProjection,
  type DetachedMapKind, type DetachedMapProjection, type MonitorProjection, type StationProvider } from "./worker";
import WorldMap from "./Map";
import type { Spot } from "./model";
import { ClusterPanel } from "./live/ClusterPanel";
import { DetachedClusterSurface } from "./live/DetachedClusterSurface";
import { openDetachedCluster, dockDetachedWorkspace, onClusterReady, onClusterRequest, onDetachedDock,
  publishClusterProjection, completeClusterRequest, type ClusterProjection } from "./live/DetachedClusterBridge";
import { LogbookPanel } from "./live/LogbookPanel";
import StationPanel from "./live/StationPanel";
import { DataManagementPanel } from "./live/DataManagementPanel";
import Conditions from "./live/Conditions";
import Monitor from "./live/Monitor";
import HamlibPanel from "./live/HamlibPanel";
import DirectFlexPanel from "./live/DirectFlexPanel";
import { hamlibStationRequest } from "./live/hamlibStation";
import BandMaps, { bandForRadio } from "./live/BandMaps";
import { bandMapView, migrateLegacyBandMaps, validBandMapView, withBandMapView } from "./live/workspacePreferences";
import type { WorkspacePreferences } from "./live/workspacePreferences";
import type { BandMapViewPreferences } from "./live/BandMaps";
import IntegratedAwards from "./live/AwardsPanel";
import QSOEditor from "./live/QSOEditor";
import OperatorDesk from "./live/OperatorDesk";
import SyncPanel from "./live/SyncPanel";
import ServiceSettings from "./live/ServiceSettings";
import WorkspaceGate from "./live/WorkspaceGate";
import SpotBridgePanel from "./live/SpotBridgePanel";
import { logMode } from "./live/draftRadio";
import { retireStationProvider } from "./live/stationHandover";
import RotorPanel from "./live/RotorPanel";
import { clearConnectedHandoverMessage, ownAutomaticRotorMotion, rotorCommandParams, rotorIntentCurrent, rotorProjection, validRotorSnapshot, type AutomaticRotorIntent, type RotorSnapshot } from "./live/rotorControl";
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
const detachedCluster = new URLSearchParams(location.search).get("view") === "dx-cluster";
const frequency = (hz?: number) => typeof hz === "number" && Number.isFinite(hz) ? (hz / 1e6).toFixed(6) : "—";
const emptySpots: Data[] = [];
const newDraft = () => localStorage.removeItem("xlog.integration.draft");

export default function LiveApp() {
  if (detachedCluster) return <DetachedClusterSurface />;
  if (detached) return <DetachedMapSurface kind={detached} />;
  if (monitor) return <MonitorSurface />;
  return <MainLiveApp />;
}

function MainLiveApp() {
  const [view, setView] = useState<string>("Operator Desk");
  const [workspace, setWorkspace] = useState<Data | null>(null);
  const [workspacePending, setWorkspacePending] = useState(true);
  const [settings, setSettings] = useState<Data | null>(null);
  const [workspacePreferences, setWorkspacePreferences] = useState<WorkspacePreferences | null>(null);
  const latestWorkspacePreferences = useRef<WorkspacePreferences | null>(null);
  const preferenceWrite = useRef<Promise<unknown>>(Promise.resolve());
  const preferenceRevision = useRef(0);
  const [draft, setDraft] = useState<Data | null>(null);
  const draftIdentity = useRef(draft?.id); draftIdentity.current = draft?.id;
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
  const [rotorState, setRotorState] = useState<RotorSnapshot | null>(null);
  const rotorRef = useRef<RotorSnapshot | null>(null);
  const autoEnabled = useRef(false), autoEpoch = useRef(0);
  const automaticMotion = useRef<AutomaticRotorIntent | null>(null);
  const rotorPolling = useRef(false);
  const disarmAutoRotor = useCallback(() => { autoEpoch.current++; automaticMotion.current = null; autoEnabled.current = false; setAutoRotor(false); }, []);
  const changeAutoRotor = (enabled: boolean) => { autoEpoch.current++; automaticMotion.current = null; autoEnabled.current = enabled; setAutoRotor(enabled); };
  const savedProvider = localStorage.getItem("xlog.integration.provider");
  const provider = useRef<StationProvider>(savedProvider === "hamlib" || savedProvider === "direct_flex_lan" ? savedProvider : "direct_agent");
  const [stationProvider, setStationProvider] = useState(provider.current);
  const [stationSection, setStationSection] = useState("Control and connections");
  const pendingTune = useRef(false);
  const providerTransition = useRef(false);
  const selection = useRef(0);
  const editing = useRef(false);
  const stationPolling = useRef(false);
  const clusterPolling = useRef(false);
  const clusterMutationEpoch = useRef(0);
  const latestSpots = useRef<Data[]>([]);
  const selectCurrentSpot = useRef<(spot: Data) => void>(() => {});
  const latestProjection = useRef<DetachedMapProjection>({ spots: [] });
  const mapProjectionRevision = useRef(0);
  const latestClusterProjection = useRef<ClusterProjection | null>(null);
  const clusterProjectionRevision = useRef(0);
  const latestMonitorProjection = useRef<MonitorProjection>({ spots: [], station: null, provider: "direct_agent", controlsEnabled: false });
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === "xlog.integration.provider" && (event.newValue === "hamlib" || event.newValue === "direct_agent" || event.newValue === "direct_flex_lan")) { selection.current++; pendingTune.current = false; disarmAutoRotor(); provider.current = event.newValue; setStationProvider(event.newValue); setStation(null); }
    };
    window.addEventListener("storage", changed); return () => window.removeEventListener("storage", changed);
  }, []);
  const request: Request = useCallback(async (method, params = {}) => {
    try {
      const clusterEpoch = method === "cluster_filter" || method === "cluster_configure" || method === "cluster_connect" || method === "cluster_disconnect"
        ? ++clusterMutationEpoch.current : clusterMutationEpoch.current;
      if (method.startsWith("rotor_")) {
        const ownRequest = method === "rotor_goto" && automaticMotion.current?.id === params.intent_id && automaticMotion.current?.epoch === autoEpoch.current && autoEnabled.current;
        if (["rotor_connect", "rotor_disconnect", "rotor_stop", "rotor_park"].includes(method) || method === "rotor_goto" && !ownRequest) disarmAutoRotor();
        try {
          if (method === "rotor_stop") {
            const current = (await workerRequest("rotor_snapshot", {})).result;
            if (!validRotorSnapshot(current) || !current.owner || current.owner !== params.owner)
              throw new Error("Rotor owner changed. Observe the selected rotor before requesting Stop again.");
            // Explicit Stop targets the freshly observed same-owner connection,
            // not the older generation held by an in-flight turn. Never retry.
            params = { ...params, owner: current.owner, generation: current.generation };
          }
          const result = (await workerRequest(method, params)).result;
          if (validRotorSnapshot(result) && (!rotorRef.current || result.generation >= rotorRef.current.generation)) {
            const previous = rotorRef.current;
            const ownMotion = ownAutomaticRotorMotion(automaticMotion.current, result, autoEpoch.current, autoEnabled.current);
            if (previous && (previous.owner !== result.owner || previous.generation !== result.generation) && !ownMotion) disarmAutoRotor();
            if (result.state !== "active" && result.owner) disarmAutoRotor();
            if (result.backend_available === false || method === "rotor_snapshot" && previous && rotorProjection(previous).connected && !rotorProjection(result).connected) disarmAutoRotor();
            const motion = ["rotor_goto", "rotor_stop", "rotor_park"].includes(method);
            const next = motion && previous?.owner === result.owner ? { ...result, backend: previous.backend } : result;
            rotorRef.current = next; setRotorState(next);
          }
          return result;
        } catch (cause) {
          disarmAutoRotor();
          throw cause;
        } finally {
          // Every motion advances the fence, including lost replies. Refresh the
          // coordinator rather than reusing a now-stale accepted intent.
          if (["rotor_goto", "rotor_stop", "rotor_park"].includes(method)) {
            try {
              const next = (await workerRequest("rotor_snapshot", {})).result;
              if (validRotorSnapshot(next) && (!rotorRef.current || next.generation >= rotorRef.current.generation)) {
                const previous = rotorRef.current;
                if (next.state !== "active" || next.backend_available === false || previous && (next.owner !== previous.owner || next.generation !== previous.generation) && !ownAutomaticRotorMotion(automaticMotion.current, next, autoEpoch.current, autoEnabled.current)) disarmAutoRotor();
                rotorRef.current = next; setRotorState(next);
              }
            } catch {
              disarmAutoRotor();
              const previous = rotorRef.current;
              const next = previous ? { ...previous, state: "uncertain" as const, backend_available: false } : null;
              rotorRef.current = next; setRotorState(next);
            }
          }
        }
      }
      const isStation = method.startsWith("station_");
      if (providerTransition.current && ((isStation && method !== "station_snapshot") || method === "hamlib_connect" || method === "hamlib_reconnect" || method === "hamlib_control"))
        throw new Error("Wait for station handover to finish before sending another control.");
      if (isStation && params.provider && params.provider !== provider.current)
        throw new Error("Selected station changed. Finish handover before connecting or sending controls.");
      const requestedProvider = provider.current;
      const requestedSelection = selection.current;
      const result = isStation && requestedProvider === "hamlib"
        ? await hamlibStationRequest(method, params, async (name, args) => (await workerRequest(name, args)).result as Data)
        : (await workerRequest(method, isStation ? { provider: provider.current, ...params } : params)).result as Data;
      if (method.startsWith("cluster_") && result?.snapshot && clusterEpoch === clusterMutationEpoch.current) setCluster(result);
      if (requestedProvider === provider.current && requestedSelection === selection.current) {
        if (method === "station_snapshot" || method === "station_connect" || method === "station_disconnect" || method === "station_reconnect") setStation(result);
        if (result?.state && typeof result.state === "object" && result.state.source) setStation(result.state);
        if (result?.radio?.connected && result.radio.observed || result?.state?.radio?.connected && result.state.radio.observed)
          setMessage(current => clearConnectedHandoverMessage(current, true));
      }
      return result;
    } catch (e) { throw new Error(e instanceof Error ? e.message : "Operation failed"); }
  }, [disarmAutoRotor]);
  const readRadioIntoDraft = useCallback(async () => {
    if (providerTransition.current) throw new Error("Wait for station handover before reading the radio.");
    const generation = selection.current, source = provider.current, identity = draftIdentity.current;
    if (!identity) throw new Error("Open a QSO draft before reading the radio.");
    const state = await request("station_snapshot");
    if (generation !== selection.current || source !== provider.current || identity !== draftIdentity.current)
      throw new Error("Station or QSO draft changed during radio readback. Read again.");
    if (!state?.radio?.observed || !state.radio.connected)
      throw new Error("Radio frequency and mode are not currently observed.");
    latestFollow.current = false; setFollow(false);
    setDraft(current => current && current.id === identity ? { ...current, frequencyHz: state.radio.frequency_hz,
      band: state.station?.band || bandForRadio(state.radio.frequency_hz) || current.band,
      mode: logMode(state.radio.mode, current.mode || "") } : current);
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
  const changeProvider = async (next: StationProvider) => {
    if (provider.current === next || providerTransition.current) return;
    providerTransition.current = true;
    selection.current++; pendingTune.current = false; disarmAutoRotor();
    setBusy(true); setError("");
    try {
      await retireStationProvider(provider.current, async (method, params) => workerRequest(method, params));
      provider.current = next; setStationProvider(next);
      localStorage.setItem("xlog.integration.provider", next); setStation(null);
      setMessage("Previous radio disconnected. Connect the selected radio explicitly.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Station handover failed."); }
    finally { providerTransition.current = false; setBusy(false); }
  };
  const reload = useCallback(async () => {
    setWorkspacePending(true);
    try {
    const state = await request("workspace_status");
    if (state.workspace_exists) {
      await preferenceWrite.current.catch(() => {});
      const [s, totals, blank, loaded] = await Promise.all([request("settings_load"), request("logbook_stats"), request("logbook_draft"), request("workspace_preferences_load")]);
      const prior = loaded.preferences as WorkspacePreferences;
      const migrated = loaded.stored ? null : migrateLegacyBandMaps(prior, localStorage);
      const preferences = migrated ? (await request("workspace_preferences_save", { preferences: migrated })).preferences as WorkspacePreferences : prior;
      latestWorkspacePreferences.current = preferences;
      setWorkspacePreferences(preferences);
      setSettings(s.settings); setStats(totals);
      setDraft(current => {
        if (current) return current;
        try { const saved = JSON.parse(localStorage.getItem("xlog.integration.draft") || "null"); return saved?.id && saved?.start ? saved : blank.qso; }
        catch { return blank.qso; }
      });
    }
    setWorkspace(state);
    } finally { setWorkspacePending(false); }
  }, [request]);
  const changeBandMapPreferences = (compact: boolean, view: BandMapViewPreferences) => {
    const current = latestWorkspacePreferences.current;
    if (!current || !validBandMapView(view)) return;
    const next = withBandMapView(current, compact, view);
    latestWorkspacePreferences.current = next;
    setWorkspacePreferences(next);
    const revision = ++preferenceRevision.current;
    preferenceWrite.current = preferenceWrite.current.catch(() => {}).then(() => request("workspace_preferences_save", { preferences: next }));
    void preferenceWrite.current.catch(cause => {
      if (revision !== preferenceRevision.current) return;
      setError(cause instanceof Error ? cause.message : "Band-map preferences could not be saved.");
      void request("workspace_preferences_load").then(loaded => {
        if (revision !== preferenceRevision.current) return;
        latestWorkspacePreferences.current = loaded.preferences;
        setWorkspacePreferences(loaded.preferences);
      }).catch(() => {});
    });
  };
  const dataManagementRequest: Request = useCallback(async (method, params = {}) => {
    if (method === "backup_create" || method === "backup_restore") await preferenceWrite.current;
    return request(method, params);
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
            const band = state.station?.band || bandForRadio(state.radio.frequency_hz) || d.band;
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
      try { if (!disposed) await request("cluster_snapshot"); }
      catch { /* Keep the last verified cluster projection until reconnect. */ }
      finally { clusterPolling.current = false; }
    };
    void pollCluster(); const timer = setInterval(() => void pollCluster(), 1000);
    return () => { disposed = true; clearInterval(timer); };
  }, [request]);
  useEffect(() => {
    let disposed = false;
    const pollRotor = async () => {
      if (rotorPolling.current) return;
      rotorPolling.current = true;
      try { if (!disposed) await request("rotor_snapshot"); }
      catch {
        if (!disposed) {
          disarmAutoRotor();
          const previous = rotorRef.current;
          if (previous) { const next = { ...previous, backend_available: false }; rotorRef.current = next; setRotorState(next); }
        }
      } finally { rotorPolling.current = false; }
    };
    void pollRotor(); const timer = setInterval(() => void pollRotor(), 1000);
    return () => { disposed = true; clearInterval(timer); };
  }, [request, disarmAutoRotor]);
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
    const rotorIntent = rotorRef.current?.owner && rotorProjection(rotorRef.current).connected ?
      { owner: rotorRef.current.owner, generation: rotorRef.current.generation } : null;
    const automaticEpoch = autoEpoch.current;
    const automaticRequested = autoEnabled.current;
    pendingTune.current = true; editing.current = false; setSelected(spot.id);
    setDraft(d => d ? { ...d, call: spot.callsign, frequencyHz: hz, band: spot.band, mode: spot.mode,
      country: spot.country || "", dxcc: spot.adif ?? null } : d);
    setMessage(`Tuning ${spot.callsign} · waiting for observed radio state`); setError("");
    void request("station_tune", { frequency_hz: hz, mode: String(spot.mode || "").toUpperCase() }).then(async result => {
      if (selection.current !== generation || provider.current !== selectedProvider) return;
      setMessage(result.confirmed ? `${spot.callsign} · radio frequency and mode confirmed` : `${spot.callsign} · request accepted; awaiting observation`);
      if (automaticRequested && rotorIntent && autoEnabled.current && autoEpoch.current === automaticEpoch && result.confirmed) {
        const target = await request("lookup_call", { call: spot.callsign });
        if (selection.current === generation && provider.current === selectedProvider && autoEnabled.current && autoEpoch.current === automaticEpoch &&
            rotorIntentCurrent(rotorIntent, rotorRef.current) && String(target.call).trim().toUpperCase() === String(spot.callsign).trim().toUpperCase() &&
            typeof target.bearing === "number" && Number.isFinite(target.bearing) && target.bearing >= 0 && target.bearing <= 360) {
          const id = crypto.randomUUID();
          automaticMotion.current = { ...rotorIntent, epoch: automaticEpoch, id };
          await request("rotor_goto", { ...rotorIntent, bearing: target.bearing, label: spot.callsign, intent_id: id });
        }
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
  latestProjection.current = { revision: ++mapProjectionRevision.current, spots: liveSpots, palette: cluster?.configuration?.palette,
    home: stats?.map_home, dxccStatuses: stats?.dxcc_statuses,
    radioFrequencyHz: station?.radio?.frequency_hz, selected, target: mapTarget,
    bandMapPreferences: workspacePreferences ? bandMapView(workspacePreferences, false) : undefined };
  const stationWithRotor = { ...(station || { source: provider.current, radio: null }), rotor: rotorProjection(rotorState),
    rotor_control: rotorState, projection_received_at: Date.now() / 1000 };
  latestMonitorProjection.current = { ...latestProjection.current, station: stationWithRotor,
    provider: provider.current,
    controlsEnabled: !providerTransition.current && !busy && station?.source === provider.current };
  useEffect(() => {
    if (monitor) return;
    let active = true; const subscriptions: Array<() => void> = [];
    void Promise.allSettled([
      onDetachedSpot(payload => { const spot = findDetachedSpot(payload, latestSpots.current); if (spot) selectCurrentSpot.current(spot); }),
      onDetachedBandMapPreferences(value => { if (validBandMapView(value)) changeBandMapPreferences(false, value); }),
      onDetachedReady(kind => { void publishDetachedProjection(kind, latestProjection.current).catch(() => {}); }),
      onClusterReady(() => { if (latestClusterProjection.current) void publishClusterProjection(latestClusterProjection.current).catch(() => {}); }),
      onClusterRequest(entry => { void request(entry.method, entry.params).then(result =>
        completeClusterRequest({ id: entry.id, ok: true, result })).catch(() =>
        completeClusterRequest({ id: entry.id, ok: false, error: "Cluster action failed in the main workspace. Review its status and retry." })).catch(() => {}); }),
      onDetachedDock(kind => { setView(kind === "dx-cluster" ? "DX Cluster" : kind === "world-map" ? "World Map" : "Band Maps"); }),
      onMonitorReady(() => { void publishMonitorProjection(latestMonitorProjection.current).catch(() => {}); }),
    ]).then(results => { for (const result of results) if (result.status === "fulfilled") { if (active) subscriptions.push(result.value); else result.value(); } });
    return () => { active = false; subscriptions.forEach(unlisten => unlisten()); };
  }, [request]);
  useEffect(() => {
    if (monitor || !cluster?.snapshot) return;
    const projection: ClusterProjection = { revision: ++clusterProjectionRevision.current, response: cluster, selected };
    latestClusterProjection.current = projection;
    void publishClusterProjection(projection).catch(() => {});
  }, [cluster, selected]);
  useEffect(() => {
    if (monitor) return;
    void publishDetachedProjection("world-map", latestProjection.current).catch(() => {});
  }, [cluster, stats, selected, mapTarget]);
  useEffect(() => {
    if (monitor) return;
    void publishDetachedProjection("band-maps", latestProjection.current).catch(() => {});
  }, [cluster, station?.radio?.frequency_hz, selected, workspacePreferences]);
  useEffect(() => {
    void publishMonitorProjection(latestMonitorProjection.current).catch(() => {});
  }, [station, rotorState, cluster, stats, selected, mapTarget, stationProvider, busy]);
  const mapSpots: Spot[] = useMemo(() => liveSpots.filter(s => typeof s.latitude === "number" && typeof s.longitude === "number").map(s => ({
    id: s.id, call: s.callsign, receivedAt: s.receivedAt, mhz: s.frequencyKHz / 1000, mode: s.mode, band: s.band,
    country: s.country, grid: "", lon: s.longitude, lat: s.latitude, reporter: s.spotter, note: s.comment,
    state: s.callStatus === "Confirmed" ? "confirmed" : s.callStatus === "Worked" ? "worked" : "needed",
    adif: s.adif, callStatus: s.callStatus, statusHex: s.statusHex, bandHex: s.bandHex,
  })), [liveSpots]);
  const map = <WorldMap data={mapSpots} selected={selected} palette={cluster?.configuration?.palette}
    home={stats?.map_home} dxccStatuses={stats?.dxcc_statuses}
    target={mapTarget}
    onSpot={spot => { const real = liveSpots.find(s => s.id === spot.id); if (real) selectSpot(real); }} />;
  const automaticStationMetadata: Array<{ label: string; value: string; provenance: "observed" | "configured" | "selected" }> = [];
  if (settings?.stationCall) automaticStationMetadata.push({ label: "Station call", value: settings.stationCall, provenance: "configured" });
  if (settings?.gridSquare) automaticStationMetadata.push({ label: "Station grid", value: settings.gridSquare, provenance: "configured" });
  if (station?.radio?.connected && station.radio.observed) {
    if (typeof station.radio.frequency_hz === "number" && Number.isFinite(station.radio.frequency_hz)) automaticStationMetadata.push({ label: "Radio frequency", value: `${frequency(station.radio.frequency_hz)} MHz`, provenance: "observed" });
    if (station.radio.mode) automaticStationMetadata.push({ label: "Radio mode", value: station.radio.mode, provenance: "observed" });
  }
  return <div className="app live">
    <header className="station-rail"><strong className="brand teal">OM0RX-xLog</strong><span className="cyan">{frequency(station?.radio?.frequency_hz)} MHz · {station?.radio?.mode || "Radio offline"}</span>
      <span className={station?.radio?.connected ? "teal" : "amber"}>{station?.radio?.connected ? "Connected" : "Disconnected"}</span>
      <span>{cluster?.snapshot?.connectedClusters || 0} clusters · {liveSpots.length} spots</span>
      <span className="rail-end">{stats?.stats?.qso_count?.toLocaleString() ?? "—"} contacts · Integrated logbook</span>
      <button onClick={() => void openMonitor().catch(e => setError(e.message))}><ExternalLink size={14} />Monitor</button>
    </header>
    <aside className="sidebar"><nav>{navigation.map(([name, Icon], i) => <div key={name}>{(i === 0 || name === "Station Control") && <div className="nav-group">{i === 0 ? "Station log" : "Services"}</div>}<button aria-current={view === name ? "page" : undefined} onClick={() => setView(name)}><Icon size={17} />{name}</button></div>)}</nav>
      <SidebarStation snapshot={stationWithRotor} provider={stationProvider} busy={busy} onAction={action => void run(async () => { await request("station_action", { action }); })} />
      <div className="sidebar-foot"><strong className="teal">{settings?.stationCall || "Station not configured"}</strong><span>{settings?.gridSquare || "Set station grid"}</span></div>
    </aside>
    <main><div className="workspace-heading"><h1>{view}</h1><span className="secondary">{workspace?.workspace_exists ? "Your isolated working logbook · manual sync" : workspace ? "Choose a logbook to begin" : workspacePending ? "Opening your workspace" : "Logbook service unavailable"}</span></div>
      {workspace?.workspace_exists && <Conditions propagation={propagation?.bands?.length ? propagation : station?.propagation || null} request={request} weatherKey={settings?.gridSquare || ""} />}
      {error && <div className="live-error" role="alert">{error}<button onClick={() => setError("")}>Dismiss</button></div>}
      {message && <p className="live-message" role="status">{message}</p>}
      {!workspace?.workspace_exists ? <WorkspaceGate workspace={workspace} pending={workspacePending} busy={busy}
        retry={() => void run(reload)} create={mode => void run(async () => { await request("workspace_create", { mode }); await reload(); })} /> : <>
      {view === "Operator Desk" && <><OperatorDesk draft={draft} setDraft={setDraft} save={save} clear={() => void run(clear)} busy={busy} lookup={lookup} previous={previous} request={request} refresh={refresh} onEditor={() => setView("Log QSO")} onReadRadio={readRadioIntoDraft} follow={follow} setFollow={setFollowImmediate} rotor={rotorState} autoRotor={autoRotor} setAutoRotor={changeAutoRotor} onManualRotor={disarmAutoRotor} isEditing={editing.current} intelligenceBands={workspacePreferences?.intelligenceBands} />
        <div className="live-desk-bottom"><div className="live-map">{map}</div><BandMaps spots={liveSpots} onSelect={selectSpot} radioFrequencyHz={station?.radio?.frequency_hz} compact preferences={workspacePreferences ? bandMapView(workspacePreferences, true) : undefined} onPreferencesChange={value => changeBandMapPreferences(true, value)} /></div></>}
      {view === "Log QSO" && <QSOEditor draft={draft} setDraft={setDraft} save={save} clear={() => void run(clear)} busy={busy} lookup={lookup} previous={previous} follow={follow} setFollow={setFollowImmediate} request={request} onReadRadio={readRadioIntoDraft} isEditing={editing.current} automaticStationMetadata={automaticStationMetadata} />}
      {view === "Logbook" && <LogbookPanel onRequest={request} refreshKey={refresh} onEdit={qso => { editing.current = true; setDraft(qso); setFollowImmediate(false); setView("Log QSO"); }} />}
      {view === "DX Cluster" && <ClusterPanel passive snapshot={cluster} selectedSpotId={selected} onRequest={request} onSelect={selectSpot} onUndock={() => void openDetachedCluster().catch(e => setError(e.message))} />}
      {view === "World Map" && <><div className="live-actions"><button type="button" onClick={() => void openDetachedMap("world-map").catch(e => setError(e.message))}><ExternalLink size={14} />Undock World Map</button></div><div className="live-map full">{map}</div></>}
      {view === "Band Maps" && <><div className="live-actions"><button type="button" onClick={() => void openDetachedMap("band-maps").catch(e => setError(e.message))}><ExternalLink size={14} />Undock Band Maps</button></div><BandMaps spots={liveSpots} onSelect={selectSpot} radioFrequencyHz={station?.radio?.frequency_hz} preferences={workspacePreferences ? bandMapView(workspacePreferences, false) : undefined} onPreferencesChange={value => changeBandMapPreferences(false, value)} /></>}
      {view === "Station Control" && <><div className="live-tabs" role="group" aria-label="Station sections">{["Control and connections", "RUMlog spots"].map(section => <button key={section} aria-pressed={stationSection === section} onClick={() => setStationSection(section)}>{section}</button>)}</div>
        {stationSection === "RUMlog spots" ? <SpotBridgePanel request={request} provider={stationProvider} /> : <><div className="live-station-provider" role="group" aria-label="Radio connection type">
        {([ ["direct_agent", "Remote station · embedded xCat"], ["direct_flex_lan", "Direct FLEX · LAN"], ["hamlib", "Local station · Hamlib"] ] as const).map(([id, label]) => <button key={id} className={stationProvider === id ? "selected" : ""} aria-pressed={stationProvider === id} disabled={busy} onClick={() => void changeProvider(id)}>{label}</button>)}
        <span>Switching radios disconnects the previous radio. Your independent rotor stays connected.</span></div>
        {stationProvider === "hamlib" ? <HamlibPanel request={request} snapshot={station} /> :
          stationProvider === "direct_flex_lan" ? <DirectFlexPanel request={request} snapshot={station} /> :
          <StationPanel snapshot={station} onRequest={request} onSnapshot={setStation} independentRotor />}<RotorPanel snapshot={rotorState} request={request} onManual={disarmAutoRotor} /></>}</>}
      {view === "Awards" && <IntegratedAwards request={request} refresh={refresh} />}
      {view === "Settings" && settings && <><SettingsPanel values={settings} request={request} onSaved={setSettings} /><DataManagementPanel onRequest={dataManagementRequest} onChanged={() => { setSettings(null); setDraft(null); setStats(null); latestWorkspacePreferences.current = null; setWorkspacePreferences(null); setRefresh(n => n + 1); }} /></>}
      {view === "Sync" && <SyncPanel request={request} onChanged={() => setRefresh(n => n + 1)} />}
      </>}
    </main></div>;
}

function DetachedMapSurface({ kind }: { kind: DetachedMapKind }) {
  const [projection, setProjection] = useState<DetachedMapProjection>({ spots: [] });
  const latestRevision = useRef(-1);
  const [error, setError] = useState("");
  const [receivedAt, setReceivedAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 1_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    let active = true; let unlisten: (() => void) | null = null;
    void onDetachedProjection(value => {
      if (active && value && Array.isArray(value.spots) && Number.isSafeInteger(value.revision) &&
        Number(value.revision) > latestRevision.current) {
        latestRevision.current = Number(value.revision); setProjection(value); setReceivedAt(Date.now());
      }
    }).then(stop => {
      if (!active) { stop(); return; }
      unlisten = stop;
      void announceDetachedReady(kind).catch(cause => setError(cause instanceof Error ? cause.message : "Map projection unavailable."));
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Map projection unavailable."); });
    return () => { active = false; unlisten?.(); };
  }, [kind]);
  const spots = projection.spots;
  const mapSpots: Spot[] = spots.filter(s => typeof s.latitude === "number" && typeof s.longitude === "number").map(s => ({
    id: s.id, call: s.callsign, receivedAt: s.receivedAt, mhz: s.frequencyKHz / 1000, mode: s.mode, band: s.band,
    country: s.country, grid: "", lon: s.longitude, lat: s.latitude, reporter: s.spotter, note: s.comment,
    state: s.callStatus === "Confirmed" ? "confirmed" : s.callStatus === "Worked" ? "worked" : "needed",
    adif: s.adif, callStatus: s.callStatus, statusHex: s.statusHex, bandHex: s.bandHex,
  }));
  const select = (spot: { id?: unknown }) => {
    if (typeof spot.id === "string") void requestDetachedSpot(kind, spot.id).catch(cause => setError(cause instanceof Error ? cause.message : "Spot selection could not reach the main window."));
  };
  return <div className="app live monitor-app" style={{ display: "flex", flexDirection: "column" }}>
    <header className="station-rail"><strong className="brand teal">OM0RX-xLog</strong><span className="cyan">{kind === "world-map" ? "World Map" : "Band Maps"}</span><span className="rail-end">{spots.length} live spots · selection handled by main window</span><button type="button" onClick={() => void dockDetachedWorkspace().catch(() => setError("Could not dock this window. Close it and reopen the workspace in the main app."))}>Dock back</button></header>
    <main style={{ flex: 1, minHeight: 0, padding: 14 }}>
      {error && <p className="live-error" role="alert">{error}</p>}
      {receivedAt === 0 ? <p className="secondary">Waiting for the main workspace projection…</p> : clock - receivedAt > 5_000 && <p className="live-cluster-note" role="status">Main workspace updates paused; map data below may be stale.</p>}
      {kind === "world-map" ? <div className="live-map full"><WorldMap data={mapSpots} selected={projection.selected ?? null}
        palette={projection.palette} home={projection.home} dxccStatuses={projection.dxccStatuses}
        target={projection.target}
        onSpot={select} /></div> : <BandMaps spots={spots} onSelect={select} radioFrequencyHz={projection.radioFrequencyHz} preferences={projection.bandMapPreferences} onPreferencesChange={value => void requestDetachedBandMapPreferences(value).catch(cause => setError(cause instanceof Error ? cause.message : "Band-map preferences could not reach the main window."))} />}
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
    void onMonitorProjection(value => { if (active) {
      setProjection(previous => {
        const prior = previous.station?.rotor_control, incoming = value.station?.rotor_control;
        return previous.station && value.station && validRotorSnapshot(prior) && validRotorSnapshot(incoming) && prior.generation > incoming.generation
          ? { ...value, station: { ...value.station, rotor_control: prior, rotor: previous.station.rotor } } : value;
      });
      setReceivedAt(Date.now()); setClock(Date.now());
    } }).then(stop => {
      if (!active) { stop(); return; }
      unlisten = stop;
      void announceMonitorReady().catch(cause => setError(cause instanceof Error ? cause.message : "Monitor state unavailable."));
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Monitor state unavailable."); });
    return () => { active = false; unlisten?.(); };
  }, []);
  const mapSpots: Spot[] = useMemo(() => projection.spots.filter(s => typeof s.latitude === "number" && typeof s.longitude === "number").map(s => ({
    id: s.id, call: s.callsign, receivedAt: s.receivedAt, mhz: s.frequencyKHz / 1000, mode: s.mode, band: s.band,
    country: s.country, grid: "", lon: s.longitude, lat: s.latitude, reporter: s.spotter, note: s.comment,
    state: s.callStatus === "Confirmed" ? "confirmed" : s.callStatus === "Worked" ? "worked" : "needed",
    adif: s.adif, callStatus: s.callStatus, statusHex: s.statusHex, bandHex: s.bandHex,
  })), [projection.spots]);
  const generatedAt = projection.station?.generated_at;
  const projectionStale = receivedAt === 0 || clock - receivedAt > 5_000;
  const stale = projectionStale ||
    (typeof generatedAt === "number" && Number.isFinite(generatedAt) &&
      (clock - generatedAt * 1_000 > 5_000 || generatedAt * 1_000 - clock > 5_000));
  const displayedStation = stale && projection.station ? { ...projection.station,
    radio: { ...projection.station.radio, observed: false },
    station: { ...projection.station.station, radio_stale: true },
    rotor: { ...projection.station.rotor, connected: projectionStale ? false : projection.station.rotor?.connected } } : projection.station;
  const monitorRotorRequest: Request = async (method, params = {}) => {
    if (projectionStale || !["rotor_goto", "rotor_stop"].includes(method)) throw new Error("Rotor monitor observation is stale or the command is unavailable.");
    const captured = projection.station?.rotor_control;
    const current = (await workerRequest("rotor_snapshot", {})).result;
    if (!validRotorSnapshot(captured) || !validRotorSnapshot(current) || !captured.owner ||
        captured.owner !== current.owner || method !== "rotor_stop" && captured.generation !== current.generation)
      throw new Error("Rotor connection changed. Wait for the next observation before sending another command.");
    if (method === "rotor_goto" && (!rotorProjection(current).connected || typeof params.bearing !== "number" ||
        !Number.isFinite(params.bearing) || params.bearing < 0 || params.bearing > 360)) throw new Error("An observed rotor and a bearing from 0° to 360° are required.");
    const adopt = (next: unknown, observed: boolean) => {
      if (!validRotorSnapshot(next)) return;
      setProjection(previous => {
        const prior = previous.station?.rotor_control;
        if (!previous.station || !validRotorSnapshot(prior) || next.generation < prior.generation || next.owner !== prior.owner) return previous;
        const state = observed ? next : { ...next, backend: prior.backend };
        return { ...previous, station: { ...previous.station, rotor_control: state, rotor: rotorProjection(state) } };
      });
    };
    try {
      const result = (await workerRequest(method, rotorCommandParams(current, method === "rotor_goto" ? { bearing: params.bearing, label: "Monitor bearing" } : {}))).result;
      adopt(result, false);
      return result;
    } finally {
      // A lost motion reply also advances ownership generation; do not retry it.
      try { adopt((await workerRequest("rotor_snapshot", {})).result, true); } catch { /* Main projection will restore authoritative state. */ }
    }
  };
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
    if (method === "station_action" && source === "direct_flex_lan") {
      const action = params.action;
      if ((action !== "tune" && action !== "cancel") ||
          !projection.station.capabilities?.supported_commands?.includes(action) ||
          (action === "tune" && projection.station.allow_transmit !== true))
        throw new Error("Direct FLEX action is unavailable or transmit was not enabled.");
      const result = (await workerRequest(method, { provider: source, action })).result as Data;
      if (result?.accepted !== true) throw new Error("Direct FLEX action was not accepted.");
      return result;
    }
    throw new Error("This monitor command is unavailable.");
  };
  const map = <WorldMap data={mapSpots} selected={projection.selected ?? null} palette={projection.palette}
    home={projection.home} dxccStatuses={projection.dxccStatuses} target={projection.target} compact />;
  return <>{error && <p className="live-error" role="alert">{error}</p>}
    {stale && <p className="live-error" role="status">Main station observation is stale. Reopen the main window before using monitor controls.</p>}
    <Monitor snapshot={displayedStation} map={map} onRequest={!stale && projection.controlsEnabled ? monitorRequest : undefined} onRotorRequest={!projectionStale && projection.station?.rotor_control?.owner ? monitorRotorRequest : undefined} /></>;
}

function SidebarStation({ snapshot, provider, busy, onAction }: { snapshot: Data | null; provider: StationProvider; busy: boolean; onAction: (action: string) => void }) {
  const s = snapshot?.station, local = provider === "hamlib", flex = provider === "direct_flex_lan";
  const detail = (text: string | undefined, prefix: string) => text?.split(/[|·]/).map(v => v.trim()).find(v => v.toUpperCase().startsWith(prefix + " "))?.slice(prefix.length).trim();
  const band = (text: string | undefined) => text?.split(/[|·]/).map(v => v.trim()).find(v => /^\d+(\.\d+)?[cm]+$/i.test(v));
  const antenna = s?.kat_detail_primary?.match(/\bANT\s*\d+\b/)?.[0];
  const action = s?.kpa_operate ? "standby" : "operate";
  const items = flex ? [["FREQUENCY", frequency(snapshot?.radio?.frequency_hz), "cyan"],
      ["MODE", snapshot?.radio?.mode || "—", "teal"],
      ["RX VFO", snapshot?.radio?.receive_vfo || "—", "cyan"],
      ["TX", snapshot?.radio?.transmitting === true ? "ACTIVE" : snapshot?.radio?.transmitting === false ? "IDLE" : "UNKNOWN", snapshot?.radio?.transmitting === true ? "orange" : "teal"]]
    : local ? [["FREQUENCY", frequency(snapshot?.radio?.frequency_hz), "cyan"], ["MODE", snapshot?.radio?.mode || "—", "teal"], ["ROTOR", snapshot?.rotor?.azimuth == null ? "—" : `${Math.round(snapshot.rotor.azimuth)}°`, "cyan"]]
    : [["OUTPUT", detail(s?.kpa_detail_primary, "OUT") || (s?.tx_power_watts == null ? "—" : `${s.tx_power_watts} W`), "orange"],
      [s?.swr_is_live ? "SWR LIVE" : "SWR LAST", s?.swr?.toFixed(2) || "—", "teal"], ["KPA BAND", band(s?.kpa_detail_primary) || s?.band || "—", "amber"],
      ["KPA TEMP", detail(s?.kpa_detail_secondary, "TEMP") || "—", "amber"], ["KAT BAND", band(s?.kat_detail_primary) || s?.band || "—", "cyan"], ["ANTENNA", antenna || "—", "cyan"]];
  return <section className="live-station-brief"><div className="nav-group">Station</div><strong className={local || flex ? "cyan" : "amber"}>{flex ? `DIRECT FLEX · ${snapshot?.radio?.connected ? "CONNECTED" : "OFFLINE"}` : local ? "LOCAL · HAMLIB" : `KPA500 · ${s?.kpa_operate == null ? "OFFLINE" : s.kpa_operate ? "OPERATE" : "STANDBY"}`}</strong>
    {!local && !flex && <button className={s?.kpa_operate ? "teal" : "orange"} disabled={busy || !s?.allowed_actions?.includes(action)} onClick={() => onAction(action)}>Switch to {action}</button>}
    <div className="sidebar-metrics">{items.map(([title, text, color]) => <div key={title} className={color}><small>{title}</small><b>{text}</b></div>)}</div></section>;
}
function SettingsPanel({ values, request, onSaved }: { values: Data; request: Request; onSaved: (value: Data) => void }) {
  return <ServiceSettings values={values} request={request} onSaved={onSaved} />;
}

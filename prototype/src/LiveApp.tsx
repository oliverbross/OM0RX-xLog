import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Radio, BookOpen, Network, Map as MapIcon, Settings, Activity, Award, LayoutDashboard, ExternalLink, RefreshCw } from "lucide-react";
import { workerRequest, openMonitor, openDetachedMap, detachedMapKind, findDetachedSpot,
  onDetachedSpot, onDetachedReady, onDetachedProjection, announceDetachedReady,
  publishDetachedProjection, requestDetachedSpot, onDetachedBandMapPreferences, requestDetachedBandMapPreferences,
  onMonitorProjection, onMonitorReady, announceMonitorReady, publishMonitorProjection,
  type DetachedMapKind, type DetachedMapProjection, type MonitorProjection, type StationProvider } from "./worker";
import WorldMap from "./Map";
import type { Spot } from "./model";
import { ClusterPanel } from "./live/ClusterPanel";
import { clusterSessionIntentKey, shouldResumeCluster } from "./live/clusterResume";
import OpportunitiesPanel, { type Opportunity } from "./live/OpportunitiesPanel";
import { useReferenceSchedule } from "./live/referenceSchedule";
import { DetachedClusterSurface } from "./live/DetachedClusterSurface";
import { openDetachedCluster, dockDetachedWorkspace, onDetachedDock,
  publishClusterSelection } from "./live/DetachedClusterBridge";
import { LogbookPanel } from "./live/LogbookPanel";
import { DetachedLogbookSurface } from "./live/DetachedLogbookSurface";
import { connectLogbookChanges, openDetachedLogbook } from "./live/logbookWindows";
import StationPanel from "./live/StationPanel";
import Conditions from "./live/Conditions";
import Monitor from "./live/Monitor";
import HamlibPanel from "./live/HamlibPanel";
import DirectFlexPanel from "./live/DirectFlexPanel";
import { hamlibStationRequest } from "./live/hamlibStation";
import BandMaps, { bandForRadio } from "./live/BandMaps";
import { bandMapView, migrateLegacyBandMaps, validBandMapView, withBandMapView } from "./live/workspacePreferences";
import type { WorkspacePreferences } from "./live/workspacePreferences";
import type { BandMapViewPreferences } from "./live/BandMaps";
import { mergeBandMapPreferenceIntent, sameBandMapPreferences } from "./live/detachedBandMapPreferences";
import IntegratedAwards from "./live/AwardsPanel";
import QSOEditor from "./live/QSOEditor";
import OperatorDesk from "./live/OperatorDesk";
import CWDesk from "./live/CWDesk";
import { defaultCWProfile } from "./live/cwMacros";
import { useCW } from "./live/useCW";
import { OperatorWorkspace } from "./live/OperatorWorkspace";
import SyncPanel from "./live/SyncPanel";
import ServiceSettings from "./live/ServiceSettings";
import WorkspaceGate from "./live/WorkspaceGate";
import SpotBridgePanel from "./live/SpotBridgePanel";
import { logMode } from "./live/draftRadio";
import { changedCallDraft, enrichedDraft, normalizedCall } from "./live/draftEnrichment";
import { OperatorDraftSession, readDraftJournal, type DraftQSO } from "./live/operatorDraftSession";
import { requestOperatorDraft } from "./live/operatorDraftTransport";
import { OperatorDraftStatus } from "./live/OperatorDraftStatus";
import { LogbookContactSession, readContactJournal } from "./live/logbookContactSession";
import { LogbookMutationSession, readLogbookMutationJournal } from "./live/logbookMutationSession";
import { LogbookMutationStatus } from "./live/LogbookMutationStatus";
import { requestLogbookContact } from "./live/logbookContactTransport";
import { ContactEditStatus } from "./live/ContactEditStatus";
import { connectWorkspaceNavigation, workspaceScreens } from "./live/workspaceNavigation";
import { retireStationProvider } from "./live/stationHandover";
import RotorPanel from "./live/RotorPanel";
import { connectRotorTelemetry } from "./live/rotorTelemetry";
import { clearConnectedHandoverMessage, ownAutomaticRotorMotion, rotorCommandParams, rotorIntentCurrent, rotorProjection, validRotorSnapshot, type AutomaticRotorIntent, type RotorSnapshot } from "./live/rotorControl";
import "./live/live.css";
import appLogo from "../src-tauri/icons/64x64.png";

type Data = Record<string, any>;
type Request = (method: string, params?: Data) => Promise<any>;
const screenIcons: Record<string, typeof Radio> = {
  "operator-desk": LayoutDashboard, "log-qso": Radio, logbook: BookOpen, "dx-cluster": Network,
  "world-map": MapIcon, "band-maps": Activity, "chaser-dx": Activity, awards: Award,
  "station-control": Radio, sync: RefreshCw, settings: Settings,
};
const navigation = workspaceScreens.map(screen => [screen.title, screenIcons[screen.id]] as const);
const monitor = new URLSearchParams(location.search).get("view") === "monitor";
const detached = detachedMapKind(new URLSearchParams(location.search).get("view"));
const detachedCluster = new URLSearchParams(location.search).get("view") === "dx-cluster";
const detachedLogbook = new URLSearchParams(location.search).get("view") === "logbook";
const frequency = (hz?: number) => typeof hz === "number" && Number.isFinite(hz) ? (hz / 1e6).toFixed(6) : "—";
const emptySpots: Data[] = [];
const radioProviderLabels: Record<StationProvider, string> = {
  direct_agent: "Remote station · embedded xCat",
  direct_flex_lan: "Direct FLEX · LAN",
  hamlib: "Local station · Hamlib",
};
const draftJournalKey = "xlog.integration.operatorDraft.main.v1";
const contactJournalKey = "xlog.integration.contactEdit.main.v1";
const logbookMutationJournalKey = "xlog.integration.logbookMutation.main.v1";
function storedDraftValue(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function legacyDraftValue(): Data | null {
  try { const value = JSON.parse(storedDraftValue("xlog.integration.draft") || "null");
    return value?.id && value?.start && value?.call ? value : null;
  } catch { return null; }
}

export default function LiveApp() {
  if (detachedLogbook) return <DetachedLogbookSurface />;
  if (detachedCluster) return <DetachedClusterSurface />;
  if (detached) return <DetachedMapSurface kind={detached} />;
  if (monitor) return <MonitorSurface />;
  return <MainLiveApp />;
}

function MainLiveApp() {
  const [view, setView] = useState<string>("Operator Desk");
  const [awardsOpened, setAwardsOpened] = useState(false);
  useEffect(() => { if (view === "Awards") setAwardsOpened(true); }, [view]);
  const [workspace, setWorkspace] = useState<Data | null>(null);
  const [workspacePending, setWorkspacePending] = useState(true);
  const [settings, setSettings] = useState<Data | null>(null);
  const [workspacePreferences, setWorkspacePreferences] = useState<WorkspacePreferences | null>(null);
  const latestWorkspacePreferences = useRef<WorkspacePreferences | null>(null);
  const preferenceWrite = useRef<Promise<unknown>>(Promise.resolve());
  const preferenceRevision = useRef(0);
  const reloadRevision = useRef(0);
  const [draftSession] = useState(() => new OperatorDraftSession(requestOperatorDraft,
    journal => localStorage.setItem(draftJournalKey, JSON.stringify(journal)), readDraftJournal(storedDraftValue(draftJournalKey))));
  const sharedDraft = useSyncExternalStore(draftSession.subscribe, draftSession.getSnapshot);
  const [contactSession] = useState(() => new LogbookContactSession(requestLogbookContact,
    journal => journal ? localStorage.setItem(contactJournalKey, JSON.stringify(journal)) : localStorage.removeItem(contactJournalKey),
    readContactJournal(storedDraftValue(contactJournalKey))));
  const contactEdit = useSyncExternalStore(contactSession.subscribe, contactSession.getSnapshot);
  const [logbookMutations] = useState(() => new LogbookMutationSession(requestLogbookContact,
    journal => localStorage.setItem(logbookMutationJournalKey, JSON.stringify(journal)),
    readLogbookMutationJournal(storedDraftValue(logbookMutationJournalKey))));
  const logbookMutation = useSyncExternalStore(logbookMutations.subscribe, logbookMutations.getSnapshot);
  const editing = useRef(false);
  editing.current = !!contactEdit.draft;
  const [legacyDraft, setLegacyDraft] = useState(legacyDraftValue);
  const draft = contactEdit.draft ?? sharedDraft.draft;
  const editorLocked = sharedDraft.locked || contactEdit.locked || sharedDraft.workspaceChanged || contactEdit.workspaceChanged;
  const editorBlocked = editorLocked || !!sharedDraft.conflict || contactEdit.conflict;
  const setDraft = useCallback((next: Data | null | ((current: Data | null) => Data | null)) => {
    if (draftSession.getSnapshot().locked || draftSession.getSnapshot().workspaceChanged || contactSession.getSnapshot().locked || contactSession.getSnapshot().workspaceChanged) return;
    const contact = contactSession.getSnapshot().draft;
    const current = contact ?? draftSession.getSnapshot().draft;
    const value = changedCallDraft(current, typeof next === "function" ? next(current) : next);
    if (contact && value) contactSession.edit(value as DraftQSO);
    else if (value) draftSession.edit(value as DraftQSO);
    else draftSession.reset();
  }, [draftSession, contactSession]);
  const referenceEdits = useRef<Record<string, number>>({});
  const setOperatorDraft = useCallback((next: Data | null | ((current: Data | null) => Data | null)) => {
    setDraft(current => {
      const value = typeof next === "function" ? next(current) : next;
      for (const key of ["potaReference", "sotaReference", "iota", "wwffReference", "sig", "sigInfo"])
        if (current?.[key] !== value?.[key]) referenceEdits.current[key] = (referenceEdits.current[key] ?? 0) + 1;
      return value;
    });
  }, [setDraft]);
  const draftIdentity = useRef(draft?.id); draftIdentity.current = draft?.id;
  const draftCall = useRef(normalizedCall(draft?.call)); draftCall.current = normalizedCall(draft?.call);
  const [station, setStation] = useState<Data | null>(null);
  const [cluster, setCluster] = useState<Data | null>(null);
  const [stats, setStats] = useState<Data | null>(null);
  const [propagation, setPropagation] = useState<Data | null>(null);
  const [lookup, setLookup] = useState<Data | null>(null);
  const [previous, setPrevious] = useState<Data[]>([]);
  const [referenceEvidence, setReferenceEvidence] = useState<{ call: string; rows: Data[] } | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const menuSettings = useRef(settings); menuSettings.current = settings;
  useEffect(() => connectWorkspaceNavigation(title => {
    if (title === "Sync" && menuSettings.current?.logbookMode === "local") {
      setView("Settings");
      setError("Wavelog sync is disabled in standalone mode. Choose Local logbook + Wavelog sync in Settings to enable it.");
    } else setView(title);
  }, setError), []);
  useEffect(() => {
    if (view === "Sync" && settings?.logbookMode === "local") {
      setView("Settings");
      setError("Wavelog sync is disabled in standalone mode. Choose Local logbook + Wavelog sync in Settings to enable it.");
    }
  }, [view, settings?.logbookMode]);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => connectLogbookChanges(() => setRefresh(value => value + 1), setError), []);
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
  const automaticTarget = useRef("");
  const rotorPolling = useRef(false);
  const disarmAutoRotor = useCallback(() => { autoEpoch.current++; automaticMotion.current = null; autoEnabled.current = false; setAutoRotor(false); }, []);
  const changeAutoRotor = (enabled: boolean) => { autoEpoch.current++; automaticMotion.current = null; autoEnabled.current = enabled; setAutoRotor(enabled); };
  const savedProvider = localStorage.getItem("xlog.integration.provider");
  const provider = useRef<StationProvider>(savedProvider === "hamlib" || savedProvider === "direct_flex_lan" ? savedProvider : "direct_agent");
  const [stationProvider, setStationProvider] = useState(provider.current);
  const [viewProvider, setViewProvider] = useState(provider.current);
  const [stationSection, setStationSection] = useState("Control and connections");
  const pendingTune = useRef(false);
  const spotRotorFence = useRef<{ call: string; confirmed: boolean } | null>(null);
  const providerTransition = useRef(false);
  const selection = useRef(0);
  const stationPolling = useRef(false);
  const clusterPolling = useRef(false);
  const clusterResumeChecked = useRef(false);
  const clusterMutationEpoch = useRef(0);
  const latestSpots = useRef<Data[]>([]);
  const selectCurrentSpot = useRef<(spot: Data) => void>(() => {});
  const latestProjection = useRef<DetachedMapProjection>({ spots: [] });
  const mapProjectionRevision = useRef(0);
  const latestMonitorProjection = useRef<MonitorProjection>({ spots: [], station: null, provider: "direct_agent", controlsEnabled: false });
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === "xlog.integration.provider" && event.newValue !== provider.current)
        setError("Radio selection changed in another window. This window retains its active radio until you apply a selection here.");
    };
    window.addEventListener("storage", changed); return () => window.removeEventListener("storage", changed);
  }, []);
  const request: Request = useCallback(async (method, params = {}) => {
    try {
      if (method === "cluster_connect" || method === "cluster_disconnect") {
        clusterResumeChecked.current = true;
        try { localStorage.setItem(clusterSessionIntentKey, method === "cluster_connect" ? "connected" : "disconnected"); }
        catch { /* Storage failure must not prevent an explicit Disconnect. */ }
      }
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
  useReferenceSchedule(workspace?.workspace_exists === true, request);
  const cwProfile = settings?.cwProfile ?? defaultCWProfile;
  const cwContext = { MYCALL: settings?.stationCall || settings?.operatorCall || "", CALL: draft?.call || "", RST: draft?.rstSent || "", NAME: draft?.name || "", GRID: settings?.gridSquare || "", SERIAL: String(draft?.extraFields?.STX ?? "") };
  const cw = useCW(request, cwProfile, stationProvider, cwContext, `${view}:${draft?.id}:${draft?.call}:${draft?.frequencyHz}:${draft?.mode}`);
  const cwControls = cwProfile.showOnDesk || cwProfile.macros.some((macro: Data) => macro.enabled && macro.shortcut) || cw.state.armed || cw.state.owner
    ? <CWDesk profile={cwProfile} context={cwContext} controller={cw.controller} state={cw.state} radioProvider={stationProvider} /> : undefined;
  const loadOpportunity = (item: Opportunity) => {
    if (draftSession.getSnapshot().locked || draftSession.getSnapshot().workspaceChanged || draftSession.getSnapshot().conflict || contactSession.getSnapshot().locked || contactSession.getSnapshot().workspaceChanged) { setError("Resolve the current QSO draft operation before loading another contact."); return; }
    if (editing.current) { setError("Finish or clear the contact being edited before loading a new contact."); setView("Log QSO"); return; }
    selection.current++; pendingTune.current = false; disarmAutoRotor();
    spotRotorFence.current = { call: normalizedCall(item.callsign), confirmed: false };
    editing.current = false; setFollowImmediate(false); setSelected(null);
    setOperatorDraft(current => current ? { ...current, call: item.callsign,
      frequencyHz: item.frequency_hz ?? null, band: item.frequency_hz ? bandForRadio(item.frequency_hz) || current.band : current.band,
      mode: item.mode ? logMode(item.mode, current.mode || "") : current.mode, comment: item.comment,
      potaReference: item.kind === "pota" ? item.reference : "", sotaReference: item.kind === "sota" ? item.reference : "",
      iota: item.kind === "iota" || item.reference_kind === "iota" ? item.reference : "", wwffReference: item.kind === "wwff" ? item.reference : "",
      sig: ["castle", "wwbota"].includes(item.kind) ? item.kind.toUpperCase() : "",
      sigInfo: ["castle", "wwbota"].includes(item.kind) ? item.reference : "" } : current);
    setView("Log QSO"); setMessage("Chaser selection loaded into the draft only. Radio follow and Auto rotor are off; no station command was sent.");
  };
  const viewedStationRequest: Request = useCallback(async (method, params = {}) => {
    if (viewProvider === stationProvider) return request(method, params);
    if (method === "station_snapshot") return { source: viewProvider, available: false, radio: null };
    if (method === "hamlib_status") return { connected: false, state: "Preview only. Apply radio selection to use this radio.", reconnect_required: false };
    if (["hamlib_models", "hamlib_serial_ports", "hamlib_capabilities"].includes(method))
      return request(method, params);
    throw new Error("Apply this radio selection before connecting or sending controls. The active radio has not changed.");
  }, [request, stationProvider, viewProvider]);
  const readRadioIntoDraft = useCallback(async () => {
    if (draftSession.getSnapshot().workspaceChanged || contactSession.getSnapshot().workspaceChanged)
      throw new Error("Review the current workspace before reading into this QSO.");
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
  const applyProvider = async () => {
    const next = viewProvider;
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
    const revision = ++reloadRevision.current;
    setWorkspacePending(true);
    try {
    const state = await request("workspace_status");
    if (state.workspace_exists) {
      await preferenceWrite.current.catch(() => {});
      const [s, , loaded] = await Promise.all([request("settings_load"), draftSession.load(), request("workspace_preferences_load")]);
      if (revision !== reloadRevision.current) return;
      const prior = loaded.preferences as WorkspacePreferences;
      const migrated = loaded.stored ? null : migrateLegacyBandMaps(prior, localStorage);
      const preferences = migrated ? (await request("workspace_preferences_save", { preferences: migrated })).preferences as WorkspacePreferences : prior;
      latestWorkspacePreferences.current = preferences;
      setWorkspacePreferences(preferences);
      setSettings(s.settings);
    }
    if (revision !== reloadRevision.current) return;
    setWorkspace(state);
    // Contact receipt availability must not hide its own recovery controls.
    if (state.workspace_exists) void contactSession.refresh().catch(cause => {
      if (revision === reloadRevision.current) setError(cause instanceof Error ? cause.message : "Contact updates unavailable.");
    });
    if (state.workspace_exists) void request("logbook_stats").then(totals => {
      if (revision === reloadRevision.current) setStats(totals);
    }).catch(() => { if (revision === reloadRevision.current) setError("Logbook totals could not be loaded. Your draft is available; reopen the workspace to retry."); });
    } finally { if (revision === reloadRevision.current) setWorkspacePending(false); }
  }, [request, draftSession, contactSession]);
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
    if (method === "backup_restore") {
      if (logbookMutations.getSnapshot().busy || logbookMutations.getSnapshot().pending) throw new Error("Resolve the pending logbook Delete/Undo before restoring a backup.");
      if (contactSession.getSnapshot().draft || contactSession.getSnapshot().locked) throw new Error("Finish or clear the logged contact edit before restoring a backup.");
      return draftSession.withWorkspaceRestore(() => request(method, params));
    }
    if (method === "backup_create") await draftSession.flush();
    return request(method, params);
  }, [request, draftSession, contactSession, logbookMutations]);
  useEffect(() => { if (!monitor) void reload().catch(e => setError(e.message)); }, [reload, refresh]);
  useEffect(() => {
    if (monitor) return;
    let active = true;
    const update = () => void request("propagation_snapshot").then(value => { if (active) setPropagation(value); }).catch(() => {});
    update(); const timer = setInterval(update, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [request]);
  useEffect(() => {
    if (!workspace?.workspace_exists || sharedDraft.workspaceChanged || sharedDraft.locked || sharedDraft.pending || sharedDraft.conflict || !draftSession.dirty) return;
    const timer = setTimeout(() => { void draftSession.flush().catch(cause => setError(cause instanceof Error ? cause.message : "Draft could not be saved.")); }, 350);
    return () => clearTimeout(timer);
  }, [workspace?.workspace_exists, sharedDraft, draftSession]);
  useEffect(() => {
    if (!workspace?.workspace_exists) return;
    let active = true;
    const timer = setInterval(() => { void draftSession.refresh().catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : "Shared draft updates unavailable.");
    }); }, 1500);
    return () => { active = false; clearInterval(timer); };
  }, [workspace?.workspace_exists, draftSession]);
  useEffect(() => {
    if (!workspace?.workspace_exists || !contactEdit.base) return;
    let active = true;
    const timer = setInterval(() => { void contactSession.refresh().catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : "Contact updates unavailable.");
    }); }, 1500);
    return () => { active = false; clearInterval(timer); };
  }, [workspace?.workspace_exists, contactEdit.base?.qso.id, contactSession]);
  useEffect(() => {
    if (contactEdit.base) { setFollowImmediate(false); disarmAutoRotor(); selection.current++; pendingTune.current = false; }
  }, [contactEdit.base?.qso.id, disarmAutoRotor]);
  useEffect(() => {
    if (sharedDraft.workspaceChanged || sharedDraft.conflict || sharedDraft.error && (sharedDraft.pending?.action === "save" || sharedDraft.pending?.action === "clear")) {
      setFollowImmediate(false); disarmAutoRotor(); selection.current++; pendingTune.current = false;
    }
  }, [sharedDraft.workspaceChanged, sharedDraft.conflict, sharedDraft.pending?.operationID, sharedDraft.error, disarmAutoRotor]);
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
      try {
        if (!disposed) {
          const state = await request("cluster_snapshot");
          if (!disposed && !monitor && !clusterResumeChecked.current && state.configuration) {
            clusterResumeChecked.current = true;
            const active = state.snapshot?.connections?.some((connection: Data) => connection.phase === "connected" || connection.phase === "connecting");
            if (!active && shouldResumeCluster(localStorage.getItem(clusterSessionIntentKey), state.configuration)) {
              try { await request("cluster_connect"); }
              catch { if (!disposed) setError("Cluster could not resume. Open DX Cluster to inspect its connection and retry Connect."); }
            }
          }
        }
      }
      catch { /* Keep the last verified cluster projection until reconnect. */ }
      finally { clusterPolling.current = false; }
    };
    void pollCluster(); const timer = setInterval(() => void pollCluster(), 1000);
    return () => { disposed = true; clearInterval(timer); };
  }, [request]);
  useEffect(() => {
    let disposed = false;
    const unavailable = () => {
      if (disposed) return;
      disarmAutoRotor();
      const previous = rotorRef.current;
      if (previous) { const next = { ...previous, backend_available: false }; rotorRef.current = next; setRotorState(next); }
    };
    const stopTelemetry = connectRotorTelemetry(result => {
      if (disposed || rotorRef.current && result.generation < rotorRef.current.generation) return;
      const previous = rotorRef.current;
      const ownMotion = ownAutomaticRotorMotion(automaticMotion.current, result, autoEpoch.current, autoEnabled.current);
      if (previous && (previous.owner !== result.owner || previous.generation !== result.generation) && !ownMotion) disarmAutoRotor();
      if (result.state !== "active" && result.owner || result.backend_available === false ||
          previous && rotorProjection(previous).connected && !rotorProjection(result).connected) disarmAutoRotor();
      rotorRef.current = result; setRotorState(result);
    }, unavailable);
    if (stopTelemetry) return () => { disposed = true; stopTelemetry(); };
    // Browser fixtures have no native owner; keep their injected read-only path.
    const pollRotor = async () => {
      if (rotorPolling.current) return;
      rotorPolling.current = true;
      try { if (!disposed) await request("rotor_snapshot"); }
      catch { unavailable(); } finally { rotorPolling.current = false; }
    };
    void pollRotor(); const timer = setInterval(() => void pollRotor(), 1000);
    return () => { disposed = true; clearInterval(timer); };
  }, [request, disarmAutoRotor]);
  useEffect(() => {
    const call = normalizedCall(draft?.call); let disposed = false;
    const baseline = draft;
    setLookup(null); setPrevious([]);
    if (!call || !workspace?.workspace_exists) { setLookup(null); setPrevious([]); return; }
    const timer = setTimeout(() => {
      // A large history query must not hold QRZ details hostage.
      void request("lookup_call", { call })
        .then(info => { if (!disposed) { setLookup(info); if (baseline && !editing.current) setDraft(current => enrichedDraft(current, baseline, info)); } })
        .catch(e => { if (!disposed) setLookup({ call, source: e.message }); });
      void request("logbook_previous", { call, limit: 10 })
        .then(history => { if (!disposed) setPrevious(history.qsos); }).catch(() => { if (!disposed) setPrevious([]); });
    }, 400);
    return () => { disposed = true; clearTimeout(timer); };
  }, [draft?.call, request, workspace?.workspace_exists]);
  useEffect(() => {
    const call = normalizedCall(draft?.call);
    if (sharedDraft.workspaceChanged || contactEdit.workspaceChanged || !autoRotor || !autoEnabled.current || pendingTune.current || editing.current || !call || normalizedCall(lookup?.call) !== call) return;
    if (spotRotorFence.current?.call === call && !spotRotorFence.current.confirmed) return;
    const rotor = rotorRef.current;
    const key = `${autoEpoch.current}:${draft?.id}:${call}`;
    if (automaticTarget.current === key || !rotor?.owner || !rotorProjection(rotor).connected ||
        typeof lookup?.bearing !== "number" || !Number.isFinite(lookup.bearing) || lookup.bearing < 0 || lookup.bearing > 360) return;
    automaticTarget.current = key;
    const id = crypto.randomUUID();
    const intent = { owner: rotor.owner, generation: rotor.generation };
    automaticMotion.current = { ...intent, epoch: autoEpoch.current, id };
    void request("rotor_goto", { ...intent, bearing: lookup.bearing, label: call, intent_id: id })
      .catch(cause => setError(cause instanceof Error ? cause.message : "Automatic rotor turn failed."));
  }, [sharedDraft.workspaceChanged, contactEdit.workspaceChanged, autoRotor, draft?.id, draft?.call, lookup, request]);
  const clear = async () => {
    if (contactSession.getSnapshot().draft) contactSession.cancel();
    else await draftSession.commit("clear");
    setSelected(null);
  };
  const save = () => run(async () => {
    if (!draft) return;
    const saved = contactSession.getSnapshot().draft ? await contactSession.save() : await draftSession.commit("save");
    if (saved) setMessage(`${saved.call} saved to the integrated logbook. Original logbook unchanged.`);
    setSelected(null); setRefresh(n => n + 1);
  });
  const selectSpot = (spot: Data) => {
    if (monitor) return;
    if (draftSession.getSnapshot().locked || draftSession.getSnapshot().workspaceChanged || draftSession.getSnapshot().conflict || contactSession.getSnapshot().locked || contactSession.getSnapshot().workspaceChanged) { setError("Resolve the current QSO draft operation before selecting another spot."); return; }
    if (editing.current) { setError("Finish or clear the contact being edited before selecting a new spot."); setView("Log QSO"); return; }
    const generation = ++selection.current; const hz = Math.round(spot.frequencyKHz * 1000);
    const selectedProvider = provider.current;
    const rotorIntent = rotorRef.current?.owner && rotorProjection(rotorRef.current).connected ?
      { owner: rotorRef.current.owner, generation: rotorRef.current.generation } : null;
    const automaticEpoch = autoEpoch.current;
    const automaticRequested = autoEnabled.current;
    spotRotorFence.current = { call: normalizedCall(spot.callsign), confirmed: false };
    pendingTune.current = true; editing.current = false; setSelected(spot.id); setReferenceEvidence(null);
    setDraft(d => d ? { ...changedCallDraft(d, { ...d, call: spot.callsign }), call: spot.callsign, frequencyHz: hz, band: spot.band, mode: spot.mode,
      country: spot.country || "", dxcc: spot.adif ?? null, comment: String(spot.comment || ""),
      potaReference: "", sotaReference: "", iota: "", wwffReference: "", sig: "", sigInfo: "" } : d);
    const identity = draftIdentity.current;
    const referenceBaseline = { ...referenceEdits.current };
    void request("reference_resolve", { comment: String(spot.comment || ""), special_tags: Array.isArray(spot.specialTags) ? spot.specialTags : [] })
      .then(result => {
        if (selection.current !== generation || draftIdentity.current !== identity || draftCall.current !== normalizedCall(spot.callsign)) return;
        setReferenceEvidence({ call: normalizedCall(spot.callsign), rows: result.references || [] });
        setDraft(current => {
          if (!current || current.id !== identity || normalizedCall(current.call) !== normalizedCall(spot.callsign)) return current;
          const next = { ...current };
          for (const key of ["potaReference", "sotaReference", "iota", "wwffReference", "sig", "sigInfo"])
            if (!next[key] && (referenceEdits.current[key] ?? 0) === (referenceBaseline[key] ?? 0) && typeof result.fields?.[key] === "string") next[key] = result.fields[key];
          return next;
        });
      }).catch(() => { if (selection.current === generation) setError("Spot reference lookup failed. The original spot comment is preserved; check Reference data in Settings."); });
    setMessage(`Tuning ${spot.callsign} · waiting for observed radio state`); setError("");
    void request("station_tune", { frequency_hz: hz, mode: String(spot.mode || "").toUpperCase() }).then(async result => {
      if (selection.current !== generation || provider.current !== selectedProvider) return;
      spotRotorFence.current = { call: normalizedCall(spot.callsign), confirmed: result.confirmed === true };
      setMessage(result.confirmed ? `${spot.callsign} · radio frequency and mode confirmed` : `${spot.callsign} · request accepted; awaiting observation`);
      if (automaticRequested && rotorIntent && autoEnabled.current && autoEpoch.current === automaticEpoch && result.confirmed) {
        const target = await request("lookup_call", { call: spot.callsign });
        if (selection.current === generation && provider.current === selectedProvider && draftCall.current === normalizedCall(spot.callsign) && autoEnabled.current && autoEpoch.current === automaticEpoch &&
            rotorIntentCurrent(rotorIntent, rotorRef.current) && String(target.call).trim().toUpperCase() === String(spot.callsign).trim().toUpperCase() &&
            typeof target.bearing === "number" && Number.isFinite(target.bearing) && target.bearing >= 0 && target.bearing <= 360) {
          const id = crypto.randomUUID();
          automaticTarget.current = `${automaticEpoch}:${draftIdentity.current}:${normalizedCall(spot.callsign)}`;
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
      ? { call: draft.call, lat: lookup.latitude, lon: lookup.longitude, country: lookup.country, locationSource: lookup.location_source || lookup.source } : undefined,
    [draft?.call, lookup?.call, lookup?.latitude, lookup?.longitude, lookup?.country, lookup?.location_source, lookup?.source]);
  latestSpots.current = liveSpots;
  selectCurrentSpot.current = selectSpot;
  latestProjection.current = { revision: ++mapProjectionRevision.current, spots: liveSpots, palette: cluster?.configuration?.palette,
    home: stats?.map_home, dxccStatuses: stats?.dxcc_statuses,
    radioFrequencyHz: station?.radio?.observed && station?.radio?.connected ? station.radio.frequency_hz : undefined, selected, target: mapTarget,
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
      onDetachedDock(kind => { setView(kind === "dx-cluster" ? "DX Cluster" : kind === "world-map" ? "World Map" : "Band Maps"); }),
      onMonitorReady(() => { void publishMonitorProjection(latestMonitorProjection.current).catch(() => {}); }),
    ]).then(results => { for (const result of results) if (result.status === "fulfilled") { if (active) subscriptions.push(result.value); else result.value(); } });
    return () => { active = false; subscriptions.forEach(unlisten => unlisten()); };
  }, [request]);
  useEffect(() => {
    if (!monitor) void publishClusterSelection(selected).catch(() => {});
  }, [selected]);
  useEffect(() => {
    if (monitor) return;
    void publishDetachedProjection("world-map", latestProjection.current).catch(() => {});
  }, [cluster, stats, selected, mapTarget, station?.radio?.frequency_hz, station?.radio?.observed, station?.radio?.connected]);
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
    target={mapTarget} frequencyHz={station?.radio?.observed && station?.radio?.connected ? station.radio.frequency_hz : undefined}
    onSpot={spot => { const real = liveSpots.find(s => s.id === spot.id); if (real) selectSpot(real); }} />;
  const automaticStationMetadata: Array<{ label: string; value: string; provenance: "observed" | "configured" | "selected" }> = [];
  if (settings?.stationCall) automaticStationMetadata.push({ label: "Station call", value: settings.stationCall, provenance: "configured" });
  if (settings?.gridSquare) automaticStationMetadata.push({ label: "Station grid", value: settings.gridSquare, provenance: "configured" });
  if (station?.radio?.connected && station.radio.observed) {
    if (typeof station.radio.frequency_hz === "number" && Number.isFinite(station.radio.frequency_hz)) automaticStationMetadata.push({ label: "Radio frequency", value: `${frequency(station.radio.frequency_hz)} MHz`, provenance: "observed" });
    if (station.radio.mode) automaticStationMetadata.push({ label: "Radio mode", value: station.radio.mode, provenance: "observed" });
  }
  return <div className="app live">
    <header className="station-rail main-station-rail"><strong className="brand teal"><img src={appLogo} alt="" width={32} height={32} />OM0RX-xLog</strong><strong className="cyan rail-frequency">{frequency(station?.radio?.frequency_hz)} MHz · {station?.radio?.mode || "Radio offline"}</strong>
      <span className={station?.radio?.connected ? "teal" : "amber"}>{station?.radio?.connected ? "Connected" : "Disconnected"}</span>
      <span className="rail-cluster-count">{cluster?.snapshot?.connectedClusters || 0} clusters · {liveSpots.length} spots</span>
      {workspace?.workspace_exists && <Conditions compact propagation={propagation?.bands?.length ? propagation : station?.propagation || null} request={request} weatherKey={settings?.gridSquare || ""} />}
      <span className="rail-end">{stats?.stats?.qso_count?.toLocaleString() ?? "—"} contacts · Integrated logbook</span>
    </header>
    <aside className="sidebar"><nav>{navigation.filter(([name]) => name !== "Sync" || settings?.logbookMode !== "local").map(([name, Icon], i) => <div key={name}>{(i === 0 || name === "Station Control") && <div className="nav-group">{i === 0 ? "Station log" : "Services"}</div>}<button aria-current={view === name ? "page" : undefined} onClick={() => setView(name)}><Icon size={17} />{name}</button></div>)}</nav>
      <SidebarStation snapshot={stationWithRotor} provider={stationProvider} busy={busy} onAction={action => void run(async () => { await request("station_action", { action }); })} />
      <div className="sidebar-foot"><button onClick={() => void openMonitor().catch(e => setError(e.message))}><ExternalLink size={16} />Monitor</button><strong className="teal">{settings?.stationCall || "Station not configured"}</strong><span>{settings?.gridSquare || "Set station grid"}</span></div>
    </aside>
    <main aria-label={view}>
      {error && <div className="live-error" role="alert">{error}<button onClick={() => setError("")}>Dismiss</button></div>}
      {workspace?.workspace_exists && <OperatorDraftStatus state={sharedDraft} session={draftSession} run={operation => run(async () => { await operation(); setRefresh(n => n + 1); })} />}
      {workspace?.workspace_exists && <ContactEditStatus state={contactEdit} session={contactSession} run={operation => run(async () => { await operation(); setRefresh(n => n + 1); })} />}
      {workspace?.workspace_exists && <LogbookMutationStatus state={logbookMutation} session={logbookMutations} run={operation => run(async () => { await operation(); setRefresh(n => n + 1); })} />}
      {workspace?.workspace_exists && legacyDraft && <div className="live-message" role="status">
        Previous local draft: {legacyDraft.call}. Recovering copies its text into a new QSO; it does not log a contact.
        <button type="button" disabled={sharedDraft.locked || !!sharedDraft.conflict || !!sharedDraft.draft?.call || editing.current} onClick={() => void run(async () => {
          const current = draftSession.getSnapshot().draft;
          if (!current || current.call) throw new Error("Use a blank shared draft before recovering old text.");
          setFollowImmediate(false); disarmAutoRotor();
          draftSession.edit({ ...legacyDraft, id: current.id, wavelogID: null, deletedAt: null } as DraftQSO);
          await draftSession.flush(); localStorage.removeItem("xlog.integration.draft"); setLegacyDraft(null);
        })}>Recover old text as new draft</button>
        <button type="button" onClick={() => void run(() => navigator.clipboard.writeText(JSON.stringify(legacyDraft, null, 2)))}>Copy previous draft</button>
        <button type="button" onClick={() => { localStorage.removeItem("xlog.integration.draft"); setLegacyDraft(null); }}>Discard previous draft</button>
      </div>}
      {message && !message.endsWith("· radio frequency and mode confirmed") && <p className="live-message" role="status">{message}</p>}
      {["Operator Desk", "Log QSO"].includes(view) && referenceEvidence?.call === normalizedCall(draft?.call) && !!referenceEvidence.rows.length &&
        <p className="live-message" role="status">{referenceEvidence.rows.map(row => `${String(row.kind).toUpperCase()} ${row.reference} · ${row.status === "verified" ? `Verified: ${row.name}` : row.status === "not_installed" ? "Directory not installed" : "Not found in installed directory"}`).join(" | ")}</p>}
      {!workspace?.workspace_exists ? <WorkspaceGate workspace={workspace} pending={workspacePending} busy={busy}
        retry={() => void run(reload)} create={mode => void run(async () => { await request("workspace_create", { mode }); await reload(); })} /> : <>
      {view === "Operator Desk" && <><OperatorDesk draftLocked={editorLocked} cwControls={cwControls} equipment={settings?.stationEquipment} draft={draft} setDraft={setOperatorDraft} save={save} clear={() => void run(clear)} busy={busy || editorBlocked} lookup={lookup} previous={previous} request={request} refresh={refresh} onEditor={() => setView("Log QSO")} onReadRadio={readRadioIntoDraft} follow={follow} setFollow={setFollowImmediate} rotor={rotorState} autoRotor={autoRotor} setAutoRotor={changeAutoRotor} onManualRotor={disarmAutoRotor} isEditing={editing.current} intelligenceBands={workspacePreferences?.intelligenceBands} />
        <div className="live-desk-bottom"><OperatorWorkspace map={<div className="live-map">{map}</div>} cluster={cluster} selectedSpotId={selected} onSelect={selectSpot} bandMaps={<BandMaps spots={liveSpots} onSelect={selectSpot} radioFrequencyHz={station?.radio?.frequency_hz} compact preferences={workspacePreferences ? bandMapView(workspacePreferences, true) : undefined} onPreferencesChange={value => changeBandMapPreferences(true, value)} />} /></div></>}
      {view === "Log QSO" && <QSOEditor draftLocked={editorLocked} draft={draft} setDraft={setOperatorDraft} save={save} clear={() => void run(clear)} busy={busy || editorBlocked} lookup={lookup} previous={previous} follow={follow} setFollow={setFollowImmediate} request={request} onReadRadio={readRadioIntoDraft} isEditing={editing.current} automaticStationMetadata={automaticStationMetadata} />}
      {view === "Logbook" && <LogbookPanel onRequest={request} refreshKey={refresh} mutations={logbookMutations} onChanged={() => setRefresh(n => n + 1)} onUndock={() => void openDetachedLogbook().catch(cause => setError(cause.message))} onEdit={qso => { void run(async () => {
        if (draftSession.getSnapshot().locked) throw new Error("Finish the pending draft operation before editing a logged contact.");
        await draftSession.flush(); await contactSession.open(qso.id); setFollowImmediate(false); disarmAutoRotor(); setView("Log QSO");
      }); }} />}
      {view === "DX Cluster" && <ClusterPanel passive snapshot={cluster} selectedSpotId={selected} onRequest={request} onSelect={selectSpot} onUndock={() => void openDetachedCluster().catch(e => setError(e.message))} />}
      {view === "Chaser & DX" && <OpportunitiesPanel request={request} refresh={refresh} onSelect={loadOpportunity} home={stats?.map_home} />}
      {view === "World Map" && <><div className="live-actions"><button type="button" onClick={() => void openDetachedMap("world-map").catch(e => setError(e.message))}><ExternalLink size={14} />Undock World Map</button></div><div className="live-map full">{map}</div></>}
      {view === "Band Maps" && <BandMaps spots={liveSpots} onSelect={selectSpot} radioFrequencyHz={station?.radio?.frequency_hz} onUndock={() => void openDetachedMap("band-maps").catch(e => setError(e.message))} preferences={workspacePreferences ? bandMapView(workspacePreferences, false) : undefined} onPreferencesChange={value => changeBandMapPreferences(false, value)} />}
      {view === "Station Control" && <><div className="live-tabs" role="group" aria-label="Station sections">{["Control and connections", "RUMlog spots"].map(section => <button key={section} aria-pressed={stationSection === section} onClick={() => setStationSection(section)}>{section}</button>)}</div>
        {stationSection === "RUMlog spots" ? <SpotBridgePanel request={request} provider={stationProvider} /> : <><div className="live-station-provider" role="group" aria-label="Radio connection type">
        {([ ["direct_agent", "Remote station · embedded xCat"], ["direct_flex_lan", "Direct FLEX · LAN"], ["hamlib", "Local station · Hamlib"] ] as const).map(([id, label]) => <button key={id} className={viewProvider === id ? "selected" : ""} aria-pressed={viewProvider === id} disabled={busy} onClick={() => setViewProvider(id)}>{label}</button>)}
        {viewProvider !== stationProvider && <button type="button" disabled={busy} onClick={() => void applyProvider()}>Apply radio selection</button>}
        <span>Active radio: {radioProviderLabels[stationProvider]}. {viewProvider === stationProvider ? "Your independent rotor stays connected." : "Viewing only. Apply radio selection to disconnect the active radio; your independent rotor stays connected."}</span></div>
        {viewProvider === "hamlib" ? <HamlibPanel request={viewedStationRequest} snapshot={stationProvider === viewProvider ? station : null} /> :
          viewProvider === "direct_flex_lan" ? <DirectFlexPanel request={viewedStationRequest} snapshot={stationProvider === viewProvider ? station : null} /> :
          <StationPanel snapshot={stationProvider === viewProvider ? station : null} onRequest={viewedStationRequest} onSnapshot={value => { if (stationProvider === viewProvider && provider.current === viewProvider) setStation(value); }} independentRotor />}</>}</>}
      {(view === "Awards" || awardsOpened) && <div hidden={view !== "Awards"}><IntegratedAwards request={request} refresh={refresh} initialStats={stats?.awards} /></div>}
      {view === "Settings" && settings && <ServiceSettings values={settings} request={request} onSaved={setSettings} cwContext={cwContext} cwState={cw.state} cwProvider={stationProvider} refreshCW={() => cw.controller.pollWinKeyer()} rotorSettings={<RotorPanel snapshot={rotorState} request={request} onManual={disarmAutoRotor} />} dataRequest={dataManagementRequest} onDataChanged={() => { setSettings(null); setDraft(null); setStats(null); latestWorkspacePreferences.current = null; setWorkspacePreferences(null); setRefresh(n => n + 1); }} />}
      {view === "Sync" && (settings?.logbookMode === "local" ? <p>Standalone local logbook. Wavelog synchronization is disabled in Settings.</p> : <SyncPanel request={request} onChanged={() => setRefresh(n => n + 1)} />)}
      </>}
    </main></div>;
}

function DetachedMapSurface({ kind }: { kind: DetachedMapKind }) {
  const [projection, setProjection] = useState<DetachedMapProjection>({ spots: [] });
  const [optimisticBandMapPreferences, setOptimisticBandMapPreferences] = useState<BandMapViewPreferences | null>(null);
  const latestBandMapPreferences = useRef<BandMapViewPreferences | null>(null);
  const authoritativeBandMapPreferences = useRef<BandMapViewPreferences | null>(null);
  const pendingPreferenceSequence = useRef(0);
  const pendingPreferences = useRef(false);
  const preferenceSend = useRef<Promise<void>>(Promise.resolve());
  const preferenceTimeout = useRef<number | null>(null);
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
        if (kind === "band-maps" && validBandMapView(value.bandMapPreferences)) {
          authoritativeBandMapPreferences.current = value.bandMapPreferences;
          if (!pendingPreferences.current || latestBandMapPreferences.current &&
            sameBandMapPreferences(latestBandMapPreferences.current, value.bandMapPreferences)) {
            pendingPreferences.current = false;
            latestBandMapPreferences.current = value.bandMapPreferences;
            setOptimisticBandMapPreferences(null);
            if (preferenceTimeout.current !== null) window.clearTimeout(preferenceTimeout.current);
            preferenceTimeout.current = null;
          }
        }
        latestRevision.current = Number(value.revision); setProjection(value); setReceivedAt(Date.now());
      }
    }).then(stop => {
      if (!active) { stop(); return; }
      unlisten = stop;
      void announceDetachedReady(kind).catch(cause => setError(cause instanceof Error ? cause.message : "Map projection unavailable."));
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Map projection unavailable."); });
    return () => { active = false; unlisten?.(); if (preferenceTimeout.current !== null) window.clearTimeout(preferenceTimeout.current); };
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
  const changeDetachedBandMapPreferences = (requested: BandMapViewPreferences) => {
    const rendered = optimisticBandMapPreferences ?? projection.bandMapPreferences;
    if (!validBandMapView(rendered) || !validBandMapView(requested)) return;
    const next = mergeBandMapPreferenceIntent(latestBandMapPreferences.current ?? rendered, rendered, requested);
    if (!validBandMapView(next)) return;
    latestBandMapPreferences.current = next;
    pendingPreferences.current = true;
    setOptimisticBandMapPreferences(next);
    const sequence = ++pendingPreferenceSequence.current;
    if (preferenceTimeout.current !== null) window.clearTimeout(preferenceTimeout.current);
    preferenceTimeout.current = window.setTimeout(() => {
      if (pendingPreferences.current && pendingPreferenceSequence.current === sequence) {
        pendingPreferences.current = false;
        latestBandMapPreferences.current = authoritativeBandMapPreferences.current;
        setOptimisticBandMapPreferences(null);
        setError("Band-map preferences were not confirmed by the main workspace. Try again.");
      }
    }, 10_000);
    preferenceSend.current = preferenceSend.current.catch(() => {}).then(() => requestDetachedBandMapPreferences(next));
    void preferenceSend.current.catch(cause => {
      if (pendingPreferenceSequence.current !== sequence) return;
      pendingPreferences.current = false;
      latestBandMapPreferences.current = authoritativeBandMapPreferences.current;
      setOptimisticBandMapPreferences(null);
      if (preferenceTimeout.current !== null) window.clearTimeout(preferenceTimeout.current);
      preferenceTimeout.current = null;
      setError(cause instanceof Error ? cause.message : "Band-map preferences could not reach the main window.");
    });
  };
  return <div className="app live monitor-app" style={{ display: "flex", flexDirection: "column" }}>
    {kind === "world-map" && <header className="station-rail"><strong className="brand teal">OM0RX-xLog</strong><span className="cyan">World Map</span><span className="rail-end">{spots.length} live spots · selection handled by main window</span><button type="button" onClick={() => void dockDetachedWorkspace().catch(() => setError("Could not dock this window. Close it and reopen the workspace in the main app."))}>Dock back</button></header>}
    <main style={{ flex: 1, minHeight: 0, padding: 14 }}>
      {error && <p className="live-error" role="alert">{error}</p>}
      {receivedAt === 0 ? <p className="secondary">Waiting for the main workspace projection…</p> : clock - receivedAt > 5_000 && <p className="live-cluster-note" role="status">Main workspace updates paused; map data below may be stale.</p>}
      {kind === "world-map" ? <div className="live-map full"><WorldMap data={mapSpots} selected={projection.selected ?? null}
        palette={projection.palette} home={projection.home} dxccStatuses={projection.dxccStatuses}
        target={projection.target} frequencyHz={projection.radioFrequencyHz}
        onSpot={select} /></div> : <BandMaps spots={spots} onSelect={select} radioFrequencyHz={projection.radioFrequencyHz}
          preferences={optimisticBandMapPreferences ?? projection.bandMapPreferences} onPreferencesChange={changeDetachedBandMapPreferences}
          onDock={() => void dockDetachedWorkspace().catch(() => setError("Could not dock this window. Close it and reopen the workspace in the main app."))} />}
      {kind === "world-map" && <p className="secondary">This window displays the main app’s latest read-only projection. Spot selection is validated and handled by the main window.</p>}
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
    home={projection.home} dxccStatuses={projection.dxccStatuses} target={projection.target} frequencyHz={!stale ? projection.radioFrequencyHz : undefined} compact />;
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

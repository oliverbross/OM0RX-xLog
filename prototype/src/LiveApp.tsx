import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { nativeSpotEditor, useSpotEditor } from "./live/useSpotEditor";
import { activationDisablesFollow, validSpotActivationSnapshot } from "./live/spotActivation";
import { invoke } from "@tauri-apps/api/core";
import { manualTuneSession } from "./live/manualTune";
import { manualRotorGotoSession } from "./live/manualRotorGoto";
import { loadReadRadioJournal, type ReadRadioJournal } from "./live/readRadioJournal";
import { useSpotActivation } from "./live/useSpotActivation";
import { SpotActivationStatus } from "./live/SpotActivationStatus";
import { StableFeedbackLayer } from "./live/StableFeedbackLayer";
import { useAutoRotor } from "./live/useAutoRotor";
import { nativeRotorStop } from "./live/nativeRotorStop";
import { useFollowRadio } from "./live/useFollowRadio";
import { useReferenceEvidence } from "./live/useReferenceEvidence";
import { Radio, BookOpen, Network, History, Map as MapIcon, Settings, Activity, Award, LayoutDashboard, ExternalLink, RefreshCw } from "lucide-react";
import { workerRequest, openMonitor, openDetachedMap, detachedMapKind,
  type StationProvider } from "./worker";
import WorldMap from "./Map";
import type { Spot } from "./model";
import { ClusterPanel } from "./live/ClusterPanel";
import { clusterSessionIntentKey, initializeNativeClusterResume, nativeClusterSession, shouldResumeCluster } from "./live/clusterResume";
import OpportunitiesPanel, { type Opportunity } from "./live/OpportunitiesPanel";
import { SpotHistoryPanel } from "./live/SpotHistoryPanel";
import { useReferenceSchedule } from "./live/referenceSchedule";
import { openDetachedCluster, dockDetachedWorkspace, onDetachedDock,
  publishClusterSelection } from "./live/DetachedClusterBridge";
import { LogbookPanel } from "./live/LogbookPanel";
import { connectLogbookChanges, openDetachedLogbook, openDetachedAwards } from "./live/logbookWindows";
import StationPanel from "./live/StationPanel";
import SharedPropagationConditions from "./live/SharedPropagationConditions";
import { DetachedMonitorSurface } from "./live/DetachedMonitorSurface";
import HamlibPanel from "./live/HamlibPanel";
import DirectFlexPanel from "./live/DirectFlexPanel";
import { hamlibStationRequest } from "./live/hamlibStation";
import BandMaps, { bandForRadio } from "./live/BandMaps";
import { bandMapView, migrateLegacyBandMaps, validBandMapView, withBandMapView } from "./live/workspacePreferences";
import type { WorkspacePreferences } from "./live/workspacePreferences";
import { bandMapPatch, checkedPreferenceReply, connectPreferenceInvalidation, validPreferenceSnapshot, type PreferenceSnapshot } from "./live/bandMapPreferenceTransport";
import { DetachedWorldMapSurface } from "./live/DetachedWorldMapSurface";
import { DetachedBandMapsSurface } from "./live/DetachedBandMapsSurface";
import type { BandMapViewPreferences } from "./live/BandMaps";
import { mergeBandMapPreferenceIntent } from "./live/detachedBandMapPreferences";
import IntegratedAwards from "./live/AwardsPanel";
import { useDeferredPanelReads } from "./live/deferredPanelReads";
import QSOEditor from "./live/QSOEditor";
import { ContactDeleteAction } from "./live/ContactDeleteAction";
import OperatorDesk, { DeskQSO, DeskIntelligence, DeskRotor } from "./live/OperatorDesk";
import { useQSOLoggedToast } from "./live/QSOLoggedToast";
import OperatorCanvas from "./live/OperatorCanvas";
import { useWorkspaceLayout } from "./live/useWorkspaceLayout";
import { useWorkspaceRecovery } from "./live/useWorkspaceRecovery";
import { presentWorkspaceMode, switchWorkspaceMode, workspaceMode, workspaceModeEditorBusy } from "./live/workspaceMode";
import { WorkspaceModeSurface } from "./live/WorkspaceModeSurface";
import { DeskAntenna } from "./live/StationEquipment";
import { deskEquipmentKind, equipmentProfile, hasConfiguredRotor } from "./live/equipmentPreferences";
import CWDesk from "./live/CWDesk";
import { useSharedCW } from "./live/useSharedCW";
import { OperatorWorkspace } from "./live/OperatorWorkspace";
import { DeskMapLogbook } from "./live/DeskMapLogbook";
import SyncPanel from "./live/SyncPanel";
import { watchSyncCompletion } from "./live/syncCompletion";
import ServiceSettings from "./live/ServiceSettings";
import { SettingsSession, readSettingsJournal, settingsDraftIsDirty } from "./live/settingsSession";
import { connectSettingsChanges, requestSettings } from "./live/settingsTransport";
import { clearLegacyRotorConfiguration, legacyRotorConfiguration, readRotorConfigurationJournal,
  RotorConfigurationSession, rotorConfigurationDirty } from "./live/rotorConfigurationSession";
import { connectRotorConfigurationChanges, requestRotorConfiguration } from "./live/rotorConfigurationTransport";
import WorkspaceSettings from "./live/WorkspaceSettings";
import WorkspaceGate from "./live/WorkspaceGate";
import SpotBridgePanel from "./live/SpotBridgePanel";
import WSJTXPanel from "./live/WSJTXPanel";
import { logMode } from "./live/draftRadio";
import { changedCallDraft, enrichedDraft, normalizedCall } from "./live/draftEnrichment";
import { settingsLoadingLookup } from "./live/callsignIntelligenceContext";
import { OperatorDraftSession, readDraftJournal, type DraftQSO } from "./live/operatorDraftSession";
import { requestOperatorDraft } from "./live/operatorDraftTransport";
import { connectOperatorDraftChanges, openDetachedQSO, ownDraftUpdateWarnings, protectOperatorDraftClose } from "./live/operatorDraftWindows";
import { OperatorDraftStatus } from "./live/OperatorDraftStatus";
import { LogbookContactSession, readContactJournal } from "./live/logbookContactSession";
import { LogbookMutationSession, readLogbookMutationJournal } from "./live/logbookMutationSession";
import { LogbookMutationStatus } from "./live/LogbookMutationStatus";
import { requestLogbookContact } from "./live/logbookContactTransport";
import { ContactEditStatus } from "./live/ContactEditStatus";
import { connectWorkspaceNavigation, workspaceMenuScreens } from "./live/workspaceNavigation";
import { retireStationProvider } from "./live/stationHandover";
import RotorPanel from "./live/RotorPanel";
import { connectRotorTelemetry } from "./live/rotorTelemetry";
import { connectStationTelemetry } from "./live/stationTelemetry";
import { connectStationSelection, nativeStationSelection } from "./live/stationSelection";
import { amplifierTransitionSession } from "./live/amplifierTransition";
import { AmplifierTransitionStatus } from "./live/AmplifierTransitionStatus";
import { AgentConnectionSetup } from "./live/AgentConnectionSetup";
import { TCIObservation } from "./live/TCIObservation";
import { providerAllowsCWDesk } from "./live/cwVisibility";
import { clearConnectedHandoverMessage, rotorCommandParams, rotorProjection, validRotorSnapshot, type RotorSnapshot } from "./live/rotorControl";
import "./live/live.css";
import appLogo from "./assets/xlog-logo-mark.png";

type Data = Record<string, any>;
type Request = (method: string, params?: Data) => Promise<any>;

const callsignLookups = new WeakMap<Request, Map<string, Promise<any>>>();
function releaseCallsignLookup(request: Request, call: string, lookup: Promise<any>) {
  const pending = callsignLookups.get(request), key = normalizedCall(call) || call;
  if (pending?.get(key) !== lookup) return;
  pending.delete(key);
  if (!pending.size) callsignLookups.delete(request);
}
function ownedCallsignLookup(request: Request, call: string): Promise<any> {
  let pending = callsignLookups.get(request);
  if (!pending) { pending = new Map(); callsignLookups.set(request, pending); }
  const key = normalizedCall(call) || call;
  const existing = pending.get(key);
  if (existing) return existing;
  let work: Promise<any>;
  work = Promise.resolve().then(() => request("lookup_call", { call })).finally(() => {
    if (pending?.get(key) === work) {
      pending.delete(key);
      if (!pending.size) callsignLookups.delete(request);
    }
  });
  pending.set(key, work);
  return work;
}

// Native QRZ has a 40-second authenticated refresh worst case and the worker
// owns a 45-second deadline. This outer deadline must be the last one to fire.
export function boundedCallsignLookup(request: Request, call: string, timeoutMs = 46_000): Promise<any> {
  const lookup = ownedCallsignLookup(request, call);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // A worker restart can abandon the transport promise forever. Retire that
      // ownership so the existing UI retry can reach the replacement worker.
      releaseCallsignLookup(request, call, lookup);
      reject(new Error("Callsign lookup timed out."));
    }, timeoutMs);
    void lookup.then(
      value => { clearTimeout(timer); resolve(value); },
      cause => { clearTimeout(timer); reject(cause); },
    );
  });
}
export const syncSettingsDestination = (logbookMode: unknown): "Logbook" | "Sync" => logbookMode === "local" ? "Logbook" : "Sync";
const screenIcons: Record<string, typeof Radio> = {
  "operator-desk": LayoutDashboard, "log-qso": Radio, logbook: BookOpen, "dx-cluster": Network, "spot-history": History,
  "world-map": MapIcon, "band-maps": Activity, "chaser-dx": Activity, awards: Award,
  "station-control": Radio, sync: RefreshCw, settings: Settings,
};
const navigation = workspaceMenuScreens.map(screen => [screen.title, screenIcons[screen.id]] as const);
const monitor = new URLSearchParams(location.search).get("view") === "monitor";
const detached = detachedMapKind(new URLSearchParams(location.search).get("view"));
const frequency = (hz?: number) => typeof hz === "number" && Number.isFinite(hz) ? (hz / 1e6).toFixed(6) : "—";
const emptySpots: Data[] = [];
const radioProviderLabels: Record<StationProvider, string> = {
  direct_agent: "Remote station · embedded xCat",
  direct_flex_lan: "Direct FLEX · LAN",
  direct_tci: "Direct TCI · read only",
  hamlib: "Local station · Hamlib",
};
const draftJournalKey = "xlog.integration.operatorDraft.main.v1";
const readRadioJournalKey = `${draftJournalKey}.readRadio`;
const contactJournalKey = "xlog.integration.contactEdit.main.v1";
const logbookMutationJournalKey = "xlog.integration.logbookMutation.main.v1";
const settingsJournalKey = "xlog.integration.settings.main.v1";
const rotorConfigurationJournalKey = "xlog.integration.rotorConfiguration.main.v1";
function storedDraftValue(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function legacyDraftValue(): Data | null {
  try { const value = JSON.parse(storedDraftValue("xlog.integration.draft") || "null");
    return value?.id && value?.start && value?.call ? value : null;
  } catch { return null; }
}

export default function LiveApp() {
  if (detached === "world-map") return <DetachedWorldMapSurface />;
  if (detached === "band-maps") return <DetachedBandMapsSurface />;
  if (monitor) return <DetachedMonitorSurface />;
  return <MainLiveApp />;
}

function MainLiveApp() {
  const [view, writeView] = useState<string>("Operator Desk");
  const viewRef = useRef(view); viewRef.current = view;
  const editorBufferPending = useRef(false), mainClosing = useRef(false), layoutChanging = useRef(false), editorTransition = useRef(false);
  const readingRadio = useRef(false), readOperation = useRef<ReadRadioJournal | null>(loadReadRadioJournal(readRadioJournalKey));
  const [radioBusy, setRadioBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const logbookWorkingRef = useRef(false);
  const [logbookWorking, setLogbookWorking] = useState(false);
  const logbookWorkingChanged = useCallback((value: boolean) => { logbookWorkingRef.current = value; setLogbookWorking(value); }, []);
  type MenuSettingsTab = "Station" | "Logbook" | "Wavelog" | "Sync" | "QRZ" | "Online logs" | "Reference data";
  const [settingsTabRequest, setSettingsTabRequest] = useState<{ tab: MenuSettingsTab; revision: number }>({ tab: "Station", revision: 0 });
  const [workspace, setWorkspace] = useState<Data | null>(null);
  const [workspacePending, setWorkspacePending] = useState(true);
  const deskLayout = useWorkspaceLayout(workspace?.workspace_exists === true);
  const modeAction = useRef<(title: string) => Promise<boolean>>(async () => false);
  const [settingsSession] = useState(() => new SettingsSession(requestSettings,
    journal => journal ? localStorage.setItem(settingsJournalKey, JSON.stringify(journal)) : localStorage.removeItem(settingsJournalKey),
    readSettingsJournal(storedDraftValue(settingsJournalKey))));
  const settingsState = useSyncExternalStore(settingsSession.subscribe, settingsSession.getSnapshot);
  const settings = settingsState.draft;
  const [rotorConfigurationSession] = useState(() => new RotorConfigurationSession(requestRotorConfiguration,
    journal => journal ? localStorage.setItem(rotorConfigurationJournalKey, JSON.stringify(journal)) : localStorage.removeItem(rotorConfigurationJournalKey),
    readRotorConfigurationJournal(storedDraftValue(rotorConfigurationJournalKey))));
  const rotorConfigurationState = useSyncExternalStore(rotorConfigurationSession.subscribe, rotorConfigurationSession.getSnapshot);
  const loadRotorConfiguration = useCallback(async () => {
    await rotorConfigurationSession.load(legacyRotorConfiguration(localStorage));
    clearLegacyRotorConfiguration(localStorage);
  }, [rotorConfigurationSession]);
  const [workspacePreferences, setWorkspacePreferences] = useState<WorkspacePreferences | null>(null);
  const latestWorkspacePreferences = useRef<WorkspacePreferences | null>(null);
  const latestPreferenceSnapshot = useRef<PreferenceSnapshot | null>(null);
  const preferenceWrite = useRef<Promise<unknown>>(Promise.resolve());
  const preferenceRevision = useRef(0);
  const reloadRevision = useRef(0);
  const [draftSession] = useState(() => new OperatorDraftSession(requestOperatorDraft,
    journal => localStorage.setItem(draftJournalKey, JSON.stringify(journal)), readDraftJournal(storedDraftValue(draftJournalKey)), undefined, nativeSpotEditor()));
  const sharedDraft = useSyncExternalStore(draftSession.subscribe, draftSession.getSnapshot);
  const [contactSession] = useState(() => new LogbookContactSession(requestLogbookContact,
    journal => journal ? localStorage.setItem(contactJournalKey, JSON.stringify(journal)) : localStorage.removeItem(contactJournalKey),
    readContactJournal(storedDraftValue(contactJournalKey)), undefined, nativeSpotEditor()));
  const contactEdit = useSyncExternalStore(contactSession.subscribe, contactSession.getSnapshot);
  const [logbookMutations] = useState(() => new LogbookMutationSession(requestLogbookContact,
    journal => localStorage.setItem(logbookMutationJournalKey, JSON.stringify(journal)),
    readLogbookMutationJournal(storedDraftValue(logbookMutationJournalKey)), undefined,
    () => draftSession.canAcceptLocalInput() && contactSession.canAcceptLocalInput()));
  const logbookMutation = useSyncExternalStore(logbookMutations.subscribe, logbookMutations.getSnapshot);
  const editing = useRef(false);
  editing.current = !!contactEdit.draft;
  const [legacyDraft, setLegacyDraft] = useState(legacyDraftValue);
  const draft = contactEdit.draft ?? sharedDraft.draft;
  const editorLocked = radioBusy || sharedDraft.activationFrozen || contactEdit.activationFrozen || sharedDraft.locked || contactEdit.locked || sharedDraft.workspaceChanged || contactEdit.workspaceChanged || !!contactEdit.draft && (logbookMutation.busy || !!logbookMutation.pending || logbookMutation.workspaceChanged || logbookMutation.conflict);
  const editorBlocked = editorLocked || !!sharedDraft.conflict || contactEdit.conflict;
  const setDraft = useCallback((next: Data | null | ((current: Data | null) => Data | null)) => {
    if (mainClosing.current || layoutChanging.current || editorTransition.current || readingRadio.current) return;
    if (!draftSession.canAcceptLocalInput() || !contactSession.canAcceptLocalInput()) return;
    if (draftSession.getSnapshot().locked || draftSession.getSnapshot().workspaceChanged || contactSession.getSnapshot().locked || contactSession.getSnapshot().workspaceChanged) return;
    const contact = contactSession.getSnapshot().draft;
    const current = contact ?? draftSession.getSnapshot().draft;
    const value = changedCallDraft(current, typeof next === "function" ? next(current) : next);
    if (contact && value) contactSession.edit(value as DraftQSO);
    else if (value) draftSession.edit(value as DraftQSO);
    else draftSession.reset();
  }, [draftSession, contactSession]);
  const setOperatorDraft = setDraft;
  const setManualDraftPower = useCallback((value: string) => {
    if (contactSession.getSnapshot().draft) return;
    try { draftSession.setManualPower(value); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The manual power edit could not be saved."); }
  }, [draftSession, contactSession]);
  const draftIdentity = useRef(draft?.id); draftIdentity.current = draft?.id;
  const draftCall = useRef(normalizedCall(draft?.call)); draftCall.current = normalizedCall(draft?.call);
  const [station, setStation] = useState<Data | null>(null);
  const [cluster, setCluster] = useState<Data | null>(null);
  const [stats, setStats] = useState<Data | null>(null);
  const [lookup, setLookup] = useState<Data | null>(null);
  const [previous, setPrevious] = useState<Data[]>([]);
  const [message, setMessage] = useState("");
  const loggedFeedback = useQSOLoggedToast();
  const [error, setError] = useState("");
  const presentationError = useRef("");
  useEffect(() => connectSettingsChanges(() => { void settingsSession.load(); }, setError), [settingsSession]);
  useEffect(() => connectRotorConfigurationChanges(() => { void rotorConfigurationSession.load(); }, setError), [rotorConfigurationSession]);
  const editorInputState = useCallback((pending: boolean) => {
    editorBufferPending.current = pending;
    draftSession.setLocalInputPending(!contactSession.getSnapshot().draft && pending);
  }, [draftSession, contactSession]);
  const setView = useCallback((next: string) => {
    if (next === viewRef.current) return true;
    if (logbookWorkingRef.current) { setError("Wait for the logbook operation to finish before changing views."); return false; }
    if (readingRadio.current || editorBufferPending.current || mainClosing.current || layoutChanging.current || editorTransition.current || !draftSession.canAcceptLocalInput() || !contactSession.canAcceptLocalInput()) {
      setError("Finish the buffered draft fields and check any pending activation before changing views. Your text is retained."); return false;
    }
    viewRef.current = next; writeView(next);
    return true;
  }, [draftSession, contactSession]);
  const [draftUpdateHealth] = useState(() => ownDraftUpdateWarnings(setError));
  const menuSettings = useRef(settings); menuSettings.current = settings;
  const showSyncSettings = useCallback(() => {
    if (!setView("Settings")) return false;
    const tab = syncSettingsDestination(menuSettings.current?.logbookMode);
    setSettingsTabRequest(previous => ({ tab, revision: previous.revision + 1 }));
    return true;
  }, [setView]);
  const showOnlineSettings = useCallback((tab: MenuSettingsTab) => {
    if (!setView("Settings")) return false;
    setSettingsTabRequest(previous => ({ tab, revision: previous.revision + 1 }));
    return true;
  }, [setView]);
  useEffect(() => connectWorkspaceNavigation(title => {
    if (title.startsWith("Workspace Mode: ")) return modeAction.current(title);
    const onlineTab = ({ "Wavelog Settings": "Wavelog", "QRZ Settings": "QRZ", "Online Log Settings": "Online logs",
      "Reference Data Settings": "Reference data" } as const)[title as "Wavelog Settings" | "QRZ Settings" | "Online Log Settings" | "Reference Data Settings"];
    return title === "Sync" ? showSyncSettings() : onlineTab ? showOnlineSettings(onlineTab) : setView(title);
  }, setError, undefined, retry => {
    const draft = draftSession.subscribe(retry), contact = contactSession.subscribe(retry), layout = deskLayout.session.subscribe(retry);
    return () => { draft(); contact(); layout(); };
  }), [showOnlineSettings, showSyncSettings, setView, draftSession, contactSession, logbookWorking]);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => connectLogbookChanges(() => setRefresh(value => value + 1), setError), []);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(busy); busyRef.current = busy;
  const nativeFollow = useFollowRadio();
  const [browserFollow, setBrowserFollow] = useState(true);
  const follow = nativeSpotEditor() ? nativeFollow.state?.enabled === true : browserFollow;
  const latestFollow = useRef(follow); latestFollow.current = follow;
  const changeFollow = useCallback(async (value: boolean) => {
    latestFollow.current = value;
    if (nativeSpotEditor()) await nativeFollow.set(value);
    else setBrowserFollow(value);
  }, [nativeFollow.set]);
  const setFollowImmediate = useCallback((value: boolean) => {
    latestFollow.current = value;
    void changeFollow(value).catch(cause => setError(cause instanceof Error ? cause.message : "Follow Radio authority is unavailable."));
  }, [changeFollow]);
  const spotEditor = useSpotEditor([draftSession, contactSession], snapshot => {
    if (readOperation.current && snapshot.operationId !== readOperation.current.operationId)
      return { ready: false, reason: "Check the retained Read radio outcome before another activation." };
    if (activationDisablesFollow(snapshot)) {
      // Synchronous with freeze, before either readiness acknowledgement or
      // terminal reconciliation can release background draft updates.
      selection.current++; pendingTune.current = false;
      // Native activation owners revoke Follow before publishing preparation.
      // Re-sending a stale expected epoch here would create a harmless but noisy
      // permission error. Browser fixtures still own their local fallback.
      if (nativeSpotEditor()) latestFollow.current = false; else setFollowImmediate(false);
      setSelected(null);
    }
    return busyRef.current || logbookWorkingRef.current || editorBufferPending.current || mainClosing.current || layoutChanging.current || logbookMutations.getSnapshot().busy || logbookMutations.getSnapshot().pending
      ? { ready: false, reason: "Finish the current logbook or workspace action first." } : { ready: true };
  });
  const spotActivation = useSpotActivation();
  const canChangeMode = (ownTransition = false) => {
    const current = draftSession.getSnapshot(), contact = contactSession.getSnapshot(), mutation = logbookMutations.getSnapshot();
    return !readingRadio.current && !readOperation.current && !busyRef.current && !logbookWorkingRef.current && !editorBufferPending.current && !mainClosing.current && (ownTransition || !layoutChanging.current) && !editorTransition.current &&
      !workspaceModeEditorBusy() && !draftSession.dirty && !contact.draft && !mutation.pending && !mutation.busy &&
      draftSession.canAcceptLocalInput() && contactSession.canAcceptLocalInput() && !current.pending && !contact.pending &&
      !current.conflict && !contact.conflict && !current.workspaceChanged && !contact.workspaceChanged &&
      !settingsDraftIsDirty(settingsState.base, settingsState.draft) && !settingsState.pending && !rotorConfigurationState.pending &&
      !settingsState.saving && !settingsState.conflict && !settingsState.workspaceChanged &&
      !rotorConfigurationState.saving && !rotorConfigurationState.conflict && !rotorConfigurationState.workspaceChanged &&
      !rotorConfigurationDirty(rotorConfigurationState.base, rotorConfigurationState.draft);
  };
  modeAction.current = async title => {
    const allowed = canChangeMode();
    if (allowed) layoutChanging.current = true;
    try { return await switchWorkspaceMode(deskLayout.session, title.endsWith("Separate Windows") ? "windows" : "canvas", () => allowed && canChangeMode(true)); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "Workspace mode could not be changed.");
      const snapshot = deskLayout.session.getSnapshot().snapshot;
      if (snapshot) void presentWorkspaceMode(snapshot, false).catch(() => {});
      return true;
    }
    finally { if (allowed) layoutChanging.current = false; }
  };
  // Background draft autosaves retain the committed presentation. Conflicts,
  // uncertain outcomes and recovered edits need their main-window controls.
  const configurationRecovery = [settingsState, rotorConfigurationState]
    .some(state => !!state.error || !!state.conflict || state.workspaceChanged)
    || settingsDraftIsDirty(settingsState.base, settingsState.draft)
    || rotorConfigurationDirty(rotorConfigurationState.base, rotorConfigurationState.draft)
    || !!settingsState.pending && !settingsState.saving
    || !!rotorConfigurationState.pending && !rotorConfigurationState.saving;
  const layoutRecovery = !!deskLayout.state.error || !!deskLayout.state.conflict || deskLayout.state.workspaceChanged
    || !!deskLayout.state.pending && !deskLayout.state.saving;
  const recoveryRequired = [sharedDraft, contactEdit, logbookMutation]
    .some(state => !!state.error || !!state.conflict || state.workspaceChanged)
    || !!contactEdit.draft || !!readOperation.current || configurationRecovery || layoutRecovery
    || !!logbookMutation.pending && !logbookMutation.busy;
  const recoveryVisible = useWorkspaceRecovery(recoveryRequired,
    canChangeMode(true) && !deskLayout.state.pending && !deskLayout.state.saving);
  const separateWindows = workspace?.workspace_exists === true && workspaceMode(deskLayout.state.snapshot) === "windows" && !recoveryVisible;
  useEffect(() => {
    const state = deskLayout.state;
    if (!state.snapshot || state.saving || workspace?.workspace_exists !== true) return;
    void presentWorkspaceMode(state.snapshot, separateWindows)
      .then(() => {
        const previous = presentationError.current; presentationError.current = "";
        if (previous) setError(current => current === previous ? "" : current);
      })
      .catch(cause => {
        const message = cause instanceof Error ? cause.message : typeof cause === "string" && cause.trim() ? cause : "Workspace mode presentation failed.";
        presentationError.current = message; setError(message);
      });
  }, [deskLayout.state.snapshot, deskLayout.state.pending, deskLayout.state.saving,
      deskLayout.state.conflict, deskLayout.state.workspaceChanged, separateWindows, workspace]);
  const acceptsInput = useCallback(() => !readingRadio.current && !mainClosing.current && !layoutChanging.current && !editorTransition.current && !logbookWorkingRef.current && draftSession.canAcceptLocalInput() && contactSession.canAcceptLocalInput(), [draftSession, contactSession]);
  useEffect(() => protectOperatorDraftClose(() => {
    const current = draftSession.getSnapshot(), contact = contactSession.getSnapshot(), mutation = logbookMutations.getSnapshot();
    return readingRadio.current || !!readOperation.current || busyRef.current || logbookWorkingRef.current || layoutChanging.current || editorBufferPending.current || draftSession.dirty || !!contact.draft || !!mutation.pending || mutation.busy ||
      current.activationFrozen || contact.activationFrozen || current.locked || contact.locked || !!current.pending || !!contact.pending ||
      !!current.conflict || contact.conflict || current.workspaceChanged || contact.workspaceChanged;
  }, () => setError("Finish the draft fields and resolve unsaved or pending QSO changes before closing the Desk."), setError,
  closing => { mainClosing.current = closing; }, "close_main_window"), [draftSession, contactSession, logbookMutations]);
  const [selected, setSelected] = useState<string | null>(null);
  const nativeAutoRotor = useAutoRotor(), autoRotor = nativeAutoRotor.state?.armed === true;
  const [rotorState, setRotorState] = useState<RotorSnapshot | null>(null);
  const rotorRef = useRef<RotorSnapshot | null>(null);
  const rotorPolling = useRef(false);
  const autoRotorSet = useRef(nativeAutoRotor.set); autoRotorSet.current = nativeAutoRotor.set;
  const disarmAutoRotor = useCallback(() => { if (nativeSpotEditor()) void autoRotorSet.current(false).catch(cause => setError(cause instanceof Error ? cause.message : "Automatic rotor could not be disarmed.")); }, []);
  const setAutomaticRotor = (enabled: boolean) => nativeAutoRotor.set(enabled, rotorRef.current);
  const changeAutoRotor = (enabled: boolean) => { void setAutomaticRotor(enabled).catch(cause => setError(cause instanceof Error ? cause.message : "Automatic rotor authority is unavailable.")); };
  const savedProvider = storedDraftValue("xlog.integration.provider");
  const provider = useRef<StationProvider>(savedProvider === "hamlib" || savedProvider === "direct_flex_lan" || savedProvider === "direct_tci" ? savedProvider : "direct_agent");
  const [stationProvider, setStationProvider] = useState(provider.current);
  const [viewProvider, setViewProvider] = useState(provider.current);
  const [stationSection, setStationSection] = useState("Control and connections");
  const pendingTune = useRef(false);
  const providerTransition = useRef(false);
  const providerGeneration = useRef(-1);
  const providerReadyRef = useRef(!nativeStationSelection());
  const [providerReady, setProviderReady] = useState(providerReadyRef.current);
  const selection = useRef(0);
  const activationStarted = useRef(false);
  const spotPreparation = useRef<Promise<void> | null>(null);
  const [spotEditorEpoch, setSpotEditorEpoch] = useState(0);
  const stationPolling = useRef(false);
  const clusterPolling = useRef(false);
  const clusterResumeChecked = useRef(false);
  const clusterResumeWarning = useRef<string | null>(null);
  const clusterMutationEpoch = useRef(0);
  useEffect(() => {
    if (nativeStationSelection()) return;
    const changed = (event: StorageEvent) => {
      if (event.key === "xlog.integration.provider" && event.newValue !== provider.current)
        setError("Radio selection changed in another window. This window retains its active radio until you apply a selection here.");
    };
    window.addEventListener("storage", changed); return () => window.removeEventListener("storage", changed);
  }, []);
  useEffect(() => connectStationSelection(savedProvider, value => {
    if (value.generation < providerGeneration.current) return;
    const changed = provider.current !== value.provider;
    if (changed) {
      selection.current++; pendingTune.current = false; disarmAutoRotor(); setStation(null);
      provider.current = value.provider; setStationProvider(value.provider); setViewProvider(value.provider);
    }
    providerGeneration.current = value.generation; providerReadyRef.current = true; setProviderReady(true);
  }, message => { providerReadyRef.current = false; setProviderReady(false); setError(message); }) ?? undefined, []);
  const request: Request = useCallback(async (method, params = {}) => {
    try {
      if (method === "cluster_connect" || method === "cluster_disconnect") {
        clusterResumeChecked.current = true;
        try { if (!nativeClusterSession()) localStorage.setItem(clusterSessionIntentKey, method === "cluster_connect" ? "connected" : "disconnected"); }
        catch { /* Storage failure must not prevent an explicit Disconnect. */ }
      }
      const clusterEpoch = method === "cluster_filter" || method === "cluster_configure" || method === "cluster_connect" || method === "cluster_disconnect"
        ? ++clusterMutationEpoch.current : clusterMutationEpoch.current;
      if (method === "rotor_goto" && nativeStationSelection())
        return manualRotorGotoSession().goto(params.owner, params.generation, params.bearing, String(params.label ?? "Manual bearing"));
      if (method.startsWith("rotor_")) {
        if (method === "rotor_stop" && nativeSpotEditor()) {
          // Match detached Stop: do not put device snapshots before or after
          // its acknowledgement. The native telemetry owner supplies readback.
          if (params.owner !== "native_dcu1" && params.owner !== "hamlib")
            throw new Error("Select and connect a rotor first.");
          try { return await nativeRotorStop(params.owner); }
          catch (cause) {
            const previous = rotorRef.current;
            if (previous && previous.owner === params.owner) {
              const next = { ...previous, state: "uncertain" as const, backend_available: false };
              rotorRef.current = next; setRotorState(next);
            }
            throw cause;
          }
        }
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
            const motion = ["rotor_goto", "rotor_stop", "rotor_park"].includes(method);
            const next = motion && previous?.owner === result.owner ? { ...result, backend: previous.backend } : result;
            rotorRef.current = next; setRotorState(next);
          }
          return result;
        } catch (cause) {
          throw cause;
        } finally {
          // Every motion advances the fence, including lost replies. Refresh the
          // coordinator rather than reusing a now-stale accepted intent.
          if (["rotor_goto", "rotor_stop", "rotor_park"].includes(method)) {
            try {
              const next = (await workerRequest("rotor_snapshot", {})).result;
              if (validRotorSnapshot(next) && (!rotorRef.current || next.generation >= rotorRef.current.generation)) {
                const previous = rotorRef.current;
                rotorRef.current = next; setRotorState(next);
              }
            } catch {
              const previous = rotorRef.current;
              const next = previous ? { ...previous, state: "uncertain" as const, backend_available: false } : null;
              rotorRef.current = next; setRotorState(next);
            }
          }
        }
      }
      const isStation = method.startsWith("station_");
      if (!providerReadyRef.current && (isStation || method.startsWith("hamlib_") && params.device === "radio"))
        throw new Error("Wait for the shared radio selection to load before using the radio.");
      if (providerTransition.current && ((isStation && method !== "station_snapshot") || method === "hamlib_connect" || method === "hamlib_reconnect" || method === "hamlib_control"))
        throw new Error("Wait for station handover to finish before sending another control.");
      if (isStation && params.provider && params.provider !== provider.current)
        throw new Error("Selected station changed. Finish handover before connecting or sending controls.");
      const requestedProvider = provider.current;
      const requestedSelection = selection.current;
      if (method === "station_action" && ["operate","standby"].includes(String(params.action)) && nativeStationSelection()) {
        if(requestedProvider!=="direct_agent")throw new Error("Amplifier controls require the Agent.");
        return amplifierTransitionSession().transition(params.action as "operate"|"standby");
      }
      if (method === "station_tune" && nativeStationSelection()) return manualTuneSession().tune(requestedProvider, params.frequency_hz as number, params.mode as string);
      const result = isStation && requestedProvider === "hamlib"
        ? await hamlibStationRequest(method, params, async (name, args) => (await workerRequest(name, args)).result as Data)
        : (await workerRequest(method, isStation ? { provider: provider.current, ...params } : params)).result as Data;
      if (method.startsWith("cluster_") && result?.snapshot && clusterEpoch === clusterMutationEpoch.current) {
        setCluster(result);
        if (result.resume_error) setError(String(result.resume_error));
      }
      if (requestedProvider === provider.current && requestedSelection === selection.current) {
        if (method === "station_snapshot" || method === "station_connect" || method === "station_disconnect" || method === "station_reconnect") setStation(result);
        if (result?.state && typeof result.state === "object" && result.state.source) setStation(result.state);
        if (result?.radio?.connected && result.radio.observed || result?.state?.radio?.connected && result.state.radio.observed)
          setMessage(current => clearConnectedHandoverMessage(current, true));
      }
      return result;
    } catch (e) { throw new Error(e instanceof Error ? e.message : "Operation failed"); }
  }, [disarmAutoRotor]);
  const panelRequest = useDeferredPanelReads(request, refresh,
    workspace?.workspace_exists === true && !workspacePending && view !== "Chaser & DX" && !separateWindows);
  const referenceEvidence = useReferenceEvidence(draft, (contactEdit.draft ? contactEdit.base : sharedDraft.base)?.generation, request, refresh);
  useReferenceSchedule(workspace?.workspace_exists === true, request);
  const cw = useSharedCW(`${view}:${draft?.id}:${draft?.call}:${draft?.frequencyHz}:${draft?.mode}`);
  const cwProfile = cw.profile, cwContext = cw.context;
  const cwControls = providerAllowsCWDesk(stationProvider, cwProfile.output, cw.state) && (cwProfile.showOnDesk || cwProfile.macros.some((macro: Data) => macro.enabled && macro.shortcut) || cw.state.armed || cw.state.owner || cw.state.lease || cw.state.pending)
    ? <CWDesk profile={cwProfile} context={cwContext} controller={cw.controller} state={cw.state} radioProvider={cw.provider} releaseOnly={stationProvider === "direct_tci" && cwProfile.output !== "winkeyer"} /> : undefined;
  const opportunityActivation = useSpotActivation("activate_opportunity");
  const loadOpportunity = (item: Opportunity) => {
    if (!acceptsInput()) { setError("Wait for the verified spot activation outcome before loading another contact."); return; }
    if (draftSession.getSnapshot().locked || draftSession.getSnapshot().workspaceChanged || draftSession.getSnapshot().conflict || contactSession.getSnapshot().locked || contactSession.getSnapshot().workspaceChanged) { setError("Resolve the current QSO draft operation before loading another contact."); return; }
    if (editing.current) { setError("Finish or clear the contact being edited before loading a new contact."); setView("Log QSO"); return; }
    selection.current++; pendingTune.current = false; disarmAutoRotor();
    editing.current = false; setFollowImmediate(false); setSelected(null);
    void opportunityActivation.activate(item).then(async outcome => {
      if (outcome?.phase === "confirmed" && outcome.draftOnly) {
        await draftSession.refresh();
        setView("Log QSO"); setMessage("Chaser selection loaded into the shared draft. Radio follow and Auto rotor are off; no station command was sent.");
      } else if (outcome?.error) setError(String(outcome.error));
    }).catch(cause => setError(cause instanceof Error ? cause.message : "Opportunity acknowledgement unavailable. Check its existing activation before selecting again."));
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
    if (readOperation.current) throw new Error("Check the existing Read radio activation before reading again. No read was retried.");
    if (nativeSpotEditor()) {
      const before = draftSession.getSnapshot(), contact = contactSession.getSnapshot();
      if (!acceptsInput() || busyRef.current || editorBufferPending.current || providerTransition.current || contact.draft || contact.pending || contact.conflict || contact.workspaceChanged ||
          !before.base || before.locked || before.pending || before.conflict || before.workspaceChanged || before.error)
        throw new Error("Finish the draft fields and resolve pending QSO changes before reading the radio.");
      readingRadio.current = true; setRadioBusy(true);
      try {
        await changeFollow(false);
        await draftSession.flush();
        const current = draftSession.getSnapshot(), currentContact = contactSession.getSnapshot();
        if (mainClosing.current || layoutChanging.current || editorTransition.current || logbookWorkingRef.current || busyRef.current || providerTransition.current || editorBufferPending.current ||
            !draftSession.canAcceptLocalInput() || !contactSession.canAcceptLocalInput() || draftSession.dirty || current.locked || current.pending || current.conflict || current.workspaceChanged || current.error ||
            currentContact.draft || currentContact.pending || currentContact.conflict || currentContact.workspaceChanged ||
            current.base?.generation !== before.base.generation || current.base?.qso.id !== before.base.qso.id)
          throw new Error("The shared draft changed while preparing Read radio. Your text is retained.");
        const operationId = crypto.randomUUID();
        const journal = { operationId, generation: current.base!.generation! };
        localStorage.setItem(readRadioJournalKey, JSON.stringify(journal)); readOperation.current = journal;
        const result = await invoke("operator_draft_read_radio", { operationId });
        if (!validSpotActivationSnapshot(result) || result.operationId !== operationId || !["confirmed", "blocked", "failed", "uncertain"].includes(result.phase))
          throw new Error("Read radio outcome could not be verified. Check the existing activation before reading again.");
        if (!await spotEditor.reconcile(result)) throw new Error("Read radio editor reconciliation is incomplete. Check the retained outcome before reading again.");
        if (result.reservationActive !== true && result.phase !== "uncertain") {
          localStorage.removeItem(readRadioJournalKey); readOperation.current = null;
        }
        if (result.phase !== "confirmed" || result.reservationActive === true)
          throw new Error(result.error || "Read radio was not confirmed. Check the existing activation before reading again.");
        if (mounted.current) setMessage("Observed radio frequency and mode copied into the QSO draft.");
      } finally { readingRadio.current = false; if (mounted.current) setRadioBusy(false); }
      return;
    }
    // Browser fixtures have no native transaction owner and retain their injected readback.
    if (!acceptsInput()) throw new Error("Wait for the verified spot activation outcome before reading into this draft.");
    if (draftSession.getSnapshot().workspaceChanged || contactSession.getSnapshot().workspaceChanged)
      throw new Error("Review the current workspace before reading into this QSO.");
    if (providerTransition.current) throw new Error("Wait for station handover before reading the radio.");
    const generation = selection.current, source = provider.current, identity = draftIdentity.current;
    if (!identity) throw new Error("Open a QSO draft before reading the radio.");
    const state = await request("station_snapshot");
    if (!acceptsInput()) throw new Error("The shared editor was frozen during radio readback. Its text is retained.");
    if (generation !== selection.current || source !== provider.current || identity !== draftIdentity.current)
      throw new Error("Station or QSO draft changed during radio readback. Read again.");
    if (!state?.radio?.observed || !state.radio.connected)
      throw new Error("Radio frequency and mode are not currently observed.");
    setFollowImmediate(false);
    setDraft(current => current && current.id === identity ? { ...current, frequencyHz: state.radio.frequency_hz,
      band: state.station?.band || bandForRadio(state.radio.frequency_hz) || current.band,
      mode: logMode(state.radio.mode, current.mode || "") } : current);
    setMessage("Observed radio frequency and mode copied into the QSO draft.");
  }, [request, acceptsInput, changeFollow, draftSession, contactSession, spotEditor.reconcile]);
  const checkReadRadio = async () => {
    const journal = readOperation.current;
    if (!journal || readingRadio.current) return;
    readingRadio.current = true; setRadioBusy(true);
    try {
      const result = await invoke("operator_draft_read_radio_recover", journal);
      if (!validSpotActivationSnapshot(result) || result.operationId !== journal.operationId || !["confirmed", "blocked"].includes(result.phase) || result.reservationActive === true ||
          !await spotEditor.reconcile(result)) throw new Error("Read radio recovery is incomplete. Its operation is retained; no read was replayed.");
      localStorage.removeItem(readRadioJournalKey); readOperation.current = null;
      setMessage(result.phase === "confirmed" ? "Recovered Read radio receipt. The current QSO draft was refreshed." : result.error || "The current QSO draft was checked. No radio read was repeated.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Read radio recovery unavailable. No read was replayed."); }
    finally { readingRadio.current = false; if (mounted.current) setRadioBusy(false); }
  };
  useEffect(() => {
    if (monitor) return;
    const focusAfterView = (selector: string) => window.setTimeout(() => document.querySelector<HTMLElement>(selector)?.focus(), 0);
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "s" && event.shiftKey) {
        event.preventDefault(); showSyncSettings(); focusAfterView('[role="tab"][aria-selected="true"]');
      } else if (key === "r" && event.shiftKey) {
        event.preventDefault();
        void readRadioIntoDraft().catch(cause => setError(cause instanceof Error ? cause.message : "Radio readback unavailable."));
      }
    };
    window.addEventListener("keydown", shortcut); return () => window.removeEventListener("keydown", shortcut);
  }, [readRadioIntoDraft, showSyncSettings]);
  const run = async (operation: () => Promise<unknown>) => {
    if (readingRadio.current) return;
    busyRef.current = true;
    setBusy(true); setError("");
    try { await operation(); } catch (e) { setError(e instanceof Error ? e.message : "Operation failed"); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const applyProvider = async () => {
    if (nativeStationSelection()) return;
    const next = viewProvider;
    if (provider.current === next || providerTransition.current) return;
    providerTransition.current = true;
    selection.current++; pendingTune.current = false; disarmAutoRotor();
    setBusy(true); setError("");
    try {
      await retireStationProvider(provider.current, async (method, params) => workerRequest(method, params));
      localStorage.setItem("xlog.integration.provider", next);
      provider.current = next; setStationProvider(next);
      setStation(null);
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
      const [, , , loaded] = await Promise.all([settingsSession.load(), loadRotorConfiguration(), draftSession.load(), request("workspace_preferences_load")]);
      if (revision !== reloadRevision.current) return;
      const prior = loaded.preferences as WorkspacePreferences;
      const migrated = loaded.stored ? null : migrateLegacyBandMaps(prior, localStorage);
      const saved = migrated && validPreferenceSnapshot(loaded) ? await request("workspace_preferences_save", {
        preferences: migrated, generation: loaded.generation, expectedRevision: loaded.revision,
      }) : loaded;
      const preferences = saved.preferences as WorkspacePreferences;
      latestPreferenceSnapshot.current = validPreferenceSnapshot(saved) ? saved : null;
      latestWorkspacePreferences.current = preferences;
      setWorkspacePreferences(preferences);
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
  }, [request, settingsSession, loadRotorConfiguration, draftSession, contactSession]);
  const changeBandMapPreferences = (compact: boolean, view: BandMapViewPreferences) => {
    const current = latestWorkspacePreferences.current;
    if (!current || !validBandMapView(view)) return;
    const base = latestPreferenceSnapshot.current;
    if (!base) { setError("Reload the workspace before changing shared band-map preferences."); return; }
    const rendered = workspacePreferences ? bandMapView(workspacePreferences, compact) : bandMapView(current, compact);
    const latest = bandMapView(current, compact);
    const mutation = bandMapPatch(base, compact, rendered, view, latest);
    if (!Object.keys(mutation.patch).length) return;
    const next = withBandMapView(current, compact, mergeBandMapPreferenceIntent(latest, rendered, view));
    latestWorkspacePreferences.current = next;
    setWorkspacePreferences(next);
    const revision = ++preferenceRevision.current;
    preferenceWrite.current = preferenceWrite.current.catch(() => {}).then(async () => {
      const reply = checkedPreferenceReply(await request("workspace_band_map_apply", mutation));
      if (revision === preferenceRevision.current) {
        latestPreferenceSnapshot.current = reply;
        latestWorkspacePreferences.current = reply.preferences;
        setWorkspacePreferences(reply.preferences);
      }
      if (reply.status !== "applied") throw new Error(reply.status === "workspace_changed"
        ? "Workspace changed. Reload before changing band-map preferences."
        : "Another window changed these band-map preferences. Review the current values and try again.");
    });
    void preferenceWrite.current.catch(cause => {
      if (revision !== preferenceRevision.current) return;
      setError(cause instanceof Error ? cause.message : "Band-map preferences could not be saved.");
      void request("workspace_preferences_load").then(loaded => {
        if (revision !== preferenceRevision.current) return;
        latestWorkspacePreferences.current = loaded.preferences;
        latestPreferenceSnapshot.current = validPreferenceSnapshot(loaded) ? loaded : null;
        setWorkspacePreferences(loaded.preferences);
      }).catch(() => {});
    });
  };
  useEffect(() => {
    let active = true, sequence = 0;
    const stop = connectPreferenceInvalidation(() => {
      const read = ++sequence, revision = preferenceRevision.current;
      void preferenceWrite.current.catch(() => {}).then(() => request("workspace_preferences_load")).then(loaded => {
        if (active && read === sequence && revision === preferenceRevision.current && validPreferenceSnapshot(loaded)) {
          latestPreferenceSnapshot.current = loaded;
          latestWorkspacePreferences.current = loaded.preferences;
          setWorkspacePreferences(loaded.preferences);
        }
      }).catch(() => { /* Explicit preference changes retain their own failure. */ });
    });
    return () => { active = false; sequence++; stop?.(); };
  }, [request]);
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
    if (workspace?.workspace_exists !== true) return;
    return watchSyncCompletion(request, () => setRefresh(value => value + 1));
  }, [request, workspace?.workspace_exists]);
  useEffect(() => {
    if (!workspace?.workspace_exists || sharedDraft.activationFrozen || sharedDraft.workspaceChanged || sharedDraft.locked || sharedDraft.pending || sharedDraft.conflict || !draftSession.dirty) return;
    const timer = setTimeout(() => { void draftSession.flush().catch(cause => setError(cause instanceof Error ? cause.message : "Draft could not be saved.")); }, 350);
    return () => clearTimeout(timer);
  }, [workspace?.workspace_exists, sharedDraft, draftSession]);
  useEffect(() => {
    if (!workspace?.workspace_exists) return;
    return connectOperatorDraftChanges(() => draftSession.refresh(), draftUpdateHealth.failed, draftUpdateHealth.recovered, draftUpdateHealth.subscribed);
  }, [workspace?.workspace_exists, draftSession, draftUpdateHealth]);
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
    if (!providerReady) return;
    let disposed = false;
    const observe = (state: Data) => {
      if (disposed || state.source !== provider.current) return;
      setStation(state);
      if (state.radio?.connected && state.radio?.observed) setMessage(current => clearConnectedHandoverMessage(current, true));
      if (!nativeStationSelection() && draftSession.canAcceptBackgroundUpdate() && latestFollow.current && !pendingTune.current && !editing.current && state.radio?.observed && state.radio?.connected) {
        setDraft(d => {
          if (!d) return d;
          const band = state.station?.band || bandForRadio(state.radio.frequency_hz) || d.band;
          const mode = logMode(state.radio.mode, d.mode || "");
          return d.frequencyHz === state.radio.frequency_hz && d.band === band && d.mode === mode
            ? d : { ...d, frequencyHz: state.radio.frequency_hz, band, mode };
        });
      }
    };
    const unavailable = () => {
      if (!disposed) setStation(s => s ? { ...s, available: false, radio: { ...s.radio, connected: false, observed: false }, connection_error: "Station connection unavailable" } : null);
    };
    const stopTelemetry = connectStationTelemetry(stationProvider, observe, unavailable, () => selection.current);
    if (stopTelemetry) return () => { disposed = true; stopTelemetry(); };
    // Browser fixtures have no native telemetry owner.
    const pollStation = async () => {
      if (stationPolling.current) return;
      stationPolling.current = true;
      const polledProvider = provider.current;
      const polledSelection = selection.current;
      try {
        const state = await request("station_snapshot");
        if (disposed || polledProvider !== provider.current || polledSelection !== selection.current) return;
        observe(state);
      } catch {
        if (!disposed && polledProvider === provider.current && polledSelection === selection.current)
          unavailable();
      } finally { stationPolling.current = false; }
    };
    void pollStation(); const timer = setInterval(() => void pollStation(), stationProvider === "hamlib" ? 1000 : 250);
    return () => { disposed = true; clearInterval(timer); };
  }, [request, stationProvider, providerReady]);
  useEffect(() => {
    let disposed = false;
    const pollCluster = async () => {
      if (clusterPolling.current) return;
      clusterPolling.current = true;
      try {
        if (!disposed) {
          if (nativeClusterSession() && !clusterResumeChecked.current) {
            await initializeNativeClusterResume();
            clusterResumeChecked.current = true;
            const warning = clusterResumeWarning.current;
            if (warning) setError(current => current === warning ? "" : current);
            clusterResumeWarning.current = null;
          }
          const state = await request("cluster_snapshot");
          if (!nativeClusterSession() && !disposed && !monitor && !clusterResumeChecked.current && state.configuration) {
            clusterResumeChecked.current = true;
            const active = state.snapshot?.connections?.some((connection: Data) => connection.phase === "connected" || connection.phase === "connecting");
            if (!active && shouldResumeCluster(state.configuration)) {
              try { await request("cluster_connect"); }
              catch { if (!disposed) setError("Cluster could not connect automatically. Open DX Cluster to inspect its connection and retry Connect."); }
            }
          }
        }
      }
      catch (cause) {
        // Keep last spots, but do not silently discard a failed legacy migration.
        if (!disposed && nativeClusterSession() && !clusterResumeChecked.current) {
          const warning = cause instanceof Error ? cause.message : "Cluster restart preference could not be initialized.";
          clusterResumeWarning.current = warning;
          setError(warning);
        }
      }
      finally { clusterPolling.current = false; }
    };
    void pollCluster(); const timer = setInterval(() => void pollCluster(), 1000);
    return () => { disposed = true; clearInterval(timer); };
  }, [request]);
  useEffect(() => {
    let disposed = false;
    const unavailable = () => {
      if (disposed) return;
      const previous = rotorRef.current;
      if (previous) { const next = { ...previous, backend_available: false }; rotorRef.current = next; setRotorState(next); }
    };
    const stopTelemetry = connectRotorTelemetry(result => {
      if (disposed || rotorRef.current && result.generation < rotorRef.current.generation) return;
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
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const baseline = draft;
    setLookup(null); setPrevious([]);
    if (!call || !workspace?.workspace_exists) { setLookup(null); setPrevious([]); return; }
    const loadLookup = (retry: boolean) => {
      void boundedCallsignLookup(request, call)
        .then(info => {
          if (disposed) return;
          setLookup(info);
          if (!retry && settingsLoadingLookup(info)) {
            retryTimer = setTimeout(() => loadLookup(true), 750);
            return;
          }
          if (draftSession.canAcceptBackgroundUpdate() && baseline && !editing.current) setDraft(current => enrichedDraft(current, baseline, info));
        })
        .catch(e => {
          if (disposed) return;
          if (!retry) { retryTimer = setTimeout(() => loadLookup(true), 750); return; }
          setLookup({ call, source: e instanceof Error ? e.message : "Lookup unavailable" });
        });
    };
    const timer = setTimeout(() => {
      // A large history query must not hold QRZ details hostage.
      loadLookup(false);
      void request("logbook_previous", { call, limit: 10 })
        .then(history => { if (!disposed) setPrevious(history.qsos); }).catch(() => { if (!disposed) setPrevious([]); });
    }, 400);
    return () => { disposed = true; clearTimeout(timer); if (retryTimer) clearTimeout(retryTimer); };
  }, [draft?.call, request, workspace?.workspace_exists]);
  const clear = async () => {
    if (contactSession.getSnapshot().draft) contactSession.cancel();
    else await draftSession.commit("clear");
    setSelected(null);
  };
  const save = () => run(async () => {
    if (!draft) return;
    const saved = contactSession.getSnapshot().draft ? await contactSession.save() : await draftSession.commit("save");
    if (saved) loggedFeedback.show();
    setSelected(null); setRefresh(n => n + 1);
  });
  const editLoggedContact = (qso: Data) => void run(async () => {
    if (editorBufferPending.current || !acceptsInput()) throw new Error("Finish the buffered draft fields before editing a logged contact. Your text is retained.");
    const before = draftSession.getSnapshot().base;
    if (!before || draftSession.getSnapshot().locked) throw new Error("Finish the pending draft operation before editing a logged contact.");
    editorTransition.current = true;
    try {
      await changeFollow(false);
      await draftSession.flush();
      const after = draftSession.getSnapshot().base;
      if (editorBufferPending.current || mainClosing.current || layoutChanging.current || !draftSession.canAcceptLocalInput() || !contactSession.canAcceptLocalInput() ||
        !after || before.generation !== after.generation || before.qso.id !== after.qso.id)
        throw new Error("The shared editor changed while opening a logged contact. Your text is retained.");
      await contactSession.open(qso.id);
      editorTransition.current = false;
      disarmAutoRotor(); setView("Log QSO");
    } finally { editorTransition.current = false; }
  });
  const selectSpot = (spot: Data) => {
    if (monitor) return;
    const draftState = draftSession.getSnapshot(), contactState = contactSession.getSnapshot();
    if (activationStarted.current || spotActivation.requesting || spotActivation.status && spotActivation.status.phase !== "idle" && spotActivation.status.reservationActive !== false) return;
    if (busyRef.current || logbookWorkingRef.current || logbookMutations.getSnapshot().busy || logbookMutations.getSnapshot().pending ||
      readingRadio.current || readOperation.current || mainClosing.current || layoutChanging.current || editorTransition.current ||
      draftState.locked || draftState.pending || draftState.conflict || draftState.workspaceChanged || draftState.activationFrozen ||
      contactState.locked || contactState.pending || contactState.conflict || contactState.workspaceChanged || contactState.activationFrozen ||
      !draftSession.canAcceptLocalInput() || !contactSession.canAcceptLocalInput()) {
      setError("Resolve the current QSO operation before selecting another spot."); return;
    }
    const generation = ++selection.current;
    pendingTune.current = true; setSelected(spot.id);
    setMessage(""); setError("");
    // A new selection discards only local, unsaved editor text. A pending write,
    // receipt, conflict, or native activation above remains fenced.
    if (!spotPreparation.current) {
      spotPreparation.current = (async () => {
        if (contactSession.getSnapshot().draft) contactSession.cancel();
        if (editorBufferPending.current) { editorInputState(false); setSpotEditorEpoch(value => value + 1); }
        if (draftSession.dirty) await draftSession.useShared();
      })().finally(() => { spotPreparation.current = null; });
    }
    void spotPreparation.current.then(() => {
      if (selection.current !== generation) return;
      activationStarted.current = true;
      return Promise.resolve(spotActivation.activate(spot)).finally(() => { activationStarted.current = false; });
    }).catch(cause => {
      const message = cause instanceof Error ? cause.message : "Spot activation is unavailable. Check its status before selecting again.";
      if (selection.current === generation && message !== "Check the existing spot activation before selecting another report.") setError(message);
    })
      .finally(() => { if (selection.current === generation) pendingTune.current = false; });
  };
  const liveSpots: Data[] = cluster?.snapshot?.spots || emptySpots;
  const mapTarget = useMemo(() => draft?.call && lookup?.call === draft.call &&
    typeof lookup?.latitude === "number" && typeof lookup?.longitude === "number"
      ? { call: draft.call, lat: lookup.latitude, lon: lookup.longitude, country: lookup.country, locationSource: lookup.location_source || lookup.source } : undefined,
    [draft?.call, lookup?.call, lookup?.latitude, lookup?.longitude, lookup?.country, lookup?.location_source, lookup?.source]);
  const stationWithRotor = { ...(station || { source: provider.current, radio: null }), rotor: rotorProjection(rotorState),
    rotor_control: rotorState, projection_received_at: Date.now() / 1000 };
  useEffect(() => {
    if (monitor) return;
    let active = true; const subscriptions: Array<() => void> = [];
    void Promise.allSettled([
      onDetachedDock(kind => { setView(kind === "dx-cluster" ? "DX Cluster" : kind === "world-map" ? "World Map" : "Band Maps"); }),
    ]).then(results => { for (const result of results) if (result.status === "fulfilled") { if (active) subscriptions.push(result.value); else result.value(); } });
    return () => { active = false; subscriptions.forEach(unlisten => unlisten()); };
  }, [request]);
  useEffect(() => {
    if (!monitor) void publishClusterSelection(selected).catch(() => {});
  }, [selected]);
  const mapSpots: Spot[] = useMemo(() => liveSpots.filter(s => typeof s.latitude === "number" && typeof s.longitude === "number").map(s => ({
    id: s.id, call: s.callsign, receivedAt: s.receivedAt, mhz: s.frequencyKHz / 1000, mode: s.mode, band: s.band,
    country: s.country, grid: "", lon: s.longitude, lat: s.latitude, reporter: s.spotter, note: s.comment,
    state: s.callStatus === "Confirmed" ? "confirmed" : s.callStatus === "Worked" ? "worked" : "needed",
    adif: s.adif, callStatus: s.callStatus, statusHex: s.statusHex, bandHex: s.bandHex,
  })), [liveSpots]);
  const map = <WorldMap data={mapSpots} selected={selected} palette={cluster?.configuration?.palette}
    home={stats?.map_home} dxccStatuses={stats?.dxcc_statuses}
    target={mapTarget} frequencyHz={station?.radio?.observed && station?.radio?.connected ? station.radio.frequency_hz : undefined}
    persistenceKey="main" onSpot={spot => { const real = liveSpots.find(s => s.id === spot.id); if (real) selectSpot(real); }} />;
  const automaticStationMetadata: Array<{ label: string; value: string; provenance: "observed" | "configured" | "selected" }> = [];
  if (settings?.stationCall) automaticStationMetadata.push({ label: "Station call", value: settings.stationCall, provenance: "configured" });
  if (settings?.gridSquare) automaticStationMetadata.push({ label: "Station grid", value: settings.gridSquare, provenance: "configured" });
  if (station?.radio?.connected && station.radio.observed) {
    if (typeof station.radio.frequency_hz === "number" && Number.isFinite(station.radio.frequency_hz)) automaticStationMetadata.push({ label: "Radio frequency", value: `${frequency(station.radio.frequency_hz)} MHz`, provenance: "observed" });
    if (station.radio.mode) automaticStationMetadata.push({ label: "Radio mode", value: station.radio.mode, provenance: "observed" });
  }
  const deskProps = { draftLocked: editorLocked, canAcceptLocalInput: acceptsInput, onLocalInputState: editorInputState, resetInputEpoch: spotEditorEpoch,
    referenceEvidence, cwControls, equipment: settings?.stationEquipment, draft, setDraft: setOperatorDraft, save,
    clear: () => void run(clear), busy: busy || editorBlocked, lookup, previous, request, refresh, onEditor: () => setView("Log QSO"),
    onReadRadio: readRadioIntoDraft, follow, setFollow: setFollowImmediate, rotor: rotorState,
    rotorConfigured: hasConfiguredRotor(rotorConfigurationState.base?.configuration), autoRotor, setAutoRotor: changeAutoRotor,
    onManualRotor: disarmAutoRotor, isEditing: editing.current, intelligenceBands: workspacePreferences?.intelligenceBands };
  const deskEquipment = equipmentProfile(settings?.stationEquipment), deskKind = deskEquipmentKind(deskEquipment, rotorState, hasConfiguredRotor(rotorConfigurationState.base?.configuration));
  const deskBands = <BandMaps spots={liveSpots} onSelect={selectSpot} radioFrequencyHz={station?.radio?.frequency_hz} compact preferences={workspacePreferences ? bandMapView(workspacePreferences, true) : undefined} onPreferencesChange={value => changeBandMapPreferences(true, value)} />;
  return <div className="app live">
    <header className="station-rail main-station-rail"><strong className="brand teal"><img src={appLogo} alt="" width={32} height={32} />OM0RX-xLog</strong><strong className="cyan rail-frequency">{frequency(station?.radio?.frequency_hz)} MHz · {station?.radio?.mode || "Radio offline"}</strong>
      <span className={station?.radio?.connected ? "teal" : "amber"}>{station?.radio?.connected ? "Connected" : "Disconnected"}</span>
      <span className="rail-cluster-count">{cluster?.snapshot?.connectedClusters || 0} clusters · {liveSpots.length} spots</span>
      <SpotActivationStatus inline status={spotActivation.status && spotActivation.status.phase !== "idle" ? spotActivation.status : spotEditor.status} reconcile={() => {}} />
      {workspace?.workspace_exists && <SharedPropagationConditions compact request={request} weatherKey={settings?.gridSquare || ""} />}
      <span className="rail-end">{stats?.stats?.qso_count?.toLocaleString() ?? "—"} contacts · Integrated logbook</span>
    </header>
    <aside className="sidebar" style={separateWindows ? { display: "none" } : undefined}><nav>{navigation.map(([name, Icon], i) => <div key={name}>{(i === 0 || name === "Station Control") && <div className="nav-group">{i === 0 ? "Station log" : "Services"}</div>}<button aria-current={view === name ? "page" : undefined} onClick={() => setView(name)}><Icon size={17} />{name}</button></div>)}</nav>
      <SidebarStation snapshot={stationWithRotor} provider={stationProvider} busy={busy} onAction={action => {
        if(nativeStationSelection())void amplifierTransitionSession().transition(action as "operate"|"standby").catch(()=>{});
        else void run(async()=>{await request("station_action",{action});});
      }} />
      {nativeStationSelection() && stationProvider === "direct_agent" && view !== "Station Control" && <AmplifierTransitionStatus />}
      <div className="sidebar-foot"><button onClick={() => void openMonitor().catch(e => setError(e.message))}><ExternalLink size={16} />Monitor</button><strong className="teal">{settings?.stationCall || "Station not configured"}</strong><span>{settings?.gridSquare || "Set station grid"}</span></div>
    </aside>
    <main className="qso-feedback-area live-feedback-host" aria-label={separateWindows ? "Separate Windows" : view} style={separateWindows ? { gridColumn: "1 / -1" } : undefined}>
      <StableFeedbackLayer>
      {error && <div className="live-error" role="alert">{error}<button onClick={() => setError("")}>Dismiss</button></div>}
      {workspaceMode(deskLayout.state.snapshot) === "windows" && recoveryVisible && (configurationRecovery || layoutRecovery) &&
        <div className="live-error" role="alert" aria-label="Workspace recovery">
          <span>{settingsState.error || rotorConfigurationState.error || deskLayout.state.error || "Configuration or workspace changes need review."}</span>
          <button type="button" onClick={() => setView("Settings")}>Review Settings</button>
        </div>}
      {readOperation.current && <button type="button" disabled={radioBusy} onClick={() => void checkReadRadio()}>Check Read radio</button>}
      <SpotActivationStatus status={spotActivation.status && spotActivation.status.phase !== "idle" ? spotActivation.status : spotEditor.status} error={spotEditor.error || spotActivation.error} checking={spotActivation.requesting}
        retire={() => { void Promise.resolve(spotActivation.retire()).then(async retired => { if (retired) { await spotEditor.reconcile(); setError(""); } }); }}
        reconcile={() => { if (sharedDraft.activationFrozen || contactEdit.activationFrozen) void spotEditor.reconcile(); else void spotActivation.reconcile(); }} />
      {nativeAutoRotor.error && <p className="live-error" role="status">{nativeAutoRotor.error}</p>}
      {nativeFollow.error && <p className="live-error" role="status">{nativeFollow.error}</p>}
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
        <button type="button" disabled={!acceptsInput()} onClick={() => { if (!acceptsInput()) return; localStorage.removeItem("xlog.integration.draft"); setLegacyDraft(null); }}>Discard previous draft</button>
      </div>}
      {message && !message.endsWith("· radio frequency and mode confirmed") && <p className="live-message" role="status">{message}</p>}
      </StableFeedbackLayer>
      {loggedFeedback.toast}
      <WorkspaceModeSurface separateWindows={separateWindows}>
      {!workspace?.workspace_exists && <>
        {view === "Settings" && <section className="service-settings" aria-label="Settings recovery">
          <h2>Settings</h2>
          <p>Radio connection setup is available below. Logbook settings will be available after your workspace reconnects.</p>
          <AgentConnectionSetup providers connections followSelection />
        </section>}
        <WorkspaceGate workspace={workspace} pending={workspacePending} busy={busy}
          retry={() => void run(reload)} create={mode => void run(async () => { await request("workspace_create", { mode }); await reload(); })} />
      </>}
      {/* Spot History only reads archive diagnostics; editors still require a verified workspace. */}
      {(workspace?.workspace_exists === true || view === "Spot History") && <>
      {view === "Operator Desk" && <OperatorCanvas {...deskLayout} equipment={deskKind === "none" ? undefined : deskKind}
        canChangeLayout={() => !logbookWorkingRef.current && !editorBufferPending.current && !mainClosing.current && !editorTransition.current && draftSession.canAcceptLocalInput() && contactSession.canAcceptLocalInput()}
        onChangeInFlight={value => { layoutChanging.current = value; }} panels={{
        "active-qso": { title: "Active QSO", content: <DeskQSO {...deskProps} /> },
        "callsign-intelligence": { title: "Callsign intelligence", content: <DeskIntelligence {...deskProps} /> },
        ...(deskKind === "rotor" ? { rotor: { title: "Rotor", content: <DeskRotor {...deskProps} />, required: !!rotorState?.owner,
          safetyAction: <button type="button" className="desk-stop" onClick={() => { disarmAutoRotor(); void request("rotor_stop", rotorCommandParams(rotorState)).then(() => setMessage("Stop accepted; watch the observed rotor state.")).catch(cause => setError(cause instanceof Error ? cause.message : "Rotor stop unavailable.")); }}>■ Stop rotor</button> } } : {}),
        ...(deskKind === "antenna" ? { antenna: { title: "Antenna", content: <DeskAntenna profile={deskEquipment} /> } } : {}),
        "world-map": { title: "World map", content: <div className="live-map">{map}</div> },
        "band-maps": { title: "Band maps", content: deskBands },
        "dx-cluster": { title: "DX Cluster", content: <ClusterPanel passive snapshot={cluster} selectedSpotId={selected} onRequest={request} onSelect={selectSpot} onUndock={() => void openDetachedCluster().catch(e => setError(e.message))} /> },
        logbook: { title: "Logbook", content: <LogbookPanel onRequest={request} refreshKey={refresh} mutations={logbookMutations} onWorkingChange={logbookWorkingChanged} onChanged={() => setRefresh(n => n + 1)} onUndock={() => void openDetachedLogbook().catch(cause => setError(cause.message))} onEdit={editLoggedContact} /> },
        awards: { title: "Awards", content: <IntegratedAwards request={panelRequest} refresh={refresh} initialStats={stats?.awards} onUndock={() => void openDetachedAwards().catch(cause => setError(cause.message))} /> },
        "spot-history": { title: "Spot History", content: <SpotHistoryPanel request={request} /> },
      }} traditional={<><OperatorDesk {...deskProps} /><div className="live-desk-bottom"><OperatorWorkspace map={<DeskMapLogbook map={<div className="live-map">{map}</div>}
        logbook={<LogbookPanel columnContext="desk" onRequest={request} refreshKey={refresh} mutations={logbookMutations}
          disabled={editorLocked || busy || editorBufferPending.current || editorTransition.current}
          onWorkingChange={logbookWorkingChanged} onChanged={() => setRefresh(n => n + 1)} onUndock={() => void openDetachedLogbook().catch(cause => setError(cause.message))} onEdit={editLoggedContact} />}
        busy={logbookWorking || logbookMutation.busy || !!logbookMutation.pending}
        canChangeView={() => !logbookWorkingRef.current && !mainClosing.current && !layoutChanging.current && !editorTransition.current && !logbookMutations.getSnapshot().busy && !logbookMutations.getSnapshot().pending} />}
        cluster={cluster} selectedSpotId={selected} onSelect={selectSpot} bandMaps={deskBands} /></div></>} />}
      {view === "Log QSO" && <QSOEditor resetInputEpoch={spotEditorEpoch} referenceEvidence={referenceEvidence} draftLocked={editorLocked} draft={draft} setDraft={setOperatorDraft} save={save} clear={() => void run(clear)} busy={busy || editorBlocked} lookup={lookup} previous={previous} follow={follow} setFollow={setFollowImmediate} request={request} onReadRadio={readRadioIntoDraft} isEditing={editing.current} automaticStationMetadata={automaticStationMetadata}
        clearLabel={editing.current ? "Cancel edit" : "Clear QSO"}
        contactActions={contactEdit.base && <ContactDeleteAction snapshot={contactEdit.base} mutations={logbookMutations}
          disabled={busy || editorBlocked} run={run} onDeleted={() => { contactSession.cancel(); setRefresh(n => n + 1); setView("Logbook"); }} />}
        canAcceptLocalInput={acceptsInput}
        powerState={editing.current ? undefined : sharedDraft.base?.power} powerIntent={editing.current ? undefined : sharedDraft.powerIntent}
        automaticPowerEnabled={settings?.automaticTransmitPower === true}
        onManualPower={!editing.current && typeof settings?.automaticTransmitPower === "boolean" ? setManualDraftPower : undefined}
        onResumeAutomaticPower={!editing.current && sharedDraft.base?.power ? () => void run(async () => { draftSession.resumeAutomaticPower(); await draftSession.flush(); }) : undefined}
        onLocalInputState={editorInputState}
        onUndock={!editing.current ? () => void run(async () => { await draftSession.flush(); await openDetachedQSO(); }) : undefined} />}
      {view === "Logbook" && <LogbookPanel onRequest={request} refreshKey={refresh} mutations={logbookMutations} onWorkingChange={logbookWorkingChanged} onChanged={() => setRefresh(n => n + 1)} onUndock={() => void openDetachedLogbook().catch(cause => setError(cause.message))} onEdit={editLoggedContact} />}
      {view === "DX Cluster" && <ClusterPanel passive snapshot={cluster} selectedSpotId={selected} onRequest={request} onSelect={selectSpot} onUndock={() => void openDetachedCluster().catch(e => setError(e.message))} />}
      {view === "Chaser & DX" && <OpportunitiesPanel request={panelRequest} refresh={refresh} onSelect={loadOpportunity} home={stats?.map_home} />}
      {view === "Spot History" && <SpotHistoryPanel request={request} />}
      {view === "World Map" && <><div className="live-actions"><button type="button" onClick={() => void openDetachedMap("world-map").catch(e => setError(e.message))}><ExternalLink size={14} />Undock World Map</button></div><div className="live-map full">{map}</div></>}
      {view === "Band Maps" && <BandMaps spots={liveSpots} onSelect={selectSpot} radioFrequencyHz={station?.radio?.frequency_hz} onUndock={() => void openDetachedMap("band-maps").catch(e => setError(e.message))} preferences={workspacePreferences ? bandMapView(workspacePreferences, false) : undefined} onPreferencesChange={value => changeBandMapPreferences(false, value)} />}
      {view === "Station Control" && <><div className="live-tabs" role="group" aria-label="Station sections">{["Control and connections", "RUMlog spots", "WSJT-X logging"].map(section => <button key={section} aria-pressed={stationSection === section} onClick={() => setStationSection(section)}>{section}</button>)}</div>
        {stationSection === "RUMlog spots" ? <SpotBridgePanel request={request} provider={stationProvider} /> : stationSection === "WSJT-X logging" ? <WSJTXPanel request={request} onImported={() => setRefresh(n => n + 1)} /> : <><div className="live-station-provider" role="group" aria-label="Radio connection type">
        {([ ["direct_agent", "Remote station · embedded xCat"], ["direct_flex_lan", "Direct FLEX · LAN"], ["direct_tci", "Direct TCI · read only"], ["hamlib", "Local station · Hamlib"] ] as const).map(([id, label]) => <button key={id} className={viewProvider === id ? "selected" : ""} aria-pressed={viewProvider === id} disabled={busy} onClick={() => setViewProvider(id)}>{label}</button>)}
        {nativeStationSelection() ? <AgentConnectionSetup providers onlySelection selectionTarget={viewProvider} activeProvider={stationProvider} /> : <>{viewProvider !== stationProvider && <button type="button" disabled={busy} onClick={() => void applyProvider()}>Use {radioProviderLabels[viewProvider]}</button>}<span>Active · {radioProviderLabels[stationProvider]}</span></>}
        </div>
        {viewProvider === "direct_tci" ? <section className="live-station" aria-label="Direct TCI observations"><h2>Direct TCI · read only</h2>
          {stationProvider === viewProvider ? <><AgentConnectionSetup followSelection connections /><TCIObservation snapshot={station} /></> : <p>Apply Direct TCI selection to review its saved configuration.</p>}</section> : viewProvider === "hamlib" ? <HamlibPanel request={viewedStationRequest} snapshot={stationProvider === viewProvider ? station : null} /> :
          viewProvider === "direct_flex_lan" ? <DirectFlexPanel request={viewedStationRequest} snapshot={stationProvider === viewProvider ? station : null} /> :
          <StationPanel snapshot={stationProvider === viewProvider ? station : null} onRequest={viewedStationRequest} onSnapshot={value => { if (stationProvider === viewProvider && provider.current === viewProvider) setStation(value); }} independentRotor />}</>}</>}
      {view === "Awards" && <IntegratedAwards request={panelRequest} refresh={refresh} initialStats={stats?.awards} onUndock={() => void openDetachedAwards().catch(cause => setError(cause.message))} />}
      {view === "Settings" && settings && <ServiceSettings values={settings} savedValues={settingsState.base?.settings} request={request}
        onChanged={value => settingsSession.edit(value)} onSave={async value => { await settingsSession.save(value); await draftSession.refresh(); }}
        saving={settingsState.saving} pending={!!settingsState.pending} conflict={!!settingsState.conflict}
        workspaceChanged={settingsState.workspaceChanged} dirty={settingsDraftIsDirty(settingsState.base, settingsState.draft)} sessionError={settingsState.error}
        onReconcile={async () => { try { await settingsSession.reconcile(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Settings receipt could not be checked."); } }}
        onRetry={async () => { try { await settingsSession.retry(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Settings save could not be retried."); } }}
        onUseSaved={() => { try { settingsSession.useSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Saved Settings could not be restored."); } }}
        requestedTab={settingsTabRequest.tab} requestedTabRevision={settingsTabRequest.revision} syncSettings={settings.logbookMode === "local" ? <p>Integrated-only mode. Wavelog synchronization is disabled. Choose Integrated logbook + Wavelog synchronization in Settings → Logbook to enable it.</p> : <SyncPanel request={request} onChanged={() => setRefresh(n => n + 1)} />} onExternalContact={() => setRefresh(n => n + 1)} cwContext={cwContext} cwState={cw.state} cwProvider={stationProvider} refreshCW={() => cw.controller.pollWinKeyer()} rotorSettings={<RotorPanel snapshot={rotorState} request={request} onManual={disarmAutoRotor} configurationSession={rotorConfigurationSession} automaticRotorArmed={autoRotor} automaticRotorAvailable={!!nativeAutoRotor.state && !nativeAutoRotor.error && !!rotorState?.owner && Number.isSafeInteger(rotorState.generation)} automaticRotorError={nativeAutoRotor.error} onAutomaticRotorChange={setAutomaticRotor} />} clusterSettings={<ClusterPanel settingsOnly snapshot={null} onRequest={request} onSelect={() => {}} />} workspaceSettings={<WorkspaceSettings {...deskLayout} equipment={deskKind === "none" ? undefined : deskKind} requiredRotor={deskKind === "rotor" && !!rotorState?.owner} available={["active-qso", "callsign-intelligence", "world-map", "band-maps", "dx-cluster", "logbook", "awards", "chaser-dx", "spot-history", ...(deskKind === "none" ? [] : [deskKind] as ("rotor" | "antenna")[])]} />} dataRequest={dataManagementRequest} onDataChanged={() => { setDraft(null); setStats(null); latestWorkspacePreferences.current = null; setWorkspacePreferences(null); setRefresh(n => n + 1); }} />}
      </>}
      </WorkspaceModeSurface>
    </main></div>;
}

function SidebarStation({ snapshot, provider, busy, onAction }: { snapshot: Data | null; provider: StationProvider; busy: boolean; onAction: (action: string) => void }) {
  const s = snapshot?.station, local = provider === "hamlib", flex = provider === "direct_flex_lan", tci = provider === "direct_tci";
  const detail = (text: string | undefined, prefix: string) => text?.split(/[|·]/).map(v => v.trim()).find(v => v.toUpperCase().startsWith(prefix + " "))?.slice(prefix.length).trim();
  const band = (text: string | undefined) => text?.split(/[|·]/).map(v => v.trim()).find(v => /^\d+(\.\d+)?[cm]+$/i.test(v));
  const antenna = s?.kat_detail_primary?.match(/\bANT\s*\d+\b/)?.[0];
  const action = s?.kpa_operate ? "standby" : "operate";
  const items = flex || tci ? [["FREQUENCY", frequency(snapshot?.radio?.frequency_hz), "cyan"],
      ["MODE", snapshot?.radio?.mode || "—", "teal"],
      ["RX VFO", snapshot?.radio?.receive_vfo || "—", "cyan"],
      ["TX", snapshot?.radio?.transmitting === true ? "ACTIVE" : snapshot?.radio?.transmitting === false ? "IDLE" : "UNKNOWN", snapshot?.radio?.transmitting === true ? "orange" : "teal"]]
    : local ? [["FREQUENCY", frequency(snapshot?.radio?.frequency_hz), "cyan"], ["MODE", snapshot?.radio?.mode || "—", "teal"], ["ROTOR", snapshot?.rotor?.azimuth == null ? "—" : `${Math.round(snapshot.rotor.azimuth)}°`, "cyan"]]
    : [["OUTPUT", detail(s?.kpa_detail_primary, "OUT") || (s?.tx_power_watts == null ? "—" : `${s.tx_power_watts} W`), "orange"],
      [s?.swr_is_live ? "SWR LIVE" : "SWR LAST", s?.swr?.toFixed(2) || "—", "teal"], ["KPA BAND", band(s?.kpa_detail_primary) || s?.band || "—", "amber"],
      ["KPA TEMP", detail(s?.kpa_detail_secondary, "TEMP") || "—", "amber"], ["KAT BAND", band(s?.kat_detail_primary) || s?.band || "—", "cyan"], ["ANTENNA", antenna || "—", "cyan"]];
  return <section className="live-station-brief"><div className="nav-group">Station</div><strong className={local || flex || tci ? "cyan" : "amber"}>{tci ? "DIRECT TCI · READ ONLY" : flex ? `DIRECT FLEX · ${snapshot?.radio?.connected ? "CONNECTED" : "OFFLINE"}` : local ? "LOCAL · HAMLIB" : `KPA500 · ${s?.kpa_operate == null ? "OFFLINE" : s.kpa_operate ? "OPERATE" : "STANDBY"}`}</strong>
    {tci && <p>Direct TCI · read only</p>}
    {!local && !flex && !tci && <><button className={s?.kpa_operate ? "teal" : "orange"} disabled={nativeStationSelection() && action === "standby" ? false : busy || !s?.allowed_actions?.includes(action)} onClick={() => onAction(action)}>Switch to {action}</button>{nativeStationSelection() && action !== "standby" && <button onClick={()=>onAction("standby")}>Standby</button>}</>}
    <div className="sidebar-metrics">{items.map(([title, text, color]) => <div key={title} className={color}><small>{title}</small><b>{text}</b></div>)}</div></section>;
}

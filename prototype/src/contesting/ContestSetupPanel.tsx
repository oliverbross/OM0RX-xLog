import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { contestKeyBindingActions, contestKeyBindingContexts, contestKeyBindingDescriptions, defaultContestKeyBindings,
  encodeContestKeyBindings, readContestKeyBindings, validateContestKeyBindings, type ContestKeyBinding } from "./contestKeyBindings";
import { ContestVoiceRecorder, inspectContestVoiceProfile, pickContestVoiceProfile, previewContestVoiceSlot, saveContestVoiceSlot,
  type ContestVoiceProfileSlot } from "./contestVoiceProfile";
import "./ContestSetupPanel.css";

export type ContestSetupMacro = { mode: "R" | "S"; key: string; label: string; template: string };
export type ContestSetupDocument = {
  name: string; operator: string; pluginID: string;
  station: Record<string, string | number>;
  settings: Record<string, string | number>;
  preferences: Record<string, string | number | boolean | string[]>;
  network: Record<string, string | number | boolean>;
  macros: ContestSetupMacro[];
};
export type ContestSetupSession = { sessionID: string; name: string; pluginID: string; workspaceGeneration: string; revision: number; startUTC?: string };
export type ContestSetupServiceTab = "Station" | "QRZ" | "Radio" | "CW" | "Cluster" | "Integrations" | "Rotator";
export const contestSetupTabs = ["Lookup", "Sound", "CAT", "CW", "Rotator", "Cluster", "Group", "N1MM", "Bands", "Options"] as const;
export type ContestSetupTab = typeof contestSetupTabs[number];
export type ContestAudioOutput = { deviceID: string; label: string };
export type ContestAudioInput = { deviceID: string; label: string };
export type ContestSetupCatalogEntry = { id: string; name: string; modes?: string[]; supportedBands?: string[]; sentExchangeHint?: string; overlayChoices?: string[] };
export type SetupView = "Station Settings" | "New Contest" | "Choose a Contest" | "Edit Current Contest" | "Configuration Settings" | "Digital Setup" | "Edit Macros" | "Edit Keys";
const setupViews: SetupView[] = ["Station Settings", "New Contest", "Choose a Contest", "Edit Current Contest", "Configuration Settings", "Digital Setup", "Edit Macros", "Edit Keys"];
const cqWWVHFModeCategories = ["CW", "SSB", "FM", "DIGITAL", "SSB+CW", "SSB+CW+DIGITAL"];
const digitalModeAliases = new Set(["RTTY", "RTTY-R", "LSB-D", "USB-D", "AM-D", "FM-D", "DIGI-U", "DIGI-L", "RTTYR", "PKTLSB", "PKTUSB"]);
const cqWWStationZonePlugins = new Set(["cq_ww_cw", "cq_ww_ssb"]);
function setupModeChoices(plugin?: { id: string; modes?: string[] }): string[] {
  if (plugin?.id === "cq_ww_vhf") return cqWWVHFModeCategories;
  const modes = plugin?.modes ?? [];
  return modes.length > 1 ? [...modes, ...(modes.includes("MIXED") || modes.every(mode => digitalModeAliases.has(mode)) ? [] : ["MIXED"])]
    : modes.length ? modes : ["CW", "SSB", "RTTY", "MIXED", "DIGI"];
}
type Props = {
  value: ContestSetupDocument; sessions: ContestSetupSession[]; activeSessionID?: string;
  effectiveMacros?: ContestSetupMacro[];
  catalog: ContestSetupCatalogEntry[];
  busy?: boolean; newContestDisabled?: boolean; error?: string; initialTab?: ContestSetupTab | "Station" | "Contest" | "N1MM+" | "Call History" | "Macros" | "Key bindings" | "Digital" | "Multi-Multi";
  onSave: (value: ContestSetupDocument) => Promise<void>;
  onCreate: (value: ContestSetupDocument) => Promise<void>;
  onOpen: (session: ContestSetupSession) => Promise<void>;
  onOpenSettings?: (tab: ContestSetupServiceTab) => void | Promise<void>;
  servicePanels?: Partial<Record<ContestSetupServiceTab, ReactNode>>;
  callHistoryPanel?: ReactNode;
  onOpenCallHistory?: () => void;
  onOpenDialog?: (kind: "station" | "configuration" | "digital" | "macros" | "keys") => void | Promise<void>;
  onContentChange?: () => void;
  onViewChange?: (view: SetupView | null) => void;
  detachedDialog?: "station" | "configuration" | "macros" | "keys";
  onCancel?: () => void | Promise<void>;
};

export function newContestSetup(stationCall = ""): ContestSetupDocument {
  return { name: "CQ WW CW", operator: stationCall, pluginID: "cq_ww_cw",
    station: { Call: stationCall, Name: "", Email: "", Street1: "", Street2: "", City: "", State: "", Zip: "", Country: "", GridSquare: "", CQZone: "15", IARUZone: "", LicenseClass: "", Latitude: "", Longitude: "", STXeq: "", SPowe: "", SAnte: "", SAntH1: "", SAntH2: "", ARRLSection: "", RoverQTH: "", Club: "" },
    settings: { StartDate: "", StationCategory: "FIXED", SentExchange: "", OperatorCategory: "SINGLE-OP", AssistedCategory: "NON-ASSISTED", BandCategory: "ALL", PowerCategory: "HIGH", ModeCategory: "CW", TransmitterCategory: "ONE", OverlayCategory: "N/A", Soapbox: "" },
    preferences: { cwSpeed: 25, cwSpeedStep: 1, cwRSTFormat: "5NN", cwSerialPaddingCharacter: "T", cwSerialPaddingLength: 3,
      cwSerialOne: "1", cwSerialNine: "9", cwSerialZero: "0", rtcEnabled: false, rtcURL: "https://hamscore.com/postxml/", rtcUsername: "", rtcIntervalMinutes: 2,
      bands: ["160m", "80m", "40m", "20m", "15m", "10m"], useESM: false, sendCorrectedCall: false,
      esmCQ: "DISABLED", esmExchange: "DISABLED", esmQRZ: "DISABLED", esmAGN: "DISABLED", esmHisCall: "DISABLED", esmMyCall: "DISABLED", esmQsoB4: "DISABLED", autoCQ: false, autoCQDelay: 15,
      spaceTabs: true, prefillExchange: true, callHistory: true, clearOnVFOChange: false, scp: true, showQRZDetails: false, darkMode: true,
      keyESM: "Enter", keyLog: "Ctrl+Enter", keyStop: "Escape", keyWipe: "Alt+W", keyRun: "Alt+R", keySearch: "Alt+S" }, network: { stationName: "", groupHost: "", groupPort: 12060,
      n1mmHost: "127.0.0.1", n1mmRadioPort: 12060, n1mmContactPort: 12061, n1mmLookupPort: 12062, n1mmRadio: false, n1mmContact: false,
      n1mmLookup: false, n1mmScore: false, n1mmEnabled: false, n1mmStationName: "", n1mmOperatorName: "", multicastGroup: "239.1.1.1", multicastPort: 2239, interface: "0.0.0.0", multiEnabled: false, multiMaster: false }, macros: [] };
}

export function restoredESMPreferences(preferences: ContestSetupDocument["preferences"]): ContestSetupDocument["preferences"] {
  // Existing documents predate effective ESM settings and used these fixed roles.
  return { useESM: true, sendCorrectedCall: true, esmCQ: "F1", esmExchange: "F3", esmQRZ: "F4", esmAGN: "F9", esmHisCall: "F2", esmMyCall: "F5", esmQsoB4: "DISABLED", ...preferences };
}

export async function loadContestAudioOutputs(enumerateDevices?: () => Promise<MediaDeviceInfo[]>): Promise<ContestAudioOutput[]> {
  const enumerate = enumerateDevices ?? (typeof navigator === "undefined" ? undefined : navigator.mediaDevices?.enumerateDevices?.bind(navigator.mediaDevices));
  if (!enumerate) return [];
  const outputs = await enumerate(), seen = new Set<string>();
  return outputs.filter(device => device.kind === "audiooutput" && !seen.has(device.deviceId) && seen.add(device.deviceId))
    .map((device, index) => ({ deviceID: device.deviceId, label: device.label || `Audio output ${index + 1}` }));
}

export async function loadContestAudioInputs(enumerateDevices?: () => Promise<MediaDeviceInfo[]>): Promise<ContestAudioInput[]> {
  const enumerate = enumerateDevices ?? (typeof navigator === "undefined" ? undefined : navigator.mediaDevices?.enumerateDevices?.bind(navigator.mediaDevices));
  if (!enumerate) return [];
  const inputs = await enumerate(), seen = new Set<string>();
  return inputs.filter(device => device.kind === "audioinput" && !seen.has(device.deviceId) && seen.add(device.deviceId))
    .map((device, index) => ({ deviceID: device.deviceId, label: device.label || `Microphone ${index + 1}` }));
}

function setupDraft(value: ContestSetupDocument): ContestSetupDocument {
  const defaults = newContestSetup(String(value.station.Call ?? ""));
  const result = structuredClone({ ...defaults, ...value, station: { ...defaults.station, ...value.station }, settings: { ...defaults.settings, ...value.settings }, preferences: { ...defaults.preferences, ...restoredESMPreferences(value.preferences) }, network: { ...defaults.network, ...value.network } });
  if (!String(result.settings.OverlayCategory ?? "").trim()) result.settings.OverlayCategory = "N/A";
  if (result.network.multicastGroup === "224.1.1.1") result.network.multicastGroup = "239.1.1.1";
  for (const kind of ["Radio", "Contact", "Lookup", "Score"]) {
    const key = "n1mm" + kind + "Destinations";
    if (result.network[key] === undefined) result.network[key] = String(value.network.n1mmHost ?? "127.0.0.1") + ":" + String(value.network["n1mm" + kind + "Port"] ?? 12060);
  }
  return result;
}

function currentUTCStart(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

/** Controlled, service-agnostic editor: the owner supplies revisioned durable saves. */
export function ContestSetupPanel({ value, sessions, activeSessionID, catalog, busy = false, newContestDisabled = false, error = "", initialTab = "Contest",
  onSave, onCreate, onOpen, onOpenSettings, servicePanels, callHistoryPanel, onOpenCallHistory, effectiveMacros, onOpenDialog, onContentChange, onViewChange, detachedDialog, onCancel }: Props) {
  const [draft, setDraft] = useState<ContestSetupDocument>(() => setupDraft(value));
  const [view, setView] = useState<SetupView | null>(initialTab === "Contest" ? null : initialTab === "Station" ? "Station Settings" : initialTab === "Macros" ? "Edit Macros" : initialTab === "Key bindings" ? "Edit Keys" : "Configuration Settings");
  const [tab, setTab] = useState<ContestSetupTab>(contestSetupTabs.includes(initialTab as ContestSetupTab) ? initialTab as ContestSetupTab : initialTab === "N1MM+" ? "N1MM" : initialTab === "Multi-Multi" ? "Group" : initialTab === "Call History" ? "Options" : "Lookup"), [message, setMessage] = useState("");
  const [selectedSession, setSelectedSession] = useState(activeSessionID ?? "");
  const [selectedBinding, setSelectedBinding] = useState(0);
  const [audioOutputs, setAudioOutputs] = useState<ContestAudioOutput[] | null>(null);
  const [audioInputs, setAudioInputs] = useState<ContestAudioInput[] | null>(null), [audioInput, setAudioInput] = useState("");
  const [audioOutputError, setAudioOutputError] = useState("");
  const [voiceSlots, setVoiceSlots] = useState<ContestVoiceProfileSlot[]>([]), [recordingSlot, setRecordingSlot] = useState("");
  const [replaceSlot, setReplaceSlot] = useState(""), recorderRef = useRef<ContestVoiceRecorder | null>(null), recordingSlotRef = useRef("");
  const [pending, setPending] = useState(false), pendingRef = useRef(false);
  const id = useId();
  useEffect(() => { setDraft(setupDraft(value)); }, [value]);
  useEffect(() => {
    if (contestSetupTabs.includes(initialTab as ContestSetupTab)) { setTab(initialTab as ContestSetupTab); setView("Configuration Settings"); }
  }, [initialTab]);
  useEffect(() => {
    if (view !== "Configuration Settings" || tab !== "Sound" || audioOutputs !== null) return;
    let current = true;
    void Promise.all([loadContestAudioOutputs(), loadContestAudioInputs()]).then(([outputs, inputs]) => {
      if (current) { setAudioOutputs(outputs); setAudioInputs(inputs); }
    })
      .catch(cause => { if (current) { setAudioOutputs([]); setAudioInputs([]); setAudioOutputError(cause instanceof Error ? cause.message : "Audio devices could not be listed."); } });
    return () => { current = false; };
  }, [view, tab, audioOutputs]);
  useEffect(() => {
    const profilePath = String(draft.preferences.voiceProfilePath ?? "").trim();
    if (view !== "Configuration Settings" || tab !== "Sound" || !profilePath || !("__TAURI_INTERNALS__" in window)) return;
    let current = true;
    void inspectContestVoiceProfile(profilePath).then(manifest => { if (current) setVoiceSlots(manifest.slots); })
      .catch(() => { if (current) setVoiceSlots([]); });
    return () => { current = false; };
  }, [view, tab, draft.preferences.voiceProfilePath]);
  useEffect(() => () => recorderRef.current?.cancel(), []);
  useEffect(() => {
    if (view === "Configuration Settings" && tab === "Sound") return;
    recorderRef.current?.cancel(); recorderRef.current = null; recordingSlotRef.current = ""; setRecordingSlot(""); setReplaceSlot("");
  }, [view, tab]);
  useEffect(() => { onViewChange?.(view); }, [view, onViewChange]);
  const disabled = busy || pending;
  const selectConfigurationTab = (next: ContestSetupTab) => { setTab(next); onContentChange?.(); };
  const update = (section: "station" | "settings" | "preferences" | "network", key: string, next: string | number | boolean | string[]) =>
    setDraft(current => ({ ...current, [section]: { ...current[section], [key]: next } }));
  const field = (section: "station" | "settings" | "preferences" | "network", key: string, label: string, type = "text", choices?: string[], locked = false) => {
    const current = draft[section][key];
    return <label key={`${section}-${key}`} className="contest-setup-field"><span title={label}>{label}</span>{choices ? <select value={String(current ?? "")} disabled={locked} onChange={event => update(section, key, event.target.value)}>{choices.map(choice => <option key={choice} value={choice}>{choice || "None"}</option>)}</select>
      : <input type={type} value={String(current ?? "")} maxLength={512} min={type === "number" ? 0 : undefined} max={type === "number" ? 65535 : undefined}
        onChange={event => update(section, key, type === "number" ? event.target.value === "" ? "" : Number(event.target.value) : event.target.value)}/> }</label>;
  };
  const check = (section: "preferences" | "network", key: string, label: string) => <label key={key} className="contest-setup-check"><input type="checkbox" checked={draft[section][key] === true} onChange={event => update(section, key, event.target.checked)}/><span>{label}</span></label>;
  const shared = (service: ContestSetupServiceTab, label: string = service) => servicePanels?.[service] ?? (onOpenSettings ? <button type="button" onClick={() => void run(async () => { await onOpenSettings(service); }, "")}>Open xLog {label} settings</button> : null);
  const managed = (service: ContestSetupServiceTab, description: string, label: string = service) => <div className="contest-manual-stack">
    <p role="status">Managed by xLog {label} settings. {description}</p>
    {shared(service, label) ?? <p>Open these settings in the main xLog application.</p>}
    <p>Save here applies contest preferences only. Existing contest service fields are retained without applying them.</p>
  </div>;
  async function run(operation: () => Promise<void>, success: string) {
    if (disabled || pendingRef.current) return;
    pendingRef.current = true; setPending(true); setMessage("");
    try { await operation(); setMessage(success); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Setup could not be saved."); }
    finally { pendingRef.current = false; setPending(false); }
  }
  const refreshVoiceProfile = async (profilePath = String(draft.preferences.voiceProfilePath ?? "")) => {
    if (!profilePath.trim()) { setVoiceSlots([]); return; }
    const manifest = await inspectContestVoiceProfile(profilePath); setVoiceSlots(manifest.slots);
  };
  const chooseVoiceProfile = () => void run(async () => {
    const selected = await pickContestVoiceProfile(); if (!selected) return;
    update("preferences", "voiceProfilePath", selected); await refreshVoiceProfile(selected);
  }, "Voice profile ready.");
  const stopVoiceRecording = async (slot: string, overwrite: boolean) => {
    const recorder = recorderRef.current; if (!recorder || recordingSlotRef.current !== slot) return;
    pendingRef.current = true; setPending(true); setMessage("");
    try { const wav = await recorder.stop(); recorderRef.current = null;
      await saveContestVoiceSlot(String(draft.preferences.voiceProfilePath ?? ""), slot, wav, overwrite);
      setReplaceSlot(""); await refreshVoiceProfile(); setMessage(`${slot.toUpperCase()} recording saved.`);
    } catch (cause) { recorder.cancel(); recorderRef.current = null;
      setMessage(cause instanceof Error ? cause.message : "Voice recording could not be saved.");
    } finally { recordingSlotRef.current = ""; setRecordingSlot(""); pendingRef.current = false; setPending(false); }
  };
  const startVoiceRecording = async (slot: string) => {
    if (recordingSlot || pendingRef.current) return;
    const profilePath = String(draft.preferences.voiceProfilePath ?? "");
    if (!profilePath.trim()) { setMessage("Choose a voice WAV profile folder before recording."); return; }
    const exists = voiceSlots.find(item => item.slot === slot)?.present === true;
    if (exists && replaceSlot !== slot) { setReplaceSlot(slot); setMessage(`Click Replace ${slot.toUpperCase()} to confirm overwriting that recording.`); return; }
    const overwrite = exists; const recorder = new ContestVoiceRecorder(); recorderRef.current = recorder; setMessage("");
    try { const limitMs = await recorder.start(audioInput); recordingSlotRef.current = slot; setRecordingSlot(slot);
      window.setTimeout(() => { if (recorderRef.current === recorder) void stopVoiceRecording(slot, overwrite); }, limitMs);
    } catch (cause) { recorder.cancel(); recorderRef.current = null; setMessage(cause instanceof Error ? cause.message : "Microphone recording could not start."); }
  };
  const mapVoiceSlot = (mode: "R" | "S", slot: string) => {
    const source = draft.macros.find(item => item.mode === mode && item.key.toLowerCase() === slot) ??
      effectiveMacros?.find(item => item.mode === mode && item.key.toLowerCase() === slot);
    const replacement: ContestSetupMacro = { mode, key: slot.toUpperCase(), label: source?.label || slot.toUpperCase(), template: `[${slot}]` };
    setDraft(current => ({ ...current, macros: [...current.macros.filter(item => !(item.mode === mode && item.key.toLowerCase() === slot)), replacement] }));
    setMessage(`${slot.toUpperCase()} ${mode === "R" ? "Run" : "S&P"} macro will use [${slot}] after Save.`);
  };
  function close() { recorderRef.current?.cancel(); recorderRef.current = null; recordingSlotRef.current = ""; setRecordingSlot(""); setReplaceSlot(""); setDraft(setupDraft(value)); setMessage(""); setView(null); }
  function open(next: SetupView) {
    const source = setupDraft(value);
    setDraft(next === "New Contest" ? { ...source,
      settings: { ...source.settings, StartDate: currentUTCStart(), SentExchange: "" } } : source);
    setMessage(""); setView(next); setSelectedSession(activeSessionID ?? "");
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const document = structuredClone(draft);
      const stationCQZone = String(document.station.CQZone ?? "").trim();
      if (view === "Station Settings" || cqWWStationZonePlugins.has(document.pluginID)) {
        if (!/^\d+$/.test(stationCQZone) || Number(stationCQZone) < 1 || Number(stationCQZone) > 40)
          throw new Error("Station CQ Zone must be a whole number from 1 to 40.");
        document.station.CQZone = stationCQZone;
      }
      if (cqWWStationZonePlugins.has(document.pluginID)) document.settings.SentExchange = stationCQZone;
      const autoCQDelay = Number(document.preferences.autoCQDelay ?? 15);
      if (!Number.isFinite(autoCQDelay) || autoCQDelay < 1 || autoCQDelay > 3600)
        throw new Error("Auto CQ Delay must be between 1 and 3600 seconds.");
      document.preferences.autoCQDelay = autoCQDelay;
      const cwSpeedStep = Number(document.preferences.cwSpeedStep);
      if (!Number.isInteger(cwSpeedStep) || cwSpeedStep < 1 || cwSpeedStep > 10)
        throw new Error("CW speed step must be an integer from 1 to 10 WPM.");
      document.preferences.cwSpeedStep = cwSpeedStep;
      const cwSerialPaddingLength = Number(document.preferences.cwSerialPaddingLength);
      if (!Number.isInteger(cwSerialPaddingLength) || cwSerialPaddingLength < 1 || cwSerialPaddingLength > 10)
        throw new Error("CW serial padding length must be an integer from 1 to 10.");
      document.preferences.cwSerialPaddingLength = cwSerialPaddingLength;
      if (!["5NN", "599", "ENN"].includes(String(document.preferences.cwRSTFormat))) throw new Error("Choose a supported CW RST format.");
      if (!["0", "O", "T"].includes(String(document.preferences.cwSerialPaddingCharacter))) throw new Error("Choose a supported CW serial padding character.");
      if (!["1", "A"].includes(String(document.preferences.cwSerialOne)) || !["9", "N"].includes(String(document.preferences.cwSerialNine)) ||
          !["0", "O", "T"].includes(String(document.preferences.cwSerialZero))) throw new Error("Choose supported CW serial substitutions.");
      if (view === "Edit Keys") document.preferences.keyBindings = encodeContestKeyBindings(
        validateContestKeyBindings(encodeContestKeyBindings(bindingValue)));
      if (view === "Choose a Contest") {
        const session = sessions.find(item => item.sessionID === selectedSession);
        if (!session) throw new Error("Select a contest.");
        await onOpen(session);
      } else if (view === "New Contest") await onCreate({ ...document, name: catalog.find(item => item.id === document.pluginID)?.name ?? document.name });
      else await onSave(document);
      if (!detachedDialog) setView(null);
    }, view === "Choose a Contest" ? "Contest opened." : view === "New Contest" ? "Contest created." : "Settings saved.");
  }
const row = (...items: ReactNode[]) => <div className="contest-manual-row">{items}</div>;
  const textArea = (section: "settings" | "preferences", key: string, label: string) => <label><span>{label}</span><textarea rows={3} value={String(draft[section][key] ?? "")} onChange={event => update(section, key, event.target.value)}/></label>;
  const selectValues = (values: string[], current: unknown) => [...new Set([...values, ...(current === undefined ? [] : [String(current)])])];
  const choice = (section: "settings" | "preferences", key: string, label: string, values: string[]) => field(section, key, label, "text", selectValues(values, draft[section][key]));
  const boundedPreferenceNumber = (key: string, label: string, minimum: number, maximum: number) =>
    <label className="contest-setup-field"><span title={label}>{label}</span><input type="number" min={minimum} max={maximum}
      value={String(draft.preferences[key] ?? "")} onChange={event => update("preferences", key, event.target.value === "" ? "" : Number(event.target.value))}/></label>;
  const bindingValue = readContestKeyBindings(draft.preferences.keyBindings);
  const setBindings = (next: ContestKeyBinding[]) => update("preferences", "keyBindings", encodeContestKeyBindings(next));
  const selectedPlugin = catalog.find(plugin => plugin.id === draft.pluginID);
  const supportedBandChoices = selectedPlugin?.supportedBands?.length ? selectedPlugin.supportedBands
    : ["160m", "80m", "40m", "20m", "15m", "10m", "6m", "2m", "1.25m", "70cm", "33cm", "23cm"];
  const modeChoices = setupModeChoices(selectedPlugin);
  const usesCanonicalStationCQZone = cqWWStationZonePlugins.has(draft.pluginID);
  const overlayChoices = selectedPlugin?.overlayChoices?.length ? selectedPlugin.overlayChoices : ["N/A", "CLASSIC", "ROOKIE", "TB-WIRES", "YOUTH"];
  let content: ReactNode = null;
  if (view === "Station Settings") content = <div className="contest-station-form">
    {row(field("station", "Call", "Call"))}
    {row(field("station", "Name", "Name"))}
    {row(field("station", "Street1", "Address"))}
    {row(field("station", "Street2", "Address", "text"))}
    {row(field("station", "City", "City"), field("station", "State", "State"), field("station", "Zip", "Zip"))}
    {row(field("station", "Country", "Country"))}
    {row(field("station", "GridSquare", "Grid Square"), field("station", "CQZone", "CQ Zone"), field("station", "IARUZone", "ITU Zone"))}
    {row(field("station", "LicenseClass", "License"), field("station", "Latitude", "Latitude"), field("station", "Longitude", "Longitude"))}
    {row(field("station", "STXeq", "Station TX/RX"), field("station", "SPowe", "Power"))}
    {row(field("station", "SAnte", "Antenna"), field("station", "SAntH1", "Ant. Height"), field("station", "SAntH2", "a.s.l."))}
    {row(field("station", "ARRLSection", "Cabrillo location (ARRL section or DX)"))}
    {row(field("station", "RoverQTH", "Rover QTH"))}
    {row(field("station", "Club", "Club"))}
    {row(field("station", "Email", "Email address"))}
    {shared("Station")}
  </div>;
  else if (view === "New Contest" || view === "Edit Current Contest") content = <div className="contest-parameters">
    <p>Select Contest Type for {view === "New Contest" ? "New" : "Current"} Log</p>
    <label><span>Log Type</span><select value={draft.pluginID} disabled={view === "Edit Current Contest"} onChange={event => { const plugin = catalog.find(item => item.id === event.target.value);
      setDraft(current => {
        const modes = setupModeChoices(plugin), currentMode = String(current.settings.ModeCategory ?? "");
        const mode = modes.includes(currentMode) ? currentMode : modes.includes("MIXED") ? "MIXED" : modes[0] ?? currentMode;
        const bands = plugin?.supportedBands ?? [], currentBand = String(current.settings.BandCategory ?? "ALL");
        const band = currentBand === "ALL" || bands.some(item => item.toUpperCase() === currentBand) ? currentBand : "ALL";
        return { ...current, pluginID: event.target.value,
          settings: { ...current.settings, SentExchange: "", ModeCategory: mode, BandCategory: band,
            AssistedCategory: event.target.value === "cq_ww_ssb" ? "ASSISTED" : current.settings.AssistedCategory,
            OverlayCategory: plugin?.overlayChoices?.[0] ?? "N/A" },
          preferences: bands.length ? { ...current.preferences, bands: [...bands] } : current.preferences };
      }); }}>{catalog.map(plugin => <option key={plugin.id} value={plugin.id}>{plugin.name}</option>)}</select></label>
    {<label><span>Start UTC</span><input type="datetime-local" step="1" value={String(draft.settings.StartDate ?? "").replace(" ", "T")} onChange={event => update("settings", "StartDate", (event.target.value.length === 16 ? event.target.value + ":00" : event.target.value).replace("T", " "))}/></label>}
    <hr/>
    {choice("settings", "OperatorCategory", "Operator", ["SINGLE-OP", "MULTI-OP", "MULTI-TWO", "CHECKLOG"])}
    {choice("settings", "BandCategory", "Band", ["ALL", ...supportedBandChoices.map(band => band.toUpperCase())])}
    {choice("settings", "PowerCategory", "Power", ["HIGH", "LOW", "QRP"])}
    {field("settings", "ModeCategory", "Mode", "text", selectValues(modeChoices, draft.settings.ModeCategory), modeChoices.length === 1)}
    {choice("settings", "OverlayCategory", "Overlay", overlayChoices)}
    {choice("settings", "StationCategory", "Station", ["FIXED", "MOBILE", "PORTABLE", "ROVER", "EXPEDITION", "HQ", "SCHOOL"])}
    {choice("settings", "AssistedCategory", "Assisted", ["ASSISTED", "NON-ASSISTED"])}
    {choice("settings", "TransmitterCategory", "Transmitter", ["ONE", "TWO", "LIMITED", "UNLIMITED", "SWL"])}
    {usesCanonicalStationCQZone ? <div className="contest-exchange-row contest-manual-stack" role="status">
      <span>Sent CQ Zone: <strong>{String(draft.station.CQZone ?? "") || "Not configured"}</strong> · sourced from Station Settings.</span>
      <button type="button" onClick={() => onOpenDialog ? void onOpenDialog("station") : open("Station Settings")}>Edit Station CQ Zone</button>
    </div> : <div className="contest-exchange-row">{field("settings", "SentExchange", selectedPlugin?.sentExchangeHint ?? (["icwc_mst", "cwo"].includes(draft.pluginID) ? "Name" : "Sent Exchange"))}<span>Exclude RST</span></div>}
    <label><span>Operators</span><input value={draft.operator} onChange={event => setDraft(current => ({ ...current, operator: event.target.value.toUpperCase() }))}/></label>
    {textArea("settings", "Soapbox", "Soapbox")}
  </div>;
  else if (view === "Choose a Contest") content = <table className="contest-choose-table"><thead><tr><th>Contest Name</th><th>Contest Start</th></tr></thead><tbody>{sessions.map(session => <tr key={session.sessionID} aria-selected={selectedSession === session.sessionID} onClick={() => setSelectedSession(session.sessionID)}><td><label><input type="radio" name="contest-session" checked={selectedSession === session.sessionID} onChange={() => setSelectedSession(session.sessionID)}/>{session.name}</label></td><td>{session.startUTC ?? "—"}</td></tr>)}</tbody></table>;
  else if (view === "Configuration Settings") {
    switch (tab) {
      case "Lookup": content = <div className="contest-manual-stack">
        {check("preferences", "showQRZDetails", "Show callsign details")}
        {managed("QRZ", "Choose QRZ or HamQTH and save its credentials securely there.", "Callsign lookup")}
      </div>; break;
      case "Sound": {
        const saved = String(draft.preferences.soundDevice ?? "");
        const savedAvailable = !saved || audioOutputs?.some(output => output.deviceID === saved);
        content = <div className="contest-manual-stack">
          <label><span>Sound Output</span><select value={saved} onChange={event => update("preferences", "soundDevice", event.target.value)}>
            <option value="">System default</option>
            {!savedAvailable && <option value={saved}>Saved device (unavailable)</option>}
            {(audioOutputs ?? []).map(output => <option key={output.deviceID} value={output.deviceID}>{output.label}</option>)}
          </select></label>
          <label><span>Recording Input</span><select value={audioInput} onChange={event => setAudioInput(event.target.value)}>
            <option value="">System default microphone</option>
            {(audioInputs ?? []).map(input => <option key={input.deviceID} value={input.deviceID}>{input.label}</option>)}
          </select></label>
          <div className="contest-voice-profile-path">{field("preferences", "voiceProfilePath", "Voice WAV profile folder")}
            <button type="button" onClick={chooseVoiceProfile}>Choose folder…</button>
            <button type="button" disabled={!String(draft.preferences.voiceProfilePath ?? "").trim()} onClick={() => void run(() => refreshVoiceProfile(), "Voice profile checked.")}>Check profile</button></div>
          <p role="status">{audioOutputs === null ? "Finding audio outputs…" : audioOutputError ? `Audio output discovery failed: ${audioOutputError}` : audioOutputs.length ? "Choose the sound output device for the voice keyer." : "No named audio outputs were reported. The system default remains available."}</p>
          <p>Use a Not1MM-compatible recorded profile: lowercase character files such as <code>c.wav</code>, <code>q.wav</code>, <code>space.wav</code>, and optional whole-message files such as <code>cq.wav</code> for a <code>[cq]</code> macro.</p>
          <p>Record F1–F12 here as bounded mono PCM WAV. Preview never claims contest output and never keys PTT. Replacing a slot requires a second explicit click. Map each recording to Run and/or S&amp;P, then Save. Explicitly select the Sound Output that feeds the radio; use System default only when intentional.</p>
          <div className="contest-voice-slots" role="group" aria-label="Recorded phone slots">{Array.from({length:12},(_,index)=>{
            const slot=`f${index+1}`,record=voiceSlots.find(item=>item.slot===slot),present=record?.present===true;
            return <div key={slot} className="contest-voice-slot"><strong>{slot.toUpperCase()}</strong>
              <span>{record?.error ? "Invalid WAV" : present ? `${((record?.durationMs ?? 0)/1000).toFixed(1)} s` : "Not recorded"}</span>
              <button type="button" onClick={() => recordingSlot===slot ? void stopVoiceRecording(slot,present) : void startVoiceRecording(slot)}>
                {recordingSlot===slot ? `Stop ${slot.toUpperCase()}` : present&&replaceSlot===slot ? `Replace ${slot.toUpperCase()}` : `Record ${slot.toUpperCase()}`}</button>
              <button type="button" aria-label={`Preview ${slot.toUpperCase()}`} disabled={!present||Boolean(record?.error)||Boolean(recordingSlot)} onClick={() => void run(() => previewContestVoiceSlot(
                String(draft.preferences.voiceProfilePath ?? ""),slot,saved), `${slot.toUpperCase()} preview completed without PTT.`)}>Preview</button>
              <button type="button" aria-label={`Use ${slot.toUpperCase()} for Run`} disabled={!present||Boolean(record?.error)} onClick={() => mapVoiceSlot("R",slot)}>Use for Run</button>
              <button type="button" aria-label={`Use ${slot.toUpperCase()} for S&P`} disabled={!present||Boolean(record?.error)} onClick={() => mapVoiceSlot("S",slot)}>Use for S&amp;P</button>
            </div>;
          })}</div>
        </div>;
        break;
      }
      case "CAT": content = managed("Radio", "Use the shared radio selection, saved connection and observed status."); break;
      case "CW": content = <div className="contest-manual-stack">
        {managed("CW", "Choose the shared radio or WinKeyer output there. Contest messages remain in Edit Macros; sending requires the existing output controls.")}
        {boundedPreferenceNumber("cwSpeedStep", "Speed increment for PgUp/PgDown (WPM)", 1, 10)}
        {choice("preferences", "cwRSTFormat", "Send 599 RST as", ["5NN", "599", "ENN"])}
        {choice("preferences", "cwSerialPaddingCharacter", "Serial number padding character", ["0", "O", "T"])}
        {boundedPreferenceNumber("cwSerialPaddingLength", "Serial number padding length", 1, 10)}
        {choice("preferences", "cwSerialOne", "Send serial digit 1 as", ["1", "A"])}
        {choice("preferences", "cwSerialNine", "Send serial digit 9 as", ["9", "N"])}
        {choice("preferences", "cwSerialZero", "Send serial digit 0 as", ["0", "O", "T"])}
      </div>; break;
      case "Rotator": content = managed("Rotator", "Use the shared rotor configuration and observed status."); break;
      case "Cluster": content = managed("Cluster", "Manage servers, secure passwords, filters and connections there."); break;
      case "Group": content = <div className="contest-manual-stack">
        {check("network", "multiEnabled", "Enable Renfield Group Network")}
        {check("network", "multiMaster", "Be the master")}
        {field("network", "stationName", "Unique Station Name")}{field("network", "multicastGroup", "Multicast Group")}{field("network", "multicastPort", "Multicast Port", "number")}{field("network", "interface", "Interface IP")}
        <p role="status">Group Chat and legacy Renfield contact publication use the shared multicast owner. “Be the master” enables xLog’s contest-fenced authority protocol on an isolated trusted LAN; it is not peer-authenticated across an untrusted network. Legacy acknowledgements remain transport-only.</p>
      </div>; break;
      case "N1MM": content = <div className="contest-manual-stack">
        {check("network", "n1mmEnabled", "Send N1MM packets")}
        <div className="contest-n1mm-identity-row">{field("network", "n1mmStationName", "Station Name")}{field("network", "n1mmOperatorName", "Operator Name")}</div>
        {(["Radio", "Contact", "Lookup", "Score"] as const).map(kind => <div key={kind} className="contest-packet-row">{check("network", "n1mm" + kind, kind)}{field("network", "n1mm" + kind + "Destinations", kind + " destinations")}</div>)}
        <p>Enter each destination as <code>IP:port</code>. Separate multiple destinations with spaces.</p>
      </div>; break;
      case "Bands": content = <div className="contest-manual-bands">{[supportedBandChoices.slice(0, Math.ceil(supportedBandChoices.length / 2)), supportedBandChoices.slice(Math.ceil(supportedBandChoices.length / 2))].map((bands, column) => <div key={column}>{bands.map(band => <label key={band} className="contest-setup-check"><input type="checkbox" checked={Array.isArray(draft.preferences.bands) && draft.preferences.bands.includes(band)} onChange={event => { const current = Array.isArray(draft.preferences.bands) ? draft.preferences.bands : []; update("preferences", "bands", event.target.checked ? [...current, band] : current.filter(item => item !== band)); }}/><span>{band}</span></label>)}</div>)}</div>; break;
      case "Options": content = <div className="contest-options-columns">
        <div className="contest-manual-stack">{check("preferences", "useESM", "Enable ESM")}{[["esmCQ", "CQ", "F1"], ["esmHisCall", "His Call", "F2"], ["esmExchange", "Exchange", "F3"], ["esmAGN", "AGN", "F9"], ["esmMyCall", "My Call", "F5"], ["esmQRZ", "QRZ", "F4"], ["esmQsoB4", "QSO B4", "DISABLED"]].map(([key, label, fallback]) => <label key={key}><span>{label}</span><select value={String(draft.preferences[key] ?? fallback)} onChange={event => update("preferences", key, event.target.value)}>{["DISABLED", ...Array.from({ length: 12 }, (_, i) => "F" + (i + 1))].map(keyName => <option key={keyName}>{keyName}</option>)}</select></label>)}</div>
        <div className="contest-manual-stack">
          {field("preferences", "autoCQDelay", "Auto CQ Delay (Seconds)", "number")}
          {check("preferences", "callHistory", "Use Call History")}
          {check("preferences", "clearOnVFOChange", "Clear input fields in S&P when the VFO frequency changes")}<hr/>
          {callHistoryPanel ?? (onOpenCallHistory ? <button type="button" onClick={onOpenCallHistory}>Open Call History</button> : null)}
        </div>
      </div>; break;
    }
  } else if (view === "Edit Macros") content = <><p>Edit function key labels and CW templates for this contest. Unchanged empty rows use the contest default; clearing an edited template disables that macro. Saving does not send CW.</p>{(["R", "S"] as const).map(mode => <section key={mode} aria-label={mode === "R" ? "Run macros" : "S&P macros"}><h3>{mode === "R" ? "Run" : "S&P"}</h3><div className="contest-key-scroll"><table className="contest-key-table contest-macro-table"><thead><tr><th>Key</th><th>Label</th><th>Template</th></tr></thead><tbody>{Array.from({ length: 12 }, (_, index) => {
    const key = `F${index + 1}`, override = draft.macros.find(item => item.mode === mode && item.key === key);
    const macro = override ?? effectiveMacros?.find(item => item.mode === mode && item.key === key);
    const edit = (property: "label" | "template", text: string) => setDraft(current => {
      const existing = current.macros.find(item => item.mode === mode && item.key === key);
      const effective = effectiveMacros?.find(item => item.mode === mode && item.key === key);
      const next = { mode, key, label: "", template: "", ...effective, ...existing, [property]: text };
      return { ...current, macros: [...current.macros.filter(item => item.mode !== mode || item.key !== key), next] };
    });
    return <tr key={key}><th scope="row">{key}</th><td><input aria-label={`${mode === "R" ? "Run" : "S&P"} ${key} label`} value={macro?.label ?? ""} placeholder={macro ? "" : "Contest default"} maxLength={128} onChange={event => edit("label", event.target.value)}/></td><td><input aria-label={`${mode === "R" ? "Run" : "S&P"} ${key} template`} value={macro?.template ?? ""} placeholder={macro ? "" : "Contest default"} maxLength={1024} onChange={event => edit("template", event.target.value)}/></td></tr>;
  })}</tbody></table></div></section>)}</>;
  else if (view === "Edit Keys") content = <><div className="contest-key-scroll"><table className="contest-key-table contest-binding-table"><thead><tr>{["Context", "Key", "Action", "Description"].map(name => <th key={name}>{name}</th>)}</tr></thead><tbody>{bindingValue.map((binding, index) => <tr key={index} aria-selected={selectedBinding === index} onClick={() => setSelectedBinding(index)}><td><select aria-label={`context ${index + 1}`} value={binding.context} onChange={event => setBindings(bindingValue.map((item, i) => i === index ? { ...item, context: event.target.value as ContestKeyBinding["context"] } : item))}>{contestKeyBindingContexts.map(option => <option key={option}>{option}</option>)}</select></td><td><input aria-label={`key ${index + 1}`} value={binding.key} onChange={event => setBindings(bindingValue.map((item, i) => i === index ? { ...item, key: event.target.value } : item))}/></td><td><select aria-label={`action ${index + 1}`} value={binding.action} onChange={event => setBindings(bindingValue.map((item, i) => i === index ? { ...item, action: event.target.value as ContestKeyBinding["action"] } : item))}>{contestKeyBindingActions.map(option => <option key={option}>{option}</option>)}</select></td><td><output aria-label={`description ${index + 1}`} title={contestKeyBindingDescriptions[binding.action]}>{contestKeyBindingDescriptions[binding.action]}</output></td></tr>)}</tbody></table></div><div className="contest-key-actions"><button type="button" onClick={() => { setBindings([...bindingValue, { context: "*", key: "", action: "LOG_NOW" }]); setSelectedBinding(bindingValue.length); }}>Add</button><button type="button" disabled={!bindingValue.length} onClick={() => { setBindings(bindingValue.filter((_, i) => i !== selectedBinding)); setSelectedBinding(0); }}>Remove</button><button type="button" onClick={() => setBindings(structuredClone(defaultContestKeyBindings))}>Reset all</button></div></>;
  const configuration = view === "Configuration Settings";
  return <section className="contest-setup" data-setup-view={view ?? "Contest Setup"} aria-label="Contest Setup" aria-busy={disabled}><header><h2>{view ?? "Contest Setup"}</h2></header>
    {!view ? <div className="contest-setup-hub">{setupViews.map(name => <button type="button" key={name} disabled={disabled || (name === "New Contest" && newContestDisabled) || (["Edit Current Contest", "Edit Macros", "Edit Keys"].includes(name) && !activeSessionID)} onClick={() => {
      const kind = name === "Station Settings" ? "station" : name === "Configuration Settings" ? "configuration" : name === "Digital Setup" ? "digital" : name === "Edit Macros" ? "macros" : name === "Edit Keys" ? "keys" : null;
      if (kind && onOpenDialog) { void Promise.resolve().then(() => onOpenDialog(kind)).catch(cause => setMessage(cause instanceof Error ? cause.message : "Dialog could not open.")); }
      else open(name);
    }}>{name}</button>)}</div> :
      <form onSubmit={submit}>{configuration && <nav role="tablist" aria-label="Configuration settings sections" style={{ "--contest-setup-tab-count": contestSetupTabs.length } as CSSProperties}>{contestSetupTabs.map((name, index) => <button key={name} id={id + "-tab-" + index} type="button" role="tab" aria-selected={tab === name} aria-controls={id + "-panel"} tabIndex={tab === name ? 0 : -1} onClick={() => selectConfigurationTab(name)} onKeyDown={event => { const next = event.key === "ArrowRight" ? (index + 1) % contestSetupTabs.length : event.key === "ArrowLeft" ? (index + contestSetupTabs.length - 1) % contestSetupTabs.length : event.key === "Home" ? 0 : event.key === "End" ? contestSetupTabs.length - 1 : null; if (next !== null) { event.preventDefault(); selectConfigurationTab(contestSetupTabs[next]); document.getElementById(id + "-tab-" + next)?.focus(); } }}>{name}</button>)}</nav>}
        <fieldset disabled={disabled}><div id={id + "-panel"} role={configuration ? "tabpanel" : undefined} aria-labelledby={configuration ? id + "-tab-" + contestSetupTabs.indexOf(tab) : undefined} className="contest-manual-content">{content}</div></fieldset>
        <footer><button type="button" disabled={disabled} onClick={() => { recorderRef.current?.cancel(); recorderRef.current = null; recordingSlotRef.current = ""; setRecordingSlot(""); setReplaceSlot(""); if (detachedDialog) void onCancel?.(); else close(); }}>Cancel</button><button type="submit" className="contest-primary" disabled={disabled || Boolean(recordingSlot) || (view === "Choose a Contest" && !selectedSession) || (!activeSessionID && ["Edit Current Contest", "Edit Macros", "Edit Keys"].includes(view ?? ""))}>{pending ? "Saving…" : detachedDialog || configuration ? "Save" : "OK"}</button></footer>
      </form>}
    {(error || message) && <p role={error ? "alert" : "status"}>{error || message}</p>}
  </section>;
}

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { contestKeyBindingActions, contestKeyBindingContexts, contestKeyBindingDescriptions, defaultContestKeyBindings,
  encodeContestKeyBindings, readContestKeyBindings, validateContestKeyBindings, type ContestKeyBinding } from "./contestKeyBindings";
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
type SetupView = "Station Settings" | "New Contest" | "Choose a Contest" | "Edit Current Contest" | "Configuration Settings" | "Edit Macros" | "Edit Keys";
const setupViews: SetupView[] = ["Station Settings", "New Contest", "Choose a Contest", "Edit Current Contest", "Configuration Settings", "Edit Macros", "Edit Keys"];
type Props = {
  value: ContestSetupDocument; sessions: ContestSetupSession[]; activeSessionID?: string;
  effectiveMacros?: ContestSetupMacro[];
  catalog: Array<{ id: string; name: string; modes?: string[]; sentExchangeHint?: string; overlayChoices?: string[] }>;
  busy?: boolean; error?: string; initialTab?: ContestSetupTab | "Station" | "Contest" | "N1MM+" | "Call History" | "Macros" | "Key bindings" | "Digital" | "Multi-Multi";
  onSave: (value: ContestSetupDocument) => Promise<void>;
  onCreate: (value: ContestSetupDocument) => Promise<void>;
  onOpen: (session: ContestSetupSession) => Promise<void>;
  onOpenSettings?: (tab: ContestSetupServiceTab) => void | Promise<void>;
  servicePanels?: Partial<Record<ContestSetupServiceTab, ReactNode>>;
  callHistoryPanel?: ReactNode;
  onOpenCallHistory?: () => void;
  onOpenDialog?: (kind: "station" | "configuration") => void | Promise<void>;
  onContentChange?: () => void;
  detachedDialog?: "station" | "configuration";
  onCancel?: () => void | Promise<void>;
};

export function newContestSetup(stationCall = ""): ContestSetupDocument {
  return { name: "CQ WW CW", operator: stationCall, pluginID: "cq_ww_cw",
    station: { Call: stationCall, Name: "", Email: "", Street1: "", Street2: "", City: "", State: "", Zip: "", Country: "", GridSquare: "", CQZone: "15", IARUZone: "", LicenseClass: "", Latitude: "", Longitude: "", STXeq: "", SPowe: "", SAnte: "", SAntH1: "", SAntH2: "", ARRLSection: "", RoverQTH: "", Club: "" },
    settings: { StartDate: "", StationCategory: "FIXED", SentExchange: "", OperatorCategory: "SINGLE-OP", AssistedCategory: "NON-ASSISTED", BandCategory: "ALL", PowerCategory: "HIGH", ModeCategory: "CW", TransmitterCategory: "ONE", OverlayCategory: "N/A", Soapbox: "" },
    preferences: { cwSpeed: 25, rtcEnabled: false, rtcURL: "https://hamscore.com/postxml/", rtcUsername: "", rtcPassword: "", rtcIntervalMinutes: 2,
      bands: ["160m", "80m", "40m", "20m", "15m", "10m"], useESM: false, sendCorrectedCall: false,
      esmCQ: "DISABLED", esmExchange: "DISABLED", esmQRZ: "DISABLED", esmAGN: "DISABLED", esmHisCall: "DISABLED", esmMyCall: "DISABLED", esmQsoB4: "DISABLED", autoCQ: false, autoCQDelay: 15,
      spaceTabs: true, prefillExchange: true, callHistory: true, scp: true, darkMode: true,
      keyESM: "Enter", keyLog: "Ctrl+Enter", keyStop: "Escape", keyWipe: "Alt+W", keyRun: "Alt+R", keySearch: "Alt+S" }, network: { stationName: "", groupHost: "", groupPort: 12060,
      n1mmHost: "127.0.0.1", n1mmRadioPort: 12060, n1mmContactPort: 12061, n1mmLookupPort: 12062, n1mmRadio: false, n1mmContact: false,
      n1mmLookup: false, n1mmScore: false, n1mmEnabled: false, n1mmOperatorName: "", multicastGroup: "224.1.1.1", multicastPort: 2239, interface: "0.0.0.0", multiEnabled: false, multiMaster: false }, macros: [] };
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

function setupDraft(value: ContestSetupDocument): ContestSetupDocument {
  const defaults = newContestSetup(String(value.station.Call ?? ""));
  const result = structuredClone({ ...defaults, ...value, station: { ...defaults.station, ...value.station }, settings: { ...defaults.settings, ...value.settings }, preferences: { ...defaults.preferences, ...restoredESMPreferences(value.preferences) }, network: { ...defaults.network, ...value.network } });
  if (!String(result.settings.OverlayCategory ?? "").trim()) result.settings.OverlayCategory = "N/A";
  for (const kind of ["Radio", "Contact", "Lookup", "Score"]) {
    const key = "n1mm" + kind + "Destinations";
    if (result.network[key] === undefined) result.network[key] = String(value.network.n1mmHost ?? "127.0.0.1") + ":" + String(value.network["n1mm" + kind + "Port"] ?? 12060);
  }
  return result;
}

/** Controlled, service-agnostic editor: the owner supplies revisioned durable saves. */
export function ContestSetupPanel({ value, sessions, activeSessionID, catalog, busy = false, error = "", initialTab = "Contest",
  onSave, onCreate, onOpen, onOpenSettings, servicePanels, callHistoryPanel, onOpenCallHistory, effectiveMacros, onOpenDialog, onContentChange, detachedDialog, onCancel }: Props) {
  const macroDraft = () => ({ ...setupDraft(value), macros: structuredClone(effectiveMacros ?? value.macros) });
  const [draft, setDraft] = useState<ContestSetupDocument>(() => initialTab === "Macros" ? macroDraft() : setupDraft(value));
  const [view, setView] = useState<SetupView | null>(initialTab === "Contest" ? null : initialTab === "Station" ? "Station Settings" : initialTab === "Macros" ? "Edit Macros" : initialTab === "Key bindings" ? "Edit Keys" : "Configuration Settings");
  const [tab, setTab] = useState<ContestSetupTab>(contestSetupTabs.includes(initialTab as ContestSetupTab) ? initialTab as ContestSetupTab : initialTab === "N1MM+" ? "N1MM" : initialTab === "Multi-Multi" ? "Group" : initialTab === "Call History" ? "Options" : "Lookup"), [message, setMessage] = useState("");
  const [selectedSession, setSelectedSession] = useState(activeSessionID ?? "");
  const [selectedBinding, setSelectedBinding] = useState(0);
  const [audioOutputs, setAudioOutputs] = useState<ContestAudioOutput[] | null>(null);
  const [audioOutputError, setAudioOutputError] = useState("");
  const [pending, setPending] = useState(false), pendingRef = useRef(false);
  const id = useId();
  useEffect(() => { setDraft(view === "Edit Macros" ? macroDraft() : setupDraft(value)); }, [value, effectiveMacros]);
  useEffect(() => {
    if (contestSetupTabs.includes(initialTab as ContestSetupTab)) { setTab(initialTab as ContestSetupTab); setView("Configuration Settings"); }
  }, [initialTab]);
  useEffect(() => {
    if (view !== "Configuration Settings" || tab !== "Sound" || audioOutputs !== null) return;
    let current = true;
    void loadContestAudioOutputs().then(outputs => { if (current) setAudioOutputs(outputs); })
      .catch(cause => { if (current) { setAudioOutputs([]); setAudioOutputError(cause instanceof Error ? cause.message : "Audio outputs could not be listed."); } });
    return () => { current = false; };
  }, [view, tab, audioOutputs]);
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
  const shared = (service: ContestSetupServiceTab) => servicePanels?.[service] ?? (onOpenSettings ? <button type="button" onClick={() => void run(async () => { await onOpenSettings(service); }, "")}>Open xLog {service} settings</button> : null);
  const managed = (service: ContestSetupServiceTab, description: string) => <div className="contest-manual-stack">
    <p role="status">Managed by xLog {service} settings. {description}</p>
    {shared(service) ?? <p>Open these settings in the main xLog application.</p>}
    <p>Save here applies contest preferences only. Existing contest service fields are retained without applying them.</p>
  </div>;
  async function run(operation: () => Promise<void>, success: string) {
    if (disabled || pendingRef.current) return;
    pendingRef.current = true; setPending(true); setMessage("");
    try { await operation(); setMessage(success); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Setup could not be saved."); }
    finally { pendingRef.current = false; setPending(false); }
  }
  function close() { setDraft(setupDraft(value)); setMessage(""); setView(null); }
  function open(next: SetupView) {
    const source = next === "Edit Macros" ? macroDraft() : setupDraft(value);
    setDraft(next === "New Contest" ? { ...source, settings: { ...source.settings, SentExchange: "" } } : source);
    setMessage(""); setView(next); setSelectedSession(activeSessionID ?? "");
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const document = structuredClone(draft);
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
  const bindingValue = readContestKeyBindings(draft.preferences.keyBindings);
  const setBindings = (next: ContestKeyBinding[]) => update("preferences", "keyBindings", encodeContestKeyBindings(next));
  const selectedPlugin = catalog.find(plugin => plugin.id === draft.pluginID);
  const modeChoices = selectedPlugin?.modes?.length ? selectedPlugin.modes : ["CW", "SSB", "RTTY", "MIXED", "DIGI"];
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
    {row(field("station", "ARRLSection", "ARRL Section"))}
    {row(field("station", "RoverQTH", "Rover QTH"))}
    {row(field("station", "Club", "Club"))}
    {row(field("station", "Email", "Email address"))}
    {shared("Station")}
  </div>;
  else if (view === "New Contest" || view === "Edit Current Contest") content = <div className="contest-parameters">
    <p>Select Contest Type for {view === "New Contest" ? "New" : "Current"} Log</p>
    <label><span>Log Type</span><select value={draft.pluginID} disabled={view === "Edit Current Contest"} onChange={event => { const plugin = catalog.find(item => item.id === event.target.value);
      setDraft(current => ({ ...current, pluginID: event.target.value, settings: { ...current.settings, SentExchange: "",
        ModeCategory: plugin?.modes?.length === 1 ? plugin.modes[0] : current.settings.ModeCategory,
        OverlayCategory: plugin?.overlayChoices?.[0] ?? "N/A" } })); }}>{catalog.map(plugin => <option key={plugin.id} value={plugin.id}>{plugin.name}</option>)}</select></label>
    {<label><span>Start UTC</span><input type="datetime-local" step="1" value={String(draft.settings.StartDate ?? "").replace(" ", "T")} onChange={event => update("settings", "StartDate", (event.target.value.length === 16 ? event.target.value + ":00" : event.target.value).replace("T", " "))}/></label>}
    <hr/>
    {choice("settings", "OperatorCategory", "Operator", ["SINGLE-OP", "MULTI-OP", "CHECKLOG"])}
    {choice("settings", "BandCategory", "Band", ["ALL", "160M", "80M", "40M", "20M", "15M", "10M", "6M", "2M", "1.25M", "70CM", "33CM", "23CM"])}
    {choice("settings", "PowerCategory", "Power", ["HIGH", "LOW", "QRP"])}
    {field("settings", "ModeCategory", "Mode", "text", selectValues(modeChoices, draft.settings.ModeCategory), modeChoices.length === 1)}
    {choice("settings", "OverlayCategory", "Overlay", overlayChoices)}
    {choice("settings", "StationCategory", "Station", ["FIXED", "MOBILE", "PORTABLE", "ROVER", "EXPEDITION", "HQ", "SCHOOL"])}
    {choice("settings", "AssistedCategory", "Assisted", ["ASSISTED", "NON-ASSISTED"])}
    {choice("settings", "TransmitterCategory", "Transmitter", ["ONE", "TWO", "LIMITED", "UNLIMITED", "SWL"])}
    <div className="contest-exchange-row">{field("settings", "SentExchange", selectedPlugin?.sentExchangeHint ?? (["icwc_mst", "cwo"].includes(draft.pluginID) ? "Name" : "Sent Exchange"))}<span>Exclude RST</span></div>
    <label><span>Operators</span><input value={draft.operator} onChange={event => setDraft(current => ({ ...current, operator: event.target.value.toUpperCase() }))}/></label>
    {textArea("settings", "Soapbox", "Soapbox")}
  </div>;
  else if (view === "Choose a Contest") content = <table className="contest-choose-table"><thead><tr><th>Contest Name</th><th>Contest Start</th></tr></thead><tbody>{sessions.map(session => <tr key={session.sessionID} aria-selected={selectedSession === session.sessionID} onClick={() => setSelectedSession(session.sessionID)}><td><label><input type="radio" name="contest-session" checked={selectedSession === session.sessionID} onChange={() => setSelectedSession(session.sessionID)}/>{session.name}</label></td><td>{session.startUTC ?? "—"}</td></tr>)}</tbody></table>;
  else if (view === "Configuration Settings") {
    switch (tab) {
      case "Lookup": content = managed("QRZ", "Configure QRZ XML lookup and save its credentials securely there."); break;
      case "Sound": {
        const saved = String(draft.preferences.soundDevice ?? "");
        const savedAvailable = !saved || audioOutputs?.some(output => output.deviceID === saved);
        content = <div className="contest-manual-stack">
          <label><span>Sound Output</span><select value={saved} onChange={event => update("preferences", "soundDevice", event.target.value)}>
            <option value="">System default</option>
            {!savedAvailable && <option value={saved}>Saved device (unavailable)</option>}
            {(audioOutputs ?? []).map(output => <option key={output.deviceID} value={output.deviceID}>{output.label}</option>)}
          </select></label>
          <p role="status">{audioOutputs === null ? "Finding audio outputs…" : audioOutputError ? `Audio output discovery failed: ${audioOutputError}` : audioOutputs.length ? "Choose the sound output device for the voice keyer." : "No named audio outputs were reported. The system default remains available."}</p>
        </div>;
        break;
      }
      case "CAT": content = managed("Radio", "Use the shared radio selection, saved connection and observed status."); break;
      case "CW": content = managed("CW", "Choose the shared radio or WinKeyer output there. Contest messages remain in Edit Macros; sending requires the existing output controls."); break;
      case "Rotator": content = managed("Rotator", "Use the shared rotor configuration and observed status."); break;
      case "Cluster": content = managed("Cluster", "Manage servers, secure passwords, filters and connections there."); break;
      case "Group": content = <div className="contest-manual-stack">{check("network", "multiEnabled", "Connect to server")}{check("network", "multiMaster", "Be the master")}{field("network", "multicastGroup", "Multicast Group")}{field("network", "multicastPort", "Multicast Port", "number")}{field("network", "interface", "Interface IP")}</div>; break;
      case "N1MM": content = <div className="contest-manual-stack">{check("network", "n1mmEnabled", "Send N1MM packets")}{row(field("network", "stationName", "Station Name"), field("network", "n1mmOperatorName", "Operator Name"))}{(["Radio", "Contact", "Lookup", "Score"] as const).map(kind => <div key={kind} className="contest-packet-row">{check("network", "n1mm" + kind, kind)}{field("network", "n1mm" + kind + "Destinations", kind + " destinations")}</div>)}</div>; break;
      case "Bands": content = <div className="contest-manual-bands">{[["160m", "80m", "40m", "20m", "15m", "10m"], ["6m", "2m", "1.25m", "70cm", "33cm", "23cm"]].map((bands, column) => <div key={column}>{bands.map(band => <label key={band} className="contest-setup-check"><input type="checkbox" checked={Array.isArray(draft.preferences.bands) && draft.preferences.bands.includes(band)} onChange={event => { const current = Array.isArray(draft.preferences.bands) ? draft.preferences.bands : []; update("preferences", "bands", event.target.checked ? [...current, band] : current.filter(item => item !== band)); }}/><span>{band}</span></label>)}</div>)}</div>; break;
      case "Options": content = <div className="contest-options-columns">
        <div className="contest-manual-stack">{check("preferences", "useESM", "Enable ESM")}{[["esmCQ", "CQ", "F1"], ["esmHisCall", "His Call", "F2"], ["esmExchange", "Exchange", "F3"], ["esmAGN", "AGN", "F9"], ["esmMyCall", "My Call", "F5"], ["esmQRZ", "QRZ", "F4"], ["esmQsoB4", "QSO B4", "DISABLED"]].map(([key, label, fallback]) => <label key={key}><span>{label}</span><select value={String(draft.preferences[key] ?? fallback)} onChange={event => update("preferences", key, event.target.value)}>{["DISABLED", ...Array.from({ length: 12 }, (_, i) => "F" + (i + 1))].map(keyName => <option key={keyName}>{keyName}</option>)}</select></label>)}</div>
        <div className="contest-manual-stack">
          {check("preferences", "callHistory", "Use Call History")}<hr/>
          {check("preferences", "rtcEnabled", "Use RTC score reporting")}
          {choice("preferences", "rtcURL", "Score reporting URL", ["https://hamscore.com/postxml/", "https://contestsonlinescore.com/postscore.jsp", "https://contest.run/postscore"])}
          {field("preferences", "rtcUsername", "Score reporting username")}
          {field("preferences", "rtcPassword", "Score reporting password", "password")}
          {field("preferences", "rtcIntervalMinutes", "Score posting interval (minutes)", "number")}
          {check("preferences", "clearOnVFOChange", "Clear input fields in S&P when the VFO frequency changes")}
          {callHistoryPanel ?? (onOpenCallHistory ? <button type="button" onClick={onOpenCallHistory}>Open Call History</button> : null)}
        </div>
      </div>; break;
    }
  } else if (view === "Edit Macros") content = <><p>Edit function key labels and CW templates for this contest. Unchanged empty rows use the contest default; clearing an edited template disables that macro. Saving does not send CW.</p>{(["R", "S"] as const).map(mode => <section key={mode} aria-label={mode === "R" ? "Run macros" : "S&P macros"}><h3>{mode === "R" ? "Run" : "S&P"}</h3><div className="contest-key-scroll"><table className="contest-key-table"><thead><tr><th>Key</th><th>Label</th><th>Template</th></tr></thead><tbody>{Array.from({ length: 12 }, (_, index) => {
    const key = `F${index + 1}`, macro = draft.macros.find(item => item.mode === mode && item.key === key);
    const edit = (property: "label" | "template", text: string) => setDraft(current => {
      const existing = current.macros.find(item => item.mode === mode && item.key === key);
      const next = { mode, key, label: "", template: "", ...existing, [property]: text };
      return { ...current, macros: [...current.macros.filter(item => item.mode !== mode || item.key !== key), next] };
    });
    return <tr key={key}><th scope="row">{key}</th><td><input aria-label={`${mode === "R" ? "Run" : "S&P"} ${key} label`} value={macro?.label ?? ""} placeholder={macro ? "" : "Contest default"} maxLength={128} onChange={event => edit("label", event.target.value)}/></td><td><input aria-label={`${mode === "R" ? "Run" : "S&P"} ${key} template`} value={macro?.template ?? ""} placeholder={macro ? "" : "Contest default"} maxLength={1024} onChange={event => edit("template", event.target.value)}/></td></tr>;
  })}</tbody></table></div></section>)}</>;
  else if (view === "Edit Keys") content = <><div className="contest-key-scroll"><table className="contest-key-table"><thead><tr>{["Context", "Key", "Action", "Description"].map(name => <th key={name}>{name}</th>)}</tr></thead><tbody>{bindingValue.map((binding, index) => <tr key={index} aria-selected={selectedBinding === index} onClick={() => setSelectedBinding(index)}><td><select aria-label={`context ${index + 1}`} value={binding.context} onChange={event => setBindings(bindingValue.map((item, i) => i === index ? { ...item, context: event.target.value as ContestKeyBinding["context"] } : item))}>{contestKeyBindingContexts.map(option => <option key={option}>{option}</option>)}</select></td><td><input aria-label={`key ${index + 1}`} value={binding.key} onChange={event => setBindings(bindingValue.map((item, i) => i === index ? { ...item, key: event.target.value } : item))}/></td><td><select aria-label={`action ${index + 1}`} value={binding.action} onChange={event => setBindings(bindingValue.map((item, i) => i === index ? { ...item, action: event.target.value as ContestKeyBinding["action"] } : item))}>{contestKeyBindingActions.map(option => <option key={option}>{option}</option>)}</select></td><td><output aria-label={`description ${index + 1}`}>{contestKeyBindingDescriptions[binding.action]}</output></td></tr>)}</tbody></table></div><div className="contest-key-actions"><button type="button" onClick={() => { setBindings([...bindingValue, { context: "*", key: "", action: "LOG_NOW" }]); setSelectedBinding(bindingValue.length); }}>Add</button><button type="button" disabled={!bindingValue.length} onClick={() => { setBindings(bindingValue.filter((_, i) => i !== selectedBinding)); setSelectedBinding(0); }}>Remove</button><button type="button" onClick={() => setBindings(structuredClone(defaultContestKeyBindings))}>Reset all</button></div></>;
  const configuration = view === "Configuration Settings";
  return <section className="contest-setup" aria-label="Contest Setup" aria-busy={disabled}><header><h2>{view ?? "Contest Setup"}</h2></header>
    {!view ? <div className="contest-setup-hub">{setupViews.map(name => <button type="button" key={name} disabled={disabled || (["Edit Current Contest", "Edit Macros", "Edit Keys"].includes(name) && !activeSessionID)} onClick={() => {
      const kind = name === "Station Settings" ? "station" : name === "Configuration Settings" ? "configuration" : null;
      if (kind && onOpenDialog) { void Promise.resolve().then(() => onOpenDialog(kind)).catch(cause => setMessage(cause instanceof Error ? cause.message : "Dialog could not open.")); }
      else open(name);
    }}>{name}</button>)}</div> :
      <form onSubmit={submit}>{configuration && <nav role="tablist" aria-label="Configuration settings sections">{contestSetupTabs.map((name, index) => <button key={name} id={id + "-tab-" + index} type="button" role="tab" aria-selected={tab === name} aria-controls={id + "-panel"} tabIndex={tab === name ? 0 : -1} onClick={() => selectConfigurationTab(name)} onKeyDown={event => { const next = event.key === "ArrowRight" ? (index + 1) % contestSetupTabs.length : event.key === "ArrowLeft" ? (index + contestSetupTabs.length - 1) % contestSetupTabs.length : event.key === "Home" ? 0 : event.key === "End" ? contestSetupTabs.length - 1 : null; if (next !== null) { event.preventDefault(); selectConfigurationTab(contestSetupTabs[next]); document.getElementById(id + "-tab-" + next)?.focus(); } }}>{name}</button>)}</nav>}
        <fieldset disabled={disabled}><div id={id + "-panel"} role={configuration ? "tabpanel" : undefined} aria-labelledby={configuration ? id + "-tab-" + contestSetupTabs.indexOf(tab) : undefined} className="contest-manual-content">{content}</div></fieldset>
        <footer><button type="button" disabled={disabled} onClick={() => { if (detachedDialog) void onCancel?.(); else close(); }}>Cancel</button><button type="submit" className="contest-primary" disabled={disabled || (view === "Choose a Contest" && !selectedSession) || (!activeSessionID && ["Edit Current Contest", "Edit Macros", "Edit Keys"].includes(view ?? ""))}>{pending ? "Saving…" : detachedDialog || configuration ? "Save" : "OK"}</button></footer>
      </form>}
    {(error || message) && <p role={error ? "alert" : "status"}>{error || message}</p>}
  </section>;
}

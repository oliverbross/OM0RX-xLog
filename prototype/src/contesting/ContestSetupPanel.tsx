import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
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
export type ContestSetupSession = { sessionID: string; name: string; pluginID: string; workspaceGeneration: string; revision: number };
export type ContestSetupServiceTab = "Station" | "QRZ" | "Radio" | "CW" | "Cluster" | "Integrations";
export const contestSetupTabs = ["Station", "Contest", "Lookup", "Sound", "CAT", "CW", "Cluster", "Group", "N1MM+", "Bands", "Options", "Call History", "Macros", "Key bindings", "Digital", "Multi-Multi"] as const;
export type ContestSetupTab = typeof contestSetupTabs[number];
type Props = {
  value: ContestSetupDocument; sessions: ContestSetupSession[]; activeSessionID?: string;
  catalog: Array<{ id: string; name: string }>;
  busy?: boolean; error?: string; initialTab?: ContestSetupTab;
  onSave: (value: ContestSetupDocument) => Promise<void>;
  onCreate: (value: ContestSetupDocument) => Promise<void>;
  onOpen: (session: ContestSetupSession) => Promise<void>;
  onOpenSettings?: (tab: ContestSetupServiceTab) => void;
  servicePanels?: Partial<Record<ContestSetupServiceTab, ReactNode>>;
  callHistoryPanel?: ReactNode;
  onOpenCallHistory?: () => void;
};

export function newContestSetup(stationCall = ""): ContestSetupDocument {
  return { name: "CQ WW CW", operator: stationCall, pluginID: "cq_ww_cw",
    station: { Call: stationCall, Name: "", Email: "", Street1: "", Street2: "", City: "", State: "", Zip: "", Country: "", GridSquare: "", CQZone: "15", IARUZone: "" },
    settings: { SentExchange: "15", OperatorCategory: "SINGLE-OP", AssistedCategory: "NON-ASSISTED", BandCategory: "ALL", PowerCategory: "HIGH", ModeCategory: "CW", TransmitterCategory: "ONE", OverlayCategory: "", Soapbox: "" },
    preferences: { lookup: "xlog", soundDevice: "default", phonetic: "NATO", cwSpeed: 25, cwWeight: 50, cwLeadMs: 0, cwTailMs: 0,
      bands: ["160m", "80m", "40m", "20m", "15m", "10m"], useESM: true, sendCorrectedCall: true, autoCQ: false, autoCQDelay: 15,
      spaceTabs: true, prefillExchange: true, callHistory: true, scp: true, darkMode: true,
      keyESM: "Enter", keyLog: "Ctrl+Enter", keyStop: "Escape", keyWipe: "Alt+W", keyRun: "Alt+R", keySearch: "Alt+S" }, network: { stationName: "", groupHost: "", groupPort: 12060,
      n1mmHost: "127.0.0.1", n1mmRadioPort: 12060, n1mmContactPort: 12061, n1mmLookupPort: 12062, n1mmRadio: false, n1mmContact: false,
      n1mmLookup: false, multicastGroup: "239.1.1.1", multicastPort: 2239, interface: "", multiEnabled: false }, macros: [] };
}

/** Controlled, service-agnostic editor: the owner supplies revisioned durable saves. */
export function ContestSetupPanel({ value, sessions, activeSessionID, catalog, busy = false, error = "", initialTab = "Contest",
  onSave, onCreate, onOpen, onOpenSettings, servicePanels, callHistoryPanel, onOpenCallHistory }: Props) {
  const [draft, setDraft] = useState<ContestSetupDocument>(() => structuredClone(value));
  const [tab, setTab] = useState<ContestSetupTab>(initialTab), [message, setMessage] = useState("");
  const [pending, setPending] = useState(false), pendingRef = useRef(false);
  const [macroMode, setMacroMode] = useState<"R" | "S">("R");
  const id = useId();
  useEffect(() => { setDraft(structuredClone(value)); }, [value]);
  useEffect(() => { setTab(initialTab); }, [initialTab]);
  const disabled = busy || pending;
  const update = (section: "station" | "settings" | "preferences" | "network", key: string, next: string | number | boolean | string[]) =>
    setDraft(current => ({ ...current, [section]: { ...current[section], [key]: next } }));
  const field = (section: "station" | "settings" | "preferences" | "network", key: string, label: string, type = "text", choices?: string[]) => {
    const current = draft[section][key];
    return <label key={`${section}-${key}`}><span>{label}</span>{choices ? <select value={String(current ?? "")} onChange={event => update(section, key, event.target.value)}>{choices.map(choice => <option key={choice} value={choice}>{choice || "None"}</option>)}</select>
      : <input type={type} value={String(current ?? "")} maxLength={512} min={type === "number" ? 0 : undefined} max={type === "number" ? 65535 : undefined}
        onChange={event => update(section, key, type === "number" ? event.target.value === "" ? "" : Number(event.target.value) : event.target.value)}/> }</label>;
  };
  const check = (section: "preferences" | "network", key: string, label: string) => <label key={key} className="contest-setup-check"><input type="checkbox" checked={draft[section][key] === true} onChange={event => update(section, key, event.target.checked)}/><span>{label}</span></label>;
  const shared = (service: ContestSetupServiceTab, description: string) => <><p>{description}</p>{servicePanels?.[service] ?? (onOpenSettings ? <button type="button" onClick={() => onOpenSettings(service)}>Open xLog {service} settings</button> : <p className="contest-source">Open Settings → {service} to configure this shared service.</p>)}</>;
  async function run(operation: () => Promise<void>, success: string) {
    if (disabled || pendingRef.current) return;
    pendingRef.current = true; setPending(true); setMessage("");
    try { await operation(); setMessage(success); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Setup could not be saved."); }
    finally { pendingRef.current = false; setPending(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void run(() => onSave(structuredClone(draft)), "Contest setup saved.");
  }
  function macroField(key: string, property: "label" | "template", next: string) {
    setDraft(current => {
      const existing = current.macros.find(macro => macro.mode === macroMode && macro.key === key);
      const updated = { mode: macroMode, key, label: existing?.label ?? key, template: existing?.template ?? "", [property]: next };
      return { ...current, macros: [...current.macros.filter(macro => macro.mode !== macroMode || macro.key !== key), updated] };
    });
  }
  let content: ReactNode;
  switch (tab) {
    case "Station": content = <><h3>Station Settings</h3>{shared("Station", "xLog owns the station identity and equipment. Contest address and exchange fields below are saved with this contest.")}<div className="contest-setup-fields">{[["Call", "Station callsign"], ["Name", "Name"], ["Email", "Email"], ["Street1", "Address line 1"], ["Street2", "Address line 2"], ["City", "City"], ["State", "State / province"], ["Zip", "Postal code"], ["Country", "Country"], ["GridSquare", "Grid square"], ["CQZone", "CQ zone"], ["IARUZone", "ITU zone"]].map(([key, label]) => field("station", key, label))}</div></>; break;
    case "Contest": content = <><h3>New / Select / Edit Contest</h3><div className="contest-setup-sessions" aria-label="Saved contests">{sessions.length ? sessions.map(session => <button key={session.sessionID} type="button" disabled={disabled} aria-current={session.sessionID === activeSessionID ? "true" : undefined} onClick={() => void run(() => onOpen(session), "Contest opened.")}>{session.name}<small>{session.pluginID}</small></button>) : <p>No saved contests yet.</p>}</div><div className="contest-setup-fields"><label><span>Contest name</span><input required maxLength={128} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}/></label><label><span>Contest plugin</span><select value={draft.pluginID} disabled={!!activeSessionID} onChange={event => setDraft(current => ({ ...current, pluginID: event.target.value }))}>{catalog.map(plugin => <option key={plugin.id} value={plugin.id}>{plugin.name}</option>)}</select></label><label><span>Operator callsign</span><input required value={draft.operator} maxLength={32} onChange={event => setDraft(current => ({ ...current, operator: event.target.value.toUpperCase() }))}/></label>{field("settings", "SentExchange", "Sent exchange")}{field("settings", "OperatorCategory", "Operator category", "text", ["SINGLE-OP", "MULTI-OP", "CHECKLOG"])}{field("settings", "AssistedCategory", "Assistance", "text", ["NON-ASSISTED", "ASSISTED"])}{field("settings", "BandCategory", "Band category", "text", ["ALL", "160M", "80M", "40M", "20M", "15M", "10M"])}{field("settings", "PowerCategory", "Power category", "text", ["HIGH", "LOW", "QRP"])}{field("settings", "ModeCategory", "Mode category", "text", ["CW"])}{field("settings", "TransmitterCategory", "Transmitters", "text", ["ONE", "TWO", "UNLIMITED"])}{field("settings", "OverlayCategory", "Overlay", "text", ["", "CLASSIC", "ROOKIE", "TB-WIRES", "YOUTH"])}</div><label><span>Soapbox</span><textarea maxLength={512} rows={3} value={String(draft.settings.Soapbox ?? "")} onChange={event => update("settings", "Soapbox", event.target.value)}/></label><button type="button" disabled={disabled} onClick={() => void run(() => onCreate(structuredClone(draft)), "Contest created.")}>Create and open new contest</button></>; break;
    case "Lookup": content = <><h3>Lookup</h3>{shared("QRZ", "Callsign lookup and secure account credentials use the shared xLog lookup service.")}{check("preferences", "callHistory", "Use call history")}{check("preferences", "scp", "Use Super Check Partial")}{check("preferences", "prefillExchange", "Prefill exchange from history")}</>; break;
    case "Sound": content = <><h3>Sound</h3><p>Voice messages and audio output use the selected system sound device.</p><div className="contest-setup-fields">{field("preferences", "soundDevice", "Sound device")}{field("preferences", "phonetic", "Phonetic alphabet", "text", ["NATO", "DX"])}</div></>; break;
    case "CAT": content = <><h3>CAT / Radio</h3>{shared("Radio", "Use xLog’s connected radio, CAT provider and station session. Frequency and mode are shared with the contest desk.")}</>; break;
    case "CW": content = <><h3>CW</h3>{shared("CW", "Keyer output, radio CW, arming and Stop use the shared xLog CW service. Contest F-key messages are edited in Macros.")}<div className="contest-setup-fields">{field("preferences", "cwSpeed", "Contest speed WPM", "number")}{field("preferences", "cwWeight", "Weight", "number")}{field("preferences", "cwLeadMs", "PTT lead ms", "number")}{field("preferences", "cwTailMs", "PTT tail ms", "number")}</div></>; break;
    case "Cluster": content = <><h3>Cluster</h3>{shared("Cluster", "Server connections, callsign login and commands use the shared xLog DX Cluster. Spots feed the contest bandmap.")}</>; break;
    case "Group": content = <><h3>Group</h3><p>Station identity and group endpoint for coordinated contest operation.</p><div className="contest-setup-fields">{field("network", "stationName", "Station name")}{field("network", "groupHost", "Group server")}{field("network", "groupPort", "Group port", "number")}</div></>; break;
    case "N1MM+": content = <><h3>N1MM+ UDP</h3><p>Configure destinations for N1MM-compatible radio, contact and lookup packets.</p><div className="contest-setup-fields">{field("network", "n1mmHost", "Destination host")}{field("network", "n1mmRadioPort", "Radio port", "number")}{field("network", "n1mmContactPort", "Contact port", "number")}{field("network", "n1mmLookupPort", "Lookup port", "number")}</div>{check("network", "n1mmRadio", "Send radio packets")}{check("network", "n1mmContact", "Send contact packets")}{check("network", "n1mmLookup", "Send lookup packets")}</>; break;
    case "Bands": content = <><h3>Bands</h3><p>Choose the bands shown on the contest desk.</p><div className="contest-setup-bands">{["160m", "80m", "40m", "20m", "15m", "10m"].map(band => <label key={band} className="contest-setup-check"><input type="checkbox" checked={Array.isArray(draft.preferences.bands) && draft.preferences.bands.includes(band)} onChange={event => { const bands = Array.isArray(draft.preferences.bands) ? draft.preferences.bands : []; update("preferences", "bands", event.target.checked ? [...bands, band] : bands.filter(value => value !== band)); }}/><span>{band}</span></label>)}</div></>; break;
    case "Options": content = <><h3>Operating options</h3>{check("preferences", "useESM", "Enable Enter Sends Message")}{check("preferences", "sendCorrectedCall", "Send corrected callsign")}{check("preferences", "spaceTabs", "Space advances entry field")}{check("preferences", "autoCQ", "Enable Auto CQ")}{field("preferences", "autoCQDelay", "Auto CQ delay seconds", "number")}</>; break;
    case "Call History": content = <><h3>Call History</h3>{check("preferences", "callHistory", "Use call history")}{check("preferences", "prefillExchange", "Prefill exchange from history")}{callHistoryPanel ?? <><p>Import, review and select the history dataset in the contest Call History window.</p>{onOpenCallHistory && <button type="button" onClick={onOpenCallHistory}>Open Call History</button>}</>}</>; break;
    case "Key bindings": content = <><h3>Key bindings</h3><p>Function keys F1–F12 use the Run or Search &amp; Pounce macro set. Escape always stops CW.</p><div className="contest-setup-fields">{[["keyESM", "Enter Sends Message key"], ["keyLog", "Log contact key"], ["keyWipe", "Clear entry key"], ["keyRun", "Run mode key"], ["keySearch", "Search & Pounce key"]].map(([key, label]) => field("preferences", key, label))}<label><span>Stop CW key</span><input readOnly value="Escape"/></label></div></>; break;
    case "Digital": content = <><h3>Digital contacts</h3>{shared("Integrations", "WSJT-X / JTDX UDP contact admission and duplicate handling use xLog’s shared integration service. Contest rules remain owned by the selected plugin.")}</>; break;
    case "Macros": content = <><h3>Function key macros</h3><p>Messages use {'{MYCALL}'}, {'{CALL}'}, {'{RST}'} and {'{EXCHANGE}'}. Saving does not transmit.</p><label><span>Macro operating mode</span><select value={macroMode} onChange={event => setMacroMode(event.target.value as "R" | "S")}><option value="R">Run</option><option value="S">Search &amp; Pounce</option></select></label><div className="contest-setup-macros">{Array.from({ length: 12 }, (_, index) => `F${index + 1}`).map(key => { const macro = draft.macros.find(item => item.mode === macroMode && item.key === key); return <div key={key}><strong>{key}</strong><label><span>{key} label</span><input value={macro?.label ?? key} maxLength={64} onChange={event => macroField(key, "label", event.target.value)}/></label><label><span>{key} message</span><input value={macro?.template ?? ""} maxLength={512} spellCheck={false} onChange={event => macroField(key, "template", event.target.value)}/></label></div>; })}</div></>; break;
    case "Multi-Multi": content = <><h3>Multi-Multi / Network</h3><p>Configure the station’s multicast group and interface for multi-station operation.</p>{check("network", "multiEnabled", "Enable Multi-Multi networking")}<div className="contest-setup-fields">{field("network", "stationName", "Network station name")}{field("network", "multicastGroup", "Multicast group")}{field("network", "multicastPort", "Multicast port", "number")}{field("network", "interface", "Network interface address")}</div></>; break;
  }
  return <section className="contest-setup" aria-label="Contest Setup" aria-busy={disabled}><header><h2>Contest Setup</h2><p>Station, contest and configuration</p></header><nav role="tablist" aria-label="Contest setup sections">{contestSetupTabs.map((name, index) => <button key={name} id={`${id}-tab-${index}`} type="button" role="tab" aria-selected={tab === name} aria-controls={`${id}-panel`} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={event => { const next = event.key === "ArrowRight" ? (index + 1) % contestSetupTabs.length : event.key === "ArrowLeft" ? (index + contestSetupTabs.length - 1) % contestSetupTabs.length : event.key === "Home" ? 0 : event.key === "End" ? contestSetupTabs.length - 1 : null; if (next !== null) { event.preventDefault(); setTab(contestSetupTabs[next]); document.getElementById(`${id}-tab-${next}`)?.focus(); } }}>{name}</button>)}</nav><form onSubmit={submit}><fieldset disabled={disabled}><div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${contestSetupTabs.indexOf(tab)}`}>{content}</div></fieldset>{(error || message) && <p role={error ? "alert" : "status"}>{error || message}</p>}<footer><button type="submit" className="contest-primary" disabled={disabled || !activeSessionID}>{pending ? "Saving…" : "Save contest setup"}</button><button type="button" disabled={disabled} onClick={() => { setDraft(structuredClone(value)); setMessage(""); }}>Discard changes</button>{!activeSessionID && <small>Create or open a contest to save configuration.</small>}</footer></form></section>;
}

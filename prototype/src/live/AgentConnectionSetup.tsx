import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { loadStationSession, stationSessionRequest, type FlexConfiguration, type HamlibConfiguration, type StationReceipt, type StationSession } from "./stationSession";
import type { StationProvider } from "../worker";
import { SharedHamlibModelBrowser } from "./HamlibModelPicker";
import type { MonitorContext } from "./monitorContext";
import { stationReceiveAvailable } from "./stationReceive";

const journalKey = "xlog.station-session.pending";
const reviewedKey = "xlog.station-session.reviewed";
const providerLabels: Record<StationProvider, string> = { direct_agent: "Remote Station Agent", direct_flex_lan: "Direct FLEX LAN", hamlib: "Local Hamlib" };
const notice = (receipt: StationReceipt) => receipt.request.action === "select"
  ? receipt.status === "acknowledged" ? "Radio selection acknowledged. Connect the selected radio explicitly."
    : "Radio selection outcome is unknown. Review the selected radio and check this receipt before another request."
  : receipt.request.action.startsWith("receive_") ? receipt.status === "acknowledged" ? "Receive control request acknowledged. Check fresh observations before another action." : "Receive control outcome is unknown. Check observed state and this receipt before another action."
  : receipt.status === "saved" ? receipt.request.action === "save_hamlib" ? "Hamlib configuration saved. No connection was started." : receipt.request.action === "save_flex" ? "FLEX configuration saved. No connection was started." : "Agent endpoint saved. No connection was started."
  : receipt.status === "acknowledged" ? "Connection request acknowledged. Check observed station state before operating."
  : "Connection outcome is unknown. Check observed station state before issuing another connection request.";

/** Desk and child share one native radio setup, lifecycle and receipt owner. */
export function AgentConnectionSetup({ connections = false, legacyEndpoint = "", providers = false, onlySelection = false, selectionTarget, hamlib: hamlibSetup = false, flex: flexSetup = false, followSelection = false, receiveContext }: {
  connections?: boolean; legacyEndpoint?: string; providers?: boolean; onlySelection?: boolean; selectionTarget?: StationProvider; hamlib?: boolean; flex?: boolean; followSelection?: boolean; receiveContext?: MonitorContext | null;
}) {
  const [state, setState] = useState<StationSession | null>(null), [url, setURL] = useState("");
  const hamlib = hamlibSetup || followSelection && state?.selection.provider === "hamlib";
  const flex = flexSetup || followSelection && state?.selection.provider === "direct_flex_lan";
  const [config, setConfig] = useState<HamlibConfiguration>({ mode: "managed", model: undefined, path: "", baud: 9600 });
  const [flexConfig, setFlexConfig] = useState<FlexConfiguration>({ host: "", port: 4992, station_name: "OM0RX-xLog" });
  const [token, setToken] = useState(""), [transmit, setTransmit] = useState(false);
  const [receiveMHz, setReceiveMHz] = useState(""), [consumedObservation, setConsumedObservation] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [pending, setPending] = useState(() => sessionStorage.getItem(journalKey));
  const [conflict, setConflict] = useState(false);
  const [legacyHint, setLegacyHint] = useState(false);
  const [providerTarget, setProviderTarget] = useState<StationProvider | null>(null);
  const active = useRef(false), dirty = useRef(false), inFlight = useRef(false), readSequence = useRef(0);
  const current = useRef<StationSession | null>(null);
  const refresh = async (adopt = false) => {
    const sequence = ++readSequence.current;
    try {
      const next = await loadStationSession();
      if (!active.current || sequence !== readSequence.current) return;
      if (next.generation !== current.current?.generation || next.revision !== current.current?.revision
        || next.selection.selection_id !== current.current?.selection.selection_id) setTransmit(false);
      if (adopt || !dirty.current) {
        const hint = !adopt && !current.current && !next.base_url && next.revision === 0 && !next.last_receipt ? legacyEndpoint : "";
        current.current = next; setState(next); setURL(hint || next.base_url); dirty.current = !!hint; setConflict(false);
        setConfig(next.hamlib ?? { mode: "managed", path: "", baud: 9600 });
        setFlexConfig(next.flex ?? { host: "", port: 4992, station_name: "OM0RX-xLog" });
        setLegacyHint(!!hint);
      } else if (next.generation !== current.current?.generation || next.revision !== current.current?.revision) {
        setConflict(true);
      } else { current.current = next; setState(next); }
      if (next.last_receipt && ["pending", "unknown"].includes(next.last_receipt.status)
        && sessionStorage.getItem(reviewedKey) !== next.last_receipt.operation_id) {
        sessionStorage.setItem(journalKey, next.last_receipt.operation_id); setPending(next.last_receipt.operation_id);
        setMessage(notice(next.last_receipt));
      }
      if (next.last_receipt && ["saved", "acknowledged"].includes(next.last_receipt.status)
        && sessionStorage.getItem(journalKey) === next.last_receipt.operation_id) {
        sessionStorage.removeItem(journalKey); setPending(null); setMessage(notice(next.last_receipt));
      }
      setError("");
    } catch { if (active.current && sequence === readSequence.current) setError("Shared station setup is unavailable. Refresh before making changes."); }
  };
  useEffect(() => {
    active.current = true; const stops: (() => void)[] = [];
    const focused = () => { void refresh(); };
    window.addEventListener("focus", focused);
    void Promise.allSettled(["xlog:station-session", "xlog:station-selection"].map(name => listen(name, () => { void refresh(); }))).then(results => {
      for (const result of results) {
        if (result.status === "fulfilled") { if (active.current) stops.push(result.value); else result.value(); }
      }
      if (active.current) void refresh();
    });
    return () => { active.current = false; readSequence.current++; stops.forEach(stop => stop()); window.removeEventListener("focus", focused); };
  }, []);
  const target = selectionTarget ?? providerTarget ?? (state?.selection.provider as StationProvider | null) ?? "direct_agent";
  const observation = receiveContext ? `${receiveContext.selection?.selection_id}:${receiveContext.selection?.control_revision}:${receiveContext.radio.received_at_ms}` : "";
  const receiveHz = receiveMHz.trim() && Number.isFinite(Number(receiveMHz)) ? Math.round(Number(receiveMHz) * 1e6) : 0;
  const receiveReady = () => observation !== consumedObservation && stationReceiveAvailable(receiveContext ?? null)
    && state?.selection.provider === receiveContext?.selection?.provider && state?.selection.selection_id === receiveContext?.selection?.selection_id
    && state?.selection.generation === receiveContext?.selection?.generation;
  const execute = async (action: "save" | "connect" | "reconnect" | "disconnect" | "forget" | "select" | "receive_frequency") => {
    const base = current.current;
    if (!base || inFlight.current || pending) return;
    const receive = action === "receive_frequency";
    if (receive && (!receiveReady() || !Number.isSafeInteger(receiveHz) || receiveHz < 100_000 || receiveHz > 1_000_000_000)) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    const id = crypto.randomUUID();
    try {
      // Journal identity only: tokens and access-bearing connection details never enter browser storage.
      sessionStorage.setItem(journalKey, id); setPending(id);
      if (receive) setConsumedObservation(observation);
      const receipt = await stationSessionRequest<StationReceipt>(receive ? { action, operation_id: id, generation: base.generation, revision: base.revision,
        provider: "direct_flex_lan", selection_generation: receiveContext!.selection!.generation, selection_id: receiveContext!.selection!.selection_id,
        control_revision: receiveContext!.selection!.control_revision, connection_generation: receiveContext!.radio.snapshot.generation,
        frequency_hz: receiveHz }
        : { action: action !== "select" && (hamlib || flex) ? `${action}_${flex ? "flex" : "hamlib"}` : action, operation_id: id, generation: base.generation, revision: base.revision,
        ...(action === "save" ? flex ? { configuration: { ...flexConfig, host: flexConfig.host.trim(), station_name: flexConfig.station_name.trim() } } : hamlib ? { configuration: config } : { base_url: url.trim() } : { selection_generation: base.selection.generation, selection_id: base.selection.selection_id,
          ...(action === "select" ? { provider: target } : { allow_transmit: ["connect", "reconnect"].includes(action) && transmit }), ...(!hamlib && !flex && action === "connect" && token ? { token } : {}) }) });
      if (!active.current) return;
      setToken(""); setTransmit(false); setMessage(notice(receipt));
      if (receipt.status === "saved" || receipt.status === "acknowledged") {
        sessionStorage.removeItem(journalKey); setPending(null); await refresh(action === "save");
      }
    } catch { if (active.current) setError("No outcome was confirmed. Check this operation's receipt before trying another request."); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  const check = async () => {
    if (!pending || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const receipt = await stationSessionRequest<StationReceipt | null>({ action: "receipt", operation_id: pending });
      if (!active.current) return;
      setError(""); setMessage(receipt ? notice(receipt) : "No operation was admitted under this identity. Refresh setup before trying again.");
      if (!receipt || receipt.status === "saved" || receipt.status === "acknowledged") {
        if (!receipt) setConsumedObservation("");
        sessionStorage.removeItem(journalKey); setPending(null); await refresh();
      }
    } catch { if (active.current) setError("The receipt is unavailable. Keep this operation pending and check again."); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  const selected = state?.selection.provider === (flex ? "direct_flex_lan" : hamlib ? "hamlib" : "direct_agent") && !!state.selection.selection_id;
  const updateConfig = (next: HamlibConfiguration) => { dirty.current = true; setConfig(next); };
  return <div className="live-station-connect" aria-label={onlySelection ? "Shared radio selection" : flex ? "Shared FLEX connection setup" : hamlib ? "Shared Hamlib connection setup" : "Shared Agent connection setup"}>
    {providers && <div>
      <p>Selected radio: {state?.selection.provider ? providerLabels[state.selection.provider as StationProvider] : "Unavailable"}. Applying a different provider retires the previous radio. Connect the selected radio explicitly.</p>
      {selectionTarget ? <p>Requested radio: {providerLabels[selectionTarget]}</p> : <label>Radio provider<select aria-label="Shared radio provider" value={target} disabled={!state || busy || !!pending} onChange={event => setProviderTarget(event.target.value as StationProvider)}>
        {(Object.keys(providerLabels) as StationProvider[]).map(provider => <option key={provider} value={provider}>{providerLabels[provider]}</option>)}
      </select></label>}
      <button type="button" disabled={!state?.selection.selection_id || state.selection.provider === target || busy || !!pending || !!error}
        onClick={() => void execute("select")}>Apply shared radio selection</button>
    </div>}
    {flex && <><h3>Shared Direct FLEX LAN connection</h3><p>Save a private numeric radio IP, TCP port and station name for Desk and Station Control. Saving does not contact a radio. Request transmit permission separately for each connection.</p>
      <fieldset disabled={!state || busy}>
        <label>Private radio IP address<input aria-label="Shared FLEX private IP" value={flexConfig.host} autoComplete="off" placeholder="192.168.1.50" onChange={event => { dirty.current = true; setFlexConfig({ ...flexConfig, host: event.target.value }); }} /></label>
        <label>TCP port<input aria-label="Shared FLEX TCP port" type="number" min="1" max="65535" value={flexConfig.port} onChange={event => { dirty.current = true; setFlexConfig({ ...flexConfig, port: Number(event.target.value) }); }} /></label>
        <label>Station name<input aria-label="Shared FLEX station name" maxLength={64} value={flexConfig.station_name} onChange={event => { dirty.current = true; setFlexConfig({ ...flexConfig, station_name: event.target.value }); }} /></label>
      </fieldset>
      <button type="button" disabled={!state || busy || !!pending || conflict} onClick={() => void execute("save")}>Save FLEX configuration</button>
      <button type="button" disabled={busy} onClick={() => void refresh(true)}>Reload saved FLEX configuration</button>
      {dirty.current && <p>Save configuration changes before connecting.</p>}
      {conflict && <p role="alert">Station setup changed in another window. Your text is retained; reload saved FLEX configuration to review it.</p>}
      <label><input type="checkbox" checked={transmit} onChange={event => setTransmit(event.target.checked)} />Enable FLEX transmit commands for this connection</label>
      <div className="live-station-actionrow"><button type="button" disabled={!selected || !state?.flex || dirty.current || conflict || busy || !!pending} onClick={() => void execute("connect")}>Connect saved FLEX radio</button>
        <button type="button" disabled={!selected || !state?.flex || dirty.current || conflict || busy || !!pending} onClick={() => void execute("reconnect")}>Reconnect saved FLEX radio</button>
        <button type="button" disabled={!selected || busy || !!pending} onClick={() => void execute("disconnect")}>Disconnect FLEX radio</button></div>
      <p>Reconnect replaces the connection with saved setup and the current transmit opt-in. No previous radio commands are replayed.</p>
      {receiveContext !== undefined && <section aria-label="Direct FLEX receive controls"><h3>Receive VFO A</h3>
        <p>Frequency control requires a fresh observed receive state on VFO A. A request acknowledgement does not confirm the new radio state.</p>
        <label>Receive frequency MHz<input aria-label="Child receive frequency MHz" inputMode="decimal" value={receiveMHz} onChange={event => setReceiveMHz(event.target.value)} /></label>
        <button type="button" disabled={!receiveReady() || busy || !!pending || receiveHz < 100_000 || receiveHz > 1_000_000_000} onClick={() => void execute("receive_frequency")}>Set receive VFO A frequency</button>
      </section>}
      {!selected && <p>Select Direct FLEX LAN before connecting.</p>}
    </>}
    {hamlib && !flex && <><h3>Shared Hamlib radio connection</h3><p>Save configuration for Desk and Station Control, then connect explicitly. Saving does not contact a device. Request transmit permission separately for each connection.</p>
      <fieldset disabled={!state || busy}><label>Hamlib connection<select aria-label="Shared Hamlib connection" value={config.mode} onChange={event => updateConfig(event.target.value === "external" ? { mode: "external", host: "127.0.0.1", port: 4532 } : { mode: "managed", path: "", baud: 9600 })}><option value="managed">Built-in Hamlib</option><option value="external">Existing local Hamlib daemon</option></select></label>
      {config.mode === "managed" ? <><SharedHamlibModelBrowser selected={config.model} onSelect={id => updateConfig({ ...config, model: id })} />
        <label>Hamlib model ID (manual entry)<input aria-label="Shared Hamlib model ID" type="number" min="1" value={config.model ?? ""} onChange={event => updateConfig({ ...config, model: Number(event.target.value) })} /></label>
        <label>Serial device or device TCP address<input aria-label="Shared Hamlib device path" value={config.path ?? ""} onChange={event => updateConfig({ ...config, path: event.target.value })} /></label>
        <label>Serial baud<input aria-label="Shared Hamlib baud" type="number" min="300" max="921600" value={config.baud ?? 9600} onChange={event => updateConfig({ ...config, baud: Number(event.target.value) })} /></label>
        <details><summary>Serial framing and control lines</summary>{[
          ["data_bits", "Data bits", [7, 8]], ["stop_bits", "Stop bits", [1, 2]], ["parity", "Parity", ["None", "Even", "Odd", "Mark", "Space"]],
          ["handshake", "Handshake", ["None", "XONXOFF", "Hardware"]], ["dtr_state", "DTR", ["Unset", "OFF", "ON"]], ["rts_state", "RTS", ["Unset", "OFF", "ON"]],
        ].map(([key, label, choices]) => <label key={String(key)}>{String(label)}<select aria-label={`Shared Hamlib ${label}`} value={config.serial?.[String(key)] ?? ""} onChange={event => { const serial = { ...config.serial }; if (!event.target.value) delete serial[String(key)]; else serial[String(key)] = ["data_bits", "stop_bits"].includes(String(key)) ? Number(event.target.value) : event.target.value; updateConfig({ ...config, serial }); }}><option value="">Model default</option>{(choices as (string | number)[]).map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}</details></>
        : <><label>Local daemon host<select aria-label="Shared Hamlib host" value={config.host} onChange={event => updateConfig({ ...config, host: event.target.value })}>{["127.0.0.1", "::1", "localhost"].map(host => <option key={host}>{host}</option>)}</select></label><label>Port<input aria-label="Shared Hamlib port" type="number" min="1" max="65535" value={config.port ?? ""} onChange={event => updateConfig({ ...config, port: Number(event.target.value) })} /></label></>}
      </fieldset>
      <button type="button" disabled={!state || busy || !!pending || conflict} onClick={() => void execute("save")}>Save Hamlib configuration</button>
      <button type="button" disabled={busy} onClick={() => void refresh(true)}>Reload saved Hamlib configuration</button>
      {dirty.current && <p>Save configuration changes before connecting.</p>}
      {conflict && <p role="alert">Station setup changed in another window. Your text is retained; reload saved Hamlib configuration to review it.</p>}
      <label><input type="checkbox" checked={transmit} onChange={event => setTransmit(event.target.checked)} />Enable Hamlib transmit commands for this connection</label>
      <div className="live-station-actionrow"><button type="button" disabled={!selected || !state?.hamlib || dirty.current || conflict || busy || !!pending} onClick={() => void execute("connect")}>Connect saved Hamlib radio</button>
        <button type="button" disabled={!selected || !state?.hamlib || dirty.current || conflict || busy || !!pending} onClick={() => void execute("reconnect")}>Reconnect saved Hamlib radio</button>
        <button type="button" disabled={!selected || busy || !!pending} onClick={() => void execute("disconnect")}>Disconnect Hamlib radio</button></div>
      {!selected && <p>Select Local Hamlib before connecting.</p>}
    </>}
    {!onlySelection && !hamlib && !flex && <><p>Saved Agent endpoint is shared across windows. Saving it does not connect a radio.</p>
    <label>Agent HTTPS URL<input aria-label="Shared Agent HTTPS URL" type="url" value={url} disabled={!state || busy}
      placeholder="https://station.example:8443" onChange={event => { dirty.current = true; setLegacyHint(false); setURL(event.target.value); }} /></label>
    <div className="live-station-actionrow"><button type="button" disabled={!state || busy || !!pending || conflict} onClick={() => void execute("save")}>{legacyHint ? "Import previous Agent endpoint" : "Save Agent endpoint"}</button>
      <button type="button" disabled={busy} onClick={() => void refresh(true)}>Reload saved endpoint</button></div>
    {legacyHint && <p>Your previous Desk endpoint is shown for review. Import it once to share it across windows.</p>}
    {state && dirty.current && <p>Save endpoint changes before connecting. This text has not changed shared setup.</p>}
    {conflict && <p role="alert">Agent setup changed in another window. Your text is retained; reload saved endpoint to review the current setup.</p>}
    </>}
    {connections && !hamlib && !flex && <>
      <p>Saved Agent setup and connection tests do not confirm the running station session. Check the live station status for current radio observations; an interrupted session retries automatically.</p>
      <label>Agent token<input aria-label="Shared Agent token" type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} /></label>
      <label><input type="checkbox" checked={transmit} onChange={event => setTransmit(event.target.checked)} /> Allow CAT transmit controls for this connection</label>
      <div className="live-station-actionrow"><button type="button" disabled={!selected || !state?.base_url || dirty.current || conflict || busy || !!pending} onClick={() => void execute("connect")}>Connect saved Agent</button>
        <button type="button" disabled={!selected || busy || !!pending} onClick={() => void execute("disconnect")}>Disconnect Agent</button></div>
      <button type="button" disabled={!selected || !state?.base_url || dirty.current || conflict || busy || !!pending} onClick={() => void execute("forget")}>Forget saved Agent token</button>
      {!selected && <p>{providers ? "Select Remote Station Agent above before connecting." : "Select Remote Station Agent in the main station controls before connecting."}</p>}
    </>}
    {onlySelection && <button type="button" disabled={busy} onClick={() => void refresh()}>Refresh radio selection</button>}
    {pending && <button type="button" disabled={busy} onClick={() => void check()}>{onlySelection ? "Check radio selection receipt" : "Check connection setup receipt"}</button>}
    {pending && message.includes("unknown") && <button type="button" disabled={busy} onClick={() => { sessionStorage.setItem(reviewedKey, pending); sessionStorage.removeItem(journalKey); setPending(null); setMessage("Previous outcome remains unknown. Review observed state before a new explicit request."); void refresh(); }}>I have reviewed observed state</button>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    {state?.last_receipt && <p>Last shared operation: {state.last_receipt.request.action} · {state.last_receipt.status}. Acknowledgement does not confirm radio state.</p>}
  </div>;
}

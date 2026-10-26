import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { RefreshCw } from "lucide-react";
import { loadStationSession, radioLabel, stationSessionRequest, validTCIConfiguration, type RadioID, type RadioProfile, type TCIConfiguration, type FlexConfiguration, type HamlibConfiguration, type StationReceipt, type StationSession } from "./stationSession";
import { RadioConnectionForm, type RadioSetupAction } from "./RadioConnectionForm";
import type { StationProvider } from "../worker";
import { SharedHamlibModelBrowser } from "./HamlibModelPicker";
import type { MonitorContext } from "./monitorContext";
import { stationReceiveAvailable } from "./stationReceive";
import { useSettingsSaveToast } from "./SettingsSaveToast";

const providerLabels: Record<StationProvider, string> = { direct_agent: "Remote Station Agent", direct_flex_lan: "Direct FLEX LAN", direct_tci: "Direct TCI · receive control", hamlib: "Local Hamlib" };
const receiveModes = ["USB", "LSB", "CW", "CWR", "AM", "FM", "RTTY", "RTTYR", "DIGU", "DIGL"];
const notice = (receipt: StationReceipt) => receipt.request.action === "select"
  ? receipt.status === "acknowledged" ? "Radio selection acknowledged. Connect the selected radio explicitly."
    : "Radio selection outcome is unknown. Review the selected radio and check this receipt before another request."
  : receipt.request.action.startsWith("receive_") ? receipt.status === "acknowledged" ? "Receive control request acknowledged. Check fresh observations before another action." : "Receive control outcome is unknown. Check observed state and this receipt before another action."
  : receipt.status === "saved" ? receipt.request.action === "save_tci" ? "TCI configuration saved. No connection was started." : receipt.request.action === "save_hamlib" ? "Hamlib configuration saved. No connection was started." : receipt.request.action === "save_flex" ? "FLEX configuration saved. No connection was started." : "Agent endpoint saved. No connection was started."
  : receipt.status === "acknowledged" ? "Connection request acknowledged. Check observed station state before operating."
  : "Connection outcome is unknown. Check observed station state before issuing another connection request.";

/** Desk and child share one native radio setup, lifecycle and receipt owner. */
export function AgentConnectionSetup({ radioId, connections = false, legacyEndpoint = "", providers = false, onlySelection = false, selectionTarget, activeProvider, hamlib: hamlibSetup = false, flex: flexSetup = false, followSelection = false, compact = false, radioForm = false, receiveContext, onSession, onDraftState }: {
  radioId: RadioID; connections?: boolean; legacyEndpoint?: string; providers?: boolean; onlySelection?: boolean; selectionTarget?: StationProvider; activeProvider?: StationProvider; hamlib?: boolean; flex?: boolean; followSelection?: boolean; compact?: boolean; radioForm?: boolean; receiveContext?: MonitorContext | null; onSession?: (value: StationSession) => void; onDraftState?: (blocked: boolean) => void;
}) {
  const journalKey = `xlog.station-session.${radioId}.pending`;
  const reviewedKey = `xlog.station-session.${radioId}.reviewed`;
  const [state, setState] = useState<StationSession | null>(null), [url, setURL] = useState("");
  const [profile, setProfile] = useState<RadioProfile>({ manufacturer: "", model: "", nickname: "", provider: "direct_agent", enabled: true });
  const hamlib = radioForm ? profile.provider === "hamlib" : hamlibSetup || followSelection && state?.selection.provider === "hamlib";
  const flex = radioForm ? profile.provider === "direct_flex_lan" : flexSetup || followSelection && state?.selection.provider === "direct_flex_lan";
  const tci = radioForm ? profile.provider === "direct_tci" : followSelection && state?.selection.provider === "direct_tci";
  const [config, setConfig] = useState<HamlibConfiguration>({ mode: "managed", model: undefined, path: "", baud: radioForm ? undefined : 9600 });
  const [flexConfig, setFlexConfig] = useState<FlexConfiguration>({ host: "", port: 4992, station_name: "OM0RX-xLog" });
  const [tciConfig, setTCIConfig] = useState<TCIConfiguration>({ endpoint: "", trx: 0, channel: 0 });
  const [token, setToken] = useState(""), [transmit, setTransmit] = useState(!radioForm);
  const [agentTransmit, setAgentTransmit] = useState(true);
  const [receiveMHz, setReceiveMHz] = useState(""), [receiveMode, setReceiveMode] = useState("USB"), [consumedObservation, setConsumedObservation] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [sequenceBusy, setSequenceBusy] = useState(false);
  const coordinating = useRef(false);
  const saveToast = useSettingsSaveToast();
  const [pending, setPending] = useState(() => sessionStorage.getItem(journalKey));
  const [conflict, setConflict] = useState(false);
  const [legacyHint, setLegacyHint] = useState(false);
  const [providerTarget, setProviderTarget] = useState<StationProvider | null>(null);
  const active = useRef(false), dirty = useRef(false), inFlight = useRef(false), readSequence = useRef(0);
  const current = useRef<StationSession | null>(null);
  const refresh = async (adopt = false) => {
    const sequence = ++readSequence.current;
    try {
      const next = await loadStationSession(radioId);
      if (!active.current || sequence !== readSequence.current) return;
      if (next.generation !== current.current?.generation || next.revision !== current.current?.revision
        || next.selection.selection_id !== current.current?.selection.selection_id) { if (!radioForm) setTransmit(true); }
      onSession?.(next);
      if (adopt || !dirty.current) {
        const hint = !adopt && !current.current && !next.base_url && next.revision === 0 && !next.last_receipt ? legacyEndpoint : "";
        current.current = next; setState(next); setURL(hint || next.base_url); dirty.current = !!hint; setConflict(false);
        setConfig(next.hamlib ?? { mode: "managed", path: "", baud: radioForm ? undefined : 9600 });
        setFlexConfig(next.flex ?? { host: "", port: 4992, station_name: "OM0RX-xLog" });
        setTCIConfig(next.tci ?? { endpoint: "", trx: 0, channel: 0 });
        if (radioForm) {
          const provider = next.profile?.provider ?? next.selection.provider as StationProvider | null ?? "direct_agent";
          setProfile(next.profile ?? { manufacturer: provider === "direct_flex_lan" ? "FlexRadio" : provider === "direct_tci" ? "Expert Electronics" : "", model: "", nickname: "", provider, enabled: true });
        }
        setLegacyHint(!!hint);
      } else if (next.generation !== current.current?.generation || next.revision !== current.current?.revision) {
        setConflict(true);
      } else { current.current = next; setState(next); }
      const unresolved = radioForm ? next.pending_setup_receipt ?? next.last_receipt : next.last_receipt;
      if (unresolved && ["pending", "unknown"].includes(unresolved.status)
        && sessionStorage.getItem(reviewedKey) !== unresolved.operation_id) {
        sessionStorage.setItem(journalKey, unresolved.operation_id); setPending(unresolved.operation_id);
        setMessage(radioForm ? "The last operation outcome is uncertain. Check it before trying again." : notice(unresolved));
      }
      if (next.last_receipt && ["saved", "acknowledged"].includes(next.last_receipt.status)
        && sessionStorage.getItem(journalKey) === next.last_receipt.operation_id) {
        sessionStorage.removeItem(journalKey); setPending(null); setMessage(radioForm ? next.last_receipt.status === "saved" ? "Radio setup saved." : "Connection request completed. Check current radio status." : notice(next.last_receipt));
      }
      setError("");
      return next;
    } catch { if (active.current && sequence === readSequence.current) setError("Shared station setup is unavailable. Refresh before making changes."); }
  };
  useEffect(() => {
    active.current = true; const stops: (() => void)[] = [];
    const focused = () => { void refresh(); };
    window.addEventListener("focus", focused);
    const events = ["xlog:station-session", "xlog:station-selection", ...(radioForm ? ["xlog:station-telemetry"] : [])];
    void Promise.allSettled(events.map(name => listen(name, () => { void refresh(); }))).then(results => {
      for (const result of results) {
        if (result.status === "fulfilled") { if (active.current) stops.push(result.value); else result.value(); }
      }
      if (active.current) void refresh();
    });
    return () => { active.current = false; readSequence.current++; stops.forEach(stop => stop()); window.removeEventListener("focus", focused); };
  }, []);
  // Durable uncertain operations survive navigation; only local text and an
  // operation still executing in this view need the presentation/close fence.
  useEffect(() => { onDraftState?.(dirty.current || busy || sequenceBusy); });
  useEffect(() => () => onDraftState?.(false), []);
  const target = radioForm ? profile.provider : selectionTarget ?? providerTarget ?? (state?.selection.provider as StationProvider | null) ?? "direct_agent";
  const observation = receiveContext ? `${receiveContext.selection?.selection_id}:${receiveContext.selection?.control_revision}:${receiveContext.radio.received_at_ms}` : "";
  const receiveHz = receiveMHz.trim() && Number.isFinite(Number(receiveMHz)) ? Math.round(Number(receiveMHz) * 1e6) : 0;
  const receiveReady = (control: "frequency" | "mode") => observation !== consumedObservation && stationReceiveAvailable(receiveContext ?? null, control)
    && state?.selection.provider === receiveContext?.selection?.provider && state?.selection.selection_id === receiveContext?.selection?.selection_id
    && state?.selection.generation === receiveContext?.selection?.generation;
  const execute = async (action: "save" | "connect" | "reconnect" | "disconnect" | "forget" | "select" | "receive_frequency" | "receive_mode") => {
    const base = current.current;
    if (!base || inFlight.current || pending) return;
    // Disconnect always addresses the live route, even while another setup is drafted.
    const route = radioForm ? action === "disconnect" ? base.selection.provider : profile.provider : null;
    const tci = radioForm ? route === "direct_tci" : followSelection && base.selection.provider === "direct_tci";
    const flex = radioForm ? route === "direct_flex_lan" : flexSetup || followSelection && base.selection.provider === "direct_flex_lan";
    const hamlib = radioForm ? route === "hamlib" : hamlibSetup || followSelection && base.selection.provider === "hamlib";
    if (tci && (action === "save" && !validTCIConfiguration(tciConfig) || !["save", "select", "connect", "disconnect"].includes(action))) return;
    const receive = action.startsWith("receive_");
    const receiveControl = action === "receive_mode" ? "mode" : "frequency";
    if (receive && (!receiveReady(receiveControl) || action === "receive_frequency" && (!Number.isSafeInteger(receiveHz) || receiveHz < 100_000 || receiveHz > 1_000_000_000))) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    const id = crypto.randomUUID();
    try {
      // Journal identity only: tokens and access-bearing connection details never enter browser storage.
      sessionStorage.setItem(journalKey, id); setPending(id);
      if (receive) setConsumedObservation(observation);
      const receipt = await stationSessionRequest<StationReceipt>(radioId, receive ? { action, operation_id: id, generation: base.generation, revision: base.revision,
        provider: receiveContext!.selection!.provider, selection_generation: receiveContext!.selection!.generation, selection_id: receiveContext!.selection!.selection_id,
        control_revision: receiveContext!.selection!.control_revision, connection_generation: receiveContext!.radio.snapshot.generation,
        ...(action === "receive_frequency" ? { frequency_hz: receiveHz } : { mode: receiveMode }) }
        : { action: action !== "select" && (tci || hamlib || flex) ? `${action}_${tci ? "tci" : flex ? "flex" : "hamlib"}` : action, operation_id: id, generation: base.generation, revision: base.revision,
        ...(action === "save" ? { ...(tci ? { configuration: { ...tciConfig, endpoint: tciConfig.endpoint.trim() } } : flex ? { configuration: { ...flexConfig, host: flexConfig.host.trim(), station_name: flexConfig.station_name.trim() } } : hamlib ? { configuration: config } : { base_url: url.trim() }), ...(radioForm ? { profile } : {}) } : { selection_generation: base.selection.generation, selection_id: base.selection.selection_id,
          ...(action === "select" ? { provider: target } : tci ? {} : { allow_transmit: ["connect", "reconnect"].includes(action) && (radioForm || hamlib || flex ? transmit : agentTransmit) }), ...(!tci && !hamlib && !flex && action === "connect" && token ? { token } : {}) }) });
      if (!active.current) return;
      if (action === "connect") setToken("");
      if (!radioForm && receipt.status === "saved") saveToast.show(notice(receipt));
      else setMessage(radioForm ? receipt.status === "saved" ? "Radio setup saved." : receipt.status === "acknowledged" ? "Connection request completed. Waiting for current radio status." : "The operation outcome is uncertain. Check it before trying again." : notice(receipt));
      if (receipt.status === "saved" || receipt.status === "acknowledged") {
        sessionStorage.removeItem(journalKey); setPending(null);
        const next = await refresh(action === "save");
        return !!next && !(radioForm && next.pending_setup_receipt && ["pending", "unknown"].includes(next.pending_setup_receipt.status));
      }
    } catch (cause) { if (active.current) setError(radioForm ? `${typeof cause === "string" ? cause : cause instanceof Error ? cause.message : "No outcome was confirmed."} Check the operation before trying again.` : "No outcome was confirmed. Check this operation's receipt before trying another request."); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  const check = async () => {
    if (!pending || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const receipt = await stationSessionRequest<StationReceipt | null>(radioId, { action: "receipt", operation_id: pending });
      if (!active.current) return;
      setError("");
      if (receipt?.status === "saved") saveToast.show(notice(receipt));
      else setMessage(receipt ? notice(receipt) : "No operation was admitted under this identity. Refresh setup before trying again.");
      if (!receipt || receipt.status === "saved" || receipt.status === "acknowledged") {
        if (!receipt) setConsumedObservation("");
        sessionStorage.removeItem(journalKey); setPending(null); await refresh();
      }
    } catch { if (active.current) setError("The receipt is unavailable. Keep this operation pending and check again."); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  const selected = state?.selection.provider === (tci ? "direct_tci" : flex ? "direct_flex_lan" : hamlib ? "hamlib" : "direct_agent") && !!state.selection.selection_id;
  const displayedProvider = activeProvider ?? state?.selection.provider as StationProvider | null | undefined;
  const updateConfig = (next: HamlibConfiguration) => { dirty.current = true; setConfig(next); };
  const review = async () => {
    if (!pending || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      const receipt = await stationSessionRequest<StationReceipt | null>(radioId, { action: "receipt", operation_id: pending });
      if (!receipt || receipt.status !== "unknown") throw new Error("Check the operation first. Only an uncertain outcome can be marked reviewed.");
      const reviewed = await stationSessionRequest<StationReceipt>(radioId, { action: "review", operation_id: pending, reviewed_action: receipt.request.action });
      if (reviewed.status !== "reviewed") throw new Error("The review was not saved. Check the operation again.");
      sessionStorage.removeItem(journalKey); setPending(null);
      await refresh(); setMessage("Outcome marked reviewed; this does not confirm a connection or transmission. A new action requires your explicit request.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The review could not be saved. Check the operation again."); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  const setupAction = async (action: RadioSetupAction) => {
    if (coordinating.current || inFlight.current || pending || conflict || !current.current) return;
    const base = current.current;
    const replace = action !== "save" && (base.radio?.snapshot?.radio?.connected === true || base.tx_owner === radioId) && action !== "disconnect";
    if ((replace || action === "save_disconnect") && !window.confirm(`${radioLabel(radioId)} will release its current controls and disconnect before applying this setup. Continue?`)) return;
    coordinating.current = true; setSequenceBusy(true);
    const matchesDraft = () => {
      const next = current.current;
      if (!next?.profile || !Object.entries(profile).every(([key, value]) => next.profile?.[key as keyof RadioProfile] === value)) return false;
      if (profile.provider === "direct_flex_lan") return next.flex?.host === flexConfig.host.trim() && next.flex?.port === flexConfig.port && next.flex?.station_name === flexConfig.station_name.trim();
      if (profile.provider === "direct_tci") return next.tci?.endpoint === new URL(tciConfig.endpoint.trim()).href && next.tci?.trx === tciConfig.trx && next.tci?.channel === tciConfig.channel;
      if (profile.provider === "hamlib") return Object.entries(config).every(([key, value]) => key === "serial"
        ? Object.entries(value ?? {}).every(([name, setting]) => next.hamlib?.serial?.[name] === setting) && Object.keys(next.hamlib?.serial ?? {}).length === Object.keys(value ?? {}).length
        : next.hamlib?.[key as keyof HamlibConfiguration] === value);
      return next.base_url.replace(/\/$/, "") === url.trim().replace(/\/$/, "");
    };
    try {
      // One explicit gesture, existing scoped operations, fresh revision after every step.
      if (["save", "save_connect", "save_disconnect"].includes(action) && !await execute("save")) return;
      if (action === "save") return;
      if (action === "disconnect" || action === "save_disconnect") { await execute("disconnect"); return; }
      if (!matchesDraft()) { setError("The saved setup changed while connecting. Your connection was not started; review and try again explicitly."); return; }
      if (replace && !await execute("disconnect")) return;
      if (current.current?.selection.provider !== profile.provider && !await execute("select")) return;
      if (!matchesDraft()) { setError("The saved setup changed during handover. Review it before connecting."); return; }
      if (current.current?.selection.provider !== profile.provider) { setError("The requested radio route was not confirmed. Refresh before connecting."); return; }
      await execute("connect");
    } finally { coordinating.current = false; if (active.current) setSequenceBusy(false); }
  };
  if (radioForm) return <RadioConnectionForm radioId={radioId} state={state} profile={profile}
    setProfile={(value, edited = true) => { if (edited) dirty.current = true; setProfile(value); }}
    config={config} setConfig={updateConfig} flex={flexConfig} setFlex={value => { dirty.current = true; setFlexConfig(value); }}
    tci={tciConfig} setTCI={value => { dirty.current = true; setTCIConfig(value); }}
    url={url} setURL={value => { dirty.current = true; setURL(value); }} token={token} setToken={setToken}
    transmit={transmit} setTransmit={setTransmit} dirty={dirty.current} busy={busy || sequenceBusy} pending={pending} conflict={conflict} message={message} error={error}
    onAction={action => void setupAction(action)} onRevert={() => void refresh(true)} onCheck={() => void (pending ? check() : refresh())} onReview={() => void review()} />;
  return <div className={`live-station-connect${onlySelection ? " is-selection-only" : ""}`} aria-label={onlySelection ? "Shared radio selection" : tci ? "Shared TCI connection setup" : flex ? "Shared FLEX connection setup" : hamlib ? "Shared Hamlib connection setup" : "Shared Agent connection setup"}>
    {tci && !onlySelection && <><h3>Direct TCI connection · read only</h3>
      <p>Save a credential-free ws/wss endpoint and receiver selection, then connect explicitly. TCI permits explicit receive-frequency and mode tuning only. Saving does not connect; interrupted connections require an explicit new connection.</p>
      <fieldset disabled={!state || busy}>
        <label>TCI WebSocket endpoint<input aria-label="Shared TCI endpoint" type="url" autoComplete="off" placeholder="ws://127.0.0.1:50001" value={tciConfig.endpoint} onChange={event => { dirty.current = true; setTCIConfig({ ...tciConfig, endpoint: event.target.value }); }} /></label>
        <label>TCI TRX<input aria-label="Shared TCI TRX" type="number" min="0" max="15" value={Number.isNaN(tciConfig.trx) ? "" : tciConfig.trx} onChange={event => { dirty.current = true; setTCIConfig({ ...tciConfig, trx: event.target.value === "" ? NaN : Number(event.target.value) }); }} /></label>
        <label>TCI channel<input aria-label="Shared TCI channel" type="number" min="0" max="15" value={Number.isNaN(tciConfig.channel) ? "" : tciConfig.channel} onChange={event => { dirty.current = true; setTCIConfig({ ...tciConfig, channel: event.target.value === "" ? NaN : Number(event.target.value) }); }} /></label>
      </fieldset>
      <div className="live-station-actionrow"><button type="button" disabled={!state || busy || !!pending || conflict || !validTCIConfiguration(tciConfig)} onClick={() => void execute("save")}>Save TCI configuration</button>
        <button type="button" disabled={busy} onClick={() => void refresh(true)}>Reload saved TCI configuration</button></div>
      {dirty.current && <p>Save configuration changes before connecting.</p>}
      {conflict && <p role="alert">Station setup changed in another window. Your text is retained; reload saved TCI configuration to review it.</p>}
      <div className="live-station-actionrow"><button type="button" disabled={!selected || !state?.tci || dirty.current || conflict || busy || !!pending} onClick={() => void execute("connect")}>Connect saved TCI radio</button>
        <button type="button" disabled={!selected || busy || !!pending} onClick={() => void execute("disconnect")}>Disconnect TCI radio</button></div>
    </>}
    {providers && (onlySelection ? <div className="live-station-selection">
      {displayedProvider && <span className="live-station-status is-online" role="status"><i aria-hidden="true" />Active · {providerLabels[displayedProvider]}</span>}
      {displayedProvider !== target && state?.selection.selection_id && <button type="button" aria-label="Apply shared radio selection"
        disabled={busy || !!pending || !!error} onClick={() => void execute("select")}>Use {providerLabels[target]}</button>}
      {error && !state && <button type="button" className="live-station-selection-retry" aria-label="Refresh radio selection" title="Refresh radio selection"
        disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} aria-hidden="true" /></button>}
    </div> : <div>
      <p>Selected radio: {state?.selection.provider ? providerLabels[state.selection.provider as StationProvider] : "Unavailable"}{compact ? "" : ". Applying a different provider retires the previous radio. Connect the selected radio explicitly."}</p>
      {selectionTarget ? <p>Requested radio: {providerLabels[selectionTarget]}</p> : <label>Radio provider<select aria-label="Shared radio provider" value={target} disabled={!state || busy || !!pending} onChange={event => setProviderTarget(event.target.value as StationProvider)}>
        {(Object.keys(providerLabels) as StationProvider[]).map(provider => <option key={provider} value={provider}>{providerLabels[provider]}</option>)}
      </select></label>}
      <button type="button" disabled={!state?.selection.selection_id || state.selection.provider === target || busy || !!pending || !!error}
        onClick={() => void execute("select")}>Apply shared radio selection</button>
    </div>)}
    {flex && <><h3>{compact ? "Direct FLEX LAN connection" : "Shared Direct FLEX LAN connection"}</h3>{!compact && <p>Save a private numeric radio IP, TCP port and station name for Desk and Station Control. Saving does not contact a radio. Request transmit permission separately for each connection.</p>}
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
      {!compact && <p>Reconnect replaces the connection with saved setup and the current transmit opt-in. No previous radio commands are replayed.</p>}
      {!selected && <p>Select Direct FLEX LAN before connecting.</p>}
    </>}
    {hamlib && !flex && <><h3>{compact ? "Hamlib radio connection" : "Shared Hamlib radio connection"}</h3>{!compact && <p>Save configuration for Desk and Station Control, then connect explicitly. Saving does not contact a device. Request transmit permission separately for each connection.</p>}
      <fieldset disabled={!state || busy}><label>Hamlib connection<select aria-label="Shared Hamlib connection" value={config.mode} onChange={event => updateConfig(event.target.value === "external" ? { mode: "external", host: "127.0.0.1", port: 4532 } : { mode: "managed", path: "", baud: 9600 })}><option value="managed">Built-in Hamlib</option><option value="external">Existing local Hamlib daemon</option></select></label>
      {config.mode === "managed" ? <><SharedHamlibModelBrowser radioId={radioId} selected={config.model} onSelect={id => updateConfig({ ...config, model: id })} />
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
    {!onlySelection && !tci && !hamlib && !flex && <>{!compact && <p>Saved Agent endpoint is shared across windows. Saving it does not connect a radio.</p>}
    <label>Agent HTTPS URL<input aria-label="Shared Agent HTTPS URL" type="url" value={url} disabled={!state || busy}
      placeholder="https://station.example:8443" onChange={event => { dirty.current = true; setLegacyHint(false); setURL(event.target.value); }} /></label>
    <div className="live-station-actionrow"><button type="button" disabled={!state || busy || !!pending || conflict} onClick={() => void execute("save")}>{legacyHint ? "Import previous Agent endpoint" : "Save Agent endpoint"}</button>
      <button type="button" disabled={busy} onClick={() => void refresh(true)}>Reload saved endpoint</button></div>
    {legacyHint && <p>Your previous Desk endpoint is shown for review. Import it once to share it across windows.</p>}
    {state && dirty.current && <p>Save endpoint changes before connecting. This text has not changed shared setup.</p>}
    {conflict && <p role="alert">Agent setup changed in another window. Your text is retained; reload saved endpoint to review the current setup.</p>}
    </>}
    {connections && !tci && !hamlib && !flex && <>
      {!compact && <p>Saved Agent setup and connection tests do not confirm the running station session. Check the live station status for current radio observations; an interrupted session retries automatically.</p>}
      <label>Agent token<input aria-label="Shared Agent token" type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} /></label>
      <label><input type="checkbox" checked={agentTransmit} onChange={event => setAgentTransmit(event.target.checked)} /> Allow CAT transmit controls for this connection</label>
      <div className="live-station-actionrow"><button type="button" disabled={!selected || !state?.base_url || dirty.current || conflict || busy || !!pending} onClick={() => void execute("connect")}>Connect saved Agent</button>
        <button type="button" disabled={!selected || busy || !!pending} onClick={() => void execute("disconnect")}>Disconnect Agent</button></div>
      <button type="button" disabled={!selected || !state?.base_url || dirty.current || conflict || busy || !!pending} onClick={() => void execute("forget")}>Forget saved Agent token</button>
      {!selected && <p>{providers ? "Select Remote Station Agent above before connecting." : "Select Remote Station Agent in the main station controls before connecting."}</p>}
    </>}
    {receiveContext && ["direct_agent", "direct_flex_lan", "hamlib"].includes(receiveContext.selection?.provider ?? "") &&
      <section aria-label="Exact receive controls"><h3>Receive VFO A</h3>
        {!compact && <p>Frequency and mode controls require a fresh observed receive/PTT-off state on VFO A. A request acknowledgement does not confirm the new radio state.</p>}
        <label>Receive frequency MHz<input aria-label="Child receive frequency MHz" inputMode="decimal" value={receiveMHz} onChange={event => setReceiveMHz(event.target.value)} /></label>
        <button type="button" disabled={!receiveReady("frequency") || busy || !!pending || receiveHz < 100_000 || receiveHz > 1_000_000_000} onClick={() => void execute("receive_frequency")}>Set receive VFO A frequency</button>
        <label>Receive mode<select aria-label="Child receive mode" value={receiveMode} onChange={event => setReceiveMode(event.target.value)}>{receiveModes.map(mode => <option key={mode}>{mode}</option>)}</select></label>
        <button type="button" disabled={!receiveReady("mode") || busy || !!pending} onClick={() => void execute("receive_mode")}>Set receive VFO A mode</button>
      </section>}
    {pending && <button type="button" disabled={busy} onClick={() => void check()}>{onlySelection ? "Check radio selection receipt" : "Check connection setup receipt"}</button>}
    {pending && message.includes("unknown") && <button type="button" disabled={busy} onClick={() => { sessionStorage.setItem(reviewedKey, pending); sessionStorage.removeItem(journalKey); setPending(null); setMessage("Previous outcome remains unknown. Review observed state before a new explicit request."); void refresh(); }}>I have reviewed observed state</button>}
    {message && (!onlySelection || !!pending) && <p role="status">{message}</p>}{saveToast.toast}{error && (!onlySelection || !!state) && <p role="alert">{error}</p>}
    {state?.last_receipt && !onlySelection && <p>Last shared operation: {state.last_receipt.request.action} · {state.last_receipt.status}. Acknowledgement does not confirm radio state.</p>}
  </div>;
}

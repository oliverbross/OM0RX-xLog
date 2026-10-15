import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Antenna } from "lucide-react";
import { HamlibDevice } from "./HamlibPanel";
import { rotorCommandParams, rotorProjection, validRotorSnapshot, type RotorSnapshot } from "./rotorControl";
import { RotorConfigurationSession, rotorConfigurationDirty, type RotorConfiguration } from "./rotorConfigurationSession";
import { ManualRotorStatus } from "./ManualRotorControl";
import { manualRotorGotoSession, type ManualRotorGotoSession } from "./manualRotorGoto";
import "./RotorPanel.css";

type Data = Record<string, any>;
type Request = (method: string, params?: Data) => Promise<Data>;
type Props = { snapshot: RotorSnapshot | null; request: Request; onManual?: () => void;
  configurationSession: RotorConfigurationSession; configurationOnly?: boolean; rotorSession?: ManualRotorGotoSession };

export default function RotorPanel({ snapshot, request, onManual = () => {}, configurationSession, configurationOnly = false,
  rotorSession = manualRotorGotoSession() }: Props) {
  const configurationState = useSyncExternalStore(configurationSession.subscribe, configurationSession.getSnapshot);
  const configuration = configurationState.draft;
  const owner = configuration?.owner ?? "native_dcu1";
  const [hamlibOpened, setHamlibOpened] = useState(owner === "hamlib");
  const viewedOwner = useRef(owner); viewedOwner.current = owner;
  const latest = useRef(snapshot); latest.current = snapshot;
  const manualFeedback = useRef<string | null>(null);
  const [bearing, setBearing] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const current = rotorProjection(snapshot);
  const dirty = rotorConfigurationDirty(configurationState.base, configuration);
  useEffect(() => { if (owner === "hamlib") setHamlibOpened(true); }, [owner]);

  const edit = (next: RotorConfiguration) => {
    manualFeedback.current = null;
    try { configurationSession.edit(next); setError(""); setMessage(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Rotor configuration is unavailable."); }
  };
  const saveConfiguration = async () => {
    manualFeedback.current = null;
    if (!configuration) throw new Error("Rotor configuration is still loading.");
    await configurationSession.save(configuration);
    const state = configurationSession.getSnapshot();
    if (state.pending || state.conflict || state.workspaceChanged || state.error)
      throw new Error(state.error || "The rotor configuration save was not confirmed.");
    setMessage("Rotor configuration saved. No connection or motion was started.");
  };
  const ensureSaved = async () => {
    if (rotorConfigurationDirty(configurationSession.getSnapshot().base, configurationSession.getSnapshot().draft))
      await saveConfiguration();
    const state = configurationSession.getSnapshot();
    if (!state.base || state.pending || state.conflict || state.workspaceChanged)
      throw new Error(state.error || "Resolve the rotor configuration before connecting.");
  };
  const run = async (operation: () => Promise<Data>, label: string) => {
    manualFeedback.current = null; onManual(); setBusy(true); setError(""); setMessage("");
    try {
      const result = await operation(), backend = result?.backend;
      setMessage(backend?.accepted === true || backend?.state === "accepted" ? `${label} accepted; watch the observed bearing.` : `${label} completed.`);
      return result;
    } catch (cause) {
      manualFeedback.current = label === "Rotor move" ? rotorSession.getSnapshot().pending : null;
      setError(cause instanceof Error ? cause.message : "Rotor operation failed."); throw cause;
    }
    finally { setBusy(false); }
  };
  const applySelection = async () => {
    if (!configuration || busy || configurationState.saving) return;
    manualFeedback.current = null;
    try {
      if (latest.current?.owner && latest.current.owner !== owner) {
        const departing = latest.current;
        const result = await run(() => request("rotor_disconnect", rotorCommandParams(departing)), "Rotor retirement");
        if (!validRotorSnapshot(result) || result.owner !== null || result.state !== "disconnected")
          throw new Error("Rotor retirement is unconfirmed. Keep the active selection and retry explicitly.");
        if (latest.current?.owner && (latest.current.owner !== departing.owner || latest.current.generation !== departing.generation))
          throw new Error("Rotor owner changed during retirement. Review the active connection before applying.");
      }
      await ensureSaved();
      setMessage("Rotor selection saved; connect the selected rotor explicitly.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Rotor selection could not be saved."); }
  };
  const hamlibRequest = useCallback(async (method: string, params: Data = {}) => {
    const { device: _device, ...config } = params;
    if (method === "hamlib_status") return { connected: latest.current?.owner === "hamlib" && rotorProjection(latest.current).connected, reconnect_required: latest.current?.owner === "hamlib" && latest.current?.state === "uncertain" };
    if (method === "hamlib_snapshot") return latest.current?.owner === "hamlib" ? latest.current.backend ?? {} : {};
    if (method === "hamlib_models" || method === "hamlib_serial_ports" || method === "hamlib_capabilities") return request(method, params);
    if (viewedOwner.current !== "hamlib" || latest.current?.owner && latest.current.owner !== "hamlib")
      throw new Error("Save the Hamlib rotor selection before changing its connection.");
    onManual();
    if (method === "hamlib_disconnect") return request("rotor_disconnect", rotorCommandParams(latest.current));
    if (method === "hamlib_connect" || method === "hamlib_reconnect") {
      if (method === "hamlib_reconnect" && latest.current?.owner) {
        const retired = await request("rotor_disconnect", rotorCommandParams(latest.current));
        if (!validRotorSnapshot(retired) || retired.owner !== null || retired.state !== "disconnected")
          throw new Error("Rotor retirement is unconfirmed; reconnect was not attempted.");
      }
      return request("rotor_connect", { owner: "hamlib", ...config });
    }
    throw new Error("Use the independent rotor motion controls below.");
  }, [request, onManual]);

  if (!configuration) return <section className="live-station rotor-panel" aria-label={configurationOnly ? "Rotor configuration" : "Independent rotor"}><p role="status">Loading shared rotor configuration…</p></section>;
  const native = configuration.native_dcu1;
  const updateNative = (field: keyof typeof native, value: string | number) => edit({ ...configuration,
    native_dcu1: { ...native, [field]: value } });
  const updateHamlib = (hamlib: Data) => edit({ ...configuration, hamlib: hamlib as RotorConfiguration["hamlib"] });
  const blocked = busy || configurationState.saving || !!configurationState.pending || !!configurationState.conflict || configurationState.workspaceChanged;
  const savedOwner = configurationState.base?.configuration.owner;
  const ownerApplied = snapshot?.owner ? snapshot.owner === owner : savedOwner === owner && !dirty;

  return <section className="live-station rotor-panel" aria-label={configurationOnly ? "Rotor configuration" : "Independent rotor"}>
    <header className="live-station-head"><div><h2><Antenna size={17} /> {configurationOnly ? "Rotor configuration" : "Independent rotor"}</h2>
      <p>{configurationOnly ? "Shared passive connection preferences. Opening, browsing and saving never connect, arm or move a rotor." : "Pair either rotor with the selected radio. Changing radios keeps this rotor connected."}</p></div>
      {!configurationOnly && <span className={current.connected ? "teal" : "amber"}>{current.connected ? "Connected" : current.status}</span>}</header>
    <div className="live-actions" role="group" aria-label="Rotor connection type">{([ ["native_dcu1", "DCU-1 · TCP"], ["hamlib", "Local rotor · Hamlib"] ] as const).map(([id, label]) =>
      <button key={id} disabled={blocked} aria-pressed={owner === id} onClick={() => { edit({ ...configuration, owner: id }); if (id === "hamlib") setHamlibOpened(true); }}>{label}</button>)}
      {!configurationOnly && !ownerApplied && <button type="button" disabled={blocked} onClick={() => void applySelection()}>Apply rotor selection</button>}
      {configurationOnly && <button type="button" disabled={blocked || !dirty} onClick={() => void saveConfiguration().catch(cause => setError(cause.message))}>{configurationState.saving ? "Saving…" : "Save rotor configuration"}</button>}
      {!configurationOnly && <span>Active rotor: {snapshot?.owner === "hamlib" ? "Hamlib" : snapshot?.owner === "native_dcu1" ? "DCU-1" : "Disconnected"}. {!ownerApplied ? "Viewing only. Apply to retire a different active rotor and save this selection." : "Connecting and motion require an explicit action."}</span>}
    </div>
    <div className="rotor-panel-layout"><div><div hidden={owner !== "hamlib"}>{hamlibOpened && <HamlibDevice device="rotor" request={hamlibRequest}
      state={!configurationOnly && snapshot?.owner === "hamlib" ? snapshot.backend : undefined} configurationOnly
      connectionControls={!configurationOnly} connectionOwned={!configurationOnly && !!snapshot?.owner}
      connectionSelectionAllowed={!configurationOnly && ownerApplied && !blocked}
      configuration={configuration.hamlib} onConfigurationChange={updateHamlib} configurationBusy={blocked}
      onBeforeConnection={async () => { await ensureSaved(); }} />}</div>
      <section hidden={owner !== "native_dcu1"} className="live-station-card"><h3>DCU-1 connection</h3>
        <form className="live-station-connect" onSubmit={event => { event.preventDefault(); if (configurationOnly || !ownerApplied || latest.current?.owner) return;
          void ensureSaved().then(() => run(() => request("rotor_connect", { owner: "native_dcu1", host: native.host.trim(), port: native.port, name: native.name.trim() }), "Rotor connection")).catch(cause => setError(cause.message));
        }}><label>Rotor TCP host<input aria-label="Rotor TCP host" value={native.host} onChange={event => updateNative("host", event.target.value)} /></label>
          <label>Rotor TCP port<input aria-label="Rotor TCP port" type="number" min="1" max="65535" value={native.port || ""} onChange={event => updateNative("port", Number(event.target.value))} /></label>
          <label>Name<input aria-label="Rotor name" value={native.name} onChange={event => updateNative("name", event.target.value)} /></label>
          {!configurationOnly && <div className="live-actions"><button disabled={blocked || !!snapshot?.owner || !ownerApplied || !native.host.trim() || !Number.isInteger(native.port) || native.port < 1 || native.port > 65535 || !native.name.trim()}>Connect rotor</button>
            <button type="button" disabled={busy || snapshot?.owner !== "native_dcu1"} onClick={() => void run(() => request("rotor_disconnect", rotorCommandParams(latest.current)), "Rotor disconnect").catch(() => {})}>Disconnect rotor</button></div>}
        </form></section></div>
      {!configurationOnly && <section className="live-station-card"><h3>Observed antenna</h3><strong className="rotor-panel-bearing cyan">{typeof current.azimuth === "number" ? `${Math.round(current.azimuth).toString().padStart(3, "0")}°` : "—"}</strong><p>{current.name} · {current.status}</p>{current.target_label && <p>Target {current.target_label} · {current.target_bearing ?? "—"}°</p>}
        <form className="live-station-inline" onSubmit={event => { event.preventDefault(); if (bearing.trim() && Number.isFinite(Number(bearing)) && Number(bearing) >= 0 && Number(bearing) <= 360) void run(() => request("rotor_goto", rotorCommandParams(latest.current, { bearing: Number(bearing), label: "Manual bearing" })), "Rotor move").catch(() => {}); }}><label>Bearing °<input aria-label="Rotor bearing degrees" type="number" min="0" max="360" value={bearing} onChange={event => setBearing(event.target.value)} /></label><button disabled={busy || !current.connected || !bearing.trim()}>Turn rotor</button><button type="button" disabled={!snapshot?.owner} onClick={() => void run(() => request("rotor_stop", rotorCommandParams(latest.current)), "Rotor stop").catch(() => {})}>Stop rotor</button>{snapshot?.owner === "hamlib" && <button type="button" disabled={busy || !current.connected} onClick={() => void run(() => request("rotor_park", rotorCommandParams(latest.current)), "Rotor park").catch(() => {})}>Park rotor</button>}</form>
        <ManualRotorStatus session={rotorSession} onResolved={operation => {
          if (manualFeedback.current === operation) { manualFeedback.current = null; setError(""); setMessage(""); }
        }} />
        <p className="live-station-helper">Motion needs an explicit action. Stop requests motion release; disconnect closes the transport. No previous turn is replayed after reconnect.</p>
      </section>}</div>
    {configurationState.error && <p className="live-station-error" role="alert">{configurationState.error}</p>}
    {(configurationState.pending || configurationState.conflict || configurationState.workspaceChanged) && <div className="live-actions">
      {configurationState.pending && <button type="button" disabled={configurationState.saving} onClick={() => { manualFeedback.current = null; void configurationSession.reconcile().catch(cause => setError(cause.message)); }}>Check save</button>}
      {configurationState.pending && !configurationState.workspaceChanged && <button type="button" disabled={configurationState.saving} onClick={() => { manualFeedback.current = null; void configurationSession.retry().catch(cause => setError(cause.message)); }}>Retry same save</button>}
      {configurationState.snapshot && <button type="button" disabled={configurationState.saving} onClick={() => { manualFeedback.current = null; try { configurationSession.useSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Saved rotor configuration is unavailable."); } }}>Use saved values</button>}
    </div>}
    {error && <p className="live-station-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </section>;
}

import { useEffect, useRef, useState } from "react";
import { loadHamlibCatalogue, type HamlibModel } from "./hamlibCatalogue";
import { HamlibModelPicker } from "./HamlibModelPicker";
import { AgentConnectionSetup } from "./AgentConnectionSetup";
import { nativeStationSelection } from "./stationSelection";
import { ManualSimplexTune } from "./ManualSimplexTune";
type Data = Record<string, any>;
type Request = (method: string, params?: Data) => Promise<Data>;
export default function HamlibPanel({ request, snapshot }: { request: Request; snapshot: Data | null }) {
  const shared = nativeStationSelection();
  return <section className="live-station"><header className="live-station-head"><div><h2>Local station · Hamlib</h2><p>Radio and rotor connect directly from xLog. No xCat application or Windows agent is required.</p></div></header>
    {shared && <AgentConnectionSetup hamlib />}
    {shared && <ManualSimplexTune provider="hamlib" />}
    <div className="live-station-grid"><HamlibDevice device="radio" request={request} state={snapshot?.hamlib?.radio} hideSetup={shared} connectionControls={!shared} /></div></section>;
}
export function HamlibDevice({ device, request, state, configurationOnly = false, connectionOwned = false, connectionSelectionAllowed = true,
  configuration, onConfigurationChange, onBeforeConnection, connectionControls = true, configurationBusy = false, hideSetup = false }:
  { device: "radio" | "rotor"; request: Request; state?: Data | null; configurationOnly?: boolean; connectionOwned?: boolean;
    connectionSelectionAllowed?: boolean; configuration?: Data; onConfigurationChange?: (value: Data) => void;
    onBeforeConnection?: (value: Data) => Promise<void>; connectionControls?: boolean; configurationBusy?: boolean; hideSetup?: boolean }) {
  const key = `xlog.hamlib.${device}`;
  const [localConfig, setLocalConfig] = useState<Data>(() => { if (hideSetup) return { mode: "managed" }; try { return device === "radio" ? JSON.parse(localStorage.getItem(key) || "null") || { mode: "managed", path: "", baud: 9600, host: "127.0.0.1", port: 4532 } : { mode: "managed", path: "", baud: 9600, host: "127.0.0.1", port: 4533, serial: {} }; } catch { return { mode: "managed" }; } });
  const config = configuration ?? localConfig;
  const [models, setModels] = useState<HamlibModel[]>([]);
  const [catalogueLoading, setCatalogueLoading] = useState(true);
  const catalogueVersion = useRef(0);
  const [ports, setPorts] = useState<Data[]>([]), [capabilities, setCapabilities] = useState<Data | null>(null);
  const [health, setHealth] = useState<Data | null>(null);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [tx, setTX] = useState(false), [hz, setHz] = useState(""), [mode, setMode] = useState("USB");
  const [vfo, setVFO] = useState("VFOA"), [offset, setOffset] = useState("0"), [power, setPower] = useState("");
  const [antenna, setAntenna] = useState("1"), [cw, setCW] = useState(""), [azimuth, setAzimuth] = useState(""), [elevation, setElevation] = useState("0");
  const writeConfig = (value: Data) => configuration ? onConfigurationChange?.(value) : setLocalConfig(value);
  const update = (field: string, value: unknown) => writeConfig({ ...config, [field]: value });
  const serial = (field: string, value: unknown) => { const next = { ...config.serial }; if (value === "" || value === 0) delete next[field]; else next[field] = value; writeConfig({ ...config, serial: next }); };
  const connection = () => ({ ...config, model: Number(config.model), baud: Number(config.baud), port: Number(config.port), tx_enabled: tx });
  async function act(method: string, params: Data, label: string) {
    setBusy(true); setError(""); setMessage("");
    try { if (!connectionSelectionAllowed && ["hamlib_connect", "hamlib_reconnect", "hamlib_disconnect"].includes(method)) throw new Error("Apply this rotor selection before changing its connection.");
      const result = await request(method, { device, ...params });
      setMessage(`${label}: ${result?.readback?.state === "observed" ? "observed readback received" : result?.state === "accepted" ? "accepted; check observed state below" : "completed"}.`);
      return result;
    } catch (e) { setError(e instanceof Error ? e.message : "Hamlib operation failed"); }
    finally { setBusy(false); }
  }
  async function connect(method: "hamlib_connect" | "hamlib_reconnect", label: string) {
    try {
      await onBeforeConnection?.(config);
      if (!configuration && device === "radio") localStorage.setItem(key, JSON.stringify(config));
      await act(method, connection(), label);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The connection configuration could not be saved."); }
  }
  const control = (action: string, params: Data = {}) => act("hamlib_control", { action, ...params }, action);
  const loadModels = (retry = false) => {
    const version = ++catalogueVersion.current; setCatalogueLoading(true);
    return loadHamlibCatalogue(request, device, retry).then(result => { if (version === catalogueVersion.current) { setModels(result); setError(""); } })
      .catch(cause => { if (version === catalogueVersion.current) setError(cause instanceof Error ? cause.message : "Device catalogue unavailable."); })
      .finally(() => { if (version === catalogueVersion.current) setCatalogueLoading(false); });
  };
  useEffect(() => { if (hideSetup) return; setModels([]); void loadModels(); return () => { catalogueVersion.current++; }; }, [device, request, hideSetup]);
  useEffect(() => {
    if (!connectionControls) { setHealth(null); return; }
    let active = true, checking = false;
    const check = async () => {
      if (checking) return; checking = true;
      try { const value = await request("hamlib_status", { device }); if (active) setHealth(value); }
      catch { if (active) setHealth({ connected: false, state: "Health unavailable", reconnect_required: true }); }
      finally { checking = false; }
    };
    void check(); const timer = setInterval(() => void check(), 3000);
    return () => { active = false; clearInterval(timer); };
  }, [device, request, connectionControls]);
  const selectedModel = models.find(model => model.id === Number(config.model));
  const modelReady = config.mode === "external" || !!selectedModel;
  const connected = health ? health.connected === true : !!state;
  return <section className="live-station-card hamlib-device"><h3>{device === "radio" ? "Radio" : "Rotator"} <span className={connected ? "teal" : "secondary"}>{connected ? "Connected" : "Disconnected"}</span></h3>
    {!hideSetup && <form className="live-station-connect" onSubmit={e => { e.preventDefault(); void connect("hamlib_connect", "Connection"); }}>
      <label>Connection<select value={config.mode} onChange={e => update("mode", e.target.value)}><option value="managed">Built-in Hamlib · serial / device TCP</option><option value="external">Existing local Hamlib daemon</option></select></label>
      {config.mode === "managed" ? <><HamlibModelPicker key={device} device={device} models={models} loading={catalogueLoading} selected={Number(config.model)} onSelect={id => update("model", id)} />
        {!catalogueLoading && !models.length && <button type="button" onClick={() => void loadModels(true)}>Reload device catalogue</button>}
        {!catalogueLoading && !!config.model && !selectedModel && <p className="amber">Choose a model from the current bundled catalogue before connecting.</p>}
        <label>Serial device or device TCP address<input required={config.model !== 1} value={config.path || ""} onChange={e => update("path", e.target.value)} placeholder="/dev/cu.usbserial, COM3, or host:port" /></label>
        <div className="live-actions"><button type="button" disabled={busy} onClick={() => void act("hamlib_serial_ports", {}, "Device scan").then(result => result && setPorts(result.ports || []))}>Scan serial devices</button>{ports.length > 0 && <label>Detected device<select value="" onChange={e => update("path", e.target.value)}><option value="">Choose detected device…</option>{ports.map(p => <option key={p.path} value={p.path}>{p.label || p.path}</option>)}</select></label>}</div>
        <label>Serial baud<input type="number" min="300" max="921600" value={config.baud || 9600} onChange={e => update("baud", Number(e.target.value))} /></label>
        <details><summary>Serial framing and control lines</summary><div className="live-station-inline">{[
          ["data_bits", "Data bits", [7, 8]], ["stop_bits", "Stop bits", [1, 2]],
          ["parity", "Parity", ["None", "Even", "Odd"]], ["handshake", "Handshake", ["None", "XONXOFF", "Hardware"]],
          ["dtr_state", "DTR", ["Unset", "OFF", "ON"]], ["rts_state", "RTS", ["Unset", "OFF", "ON"]],
        ].map(([key, label, choices]) => <label key={String(key)}>{String(label)}<select value={config.serial?.[String(key)] ?? ""} onChange={e => serial(String(key), ["data_bits", "stop_bits"].includes(String(key)) ? Number(e.target.value) : e.target.value)}><option value="">Model default</option>{(choices as (string | number)[]).map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}</div></details></> : <><label>Local daemon host<input value={config.host || "127.0.0.1"} onChange={e => update("host", e.target.value)} /></label><label>Port<input type="number" min="1" max="65535" value={config.port || ""} onChange={e => update("port", Number(e.target.value))} /></label></>}
      {device === "radio" && <label><input type="checkbox" checked={tx} onChange={e => setTX(e.target.checked)} />Enable transmit commands for this connection</label>}
      {connectionControls && <div className="live-actions"><button disabled={busy || configurationBusy || connected || connectionOwned || !modelReady || !connectionSelectionAllowed}>Connect {device}</button><button type="button" disabled={busy || configurationBusy || !modelReady || !connectionSelectionAllowed} onClick={() => void connect("hamlib_reconnect", "Reconnect")}>Reconnect {device}</button><button type="button" disabled={busy || (!connected && !connectionOwned) || !connectionSelectionAllowed} onClick={() => void act("hamlib_disconnect", {}, "Disconnect")}>Disconnect</button><button type="button" disabled={busy || (!connected && !selectedModel)} onClick={() => void act("hamlib_capabilities", connected ? {} : { model: Number(config.model) }, "Capabilities").then(result => result && setCapabilities(result))}>Read capabilities</button></div>}
    </form>}
    {error && <p className="live-station-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {health?.reconnect_required && <p className="amber" role="status">The {device} connection needs attention. Check its cable, power and connection settings, then reconnect. No previous control command will be replayed.</p>}
    {capabilities && <details><summary>Reported Hamlib capabilities</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{typeof capabilities.text === "string" ? capabilities.text : JSON.stringify(capabilities, null, 2)}</pre></details>}
    {!configurationOnly && <>{device === "radio" ? <><div className="live-station-inline"><label>Frequency MHz<input inputMode="decimal" value={hz} onChange={e => setHz(e.target.value)} /></label><button disabled={busy || !connected || !hz || !Number.isFinite(Number(hz))} onClick={() => void control("frequency", { hz: Math.round(Number(hz) * 1e6) })}>Set frequency</button></div>
      <div className="live-station-inline"><label>Mode<select value={mode} onChange={e => setMode(e.target.value)}>{["USB", "LSB", "CW", "CWR", "AM", "FM", "RTTY", "RTTYR", "PKTUSB", "PKTLSB", "PKTFM"].map(m => <option key={m}>{m}</option>)}</select></label><button disabled={busy || !connected} onClick={() => void control("mode", { mode, passband_hz: 0 })}>Set mode</button></div>
      <div className="live-station-inline"><label>VFO<select value={vfo} onChange={e => setVFO(e.target.value)}>{["VFOA", "VFOB", "Main", "Sub"].map(v => <option key={v}>{v}</option>)}</select></label><button disabled={busy || !connected} onClick={() => void control("vfo", { vfo })}>Select VFO</button><button disabled={busy || !connected} onClick={() => void control("split", { enabled: true, tx_vfo: vfo })}>Split to selected VFO</button><button disabled={busy || !connected} onClick={() => void control("split", { enabled: false, tx_vfo: vfo })}>Split off</button></div>
      <div className="live-station-inline"><label>Offset Hz<input type="number" value={offset} onChange={e => setOffset(e.target.value)} /></label><button disabled={busy || !connected} onClick={() => void control("rit", { hz: Number(offset) })}>Set RIT</button><button disabled={busy || !connected} onClick={() => void control("xit", { hz: Number(offset) })}>Set XIT</button></div>
      <div className="live-station-inline"><label>Drive %<input type="number" min="0" max="100" value={power} onChange={e => setPower(e.target.value)} /></label><button disabled={busy || !connected || !power} onClick={() => void control("rf_power", { value: Number(power) / 100 })}>Set drive</button><label>Antenna<input type="number" min="1" max="32" value={antenna} onChange={e => setAntenna(e.target.value)} /></label><button disabled={busy || !connected} onClick={() => void control("antenna", { number: Number(antenna) })}>Select antenna</button></div>
      <div className="live-actions"><button disabled={busy || !connected || !state?.tx_enabled} onClick={() => void control("ptt", { on: true })}>PTT on</button><button disabled={!connected} onClick={() => void control("ptt", { on: false })}>PTT off</button><button disabled={busy || !connected || !state?.tx_enabled} onClick={() => void control("tuner", { on: true })}>Tuner on</button><button disabled={!connected} onClick={() => void control("tuner", { on: false })}>Tuner off</button></div>
      <div className="live-station-inline"><label>CW text<input maxLength={160} value={cw} onChange={e => setCW(e.target.value)} /></label><button disabled={busy || !connected || !state?.tx_enabled || !cw} onClick={() => void control("cw", { text: cw })}>Send CW</button><button disabled={!connected} onClick={() => void control("cw_stop")}>Stop CW</button></div></> : <><div className="live-station-inline"><label>Azimuth °<input type="number" min="0" max="360" value={azimuth} onChange={e => setAzimuth(e.target.value)} /></label><label>Elevation °<input type="number" min="0" max="180" value={elevation} onChange={e => setElevation(e.target.value)} /></label><button disabled={busy || !connected || !azimuth} onClick={() => void control("goto", { azimuth: Number(azimuth), elevation: Number(elevation) })}>Turn</button><button disabled={!connected} onClick={() => void control("stop")}>Stop rotor</button><button disabled={busy || !connected} onClick={() => void control("park")}>Park</button></div></>}
    </>}
    <h3>Observed hardware state</h3><dl className="hamlib-readback">{Object.entries(state?.fields || {}).flatMap(([group, values]) => Object.entries(values as Data).map(([label, value]) => <div key={`${group}.${label}`}><dt>{label}</dt><dd>{String(value)}</dd></div>))}</dl>
    {Object.keys(state?.errors || {}).length > 0 && <details><summary>Unsupported / unavailable hardware readings</summary>{Object.entries(state?.errors || {}).map(([name, detail]) => <p key={name}>{name}: Hamlib {(detail as Data).code}</p>)}</details>}
  </section>;
}

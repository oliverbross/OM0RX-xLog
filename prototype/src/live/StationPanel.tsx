import { useEffect, useRef, useState, type FormEvent } from "react";
import { Activity, AlertTriangle, Antenna, LockKeyhole, Radio, RefreshCw, RotateCcw, ShieldAlert } from "lucide-react";
import "./StationPanel.css";
import AgentConfiguration from "./AgentConfiguration";
import { AgentConnectionSetup } from "./AgentConnectionSetup";
import { nativeStationSelection } from "./stationSelection";
import { ManualTuneStatus } from "./ManualSimplexTune";
import { manualTuneSession } from "./manualTune";
import { radioReleaseSession } from "./radioRelease";
import { RadioReleaseStatus } from "./RadioReleaseStatus";
import { carrierTuneSession } from "./carrierTune";
import { CarrierTuneStatus } from "./CarrierTuneStatus";
import { amplifierTransitionSession } from "./amplifierTransition";
import { AmplifierTransitionStatus } from "./AmplifierTransitionStatus";
import {pttSession} from "./pttSession";
import {PTTStatus} from "./PTTStatus";
import { useSettingsSaveToast } from "./SettingsSaveToast";

type Request = (method: string, params?: Record<string, unknown>) => Promise<any>;
type RadioState = {
  observed?: boolean; connected?: boolean; frequency_hz?: number; mode?: string;
  receive_frequency_hz?: number; transmit_frequency_hz?: number;
  receive_vfo?: string; transmit_vfo?: string; split?: boolean; transmitting?: boolean;
  observed_at?: number; received_at?: number;
  vfos?: { letter: string; frequency_hz: number; mode: string; receive: boolean; transmit: boolean;
    rit_enabled: boolean; rit_offset_hz: number; xit_enabled: boolean; xit_offset_hz: number }[];
};
type StationState = {
  commissioned?: boolean; radio_known?: boolean; radio_stale?: boolean;
  coordinator_state?: string; allowed_actions?: string[]; supported_commands?: string[];
  inhibitors?: string[]; alarm_messages?: string[]; alarm_summary?: string;
  band?: string; route_alignment?: string; interlock_state?: string;
  kpa_operate?: boolean; tx_power_watts?: number; swr?: number; swr_is_live?: boolean;
  rf_drive_watts?: number; kpa_detail_primary?: string; kpa_detail_secondary?: string;
  kat_detail_primary?: string; kat_detail_secondary?: string; route_detail?: string;
};
type RotorState = { connected?: boolean; name?: string; azimuth?: number; target_bearing?: number;
  target_label?: string; status?: string; moving?: boolean; motion_direction?: string };
type StationSnapshot = {
  source?: "xcat_loopback" | "direct_agent"; available?: boolean; transport_state?: string;
  generated_at?: number; allow_transmit?: boolean; radio?: RadioState | null;
  station?: StationState | null; rotor?: RotorState | null;
  cat_servers?: { cat_port?: number | null; rigctl_port?: number | null; allow_transmit?: boolean };
  propagation?: { status?: string; updated_at?: number; solar_flux?: number; a_index?: number; k_index?: number } | null;
};
type Props = { snapshot: any; onRequest: Request; onSnapshot: (value: any) => void; monitor?: boolean; independentRotor?: boolean };
const modes = ["CW", "SSB", "USB", "LSB", "AM", "FM", "FT8", "FT4", "FT2", "RTTY", "JTTY", "PSK", "DIGI"];
const rotorBands = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "4m", "2m", "70cm", "Other"];

function unwrap(raw: any): any { return raw && typeof raw === "object" && "result" in raw ? raw.result : raw; }
function frequency(hz?: number | null): string { return typeof hz === "number" && Number.isFinite(hz) ? (hz / 1_000_000).toFixed(6) : "—"; }
function value<T>(item: T | null | undefined, unit = ""): string { return item == null || item === "" ? "—" : `${item}${unit}`; }
function timestamp(epoch?: number | null): string { return typeof epoch === "number" && Number.isFinite(epoch) ? new Date(epoch * 1000).toLocaleTimeString() : "—"; }
function errorText(cause: unknown): string { return cause instanceof Error ? cause.message : "Station request failed."; }

export default function StationPanel({ snapshot, onRequest, onSnapshot, monitor = false, independentRotor = true }: Props) {
  const incoming = snapshot as StationSnapshot | null;
  const [provider] = useState<"xcat_loopback" | "direct_agent">(
    "direct_agent",
  );
  const [live, setLive] = useState<StationSnapshot | null>(incoming);
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("14532");
  const [agentURL, setAgentURL] = useState(() => localStorage.getItem("xlog.remote.url") || "");
  const [token, setToken] = useState("");
  const [allowTransmit, setAllowTransmit] = useState(true);
  const [tuneMHz, setTuneMHz] = useState("");
  const [tuneMode, setTuneMode] = useState("SSB");
  const [rotorBearing, setRotorBearing] = useState("");
  const [rotorBand, setRotorBand] = useState("20m");
  const [rotorHost, setRotorHost] = useState("");
  const [rotorPort, setRotorPort] = useState("4001");
  const [rotorName, setRotorName] = useState("Rotor");
  const [vfoMHz, setVFOMHz] = useState("");
  const [vfoLetter, setVFOLetter] = useState("B");
  const [directMode, setDirectMode] = useState("CW");
  const [power, setPower] = useState("");
  const [cwText, setCWText] = useState("");
  const [cwSpeed, setCWSpeed] = useState("");
  const [ritOffset, setRITOffset] = useState("0");
  const [xitOffset, setXITOffset] = useState("0");
  const [agentConfig, setAgentConfig] = useState<Record<string, any> | null>(null);
  const [catPort, setCATPort] = useState("15002");
  const [rigctlPort, setRigctlPort] = useState("14532");
  const [catTransmit, setCATTransmit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const saveToast = useSettingsSaveToast();
  const [error, setError] = useState("");
  const requestRef = useRef(onRequest);
  const publishRef = useRef(onSnapshot);
  const endpointKey = `${provider}:${host}:${port}`;
  const endpointRef = useRef(endpointKey);
  endpointRef.current = endpointKey;
  useEffect(() => { requestRef.current = onRequest; publishRef.current = onSnapshot; }, [onRequest, onSnapshot]);
  useEffect(() => { if (incoming?.source === provider) setLive(incoming); }, [incoming, provider]);

  const endpoint = provider === "direct_agent"
    ? { provider } : { provider, host: host.trim(), port: Number(port) };
  const refresh = async (quiet = false) => {
    const startedEndpoint = endpointRef.current;
    try {
      const next = unwrap(await requestRef.current("station_snapshot", endpoint)) as StationSnapshot;
      if (startedEndpoint !== endpointRef.current) return;
      setLive(next);
      publishRef.current(next);
      if (!quiet) { setError(""); setNotice("Observed station state refreshed."); }
    } catch (cause) {
      if (startedEndpoint !== endpointRef.current) return;
      if (!quiet) setError(errorText(cause));
      setLive(null);
    }
  };
  // Read-only polling never connects, tunes, keys PTT, sends CW or moves a rotor.
  useEffect(() => {
    let active = true;
    let reading = false;
    const read = () => {
      if (reading) return;
      reading = true;
      const params = provider === "direct_agent" ? { provider } : { provider, host: host.trim(), port: Number(port) };
      requestRef.current("station_snapshot", params).then((raw) => {
        if (active) { const next = unwrap(raw) as StationSnapshot; setLive(next); publishRef.current(next); }
      }).catch(() => { if (active) setLive(null); }).finally(() => { reading = false; });
    };
    read();
    const timer = window.setInterval(read, 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [provider, host, port]);

  async function command(method: string, params: Record<string, unknown>, label: string) {
    if (monitor) return;
    const startedEndpoint = endpointRef.current;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = unwrap(method === "station_tune" && nativeStationSelection()
        ? await manualTuneSession().tune("direct_agent", params.frequency_hz as number, params.mode as string)
        : await onRequest(method, params));
      if (method === "station_connect") localStorage.setItem("xlog.remote.url", String(params.base_url));
      if (startedEndpoint !== endpointRef.current) return null;
      const next = (response?.state ?? (response?.source ? response : null)) as StationSnapshot | null;
      if (next) { setLive(next); onSnapshot(next); }
      setNotice(`${label} ${response?.confirmed === true ? "confirmed by observed radio state." : response?.accepted === true ? "accepted; awaiting observed state." : "completed."}`);
      return response;
    } catch (cause) {
      if (startedEndpoint !== endpointRef.current) return null;
      setError(errorText(cause));
      return null;
    } finally { setBusy(false); }
  }

  async function connect(event: FormEvent) {
    event.preventDefault();
    setAgentConfig(null);
    const response = await command("station_connect", {
      provider: "direct_agent", base_url: agentURL.trim(),
      ...(token ? { token } : {}), allow_transmit: allowTransmit,
      allow_keychain_interaction: true,
    }, "Connection request");
    if (response) setToken("");
  }
  async function tune(event: FormEvent) {
    event.preventDefault();
    const mhz = Number(tuneMHz);
    const hz = Math.round(mhz * 1_000_000);
    if (!Number.isFinite(mhz) || !Number.isSafeInteger(hz) || hz < 100_000 || hz > 1_000_000_000) {
      setError("Enter a radio frequency from 0.100000 to 1000.000000 MHz."); return;
    }
    await command("station_tune", { ...endpoint, frequency_hz: hz, mode: tuneMode }, "Simplex tune");
  }
  async function rotorGoto(event: FormEvent) {
    event.preventDefault();
    const bearing = Number(rotorBearing);
    if (!Number.isFinite(bearing) || bearing < 0 || bearing > 360) { setError("Enter a rotor bearing from 0° to 360°."); return; }
    if (isDirect) await command("station_rotor_goto", { provider: "direct_agent", bearing }, "Rotor move");
    else await command("station_action", { ...endpoint, action: "rotor_goto", bearing, band: rotorBand }, "Rotor move");
  }
  async function setVFO(event: FormEvent) {
    event.preventDefault();
    const mhz = Number(vfoMHz);
    const hz = Math.round(mhz * 1_000_000);
    if (!Number.isFinite(mhz) || !Number.isSafeInteger(hz) || hz < 100_000 || hz > 1_000_000_000) {
      setError("Enter a VFO frequency from 0.100000 to 1000.000000 MHz."); return;
    }
    await radioControl(vfoLetter === "A" ? "set_frequency_a" : "set_frequency_b", { frequency_hz: hz }, `VFO ${vfoLetter} frequency change`);
  }
  async function radioControl(control: string, params: Record<string, unknown>, label: string) {
    if(control==="ptt"&&nativeStationSelection()){await pttSession().set(params.enabled===true,"direct_agent").catch(()=>{});return;}
    await command("station_radio_control", { provider: "direct_agent", control, ...params }, label);
  }
  async function loadConfiguration() {
    const startedEndpoint = endpointRef.current;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = unwrap(await onRequest("station_configuration", { provider: "direct_agent" }));
      if (startedEndpoint !== endpointRef.current) return;
      setAgentConfig(response.configuration);
      setNotice("Agent configuration loaded. It has not been changed.");
    } catch (cause) { if (startedEndpoint === endpointRef.current) setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  async function saveConfiguration(configuration: Record<string, any>) {
    await onRequest("station_configuration_save", { provider: "direct_agent", configuration });
    const response = unwrap(await onRequest("station_configuration", { provider: "direct_agent" }));
    setAgentConfig(response.configuration);
    saveToast.show("Station configuration saved and reloaded");
  }

  const radio = live?.radio;
  const station = live?.station;
  const rotor = live?.rotor;
  const connected = live?.available === true && radio?.connected === true && radio.observed === true
    && station?.radio_stale !== true && station?.radio_known !== false;
  const actions = station?.allowed_actions ?? [];
  const supported = station?.supported_commands ?? [];
  const can = (commandName: string) => provider === "direct_agent" && connected && supported.includes(commandName);
  const canSafetyRelease = (commandName: string) => provider === "direct_agent" && supported.includes(commandName);
  const canTransmit = provider === "direct_agent" && connected && live?.allow_transmit === true
    && station?.commissioned === true && station?.radio_known === true && station?.radio_stale === false
    && (station?.inhibitors?.length ?? 0) === 0;
  const isDirect = provider === "direct_agent";
  const isMonitor = monitor;

  return <section className="live-station" aria-label={isMonitor ? "Station monitor" : "Station control"}>
    <header className="live-station-head">
      <div><h2><Radio size={17} /> {isMonitor ? "Station monitor" : "Station control"}</h2>
        <p>{isDirect ? "Integrated Remote Station Agent" : "xCat companion · loopback CAT"} · {live?.transport_state ?? (connected ? "connected" : "disconnected")}</p></div>
      <div className="live-station-head-actions"><span className={`live-station-status ${connected ? "is-online" : "is-offline"}`}><i />{connected ? "Observed live" : "No observed radio"}</span>
        <button type="button" onClick={() => void refresh()}><RefreshCw size={13} /> Refresh</button></div>
    </header>
    <p className="live-station-helper">xCat is embedded in xLog. Connect to your remote station here; the standalone xCat application is not required.</p>
    {error && <p className="live-station-error" role="alert"><AlertTriangle size={14} />{error}</p>}
    {notice && <p className="live-station-notice" role="status">{notice}</p>}{saveToast.toast}
    <div className="live-station-grid">
      <div className="live-station-main">
        <div className="live-station-readback">
          <div><span className="eyebrow">Observed receive</span><strong>{frequency(radio?.receive_frequency_hz ?? radio?.frequency_hz)}<small> MHz</small></strong>
            <span>{radio?.mode ?? "Mode unavailable"} · RX {value(radio?.receive_vfo)} · TX {value(radio?.transmit_vfo)}</span></div>
          <div className="live-station-rx-details"><span><b>TX</b> {frequency(radio?.transmit_frequency_hz)} MHz</span><span><b>Split</b> {radio?.split == null ? "—" : radio.split ? "On" : "Off"}</span>
            <span className={radio?.transmitting ? "live-station-tx" : ""}><b>PTT</b> {radio?.transmitting == null ? "—" : radio.transmitting ? "TRANSMITTING" : "Receive"}</span>
            <span><b>Received</b> {timestamp(radio?.received_at)}</span></div>
        </div>
        {radio?.vfos?.length ? <div className="live-station-vfos" aria-label="Observed VFOs">{radio.vfos.map((vfo) => <div key={vfo.letter}><b>VFO {vfo.letter}</b><strong>{frequency(vfo.frequency_hz)} MHz</strong><span>{vfo.mode} · {vfo.receive ? "RX" : ""}{vfo.receive && vfo.transmit ? "/" : ""}{vfo.transmit ? "TX" : ""}</span>
          <small>RIT {vfo.rit_enabled ? `${vfo.rit_offset_hz} Hz` : "off"} · XIT {vfo.xit_enabled ? `${vfo.xit_offset_hz} Hz` : "off"}</small></div>)}</div> : null}
        <section className="live-station-card"><h3><Activity size={15} /> Station safety</h3>
          <div className="live-station-metrics"><span><b>Commissioned</b>{station?.commissioned == null ? "—" : station.commissioned ? "Yes" : "No"}</span>
            <span><b>Coordinator</b>{value(station?.coordinator_state)}</span><span><b>Interlock</b>{value(station?.interlock_state)}</span>
            <span><b>Route</b>{value(station?.route_alignment)}</span><span><b>Band</b>{value(station?.band)}</span>
            <span><b>Amplifier</b>{station?.kpa_operate == null ? "—" : station.kpa_operate ? "Operate" : "Standby"}</span>
            <span><b>Forward power</b>{station?.swr_is_live ? value(station.tx_power_watts, " W") : "—"}</span>
            <span><b>SWR</b>{station?.swr_is_live ? value(station.swr) : "—"}</span><span><b>RF drive</b>{value(station?.rf_drive_watts, " W")}</span></div>
          {(station?.inhibitors?.length ?? 0) > 0 && <div className="live-station-inhibitors"><ShieldAlert size={15} />{station?.inhibitors?.join(" · ")}</div>}
          {station?.alarm_summary && <p className="live-station-alarm">{station.alarm_summary}</p>}
          {[station?.kpa_detail_primary, station?.kpa_detail_secondary, station?.kat_detail_primary, station?.kat_detail_secondary, station?.route_detail].filter(Boolean).map((detail, index) => <p className="live-station-detail" key={index}>{detail}</p>)}
        </section>
        {!isMonitor && <section className="live-station-card"><h3>Radio &amp; station actions</h3>
          {nativeStationSelection() && <ManualTuneStatus />}
          <form className="live-station-inline" onSubmit={(event) => void tune(event)}><label>Frequency MHz<input aria-label="Tune frequency MHz" inputMode="decimal" value={tuneMHz} onChange={(event) => setTuneMHz(event.target.value)} placeholder={connected ? frequency(radio?.frequency_hz) : "14.074000"} /></label>
            <label>Mode<select aria-label="Tune mode" value={tuneMode} onChange={(event) => setTuneMode(event.target.value)}>{modes.map((mode) => <option key={mode}>{mode}</option>)}</select></label>
            <button type="submit" disabled={busy || !connected}>Tune simplex</button></form>
          <div className="live-station-actionrow">{(["standby", "operate", "tune"] as const).map((action) => <button key={action} type="button" disabled={action === "standby" && nativeStationSelection() ? false : busy || !actions.includes(action) || (isDirect && action === "tune" && !canTransmit)} onClick={() => {
            if(action === "tune" && nativeStationSelection()) void carrierTuneSession().tune("direct_agent").catch(()=>{});
            else if(nativeStationSelection()) void amplifierTransitionSession().transition(action as "operate"|"standby").catch(()=>{});
            else void command("station_action", { ...endpoint, action }, `Station ${action}`);
          }}>{action[0].toUpperCase() + action.slice(1)}</button>)}
            <button type="button" disabled={!nativeStationSelection() && (busy || !actions.includes("cancel"))} onClick={() => { if (nativeStationSelection()) void radioReleaseSession().cancel("direct_agent").catch(() => {});
              else void command("station_action", { ...endpoint, action: "cancel" }, "Station cancel"); }}>Cancel</button></div>
          {nativeStationSelection() && <RadioReleaseStatus />}
          {nativeStationSelection() && <CarrierTuneStatus />}
          {nativeStationSelection() && <AmplifierTransitionStatus />}
          {nativeStationSelection() && <PTTStatus />}
          <p className="live-station-helper">A station action being accepted is not a confirmed RF or accessory readback. Keep the observed interlocks in view.</p>
        </section>}
        {!isMonitor && isDirect && <section className="live-station-card"><h3>Direct radio controls</h3>
          <div className="live-station-actionrow"><button type="button" disabled={busy || !can("set_ptt") || !canTransmit || radio?.transmitting === true} onClick={() => void radioControl("ptt", { enabled: true }, "PTT key")}>PTT on</button>
            <button type="button" className="danger" disabled={!nativeStationSelection()&&(busy || !canSafetyRelease("set_ptt"))} onClick={() => void radioControl("ptt", { enabled: false }, "PTT release")}>PTT off</button>
            <button type="button" disabled={busy || !canSafetyRelease("clear_cw")} onClick={() => void radioControl("clear_cw", {}, "CW clear")}>Clear CW</button></div>
          <form className="live-station-inline" onSubmit={(event) => { event.preventDefault(); void radioControl("send_cw", { text: cwText }, "CW text"); }}><label>CW text<input aria-label="CW text" value={cwText} maxLength={128} onChange={(event) => setCWText(event.target.value)} placeholder="Text to transmit" /></label><button type="submit" disabled={busy || !can("send_cw") || !canTransmit || !cwText.trim()}>Send CW</button></form>
          <div className="live-station-controlgrid">
            <label>RF power, W<input aria-label="RF power watts" inputMode="numeric" value={power} onChange={(event) => setPower(event.target.value)} /></label><button type="button" disabled={busy || !can("set_rf_power") || !/^(?:[1-9]|[1-9][0-9]|100)$/.test(power)} onClick={() => void radioControl("set_rf_power", { watts: Number(power) }, "RF power change")}>Set power</button>
            <label>CW speed, WPM<input aria-label="CW speed WPM" inputMode="numeric" value={cwSpeed} onChange={(event) => setCWSpeed(event.target.value)} /></label><button type="button" disabled={busy || !can("set_cw_speed") || !Number.isInteger(Number(cwSpeed)) || Number(cwSpeed) < 5 || Number(cwSpeed) > 100} onClick={() => void radioControl("set_cw_speed", { words_per_minute: Number(cwSpeed) }, "CW speed change")}>Set speed</button>
            <label>RIT offset, Hz<input aria-label="RIT offset Hz" inputMode="numeric" value={ritOffset} onChange={(event) => setRITOffset(event.target.value)} /></label><div><button type="button" disabled={busy || !can("set_rit") || !Number.isInteger(Number(ritOffset)) || Math.abs(Number(ritOffset)) > 9999} onClick={() => void radioControl("set_rit", { enabled: true, offset_hz: Number(ritOffset), vfo: radio?.receive_vfo ?? "A" }, "RIT change")}>RIT on</button><button type="button" disabled={busy || !can("set_rit")} onClick={() => void radioControl("set_rit", { enabled: false, offset_hz: 0, vfo: radio?.receive_vfo ?? "A" }, "RIT off")}>Off</button></div>
            <label>XIT offset, Hz<input aria-label="XIT offset Hz" inputMode="numeric" value={xitOffset} onChange={(event) => setXITOffset(event.target.value)} /></label><div><button type="button" disabled={busy || !can("set_xit") || !Number.isInteger(Number(xitOffset)) || Math.abs(Number(xitOffset)) > 9999} onClick={() => void radioControl("set_xit", { enabled: true, offset_hz: Number(xitOffset), vfo: radio?.transmit_vfo ?? "A" }, "XIT change")}>XIT on</button><button type="button" disabled={busy || !can("set_xit")} onClick={() => void radioControl("set_xit", { enabled: false, offset_hz: 0, vfo: radio?.transmit_vfo ?? "A" }, "XIT off")}>Off</button></div>
          </div>
          <div className="live-station-actionrow"><button type="button" disabled={busy || !can("set_receive_vfo")} onClick={() => void radioControl("set_receive_vfo", { vfo: "A" }, "Receive VFO A")}>RX VFO A</button><button type="button" disabled={busy || !can("set_receive_vfo")} onClick={() => void radioControl("set_receive_vfo", { vfo: "B" }, "Receive VFO B")}>RX VFO B</button>
            <button type="button" disabled={busy || !can("set_split")} onClick={() => void radioControl("set_split", { enabled: !radio?.split }, `Split ${radio?.split ? "off" : "on"}`)}>Split {radio?.split ? "off" : "on"}</button></div>
          <form className="live-station-inline" onSubmit={(event) => void setVFO(event)}><label>VFO<select aria-label="Set frequency VFO" value={vfoLetter} onChange={(event) => setVFOLetter(event.target.value)}><option>A</option><option>B</option></select></label><label>Frequency MHz<input aria-label="Set VFO frequency MHz" inputMode="decimal" value={vfoMHz} onChange={(event) => setVFOMHz(event.target.value)} placeholder="14.074000" /></label><button type="submit" disabled={busy || !can("set_frequency_hz")}>Set VFO frequency</button></form>
          <div className="live-station-inline"><label>Radio mode<select aria-label="Direct radio mode" value={directMode} onChange={(event) => setDirectMode(event.target.value)}>{modes.map((mode) => <option key={mode}>{mode}</option>)}</select></label><button type="button" disabled={busy || !can("set_mode")} onClick={() => void radioControl("set_mode", { mode: directMode }, "Radio mode change")}>Set mode</button></div>
          <p className="live-station-helper">PTT and CW are available by default when the station is commissioned and its real inhibitors are clear. Opening or polling this view never sends a command.</p>
        </section>}
        {!independentRotor && <section className="live-station-card"><h3><Antenna size={15} /> Rotor</h3>
          {rotor ? <><p>{rotor.name || "Rotor"} · {rotor.connected ? value(rotor.status) : "Disconnected"} · azimuth {value(rotor.azimuth, "°")}{rotor.moving ? ` · moving ${rotor.motion_direction ?? ""}` : ""}</p>
            <p className="live-station-helper">Target {value(rotor.target_bearing, "°")} · {value(rotor.target_label)}</p>
            {!isMonitor && <form className="live-station-inline" onSubmit={(event) => void rotorGoto(event)}><label>Bearing °<input aria-label="Rotor bearing degrees" inputMode="decimal" value={rotorBearing} onChange={(event) => setRotorBearing(event.target.value)} placeholder="0–360" /></label>{!isDirect && <label>Band<select aria-label="Rotor band" value={rotorBand} onChange={(event) => setRotorBand(event.target.value)}>{rotorBands.map((band) => <option key={band}>{band}</option>)}</select></label>}
              <button type="submit" disabled={busy || (isDirect ? !rotor.connected : !actions.includes("rotor_goto"))}>Go to</button><button type="button" disabled={busy || (isDirect ? !rotor.connected : !actions.includes("rotor_stop"))} onClick={() => void (isDirect ? command("station_rotor_stop", { provider: "direct_agent" }, "Rotor stop") : command("station_action", { ...endpoint, action: "rotor_stop" }, "Rotor stop"))}>Stop</button></form>}</> : <p className="live-station-helper">No rotor state is supplied by this provider.</p>}
        </section>}
      </div>
      <aside className="live-station-side">
        <section className="live-station-card"><h3>{isDirect ? "Direct agent connection" : "Companion connection"}</h3>
          {isDirect ? <><p className="live-station-helper">Use the existing Remote Station Agent HTTPS endpoint. Its token is stored in the macOS Keychain, never in the logbook.</p>
            {!isMonitor && (nativeStationSelection() ? <AgentConnectionSetup connections legacyEndpoint={agentURL} /> : <form className="live-station-connect" onSubmit={(event) => void connect(event)}><label>Agent HTTPS URL<input aria-label="Agent HTTPS URL" type="url" required placeholder="https://station.example:8443" value={agentURL} onChange={(event) => setAgentURL(event.target.value)} /></label>
              <label>Agent token<input aria-label="Agent token" type="password" autoComplete="off" placeholder="Enter token or use saved Keychain token" value={token} onChange={(event) => setToken(event.target.value)} /></label>
              <label className="live-station-checkbox"><input type="checkbox" checked={allowTransmit} onChange={(event) => setAllowTransmit(event.target.checked)} /> Allow CAT transmit controls for this connection</label>
              <div className="live-station-actionrow"><button type="submit" disabled={busy || !agentURL.trim()}><LockKeyhole size={13} /> Connect</button>
                <button type="button" disabled={busy || !agentURL.trim()} onClick={() => void command("station_connect", { provider: "direct_agent", base_url: agentURL.trim(), allow_transmit: allowTransmit, allow_keychain_interaction: true }, "Reconnect request")}><RotateCcw size={13} /> Reconnect</button>
                <button type="button" disabled={busy} onClick={() => void command("station_disconnect", { provider: "direct_agent" }, "Disconnect")}>Disconnect radio</button></div>
              <button type="button" className="live-station-quiet" disabled={busy || !agentURL.trim()} onClick={() => void command("station_forget", { provider: "direct_agent", base_url: agentURL.trim() }, "Saved token removal")}>Forget saved token for this URL</button>
            </form>)}</> : <><p className="live-station-helper">Read from the standalone xCat loopback service. xCat remains radio owner; this view does not launch it.</p>
            {!isMonitor && <div className="live-station-connect"><label>Host<input aria-label="xCat loopback host" value={host} onChange={(event) => setHost(event.target.value)} /></label><label>Port<input aria-label="xCat loopback port" inputMode="numeric" value={port} onChange={(event) => setPort(event.target.value)} /></label></div>}</>}
        </section>
        <section className="live-station-card"><h3>Source and freshness</h3><dl><dt>Provider</dt><dd>{value(live?.source)}</dd><dt>Radio</dt><dd>{connected ? "Observed" : "Unavailable"}</dd>
          <dt>Station snapshot</dt><dd>{timestamp(live?.generated_at)}</dd><dt>Radio observed</dt><dd>{timestamp(radio?.observed_at)}</dd><dt>RF ownership</dt><dd>{isDirect ? "This app, on explicit connect" : "Standalone xCat"}</dd></dl>
          {!connected && <p className="live-station-helper">No frequency or accessory value is fabricated while the station is unavailable.</p>}</section>
        {isDirect && !isMonitor && <section className="live-station-card"><h3>Built-in CAT servers</h3><p className="live-station-helper">Optional connections for RUMlogNG and other local clients. They use this embedded radio session, not a separate xCat app. Listeners bind only to 127.0.0.1.</p>
          <p>CAT: {live?.cat_servers?.cat_port || "Off"} · RigCtlD: {live?.cat_servers?.rigctl_port || "Off"}</p>
          <div className="live-station-connect"><label>TS-480 CAT port (blank disables)<input type="number" min="1" max="65535" value={catPort} onChange={e => setCATPort(e.target.value)} /></label><label>RigCtlD port (blank disables)<input type="number" min="1" max="65535" value={rigctlPort} onChange={e => setRigctlPort(e.target.value)} /></label><label><input type="checkbox" checked={catTransmit} onChange={e => setCATTransmit(e.target.checked)} />Allow client transmit / CW commands</label>
          <div className="live-actions"><button disabled={busy || !connected} onClick={() => void command("station_cat_servers", { provider: "direct_agent", cat_port: catPort ? Number(catPort) : null, rigctl_port: rigctlPort ? Number(rigctlPort) : null, allow_transmit: catTransmit }, "CAT listeners")}>Apply CAT listeners</button><button disabled={busy} onClick={() => void command("station_cat_servers", { provider: "direct_agent", cat_port: null, rigctl_port: null, allow_transmit: false }, "Stop CAT listeners")}>Stop listeners</button></div></div>
        </section>}
        {isDirect && !isMonitor && <section className="live-station-card"><h3>Agent configuration</h3><p className="live-station-helper">Load the active station profile, edit its hardware and band policy, then review the changes before saving.</p>
          <button type="button" disabled={busy || !connected} onClick={() => void loadConfiguration()}>Load configuration</button>
          {agentConfig && <AgentConfiguration config={agentConfig} onSave={saveConfiguration} busy={busy || !connected} />}
        </section>}
        {isDirect && !isMonitor && !independentRotor && <section className="live-station-card"><h3>DCU-1 rotor connection</h3><p className="live-station-helper">Optional local rotor owner. Explicit connection starts read-only azimuth polling; motion needs a separate action.</p>
          <div className="live-station-connect"><label>Rotor TCP host<input aria-label="Rotor TCP host" value={rotorHost} onChange={(event) => setRotorHost(event.target.value)} placeholder="Rotor host or IP" /></label><label>Rotor TCP port<input aria-label="Rotor TCP port" inputMode="numeric" value={rotorPort} onChange={(event) => setRotorPort(event.target.value)} /></label><label>Name<input aria-label="Rotor name" value={rotorName} onChange={(event) => setRotorName(event.target.value)} /></label>
            <div className="live-station-actionrow"><button type="button" disabled={busy || !rotorHost.trim() || !Number.isInteger(Number(rotorPort)) || Number(rotorPort) < 1 || Number(rotorPort) > 65535} onClick={() => void command("station_rotor_connect", { provider: "direct_agent", host: rotorHost.trim(), port: Number(rotorPort), name: rotorName.trim() }, "Rotor connection request")}>Connect rotor</button><button type="button" disabled={busy || !rotor?.connected} onClick={() => void command("station_rotor_disconnect", { provider: "direct_agent" }, "Rotor disconnect")}>Disconnect rotor</button></div></div>
        </section>}
        {live?.propagation && <section className="live-station-card"><h3>Propagation</h3><dl><dt>Status</dt><dd>{value(live.propagation.status)}</dd><dt>Solar flux</dt><dd>{value(live.propagation.solar_flux)}</dd><dt>A / K</dt><dd>{value(live.propagation.a_index)} / {value(live.propagation.k_index)}</dd></dl></section>}
      </aside>
    </div>
  </section>;
}

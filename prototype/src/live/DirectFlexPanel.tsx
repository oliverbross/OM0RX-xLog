import { useEffect, useRef, useState, type FormEvent } from "react";
import { Activity, Radio, RefreshCw } from "lucide-react";
import { AgentConnectionSetup } from "./AgentConnectionSetup";
import { nativeStationSelection } from "./stationSelection";
import "./StationPanel.css";
import "./DirectFlexPanel.css";

type Data = Record<string, any>;
type Request = (method: string, params?: Data) => Promise<Data>;
type Props = { request: Request; snapshot: Data | null };
const provider = "direct_flex_lan";
const modes = ["USB", "LSB", "CW", "CWR", "AM", "FM", "RTTY", "RTTYR", "DIGU", "DIGL", "FT8", "FT4"];
const formatMHz = (hz: unknown) => typeof hz === "number" && Number.isFinite(hz) ? (hz / 1_000_000).toFixed(6) : "—";
const strictHz = (mhz: string): number | null => {
  const numeric = Number(mhz);
  const hz = Math.round(numeric * 1_000_000);
  return mhz.trim() && Number.isFinite(numeric) && Number.isSafeInteger(hz) && hz >= 100_000 && hz <= 1_000_000_000 ? hz : null;
};
export function validFlexEndpoint(host: string, port: string, stationName: string): boolean {
  const name = stationName.trim();
  if (!name || name.length > 64 || !/^[\x20-\x7E]+$/.test(name) || name.includes("|")) return false;
  const numericPort = Number(port);
  if (!/^\d+$/.test(port) || !Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65_535) return false;
  const octets = host.split(".");
  if (octets.length === 4 && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) {
    const [a, b] = octets.map(Number);
    return a === 10 || a === 127 || a === 172 && b >= 16 && b <= 31 ||
      a === 192 && b === 168 || a === 169 && b === 254 || a === 100 && b >= 64 && b <= 127;
  }
  const ipv6 = host.toLowerCase();
  return /^[0-9a-f:]+$/.test(ipv6) && ipv6.includes(":") &&
    (ipv6 === "::1" || /^(fc|fd|fe[89ab])/.test(ipv6));
}

export default function DirectFlexPanel({ request, snapshot }: Props) {
  const shared = nativeStationSelection();
  const [host, setHost] = useState(() => shared ? "" : localStorage.getItem("xlog.flex.host") || "");
  const [port, setPort] = useState(() => shared ? "4992" : localStorage.getItem("xlog.flex.port") || "4992");
  const [stationName, setStationName] = useState(() => shared ? "OM0RX-xLog" : localStorage.getItem("xlog.flex.name") || "OM0RX-xLog");
  const [allowTransmit, setAllowTransmit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [frequency, setFrequency] = useState("");
  const [mode, setMode] = useState("USB");
  const [vfo, setVFO] = useState<"A" | "B">("A");
  const [cwText, setCWText] = useState("");
  const [cwSpeed, setCWSpeed] = useState("25");
  const [rfPower, setRFPower] = useState("");
  const frequencyRevision = useRef(0);
  const modeRevision = useRef(0);
  const rfPowerRevision = useRef(0);
  const frequencyEdited = useRef(false);
  const modeEdited = useRef(false);
  const rfPowerEdited = useRef(false);
  const radio = snapshot?.source === provider ? snapshot.radio : null;
  const connected = radio?.observed === true && radio?.connected === true;
  const attached = snapshot?.source === provider && snapshot.transport_state !== "stopped";
  const commands: string[] = Array.isArray(snapshot?.capabilities?.supported_commands) ? snapshot.capabilities.supported_commands : [];
  const supports = (command: string) => connected && commands.includes(command);
  const txAllowed = connected && snapshot?.allow_transmit === true;
  useEffect(() => {
    if (connected && !frequencyEdited.current && typeof radio.frequency_hz === "number") setFrequency(formatMHz(radio.frequency_hz));
    if (connected && !modeEdited.current && typeof radio.mode === "string" && modes.includes(radio.mode)) setMode(radio.mode);
  }, [connected, radio?.frequency_hz, radio?.mode]);
  useEffect(() => {
    if (connected && !rfPowerEdited.current && Number.isInteger(radio?.rf_power_level)) {
      setRFPower(String(radio.rf_power_level));
    }
  }, [connected, radio?.rf_power_level]);
  useEffect(() => { if (!shared && attached) setAllowTransmit(snapshot.allow_transmit === true); }, [attached, snapshot?.allow_transmit, shared]);
  const useObservedValues = () => {
    if (!connected) return;
    frequencyEdited.current = false; modeEdited.current = false;
    if (typeof radio.frequency_hz === "number") setFrequency(formatMHz(radio.frequency_hz));
    if (typeof radio.mode === "string" && modes.includes(radio.mode)) setMode(radio.mode);
  };
  const useObservedRFPower = () => {
    if (!connected || !Number.isInteger(radio?.rf_power_level)) return;
    rfPowerEdited.current = false;
    setRFPower(String(radio.rf_power_level));
  };

  async function act(method: string, params: Data, label: string) {
    const startedFrequencyRevision = frequencyRevision.current;
    const startedModeRevision = modeRevision.current;
    const startedRFPowerRevision = rfPowerRevision.current;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await request(method, { provider, ...params });
      const confirmedRadio = result?.confirmed === true && result?.state?.radio?.observed === true ? result.state.radio : null;
      if (confirmedRadio && (method === "station_tune" || params.control === "set_frequency_a") &&
          frequencyRevision.current === startedFrequencyRevision && typeof confirmedRadio.frequency_hz === "number") {
        frequencyEdited.current = false; setFrequency(formatMHz(confirmedRadio.frequency_hz));
      }
      if (confirmedRadio && (method === "station_tune" || params.control === "set_mode") &&
          modeRevision.current === startedModeRevision && modes.includes(confirmedRadio.mode)) {
        modeEdited.current = false; setMode(confirmedRadio.mode);
      }
      if (confirmedRadio && params.control === "set_rf_power" &&
          rfPowerRevision.current === startedRFPowerRevision && Number.isInteger(confirmedRadio.rf_power_level)) {
        rfPowerEdited.current = false; setRFPower(String(confirmedRadio.rf_power_level));
      }
      setNotice(`${label}: ${result?.confirmed === true ? "confirmed by fresh radio observation" : result?.accepted === true ? "accepted; observation remains pending" : "request completed"}.`);
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Direct FLEX request failed; no success was confirmed.");
      return null;
    } finally { setBusy(false); }
  }

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (!validFlexEndpoint(host.trim(), port, stationName)) {
      setError("Enter a private numeric LAN address, a port from 1–65535, and a station name."); return;
    }
    const result = await act("station_connect", { host: host.trim(), port: Number(port),
      station_name: stationName.trim(), allow_transmit: allowTransmit }, "Connection");
    if (result) {
      localStorage.setItem("xlog.flex.host", host.trim());
      localStorage.setItem("xlog.flex.port", port);
      localStorage.setItem("xlog.flex.name", stationName.trim());
    }
  }

  const control = (name: string, params: Data = {}) => act("station_radio_control", { control: name, ...params }, name.replaceAll("_", " "));
  const hz = strictHz(frequency);
  const validCW = cwText.length > 0 && cwText.length <= 128 && /^[\x20-\x7E]+$/.test(cwText) && !cwText.includes("|");
  const speed = Number(cwSpeed);
  const validRFPower = /^(?:0|[1-9]\d?|100)$/.test(rfPower);
  const rfPowerSupported = supports("set_rf_power");
  return <section className="live-station direct-flex">
    <header className="live-station-head"><div><h2><Radio size={17} /> Direct FLEX · LAN</h2><p>Connect xLog directly to a FLEX radio on a private address. No standalone xCat or Remote Station Agent is used.</p></div>
      <span className={`live-station-status ${connected ? "is-online" : "is-offline"}`}><i />{connected ? "Observed" : snapshot?.transport_state || "Disconnected"}</span></header>
    <div className="live-station-grid"><div className="live-station-main">
      <section className="live-station-card"><h3>Connection</h3>
        {shared ? <><AgentConnectionSetup flex /><button type="button" disabled={busy} onClick={() => void act("station_snapshot", {}, "Read state")}><RefreshCw size={14} /> Read state</button></> : <form className="live-station-connect" onSubmit={event => void connect(event)}>
          <div className="flex-connect-fields"><label>Private radio IP address<input aria-label="Private radio IP address" required inputMode="url" value={host} onChange={event => setHost(event.target.value)} placeholder="192.168.1.50" autoComplete="off" /></label>
            <label>TCP port<input aria-label="TCP port" required type="number" min="1" max="65535" value={port} onChange={event => setPort(event.target.value)} /></label>
            <label>Station name<input aria-label="Station name" required maxLength={64} value={stationName} onChange={event => setStationName(event.target.value)} /></label></div>
          <label className="live-station-checkbox"><input type="checkbox" checked={allowTransmit} disabled={busy || attached} onChange={event => setAllowTransmit(event.target.checked)} />Enable transmit commands for this connection only</label>
          {attached && <p className="live-station-helper">Transmit permission is fixed for this connection. Disconnect before changing it.</p>}
          <p className="live-station-helper">Receive and observation work without transmit opt-in. A radio command is complete only when a fresh readback confirms it.</p>
          <div className="live-station-actionrow"><button className="primary" disabled={busy || attached || !validFlexEndpoint(host.trim(), port, stationName)}>Connect FLEX</button>
            <button type="button" disabled={busy || connected || !attached} onClick={() => void act("station_reconnect", {}, "Reconnect")}>Reconnect</button>
            <button type="button" disabled={busy || !attached} onClick={() => void act("station_disconnect", {}, "Disconnect")}>Disconnect</button>
            <button type="button" disabled={busy} onClick={() => void act("station_snapshot", {}, "Read state")}><RefreshCw size={14} /> Read state</button></div>
        </form>}
      </section>
      <section className="live-station-card"><h3><Activity size={15} /> Observed FLEX radio</h3>
        <div className="flex-readback"><strong>{formatMHz(radio?.frequency_hz)} <small>MHz</small></strong><span>{radio?.mode || "Mode unavailable"}</span><span className={radio?.transmitting === true ? "amber" : "secondary"}>{!connected ? "No live radio observation" : radio?.transmitting === true ? "TRANSMITTING" : radio?.transmitting === false ? "Receiving" : "PTT state unknown"}</span></div>
        <div className="live-station-vfos">{["A", "B"].map(letter => {
          const observed = radio?.vfos?.find((item: Data) => item.letter === letter);
          return <div key={letter}><b>VFO {letter}</b><strong>{formatMHz(observed?.frequency_hz)} MHz</strong><small>{observed?.mode || "—"}{observed?.receive ? " · RX" : ""}{observed?.transmit ? " · TX" : ""}</small></div>;
        })}</div>
        <p className="live-station-helper">Receive VFO {radio?.receive_vfo || "—"} · Transmit VFO {radio?.transmit_vfo || "—"} · {radio?.split ? "Split" : "Simplex"} · Transmit opt-in {snapshot?.allow_transmit ? "enabled" : "off"}</p>
        <p className="live-station-helper">Observed RF power level: <strong>{connected && Number.isInteger(radio?.rf_power_level) ? `${radio.rf_power_level} / 100` : "unavailable"}</strong>. This is a radio setting, not measured output in watts.</p>
        <button className="live-station-quiet" disabled={!connected} onClick={useObservedValues}>Use observed frequency and mode in controls</button>
      </section>
      <section className="live-station-card"><h3>Frequency and mode</h3>
        <div className="live-station-inline"><label>Frequency MHz<input aria-label="FLEX frequency MHz" inputMode="decimal" value={frequency} onChange={event => { frequencyEdited.current = true; frequencyRevision.current++; setFrequency(event.target.value); }} /></label><label>Mode<select aria-label="FLEX mode" value={mode} onChange={event => { modeEdited.current = true; modeRevision.current++; setMode(event.target.value); }}>{modes.map(value => <option key={value}>{value}</option>)}</select></label>
          <button disabled={busy || !supports("station_tune") || hz == null} onClick={() => hz != null && void act("station_tune", { frequency_hz: hz, mode }, "Simplex tune")}>Tune simplex</button></div>
        <div className="live-station-inline"><label>VFO<select aria-label="FLEX VFO" value={vfo} onChange={event => setVFO(event.target.value as "A" | "B")}><option>A</option><option>B</option></select></label>
          <button disabled={busy || hz == null || !supports(`set_frequency_${vfo.toLowerCase()}`)} onClick={() => hz != null && void control(`set_frequency_${vfo.toLowerCase()}`, { frequency_hz: hz })}>Set VFO frequency</button>
          <button disabled={busy || !supports("set_mode")} onClick={() => void control("set_mode", { mode })}>Set mode</button>
          <button disabled={busy || !supports("set_receive_vfo") || !radio?.vfos?.some((item: Data) => item.letter === vfo)} onClick={() => void control("set_receive_vfo", { vfo })}>Use VFO for RX</button></div>
        <div className="live-station-actionrow"><button disabled={busy || !supports("set_split")} onClick={() => void control("set_split", { enabled: true })}>Split on · TX B</button><button disabled={busy || !supports("set_split")} onClick={() => void control("set_split", { enabled: false })}>Simplex · TX A</button></div>
      </section>
    </div><div className="live-station-side">
      <section className="live-station-card"><h3>Transmit control</h3><p className="live-station-helper">Transmit is available only when enabled at connection. Release remains available for an owned transmit attempt.</p>
        <div className="live-station-actionrow"><button className="danger" disabled={busy || !txAllowed || !supports("ptt") || radio?.transmitting !== false} onClick={() => void control("ptt", { enabled: true })}>PTT on</button>
          <button disabled={busy || !supports("ptt")} onClick={() => void control("ptt", { enabled: false })}>PTT off</button>
          <button disabled={busy || !txAllowed || !supports("tune") || radio?.transmitting !== false} onClick={() => void act("station_action", { action: "tune" }, "Tune")}>Tune carrier</button>
          <button disabled={busy || !supports("cancel")} onClick={() => void act("station_action", { action: "cancel" }, "Cancel / release")}>Cancel / release</button></div>
      </section>
      <section className="live-station-card"><h3>RF power setting</h3>
        <p className="live-station-helper">FLEX level 0–100; this is not a measured watt reading. Changing the setting requires an observed receive state and fresh readback.</p>
        <div className="live-station-inline"><label>RF power setting (0–100)<input aria-label="RF power setting (0–100)" type="number" min="0" max="100" step="1" value={rfPower} onChange={event => { rfPowerEdited.current = true; rfPowerRevision.current++; setRFPower(event.target.value); }} /></label>
          <button type="button" disabled={busy || !rfPowerSupported || radio?.transmitting !== false || !validRFPower} onClick={() => void control("set_rf_power", { watts: Number(rfPower) })}>Set RF power</button></div>
        <button type="button" className="live-station-quiet" disabled={!connected || !Number.isInteger(radio?.rf_power_level)} onClick={useObservedRFPower}>Use observed RF power setting</button>
      </section>
      <section className="live-station-card"><h3>CW</h3><label>CW text<textarea aria-label="FLEX CW text" maxLength={128} value={cwText} onChange={event => setCWText(event.target.value)} /></label>
        <div className="live-station-actionrow"><button disabled={busy || !txAllowed || !supports("send_cw") || !validCW} onClick={() => void control("send_cw", { text: cwText })}>Send CW</button><button disabled={busy || !supports("clear_cw")} onClick={() => void control("clear_cw")}>Clear CW</button></div>
        <div className="live-station-inline"><label>CW speed WPM<input aria-label="FLEX CW speed" type="number" min="5" max="100" value={cwSpeed} onChange={event => setCWSpeed(event.target.value)} /></label><button disabled={busy || !supports("set_cw_speed") || !Number.isInteger(speed) || speed < 5 || speed > 100} onClick={() => void control("set_cw_speed", { words_per_minute: speed })}>Set speed</button></div>
      </section>
      <section className="live-station-card"><h3>Provider scope</h3><p>Direct FLEX reports radio state only. Amplifier, tuner, rotor, Remote Agent configuration, RIT/XIT, CAT server and SmartLink controls are unavailable here. {!rfPowerSupported && "RF power setting is unavailable until FLEX reports its current level."}</p></section>
    </div></div>
    {error && <p className="live-station-error" role="alert">{error}</p>}{notice && <p className="live-station-notice" role="status">{notice}</p>}
  </section>;
}

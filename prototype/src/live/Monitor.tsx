import { useEffect, useRef, useState, type ReactNode } from "react";
type Data = Record<string, any>;
const frequency = (hz: unknown) => typeof hz === "number" && Number.isFinite(hz) ? (hz / 1e6).toFixed(6) : "—";
const value = (input: unknown, suffix = "") => input == null ? "—" : `${input}${suffix}`;

export default function Monitor({ snapshot, map, onRequest, onRotorRequest, commandOperationId, resolvedCommandOperation }: { snapshot: Data | null; map: ReactNode; onRequest?: (method: string, params?: Data) => Promise<any>; onRotorRequest?: (method: string, params?: Data) => Promise<any>; commandOperationId?: () => string | null; resolvedCommandOperation?: string | null }) {
  const radio = snapshot?.radio, station = snapshot?.station, rotor = snapshot?.rotor;
  const [angle, setAngle] = useState(0);
  const previous = useRef<number | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [bearing, setBearing] = useState("");
  const operation = useRef(0), mounted = useRef(true);
  const messageOperation = useRef<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current++; }; }, []);
  useEffect(() => {
    if (resolvedCommandOperation && messageOperation.current === resolvedCommandOperation) {
      messageOperation.current = null; setMessage("");
    }
  }, [resolvedCommandOperation]);
  const local = snapshot?.source === "hamlib";
  const flex = snapshot?.source === "direct_flex_lan";
  const showRotor = !flex || !!rotor?.owner;
  const action = station?.kpa_operate ? "standby" : "operate";
  const command = async (method: string, params: Data) => {
    const request = method.startsWith("rotor_") ? onRotorRequest : onRequest;
    if (!request) return;
    const current = ++operation.current;
    messageOperation.current = null; setBusy(true); setMessage("");
    try { const result = await request(method, params); if (mounted.current && operation.current === current) setMessage(result.confirmed ? "Observed confirmation received" : "Request accepted · watch observed state"); }
    catch (e) { if (mounted.current && operation.current === current) {
      messageOperation.current = method === "rotor_goto" ? commandOperationId?.() ?? null : null;
      setMessage(e instanceof Error ? e.message : "Command failed");
    } }
    finally { if (mounted.current && operation.current === current) setBusy(false); }
  };
  useEffect(() => {
    if (typeof rotor?.azimuth !== "number") return;
    const next = rotor.azimuth;
    if (previous.current == null) setAngle(next);
    else { const delta = ((next - previous.current + 540) % 360) - 180; setAngle(current => current + delta); }
    previous.current = next;
  }, [rotor?.azimuth]);
  const vfo = (letter: string) => radio?.vfos?.find((v: Data) => v.letter === letter)?.frequency_hz ??
    (radio?.receive_vfo === letter ? radio.receive_frequency_hz : radio?.transmit_vfo === letter ? radio.transmit_frequency_hz : null);
  const fresh = radio?.connected && radio?.observed && station?.radio_stale !== true;
  const supported: string[] = Array.isArray(snapshot?.capabilities?.supported_commands) ? snapshot.capabilities.supported_commands : [];
  return <div className={`integrated-monitor${flex && !showRotor ? " flex-radio-only" : ""}`}>
    <section className="monitor-radio">
      <header><span className="secondary">STATION · {flex ? "DIRECT FLEX LAN" : local ? "LOCAL HAMLIB" : snapshot?.source === "direct_agent" ? "EMBEDDED xCAT" : "NO RADIO SELECTED"}</span><b className={fresh && typeof radio?.transmitting === "boolean" ? "teal" : "amber"}>{!fresh ? "OFFLINE" : radio?.transmitting === true ? "TX" : radio?.transmitting === false ? "RX" : "PTT UNKNOWN"}</b></header>
      <div className="monitor-vfos"><strong>A: {frequency(vfo("A"))}</strong><strong>B: {frequency(vfo("B"))}</strong><span>{radio?.mode || "Mode unavailable"}{!flex && ` · ${station?.band || "—"} · ${station?.interlock_state || "No live observation"}`}</span></div>
      {flex ? <p className="monitor-flex-state">{radio?.connected ? `Receive VFO ${radio.receive_vfo || "—"} · Transmit VFO ${radio.transmit_vfo || "—"} · ${radio.split ? "Split" : "Simplex"}` : "Connect direct FLEX from the main station controls."}</p> : <>
      <div className="monitor-meters"><div className="output"><small>TX POWER</small><strong>{value(station?.tx_power_watts, " W")}</strong></div><div className="swr"><small>SWR</small><strong>{value(station?.swr)}</strong><small>{station?.swr_is_live ? "LIVE" : "LAST"}</small></div><div className="drive"><small>RF DRIVE</small><strong>{value(station?.rf_drive_watts, " W")}</strong></div></div>
      {!local && <><section className="monitor-kpa"><strong>KPA500 · {station?.kpa_operate == null ? "Unavailable" : station.kpa_operate ? "OPERATE" : "STBY"}</strong><p>{station?.kpa_detail_primary || "Waiting for amplifier status"}</p><p>{station?.kpa_detail_secondary}</p></section>
      <section className="monitor-kat"><strong>KAT500</strong><p>{station?.kat_detail_primary || "Waiting for tuner status"}</p><p>{station?.kat_detail_secondary}</p></section>
      <section className="monitor-route"><p>{station?.route_detail || "Route unavailable"}</p><b>{station?.route_alignment || "UNKNOWN"}</b></section></>}
      {!local && onRequest && <div className="monitor-actions"><button disabled={busy || !fresh || !station?.allowed_actions?.includes(action)} onClick={() => void command("station_action", { action })}>{station?.kpa_operate ? "Standby" : "Operate"}</button><button disabled={busy || !fresh || !snapshot?.allow_transmit || !station?.allowed_actions?.includes("tune")} onClick={() => void command("station_action", { action: "tune" })}>Tune</button><button onClick={() => void command("station_action", { action: "cancel" })}>Cancel</button></div>}
      </>}
      {flex && onRequest && <div className="monitor-actions"><button disabled={busy || !fresh || !snapshot?.allow_transmit || !supported.includes("tune")} onClick={() => void command("station_action", { action: "tune" })}>Tune</button><button onClick={() => void command("station_action", { action: "cancel" })}>Cancel tune / release TX</button></div>}
      {flex && !showRotor && <div className="monitor-live-map flex-map">{map}</div>}
      <footer>{flex ? showRotor ? "FLEX radio observation · independent rotor connection" : "FLEX radio observation only · no amplifier, tuner or rotor telemetry" : station?.alarm_summary || "No live alarm observation"}<br />{snapshot?.generated_at ? `Received ${new Date(snapshot.generated_at * 1000).toLocaleTimeString()}` : "Waiting for station"}<p role="status">{message}</p></footer>
    </section>
    {showRotor && <section className="monitor-rotor"><header><strong>{rotor?.name || "ROTOR"}</strong><span>{rotor?.connected ? rotor.status : "Disconnected"}</span></header><div className={`monitor-compass ${rotor?.connected && onRotorRequest ? "can-turn" : ""}`} title="Click a heading to turn; or enter a bearing below" onClick={event => {
      if (!rotor?.connected || !onRotorRequest || busy) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2, y = event.clientY - rect.top - rect.height / 2;
      if (Math.hypot(x, y) < 10 || Math.hypot(x, y) > rect.width / 2) return;
      const target = Math.round((Math.atan2(x, -y) * 180 / Math.PI + 360) % 360);
      setBearing(String(target)); void command("rotor_goto", { bearing: target });
    }}><span className="north">N</span><span className="east">E</span><span className="south">S</span><span className="west">W</span>{typeof rotor?.azimuth === "number" && <i style={{ transform: `rotate(${angle}deg)` }} />}<strong>{typeof rotor?.azimuth === "number" ? `${Math.round(rotor.azimuth).toString().padStart(3, "0")}°` : "—"}<small>OBSERVED ANTENNA</small></strong></div><div className="monitor-target"><strong>{rotor?.target_label || "No selected target"}</strong><span>{typeof rotor?.target_bearing === "number" ? `${Math.round(rotor.target_bearing)}° target` : ""}</span></div><div className="monitor-live-map">{map}</div>
      {onRotorRequest && <form className="monitor-actions" onSubmit={event => { event.preventDefault(); if (bearing !== "" && Number.isFinite(Number(bearing)) && Number(bearing) >= 0 && Number(bearing) <= 360) void command("rotor_goto", { bearing: Number(bearing) }); }}><input aria-label="Monitor rotor bearing" type="number" min="0" max="360" value={bearing} onChange={e => setBearing(e.target.value)} placeholder="Bearing °" /><button disabled={busy || !rotor?.connected || bearing === ""}>Turn</button><button type="button" disabled={!rotor?.owner} onClick={() => void command("rotor_stop", {})}>Stop</button></form>}</section>}
  </div>;
}

import { useEffect, useRef, useState, type ReactNode } from "react";
type Data = Record<string, any>;
const frequency = (hz: unknown) => typeof hz === "number" && Number.isFinite(hz) ? (hz / 1e6).toFixed(6) : "—";
const value = (input: unknown, suffix = "") => input == null ? "—" : `${input}${suffix}`;

export default function Monitor({ snapshot, map }: { snapshot: Data | null; map: ReactNode }) {
  const radio = snapshot?.radio, station = snapshot?.station, rotor = snapshot?.rotor;
  const [angle, setAngle] = useState(0);
  const previous = useRef<number | null>(null);
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
  return <div className="integrated-monitor">
    <section className="monitor-radio">
      <header><span className="secondary">OM0RX STATION · {snapshot?.source === "direct_agent" ? "DIRECT AGENT" : "xCAT COMPANION"}</span><b className={fresh ? "teal" : "amber"}>{fresh ? radio?.transmitting ? "TX" : "RX" : "OFFLINE"}</b></header>
      <div className="monitor-vfos"><strong>A: {frequency(vfo("A"))}</strong><strong>B: {frequency(vfo("B"))}</strong><span>{radio?.mode || "Mode unavailable"} · {station?.band || "—"} · {station?.interlock_state || "No live observation"}</span></div>
      <div className="monitor-meters"><div className="output"><small>TX POWER</small><strong>{value(station?.tx_power_watts, " W")}</strong></div><div className="swr"><small>SWR</small><strong>{value(station?.swr)}</strong><small>{station?.swr_is_live ? "LIVE" : "LAST"}</small></div><div className="drive"><small>RF DRIVE</small><strong>{value(station?.rf_drive_watts, " W")}</strong></div></div>
      <section className="monitor-kpa"><strong>KPA500 · {station?.kpa_operate == null ? "Unavailable" : station.kpa_operate ? "OPERATE" : "STBY"}</strong><p>{station?.kpa_detail_primary || "Waiting for amplifier status"}</p><p>{station?.kpa_detail_secondary}</p></section>
      <section className="monitor-kat"><strong>KAT500</strong><p>{station?.kat_detail_primary || "Waiting for tuner status"}</p><p>{station?.kat_detail_secondary}</p></section>
      <section className="monitor-route"><p>{station?.route_detail || "Route unavailable"}</p><b>{station?.route_alignment || "UNKNOWN"}</b></section>
      <footer>{station?.alarm_summary || "No live alarm observation"}<br />{snapshot?.generated_at ? `Received ${new Date(snapshot.generated_at * 1000).toLocaleTimeString()}` : "Waiting for station"} · display only</footer>
    </section>
    <section className="monitor-rotor"><header><strong>{rotor?.name || "ROTOR"}</strong><span>{rotor?.connected ? rotor.status : "Disconnected"}</span></header><div className="monitor-compass"><span className="north">N</span><span className="east">E</span><span className="south">S</span><span className="west">W</span>{typeof rotor?.azimuth === "number" && <i style={{ transform: `rotate(${angle}deg)` }} />}<strong>{typeof rotor?.azimuth === "number" ? `${Math.round(rotor.azimuth).toString().padStart(3, "0")}°` : "—"}<small>OBSERVED ANTENNA</small></strong></div><div className="monitor-target"><strong>{rotor?.target_label || "No selected target"}</strong><span>{typeof rotor?.target_bearing === "number" ? `${Math.round(rotor.target_bearing)}° target` : ""}</span></div><div className="monitor-live-map">{map}</div></section>
  </div>;
}

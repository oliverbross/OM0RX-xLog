import { useEffect, useRef, useState, type ReactNode } from "react";
import { connectMonitorContext, monitorRadioFresh, monitorStation, type MonitorContext } from "./monitorContext";
import { dockDetachedWorkspace } from "./DetachedClusterBridge";
import { AgentConnectionSetup } from "./AgentConnectionSetup";
import "./StationPanel.css";

type Connection = { refresh: () => void; dispose: () => void };
type Props = { connect?: (changed: (value: MonitorContext) => void, failed: (message: string) => void) => Connection; configuration?: ReactNode };
const frequency = (hz: unknown) => typeof hz === "number" && Number.isFinite(hz) ? `${(hz / 1e6).toFixed(6)} MHz` : "Unavailable";
const value = (input: unknown) => input == null || input === "" ? "Unavailable" : String(input);
const providers = { direct_agent: "Remote Station Agent", direct_flex_lan: "Direct FLEX LAN", hamlib: "Local Hamlib" };

/** Retained observations and optional shared radio connection controls. Mounting never
 * reads credentials, selects a provider, connects a device or sends an action. */
export function StationControlSurface({ connect = connectMonitorContext, configuration }: Props) {
  const [context, setContext] = useState<MonitorContext | null>(null);
  const [error, setError] = useState(""), [clock, setClock] = useState(Date.now());
  const [docking, setDocking] = useState(false), [dockError, setDockError] = useState("");
  const mounted = useRef(false), dockingRef = useRef(false);
  const connection = useRef<Connection | null>(null);
  useEffect(() => {
    let active = true;
    mounted.current = true;
    const retained = connect(next => { if (active) { setContext(next); setError(""); } }, message => { if (active) setError(message); });
    connection.current = retained;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => { active = false; mounted.current = false; retained.dispose(); connection.current = null; clearInterval(timer); };
  }, [connect]);
  const dockBack = async () => {
    if (dockingRef.current) return;
    dockingRef.current = true; setDocking(true); setDockError("");
    try { await dockDetachedWorkspace(); }
    catch { if (mounted.current) setDockError("Could not dock Station Control. This window remains open; try Dock back again."); }
    finally { dockingRef.current = false; if (mounted.current) setDocking(false); }
  };
  const fresh = !error && monitorRadioFresh(context, clock), station = monitorStation(context, clock);
  const provider = context?.selection?.provider, radio = station.radio, safety = station.station;
  return <div className="app live"><main aria-label="Detached Station Control">
    <section className="live-station" aria-label="Station observations">
      <header className="live-station-head"><div><h2>Station Control</h2><p>{configuration && !context?.acceptance ? "Shared radio connections · independent of Desk" : "Passive station monitoring · independent of Desk"}</p></div>
        <div className="live-station-head-actions"><button type="button" onClick={() => connection.current?.refresh()}>Refresh observations</button>
          <button type="button" disabled={docking} onClick={() => void dockBack()}>{docking ? "Docking…" : "Dock back"}</button></div></header>
      <p role="status">{configuration && !context?.acceptance ? "Radio selection and Agent, Hamlib and Direct FLEX LAN connections are shared. Radio commands require the main station controls." : "Connection setup, radio selection and station actions currently require the main station controls."}</p>
      {!context?.acceptance && configuration}
      {error && <p className="live-station-error" role="alert">{error}</p>}
      {dockError && <p className="live-station-error" role="alert">{dockError}</p>}
      {!context && <p role="status">Loading retained native station observations…</p>}
      {context?.acceptance && <p role="status">Synthetic isolated observation · read only</p>}
      {context && !provider && <p role="status">No radio selected. Select and connect a radio in the main station controls.</p>}
      {provider && <><p>{providers[provider]} · <span role="status">{fresh ? "Observed live" : "Observation unavailable or stale · retained values"}</span></p>
        <div className="live-station-readback"><div><span>Observed receive</span><strong>{frequency(radio.receive_frequency_hz ?? radio.frequency_hz)}</strong><span>{value(radio.mode)}</span></div></div>
        <dl><dt>Transmit frequency</dt><dd>{frequency(radio.transmit_frequency_hz)}</dd>
          <dt>PTT</dt><dd>{fresh && typeof radio.transmitting === "boolean" ? radio.transmitting ? "Transmitting" : "Receive" : "Unavailable"}</dd>
          <dt>Split</dt><dd>{fresh && typeof radio.split === "boolean" ? radio.split ? "On" : "Off" : "Unavailable"}</dd>
          <dt>Observation received</dt><dd>{typeof context?.radio.received_at_ms === "number" ? new Date(context.radio.received_at_ms).toLocaleTimeString() : "Unavailable"}</dd>
        </dl>
        {provider === "direct_agent" && <section className="live-station-card"><h3>Retained station safety</h3>
          <dl><dt>Coordinator</dt><dd>{value(safety.coordinator_state)}</dd><dt>Interlock</dt><dd>{value(safety.interlock_state)}</dd>
            <dt>Route</dt><dd>{value(safety.route_alignment)}</dd><dt>Amplifier</dt><dd>{safety.kpa_operate == null ? "Unavailable" : safety.kpa_operate ? "Operate" : "Standby"}</dd>
            <dt>Forward power</dt><dd>{fresh && safety.swr_is_live ? `${value(safety.tx_power_watts)} W` : "Unavailable"}</dd>
            <dt>SWR</dt><dd>{fresh && safety.swr_is_live ? value(safety.swr) : "Unavailable"}</dd></dl>
          {Array.isArray(safety.inhibitors) && safety.inhibitors.length > 0 && <p>{safety.inhibitors.join(" · ")}</p>}
          {safety.alarm_summary && <p>{safety.alarm_summary}</p>}
        </section>}
      </>}
    </section>
  </main></div>;
}
export function DetachedStationControlSurface() {
  return <StationControlSurface configuration={new URLSearchParams(location.search).get("acceptance") === "local" ? undefined : <AgentConnectionSetup connections providers followSelection />} />;
}

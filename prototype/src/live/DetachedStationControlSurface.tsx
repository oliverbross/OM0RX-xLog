import { useEffect, useState, type ReactNode } from "react";
import { connectMonitorContext, monitorRadioFresh, monitorStation, type MonitorContext } from "./monitorContext";
import { AgentConnectionSetup } from "./AgentConnectionSetup";
import { ManualSimplexTune } from "./ManualSimplexTune";
import { ManualRotorControl, ManualRotorStatus } from "./ManualRotorControl";
import { manualRotorGotoSession, type ManualRotorGotoSession } from "./manualRotorGoto";
import "./StationPanel.css";
import "./DetachedStationControlSurface.css";

type Connection = { refresh: () => void; dispose: () => void };
type Props = { connect?: (changed: (value: MonitorContext) => void, failed: (message: string) => void) => Connection; configuration?: ReactNode | ((context: MonitorContext | null) => ReactNode); rotorControls?: boolean; rotorSession?: ManualRotorGotoSession };
const frequency = (hz: unknown) => typeof hz === "number" && Number.isFinite(hz) ? `${(hz / 1e6).toFixed(6)} MHz` : "Unavailable";
const value = (input: unknown) => input == null || input === "" ? "Unavailable" : String(input);
const providers = { direct_agent: "Remote Station Agent", direct_flex_lan: "Direct FLEX LAN", direct_tci: "Direct TCI · read only", hamlib: "Local Hamlib" };

/** Retained observations and optional shared radio connection controls. Mounting never
 * reads credentials, selects a provider, connects a device or sends an action. */
export function StationControlSurface({ connect = connectMonitorContext, configuration, rotorControls = false, rotorSession = manualRotorGotoSession() }: Props) {
  const [context, setContext] = useState<MonitorContext | null>(null);
  const [error, setError] = useState(""), [clock, setClock] = useState(Date.now());
  useEffect(() => {
    let active = true;
    const retained = connect(next => { if (active) { setContext(next); setError(""); } }, message => { if (active) setError(message); });
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => { active = false; retained.dispose(); clearInterval(timer); };
  }, [connect]);
  const fresh = !error && monitorRadioFresh(context, clock), station = monitorStation(context, clock);
  const provider = context?.selection?.provider, radio = station.radio, safety = station.station;
  return <div className="app live detached-station-control-app"><main aria-label="Detached Station Control">
    {!context?.acceptance && configuration && <section className="detached-station-setup" aria-label="Radio connections">
      {typeof configuration === "function" ? configuration(fresh ? context : null) : configuration}
    </section>}
    {rotorControls && !context?.acceptance && (context?.rotor?.snapshot?.owner
      ? <ManualRotorControl context={context} session={rotorSession} /> : <ManualRotorStatus session={rotorSession} />)}
    <section className="live-station detached-station-observations" aria-label="Station observations">
      <h2>Observed station state</h2>
      {error && <p className="live-station-error" role="alert">{error}</p>}
      {!context && <p role="status">Loading retained native station observations…</p>}
      {context?.acceptance && <p role="status">Synthetic isolated observation · read only</p>}
      {provider === "direct_tci" && <p role="status">TCI observations are read only. Radio controls are unavailable.</p>}
      {context && !provider && <p role="status">No radio selected. Select and connect a radio{configuration ? " above" : " in the main station controls"}.</p>}
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
  return <StationControlSurface rotorControls configuration={new URLSearchParams(location.search).get("acceptance") === "local" ? undefined : context => <><AgentConnectionSetup connections providers followSelection compact receiveContext={context} />
    {context?.selection?.provider && context.selection.provider !== "direct_tci" && <ManualSimplexTune provider={context.selection.provider} context={context} />}</>} />;
}

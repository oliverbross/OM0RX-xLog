import { useEffect, useState } from "react";
import { connectStationStatus } from "./stationStatus";
import { monitorRadioFresh, monitorStation, type MonitorContext } from "./monitorContext";
import "./StationPanel.css";
import "./DetachedTaskSurface.css";

const providers = { direct_agent: "Remote Station Agent", direct_flex_lan: "Direct FLEX LAN", hamlib: "Local Hamlib" };
const frequency = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? `${(value / 1e6).toFixed(6)} MHz` : "Unavailable";
const text = (value: unknown) => typeof value === "string" && value.trim() ? value : "Unavailable";
const freshTime = (time: unknown, now: number) => typeof time === "number" && Number.isFinite(time) && Math.abs(now - time * 1000) <= 5000;

/** Independent read-only status. The native selection and telemetry owners
 * remain the sole authorities; this view cannot connect, select or control. */
export function DetachedStationStatusSurface() {
  const [context, setContext] = useState<MonitorContext | null>(null), [available, setAvailable] = useState(false);
  const [clock, setClock] = useState(Date.now()), [error, setError] = useState("");
  useEffect(() => {
    const dispose = connectStationStatus(value => { setContext(value); setAvailable(true); setError(""); },
      message => { setAvailable(false); setError(message); }, () => setAvailable(false));
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => { dispose(); clearInterval(timer); };
  }, []);
  const provider = context?.selection?.provider;
  const coherent = !!provider && context?.radio.provider === provider && context.radio.selection_id === context.selection?.selection_id &&
    context.radio.selection_generation === context.selection?.generation;
  const display = context && !coherent ? { ...context, radio: { available: false, snapshot: null } } : context;
  const station = monitorStation(display, clock), radio = station.radio, safety = station.station;
  const fresh = available && monitorRadioFresh(context, clock) && freshTime(radio.observed_at, clock) &&
    (provider !== "hamlib" || ["frequency", "mode"].every(field => freshTime(context?.radio?.snapshot?.field_observed_at_ms?.[field] / 1000, clock)));
  const fieldFresh = (field: string) => fresh && (provider !== "hamlib" || freshTime(context?.radio?.snapshot?.field_observed_at_ms?.[field] / 1000, clock));
  return <div className="app live detached-task-app detached-station-status-app"><main aria-label="Detached Station Status"><section className="live-station" aria-label="Station state">
    <p role="status">{!provider ? "No retained selected radio. Choose and connect a radio in Desk." : `${providers[provider]} · ${fresh ? "Observed current" : "Unavailable or stale · retained values are display only"}`}</p>
    <div className="live-station-readback"><div><span>{fresh ? "Observed receive" : "Retained receive"}</span>
      <strong>{frequency(radio.receive_frequency_hz ?? radio.frequency_hz)}</strong><span>{text(radio.mode)}</span></div></div>
    <dl><dt>PTT</dt><dd>{fieldFresh("ptt") && typeof radio.transmitting === "boolean" ? radio.transmitting ? "Transmitting" : "Receive" : "Unavailable"}</dd>
      <dt>Split</dt><dd>{fieldFresh("split") && typeof radio.split === "boolean" ? radio.split ? "On" : "Off" : "Unavailable"}</dd>
      <dt>Transmit frequency</dt><dd>{fieldFresh("tx_frequency") ? frequency(radio.transmit_frequency_hz) : "Unavailable"}</dd>
      <dt>Selected radio generation</dt><dd>{context?.selection?.generation ?? "Unavailable"}</dd>
      <dt>Radio observed</dt><dd>{typeof radio.observed_at === "number" && Number.isFinite(radio.observed_at) ? new Date(radio.observed_at * 1000).toLocaleTimeString() : "Unavailable"}</dd>
    </dl>
    {provider === "direct_agent" && <section className="live-station-card"><h3>Retained station safety</h3>
      <dl><dt>Coordinator</dt><dd>{text(safety.coordinator_state)}</dd><dt>Interlock</dt><dd>{text(safety.interlock_state)}</dd>
        <dt>Route</dt><dd>{text(safety.route_alignment)}</dd><dt>Amplifier</dt><dd>{fresh && typeof safety.kpa_operate === "boolean" ? safety.kpa_operate ? "Operate" : "Standby" : "Unavailable"}</dd></dl>
      <p>Retained safety reports do not authorize transmission or guarantee RF readiness.</p>
      {Array.isArray(safety.inhibitors) && safety.inhibitors.filter((value: unknown) => typeof value === "string").map((value: string, index: number) => <p key={index}>{value}</p>)}
      {typeof safety.alarm_summary === "string" && <p>{safety.alarm_summary}</p>}
    </section>}
    {error && <p role="alert">{error}</p>}
  </section></main></div>;
}

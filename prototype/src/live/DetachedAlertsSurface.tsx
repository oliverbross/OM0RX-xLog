import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { connectAlerts, type AlertsSnapshot, type AlertCode } from "./alerts";
const messages: Record<AlertCode, string> = { radio_inhibitors: "Radio safety inhibitors reported", radio_alarm: "Station alarm reported — review Station Status or Desk", rotor_uncertain: "Rotor outcome uncertain — review Rotor before further commands" };
export function DetachedAlertsSurface() {
  const [snapshot, setSnapshot] = useState<AlertsSnapshot | null>(null), [verified, setVerified] = useState(false);
  const [error, setError] = useState(""), [transitionError, setTransitionError] = useState(""), [transitioning, setTransitioning] = useState(false);
  const mounted = useRef(false), busy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const dispose = connectAlerts(value => { setSnapshot(value); setVerified(true); setError(""); }, message => { setVerified(false); setError(message); }, () => setVerified(false));
    return () => { mounted.current = false; dispose(); };
  }, []);
  const transition = async (command: "dock_detached_window" | "close_alerts_window") => {
    if (busy.current) return; busy.current = true; setTransitioning(true); setTransitionError("");
    try { await invoke(command); }
    catch (cause) { if (mounted.current) { busy.current = false; setTransitioning(false); setTransitionError(`Alerts remains open. ${String(cause)}`); } }
  };
  return <div className="app live"><main aria-label="Detached Alerts"><section className="live-station">
    <header className="live-station-head"><div><h2>Alerts</h2><p>Retained radio safety and rotor reports · independent of Desk</p></div>
      <div className="live-station-head-actions">
        <button type="button" disabled={transitioning} onClick={() => { void invoke("show_alerts_desk").catch(cause => { if (mounted.current) setTransitionError(`Could not show Desk: ${String(cause)}`); }); }}>Show Desk</button>
        <button type="button" disabled={transitioning} onClick={() => void transition("dock_detached_window")}>Dock back</button>
        <button type="button" disabled={transitioning} onClick={() => void transition("close_alerts_window")}>Close Alerts</button>
      </div></header>
    <p role="status">{verified ? "Retained reports loaded — not a live all-clear" : "Reports unavailable or changing — retained display only"}</p>
    <p>This window never starts polling, connects devices or acknowledges alarms. Reports may be old; absence of a report does not establish RF readiness.</p>
    <dl><dt>Agent safety report</dt><dd>{snapshot?.radio_report ? "Retained report present" : "Not observed for the selected radio"}</dd>
      <dt>Rotor report</dt><dd>{snapshot?.rotor_report ? "Retained report present" : "Not observed"}</dd></dl>
    {snapshot?.items.length ? <ul aria-label="Retained alerts">{snapshot.items.map(item => <li key={item.code}>{messages[item.code]}{item.code === "radio_inhibitors" ? ` (${item.count})` : ""}</li>)}</ul> : <p>No alert entries in the retained reports. This is not an all-clear.</p>}
    <p>Coverage: modeled Agent safety inhibitors/alarm presence and rotor uncertainty only. Other application and device alerts are not aggregated here.</p>
    {error && <p role="alert">{error}</p>}{transitionError && <p role="alert">{transitionError}</p>}
  </section></main></div>;
}

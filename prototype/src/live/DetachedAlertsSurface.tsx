import { useEffect, useState } from "react";
import { connectAlerts, type AlertsSnapshot, type AlertCode } from "./alerts";
import "./DetachedReferenceSurface.css";
const messages: Record<AlertCode, string> = { radio_inhibitors: "Radio safety inhibitors reported", radio_alarm: "Station alarm reported — review Station Status or Desk", rotor_uncertain: "Rotor outcome uncertain — review Rotor before further commands" };
export function DetachedAlertsSurface() {
  const [snapshot, setSnapshot] = useState<AlertsSnapshot | null>(null), [verified, setVerified] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const dispose = connectAlerts(value => { setSnapshot(value); setVerified(true); setError(""); }, message => { setVerified(false); setError(message); }, () => setVerified(false));
    return dispose;
  }, []);
  return <div className="app live detached-reference-app detached-alerts-app"><main aria-label="Detached Alerts"><section aria-label="Retained safety reports">
    <p role="status">{verified ? "Retained data · not a live all-clear" : "Reports unavailable or changing — retained display only"}</p>
    <dl><dt>Agent safety report</dt><dd>{snapshot?.radio_report ? "Retained report present" : "Not observed for the selected radio"}</dd>
      <dt>Rotor report</dt><dd>{snapshot?.rotor_report ? "Retained report present" : "Not observed"}</dd></dl>
    {snapshot?.items.length ? <ul aria-label="Retained alerts">{snapshot.items.map(item => <li key={item.code}>{messages[item.code]}{item.code === "radio_inhibitors" ? ` (${item.count})` : ""}</li>)}</ul> : <p>No alert entries in the retained reports. This is not an all-clear.</p>}
    <p className="secondary">Coverage: Agent safety inhibitors, alarms and rotor uncertainty.</p>
    {error && <p role="alert">{error}</p>}
  </section></main></div>;
}

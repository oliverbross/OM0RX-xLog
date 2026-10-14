import { useEffect, useState } from "react";
import { connectAlerts, type AlertsSnapshot, type AlertCode } from "./alerts";
import { clearDxAlerts, connectDxAlerts, saveDxAlerts, testDxAlert, type DxAlertRule, type DxAlertsSnapshot } from "./dxAlerts";
import "./DetachedReferenceSurface.css";
const messages: Record<AlertCode, string> = { radio_inhibitors: "Radio safety inhibitors reported", radio_alarm: "Station alarm reported — review Station Status or Desk", rotor_uncertain: "Rotor outcome uncertain — review Rotor before further commands" };
export function DetachedAlertsSurface() {
  const [snapshot, setSnapshot] = useState<AlertsSnapshot | null>(null), [verified, setVerified] = useState(false);
  const [error, setError] = useState("");
  const [dx, setDx] = useState<DxAlertsSnapshot | null>(null), [draft, setDraft] = useState<DxAlertsSnapshot["configuration"] | null>(null);
  const [dxError, setDxError] = useState(""), [message, setMessage] = useState("");
  useEffect(() => {
    const dispose = connectAlerts(value => { setSnapshot(value); setVerified(true); setError(""); }, message => { setVerified(false); setError(message); }, () => setVerified(false));
    return dispose;
  }, []);
  useEffect(() => connectDxAlerts(value => { setDx(value); setDraft(current => current?.revision === value.configuration.revision ? current : structuredClone(value.configuration)); setDxError(""); }, setDxError), []);
  const updateRule = (index: number, patch: Partial<DxAlertRule>) => setDraft(current => current ? ({ ...current, rules: current.rules.map((rule, position) => position === index ? { ...rule, ...patch } : rule) }) : current);
  const action = async (work: () => Promise<DxAlertsSnapshot>, success: string) => { try { setMessage(""); const value = await work(); setDx(value); setDraft(structuredClone(value.configuration)); setDxError(""); setMessage(success); } catch (cause) { setDxError(cause instanceof Error ? cause.message : "DX alert action failed."); } };
  return <div className="app live detached-reference-app detached-alerts-app"><main aria-label="Detached Alerts"><section aria-label="Retained safety reports">
    <p role="status">{verified ? "Retained data · not a live all-clear" : "Reports unavailable or changing — retained display only"}</p>
    <dl><dt>Agent safety report</dt><dd>{snapshot?.radio_report ? "Retained report present" : "Not observed for the selected radio"}</dd>
      <dt>Rotor report</dt><dd>{snapshot?.rotor_report ? "Retained report present" : "Not observed"}</dd></dl>
    {snapshot?.items.length ? <ul aria-label="Retained alerts">{snapshot.items.map(item => <li key={item.code}>{messages[item.code]}{item.code === "radio_inhibitors" ? ` (${item.count})` : ""}</li>)}</ul> : <p>No alert entries in the retained reports. This is not an all-clear.</p>}
    <p className="secondary">Coverage: Agent safety inhibitors, alarms and rotor uncertainty.</p>
    {error && <p role="alert">{error}</p>}
  </section><section aria-label="DX opportunity alerts">
    <div className="dx-alert-head"><div><h2>DX opportunity alerts</h2><p className={`dx-alert-state ${dx?.source.available ? "is-live" : ""}`}>{dx?.source.available ? "Following the shared cluster feed" : "Cluster feed unavailable"} · passive only</p></div>
      <div className="dx-alert-actions"><button onClick={() => void action(testDxAlert, "Test alert added.")}>Test</button><button disabled={!dx?.entries.length} onClick={() => void action(clearDxAlerts, "Alerts cleared.")}>Clear</button></div></div>
    {dx?.storageError && <p className="dx-alert-error">{dx.storageError}</p>}{dxError && <p className="dx-alert-error" role="alert">{dxError}</p>}{message && <p className="dx-alert-message" role="status">{message}</p>}
    {draft && dx && <details className="dx-alert-settings"><summary>Rules · {draft.rules.filter(rule => rule.enabled).length} enabled</summary>
      <div className="dx-alert-global"><label><input type="checkbox" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled:event.currentTarget.checked })}/> Enable DX alerts</label>
        <label>Repeat guard (seconds)<input type="number" min="15" max="3600" value={draft.dedupSeconds} onChange={event => setDraft({ ...draft, dedupSeconds:Number(event.currentTarget.value) })}/></label>
        <label>Keep alerts (minutes)<input type="number" min="1" max="1440" value={draft.retentionMinutes} onChange={event => setDraft({ ...draft, retentionMinutes:Number(event.currentTarget.value) })}/></label></div>
      {draft.rules.map((rule,index) => <div className="dx-alert-rule" key={rule.id}><div className="dx-alert-rule-head"><label><input type="checkbox" checked={rule.enabled} onChange={event => updateRule(index,{ enabled:event.currentTarget.checked })}/> On</label>
        <input type="text" aria-label={`Rule ${index + 1} name`} value={rule.name} maxLength={80} onChange={event => updateRule(index,{ name:event.currentTarget.value })}/>
        <button onClick={() => setDraft({ ...draft, rules:[...draft.rules,{ ...structuredClone(rule), id:crypto.randomUUID(), name:`${rule.name} copy` }] })} disabled={draft.rules.length >= dx.limits.maximumRules}>Clone</button>
        <button onClick={() => setDraft({ ...draft, rules:draft.rules.filter((_,position) => position !== index) })}>Remove</button></div>
        <div className="dx-alert-rule-fields"><label>Callsign pattern<input value={rule.callsignGlob} placeholder="* or OM0*" onChange={event => updateRule(index,{ callsignGlob:event.currentTarget.value.toUpperCase() })}/></label>
          <label>Bands (comma separated)<input value={rule.bands.join(", ")} onChange={event => updateRule(index,{ bands:csv(event.currentTarget.value).map(value => value.toLowerCase()) })}/></label>
          <label>Modes: CW, SSB, DATA<input value={rule.modes.join(", ")} onChange={event => updateRule(index,{ modes:csv(event.currentTarget.value).map(value => value.toLowerCase()) })}/></label>
          <label>DXCC status<input value={rule.dxccStatuses.join(", ")} onChange={event => updateRule(index,{ dxccStatuses:csv(event.currentTarget.value) })}/></label>
          <label>Call status<input value={rule.callStatuses.join(", ")} onChange={event => updateRule(index,{ callStatuses:csv(event.currentTarget.value) })}/></label>
          <label>Special tags<input value={rule.specials.join(", ")} onChange={event => updateRule(index,{ specials:csv(event.currentTarget.value).map(value => value.toUpperCase()) })}/></label></div></div>)}
      <div className="dx-alert-actions"><button disabled={draft.rules.length >= dx.limits.maximumRules} onClick={() => setDraft({ ...draft, rules:[...draft.rules,newRule()] })}>Add rule</button><button onClick={() => setDraft(structuredClone(dx.configuration))}>Revert</button><button className="primary" onClick={() => void action(() => saveDxAlerts(dx,{ enabled:draft.enabled,dedupSeconds:draft.dedupSeconds,retentionMinutes:draft.retentionMinutes,rules:draft.rules }), "Rules saved. Existing spots were baselined without alerts.")}>Save rules</button></div>
    </details>}
    {dx?.entries.length ? <div className="dx-alert-table"><table><thead><tr><th>Call</th><th>Frequency</th><th>Mode</th><th>Reason</th><th>Last seen</th><th>Count</th></tr></thead><tbody>{dx.entries.map(entry => <tr key={entry.id}><td className="dx-call">{entry.callsign}</td><td>{entry.test ? "Test" : `${entry.frequencyKHz.toFixed(1)} kHz`}</td><td>{entry.mode}</td><td>{entry.ruleNames.join(", ")}</td><td>{new Date(entry.lastSeenMs).toLocaleTimeString()}</td><td>{entry.count}</td></tr>)}</tbody></table></div> : <p className="dx-alert-empty">No DX alerts yet. Enabling rules never tunes or transmits.</p>}
  </section></main></div>;
}

const csv = (value: string) => value.split(",").map(item => item.trim()).filter(Boolean);
const newRule = (): DxAlertRule => ({ id:crypto.randomUUID(), name:"New rule", enabled:true, callsignGlob:"*", bands:[], modes:[], callStatuses:[], dxccStatuses:[], specials:[] });

import { useEffect, useRef, useState } from "react";
import { connectAlerts, type AlertsSnapshot, type AlertCode } from "./alerts";
import { clearDxAlerts, clearSelectedDxAlerts, connectDxAlerts, saveDxAlerts, testDxAlert, type DxAlertRule, type DxAlertsSnapshot } from "./dxAlerts";
import { AlertColumns, useAlertColumns } from "./AlertColumns";
import { alertColumns } from "./alertColumnPreferences";
import "./DetachedReferenceSurface.css";
const messages: Record<AlertCode, string> = { radio_inhibitors: "Radio safety inhibitors reported", radio_alarm: "Station alarm reported — review Station Status or Desk", rotor_uncertain: "Rotor outcome uncertain — review Rotor before further commands" };
export function DetachedAlertsSurface() {
  const [snapshot, setSnapshot] = useState<AlertsSnapshot | null>(null), [verified, setVerified] = useState(false);
  const [error, setError] = useState("");
  const [dx, setDx] = useState<DxAlertsSnapshot | null>(null), [draft, setDraft] = useState<DxAlertsSnapshot["configuration"] | null>(null);
  const [dxError, setDxError] = useState(""), [message, setMessage] = useState("");
  const [sort, setSort] = useState<AlertSort>("recent");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [columnPreferences, setColumnPreferences] = useAlertColumns();
  const latestDx = useRef<DxAlertsSnapshot | null>(null);
  const receiveDx = (value: DxAlertsSnapshot) => {
    const previous = latestDx.current;
    if (previous?.epoch === value.epoch && previous.revision > value.revision) return;
    latestDx.current = value;
    setDx(value);
    setDraft(current => current?.generation === value.configuration.generation && current.revision === value.configuration.revision ? current : structuredClone(value.configuration));
    setSelectedIds(current => previous?.epoch === value.epoch ? current.filter(id => value.entries.some(entry => entry.id === id)) : []);
    setDxError("");
  };
  useEffect(() => {
    const dispose = connectAlerts(value => { setSnapshot(value); setVerified(true); setError(""); }, message => { setVerified(false); setError(message); }, () => setVerified(false));
    return dispose;
  }, []);
  useEffect(() => connectDxAlerts(receiveDx, setDxError), []);
  const updateRule = (index: number, patch: Partial<DxAlertRule>) => setDraft(current => current ? ({ ...current, rules: current.rules.map((rule, position) => position === index ? { ...rule, ...patch } : rule) }) : current);
  const action = async (work: () => Promise<DxAlertsSnapshot>, success: string) => { try { setMessage(""); const value = await work(); if (latestDx.current?.epoch !== dx?.epoch) return; receiveDx(value); setMessage(success); } catch (cause) { setDxError(cause instanceof Error ? cause.message : "DX alert action failed."); } };
  const selectEntry = (id: string, checked: boolean) => setSelectedIds(current => checked ? [...current.filter(value => value !== id), id] : current.filter(value => value !== id));
  const entries = [...(dx?.entries ?? [])].sort((left, right) => compareAlerts(left, right, sort));
  return <div className="app live detached-reference-app detached-alerts-app"><main aria-label="Detached Alerts"><section aria-label="Retained safety reports">
    <p role="status">{verified ? "Retained data · not a live all-clear" : "Reports unavailable or changing — retained display only"}</p>
    <dl><dt>Agent safety report</dt><dd>{snapshot?.radio_report ? "Retained report present" : "Not observed for the selected radio"}</dd>
      <dt>Rotor report</dt><dd>{snapshot?.rotor_report ? "Retained report present" : "Not observed"}</dd></dl>
    {snapshot?.items.length ? <ul aria-label="Retained alerts">{snapshot.items.map(item => <li key={item.code}>{messages[item.code]}{item.code === "radio_inhibitors" ? ` (${item.count})` : ""}</li>)}</ul> : <p>No alert entries in the retained reports. This is not an all-clear.</p>}
    <p className="secondary">Coverage: Agent safety inhibitors, alarms and rotor uncertainty.</p>
    {error && <p role="alert">{error}</p>}
  </section><section aria-label="DX opportunity alerts">
    <div className="dx-alert-head"><div><h2>DX opportunity alerts</h2><p className={`dx-alert-state ${dx?.source.available ? "is-live" : ""}`}>{dx?.source.available ? "Following the shared cluster feed" : "Cluster feed unavailable"} · passive only</p></div>
      <div className="dx-alert-actions"><label>Sort alerts<select value={sort} onChange={event => setSort(event.currentTarget.value as AlertSort)}><option value="recent">Latest report first</option><option value="callsign">Callsign A–Z</option><option value="frequency">Frequency low–high</option><option value="reports">Most reports first</option></select></label><button onClick={() => void action(testDxAlert, "Test alert added.")}>Test</button><button disabled={!selectedIds.length || !dx} onClick={() => dx && void action(() => clearSelectedDxAlerts(dx, selectedIds), "Selected alerts cleared.")}>Clear selected ({selectedIds.length})</button><button disabled={!dx?.entries.length} onClick={() => void action(clearDxAlerts, "All alerts cleared.")}>Clear all</button></div></div>
    <AlertColumns preferences={columnPreferences} onChange={setColumnPreferences}/>
    {dx?.activitySource && <p className="dx-alert-state">WSJT-X CQ feed {dx.activitySource.available ? "listening" : "off or unavailable"} · receive only · FT8/FT4 · activity expires after 60 seconds. Call/DXCC novelty is unavailable for this source.</p>}
    {dx?.storageError && <p className="dx-alert-error">{dx.storageError}</p>}{dxError && <p className="dx-alert-error" role="alert">{dxError}</p>}{message && <p className="dx-alert-message" role="status">{message}</p>}
    {dx?.delivery.error && <p className="dx-alert-error" role="alert">{dx.delivery.error}</p>}
    {!!dx?.delivery.suppressed && <p className="secondary">{dx.delivery.suppressed} native notifications suppressed by the {dx.delivery.maximumPerWindow}-per-{dx.delivery.windowSeconds}-second safety limit.</p>}
    {draft && dx && <details className="dx-alert-settings"><summary>Rules · {draft.rules.filter(rule => rule.enabled).length} enabled</summary>
      <div className="dx-alert-global"><label><input type="checkbox" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled:event.currentTarget.checked })}/> Enable DX alerts</label>
        <label><input type="checkbox" checked={draft.nativePopup} onChange={event => setDraft({ ...draft, nativePopup:event.currentTarget.checked, notificationSound:event.currentTarget.checked ? draft.notificationSound : false })}/> Native popup</label>
        <label><input type="checkbox" checked={draft.notificationSound} disabled={!draft.nativePopup} onChange={event => setDraft({ ...draft, notificationSound:event.currentTarget.checked })}/> Notification sound</label>
        <label>Repeat guard (seconds)<input type="number" min="15" max="3600" value={draft.dedupSeconds} onChange={event => setDraft({ ...draft, dedupSeconds:Number(event.currentTarget.value) })}/></label>
        <label>Keep alerts (minutes)<input type="number" min="1" max="1440" value={draft.retentionMinutes} onChange={event => setDraft({ ...draft, retentionMinutes:Number(event.currentTarget.value) })}/></label></div>
      {draft.rules.map((rule,index) => <div className="dx-alert-rule" key={rule.id}><div className="dx-alert-rule-head"><label><input type="checkbox" checked={rule.enabled} onChange={event => updateRule(index,{ enabled:event.currentTarget.checked })}/> On</label>
        <input type="text" aria-label={`Rule ${index + 1} name`} value={rule.name} maxLength={80} onChange={event => updateRule(index,{ name:event.currentTarget.value })}/>
        <button onClick={() => setDraft({ ...draft, rules:[...draft.rules,{ ...structuredClone(rule), id:crypto.randomUUID(), name:`${rule.name} copy` }] })} disabled={draft.rules.length >= dx.limits.maximumRules}>Clone</button>
        <button onClick={() => setDraft({ ...draft, rules:draft.rules.filter((_,position) => position !== index) })}>Remove</button></div>
        <div className="dx-alert-rule-fields"><label>Source<select value={(rule.sources ?? ["cluster"]).length === 2 ? "both" : rule.sources?.[0] ?? "cluster"} onChange={event => updateRule(index,{ sources:event.currentTarget.value === "both" ? ["cluster", "wsjtx"] : [event.currentTarget.value as "cluster" | "wsjtx"] })}><option value="cluster">DX Cluster</option><option value="wsjtx">WSJT-X CQ</option><option value="both">DX Cluster and WSJT-X CQ</option></select></label><label>Callsign pattern<input value={rule.callsignGlob} placeholder="* or OM0*" onChange={event => updateRule(index,{ callsignGlob:event.currentTarget.value.toUpperCase() })}/></label>
          <label>Comment contains<input value={rule.commentContains} maxLength={80} placeholder="e.g. POTA" onChange={event => updateRule(index,{ commentContains:event.currentTarget.value })}/></label>
          <label>Bands (comma separated)<input value={rule.bands.join(", ")} onChange={event => updateRule(index,{ bands:csv(event.currentTarget.value).map(value => value.toLowerCase()) })}/></label>
          <label>Modes: CW, SSB, DATA<input value={rule.modes.join(", ")} onChange={event => updateRule(index,{ modes:csv(event.currentTarget.value).map(value => value.toLowerCase()) })}/></label>
          <label>DXCC status<input value={rule.dxccStatuses.join(", ")} onChange={event => updateRule(index,{ dxccStatuses:csv(event.currentTarget.value) })}/></label>
          <label>Call status<input value={rule.callStatuses.join(", ")} onChange={event => updateRule(index,{ callStatuses:csv(event.currentTarget.value) })}/></label>
          <label>Special tags<input value={rule.specials.join(", ")} onChange={event => updateRule(index,{ specials:csv(event.currentTarget.value).map(value => value.toUpperCase()) })}/></label></div></div>)}
      <p className="secondary">Popup delivery is local and rate-limited. It contains no action button and cannot tune or transmit.</p>
      <p className="secondary">Each rule requires all its filled conditions. Comment contains matches literal text, ignoring case; leave it blank for any comment.</p>
      <div className="dx-alert-actions"><button disabled={draft.rules.length >= dx.limits.maximumRules} onClick={() => setDraft({ ...draft, rules:[...draft.rules,newRule()] })}>Add rule</button><button onClick={() => setDraft(structuredClone(dx.configuration))}>Revert</button><button className="primary" onClick={() => void action(() => saveDxAlerts(dx,{ enabled:draft.enabled,dedupSeconds:draft.dedupSeconds,retentionMinutes:draft.retentionMinutes,nativePopup:draft.nativePopup,notificationSound:draft.notificationSound,rules:draft.rules }), "Rules saved. Existing spots were baselined without alerts.")}>Save rules</button></div>
    </details>}
    {entries.length ? <div className="dx-alert-table"><table><thead><tr>{alertColumns.filter(([id]) => columnPreferences.columns.includes(id)).map(([id, label]) => <th scope="col" key={id}>{label}</th>)}</tr></thead><tbody>{entries.map(entry => <tr key={entry.id}><td><AlertSelection entry={entry} checked={selectedIds.includes(entry.id)} onChange={selectEntry}/></td><td className="dx-call">{entry.callsign}</td>{columnPreferences.columns.includes("source") && <td>{sourceLabel(entry)}</td>}{columnPreferences.columns.includes("frequency") && <td>{entry.test ? "Test" : `${entry.frequencyKHz.toFixed(1)} kHz`}</td>}{columnPreferences.columns.includes("mode") && <td>{entry.mode}</td>}{columnPreferences.columns.includes("why") && <td><AlertEvidence entry={entry}/></td>}{columnPreferences.columns.includes("comment") && <td className="dx-comment">{entry.comment || "—"}</td>}{columnPreferences.columns.includes("history") && <td><AlertHistory entry={entry}/></td>}</tr>)}</tbody></table>
      <div className="dx-alert-cards" aria-label="DX alert history">{entries.map(entry => <article className="dx-alert-card" key={entry.id}><header><AlertSelection entry={entry} checked={selectedIds.includes(entry.id)} onChange={selectEntry}/><strong className="dx-call">{entry.callsign}</strong><span>{sourceLabel(entry)}</span></header>
        <p className="dx-alert-card-spot">{entry.test ? "Test alert" : `${entry.frequencyKHz.toFixed(1)} kHz`} · {entry.band} · {entry.mode}</p><AlertEvidence entry={entry}/>{entry.comment && <p className="dx-comment">{entry.comment}</p>}<AlertHistory entry={entry}/></article>)}</div>
    </div> : <p className="dx-alert-empty">No DX alerts yet. Enabling rules never tunes or transmits.</p>}
  </section></main></div>;
}

const csv = (value: string) => value.split(",").map(item => item.trim()).filter(Boolean);
const newRule = (): DxAlertRule => ({ id:crypto.randomUUID(), name:"New rule", enabled:true, sources:["cluster"], callsignGlob:"*", commentContains:"", bands:[], modes:[], callStatuses:[], dxccStatuses:[], specials:[] });
type AlertEntry = DxAlertsSnapshot["entries"][number];
type AlertSort = "recent" | "callsign" | "frequency" | "reports";
function AlertSelection({ entry, checked, onChange }: { entry: AlertEntry; checked: boolean; onChange: (id: string, checked: boolean) => void }) {
  return <input type="checkbox" aria-label={`Select alert ${entry.callsign}, ${entry.test ? "test" : `${entry.frequencyKHz.toFixed(1)} kHz`}, ${entry.mode}`} checked={checked} onChange={event => onChange(entry.id, event.currentTarget.checked)}/>;
}
function compareAlerts(left: AlertEntry, right: AlertEntry, sort: AlertSort) {
  const callsign = left.callsign.localeCompare(right.callsign, "en", { sensitivity:"base" });
  const recent = right.lastSeenMs - left.lastSeenMs;
  const primary = sort === "callsign" ? callsign : sort === "reports" ? right.count - left.count
    : sort === "frequency" ? Number(left.test) - Number(right.test) || left.frequencyKHz - right.frequencyKHz : recent;
  return primary || recent || callsign || left.id.localeCompare(right.id);
}
const sourceLabel = (entry: AlertEntry) => entry.test ? "Test" : entry.source === "wsjtx" ? "WSJT-X CQ" : "DX Cluster";
function AlertEvidence({ entry }: { entry: AlertEntry }) {
  const evidence = [entry.callStatus && `Call: ${entry.callStatus}`, entry.dxccStatus && `DXCC: ${entry.dxccStatus}`, entry.band && `Band: ${entry.band}`, entry.mode && `Mode: ${entry.mode}`].filter(Boolean);
  if (entry.specialTags.length) evidence.push(`Special: ${entry.specialTags.join(", ")}`);
  return <div className="dx-alert-evidence"><strong>{entry.ruleNames.join(", ")}</strong><span>{evidence.join(" · ")}</span></div>;
}
function AlertHistory({ entry }: { entry: AlertEntry }) {
  const repeated = entry.count > 1 || entry.firstSeenMs !== entry.lastSeenMs;
  return <div className="dx-alert-history"><span>{repeated ? <><AlertTime milliseconds={entry.firstSeenMs}/> → <AlertTime milliseconds={entry.lastSeenMs}/></> : <AlertTime milliseconds={entry.lastSeenMs}/>}</span><span>{entry.count} {entry.count === 1 ? "report" : "reports"}</span></div>;
}
function AlertTime({ milliseconds }: { milliseconds: number }) {
  const value = new Date(milliseconds);
  return Number.isNaN(value.getTime()) ? <span>Time unavailable</span> : <time dateTime={value.toISOString()} title={value.toLocaleString()}>{value.toLocaleTimeString()}</time>;
}

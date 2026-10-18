import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { contestSurfaceContextFromSearch, onContestSurfaceWake, readContestSurfaceSnapshot, submitContestSurfaceAction,
  type ContestSurfaceContext, type ContestSurfaceSnapshot, type ContestSurfaceTerminalReceipt } from "./contestSurfaceNative";
import type { ContestSurfaceAction, ContestSurfaceActionEnvelope } from "./contestSurfaceProtocol";
import "./DetachedContestSurface.css";

type Context = ContestSurfaceContext & { panelID: ContestSurfaceActionEnvelope["panelID"] };
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

function useContestSurface(context: Context) {
  const [snapshot, setSnapshot] = useState<ContestSurfaceSnapshot | null>(null), [error, setError] = useState("");
  const mounted = useRef(true), ticket = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++ticket.current;
    try { const value = await readContestSurfaceSnapshot(context); if (mounted.current && current === ticket.current) { setSnapshot(value); setError(""); } }
    catch (cause) { if (mounted.current && current === ticket.current) setError(message(cause)); }
  }, [context]);
  useEffect(() => { mounted.current = true; void refresh(); let stop: undefined | (() => void);
    void onContestSurfaceWake(() => void refresh()).then(value => { if (mounted.current) stop = value; else value(); })
      .catch(cause => { if (mounted.current) setError(message(cause)); });
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", visible);
    return () => { mounted.current = false; ticket.current += 1; stop?.(); window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);
  return { snapshot, error, refresh };
}

function Surface({ context }: { context: Context }) {
  const { snapshot, error, refresh } = useContestSurface(context), [sending, setSending] = useState(false),
    [actionError, setActionError] = useState("");
  const latest = snapshot?.receipts.at(-1);
  const send = useCallback(async (action: ContestSurfaceAction, requestID: string = crypto.randomUUID()) => {
    if (!snapshot || snapshot.panelID !== context.panelID || snapshot.projection.status !== "ready") return false;
    setSending(true); setActionError("");
    try {
      await submitContestSurfaceAction({ ...context, scope: "contesting", projectionRevision: snapshot.projectionRevision,
        requestID, ...action } as ContestSurfaceActionEnvelope);
      await refresh(); return true;
    } catch (cause) { /* Snapshot refresh is the only authority after a lost reply. */
      setActionError(message(cause)); await refresh().catch(() => {}); return false;
    } finally { setSending(false); }
  }, [context, refresh, snapshot]);
  if (!snapshot) return <main aria-label="Contest panel"><p role="status">Loading shared contest panel…</p>{error && <p role="alert">{error}</p>}</main>;
  const projection = snapshot.projection;
  return <main aria-label={`Contest ${context.panelID}`}>
    {error && <p className="contest-surface-error" role="alert">{error}</p>}
    {actionError && <p className="contest-surface-error" role="alert">{actionError}</p>}
    {latest?.status === "uncertain" && <p className="contest-surface-warning" role="status">Action outcome is uncertain. Refresh before deciding what to do next.</p>}
    {latest?.status === "rejected" && <p className="contest-surface-error" role="status">{latest.message || "The main contest controller rejected this action."}</p>}
    {projection.status === "unavailable" ? <section className="contest-surface-unavailable"><h1>Panel unavailable</h1><p>This shared contest panel is not connected yet.</p></section>
      : snapshot.panelID === "active-qso" ? <Entry projection={projection as Extract<typeof projection, { draft: unknown }>} disabled={projection.busy} sending={sending}
          projectionRevision={snapshot.projectionRevision} receipts={snapshot.receipts} send={send}/>
      : snapshot.panelID === "callsign-intelligence" ? <Check projection={projection as Extract<typeof projection, { scp: unknown }>} disabled={sending} send={send}/>
      : snapshot.panelID === "propagation" ? <Statistics projection={projection as Extract<typeof projection, { score: unknown }>}/>
      : snapshot.panelID === "logbook" ? <Log projection={projection as Extract<typeof projection, { page: unknown }>} disabled={projection.busy} sending={sending}
          projectionRevision={snapshot.projectionRevision} receipts={snapshot.receipts} send={send}/>
      : null}
  </main>;
}

type Send = (action: ContestSurfaceAction, requestID?: string) => Promise<boolean>;
type IntentInputProps = { label:string;value:string;identity:string;projectionRevision:number;receipts:ContestSurfaceTerminalReceipt[];
  disabled:boolean;maximumUTF8Bytes:number;send:Send;action:(value:string)=>ContestSurfaceAction };
function IntentInput({label,value:authoritative,identity,projectionRevision,receipts,disabled,maximumUTF8Bytes,send,action}:IntentInputProps){
  const [value,setValue]=useState(authoritative),desired=useRef(authoritative),flight=useRef<null|{requestID:string;projectionRevision:number;value:string}>(null);
  const latest=useRef({projectionRevision,send,action});latest.current={projectionRevision,send,action};
  const pump=useCallback(()=>{if(flight.current||desired.current===authoritative)return;const requestID=crypto.randomUUID(),sentValue=desired.current;
    flight.current={requestID,projectionRevision:latest.current.projectionRevision,value:sentValue};
    void latest.current.send(latest.current.action(sentValue),requestID);},[authoritative]);
  useEffect(()=>{desired.current=authoritative;flight.current=null;setValue(authoritative);},[identity]);
  useEffect(()=>{const pending=flight.current;if(!pending){desired.current=authoritative;setValue(authoritative);return;}
    const receipt=receipts.find(item=>item.requestID===pending.requestID);if(!receipt)return;
    if(receipt.status==="rejected"){flight.current=null;desired.current=authoritative;setValue(authoritative);return;}
    if(receipt.status!=="applied"||projectionRevision<=pending.projectionRevision)return;
    flight.current=null;if(desired.current===pending.value){desired.current=authoritative;setValue(authoritative);}else pump();
  },[authoritative,projectionRevision,receipts,pump]);
  return <label>{label}<input value={value} disabled={disabled} onChange={event=>{const next=event.target.value;
    if(new TextEncoder().encode(next).length>maximumUTF8Bytes)return;desired.current=next;setValue(next);pump();}}/></label>;
}
function Entry({ projection, disabled, sending, projectionRevision, receipts, send }: { projection: any; disabled: boolean; sending:boolean;
  projectionRevision:number;receipts:ContestSurfaceTerminalReceipt[];send:Send }) {
  const base = { draftID: projection.draft.draftID, expectedDraftRevision: projection.draft.revision };
  return <section className="contest-surface-entry"><header><div><h1>{projection.session.name}</h1><span>{projection.session.ruleName} · {projection.session.mode}</span></div>
    <strong>{projection.draft.band} · {projection.draft.mode}</strong></header>
    <IntentInput label="Callsign" value={projection.draft.callsign} identity={`${projection.draft.draftID}/callsign`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={32} send={send} action={value=>({action:"entry_set_text",params:{...base,field:"callsign",value}})}/>
    <div className="contest-surface-row"><IntentInput label="Sent" value={projection.draft.sentReport} identity={`${projection.draft.draftID}/sentReport`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={160} send={send} action={value=>({action:"entry_set_text",params:{...base,field:"sentReport",value}})}/>
      <IntentInput label="Received" value={projection.draft.receivedReport} identity={`${projection.draft.draftID}/receivedReport`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={160} send={send} action={value=>({action:"entry_set_text",params:{...base,field:"receivedReport",value}})}/>
      <IntentInput label="Frequency Hz" value={projection.draft.frequencyText} identity={`${projection.draft.draftID}/frequency`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={11} send={send} action={value=>({action:"entry_set_frequency_text",params:{...base,value}})}/></div>
    {projection.draft.receivedFields.map((field: any) => <IntentInput key={field.id} label={field.label} value={field.value} identity={`${projection.draft.draftID}/exchange/${field.id}`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={field.maximumUTF8Bytes} send={send} action={value=>({action:"entry_set_exchange",params:{...base,fieldID:field.id,value}})}/>)}
    {projection.schemaVersion===2&&<><div className="contest-surface-row"><label>Band<select value={projection.draft.band} disabled={disabled}
      onChange={event=>void send({action:"entry_set_band",params:{...base,value:event.target.value}})}>{projection.descriptor.bands.map((band:string)=><option key={band}>{band}</option>)}</select></label>
      <label>Mode<select value={projection.draft.mode} disabled={disabled}
        onChange={event=>void send({action:"entry_set_mode",params:{...base,value:event.target.value}})}>{projection.descriptor.modes.map((mode:string)=><option key={mode}>{mode}</option>)}</select></label></div>
      <dl>{projection.descriptor.sentFields.map((field:any)=><div key={field.id}><dt>{field.label}</dt><dd>{field.value||"—"}</dd></div>)}</dl>
      {projection.descriptor.serial.requirement==="requiredForCommit"&&<p>Serial: {projection.descriptor.serial.reservedSerial??"not reserved"}</p>}
      {projection.operator&&<section aria-label="Run and S&P simulation"><label>Operating style<select value={projection.operator.style} disabled={disabled||projection.operator.pending!==null}
        onChange={event=>void send({action:"entry_operator_style",params:{...base,value:event.target.value as "run"|"search-and-pounce"}})}><option value="run">Run</option><option value="search-and-pounce">Search &amp; Pounce</option></select></label>
        <button type="button" aria-pressed={projection.operator.armed} disabled={disabled||projection.operator.pending!==null}
          onClick={()=>void send({action:"entry_operator_arm",params:{...base,armed:!projection.operator.armed}})}>{projection.operator.armed?"Disarm":"Arm simulation"}</button>
        <span>{projection.operator.status}</span><div className="contest-surface-results">{projection.operator.functionKeys.map((item:any)=><button type="button" key={item.key}
          disabled={disabled} onClick={()=>void send({action:"entry_operator_key",params:{...base,key:item.key}})}>{item.key} {item.macro}</button>)}</div>
        <ol>{projection.operator.trace.map((item:any)=><li key={item.operationID}><span>{item.mode} · {item.macro}</span> <strong>{item.text}</strong> <small>{item.status}</small></li>)}</ol>
      </section>}</>}
    {projection.draft.frequencyError && <p role="alert">{projection.draft.frequencyError}</p>}
    {[...projection.draft.validation.errors,...projection.draft.validation.warnings].map((item:string) => <p key={item}>{item}</p>)}
    <footer><button disabled={disabled||sending} onClick={() => void send({action:"entry_reserve_serial",params:base})}>Reserve serial</button>
      <button disabled={disabled||sending || projection.draft.validation.errors.length > 0 || projection.draft.dupe.state === "duplicate"}
        onClick={() => void send({action:"entry_commit",params:base})}>Log QSO</button></footer></section>;
}
function Check({ projection, disabled, send }: { projection: any; disabled: boolean; send: Send }) {
  const base={draftID:projection.draftID,expectedDraftRevision:projection.draftRevision};
  return <section><h1>Check Partial & history</h1><label>Callsign query<input value={projection.inputCallsign} disabled={disabled}
    onChange={e=>void send({action:"assistance_query",params:{...base,inputCallsign:e.target.value}})}/></label>
    <h2>SCP</h2><div className="contest-surface-results">{projection.scp.candidates.map((item:any)=><button key={item.candidateID} disabled={disabled}
      onClick={()=>void send({action:"assistance_select",params:{...base,kind:"scp",candidateID:item.candidateID}})}>{item.callsign}</button>)}</div>
    <h2>History</h2>{projection.history.rows.map((row:any)=><button className="contest-surface-history" key={row.candidateID} disabled={disabled}
      onClick={()=>void send({action:"assistance_select",params:{...base,kind:"history",candidateID:row.candidateID}})}><strong>{row.callsign}</strong>
      <span>{row.fields.map((field:any)=>`${field.label}: ${field.value}`).join(" · ")}</span></button>)}</section>;
}
function Statistics({projection}:{projection:any}) { const score=projection.score; return <section><h1>Statistics</h1>{!score?<p>No score available.</p>:<><dl>
  <div><dt>Claimed score</dt><dd>{score.claimedScore.toLocaleString()}</dd></div><div><dt>QSOs</dt><dd>{score.qsos}</dd></div>
  <div><dt>Points</dt><dd>{score.points}</dd></div><div><dt>Multipliers</dt><dd>{score.multipliers}</dd></div></dl>
  <div className="contest-surface-results">{score.multiplierDisplayLabels.map((item:string,index:number)=><span key={`${score.multiplierLabels[index] ?? item}-${index}`}>{item}</span>)}</div>
  <p>Score source: {score.sourceVerification}</p></>}</section>; }
function Log({projection,disabled,sending,projectionRevision,receipts,send}:{projection:any;disabled:boolean;sending:boolean;projectionRevision:number;receipts:ContestSurfaceTerminalReceipt[];send:Send}) { const editing=projection.editing; return <section><h1>Contest log</h1>
  {editing&&<div className="contest-surface-editor"><IntentInput label="Callsign" value={editing.callsign} identity={`${editing.qsoID}/callsign`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={32} send={send} action={value=>({action:"log_edit_set_text",params:{qsoID:editing.qsoID,field:"callsign",value}})}/>
    <IntentInput label="Frequency Hz" value={editing.editFrequencyText} identity={`${editing.qsoID}/frequency`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={11} send={send} action={value=>({action:"log_edit_set_frequency_text",params:{qsoID:editing.qsoID,value}})}/>
    {editing.frequencyError&&<p role="alert">{editing.frequencyError}</p>}<button disabled={disabled||sending} onClick={()=>void send({action:"log_edit_cancel",params:{qsoID:editing.qsoID}})}>Cancel</button>
    <button disabled={disabled||sending||!!editing.frequencyError} onClick={()=>void send({action:"log_edit_save",params:{qsoID:editing.qsoID,expectedSessionRevision:projection.sessionRevision}})}>Save</button></div>}
  <table><thead><tr><th>UTC</th><th>Call</th><th>Band</th><th>Mode</th><th>Exchange</th><th>Pts</th></tr></thead><tbody>{projection.page.rows.map((row:any)=><tr key={row.qsoID}>
    <td>{new Date(row.workedAt).toLocaleTimeString("en-GB",{timeZone:"UTC"})}</td><td><button disabled={disabled} onClick={()=>void send({action:"log_edit_begin",params:{qsoID:row.qsoID}})}>{row.callsign}</button></td>
    <td>{row.band}</td><td>{row.mode}</td><td>{row.receivedExchange}</td><td>{row.points}</td></tr>)}</tbody></table>
  <footer><button disabled={disabled||projection.page.offset===0} onClick={()=>void send({action:"log_page",params:{offset:Math.max(0,projection.page.offset-projection.page.limit)}})}>Previous</button>
    <span>{projection.page.total?`${projection.page.offset+1}–${projection.page.offset+projection.page.rows.length} of ${projection.page.total}`:"No contacts"}</span>
    <button disabled={disabled||projection.page.offset+projection.page.rows.length>=projection.page.total} onClick={()=>void send({action:"log_page",params:{offset:projection.page.offset+projection.page.limit}})}>Next</button></footer></section>; }

export function DetachedContestSurface() {
  const context = useMemo(() => contestSurfaceContextFromSearch(window.location.search), []);
  return <div className="app live contest-detached-surface"><Surface context={context}/></div>;
}

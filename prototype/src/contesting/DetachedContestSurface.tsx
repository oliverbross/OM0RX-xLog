import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
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
      const receipt = await submitContestSurfaceAction({ ...context, scope: "contesting", projectionRevision: snapshot.projectionRevision,
        requestID, ...action } as ContestSurfaceActionEnvelope);
      await refresh(); return receipt.status === "queued" || receipt.status === "applied";
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
      : snapshot.panelID === "callsign-intelligence" ? <Check projection={projection as Extract<typeof projection, { scp: unknown }>} disabled={projection.busy}
          projectionRevision={snapshot.projectionRevision} receipts={snapshot.receipts} send={send}/>
      : snapshot.panelID === "propagation" ? <Statistics projection={projection as Extract<typeof projection, { score: unknown }>}/>
      : snapshot.panelID === "logbook" ? <Log projection={projection as Extract<typeof projection, { page: unknown }>} disabled={projection.busy} sending={sending}
          projectionRevision={snapshot.projectionRevision} receipts={snapshot.receipts} send={send}/>
      : null}
  </main>;
}

type Send = (action: ContestSurfaceAction, requestID?: string) => Promise<boolean>;
type IntentInputProps = { label:string;value:string;identity:string;projectionRevision:number;receipts:ContestSurfaceTerminalReceipt[];
  disabled:boolean;maximumUTF8Bytes:number;send:Send;action:(value:string)=>ContestSurfaceAction;operatorField?:"callsign"|"exchange";inputRef?:RefObject<HTMLInputElement|null> };
function IntentInput({label,value:authoritative,identity,projectionRevision,receipts,disabled,maximumUTF8Bytes,send,action,operatorField,inputRef}:IntentInputProps){
  const [value,setValue]=useState(authoritative),[unresolved,setUnresolved]=useState(false),desired=useRef(authoritative),
    flight=useRef<null|{requestID:string;projectionRevision:number;value:string}>(null);
  const latest=useRef({projectionRevision,send,action});latest.current={projectionRevision,send,action};
  const pump=useCallback(()=>{if(flight.current||desired.current===authoritative)return;const requestID=crypto.randomUUID(),sentValue=desired.current;
    flight.current={requestID,projectionRevision:latest.current.projectionRevision,value:sentValue};
    setUnresolved(false);void latest.current.send(latest.current.action(sentValue),requestID).then(submitted=>{
      if(!submitted&&flight.current?.requestID===requestID)setUnresolved(true);
    });},[authoritative]);
  useEffect(()=>{desired.current=authoritative;flight.current=null;setUnresolved(false);setValue(authoritative);},[identity]);
  useEffect(()=>{const pending=flight.current;if(!pending){desired.current=authoritative;setValue(authoritative);return;}
    const receipt=receipts.find(item=>item.requestID===pending.requestID);if(!receipt)return;
    if(receipt.status==="uncertain"){setUnresolved(true);return;}
    if(receipt.status==="rejected"){flight.current=null;setUnresolved(false);desired.current=authoritative;setValue(authoritative);return;}
    if(receipt.status!=="applied"||projectionRevision<=pending.projectionRevision)return;
    flight.current=null;setUnresolved(false);if(desired.current===pending.value){desired.current=authoritative;setValue(authoritative);}else pump();
  },[authoritative,projectionRevision,receipts,pump]);
  const discard=()=>{flight.current=null;desired.current=authoritative;setUnresolved(false);setValue(authoritative);};
  const retry=()=>{flight.current=null;setUnresolved(false);queueMicrotask(pump);};
  return <div className="contest-surface-intent"><label>{label}<input ref={inputRef} data-contest-operator-field={operatorField} value={value} disabled={disabled} onChange={event=>{const next=event.target.value;
    if(new TextEncoder().encode(next).length>maximumUTF8Bytes)return;desired.current=next;setValue(next);pump();}}/></label>
    {unresolved&&<div role="status"><span>This edit is not confirmed.</span><button type="button" onClick={retry}>Apply edit again</button><button type="button" onClick={discard}>Use shared value</button></div>}</div>;
}
function Entry({ projection, disabled, sending, projectionRevision, receipts, send }: { projection: any; disabled: boolean; sending:boolean;
  projectionRevision:number;receipts:ContestSurfaceTerminalReceipt[];send:Send }) {
  const base = { draftID: projection.draft.draftID, expectedDraftRevision: projection.draft.revision };
  const callsignRef=useRef<HTMLInputElement>(null),exchangeRef=useRef<HTMLInputElement>(null);
  const operator=projection.schemaVersion===2?projection.operator:null;
  useEffect(()=>{if(operator?.focusedField==="callsign")callsignRef.current?.focus();else if(operator?.focusedField==="exchange")exchangeRef.current?.focus();},[operator?.focusedField]);
  const operatorKey=(key:string,focusedField:"callsign"|"exchange"|null)=>{if(!operator||!/^F(?:[1-9]|1[0-2])$|^Enter$|^Escape$/.test(key))return false;
    void send({action:"entry_operator_key",params:{...base,key:key as any,focusedField}});return true;};
  const onKeyDown=(event:ReactKeyboardEvent<HTMLElement>)=>{const target=event.target instanceof HTMLElement?event.target:null;
    const focusedField=(target?.dataset.contestOperatorField as "callsign"|"exchange"|undefined)??operator?.focusedField??null;
    if(operatorKey(event.key,focusedField)){event.preventDefault();event.stopPropagation();}};
  return <section className="contest-surface-entry" onKeyDown={onKeyDown}><header><div><h1>{projection.session.name}</h1><span>{projection.session.ruleName} · {projection.session.mode}</span></div>
    <strong>{projection.draft.band} · {projection.draft.mode}</strong></header>
    <IntentInput label="Callsign" value={projection.draft.callsign} identity={`${projection.draft.draftID}/callsign`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={32} send={send} operatorField="callsign" inputRef={callsignRef} action={value=>({action:"entry_set_text",params:{...base,field:"callsign",value}})}/>
    <div className="contest-surface-row"><IntentInput label="Sent" value={projection.draft.sentReport} identity={`${projection.draft.draftID}/sentReport`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={160} send={send} action={value=>({action:"entry_set_text",params:{...base,field:"sentReport",value}})}/>
      <IntentInput label="Received" value={projection.draft.receivedReport} identity={`${projection.draft.draftID}/receivedReport`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={160} send={send} action={value=>({action:"entry_set_text",params:{...base,field:"receivedReport",value}})}/>
      <IntentInput label="Frequency Hz" value={projection.draft.frequencyText} identity={`${projection.draft.draftID}/frequency`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={11} send={send} action={value=>({action:"entry_set_frequency_text",params:{...base,value}})}/></div>
    {projection.draft.receivedFields.map((field: any,index:number) => <IntentInput key={field.id} label={field.label} value={field.value} identity={`${projection.draft.draftID}/exchange/${field.id}`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={field.maximumUTF8Bytes} send={send} operatorField="exchange" inputRef={index===0?exchangeRef:undefined} action={value=>({action:"entry_set_exchange",params:{...base,fieldID:field.id,value}})}/>)}
    {projection.schemaVersion===2&&<><div className="contest-surface-row"><label>Band<select value={projection.draft.band} disabled={disabled}
      onChange={event=>void send({action:"entry_set_band",params:{...base,value:event.target.value}})}>{projection.descriptor.bands.map((band:string)=><option key={band}>{band}</option>)}</select></label>
      <label>Mode<select value={projection.draft.mode} disabled={disabled}
        onChange={event=>void send({action:"entry_set_mode",params:{...base,value:event.target.value}})}>{projection.descriptor.modes.map((mode:string)=><option key={mode}>{mode}</option>)}</select></label></div>
      <dl>{projection.descriptor.sentFields.map((field:any)=><div key={field.id}><dt>{field.label}</dt><dd>{field.value||"—"}</dd></div>)}</dl>
      {projection.descriptor.serial.requirement==="requiredForCommit"&&<p>Serial: {projection.descriptor.serial.reservedSerial??"not reserved"}</p>}
      {operator&&<section aria-label="Run and S&P simulation"><label>Operating style<select value={operator.style} disabled={disabled||operator.pending!==null}
        onChange={event=>void send({action:"entry_operator_style",params:{...base,value:event.target.value as "run"|"search-and-pounce"}})}><option value="run">Run</option><option value="search-and-pounce">Search &amp; Pounce</option></select></label>
        <button type="button" aria-pressed={operator.armed} disabled={disabled||operator.pending!==null}
          onClick={()=>void send({action:"entry_operator_arm",params:{...base,armed:!operator.armed}})}>{operator.armed?"Disarm":"Arm simulation"}</button>
        <button type="button" disabled={!operator.armed} onClick={()=>operatorKey("Escape",operator.focusedField)}>Escape</button>
        <span>{operator.status}</span><div className="contest-surface-results">{operator.functionKeys.map((item:any)=><button type="button" key={item.key}
          disabled={disabled} onClick={()=>operatorKey(item.key,operator.focusedField)}>{item.key} {item.macro}</button>)}</div>
        <ol>{operator.trace.map((item:any)=><li key={item.operationID}><span>{item.mode} · {item.macro}</span> <strong>{item.text}</strong> <small>{item.status}</small></li>)}</ol>
      </section>}</>}
    {projection.draft.frequencyError && <p role="alert">{projection.draft.frequencyError}</p>}
    {[...projection.draft.validation.errors,...projection.draft.validation.warnings].map((item:string) => <p key={item}>{item}</p>)}
    <footer><button disabled={disabled||sending} onClick={() => void send({action:"entry_reserve_serial",params:base})}>Reserve serial</button>
      <button disabled={disabled||sending || projection.draft.validation.errors.length > 0 || projection.draft.dupe.state === "duplicate"}
        onClick={() => void send({action:"entry_commit",params:base})}>Log QSO</button></footer></section>;
}
function Check({ projection, disabled, projectionRevision, receipts, send }: { projection: any; disabled: boolean;
  projectionRevision:number;receipts:ContestSurfaceTerminalReceipt[];send: Send }) {
  const base={draftID:projection.draftID,expectedDraftRevision:projection.draftRevision};
  return <section><h1>Check Partial & history</h1><IntentInput label="Callsign query" value={projection.inputCallsign}
    identity={`${projection.draftID}/query`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled}
    maximumUTF8Bytes={32} send={send} action={inputCallsign=>({action:"assistance_query",params:{...base,inputCallsign}})}/>
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
    <div className="contest-surface-row"><IntentInput label="Sent report" value={editing.sentReport} identity={`${editing.qsoID}/sentReport`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={160} send={send} action={value=>({action:"log_edit_set_text",params:{qsoID:editing.qsoID,field:"sentReport",value}})}/>
      <IntentInput label="Received report" value={editing.receivedReport} identity={`${editing.qsoID}/receivedReport`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={160} send={send} action={value=>({action:"log_edit_set_text",params:{qsoID:editing.qsoID,field:"receivedReport",value}})}/></div>
    {editing.receivedFields.map((field:any)=><IntentInput key={field.id} label={field.label} value={field.value} identity={`${editing.qsoID}/exchange/${field.id}`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={field.maximumUTF8Bytes} send={send} action={value=>({action:"log_edit_set_exchange",params:{qsoID:editing.qsoID,fieldID:field.id,value}})}/>)}
    <div className="contest-surface-row"><IntentInput label="Frequency Hz" value={editing.editFrequencyText} identity={`${editing.qsoID}/frequency`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={11} send={send} action={value=>({action:"log_edit_set_frequency_text",params:{qsoID:editing.qsoID,value}})}/>
      <IntentInput label="Band" value={editing.band} identity={`${editing.qsoID}/band`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={16} send={send} action={value=>({action:"log_edit_set_band",params:{qsoID:editing.qsoID,value}})}/></div>
    <IntentInput label="Correction note" value={editing.correctionReason} identity={`${editing.qsoID}/correctionReason`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={1024} send={send} action={value=>({action:"log_edit_set_text",params:{qsoID:editing.qsoID,field:"correctionReason",value}})}/>
    {editing.frequencyError&&<p role="alert">{editing.frequencyError}</p>}<div className="contest-surface-editor-actions"><button disabled={disabled||sending} onClick={()=>void send({action:"log_edit_cancel",params:{qsoID:editing.qsoID}})}>Cancel</button>
    <button disabled={disabled||sending||!!editing.frequencyError||!editing.correctionReason.trim()} onClick={()=>void send({action:"log_edit_save",params:{qsoID:editing.qsoID,expectedSessionRevision:projection.sessionRevision}})}>Save</button>
    <button disabled={disabled||sending} aria-pressed={editing.confirmDelete} onClick={()=>void send({action:"log_edit_confirm_delete",params:{qsoID:editing.qsoID,confirmed:!editing.confirmDelete}})}>{editing.confirmDelete?"Keep contact":"Delete…"}</button></div>
    {editing.confirmDelete&&<div className="contest-surface-delete"><IntentInput label="Deletion reason" value={editing.deletionReason} identity={`${editing.qsoID}/deletionReason`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={1024} send={send} action={value=>({action:"log_edit_set_text",params:{qsoID:editing.qsoID,field:"deletionReason",value}})}/>
      <button disabled={disabled||sending||!editing.deletionReason.trim()} onClick={()=>void send({action:"log_edit_delete",params:{qsoID:editing.qsoID,expectedSessionRevision:projection.sessionRevision}})}>Delete contact</button></div>}</div>}
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

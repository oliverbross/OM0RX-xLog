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
    try { const value = await readContestSurfaceSnapshot(context); if (mounted.current && current === ticket.current) { setSnapshot(value); setError(""); } return value; }
    catch (cause) { if (mounted.current && current === ticket.current) setError(message(cause)); return null; }
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
  const snapshotRef=useRef(snapshot),queueRef=useRef<Promise<void>>(Promise.resolve()),pendingCount=useRef(0);
  const receiptWaiters=useRef(new Map<string,{resolve:(receipt:ContestSurfaceTerminalReceipt|null)=>void;timer:number}>());
  snapshotRef.current=snapshot;
  useEffect(()=>{for(const receipt of snapshot?.receipts??[]){if(receipt.status!=="applied"&&receipt.status!=="rejected")continue;
    const waiter=receiptWaiters.current.get(receipt.requestID);if(!waiter)continue;
    window.clearTimeout(waiter.timer);receiptWaiters.current.delete(receipt.requestID);waiter.resolve(receipt);}},[snapshot]);
  useEffect(()=>()=>{for(const waiter of receiptWaiters.current.values()){window.clearTimeout(waiter.timer);waiter.resolve(null);}receiptWaiters.current.clear();},[]);
  const latest = snapshot?.receipts.at(-1);
  const send = useCallback((action: ContestSurfaceAction, requestedProjectionRevision:number,
      options:{requestID?:string;safePresentation?:boolean;bypassQueue?:boolean}={}) => {
    const requestID=options.requestID??crypto.randomUUID();
    const execute=async()=>{
      pendingCount.current+=1;setSending(true);setActionError("");
      try {
        let currentAction=action,projectionRevision=requestedProjectionRevision;
        if(options.safePresentation){const current=await refresh();
          if(!current||current.panelID!==context.panelID||current.projection.status!=="ready")return false;
          const params=action.params as Record<string,unknown>;
          projectionRevision=current.projectionRevision;
          if(typeof params.draftID==="string"){
          const projection=current.projection as any,draftRevision=projection.draft?.draftID===params.draftID?projection.draft.revision:
            projection.draftID===params.draftID?projection.draftRevision:null;
          if(!Number.isSafeInteger(draftRevision))return false;
          currentAction={...action,params:{...params,expectedDraftRevision:draftRevision}} as ContestSurfaceAction;
          }else if(typeof params.qsoID==="string"&&(current.projection as any).editing?.qsoID!==params.qsoID)return false;
        }else{const current=await refresh();if(!current||current.panelID!==context.panelID||current.projection.status!=="ready")return false;
          if(current.projectionRevision!==requestedProjectionRevision){setActionError("The shared contest panel changed before this action could be applied.");return false;}}
        const immediate=await submitContestSurfaceAction({...context,scope:"contesting",projectionRevision,
          requestID,...currentAction} as ContestSurfaceActionEnvelope);
        if(immediate.status==="applied")return true;
        if(immediate.status==="rejected")return false;
        const existing=snapshotRef.current?.receipts.find(item=>item.requestID===requestID&&
          (item.status==="applied"||item.status==="rejected"));
        const terminal=existing??await new Promise<ContestSurfaceTerminalReceipt|null>(resolve=>{
          const timer=window.setTimeout(()=>{receiptWaiters.current.delete(requestID);resolve(null);},20_000);
          receiptWaiters.current.set(requestID,{resolve,timer});
        });
        if(!terminal)setActionError("The action outcome is still unresolved. Refresh before continuing.");
        return terminal?.status==="applied";
      }catch(cause){setActionError(message(cause));await refresh();return false;}
      finally{pendingCount.current-=1;if(pendingCount.current===0)setSending(false);}
    };
    if(options.bypassQueue)return execute();
    const operation=queueRef.current.then(execute);
    queueRef.current=operation.then(()=>{},()=>{});return operation;
  },[context,refresh]);
  if (!snapshot) return <main aria-label="Contest panel"><p role="status">Loading shared contest panel…</p>{error && <p role="alert">{error}</p>}</main>;
  const projection = snapshot.projection;
  return <main aria-label={`Contest ${context.panelID}`}>
    {error && <p className="contest-surface-error" role="alert">{error}</p>}
    {actionError && <p className="contest-surface-error" role="alert">{actionError}</p>}
    {latest?.status === "uncertain" && <p className="contest-surface-warning" role="status">Action outcome is uncertain. Refresh before deciding what to do next.</p>}
    {latest?.status === "rejected" && <p className="contest-surface-error" role="status">{latest.message || "The main contest controller rejected this action."}</p>}
    {projection.status === "unavailable" ? <section className="contest-surface-unavailable"><h1>Panel unavailable</h1><p>This shared contest panel is not connected yet.</p></section>
      : snapshot.panelID === "active-qso" ? <Entry projection={projection as Extract<typeof projection, { draft: unknown }>} disabled={projection.busy} sending={sending}
          projectionRevision={snapshot.projectionRevision} send={send} refresh={refresh} settle={()=>queueRef.current}/>
      : snapshot.panelID === "callsign-intelligence" ? <Check projection={projection as Extract<typeof projection, { scp: unknown }>} disabled={projection.busy}
          projectionRevision={snapshot.projectionRevision} receipts={snapshot.receipts} send={send}/>
      : snapshot.panelID === "propagation" ? <Statistics projection={projection as Extract<typeof projection, { score: unknown }>}/>
      : snapshot.panelID === "logbook" ? <Log projection={projection as Extract<typeof projection, { page: unknown }>} disabled={projection.busy} sending={sending}
          projectionRevision={snapshot.projectionRevision} receipts={snapshot.receipts} send={send}/>
      : null}
  </main>;
}

type Send = (action: ContestSurfaceAction, projectionRevision:number,
  options?:{requestID?:string;safePresentation?:boolean;bypassQueue?:boolean}) => Promise<boolean>;
type IntentInputProps = { label:string;value:string;identity:string;projectionRevision:number;receipts:ContestSurfaceTerminalReceipt[];
  disabled:boolean;maximumUTF8Bytes:number;send:Send;action:(value:string)=>ContestSurfaceAction;operatorField?:"callsign"|"exchange";inputRef?:RefObject<HTMLInputElement|null> };
function IntentInput({label,value:authoritative,identity,projectionRevision,receipts,disabled,maximumUTF8Bytes,send,action,operatorField,inputRef}:IntentInputProps){
  const [value,setValue]=useState(authoritative),[unresolved,setUnresolved]=useState(false),desired=useRef(authoritative),
    flight=useRef<null|{requestID:string;projectionRevision:number;value:string}>(null);
  const latest=useRef({projectionRevision,send,action});latest.current={projectionRevision,send,action};
  const pump=useCallback(()=>{if(flight.current||desired.current===authoritative)return;const requestID=crypto.randomUUID(),sentValue=desired.current;
    flight.current={requestID,projectionRevision:latest.current.projectionRevision,value:sentValue};
    setUnresolved(false);void latest.current.send(latest.current.action(sentValue),latest.current.projectionRevision,
      {requestID,safePresentation:true}).then(submitted=>{
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

type EntryIntentKey = "callsign"|"sentReport"|"receivedReport"|"frequency"|`exchange:${string}`;
type EntryIntent = { value:string; action:(value:string)=>ContestSurfaceAction };
function useEntryIntents(projection:any,projectionRevision:number,send:Send){
  const authoritative=useMemo(()=>Object.fromEntries([
    ["callsign",projection.draft.callsign],["sentReport",projection.draft.sentReport],
    ["receivedReport",projection.draft.receivedReport],["frequency",projection.draft.frequencyText],
    ...projection.draft.receivedFields.map((field:any)=>[`exchange:${field.id}`,field.value]),
  ]) as Record<EntryIntentKey,string>,[projection.draft.callsign,projection.draft.sentReport,projection.draft.receivedReport,
    projection.draft.frequencyText,projection.draft.receivedFields]);
  const [values,setValues]=useState(authoritative),[unresolved,setUnresolved]=useState<Set<EntryIntentKey>>(new Set());
  const identity=projection.draft.draftID,identityRef=useRef(identity),authoritativeRef=useRef(authoritative),valuesRef=useRef(values),
    dirty=useRef(new Map<EntryIntentKey,EntryIntent>()),inFlight=useRef(new Set<EntryIntentKey>()),running=useRef<Promise<boolean>|null>(null),generation=useRef(0);
  authoritativeRef.current=authoritative;valuesRef.current=values;
  useEffect(()=>{if(identityRef.current===identity)return;identityRef.current=identity;generation.current+=1;dirty.current.clear();inFlight.current.clear();running.current=null;
    valuesRef.current=authoritative;setValues(authoritative);setUnresolved(new Set());},[authoritative,identity]);
  useEffect(()=>{setValues(previous=>{let changed=false;const next={...previous};for(const [key,value] of Object.entries(authoritative) as [EntryIntentKey,string][])
      if(!dirty.current.has(key)&&!inFlight.current.has(key)&&next[key]!==value){next[key]=value;changed=true;}return changed?next:previous;});},[authoritative]);
  const flush=useCallback(async():Promise<boolean>=>{
    if(running.current)return running.current;
    const runGeneration=generation.current,operation=(async()=>{while(runGeneration===generation.current&&dirty.current.size){const [key,intent]=dirty.current.entries().next().value as [EntryIntentKey,EntryIntent];
      dirty.current.delete(key);inFlight.current.add(key);setUnresolved(previous=>{const next=new Set(previous);next.delete(key);return next;});
      const ok=await send(intent.action(intent.value),projectionRevision,{safePresentation:true});inFlight.current.delete(key);
      if(runGeneration!==generation.current)return false;
      if(!ok){if(!dirty.current.has(key))dirty.current.set(key,intent);setUnresolved(previous=>new Set(previous).add(key));return false;}
    }return true;})();running.current=operation;try{return await operation;}finally{if(running.current===operation)running.current=null;}} ,
    [projectionRevision,send]);
  const change=useCallback((key:EntryIntentKey,value:string,action:(value:string)=>ContestSurfaceAction)=>{
    valuesRef.current={...valuesRef.current,[key]:value};setValues(valuesRef.current);dirty.current.set(key,{value,action});
    queueMicrotask(()=>void flush());},[flush]);
  const discard=useCallback((key:EntryIntentKey)=>{dirty.current.delete(key);valuesRef.current={...valuesRef.current,[key]:authoritativeRef.current[key]};
    setValues(valuesRef.current);setUnresolved(previous=>{const next=new Set(previous);next.delete(key);return next;});},[]);
  const retry=useCallback((key:EntryIntentKey)=>{setUnresolved(previous=>{const next=new Set(previous);next.delete(key);return next;});void flush();},[flush]);
  return {values,unresolved,change,flush,discard,retry};
}
function EntryIntentInput({label,intentKey,value,maximumUTF8Bytes,disabled,operatorField,inputRef,onChange,unresolved,retry,discard}:{
  label:string;intentKey:EntryIntentKey;value:string;maximumUTF8Bytes:number;disabled:boolean;operatorField?:"callsign"|"exchange";
  inputRef?:RefObject<HTMLInputElement|null>;onChange:(key:EntryIntentKey,value:string)=>void;unresolved:boolean;retry:()=>void;discard:()=>void}){
  return <div className="contest-surface-intent"><label>{label}<input ref={inputRef} data-contest-operator-field={operatorField}
    value={value} disabled={disabled} onChange={event=>{const next=event.target.value;if(new TextEncoder().encode(next).length<=maximumUTF8Bytes)
      onChange(intentKey,next);}}/></label>{unresolved&&<div role="status"><span>This edit is not confirmed.</span>
      <button type="button" onClick={retry}>Apply edit again</button><button type="button" onClick={discard}>Use shared value</button></div>}</div>;
}
function Entry({ projection, disabled, sending, projectionRevision, send, refresh, settle }: { projection: any; disabled: boolean; sending:boolean;
  projectionRevision:number;send:Send;refresh:()=>Promise<ContestSurfaceSnapshot|null>;
  settle:()=>Promise<void> }) {
  const base = { draftID: projection.draft.draftID, expectedDraftRevision: projection.draft.revision };
  const callsignRef=useRef<HTMLInputElement>(null),exchangeRef=useRef<HTMLInputElement>(null);
  const operator=projection.schemaVersion===2?projection.operator:null;
  const intents=useEntryIntents(projection,projectionRevision,send);
  const actionFor=(key:EntryIntentKey)=>(value:string):ContestSurfaceAction=>key==="callsign"||key==="sentReport"||key==="receivedReport"
    ?{action:"entry_set_text",params:{...base,field:key,value}}
    :key==="frequency"?{action:"entry_set_frequency_text",params:{...base,value}}
    :{action:"entry_set_exchange",params:{...base,fieldID:key.slice("exchange:".length),value}};
  useEffect(()=>{if(operator?.focusedField==="callsign")callsignRef.current?.focus();else if(operator?.focusedField==="exchange")exchangeRef.current?.focus();},[operator?.focusedField]);
  const operatorKey=(key:string,focusedField:"callsign"|"exchange"|null)=>{if(!operator||!/^F(?:[1-9]|1[0-2])$|^Enter$|^Escape$/.test(key))return false;
    void (async()=>{if(key!=="Escape"){if(!await intents.flush())return;await settle();}const current=await refresh();const currentProjection=current?.projection as any;
      if(!current||current.panelID!=="active-qso"||currentProjection?.status!=="ready"||currentProjection.draft?.draftID!==base.draftID)return;
      await send({action:"entry_operator_key",params:{draftID:base.draftID,expectedDraftRevision:currentProjection.draft.revision,
        key:key as any,focusedField}},current.projectionRevision,{bypassQueue:key==="Escape"});})();return true;};
  const onKeyDown=(event:ReactKeyboardEvent<HTMLElement>)=>{const target=event.target instanceof HTMLElement?event.target:null;
    const focusedField=(target?.dataset.contestOperatorField as "callsign"|"exchange"|undefined)??operator?.focusedField??null;
    if(operatorKey(event.key,focusedField)){event.preventDefault();event.stopPropagation();}};
  return <section className="contest-surface-entry" onKeyDown={onKeyDown}><header><div><h1>{projection.session.name}</h1><span>{projection.session.ruleName} · {projection.session.mode}</span></div>
    <strong>{projection.draft.band} · {projection.draft.mode}</strong></header>
    <EntryIntentInput label="Callsign" intentKey="callsign" value={intents.values.callsign} maximumUTF8Bytes={32} disabled={disabled}
      operatorField="callsign" inputRef={callsignRef} onChange={(key,value)=>intents.change(key,value,actionFor(key))}
      unresolved={intents.unresolved.has("callsign")} retry={()=>intents.retry("callsign")} discard={()=>intents.discard("callsign")}/>
    <div className="contest-surface-row">{(["sentReport","receivedReport","frequency"] as EntryIntentKey[]).map((key,index)=><EntryIntentInput key={key}
      label={["Sent","Received","Frequency Hz"][index]} intentKey={key} value={intents.values[key]} maximumUTF8Bytes={key==="frequency"?11:160}
      disabled={disabled} onChange={(changed,value)=>intents.change(changed,value,actionFor(changed))} unresolved={intents.unresolved.has(key)}
      retry={()=>intents.retry(key)} discard={()=>intents.discard(key)}/>)}</div>
    {projection.draft.receivedFields.map((field: any,index:number) => {const key=`exchange:${field.id}` as EntryIntentKey;return <EntryIntentInput key={field.id}
      label={field.label} intentKey={key} value={intents.values[key]} maximumUTF8Bytes={field.maximumUTF8Bytes} disabled={disabled}
      operatorField="exchange" inputRef={index===0?exchangeRef:undefined} onChange={(changed,value)=>intents.change(changed,value,actionFor(changed))}
      unresolved={intents.unresolved.has(key)} retry={()=>intents.retry(key)} discard={()=>intents.discard(key)}/>;})}
    {projection.schemaVersion===2&&<><div className="contest-surface-row"><label>Band<select value={projection.draft.band} disabled={disabled}
      onChange={event=>void send({action:"entry_set_band",params:{...base,value:event.target.value}},projectionRevision,{safePresentation:true})}>{projection.descriptor.bands.map((band:string)=><option key={band}>{band}</option>)}</select></label>
      <label>Mode<select value={projection.draft.mode} disabled={disabled}
        onChange={event=>void send({action:"entry_set_mode",params:{...base,value:event.target.value}},projectionRevision,{safePresentation:true})}>{projection.descriptor.modes.map((mode:string)=><option key={mode}>{mode}</option>)}</select></label></div>
      <dl>{projection.descriptor.sentFields.map((field:any)=><div key={field.id}><dt>{field.label}</dt><dd>{field.value||"—"}</dd></div>)}</dl>
      {projection.descriptor.serial.requirement==="requiredForCommit"&&<p>Serial: {projection.descriptor.serial.reservedSerial??"not reserved"}</p>}
      {operator&&<section aria-label="Run and S&P simulation"><label>Operating style<select value={operator.style} disabled={disabled||operator.pending!==null}
        onChange={event=>void send({action:"entry_operator_style",params:{...base,value:event.target.value as "run"|"search-and-pounce"}},projectionRevision)}><option value="run">Run</option><option value="search-and-pounce">Search &amp; Pounce</option></select></label>
        <button type="button" aria-pressed={operator.armed} disabled={disabled||operator.pending!==null}
          onClick={()=>void send({action:"entry_operator_arm",params:{...base,armed:!operator.armed}},projectionRevision)}>{operator.armed?"Disarm":"Arm simulation"}</button>
        <button type="button" disabled={!operator.armed} onClick={()=>operatorKey("Escape",operator.focusedField)}>Escape</button>
        <span>{operator.status}</span><div className="contest-surface-results">{operator.functionKeys.map((item:any)=><button type="button" key={item.key}
          disabled={disabled} onClick={()=>operatorKey(item.key,operator.focusedField)}>{item.key} {item.macro}</button>)}</div>
        <ol>{operator.trace.map((item:any)=><li key={item.operationID}><span>{item.mode} · {item.macro}</span> <strong>{item.text}</strong> <small>{item.status}</small></li>)}</ol>
      </section>}</>}
    {projection.draft.frequencyError && <p role="alert">{projection.draft.frequencyError}</p>}
    {[...projection.draft.validation.errors,...projection.draft.validation.warnings].map((item:string) => <p key={item}>{item}</p>)}
    <footer><button disabled={disabled||sending} onClick={() => void send({action:"entry_reserve_serial",params:base},projectionRevision)}>Reserve serial</button>
      <button disabled={disabled||sending || projection.draft.validation.errors.length > 0 || projection.draft.dupe.state === "duplicate"}
        onClick={() => void send({action:"entry_commit",params:base},projectionRevision)}>Log QSO</button></footer></section>;
}
function Check({ projection, disabled, projectionRevision, receipts, send }: { projection: any; disabled: boolean;
  projectionRevision:number;receipts:ContestSurfaceTerminalReceipt[];send: Send }) {
  const base={draftID:projection.draftID,expectedDraftRevision:projection.draftRevision};
  return <section><h1>Check Partial & history</h1><IntentInput label="Callsign query" value={projection.inputCallsign}
    identity={`${projection.draftID}/query`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled}
    maximumUTF8Bytes={32} send={send} action={inputCallsign=>({action:"assistance_query",params:{...base,inputCallsign}})}/>
    <h2>SCP</h2><div className="contest-surface-results">{projection.scp.candidates.map((item:any)=><button key={item.candidateID} disabled={disabled}
      onClick={()=>void send({action:"assistance_select",params:{...base,kind:"scp",candidateID:item.candidateID}},projectionRevision)}>{item.callsign}</button>)}</div>
    <h2>History</h2>{projection.history.rows.map((row:any)=><button className="contest-surface-history" key={row.candidateID} disabled={disabled}
      onClick={()=>void send({action:"assistance_select",params:{...base,kind:"history",candidateID:row.candidateID}},projectionRevision)}><strong>{row.callsign}</strong>
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
    {editing.frequencyError&&<p role="alert">{editing.frequencyError}</p>}<div className="contest-surface-editor-actions"><button disabled={disabled||sending} onClick={()=>void send({action:"log_edit_cancel",params:{qsoID:editing.qsoID}},projectionRevision)}>Cancel</button>
    <button disabled={disabled||sending||!!editing.frequencyError||!editing.correctionReason.trim()} onClick={()=>void send({action:"log_edit_save",params:{qsoID:editing.qsoID,expectedSessionRevision:projection.sessionRevision}},projectionRevision)}>Save</button>
    <button disabled={disabled||sending} aria-pressed={editing.confirmDelete} onClick={()=>void send({action:"log_edit_confirm_delete",params:{qsoID:editing.qsoID,confirmed:!editing.confirmDelete}},projectionRevision)}>{editing.confirmDelete?"Keep contact":"Delete…"}</button></div>
    {editing.confirmDelete&&<div className="contest-surface-delete"><IntentInput label="Deletion reason" value={editing.deletionReason} identity={`${editing.qsoID}/deletionReason`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={1024} send={send} action={value=>({action:"log_edit_set_text",params:{qsoID:editing.qsoID,field:"deletionReason",value}})}/>
      <button disabled={disabled||sending||!editing.deletionReason.trim()} onClick={()=>void send({action:"log_edit_delete",params:{qsoID:editing.qsoID,expectedSessionRevision:projection.sessionRevision}},projectionRevision)}>Delete contact</button></div>}</div>}
  <table><thead><tr><th>UTC</th><th>Call</th><th>Band</th><th>Mode</th><th>Exchange</th><th>Pts</th></tr></thead><tbody>{projection.page.rows.map((row:any)=><tr key={row.qsoID}>
    <td>{new Date(row.workedAt).toLocaleTimeString("en-GB",{timeZone:"UTC"})}</td><td><button disabled={disabled} onClick={()=>void send({action:"log_edit_begin",params:{qsoID:row.qsoID}},projectionRevision)}>{row.callsign}</button></td>
    <td>{row.band}</td><td>{row.mode}</td><td>{row.receivedExchange}</td><td>{row.points}</td></tr>)}</tbody></table>
  <footer><button disabled={disabled||projection.page.offset===0} onClick={()=>void send({action:"log_page",params:{offset:Math.max(0,projection.page.offset-projection.page.limit)}},projectionRevision)}>Previous</button>
    <span>{projection.page.total?`${projection.page.offset+1}–${projection.page.offset+projection.page.rows.length} of ${projection.page.total}`:"No contacts"}</span>
    <button disabled={disabled||projection.page.offset+projection.page.rows.length>=projection.page.total} onClick={()=>void send({action:"log_page",params:{offset:projection.page.offset+projection.page.limit}},projectionRevision)}>Next</button></footer></section>; }

export function DetachedContestSurface() {
  const context = useMemo(() => contestSurfaceContextFromSearch(window.location.search), []);
  return <div className="app live contest-detached-surface"><Surface context={context}/></div>;
}

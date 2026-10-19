import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { contestSurfaceContextFromSearch, onContestSurfaceWake, readContestSurfaceSnapshot, submitContestSurfaceAction,
  type ContestSurfaceContext, type ContestSurfaceSnapshot, type ContestSurfaceTerminalReceipt } from "./contestSurfaceNative";
import type { ContestSurfaceAction, ContestSurfaceActionEnvelope, ContestRatesSurfaceProjection, ContestMatrixSurfaceProjection } from "./contestSurfaceProtocol";
import { ContestTextField, ContestCandidates, ContestScoreSummary, ContestLogTable } from "./ContestPresentation";
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
          if(!current||current.panelID!==context.panelID||current.projection.status!=="ready")return {applied:false,projectionRevision:null};
          const params=action.params as Record<string,unknown>;
          projectionRevision=current.projectionRevision;
          if(typeof params.draftID==="string"){
          const projection=current.projection as any,draftRevision=projection.draft?.draftID===params.draftID?projection.draft.revision:
            projection.draftID===params.draftID?projection.draftRevision:null;
          if(!Number.isSafeInteger(draftRevision))return {applied:false,projectionRevision:null};
          currentAction={...action,params:{...params,expectedDraftRevision:draftRevision}} as ContestSurfaceAction;
          }else if(typeof params.qsoID==="string"&&(current.projection as any).editing?.qsoID!==params.qsoID)return {applied:false,projectionRevision:null};
        }else{const current=await refresh();if(!current||current.panelID!==context.panelID||current.projection.status!=="ready")return {applied:false,projectionRevision:null};
          const params=action.params as Record<string,unknown>,escape=action.action==="entry_operator_key"&&params.key==="Escape";
          if(escape){const draft=(current.projection as any).draft;if(draft?.draftID!==params.draftID||
              !Number.isSafeInteger(params.expectedDraftRevision)||params.expectedDraftRevision as number>draft.revision||
              requestedProjectionRevision>current.projectionRevision){setActionError("The shared contest entry no longer owns this Escape action.");return {applied:false,projectionRevision:null};}}
          else if(current.projectionRevision!==requestedProjectionRevision){setActionError("The shared contest panel changed before this action could be applied.");return {applied:false,projectionRevision:null};}}
        const immediate=await submitContestSurfaceAction({...context,scope:"contesting",projectionRevision,
          requestID,...currentAction} as ContestSurfaceActionEnvelope);
        if(immediate.status==="applied"){const current=await refresh();return {applied:true,projectionRevision:current?.projectionRevision??projectionRevision};}
        if(immediate.status==="rejected")return {applied:false,projectionRevision:null};
        const existing=snapshotRef.current?.receipts.find(item=>item.requestID===requestID&&
          (item.status==="applied"||item.status==="rejected"));
        const terminal=existing??await new Promise<ContestSurfaceTerminalReceipt|null>(resolve=>{
          const timer=window.setTimeout(()=>{receiptWaiters.current.delete(requestID);resolve(null);},20_000);
          receiptWaiters.current.set(requestID,{resolve,timer});
        });
        if(!terminal)setActionError("The action outcome is still unresolved. Refresh before continuing.");
        return {applied:terminal?.status==="applied",projectionRevision:terminal?.status==="applied"?terminal.projectionRevision:null};
      }catch(cause){setActionError(message(cause));await refresh();return {applied:false,projectionRevision:null};}
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
          projectionRevision={snapshot.projectionRevision} send={send} refresh={refresh} settle={()=>queueRef.current} reportConflict={setActionError}/>
      : snapshot.panelID === "callsign-intelligence" ? <Check projection={projection as Extract<typeof projection, { scp: unknown }>} disabled={projection.busy}
          projectionRevision={snapshot.projectionRevision} receipts={snapshot.receipts} send={send}/>
      : snapshot.panelID === "propagation" ? <Statistics projection={projection as Extract<typeof projection, { score: unknown }>}/>
      : snapshot.panelID === "monitor" ? <Rates projection={projection as ContestRatesSurfaceProjection}/>
      : snapshot.panelID === "awards" || snapshot.panelID === "chaser-dx" ? <Matrix projection={projection as ContestMatrixSurfaceProjection}/>
      : snapshot.panelID === "logbook" ? <Log projection={projection as Extract<typeof projection, { page: unknown }>} disabled={projection.busy} sending={sending}
          projectionRevision={snapshot.projectionRevision} receipts={snapshot.receipts} send={send}/>
      : null}
  </main>;
}

type SendResult={applied:boolean;projectionRevision:number|null};
type Send = (action: ContestSurfaceAction, projectionRevision:number,
  options?:{requestID?:string;safePresentation?:boolean;bypassQueue?:boolean}) => Promise<SendResult>;
type IntentInputProps = { label:string;value:string;identity:string;projectionRevision:number;receipts:ContestSurfaceTerminalReceipt[];
  disabled:boolean;maximumUTF8Bytes:number;send:Send;action:(value:string)=>ContestSurfaceAction;operatorField?:"callsign"|"exchange";inputRef?:RefObject<HTMLInputElement|null> };
function IntentInput({label,value:authoritative,identity,projectionRevision,receipts,disabled,maximumUTF8Bytes,send,action,operatorField,inputRef}:IntentInputProps){
  const [value,setValue]=useState(authoritative),[unresolved,setUnresolved]=useState(false),desired=useRef(authoritative),
    flight=useRef<null|{requestID:string;projectionRevision:number;value:string}>(null);
  const latest=useRef({projectionRevision,send,action});latest.current={projectionRevision,send,action};
  const pump=useCallback(()=>{if(flight.current||desired.current===authoritative)return;const requestID=crypto.randomUUID(),sentValue=desired.current;
    flight.current={requestID,projectionRevision:latest.current.projectionRevision,value:sentValue};
    setUnresolved(false);void latest.current.send(latest.current.action(sentValue),latest.current.projectionRevision,
      {requestID,safePresentation:true}).then(result=>{
      if(!result.applied&&flight.current?.requestID===requestID)setUnresolved(true);
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
  return <div className="contest-surface-intent"><ContestTextField label={label} inputRef={inputRef} data-contest-operator-field={operatorField} value={value} disabled={disabled} onChange={event=>{const next=event.target.value;
    if(new TextEncoder().encode(next).length>maximumUTF8Bytes)return;desired.current=next;setValue(next);pump();}}/>
    {unresolved&&<div role="status"><span>This edit is not confirmed.</span><button type="button" onClick={retry}>Apply edit again</button><button type="button" onClick={discard}>Use shared value</button></div>}</div>;
}

type EntryIntentKey = "callsign"|"sentReport"|"receivedReport"|"frequency"|`exchange:${string}`;
type EntryIntent = { value:string; action:(value:string)=>ContestSurfaceAction };
type EntryFlushResult = { ok:boolean;lastAppliedProjectionRevision:number|null };
function useEntryIntents(projection:any,projectionRevision:number,send:Send){
  const authoritative=useMemo(()=>Object.fromEntries([
    ["callsign",projection.draft.callsign],["sentReport",projection.draft.sentReport],
    ["receivedReport",projection.draft.receivedReport],["frequency",projection.draft.frequencyText],
    ...projection.draft.receivedFields.map((field:any)=>[`exchange:${field.id}`,field.value]),
  ]) as Record<EntryIntentKey,string>,[projection.draft.callsign,projection.draft.sentReport,projection.draft.receivedReport,
    projection.draft.frequencyText,projection.draft.receivedFields]);
  const [values,setValues]=useState(authoritative),[unresolved,setUnresolved]=useState<Set<EntryIntentKey>>(new Set());
  const identity=projection.draft.draftID,identityRef=useRef(identity),authoritativeRef=useRef(authoritative),valuesRef=useRef(values),
    dirty=useRef(new Map<EntryIntentKey,EntryIntent>()),inFlight=useRef(new Set<EntryIntentKey>()),running=useRef<Promise<EntryFlushResult>|null>(null),generation=useRef(0);
  authoritativeRef.current=authoritative;valuesRef.current=values;
  useEffect(()=>{if(identityRef.current===identity)return;identityRef.current=identity;generation.current+=1;dirty.current.clear();inFlight.current.clear();running.current=null;
    valuesRef.current=authoritative;setValues(authoritative);setUnresolved(new Set());},[authoritative,identity]);
  useEffect(()=>{setValues(previous=>{let changed=false;const next={...previous};for(const [key,value] of Object.entries(authoritative) as [EntryIntentKey,string][])
      if(!dirty.current.has(key)&&!inFlight.current.has(key)&&next[key]!==value){next[key]=value;changed=true;}return changed?next:previous;});},[authoritative]);
  const flush=useCallback(async():Promise<EntryFlushResult>=>{
    if(running.current)return running.current;
    const runGeneration=generation.current,operation=(async()=>{let lastAppliedProjectionRevision:number|null=null;while(runGeneration===generation.current&&dirty.current.size){const [key,intent]=dirty.current.entries().next().value as [EntryIntentKey,EntryIntent];
      dirty.current.delete(key);inFlight.current.add(key);setUnresolved(previous=>{const next=new Set(previous);next.delete(key);return next;});
      const result=await send(intent.action(intent.value),projectionRevision,{safePresentation:true});inFlight.current.delete(key);
      if(runGeneration!==generation.current)return {ok:false,lastAppliedProjectionRevision};
      if(!result.applied){if(!dirty.current.has(key))dirty.current.set(key,intent);setUnresolved(previous=>new Set(previous).add(key));return {ok:false,lastAppliedProjectionRevision};}
      lastAppliedProjectionRevision=result.projectionRevision;
    }return {ok:true,lastAppliedProjectionRevision};})();running.current=operation;try{return await operation;}finally{if(running.current===operation)running.current=null;}} ,
    [projectionRevision,send]);
  const change=useCallback((key:EntryIntentKey,value:string,action:(value:string)=>ContestSurfaceAction)=>{
    valuesRef.current={...valuesRef.current,[key]:value};setValues(valuesRef.current);dirty.current.set(key,{value,action});
    queueMicrotask(()=>void flush());},[flush]);
  const discard=useCallback((key:EntryIntentKey)=>{dirty.current.delete(key);valuesRef.current={...valuesRef.current,[key]:authoritativeRef.current[key]};
    setValues(valuesRef.current);setUnresolved(previous=>{const next=new Set(previous);next.delete(key);return next;});},[]);
  const retry=useCallback((key:EntryIntentKey)=>{setUnresolved(previous=>{const next=new Set(previous);next.delete(key);return next;});void flush();},[flush]);
  const capture=useCallback(()=>({...valuesRef.current}),[]);
  const matches=useCallback((draft:any,intended:Record<EntryIntentKey,string>)=>draft?.draftID===identityRef.current&&
    draft.callsign.trim().toUpperCase()===intended.callsign.trim().toUpperCase()&&draft.sentReport===intended.sentReport&&draft.receivedReport===intended.receivedReport&&
    draft.frequencyText===intended.frequency&&Array.isArray(draft.receivedFields)&&draft.receivedFields.length===projection.draft.receivedFields.length&&
    draft.receivedFields.every((field:any)=>intended[`exchange:${field.id}`]===field.value),[projection.draft.receivedFields.length]);
  return {values,unresolved,change,flush,discard,retry,capture,matches};
}
function EntryIntentInput({label,accessibleLabel,intentKey,value,maximumUTF8Bytes,disabled,operatorField,inputRef,onChange,unresolved,retry,discard}:{
  label:string;accessibleLabel?:string;intentKey:EntryIntentKey;value:string;maximumUTF8Bytes:number;disabled:boolean;operatorField?:"callsign"|"exchange";
  inputRef?:RefObject<HTMLInputElement|null>;onChange:(key:EntryIntentKey,value:string)=>void;unresolved:boolean;retry:()=>void;discard:()=>void}){
  return <div className="contest-surface-intent"><ContestTextField label={label} aria-label={accessibleLabel} inputRef={inputRef} data-contest-operator-field={operatorField}
    value={value} disabled={disabled} onChange={event=>{const next=event.target.value;if(new TextEncoder().encode(next).length<=maximumUTF8Bytes)
      onChange(intentKey,next);}}/>{unresolved&&<div role="status"><span>This edit is not confirmed.</span>
      <button type="button" onClick={retry}>Apply edit again</button><button type="button" onClick={discard}>Use shared value</button></div>}</div>;
}
function Entry({ projection, disabled, sending, projectionRevision, send, refresh, settle, reportConflict }: { projection: any; disabled: boolean; sending:boolean;
  projectionRevision:number;send:Send;refresh:()=>Promise<ContestSurfaceSnapshot|null>;
  settle:()=>Promise<void>;reportConflict:(message:string)=>void }) {
  const base = { draftID: projection.draft.draftID, expectedDraftRevision: projection.draft.revision };
  const callsignRef=useRef<HTMLInputElement>(null),exchangeRef=useRef<HTMLInputElement>(null);
  const operator=projection.schemaVersion===2?projection.operator:null;
  const displayedBands=projection.schemaVersion===2?projection.descriptor.bands:["160m","80m","40m","20m","15m","10m"];
  const intents=useEntryIntents(projection,projectionRevision,send);
  const actionFor=(key:EntryIntentKey)=>(value:string):ContestSurfaceAction=>key==="callsign"||key==="sentReport"||key==="receivedReport"
    ?{action:"entry_set_text",params:{...base,field:key,value}}
    :key==="frequency"?{action:"entry_set_frequency_text",params:{...base,value}}
    :{action:"entry_set_exchange",params:{...base,fieldID:key.slice("exchange:".length),value}};
  useEffect(()=>{if(operator?.focusedField==="callsign")callsignRef.current?.focus();else if(operator?.focusedField==="exchange")exchangeRef.current?.focus();},[operator?.focusedField]);
  const operatorKey=(key:string,focusedField:"callsign"|"exchange"|null)=>{if(!operator||!/^F(?:[1-9]|1[0-2])$|^Enter$|^Escape$/.test(key))return false;
    const intended=intents.capture(),intentContext={band:projection.draft.band,mode:projection.draft.mode,reservedSerial:projection.draft.reservedSerial,
      armed:operator.armed,style:operator.style};
    void (async()=>{let lastLocalProjectionRevision:number|null=null;if(key!=="Escape"){const flushed=await intents.flush();if(!flushed.ok)return;
      lastLocalProjectionRevision=flushed.lastAppliedProjectionRevision;await settle();}const current=await refresh();const currentProjection=current?.projection as any;
      if(!current||current.panelID!=="active-qso"||currentProjection?.status!=="ready"||currentProjection.draft?.draftID!==base.draftID)return;
      if(key!=="Escape"&&(!intents.matches(currentProjection.draft,intended)||
          current.projectionRevision!==(lastLocalProjectionRevision??projectionRevision)||currentProjection.draft.band!==intentContext.band||
          currentProjection.draft.mode!==intentContext.mode||currentProjection.draft.reservedSerial!==intentContext.reservedSerial||
          currentProjection.operator?.armed!==intentContext.armed||currentProjection.operator?.style!==intentContext.style)){
        reportConflict("The shared contest entry changed before this operator action. Review it and press the key again.");return;}
      await send({action:"entry_operator_key",params:{draftID:base.draftID,expectedDraftRevision:currentProjection.draft.revision,
        key:key as any,focusedField}},current.projectionRevision,{bypassQueue:key==="Escape"});})();return true;};
  const onKeyDown=(event:ReactKeyboardEvent<HTMLElement>)=>{const target=event.target instanceof HTMLElement?event.target:null;
    if(event.defaultPrevented||event.repeat||event.nativeEvent.isComposing||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
    const focusedField=(target?.dataset.contestOperatorField as "callsign"|"exchange"|undefined)??operator?.focusedField??null;
    if(operatorKey(event.key,focusedField)){event.preventDefault();event.stopPropagation();}};
  return <section className="contest-surface-entry" aria-label="Main Logging" onKeyDown={onKeyDown}><header>
    <div className="contest-surface-radio"><output aria-label="Current frequency">{projection.draft.frequencyHz == null ? "—" : (projection.draft.frequencyHz / 1_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<small> kHz</small></output>
      <strong>{projection.draft.mode}</strong></div><span aria-label={projection.manual?.operator?"Current operator":"Current operator unavailable"}>OP {projection.manual?.operator||"—"}</span><h1>{projection.session.name}</h1></header>
    <div className="contest-surface-logging-body"><aside className="contest-surface-band-ladder" aria-label="Current band and mode"><strong>{projection.draft.mode}</strong>{displayedBands.map((band:string)=><span key={band} aria-current={projection.draft.band===band?"true":undefined}>{band.replace("m","")}</span>)}</aside>
    <div className="contest-surface-logging-controls">
    <div className="contest-surface-main-fields">
    <EntryIntentInput label="Callsign" intentKey="callsign" value={intents.values.callsign} maximumUTF8Bytes={32} disabled={disabled}
      operatorField="callsign" inputRef={callsignRef} onChange={(key,value)=>intents.change(key,value,actionFor(key))}
      unresolved={intents.unresolved.has("callsign")} retry={()=>intents.retry("callsign")} discard={()=>intents.discard("callsign")}/>
    {projection.descriptor?.reportsVisible!==false&&(["sentReport","receivedReport"] as EntryIntentKey[]).map((key,index)=><EntryIntentInput key={key}
      label={["SNT","RCV"][index]} intentKey={key} value={intents.values[key]} maximumUTF8Bytes={160}
      disabled={disabled} onChange={(changed,value)=>intents.change(changed,value,actionFor(changed))} unresolved={intents.unresolved.has(key)}
      retry={()=>intents.retry(key)} discard={()=>intents.discard(key)}/>)}
    <div className="contest-surface-sent-number"><span>SentNR</span><output aria-label="Sent exchange">{projection.schemaVersion===2 ? projection.descriptor.sentFields.map((field:any)=>field.value||"—").join(" ")||"—" : "—"}</output></div>
    {projection.draft.receivedFields.length ? projection.draft.receivedFields.map((field:any,index:number)=>{const key=`exchange:${field.id}` as EntryIntentKey;return <EntryIntentInput key={field.id}
      label={projection.descriptor?.reportsVisible===false?field.label:projection.draft.receivedFields.length===1?"RcvNR":field.label} accessibleLabel={field.label} intentKey={key} value={intents.values[key]} maximumUTF8Bytes={field.maximumUTF8Bytes} disabled={disabled}
      operatorField="exchange" inputRef={index===0?exchangeRef:undefined} onChange={(changed,value)=>intents.change(changed,value,actionFor(changed))}
      unresolved={intents.unresolved.has(key)} retry={()=>intents.retry(key)} discard={()=>intents.discard(key)}/>;}) : <div className="contest-surface-sent-number"><span>RcvNR</span><output>—</output></div>}
    </div>
    <div className="contest-surface-run-strip"><span className="contest-surface-signal" aria-label="Transmit state unavailable"><span>●</span><span>●</span></span>
      <div role="group" aria-label="Run and S&P">{([['run','Run'],['search-and-pounce','S&P']] as const).map(([value,label])=><label key={value}><input type="radio" name="contest-operating-style" checked={operator?.style===value} disabled={!operator||disabled||operator.pending!==null}
        onChange={()=>void send({action:"entry_operator_style",params:{...base,value}},projectionRevision)}/>{label}</label>)}</div>
      <div className="contest-surface-speed" role="group" aria-label="CW speed"><output aria-label={projection.manual?.cwSpeedWpm==null?"CW speed unavailable":"Current CW speed"}>{projection.manual?.cwSpeedWpm??"—"}</output>
        <button disabled={disabled||projection.manual?.cwSpeedWpm==null||projection.manual.cwSpeedWpm<=5} aria-label="Decrease CW speed" onClick={()=>void send({action:"entry_set_cw_speed",params:{...base,value:projection.manual.cwSpeedWpm-1}},projectionRevision)}>−</button>
        <button disabled={disabled||projection.manual?.cwSpeedWpm==null||projection.manual.cwSpeedWpm>=100} aria-label="Increase CW speed" onClick={()=>void send({action:"entry_set_cw_speed",params:{...base,value:projection.manual.cwSpeedWpm+1}},projectionRevision)}>+</button></div></div>
    <div className="contest-surface-macros" role="group" aria-label="Function key macros">{Array.from({length:12},(_,index)=>{const key=`F${index+1}`,item=operator?.functionKeys.find((item:any)=>item.key===key),label=item?.macro??"Unassigned";return <button type="button" key={key}
      disabled={disabled||!item} aria-label={`${key} ${label}`} onClick={()=>operatorKey(key,operator?.focusedField??null)}><kbd>{key}:</kbd> <span>{label}</span></button>;})}</div>
    </div></div>
    <div className="contest-surface-contact-footer"><div aria-label="Contact heading, long path and distance">{projection.manual?.headingDegrees??"—"}° Hdg · LP {projection.manual?.longPathHeadingDegrees??"—"}° / distance {projection.manual?.distanceKm??"—"} km<br/><span aria-label="Country and zones">{projection.manual?.country??"—"} cq:{projection.manual?.cqZone??"—"} itu:{projection.manual?.ituZone??"—"}</span></div><output aria-label="QSOs, multipliers and score">{projection.manual?.qsos??"—"}/{projection.manual?.multipliers??"—"} <span>{projection.manual?.total??"—"}</span></output></div>
    <details className="contest-surface-entry-options"><summary>Entry controls</summary>
    {projection.schemaVersion===2&&<div className="contest-surface-row contest-surface-operating">
      <label>Band<select value={projection.draft.band} disabled={disabled}
        onChange={event=>void send({action:"entry_set_band",params:{...base,value:event.target.value}},projectionRevision,{safePresentation:true})}>{!projection.descriptor.bands.includes(projection.draft.band)&&<option hidden>{projection.draft.band}</option>}{projection.descriptor.bands.map((band:string)=><option key={band}>{band}</option>)}</select></label>
      <label>Mode<select value={projection.draft.mode} disabled={disabled}
        onChange={event=>void send({action:"entry_set_mode",params:{...base,value:event.target.value}},projectionRevision,{safePresentation:true})}>{projection.descriptor.modes.map((mode:string)=><option key={mode}>{mode}</option>)}</select></label>
    </div>}
    <EntryIntentInput label="Frequency Hz" intentKey="frequency" value={intents.values.frequency} maximumUTF8Bytes={11} disabled={disabled}
      onChange={(key,value)=>intents.change(key,value,actionFor(key))} unresolved={intents.unresolved.has("frequency")}
      retry={()=>intents.retry("frequency")} discard={()=>intents.discard("frequency")}/>
    {projection.schemaVersion===2&&<>
      {projection.descriptor.serial.requirement==="requiredForCommit"&&<p>Serial: {projection.descriptor.serial.reservedSerial??"not reserved"}</p>}
      {operator&&<section aria-label={operator.output==="xlog-native"?"Run and S&P CW controls":"Run and S&P simulation"}><div className="contest-surface-row">
        <button type="button" aria-pressed={operator.armed} disabled={disabled||operator.pending!==null}
          onClick={()=>void send({action:"entry_operator_arm",params:{...base,armed:!operator.armed}},projectionRevision)}>{operator.armed?"Disarm":operator.output==="xlog-native"?"Arm CW":"Arm simulation"}</button>
        <button type="button" disabled={!operator.armed} onClick={()=>operatorKey("Escape",operator.focusedField)}>Escape</button>
        <span role="status">{operator.output==="xlog-native"?"xLog CW":"Simulation"} · {operator.status}</span></div>
        {operator.trace.length>0&&<details className="contest-surface-trace"><summary>Simulation output</summary><ol>{operator.trace.map((item:any)=><li key={item.operationID}><span>{item.mode} · {item.macro}</span> <strong>{item.text}</strong> <small>{item.status}</small></li>)}</ol></details>}
      </section>}</>}
      <footer>{projection.schemaVersion===2&&projection.descriptor.serial.requirement!=="none"&&<button disabled={disabled||sending} onClick={() => void send({action:"entry_reserve_serial",params:base},projectionRevision)}>Reserve serial</button>}
        <button disabled={disabled||sending || projection.draft.validation.errors.length > 0 || projection.draft.dupe.state === "duplicate"}
          onClick={() => void send({action:"entry_commit",params:base},projectionRevision)}>Log QSO</button></footer>
    </details>
    {projection.draft.frequencyError && <p role="alert">{projection.draft.frequencyError}</p>}
    {[...projection.draft.validation.errors,...projection.draft.validation.warnings].map((item:string) => <p key={item}>{item}</p>)}
    </section>;
}
function Check({ projection, disabled, projectionRevision, receipts, send }: { projection: any; disabled: boolean;
  projectionRevision:number;receipts:ContestSurfaceTerminalReceipt[];send: Send }) {
  const base={draftID:projection.draftID,expectedDraftRevision:projection.draftRevision};
  return <section className="contest-surface-check"><h1>Check Partial</h1><IntentInput label="Callsign query" value={projection.inputCallsign}
    identity={`${projection.draftID}/query`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled}
    maximumUTF8Bytes={32} send={send} action={inputCallsign=>({action:"assistance_query",params:{...base,inputCallsign}})}/>
    <div className="contest-surface-check-columns"><div><h2>Log</h2>{projection.loggedCandidates ? <ContestCandidates className="contest-surface-results" disabled={disabled} strongLabel={false}
      candidates={projection.loggedCandidates.map((item:any)=>({id:item.candidateID,label:item.callsign}))}
      onSelect={candidateID=>void send({action:"assistance_select",params:{...base,kind:"log",candidateID}},projectionRevision)}/> : projection.loggedCalls?.map((call:string)=><p key={call}>{call}</p>)}{!projection.loggedCandidates&&!projection.loggedCalls&&<p aria-label="Matching logged calls unavailable">—</p>}</div><div><h2>Master</h2><ContestCandidates className="contest-surface-results" disabled={disabled} strongLabel={false}
      candidates={projection.scp.candidates.map((item:any)=>({id:item.candidateID,label:item.callsign}))}
      onSelect={candidateID=>void send({action:"assistance_select",params:{...base,kind:"scp",candidateID}},projectionRevision)}/></div><div><h2>Telnet</h2>{projection.clusterCandidates ? <ContestCandidates className="contest-surface-results" disabled={disabled} strongLabel={false}
      candidates={projection.clusterCandidates.map((item:any)=>({id:item.candidateID,label:item.callsign}))}
      onSelect={candidateID=>void send({action:"assistance_select",params:{...base,kind:"cluster",candidateID}},projectionRevision)}/> : projection.clusterCalls?.map((call:string)=><p key={call}>{call}</p>)}{!projection.clusterCandidates&&!projection.clusterCalls&&<p aria-label="Matching cluster calls unavailable">—</p>}</div></div>
    <details><summary>Call history</summary><ContestCandidates disabled={disabled}
      candidates={projection.history.rows.map((row:any)=>({id:row.candidateID,label:row.callsign,className:"contest-surface-history",
        detail:row.fields.map((field:any)=>`${field.label}: ${field.value}`).join(" · ")}))}
      onSelect={candidateID=>void send({action:"assistance_select",params:{...base,kind:"history",candidateID}},projectionRevision)}/></details></section>;
}
function Statistics({projection}:{projection:any}) { return <section><h1>Statistics</h1><ContestScoreSummary score={projection.score} detached/></section>; }
function Rates({ projection }: { projection: ContestRatesSurfaceProjection }) {
  const rates = [["Last hour", projection.lastHourQsoPerHour], ["10 Last QSO", projection.last10QsoPerHour],
    ["100 Last QSO", projection.last100QsoPerHour], ["Since 0000z", projection.sinceMinuteQsoPerHour]] as const;
  return <section aria-label="Contest Rates" aria-busy={projection.busy} className="contest-surface-rates"><h1>Rates</h1>
    <p className="contest-surface-rate-scope">All bands · All modes</p><dl>{rates.map(([label, value]) => <div key={label}><dt>{label}:</dt><dd>{value === null ? <span aria-label={label.startsWith("Since")?"Rate start time unavailable":"Not enough contacts"}>—</span> : value.toLocaleString(undefined, { maximumFractionDigits: 2 })} <small>Q/h</small></dd></div>)}</dl>
    <table aria-label="Run and Search & Pounce QSOs"><tbody>{[["Run QSO",projection.runQso],["S&P QSO",projection.searchAndPounceQso],
      ["Hour Run QSO",projection.hourRunQso],["Hour S&P QSO",projection.hourSearchAndPounceQso]].map(([label,value])=><tr key={label}><th scope="row">{label}:</th><td>{value.toLocaleString()}</td></tr>)}</tbody></table>
  </section>;
}
function Matrix({ projection }: { projection: ContestMatrixSurfaceProjection }) {
  return <section aria-label={`Contest ${projection.title}`} aria-busy={projection.busy} className="contest-surface-matrix"><header><h1>{projection.title}</h1>
    <span>{projection.total.toLocaleString()} worked</span></header>
      <div className="contest-surface-matrix-scroll"><table aria-label={`${projection.title} by band`}><thead><tr><th scope="col">{projection.title === "DXCC" ? "DXCC" : "Zone"}</th>
        {projection.bands.map(band => <th key={band} scope="col">{band}</th>)}<th scope="col">Total</th></tr></thead><tbody>
        {projection.rows.map(row => <tr key={row.label}><th scope="row">{row.label}</th>{projection.bands.map(band => <td key={band} className={row.counts[band] > 0 ? "contest-surface-worked" : undefined}>
          {row.counts[band].toLocaleString()}</td>)}<td>{row.total.toLocaleString()}</td></tr>)}
      </tbody></table></div>
  </section>;
}
function ManualLogTable({rows,disabled,onEdit,label}:{rows:any[];disabled:boolean;onEdit:(qsoID:string)=>void;label:string}) {
  return <div className="contest-surface-log-scroll"><table aria-label={label}><thead><tr>{["YYYY-MM-DD HH:MM:SS","Call","Freq","Snt","Rcv","ZN","NR","PFX","PTS"].map(title=><th key={title} scope="col">{title}</th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.qsoID}>
    <td>{row.TS??new Date(row.workedAt).toISOString().slice(0,19).replace("T"," ")}</td><td><button disabled={disabled} onClick={()=>onEdit(row.qsoID)}>{row.Call??row.callsign}</button></td>
    <td>{row.Freq??"—"}</td><td>{row.SNT??"—"}</td><td>{row.RCV??"—"}</td>
    <td>{row.ZN??"—"}</td><td>{row.SentNr??"—"}</td><td>{row.prefix??"—"}</td><td>{row.Points??row.points}</td></tr>)}</tbody></table></div>;
}
function Log({projection,disabled,sending,projectionRevision,receipts,send}:{projection:any;disabled:boolean;sending:boolean;projectionRevision:number;receipts:ContestSurfaceTerminalReceipt[];send:Send}) { const editing=projection.editing; return <section className="contest-surface-log"><h1>Log Display</h1>
  {editing&&<div className="contest-surface-editor"><IntentInput label="Callsign" value={editing.callsign} identity={`${editing.qsoID}/callsign`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={32} send={send} action={value=>({action:"log_edit_set_text",params:{qsoID:editing.qsoID,field:"callsign",value}})}/>
    <IntentInput label="TimeStamp (UTC)" value={editing.workedAt??""} identity={`${editing.qsoID}/timestamp`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={32} send={send} action={value=>({action:"log_edit_set_text",params:{qsoID:editing.qsoID,field:"timestamp",value}})}/>
    <IntentInput label="Station Call" value={editing.operator??""} identity={`${editing.qsoID}/operator`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={32} send={send} action={value=>({action:"log_edit_set_text",params:{qsoID:editing.qsoID,field:"operator",value}})}/>
    {editing.reportsVisible!==false&&<div className="contest-surface-row"><IntentInput label="Sent report" value={editing.sentReport} identity={`${editing.qsoID}/sentReport`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={160} send={send} action={value=>({action:"log_edit_set_text",params:{qsoID:editing.qsoID,field:"sentReport",value}})}/>
      <IntentInput label="Received report" value={editing.receivedReport} identity={`${editing.qsoID}/receivedReport`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={160} send={send} action={value=>({action:"log_edit_set_text",params:{qsoID:editing.qsoID,field:"receivedReport",value}})}/></div>}
    {editing.receivedFields.map((field:any)=><IntentInput key={field.id} label={field.label} value={field.value} identity={`${editing.qsoID}/exchange/${field.id}`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={field.maximumUTF8Bytes} send={send} action={value=>({action:"log_edit_set_exchange",params:{qsoID:editing.qsoID,fieldID:field.id,value}})}/>)}
    <div className="contest-surface-row"><IntentInput label="Frequency Hz" value={editing.editFrequencyText} identity={`${editing.qsoID}/frequency`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={11} send={send} action={value=>({action:"log_edit_set_frequency_text",params:{qsoID:editing.qsoID,value}})}/>
      <IntentInput label="Band" value={editing.band} identity={`${editing.qsoID}/band`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={16} send={send} action={value=>({action:"log_edit_set_band",params:{qsoID:editing.qsoID,value}})}/></div>
    <IntentInput label="Correction note" value={editing.correctionReason} identity={`${editing.qsoID}/correctionReason`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={1024} send={send} action={value=>({action:"log_edit_set_text",params:{qsoID:editing.qsoID,field:"correctionReason",value}})}/>
    {editing.frequencyError&&<p role="alert">{editing.frequencyError}</p>}<div className="contest-surface-editor-actions"><button disabled={disabled||sending} onClick={()=>void send({action:"log_edit_cancel",params:{qsoID:editing.qsoID}},projectionRevision)}>Cancel</button>
    <button disabled={disabled||sending||!!editing.frequencyError||!editing.correctionReason.trim()} onClick={()=>void send({action:"log_edit_save",params:{qsoID:editing.qsoID,expectedSessionRevision:projection.sessionRevision}},projectionRevision)}>Save</button>
    <button disabled={disabled||sending} aria-pressed={editing.confirmDelete} onClick={()=>void send({action:"log_edit_confirm_delete",params:{qsoID:editing.qsoID,confirmed:!editing.confirmDelete}},projectionRevision)}>{editing.confirmDelete?"Keep contact":"Delete…"}</button></div>
    {editing.confirmDelete&&<div className="contest-surface-delete"><IntentInput label="Deletion reason" value={editing.deletionReason} identity={`${editing.qsoID}/deletionReason`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={1024} send={send} action={value=>({action:"log_edit_set_text",params:{qsoID:editing.qsoID,field:"deletionReason",value}})}/>
      <button disabled={disabled||sending||!editing.deletionReason.trim()} onClick={()=>void send({action:"log_edit_delete",params:{qsoID:editing.qsoID,expectedSessionRevision:projection.sessionRevision}},projectionRevision)}>Delete contact</button></div>}</div>}
  {projection.exchangeLayout!=="plugin" ? <ManualLogTable rows={projection.manualRows??projection.page.rows} disabled={disabled} label="Contest log" onEdit={qsoID=>void send({action:"log_edit_begin",params:{qsoID}},projectionRevision)}/>
    : <ContestLogTable rows={projection.page.rows} disabled={disabled} detached onEdit={qsoID=>void send({action:"log_edit_begin",params:{qsoID}},projectionRevision)}/>}
  {projection.exchangeLayout!=="plugin"&&<ManualLogTable rows={projection.partialRows??[]} disabled={disabled} label="Callsign partial matches" onEdit={qsoID=>void send({action:"log_edit_begin",params:{qsoID}},projectionRevision)}/>}
  <footer><button disabled={disabled||projection.page.offset===0} onClick={()=>void send({action:"log_page",params:{offset:Math.max(0,projection.page.offset-projection.page.limit)}},projectionRevision)}>Previous</button>
    <span>{projection.page.total?`${projection.page.offset+1}–${projection.page.offset+projection.page.rows.length} of ${projection.page.total}`:"No contacts"}</span>
    <button disabled={disabled||projection.page.offset+projection.page.rows.length>=projection.page.total} onClick={()=>void send({action:"log_page",params:{offset:projection.page.offset+projection.page.limit}},projectionRevision)}>Next</button></footer></section>; }

export function DetachedContestSurface() {
  const context = useMemo(() => contestSurfaceContextFromSearch(window.location.search), []);
  return <div className="app live contest-detached-surface"><Surface context={context}/></div>;
}

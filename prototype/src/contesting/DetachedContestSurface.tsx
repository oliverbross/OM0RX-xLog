import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent,
  type ReactNode, type Ref } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { contestSurfaceContextFromSearch, onContestSurfaceWake, readContestSurfaceSnapshot, reportContestSurfaceDiagnostic, submitContestSurfaceAction,
  openContestContactEditorWindow, closeContestContactEditorWindow, toggleContestSurfaceWindow,
  type ContestSurfaceContext, type ContestSurfaceSnapshot, type ContestSurfaceTerminalReceipt } from "./contestSurfaceNative";
import { contestInputFieldIDs, type ContestInputFieldID, type ContestLogInlineEdit, type ContestSurfaceAction, type ContestSurfaceActionEnvelope,
  type ContestRatesSurfaceProjection, type ContestMatrixSurfaceProjection, type ContestSpotSurfaceProjection,
  type ContestStatisticsSurfaceProjection, type ContestScoreReportingSurfaceProjection, type ContestMessagesSurfaceProjection } from "./contestSurfaceProtocol";
import { ContestTextField, ContestCandidates, ContestScoreSummary } from "./ContestPresentation";
import { contestKeyChord, functionKeyForContestAction, resolveContestKeyBinding,
  type ContestKeyBindingAction, type ContestKeyBindingContext } from "./contestKeyBindings";
import BandMaps, { BAND_MAP_AGES, bandForRadio, contestBandMapSpotColor, filterRecentBandMapSpots } from "../live/BandMaps";
import { decodeContestBandPlan } from "./contestBandPlan";
import ClusterPanel from "../live/ClusterPanel";
import { connectMapContext, mapSpots } from "../live/mapContext";
import { requestViaSession } from "../live/DetachedClusterBridge";
import { connectMonitorContext, observedReceiveBandwidthHz, type MonitorContext } from "../live/monitorContext";
import "./DetachedContestSurface.css";
import { ContestQRZDetailsSurface } from "./DetachedContestQRZDetailsSurface";

const WorldMap = lazy(() => import("../Map"));

type Context = ContestSurfaceContext & { panelID: ContestSurfaceActionEnvelope["panelID"] };
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const boundedDiagnostic = (value: string) => {
  let bounded="";
  for(const character of value.trim()){
    if(new TextEncoder().encode(bounded+character).length>512)break;
    bounded+=character;
  }
  return bounded||"Contest operation failed.";
};
const retryableUnavailablePanels = new Set<Context["panelID"]>([
  "active-qso", "band-maps", "world-map", "callsign-intelligence", "monitor", "propagation", "logbook", "dx-cluster", "score-reporting", "messages",
]);
const fldigiContestModes = new Set(["RTTY", "RTTY-R", "LSB-D", "USB-D", "AM-D", "FM-D",
  "DIGI-U", "DIGI-L", "RTTYR", "PKTLSB", "PKTUSB"]);
const not1mmCallsignModes = new Set(["CW", "RTTY", "SSB", "FM", "AM", "LSB", "USB"]);
const not1mmCallsignCommand = (value:string):{kind:"mode";value:string}|{kind:"frequency";value:string}|null => {
  const token=value.trim().toUpperCase();
  if(not1mmCallsignModes.has(token))return{kind:"mode",value:token};
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?$/.test(token))return null;
  const frequencyHz=Math.round(Number(token)*1_000);
  return Number.isSafeInteger(frequencyHz)&&frequencyHz>0?{kind:"frequency",value:String(frequencyHz)}:null;
};
function useContestSurface(context: Context) {
  const [snapshot, setSnapshot] = useState<ContestSurfaceSnapshot | null>(null), [error, setError] = useState("");
  const mounted = useRef(true), ticket = useRef(0), snapshotRef = useRef<ContestSurfaceSnapshot | null>(null), errorRef = useRef("");
  const refresh = useCallback(async () => {
    const current = ++ticket.current;
    try { const value = await readContestSurfaceSnapshot(context); if (mounted.current && current === ticket.current) {
      if (!sameContestSurfaceSnapshot(snapshotRef.current, value)) { snapshotRef.current = value; setSnapshot(value); }
      if (errorRef.current) { errorRef.current = ""; setError(""); }
    } return value; }
    catch (cause) { if (mounted.current && current === ticket.current) {
      const next = message(cause); if (errorRef.current !== next) { errorRef.current = next; setError(next); }
    } return null; }
  }, [context]);
  useEffect(() => { mounted.current = true; void refresh(); let stop: undefined | (() => void);
    void onContestSurfaceWake(changedPanelID => {
      if (changedPanelID === null || changedPanelID === context.panelID) void refresh();
    }).then(value => { if (mounted.current) { stop = value; void refresh(); } else value(); })
      .catch(cause => { if (mounted.current) setError(message(cause)); });
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", visible);
    return () => { mounted.current = false; ticket.current += 1; stop?.(); window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible); };
  }, [refresh]);
  const retryableLoading = (snapshot === null || snapshot.projection.status === "unavailable") &&
    retryableUnavailablePanels.has(context.panelID);
  useEffect(() => {
    if (!retryableLoading) return;
    let active = true, timer: number | undefined, delay = 250;
    const schedule = () => { timer = window.setTimeout(async () => {
      await refresh();
      if (!active) return;
      delay = Math.min(delay * 2, 2_000);
      schedule();
    }, delay); };
    schedule();
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [refresh, retryableLoading]);
  return { snapshot, error, refresh };
}

function sameContestSurfaceSnapshot(current: ContestSurfaceSnapshot | null, next: ContestSurfaceSnapshot) {
  // Generic native wakes reach every contest window. A projection revision is
  // immutable, while action receipts may advance without publishing a revision.
  return current !== null && current.operatingContext === next.operatingContext && current.scope === next.scope &&
    current.sessionID === next.sessionID && current.workspaceGeneration === next.workspaceGeneration &&
    current.panelID === next.panelID && current.projectionRevision === next.projectionRevision &&
    current.receipts.length === next.receipts.length && current.receipts.every((receipt, index) => {
      const candidate = next.receipts[index];
      return receipt.requestID === candidate.requestID && receipt.status === candidate.status &&
        receipt.message === candidate.message && receipt.projectionRevision === candidate.projectionRevision;
    });
}

type EntryFeedback = { kind:"error"|"saved"; text:string };
function Surface({ context }: { context: Context }) {
  const { snapshot, error, refresh } = useContestSurface(context), [sending, setSending] = useState(false),
    [entryFeedback,setEntryFeedback]=useState<EntryFeedback|null>(null);
  const snapshotRef=useRef(snapshot),queueRef=useRef<Promise<void>>(Promise.resolve()),pendingCount=useRef(0);
  const receiptWaiters=useRef(new Map<string,{resolve:(receipt:ContestSurfaceTerminalReceipt|null)=>void;timer:number}>());
  snapshotRef.current=snapshot;
  const reportDiagnostic=useCallback((kind:"error"|"notice",text:string)=>{
    if(kind==="error"&&context.panelID==="active-qso")setEntryFeedback({kind:"error",text:boundedDiagnostic(text)});
    if(context.panelID!=="messages")void reportContestSurfaceDiagnostic(context,kind,boundedDiagnostic(text)).catch(()=>{});
  },[context]);
  useEffect(()=>{if(error)reportDiagnostic("error",error);},[error,reportDiagnostic]);
  useEffect(()=>{for(const receipt of snapshot?.receipts??[]){if(receipt.status!=="applied"&&receipt.status!=="rejected")continue;
    const waiter=receiptWaiters.current.get(receipt.requestID);if(!waiter)continue;
    window.clearTimeout(waiter.timer);receiptWaiters.current.delete(receipt.requestID);waiter.resolve(receipt);}},[snapshot]);
  useEffect(()=>()=>{for(const waiter of receiptWaiters.current.values()){window.clearTimeout(waiter.timer);waiter.resolve(null);}receiptWaiters.current.clear();},[]);
  const latest = snapshot?.receipts.at(-1);
  const send = useCallback((action: ContestSurfaceAction, requestedProjectionRevision:number,
      options:{requestID?:string;safePresentation?:boolean;bypassQueue?:boolean}={}) => {
    const requestID=options.requestID??crypto.randomUUID();
    const execute=async()=>{
      pendingCount.current+=1;setSending(true);
        if(context.panelID==="active-qso")setEntryFeedback(null);
      try {
        let currentAction=action,projectionRevision=requestedProjectionRevision;
        if(options.safePresentation){const current=await refresh();
          if(!current||current.panelID!==context.panelID||current.projection.status!=="ready")return {applied:false,projectionRevision:null,message:"The contest panel is not ready."};
          const params=action.params as Record<string,unknown>;
          projectionRevision=current.projectionRevision;
          if(typeof params.draftID==="string"){
          const projection=current.projection as any,draftRevision=projection.draft?.draftID===params.draftID?projection.draft.revision:
            projection.draftID===params.draftID?projection.draftRevision:null;
          if(!Number.isSafeInteger(draftRevision))return {applied:false,projectionRevision:null,message:"The contest draft is no longer available."};
          currentAction={...action,params:{...params,expectedDraftRevision:draftRevision}} as ContestSurfaceAction;
          }else if(typeof params.qsoID==="string"&&(current.projection as any).editing?.qsoID!==params.qsoID)return {applied:false,projectionRevision:null,message:"The selected contact is no longer being edited."};
        }else{const current=await refresh();if(!current||current.panelID!==context.panelID||current.projection.status!=="ready")return {applied:false,projectionRevision:null,message:"The contest panel is not ready."};
          const params=action.params as Record<string,unknown>,escape=action.action==="entry_operator_key"&&params.key==="Escape";
          if(escape){const draft=(current.projection as any).draft;if(draft?.draftID!==params.draftID||
              !Number.isSafeInteger(params.expectedDraftRevision)||params.expectedDraftRevision as number>draft.revision||
              requestedProjectionRevision>current.projectionRevision){const text="The shared contest entry no longer owns this Escape action.";reportDiagnostic("error",text);return {applied:false,projectionRevision:null,message:text};}}
          else if(current.projectionRevision!==requestedProjectionRevision){const text="The shared contest panel changed before this action could be applied.";reportDiagnostic("error",text);return {applied:false,projectionRevision:null,message:text};}}
        const appliedResult=async(fallbackRevision:number)=>{const current=await refresh();
          const params=currentAction.params as Record<string,unknown>,commitLike=currentAction.action==="entry_commit"||
            currentAction.action==="entry_operator_key"&&params.key==="Enter",draft=(current?.projection as any)?.draft;
          if(context.panelID==="active-qso"&&commitLike&&typeof params.draftID==="string"&&
              typeof draft?.draftID==="string"&&draft.draftID!==params.draftID)
            setEntryFeedback({kind:"saved",text:"QSO saved"});
          return {applied:true,projectionRevision:current?.projectionRevision??fallbackRevision,message:null};};
        const immediate=await submitContestSurfaceAction({...context,scope:"contesting",projectionRevision,
          requestID,...currentAction} as ContestSurfaceActionEnvelope);
        if(immediate.status==="applied")return appliedResult(projectionRevision);
        if(immediate.status==="rejected"){
          const current=await refresh(),receipt=current?.receipts.find(item=>item.requestID===requestID),text=receipt?.message||"The contest action could not be applied.";
          reportDiagnostic("error",text);return {applied:false,projectionRevision:null,message:text};
        }
        const existing=snapshotRef.current?.receipts.find(item=>item.requestID===requestID&&
          (item.status==="applied"||item.status==="rejected"));
        const terminal=existing??await new Promise<ContestSurfaceTerminalReceipt|null>(resolve=>{
          const timer=window.setTimeout(()=>{receiptWaiters.current.delete(requestID);resolve(null);},20_000);
          receiptWaiters.current.set(requestID,{resolve,timer});
        });
        if(terminal?.status==="applied")return appliedResult(terminal.projectionRevision);
        const terminalMessage=!terminal?"The action is still being reconciled.":terminal.message||"The contest action could not be applied.";
        if(terminalMessage)reportDiagnostic("error",terminalMessage);
        return {applied:false,projectionRevision:null,message:terminalMessage};
      }catch(cause){const text=message(cause);reportDiagnostic("error",text);await refresh();return {applied:false,projectionRevision:null,message:text};}
      finally{pendingCount.current-=1;if(pendingCount.current===0)setSending(false);}
    };
    if(options.bypassQueue)return execute();
    const operation=queueRef.current.then(execute);
    queueRef.current=operation.then(()=>{},()=>{});return operation;
  },[context,refresh,reportDiagnostic]);
  const editorOnly = new URLSearchParams(window.location.search).get("view") === "edit-contact", closingEditor=useRef(false);
  useEffect(()=>{if(!editorOnly||!isTauri())return;let active=true,unlisten:(()=>void)|undefined;
    void getCurrentWindow().onCloseRequested(async event=>{
      event.preventDefault();
      if(closingEditor.current)return;
      closingEditor.current=true;
      try{
        const current=await refresh(),editing=current?.panelID==="logbook"&&current.projection.status==="ready"?(current.projection as any).editing:null;
        if(!editing){await closeContestContactEditorWindow();return;}
        const result=await send({action:"log_edit_cancel",params:{qsoID:editing.qsoID}},current!.projectionRevision,{safePresentation:true});
        if(result.applied)await closeContestContactEditorWindow();
      }finally{closingEditor.current=false;}
    }).then(dispose=>{if(active)unlisten=dispose;else dispose();}).catch(()=>{});
    return()=>{active=false;unlisten?.();};
  },[editorOnly,refresh,send]);
  if (!snapshot) return <main aria-label="Contest panel"><p role="status">Loading shared contest panel…</p>{context.panelID==="messages"&&error&&<p role="alert">{error}</p>}</main>;
  const projection = snapshot.projection;
  return <main aria-label={`Contest ${context.panelID}`}>
    {projection.status === "unavailable" ? retryableUnavailablePanels.has(context.panelID)
      ? <p role="status">Loading shared contest panel…</p>
      : context.panelID === "awards" || context.panelID === "chaser-dx"
      ? <section className="contest-surface-unavailable"><h1>{context.panelID === "awards" ? "DXCC" : "Zones"}</h1>
          <p>{context.panelID === "awards" ? "This contest does not score DXCC multipliers." : "This contest does not score CQ or ITU zone multipliers."}</p></section>
      : (() => { throw new Error(`No shared contest renderer owns ${context.panelID}.`); })()
      : snapshot.panelID === "active-qso" ? <Entry projection={projection as Extract<typeof projection, { draft: unknown }>} disabled={projection.busy} sending={sending}
          context={context} projectionRevision={snapshot.projectionRevision} send={send} refresh={refresh} settle={()=>queueRef.current}
          feedback={entryFeedback} reportConflict={text=>reportDiagnostic("error",text)}/>
      : snapshot.panelID === "callsign-intelligence" ? <Check projection={projection as Extract<typeof projection, { scp: unknown }>} disabled={projection.busy}
          projectionRevision={snapshot.projectionRevision} receipts={snapshot.receipts} send={send}/>
      : snapshot.panelID === "propagation" ? <Statistics projection={projection as ContestStatisticsSurfaceProjection}/>
      : snapshot.panelID === "monitor" ? <Rates projection={projection as ContestRatesSurfaceProjection}/>
      : snapshot.panelID === "score-reporting" ? <ScoreReporting projection={projection as ContestScoreReportingSurfaceProjection}
          projectionRevision={snapshot.projectionRevision} send={send}/>
      : snapshot.panelID === "messages" ? <Messages projection={projection as ContestMessagesSurfaceProjection}/>
      : snapshot.panelID === "awards" || snapshot.panelID === "chaser-dx" ? <Matrix projection={projection as ContestMatrixSurfaceProjection}
          preferenceScope={`${context.sessionID}/${snapshot.panelID}`}/>
      : snapshot.panelID === "logbook" ? editorOnly
        ? <ContactEditor projection={projection as Extract<typeof projection, { page: unknown }>} disabled={projection.busy} sending={sending}
            projectionRevision={snapshot.projectionRevision} receipts={snapshot.receipts} send={send}/>
        : <Log projection={projection as Extract<typeof projection, { page: unknown }>} disabled={projection.busy} sending={sending}
            projectionRevision={snapshot.projectionRevision} send={send} openEditor={async(qsoID,deleteIntent=false)=>{
              try { const result=await send({action:"log_edit_begin",params:{qsoID}},snapshot.projectionRevision);
                if(!result.applied||result.projectionRevision===null)return;
                if(deleteIntent){const confirmed=await send({action:"log_edit_confirm_delete",params:{qsoID,confirmed:true}},result.projectionRevision);
                  if(!confirmed.applied)return;}
                await openContestContactEditorWindow(context); }
               catch(cause){reportDiagnostic("error",message(cause));}
            }}/>
      : snapshot.panelID === "world-map" ? <ContestSpotsMap
          projection={projection as Extract<typeof projection, { spots: unknown }>}/>
      : snapshot.panelID === "band-maps" || snapshot.panelID === "dx-cluster" ? <ContestSpots panelID={snapshot.panelID}
          context={context} projection={projection as Extract<typeof projection, { spots: unknown }>}
          projectionRevision={snapshot.projectionRevision} send={send}/>
      : null}
  </main>;
}

function Messages({projection}:{projection:ContestMessagesSurfaceProjection}) {
  const messages=projection.messages;
  return <section className="contest-surface-messages" aria-label="Contest Messages"><h1>Messages</h1>
    {messages.length===0?<p>No contest messages.</p>:<ol>{messages.map((item,index)=><li key={`${item.kind}:${index}:${item.text}`}
      role={item.kind==="error"?"alert":"status"} className={item.kind==="error"?"is-error":undefined}>{item.text}</li>)}</ol>}
  </section>;
}

function ScoreReporting({ projection, projectionRevision, send }: { projection: ContestScoreReportingSurfaceProjection;
    projectionRevision: number; send: Send }) {
  const score = projection.score;
  const [service,setService]=useState(projection.service),[username,setUsername]=useState(projection.username),[password,setPassword]=useState("");
  const [interval,setInterval]=useState(projection.intervalMinutes),[pending,setPending]=useState(false),[error,setError]=useState("");
  useEffect(()=>{setService(projection.service);setUsername(projection.username);setInterval(projection.intervalMinutes);},
    [projection.service,projection.username,projection.intervalMinutes]);
  const configure=async(enabled:boolean)=>{setPending(true);setError("");try{await send({action:"score_configure",params:{service,username,password,
    intervalMinutes:interval,enabled}},projectionRevision);setPassword("");}catch(cause){setError(message(cause));}finally{setPending(false);}};
  const sendNow=async()=>{setPending(true);setError("");try{await send({action:"score_send_now",params:{}},projectionRevision);}
    catch(cause){setError(message(cause));}finally{setPending(false);}};
  return <section className="contest-score-reporting" aria-label="Real-time score reporting">
    <header><p className="contest-score-reporting-kicker">Not1MM RTC compatibility</p><h1>Score Reporting</h1>
      <p>Review the current Python-owned score and the scoreboard settings required by the original workflow.</p></header>
    <div className="contest-score-reporting-summary" aria-label="Current contest score">
      <div><span>QSOs</span><strong>{score?.qsos ?? "—"}</strong></div><div><span>Points</span><strong>{score?.points ?? "—"}</strong></div>
      <div><span>Multipliers</span><strong>{score?.multipliers ?? "—"}</strong></div><div><span>Claimed score</span><strong>{score?.claimedScore ?? "—"}</strong></div>
    </div>
    <fieldset disabled={pending||projection.availability!=="available"} aria-describedby="rtc-reporting-status"><legend>Online scoreboard</legend>
      <label><input aria-label="Periodically send XML score" type="checkbox" checked={projection.reportingEnabled}
        onChange={event=>void configure(event.target.checked)}/> Periodically send XML score</label>
      <label>Service<select value={service} onChange={event=>setService(event.target.value as typeof service)}>{projection.services.filter(item=>item.transportSecurity==="https").map(item =>
        <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Username<input aria-label="Username" type="text" autoComplete="username" value={username} maxLength={128} onChange={event=>setUsername(event.target.value)}/></label>
      <label>Password<input aria-label="Password" type="password" autoComplete="current-password" value={password} maxLength={8192}
        placeholder={projection.credentialSaved?"•••••••• — saved":""} onChange={event=>setPassword(event.target.value)}/></label>
      <label>Interval (minutes)<input aria-label="Interval (minutes)" type="number" min={1} max={60} value={interval}
        onChange={event=>setInterval(Math.max(1,Math.min(60,Number(event.target.value)||1)))}/></label>
      <button type="button" disabled={pending||!username||(!password&&!projection.credentialSaved)} onClick={()=>void configure(projection.reportingEnabled)}>Save securely</button>
      <button type="button" disabled={pending||!projection.credentialSaved} onClick={()=>void sendNow()}>Send score now</button>
    </fieldset>
    <p id="rtc-reporting-status" className="contest-score-reporting-boundary" role="status"><strong>{projection.reportState.replace(/^[a-z]/,c=>c.toUpperCase())}.</strong> {projection.lastOutcome} {projection.reason}</p>
    <ul className="contest-score-reporting-services">{projection.services.map(service => <li key={service.id}>
      <span>{service.name}</span><code>{service.url}</code>{service.transportSecurity === "legacy-http" && <em>Legacy HTTP endpoint — not eligible for credentials.</em>}
    </li>)}</ul>
  </section>;
}

type SendResult={applied:boolean;projectionRevision:number|null;message:string|null};
type Send = (action: ContestSurfaceAction, projectionRevision:number,
  options?:{requestID?:string;safePresentation?:boolean;bypassQueue?:boolean}) => Promise<SendResult>;
const contestSpotLegend=[
  {label:"Double multiplier",color:"#00e51b"},{label:"Single multiplier",color:"#ff5267"},
  {label:"Valid QSO",color:"#3da5f4"},{label:"Dupe / non-workable",color:"#aeb5b7"},
];
export function contestMapSpots(contestSpots:ContestSpotSurfaceProjection["spots"],sharedSpots:Record<string,any>[]) {
  const contestByID=new Map(contestSpots.map(spot=>[spot.id,spot]));
  return mapSpots(sharedSpots).flatMap(spot=>{
    const contest=contestByID.get(spot.id);if(!contest)return [];
    const multiplierCount=contest.contestCountryMultiplier!==null&&contest.contestZoneMultiplier!==null
      ? Number(contest.contestCountryMultiplier)+Number(contest.contestZoneMultiplier):contest.contestMultiplierCount;
    const callStatus=contest.contestDupe===true?"Dupe / non-workable":multiplierCount!==null&&multiplierCount>1?"Double multiplier":
      multiplierCount===1?"Single multiplier":multiplierCount===0&&contest.contestDupe===false?"Valid QSO":"Scoring pending";
    return [{...spot,callStatus,statusHex:contestBandMapSpotColor(contest),state:contest.contestDupe===true?"worked" as const:"needed" as const,
      note:contest.comment,receivedAt:contest.receivedAt}];
  });
}
function ContestSpotsMap({projection}:{projection:ContestSpotSurfaceProjection}) {
  const [sharedSpots,setSharedSpots]=useState<Record<string,any>[]>([]);
  useEffect(()=>{const connection=connectMapContext(value=>setSharedSpots(value.cluster.response?.snapshot?.spots??[]),()=>{});
    return()=>connection.dispose();},[]);
  const spots=useMemo(()=>contestMapSpots(projection.spots,sharedSpots),[projection.spots,sharedSpots]);
  return <section className="contest-spots contest-spots-map" aria-label="Contest Spots Map"><Suspense fallback={<p role="status">Loading contest map…</p>}><WorldMap
    selected={projection.selectedSpotID} data={spots} frequencyHz={projection.radioFrequencyHz??undefined}
    spotColorMode="status" spotLegend={contestSpotLegend} persistenceKey={`contest-spots-${projection.contestSessionID??projection.draftID}`}
    locationLabel="Configured contest band and mode reports · inspect only"/></Suspense></section>;
}
function ContestSpots({panelID,context,projection,projectionRevision,send}:{panelID:"band-maps"|"dx-cluster";context:ContestSurfaceContext;
    projection:ContestSpotSurfaceProjection;projectionRevision:number;send:Send}) {
  const [stationContext,setStationContext]=useState<MonitorContext|null>(null);
  const [clusterPending,setClusterPending]=useState<null|{requestID:number;method:"cluster_connect"|"cluster_disconnect";signature:string}>(null);
  const clusterRequestID=useRef(0),clusterSignatureRef=useRef("");
  const clusterAgeKey="xlog.integration.contest.cluster-age-minutes.v1";
  const [clusterAgeMinutes,setClusterAgeMinutes]=useState<typeof BAND_MAP_AGES[number]>(()=>{
    try { const stored=Number(localStorage.getItem(clusterAgeKey));return BAND_MAP_AGES.includes(stored as typeof BAND_MAP_AGES[number])
      ? stored as typeof BAND_MAP_AGES[number]:30; } catch { return 30; }
  }),[spotAgeClock,setSpotAgeClock]=useState(Date.now());
  useEffect(()=>{if(panelID!=="band-maps")return;const connection=connectMonitorContext(setStationContext,()=>setStationContext(null));
    return()=>connection.dispose();},[panelID]);
  useEffect(()=>{if(panelID!=="dx-cluster")return;try{localStorage.setItem(clusterAgeKey,String(clusterAgeMinutes));}catch{/* Keep the window usable without storage. */}
    const timer=window.setInterval(()=>setSpotAgeClock(Date.now()),30_000);return()=>window.clearInterval(timer);},[clusterAgeMinutes,panelID]);
  const receiveBandwidth=panelID==="band-maps"?observedReceiveBandwidthHz(stationContext):null;
  const clusterSignature=JSON.stringify(projection.connections.map(connection=>[
    connection.serverID,connection.phase,connection.error??null]));
  clusterSignatureRef.current=clusterSignature;
  useEffect(()=>{if(!clusterPending||clusterPending.signature===clusterSignature)return;
    const failures=projection.connections.filter(connection=>connection.phase.toLowerCase()==="failed"&&connection.error);
    clusterRequestID.current+=1;
    setClusterPending(null);
    if(failures.length){for(const connection of failures)void reportContestSurfaceDiagnostic(context,"error",
      boundedDiagnostic(`${connection.serverName}: ${connection.error}`)).catch(()=>{});return;}
    void reportContestSurfaceDiagnostic(context,"notice",clusterPending.method==="cluster_connect"?"Cluster connected.":"Cluster disconnected.").catch(()=>{});
  },[clusterPending,clusterSignature,projection.connections,context]);
  const [menu,setMenu]=useState<null|{spotID:string;x:number;y:number;requestedX:number;requestedY:number;origin:HTMLElement}>(null);
  const menuRef=useRef<HTMLDivElement|null>(null);
  const selected=projection.selectedSpotID===null?null:projection.spots.find(spot=>spot.id===projection.selectedSpotID)??null;
  const select=(spotID:string)=>void send({action:"spot_select",params:{draftID:projection.draftID,
    expectedDraftRevision:projection.draftRevision,spotID}},projectionRevision);
  const closeMenu=()=>setMenu(current=>{queueMicrotask(()=>{if(current?.origin.isConnected)current.origin.focus();});return null;});
  const act=(action:ContestSurfaceAction)=>{closeMenu();void send(action,projectionRevision);};
  const contextMenu=(spot:{id?:unknown},event:ReactMouseEvent<HTMLElement>|ReactKeyboardEvent<HTMLElement>)=>{
    event.preventDefault();event.stopPropagation();const origin=event.currentTarget,rect=origin.getBoundingClientRect();
    const pointer="clientX" in event&&event.clientX>0&&event.clientY>0;
    const requestedX=pointer?event.clientX:rect.left+Math.min(rect.width,24),requestedY=pointer?event.clientY:rect.top+Math.min(rect.height,24);
    setMenu({spotID:String(spot.id),x:requestedX,y:requestedY,requestedX,requestedY,origin});
  };
  const target=menu&&projection.spots.find(spot=>spot.id===menu.spotID);
  useLayoutEffect(()=>{if(!menu)return;const clamp=()=>{const rect=menuRef.current?.getBoundingClientRect(),margin=8,
      width=rect?.width??160,height=rect?.height??150,x=Math.max(margin,Math.min(menu.requestedX,window.innerWidth-width-margin)),
      y=Math.max(margin,Math.min(menu.requestedY,window.innerHeight-height-margin));
      setMenu(current=>current&&(current.x!==x||current.y!==y)?{...current,x,y}:current);};
    clamp();window.addEventListener("resize",clamp);return()=>window.removeEventListener("resize",clamp);},[menu?.spotID,menu?.requestedX,menu?.requestedY]);
  useEffect(()=>{if(menu&&!target)closeMenu();},[menu,target]);
  const workflow=<><div className="contest-spot-toolbar"><label><input type="checkbox" checked={projection.markedOnly}
    onChange={event=>void send({action:"spot_set_marked_only",params:{draftID:projection.draftID,expectedDraftRevision:projection.draftRevision,
      markedOnly:event.currentTarget.checked}},projectionRevision,{safePresentation:true})}/>Marked only</label><span>{selected?`Selected ${selected.callsign}`:"No selected spot"}</span></div>
    {menu&&target&&<div ref={menuRef} className="contest-spot-menu" role="menu" aria-label={`Spot actions for ${target.callsign}`}
      style={{left:menu.x,top:menu.y}} onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();closeMenu();return;}
        if(!["ArrowDown","ArrowUp","Home","End"].includes(event.key))return;event.preventDefault();
        const items=[...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')],current=items.indexOf(document.activeElement as HTMLElement);
        const index=event.key==="Home"?0:event.key==="End"?items.length-1:event.key==="ArrowDown"?(current+1)%items.length:(current-1+items.length)%items.length;
        items[index]?.focus();}}>
      <button type="button" role="menuitem" autoFocus onClick={()=>act({action:"spot_confirm",params:{draftID:projection.draftID,
        expectedDraftRevision:projection.draftRevision,spotID:target.id}})}>Confirm</button>
      <button type="button" role="menuitem" onClick={()=>act({action:"spot_set_marked",params:{draftID:projection.draftID,
        expectedDraftRevision:projection.draftRevision,spotID:target.id,marked:!target.marked}})}>{target.marked?"Unmark":"Mark"}</button>
      <button type="button" role="menuitem" onClick={()=>act({action:"spot_delete",params:{draftID:projection.draftID,
        expectedDraftRevision:projection.draftRevision,spotID:target.id}})}>Delete</button>
      <button type="button" role="menuitem" onClick={closeMenu}>Cancel</button>
    </div>}</>;
  if(panelID==="band-maps")return <section className="contest-spots" aria-label="Contest Band Map">{workflow}<BandMaps compact contestPresentation spots={projection.spots}
    contestBandPlan={decodeContestBandPlan(projection.bandSegments,projection.supportedBands)}
    contestBands={projection.supportedBands} contestAllowedModes={projection.allowedModeGroups}
    observedReceiveBandwidthHz={receiveBandwidth}
    radioFrequencyHz={projection.radioFrequencyHz??undefined} storageNamespace={`contest.${projection.contestSessionID??projection.draftID}`} selectedSpotId={projection.selectedSpotID}
    onSpotContextMenu={contextMenu} onSelect={spot=>select(String(spot.id))}
    selectionHint="Select a spot to load the active Not1MM draft and tune the selected xLog radio once. Right-click for spot actions."/></section>;
  const visibleClusterSpots=filterRecentBandMapSpots(projection.spots,clusterAgeMinutes,spotAgeClock);
  const clusterSnapshot={snapshot:{connectedClusters:projection.connectedClusters,loadedSpots:projection.loadedSpots,contactCount:0,contactRevision:0,
    logbookDataLoaded:false,countryDataLoaded:false,connections:projection.connections,spots:visibleClusterSpots,console:[]}};
  const activeConnections=projection.connections.filter(connection=>!["disconnected","failed"].includes(connection.phase.toLowerCase()));
  const enabledClusters=projection.configuredClusters.filter(server=>server.enabled),connectedServerIDs=new Set(projection.connections
    .filter(connection=>connection.phase.toLowerCase()==="connected").map(connection=>connection.serverID));
  const connectSatisfied=enabledClusters.length>0&&enabledClusters.every(server=>connectedServerIDs.has(server.serverID));
  const clusterAction=async(method:"cluster_connect"|"cluster_disconnect")=>{if(clusterPending)return;
    const requestID=++clusterRequestID.current,signature=clusterSignature;
    setClusterPending({requestID,method,signature});
    try{await requestViaSession(method);
      if(clusterRequestID.current!==requestID||clusterSignatureRef.current!==signature)return;
      clusterRequestID.current+=1;setClusterPending(null);
      void reportContestSurfaceDiagnostic(context,"notice",method==="cluster_connect"?"Cluster connected.":"Cluster disconnected.").catch(()=>{});}
    catch(cause){if(clusterRequestID.current!==requestID)return;clusterRequestID.current+=1;
      setClusterPending(null);void reportContestSurfaceDiagnostic(context,"error",boundedDiagnostic(message(cause))).catch(()=>{});}};
  return <section className="contest-spots" aria-label="Contest Cluster">{workflow}<div className="contest-cluster-controls">
    <div role="status" aria-label="Contest cluster connections">{projection.connections.length?projection.connections.map(connection=>{const phase=connection.phase.toLowerCase();return <span key={connection.serverID}
      className={phase==="connected"?"live-cluster-connected":"live-cluster-disconnected"}>{connection.serverName} · {phase.charAt(0).toUpperCase()+phase.slice(1)}</span>;}):
      projection.configuredClusters.filter(server=>server.enabled).map(server=><span className="live-cluster-disconnected" key={server.serverID}>{server.serverName} · Disconnected</span>)}</div>
    <div><label>Clear older<select aria-label="Cluster spot age" value={clusterAgeMinutes}
      onChange={event=>setClusterAgeMinutes(Number(event.currentTarget.value) as typeof BAND_MAP_AGES[number])}>{BAND_MAP_AGES.map(value=><option key={value} value={value}>{value} min</option>)}</select></label>
      <button type="button" disabled={projection.busy||clusterPending!==null||enabledClusters.length===0||connectSatisfied} onClick={()=>void clusterAction("cluster_connect")}>Connect</button>
      <button type="button" disabled={projection.busy||clusterPending!==null||activeConnections.length===0} onClick={()=>void clusterAction("cluster_disconnect")}>Disconnect</button></div>
  </div><ClusterPanel passive presentationOnly contestPresentation taskOnly snapshot={clusterSnapshot}
    contestBands={projection.supportedBands}
    contestCurrentBand={bandForRadio(projection.radioFrequencyHz??undefined)}
    contestBandPreferenceKey={`xlog.integration.contest.cluster-band.v1.${projection.contestSessionID??projection.draftID}`}
    preferenceStorageKey="xlog.integration.contest.cluster-columns.v1" onRequest={async()=>null}
    selectedSpotId={projection.selectedSpotID} onSpotContextMenu={contextMenu} onSelect={spot=>select(spot.id)}/></section>;
}
type IntentInputProps = { label:string;value:string;identity:string;projectionRevision:number;receipts:ContestSurfaceTerminalReceipt[];
  disabled:boolean;maximumUTF8Bytes:number;send:Send;action:(value:string)=>ContestSurfaceAction;operatorField?:ContestInputFieldID;inputRef?:Ref<HTMLInputElement> };
function IntentInput({label,value:authoritative,identity,projectionRevision,receipts,disabled,maximumUTF8Bytes,send,action,operatorField,inputRef}:IntentInputProps){
  const [value,setValue]=useState(authoritative),[,setUnresolved]=useState(false),desired=useRef(authoritative),
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
  return <div className="contest-surface-intent"><ContestTextField label={label} inputRef={inputRef} data-contest-operator-field={operatorField} value={value} disabled={disabled} onChange={event=>{const next=event.target.value;
    if(new TextEncoder().encode(next).length>maximumUTF8Bytes)return;desired.current=next;setValue(next);pump();}}/></div>;
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
  const [values,setValues]=useState(authoritative),[,setUnresolved]=useState<Set<EntryIntentKey>>(new Set());
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
  const capture=useCallback(()=>({...valuesRef.current}),[]);
  const matches=useCallback((draft:any,intended:Record<EntryIntentKey,string>)=>draft?.draftID===identityRef.current&&
    draft.callsign.trim().toUpperCase()===intended.callsign.trim().toUpperCase()&&draft.sentReport===intended.sentReport&&draft.receivedReport===intended.receivedReport&&
    draft.frequencyText===intended.frequency&&Array.isArray(draft.receivedFields)&&draft.receivedFields.length===projection.draft.receivedFields.length&&
    draft.receivedFields.every((field:any)=>intended[`exchange:${field.id}`]===field.value),[projection.draft.receivedFields.length]);
  return {values,change,flush,capture,matches};
}
function EntryIntentInput({label,accessibleLabel,intentKey,value,maximumUTF8Bytes,disabled,operatorField,inputRef,onFocus,onChange}:{
  label:string;accessibleLabel?:string;intentKey:EntryIntentKey;value:string;maximumUTF8Bytes:number;disabled:boolean;operatorField?:ContestInputFieldID;
  inputRef?:Ref<HTMLInputElement>;onFocus?:()=>void;onChange:(key:EntryIntentKey,value:string)=>void}){
  return <div className="contest-surface-intent"><ContestTextField label={label} aria-label={accessibleLabel} inputRef={inputRef} data-contest-field-id={operatorField} onFocus={onFocus}
    value={value} disabled={disabled} onChange={event=>{const next=event.target.value;if(new TextEncoder().encode(next).length<=maximumUTF8Bytes)
      onChange(intentKey,next);}}/></div>;
}
function Entry({ projection, disabled, sending, context, projectionRevision, send, refresh, settle, feedback, reportConflict }: { projection: any; disabled: boolean; sending:boolean;
  context:ContestSurfaceContext;
  projectionRevision:number;send:Send;refresh:()=>Promise<ContestSurfaceSnapshot|null>;
  settle:()=>Promise<void>;feedback:EntryFeedback|null;reportConflict:(message:string)=>void }) {
  const base = { draftID: projection.draft.draftID, expectedDraftRevision: projection.draft.revision };
  const fieldRefs=useRef<Partial<Record<ContestInputFieldID,HTMLInputElement|null>>>({});
  const cwInputRef=useRef<HTMLInputElement|null>(null);
  const cwReturnFocus=useRef<HTMLElement|null>(null);
  const cwInputBindingContext=useRef<ContestKeyBindingContext>("*");
  const [cwInputOpen,setCWInputOpen]=useState(false),[cwInput,setCWInput]=useState(""),[macrosOpen,setMacrosOpen]=useState(true);
  const focusPending=useRef<Promise<number|null>>(Promise.resolve(null)),desiredFocus=useRef<ContestInputFieldID|null>(null),
    focusDraft=useRef(base.draftID);
  const operator=projection.schemaVersion===2?projection.operator:null;
  const closeCWInput=()=>{setCWInputOpen(false);queueMicrotask(()=>{
    const target=cwReturnFocus.current;
    if(target?.isConnected&&target!==document.body)target.focus();
    else fieldRefs.current[(operator?.focusedField??"callsign") as ContestInputFieldID]?.focus();
  });};
  const cwMode=projection.draft.mode==="CW";
  const phoneMode=projection.draft.mode==="SSB";
  const testSimulation=operator?.output==="test-simulation";
  const fldigiMode=fldigiContestModes.has(projection.draft.mode);
  const displayedBands=projection.schemaVersion===2?projection.descriptor.bands:["160m","80m","40m","20m","15m","10m"];
  const reportFields=projection.schemaVersion===2&&Array.isArray(projection.descriptor.reportFields)
    ? projection.descriptor.reportFields:null;
  const reportsVisible=reportFields?reportFields.length>0:projection.descriptor?.reportsVisible!==false;
  const entryFieldCount=1+(reportFields?.length??(reportsVisible?2:0))+(projection.descriptor?.sentFields?.length??0)+Math.max(1,projection.draft.receivedFields.length);
  const entryFieldColumns=entryFieldCount>1?`minmax(140px,1.6fr) repeat(${entryFieldCount-1},minmax(64px,1fr))`:`minmax(140px,1fr)`;
  // The owner reports busy while it persists the first character. These
  // inputs are locally journalled, so disabling them would drop the rest of
  // a real keyboard burst before the queued intent can drain.
  const entryBufferDisabled=false;
  const intents=useEntryIntents(projection,projectionRevision,send);
  const intendedCall=intents.values.callsign.trim(),authoritativeCall=projection.draft.callsign.trim(),
    duplicatePending=intendedCall.toLocaleUpperCase()!==authoritativeCall.toLocaleUpperCase(),
    duplicateState=duplicatePending?"unchecked":projection.draft.dupe.state;
  const actionFor=(key:EntryIntentKey)=>(value:string):ContestSurfaceAction=>key==="callsign"||key==="sentReport"||key==="receivedReport"
    ?{action:"entry_set_text",params:{...base,field:key,value}}
    :key==="frequency"?{action:"entry_set_frequency_text",params:{...base,value}}
    :{action:"entry_set_exchange",params:{...base,fieldID:key.slice("exchange:".length),value}};
  useEffect(()=>{const field=operator?.focusedField as ContestInputFieldID|undefined;
    if(focusDraft.current!==projection.draft.draftID){focusDraft.current=projection.draft.draftID;desiredFocus.current=null;
      focusPending.current=Promise.resolve(null);}
    if(field&&(!desiredFocus.current||desiredFocus.current===field))fieldRefs.current[field]?.focus();},[operator?.focusedField,projection.draft.draftID]);
  const focusField=(fieldID:ContestInputFieldID)=>{if(!operator||operator.focusedField===fieldID)return;
    desiredFocus.current=fieldID;
    const operation=focusPending.current.catch(()=>null).then(async()=>{const flushed=await intents.flush();if(!flushed.ok)return null;await settle();const current=await refresh(),currentProjection=current?.projection as any;
      if(!current||current.panelID!=="active-qso"||currentProjection?.status!=="ready"||currentProjection.draft?.draftID!==base.draftID)return null;
      if(currentProjection.operator?.focusedField===fieldID)return current.projectionRevision;
      const result=await send({action:"entry_focus",params:{draftID:base.draftID,expectedDraftRevision:currentProjection.draft.revision,fieldID}},current.projectionRevision);
      return result.projectionRevision;});
    focusPending.current=operation;void operation;};
  const setFieldRef=(fieldID:ContestInputFieldID)=>(node:HTMLInputElement|null)=>{fieldRefs.current[fieldID]=node;};
  const nextFocusable=(from:ContestInputFieldID,direction:"tabNext"|"tabPrevious")=>{let candidate:ContestInputFieldID|undefined=from;
    for(let index=0;index<contestInputFieldIDs.length;index+=1){candidate=operator?.[direction]?.[candidate];if(!candidate)return null;
      const element=fieldRefs.current[candidate];if(element&&!element.disabled&&!element.readOnly)return candidate;if(candidate===from)return null;}return null;};
  const operatorKey=(key:string,focusedField:ContestInputFieldID|null,shifted=false)=>{if(!operator||operator.status==="uncertain"||!/^F(?:[1-9]|1[0-2])$|^Enter$|^Escape$/.test(key)||shifted&&key!=="F1")return false;
    if(phoneMode&&!operator.outputAvailable&&/^F(?:[1-9]|1[0-2])$/.test(key))return true;
    const intended=intents.capture(),intentContext={band:projection.draft.band,mode:projection.draft.mode,reservedSerial:projection.draft.reservedSerial,
      armed:operator.armed,style:operator.style};
    void (async()=>{let lastLocalProjectionRevision:number|null=null,focusProjectionRevision:number|null=null;if(key!=="Escape"){const flushed=await intents.flush();if(!flushed.ok)return;
      lastLocalProjectionRevision=flushed.lastAppliedProjectionRevision;focusProjectionRevision=await focusPending.current;await settle();}const current=await refresh();const currentProjection=current?.projection as any;
      if(!current||current.panelID!=="active-qso"||currentProjection?.status!=="ready"||currentProjection.draft?.draftID!==base.draftID)return;
      if(key!=="Escape"&&(!intents.matches(currentProjection.draft,intended)||
          current.projectionRevision<Math.max(projectionRevision,lastLocalProjectionRevision??0,focusProjectionRevision??0)||currentProjection.draft.band!==intentContext.band||
          currentProjection.draft.mode!==intentContext.mode||currentProjection.draft.reservedSerial!==intentContext.reservedSerial||
          currentProjection.operator?.armed!==intentContext.armed||currentProjection.operator?.style!==intentContext.style)){
        reportConflict("The shared contest entry changed before this operator action. Review it and press the key again.");return;}
      await send({action:"entry_operator_key",params:{draftID:base.draftID,expectedDraftRevision:currentProjection.draft.revision,
        key:key as any,focusedField,...(shifted?{shifted:true}:{})}},current.projectionRevision,{bypassQueue:key==="Escape"});})();return true;};
  const bindingContext=(field:ContestInputFieldID|null):ContestKeyBindingContext=>field==="callsign"?"Callsign":field==="sent"||field==="receive"?"Report":
    field==="other_1"?"Other 1":field==="other_2"?"Other 2":"*";
  const runBoundAction=(action:ContestKeyBindingAction,focusedField:ContestInputFieldID|null)=>{
    const functionKey=functionKeyForContestAction(action);
    if(functionKey){operatorKey(functionKey,focusedField);return;}
    if(action==="FOCUS_CALLSIGN"||action==="FOCUS_NEXT"||action==="FOCUS_PREVIOUS"){
      const target=action==="FOCUS_CALLSIGN"?"callsign":focusedField?nextFocusable(focusedField,action==="FOCUS_NEXT"?"tabNext":"tabPrevious"):null;
      if(target)fieldRefs.current[target]?.focus();return;
    }
    if(action==="TOGGLE_CW_INPUT"){
      if(!cwMode){reportConflict("Free-form CW input is available only in CW mode.");return;}
      if(cwInputOpen){closeCWInput();return;}
      cwInputBindingContext.current=bindingContext(focusedField);
      cwReturnFocus.current=document.activeElement instanceof HTMLElement&&document.activeElement!==document.body?document.activeElement:null;
      setCWInputOpen(true);queueMicrotask(()=>cwInputRef.current?.focus());return;
    }
    if(action==="RST_INCR"||action==="RST_DECR"||action==="EXCH_INCR"||action==="EXCH_DECR"){
      let key:EntryIntentKey|null=null,maximum=160,editable=true;
      if(action.startsWith("RST_")&&(focusedField==="sent"||focusedField==="receive")){
        key=focusedField==="sent"?"sentReport":"receivedReport";
        const descriptor=reportFields?.find((field:any)=>field.id===focusedField);
        editable=!descriptor||descriptor.enabled!==false&&!descriptor.readOnly;maximum=descriptor?.maximumUTF8Bytes??160;
      }else if(action.startsWith("EXCH_")&&(focusedField==="other_1"||focusedField==="other_2")){
        const field=projection.draft.receivedFields.find((item:any)=>item.id===focusedField)
          ??(focusedField==="other_2"&&projection.draft.receivedFields.length===1?projection.draft.receivedFields[0]:null);
        if(field){key=`exchange:${field.id}`;editable=field.enabled!==false;maximum=field.maximumUTF8Bytes;}
      }
      const value=key?intents.capture()[key]:"";
      if(!key||!editable||!/^\d+$/.test(value)){reportConflict("Focus an editable numeric RST or exchange field for this key action.");return;}
      const current=BigInt(value),nextNumber=action.endsWith("INCR")?current+1n:current>0n?current-1n:0n;
      const next=nextNumber.toString().padStart(value.length,"0");
      if(new TextEncoder().encode(next).length>maximum){reportConflict("The adjusted value exceeds this contest field's limit.");return;}
      intents.change(key,next,actionFor(key));return;
    }
    const windowPanel=({WIN_BAND:"band-maps",WIN_CHECK:"callsign-intelligence",WIN_LOG:"logbook",
      WIN_RATE:"monitor",WIN_STATS:"propagation",WIN_VFO:"station-control"} as const)[action as
        "WIN_BAND"|"WIN_CHECK"|"WIN_LOG"|"WIN_RATE"|"WIN_STATS"|"WIN_VFO"];
    if(windowPanel){void toggleContestSurfaceWindow(context,windowPanel).catch(cause=>reportConflict(message(cause)));return;}
    const intended=intents.capture();
    void (async()=>{const flushed=await intents.flush();if(!flushed.ok)return;const focusProjectionRevision=await focusPending.current;await settle();
      const current=await refresh(),currentProjection=current?.projection as any;
      if(!current||current.panelID!=="active-qso"||currentProjection?.status!=="ready"||currentProjection.draft?.draftID!==base.draftID)return;
      if(!intents.matches(currentProjection.draft,intended)||current.projectionRevision!==Math.max(projectionRevision,
          flushed.lastAppliedProjectionRevision??0,focusProjectionRevision??0)){
        reportConflict("The shared contest entry changed before this key action. Review it and press the key again.");return;}
      const params={draftID:base.draftID,expectedDraftRevision:currentProjection.draft.revision};
      if(action==="TOGGLE_RUN"||action==="SET_RUN"||action==="SET_S_AND_P")await send({action:"entry_operator_style",params:{...params,
        value:action==="SET_RUN"?"run":action==="SET_S_AND_P"?"search-and-pounce":currentProjection.operator?.style==="run"?"search-and-pounce":"run"}},current.projectionRevision);
      else if(action==="LOG_NOW")await send({action:"entry_commit",params},current.projectionRevision);
      else if(action==="CLEAR_INPUTS")await send({action:"entry_clear",params},current.projectionRevision);
      else if(action==="PREV_SPOT"||action==="NEXT_SPOT")await send({action:"entry_step_spot",params:{...params,direction:action==="PREV_SPOT"?"previous":"next"}},current.projectionRevision);
      else if(action==="VFO_UP"||action==="VFO_DOWN")await send({action:"entry_step_vfo",params:{...params,direction:action==="VFO_UP"?"up":"down"}},current.projectionRevision);
      else if(action==="RETURN_CQ_FREQUENCY")await send({action:"entry_return_cq_frequency",params},current.projectionRevision);
      else if(action==="SPOT_DX")await send({action:"entry_spot",params},current.projectionRevision);
      else if(action==="MARK_SPOT")await send({action:"entry_mark_spot",params},current.projectionRevision);
      else if(action==="TUNE_SPOT")await send({action:"entry_tune_spot",params},current.projectionRevision);
      else {const speed=currentProjection.manual?.cwSpeedWpm;if(typeof speed!=="number")return;
        const step=currentProjection.manual?.cwSpeedStepWpm??1;
        const value=action==="CW_SPEED_UP"?Math.min(100,speed+step):Math.max(5,speed-step);
        if(value!==speed)await send({action:"entry_set_cw_speed",params:{...params,value}},current.projectionRevision);}
    })();};
  const sendCWInput=(event:FormEvent)=>{event.preventDefault();const value=cwInput.trim();if(!value)return;
    const intended=intents.capture();void(async()=>{const flushed=await intents.flush();if(!flushed.ok)return;
      const focusProjectionRevision=await focusPending.current;await settle();const current=await refresh(),currentProjection=current?.projection as any;
      if(!current||current.panelID!=="active-qso"||currentProjection?.status!=="ready"||currentProjection.draft?.draftID!==base.draftID)return;
      if(!intents.matches(currentProjection.draft,intended)||current.projectionRevision!==Math.max(projectionRevision,
          flushed.lastAppliedProjectionRevision??0,focusProjectionRevision??0)){
        reportConflict("The shared contest entry changed before this CW input. Review it and send again.");return;}
      const result=await send({action:"entry_send_cw_text",params:{draftID:base.draftID,expectedDraftRevision:currentProjection.draft.revision,value}},current.projectionRevision);
      if(result.applied){setCWInput("");closeCWInput();}
    })();};
  const runCallsignCommand=(command:NonNullable<ReturnType<typeof not1mmCallsignCommand>>)=>{const intended=intents.capture();
    void(async()=>{const flushed=await intents.flush();if(!flushed.ok)return;const focusProjectionRevision=await focusPending.current;await settle();
      const current=await refresh(),currentProjection=current?.projection as any;
      if(!current||current.panelID!=="active-qso"||currentProjection?.status!=="ready"||currentProjection.draft?.draftID!==base.draftID)return;
      if(!intents.matches(currentProjection.draft,intended)||current.projectionRevision<Math.max(projectionRevision,
          flushed.lastAppliedProjectionRevision??0,focusProjectionRevision??0)){
        reportConflict("The shared contest entry changed before this frequency or mode command. Review it and press Space again.");return;}
      const params={draftID:base.draftID,expectedDraftRevision:currentProjection.draft.revision,value:command.value,callsignCommand:true as const};
      await send({action:command.kind==="frequency"?"entry_set_frequency_text":"entry_set_mode",params},current.projectionRevision);
    })();};
  const onKeyDown=(event:ReactKeyboardEvent<HTMLElement>)=>{const target=event.target instanceof HTMLElement?event.target:null;
    if(event.defaultPrevented||event.repeat||event.nativeEvent.isComposing)return;
    const dataField=target?.dataset.contestFieldId,focusedField=contestInputFieldIDs.includes(dataField as ContestInputFieldID)
      ? dataField as ContestInputFieldID : operator?.focusedField??null;
    const chord=contestKeyChord(event),bound=projection.descriptor?.keyBindings&&chord
      ? resolveContestKeyBinding(projection.descriptor.keyBindings,bindingContext(focusedField),chord) : null;
    if(bound){event.preventDefault();event.stopPropagation();runBoundAction(bound,focusedField);return;}
    if(event.altKey||event.ctrlKey||event.metaKey)return;
    if(!event.shiftKey&&event.key===" "&&focusedField==="callsign"&&intents.values.callsign.trim().toUpperCase()==="OPON"){
      event.preventDefault();event.stopPropagation();intents.change("callsign","",actionFor("callsign"));
      void import("./contestSetupDialogs").then(({openContestSetupDialog})=>openContestSetupDialog("operator"))
        .catch(cause=>reportConflict(message(cause)));return;}
    if(!event.shiftKey&&event.key===" "&&focusedField==="callsign"){
      const command=not1mmCallsignCommand(intents.values.callsign);
      if(command){event.preventDefault();event.stopPropagation();runCallsignCommand(command);return;}}
    if(event.key==="Tab"&&focusedField){const next=nextFocusable(focusedField,event.shiftKey?"tabPrevious":"tabNext");
      if(next){event.preventDefault();event.stopPropagation();fieldRefs.current[next]?.focus();}return;}
    const advanceOnSpace=focusedField&&(projection.descriptor?.advanceOnSpace?.includes(focusedField)??focusedField==="callsign");
    if(!event.shiftKey&&event.key===" "&&advanceOnSpace){const explicit=(focusedField?projection.descriptor?.spaceNext?.[focusedField]:undefined) as ContestInputFieldID|undefined,
      next=explicit&&fieldRefs.current[explicit]&&!fieldRefs.current[explicit]?.disabled?explicit:nextFocusable(focusedField,"tabNext");
      if(next){event.preventDefault();event.stopPropagation();fieldRefs.current[next]?.focus();}return;}
    if(event.shiftKey&&event.key!=="F1")return;
    if(operatorKey(event.key,focusedField,event.shiftKey)){event.preventDefault();event.stopPropagation();}};
  const onCWInputKeyDown=(event:ReactKeyboardEvent<HTMLFormElement>)=>{
    if(!event.defaultPrevented&&!event.repeat&&!event.nativeEvent.isComposing){
      const chord=contestKeyChord(event);
      const bound=projection.descriptor?.keyBindings&&chord
        ?resolveContestKeyBinding(projection.descriptor.keyBindings,cwInputBindingContext.current,chord):null;
      if(bound==="TOGGLE_CW_INPUT"){event.preventDefault();event.stopPropagation();closeCWInput();return;}
      if(event.key==="Escape"){event.preventDefault();event.stopPropagation();closeCWInput();return;}
    }
    event.stopPropagation();};
  return <section className="contest-surface-entry" aria-label="Main Logging" onKeyDown={onKeyDown}><header>
    <div className="contest-surface-radio"><output aria-label="Current frequency">{projection.draft.frequencyHz == null ? "—" : (projection.draft.frequencyHz / 1_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<small> kHz</small></output>
      <strong>{projection.draft.mode}</strong></div><span aria-label={projection.manual?.operator?"Current operator":"Current operator unavailable"}>OP {projection.manual?.operator||"—"}</span><h1>{projection.session.name}</h1></header>
    {cwInputOpen&&<form className="contest-surface-cw-input" role="dialog" aria-label="Free-form CW input" onSubmit={sendCWInput}
      onKeyDown={onCWInputKeyDown}>
      <label>Send CW text<input ref={cwInputRef} value={cwInput} maxLength={80} disabled={disabled||sending||!operator?.outputAvailable||operator.status==="uncertain"}
        onChange={event=>{const next=event.target.value;if(new TextEncoder().encode(next).length<=80&&/^[\x20-\x7e]*$/.test(next))setCWInput(next);}}/></label>
      <button type="submit" disabled={!cwInput.trim()||disabled||sending||!operator?.outputAvailable||operator.status==="uncertain"||!operator.armed}>Send</button>
      <button type="button" onClick={closeCWInput}>Close</button>
    </form>}
    {testSimulation&&<p role="status" className="contest-alert">{projection.draft.mode === "SSB"
      ? "CONTESTING TEST · simulated SSB voice-keyer intent only · no audio playback, RF, PTT, radio, or network output"
      : "CONTESTING TEST · simulated CW only · no RF, audio, PTT, radio, or network output"}</p>}
    <div className="contest-surface-logging-body"><aside className="contest-surface-band-ladder" aria-label="Current band and mode"><strong>{projection.draft.mode}</strong>{displayedBands.map((band:string)=><span key={band} aria-current={projection.draft.band===band?"true":undefined}>{band.replace("m","")}</span>)}</aside>
    <div className="contest-surface-logging-controls">
    <div className="contest-surface-main-fields" style={{"--contest-entry-field-columns":entryFieldColumns} as CSSProperties}>
    <EntryIntentInput label="Callsign" intentKey="callsign" value={intents.values.callsign} maximumUTF8Bytes={32} disabled={entryBufferDisabled}
      operatorField="callsign" inputRef={setFieldRef("callsign")} onFocus={()=>focusField("callsign")} onChange={(key,value)=>intents.change(key,value,actionFor(key))}/>
    {(reportFields??(reportsVisible?[{id:"sent",label:"SNT",value:intents.values.sentReport,enabled:true,readOnly:false,maximumUTF8Bytes:160},
      {id:"receive",label:"RCV",value:intents.values.receivedReport,enabled:true,readOnly:false,maximumUTF8Bytes:160}]:[])).map((field:any)=>{
        const key=(field.id==="sent"?"sentReport":"receivedReport") as EntryIntentKey,
          operatorField=field.id as ContestInputFieldID;
        return field.readOnly?<label key={field.id} className="contest-surface-sent-number"><span title={field.label}>{field.label}</span><input
          aria-label={field.label} data-contest-field-id={field.id} readOnly disabled={field.enabled===false} value={field.value}/></label>:<EntryIntentInput key={field.id}
          label={field.label} intentKey={key} value={intents.values[key]} maximumUTF8Bytes={field.maximumUTF8Bytes}
          disabled={entryBufferDisabled||field.enabled===false} operatorField={operatorField} inputRef={setFieldRef(operatorField)} onFocus={()=>focusField(operatorField)}
          onChange={(changed,value)=>intents.change(changed,value,actionFor(changed))}/>;})}
    {projection.schemaVersion===2&&projection.descriptor.sentFields.length>0&&<label className="contest-surface-sent-number"><span title={projection.descriptor.sentFields[0]?.label||"SentNR"}>{projection.descriptor.sentFields[0]?.label||"SentNR"}</span><input
      aria-label="Sent exchange" readOnly disabled={projection.descriptor.sentFields.some((field:any)=>field.enabled===false)}
      value={projection.descriptor.sentFields.map((field:any)=>field.value).join(" ")}/></label>}
    {projection.draft.receivedFields.length ? projection.draft.receivedFields.map((field:any,index:number)=>{const key=`exchange:${field.id}` as EntryIntentKey,
      fieldID=contestInputFieldIDs.includes(field.id as ContestInputFieldID)?field.id as ContestInputFieldID:index===0?"other_2":undefined;return <EntryIntentInput key={field.id}
      label={field.label} accessibleLabel={`Received exchange ${index+1}`} intentKey={key} value={intents.values[key]} maximumUTF8Bytes={field.maximumUTF8Bytes} disabled={entryBufferDisabled||field.enabled===false}
      operatorField={fieldID} inputRef={fieldID?setFieldRef(fieldID):undefined} onFocus={fieldID?()=>focusField(fieldID):undefined} onChange={(changed,value)=>intents.change(changed,value,actionFor(changed))}/>;}) : <div className="contest-surface-sent-number"><span>RcvNR</span><output>—</output></div>}
    </div>
    <div className={`contest-surface-entry-status is-${duplicateState}`} role={duplicateState==="duplicate"?"alert":"status"}>
      {intendedCall===""?<span>Ready for callsign</span>:duplicatePending?<span>Checking — {intendedCall}</span>:duplicateState==="duplicate"
        ?<strong>DUPE — {authoritativeCall} already worked on {projection.draft.band}</strong>
        :duplicateState==="unchecked"?<span>{projection.draft.dupe.reason||"Checking duplicate…"}</span>
        :<span>Clear — {authoritativeCall} not worked on {projection.draft.band}</span>}
      {!duplicatePending&&duplicateState==="duplicate"&&projection.draft.dupe.reason&&<small>{projection.draft.dupe.reason}</small>}
    </div>
    {(feedback||(projection.schemaVersion===2&&(projection.draft.frequencyError||projection.draft.validation.errors[0])))&&
      <p className={`contest-surface-entry-feedback${feedback?.kind==="saved"?" is-saved":""}`} role={feedback?.kind==="saved"?"status":"alert"}>
        {feedback?.text||projection.draft.frequencyError||projection.draft.validation.errors[0]}
      </p>}
    <div className="contest-surface-run-strip" role="region" aria-label={testSimulation?"Run and S&P test simulation":phoneMode?"Run and S&P phone controls":fldigiMode?"Run and S&P fldigi controls":cwMode&&operator?.output==="xlog-native"?"Run and S&P CW controls":"Run and S&P output controls"}>
      <div role="group" aria-label="Run and S&P">{([['run','Run'],['search-and-pounce','S&P']] as const).map(([value,label])=><label className={`contest-style-${value}`} key={value}><input type="radio" name="contest-operating-style" checked={operator?.style===value} disabled={!operator||disabled||operator.pending!==null}
        onChange={()=>void send({action:"entry_operator_style",params:{...base,value}},projectionRevision)}/>{label}</label>)}</div>
      {projection.draft.mode==="CW"&&<div className="contest-surface-speed" role="group" aria-label="CW speed"><output aria-label={projection.manual?.cwSpeedWpm==null?"CW speed unavailable":"Current CW speed"}>{projection.manual?.cwSpeedWpm??"—"}</output>
        <button disabled={disabled||projection.manual?.cwSpeedWpm==null||projection.manual.cwSpeedWpm<=5} aria-label="Decrease CW speed" onClick={()=>{const speed=projection.manual?.cwSpeedWpm;if(speed!=null)void send({action:"entry_set_cw_speed",params:{...base,value:Math.max(5,speed+(projection.manual?.cwSpeedStepWpm??1)*-1)}},projectionRevision)}}>−</button>
        <button disabled={disabled||projection.manual?.cwSpeedWpm==null||projection.manual.cwSpeedWpm>=100} aria-label="Increase CW speed" onClick={()=>{const speed=projection.manual?.cwSpeedWpm;if(speed!=null)void send({action:"entry_set_cw_speed",params:{...base,value:Math.min(100,speed+(projection.manual?.cwSpeedStepWpm??1))}},projectionRevision)}}>+</button></div>}
      {operator&&(cwMode||phoneMode&&operator.outputAvailable)&&<button type="button" className="contest-surface-arm" aria-pressed={operator.armed}
        disabled={disabled||!operator.outputAvailable||operator.pending!==null}
        onClick={()=>void send({action:"entry_operator_arm",params:{...base,armed:!operator.armed}},projectionRevision)}>{operator.armed?"Disarm":phoneMode?testSimulation?"Arm phone simulation":"Arm recorded phone":operator.output==="xlog-native"?"Arm CW":"Arm simulation"}</button>}
      {operator&&(!phoneMode||operator.outputAvailable)&&<span className="contest-surface-output-state" role="status">{testSimulation?"Test simulation":phoneMode?"xLog recorded phone":fldigiMode?"fldigi":cwMode&&operator.output==="xlog-native"?"xLog CW":"Contest output"} · {operator.outputAvailable?operator.status:"unavailable"}</span>}
      {operator?.autoCQ?.active&&<div className="contest-surface-auto-cq" role="status"><span>Auto CQ</span><progress aria-label="Auto CQ countdown" max={operator.autoCQ.delaySeconds*1000} value={Math.max(0,operator.autoCQ.delaySeconds*1000-(operator.autoCQ.remainingMs??0))}/></div>}</div>
      {projection.schemaVersion===2&&<><div className="contest-surface-entry-actions" role="group" aria-label="Logging actions">
        <button type="button" aria-label="Stop" disabled={disabled||sending||!operator} onClick={()=>operatorKey("Escape",operator?.focusedField)}>Stop <kbd>Esc</kbd></button>
        <button type="button" disabled={disabled||sending} onClick={()=>runBoundAction("CLEAR_INPUTS",operator?.focusedField??null)}>Wipe</button>
        <button type="button" aria-label="Log It" className="contest-primary" disabled={disabled||sending} onClick={()=>runBoundAction("LOG_NOW",operator?.focusedField??null)}>Log It <kbd>Enter</kbd></button>
        <button type="button" disabled={disabled||sending} onClick={()=>void(async()=>{const flushed=await intents.flush();if(!flushed.ok)return;await settle();const current=await refresh(),currentProjection=current?.projection as any;
          if(!current||current.panelID!=="active-qso"||currentProjection?.status!=="ready")return;const result=await send({action:"entry_edit_last",params:{draftID:currentProjection.draft.draftID,expectedDraftRevision:currentProjection.draft.revision}},current.projectionRevision);
          if(result.applied)await openContestContactEditorWindow(context);})()}>Edit last</button>
      </div>{operator&&<details className="contest-surface-macro-bank" open={macrosOpen} onToggle={event=>setMacrosOpen(event.currentTarget.open)}
        title={phoneMode&&!operator.outputAvailable?"Recorded phone is optional; manual QSO logging remains available.":undefined}><summary>Function key macros</summary><div className="contest-surface-macros" role="group" aria-label="Function key macros">{Array.from({length:12},(_,index)=>{const key=`F${index+1}`,item=operator.functionKeys.find((item:any)=>item.key===key),label=item?.macro??"Unassigned";return <button type="button" key={key}
        className={item?.highlighted?"contest-primary":undefined} disabled={disabled||!item||!operator.outputAvailable||operator.status==="uncertain"||phoneMode&&!operator.armed}
        aria-label={`${key} ${label}`} onClick={()=>operatorKey(key,operator.focusedField)}><kbd>{key}:</kbd> <span>{label}</span></button>;})}</div></details>}
        {operator&&!operator.outputAvailable&&!phoneMode&&<p role="status">{operator.outputUnavailableReason}</p>}</>}
    </div></div>
    <div className="contest-surface-contact-footer"><div className="contest-surface-contact-path"><div aria-label="Contact heading, long path and distance">{projection.manual?.headingDegrees??"—"}° Hdg · LP {projection.manual?.longPathHeadingDegrees??"—"}° / distance {projection.manual?.distanceKm??"—"} km</div><div aria-label="Country and zones">{projection.manual?.country??"—"} cq:{projection.manual?.cqZone??"—"} itu:{projection.manual?.ituZone??"—"}</div></div><output aria-label="QSOs and multipliers"><span>QSO / mults</span><strong>{projection.manual?.qsos??"—"}/{projection.manual?.multipliers??"—"}</strong></output><output aria-label="Score"><span>Score</span><strong>{projection.manual?.total??"—"}</strong></output></div>
    </section>;
}
function Check({ projection, disabled, projectionRevision, receipts, send }: { projection: any; disabled: boolean;
  projectionRevision:number;receipts:ContestSurfaceTerminalReceipt[];send: Send }) {
  const base={draftID:projection.draftID,expectedDraftRevision:projection.draftRevision};
  const availability=projection.scp.availability??(projection.scp.source?"ready":"not_imported");
  const unavailableMessage=availability==="invalid_cache"?"The saved local MASTER.SCP index is invalid. Download the latest official file or refresh after repairing it.":
    availability==="replacing"?"MASTER.SCP is currently being replaced. Refresh to check its status.":
    availability==="stopped"?"Super Check Partial is stopped. Refresh after the contest service restarts.":
    availability==="status_unavailable"?"Local SCP status is unavailable. Any previously active corpus is retained.":
    "No local MASTER.SCP corpus is active.";
  const assistance=(action:"assistance_download"|"assistance_refresh")=>void send({action,params:base},projectionRevision);
  const candidateLabel=(callsign:string)=>{
    const query=String(projection.inputCallsign??"").trim().toUpperCase();
    const substring=callsign.indexOf(query);
    return <span className="contest-check-callsign" aria-label={callsign}>{callsign===query?<em className="contest-check-exact">{callsign}</em>:[...callsign].map((character,index)=>{
      const extra=substring>=0?(index<substring||index>=substring+query.length):index>=query.length;
      const changed=substring<0&&index<query.length&&character!==query[index];
      return <span key={`${index}-${character}`} className={extra?"contest-check-extra":changed?"contest-check-changed":"contest-check-match"}>{character}</span>;
    })}</span>;
  };
  const candidates=(kind:"log"|"scp"|"cluster"|"history",items:any[])=>items.length?<ContestCandidates className="contest-surface-results"
    disabled={disabled} strongLabel={false} candidates={items.map(item=>({id:item.candidateID,label:candidateLabel(item.callsign),
      detail:kind==="history"?item.fields.map((field:any)=>`${field.label}: ${field.value}`).join(" · "):undefined,
      className:kind==="history"?"contest-surface-history":undefined}))}
    onSelect={candidateID=>void send({action:"assistance_select",params:{...base,kind,candidateID}},projectionRevision)}/>:<p>—</p>;
  const panes=[
    {key:"log",title:"Log",body:projection.loggedCandidates?candidates("log",projection.loggedCandidates):<p aria-label="Matching logged calls unavailable">—</p>},
    {key:"scp",title:"Master",body:candidates("scp",projection.scp.candidates)},
    ...(projection.clusterCandidates?.length?[{key:"cluster",title:"Telnet",body:candidates("cluster",projection.clusterCandidates)}]:[]),
    ...(projection.history.rows.length?[{key:"history",title:"Call History",body:candidates("history",projection.history.rows)}]:[]),
  ];
  return <section className="contest-surface-check"><h1>Check Partial</h1>
    <details className="contest-surface-check-tools">
      <summary>{projection.scp.source??"MASTER.SCP unavailable"}</summary><div role="region" aria-label="Super Check Partial corpus">
      <section>{availability!=="ready"&&<p>{unavailableMessage}</p>}</section>
      <div><button type="button" disabled={disabled} onClick={()=>assistance("assistance_download")}>Download latest</button>
        <button type="button" disabled={disabled} onClick={()=>assistance("assistance_refresh")}>Refresh</button>
        {projection.scp.error&&<button type="button" disabled={disabled} onClick={()=>assistance(availability==="status_unavailable"?"assistance_refresh":"assistance_download")}>Retry</button>}</div>
    </div></details>
    <div className="contest-surface-check-columns" data-pane-count={panes.length}>
      {panes.map(pane=><div key={pane.key}><h2>{pane.title}</h2>{pane.body}</div>)}
    </div></section>;
}
function Statistics({ projection }: { projection: ContestStatisticsSurfaceProjection }) {
  if (projection.schemaVersion === 1)
    return <section className="contest-surface-statistics"><h1>Statistics</h1><ContestScoreSummary score={projection.score} detached/></section>;
  if (projection.layout === "cq_ww") {
    const rows=[...projection.rows,projection.total];
    return <section className="contest-surface-statistics contest-surface-statistics-v3" aria-label="CQ WW Statistics" aria-busy={projection.busy}>
      <div className="contest-surface-statistics-scroll" role="region" aria-label="CQ WW contest statistics" tabIndex={0}><table aria-label="CQ WW statistics"><thead><tr>
        {(["BAND","QSO","PTS","ZN","CTY"] as const).map(label=><th key={label} scope="col">{label}</th>)}
      </tr></thead><tbody>{rows.map(row=><tr key={row.band} className={row.band==="TOTAL"?"contest-surface-statistics-total":undefined}>
        <th scope="row">{row.band}</th><td>{row.qsos.toLocaleString()}</td><td>{row.points.toLocaleString()}</td>
        <td>{row.zones.toLocaleString()}</td><td>{row.countries.toLocaleString()}</td>
      </tr>)}</tbody></table></div>
      <footer className="contest-surface-statistics-score"><span>Claimed score</span><strong>{projection.score?.claimedScore.toLocaleString()??"—"}</strong></footer>
    </section>;
  }
  const rows = [...projection.rows, projection.total];
  return <section className="contest-surface-statistics contest-surface-statistics-v3" aria-label="Statistics" aria-busy={projection.busy}>
    <div className="contest-surface-statistics-scroll" role="region" aria-label="Scrollable contest statistics" tabIndex={0}><table aria-label="Contest statistics"><thead><tr>
      {(["BAND", "QSO", "CALLS", "CW", "PH", "DI", "WPX", "PTS"] as const).map(label => <th key={label} scope="col">{label}</th>)}
    </tr></thead><tbody>{rows.map(row => <tr key={row.band} className={row.band === "TOTAL" ? "contest-surface-statistics-total" : undefined}>
      <th scope="row">{row.band}</th><td>{row.qsos.toLocaleString()}</td><td>{row.calls.toLocaleString()}</td>
      <td>{row.cw.toLocaleString()}</td><td>{row.phone.toLocaleString()}</td><td>{row.digital.toLocaleString()}</td>
      <td>{row.wpx.toLocaleString()}</td><td>{row.points.toLocaleString()}</td>
    </tr>)}</tbody></table></div>
  </section>;
}
function Rates({ projection }: { projection: ContestRatesSurfaceProjection }) {
  const rates = [["Last hour", projection.lastHourQsoPerHour,"current"], ["10 Last QSO", projection.last10QsoPerHour,"ten"],
    ["100 Last QSO", projection.last100QsoPerHour,"hundred"]] as const;
  const sinceLabel = `Since ${String(projection.sinceHourUTC).padStart(2, "0")}:00:00z`;
  return <section aria-label="Contest Rates" aria-busy={projection.busy} className="contest-surface-rates"><h1>Rates</h1>
    <p className="contest-surface-rate-scope">All bands · All modes</p><dl>{rates.map(([label, value,kind]) => <div key={label} className={`contest-surface-rate-${kind}`}><dt>{label}:</dt><dd>{value === null ? <span aria-label="Not enough contacts">—</span> : value.toLocaleString(undefined, { maximumFractionDigits: 2 })} <small>Q/h</small></dd></div>)}
      <div className="contest-surface-rate-since"><dt>{sinceLabel}:</dt><dd>{projection.sinceHourQso.toLocaleString()} <small>QSO</small></dd></div></dl>
    <table aria-label="Run and Search & Pounce QSOs"><tbody>{[["Run QSO",projection.runQso],["S&P QSO",projection.searchAndPounceQso],
      ["Hour Run QSO",projection.hourRunQso],["Hour S&P QSO",projection.hourSearchAndPounceQso]].map(([label,value])=><tr key={label} className={String(label).includes("S&P")?"contest-surface-rate-search":"contest-surface-rate-run"}><th scope="row">{label}:</th><td>{value.toLocaleString()}</td></tr>)}</tbody></table>
  </section>;
}
function Matrix({ projection,preferenceScope }: { projection: ContestMatrixSurfaceProjection;preferenceScope:string }) {
  const rich = projection.schemaVersion === 4 ? projection : null;
  const preferenceKey=`xlog.contesting.matrix-view.v1/${preferenceScope}/${rich?.tracker??projection.title.toLocaleLowerCase()}`;
  const restored=()=>{try{return JSON.parse(localStorage.getItem(preferenceKey)??"null") as {bandScope?:string;rowFilter?:string}|null;}catch{return null;}},
    initial=restored();
  const [bandScope,setBandScope]=useState<"configured"|"current"|"all">(()=>(["configured","current","all"].includes(initial?.bandScope??"")?initial!.bandScope:"configured") as "configured"|"current"|"all"),
    [rowFilter,setRowFilter]=useState<"needed"|"worked"|"all">(()=>(["needed","worked","all"].includes(initial?.rowFilter??"")?initial!.rowFilter:"all") as "needed"|"worked"|"all");
  const [viewportWidth,setViewportWidth]=useState(()=>window.innerWidth);
  const rows = useRef(new Map<string, HTMLTableRowElement>()),lastFollowed=useRef("");
  const selectedLabel = rich?.tracker === "dxcc" ? rich.current.dxcc : rich?.tracker === "zone"
    ? String(rich.zoneSystem === "itu" ? rich.current.ituZone ?? "" : rich.current.cqZone ?? "") : null;
  const selectedKey = selectedLabel?.trim().toLocaleUpperCase() ?? "";
  const configured=rich?.configuredBands?.length?rich.configuredBands:projection.bands;
  const visibleBands=bandScope==="all"?projection.bands:bandScope==="current"&&rich?.currentBand?[rich.currentBand]:configured;
  const projectedRows=useMemo(()=>{const dxcc=rich?.tracker==="dxcc"||projection.title==="DXCC",
    source=projection.rows.filter(row=>!dxcc||visibleBands.some(band=>(row.counts[band]??0)>0));
    if(!dxcc&&selectedKey&&!source.some(row=>row.label.trim().toLocaleUpperCase()===selectedKey))source.push({label:selectedLabel!,counts:Object.fromEntries(projection.bands.map(band=>[band,0])),total:0});
    return source.filter(row=>{const worked=visibleBands.some(band=>(row.counts[band]??0)>0);
      const needed=visibleBands.some(band=>(row.counts[band]??0)===0);
      return rowFilter==="all"?true:rowFilter==="worked"?worked:needed;});
  },[projection.rows,projection.bands,projection.title,rich?.tracker,selectedKey,selectedLabel,visibleBands.join("\u001f"),rowFilter]);
  useEffect(()=>{try{localStorage.setItem(preferenceKey,JSON.stringify({bandScope,rowFilter}));}catch{/* Display preferences remain optional. */}},[preferenceKey,bandScope,rowFilter]);
  useEffect(()=>{const resized=()=>setViewportWidth(window.innerWidth);window.addEventListener("resize",resized);return()=>window.removeEventListener("resize",resized);},[]);
  useEffect(() => { if(selectedKey&&lastFollowed.current!==selectedKey)rows.current.get(selectedKey)?.scrollIntoView?.({ block: "center", inline: "nearest" });
    lastFollowed.current=selectedKey;}, [selectedKey]);
  const workedInView=projection.rows.filter(row=>visibleBands.some(band=>(row.counts[band]??0)>0)).length;
  const blockMinWidth=Math.max(148,104+visibleBands.length*44),requestedBlocks=Math.max(1,Math.floor((viewportWidth-16)/blockMinWidth)),
    blockCount=Math.max(1,Math.min(requestedBlocks,projectedRows.length||1)),
    rowsPerBlock=Math.ceil(projectedRows.length/blockCount),blocks=Array.from({length:blockCount},(_,index)=>projectedRows.slice(index*rowsPerBlock,(index+1)*rowsPerBlock));
  return <section aria-label={`Contest ${projection.title}`} aria-busy={projection.busy} className="contest-surface-matrix"><header className="contest-surface-matrix-toolbar"><h1>{projection.title}</h1>
    {rich&&<><label>Band<select aria-label="Multiplier band scope" value={bandScope} onChange={event=>setBandScope(event.target.value as typeof bandScope)}>
      <option value="configured">Configured</option><option value="current" disabled={!rich.currentBand}>Current</option><option value="all">All</option></select></label>
      <label>Show<select aria-label="Multiplier row filter" value={rowFilter} onChange={event=>setRowFilter(event.target.value as typeof rowFilter)}>
        <option value="needed">Needed</option><option value="worked">Worked</option><option value="all">All</option></select></label></>}
    <span className="contest-surface-matrix-summary"><span>{rich&&`${projectedRows.length.toLocaleString()} shown · `}{workedInView.toLocaleString()} worked in view</span>
      {workedInView!==projection.total&&<span>{projection.total.toLocaleString()} unique total</span>}</span></header>
      <div className="contest-surface-matrix-scroll"><div className="contest-surface-matrix-blocks" style={{gridTemplateColumns:`repeat(${blockCount},minmax(${blockMinWidth}px,1fr))`}}>{blocks.map((block,blockIndex)=><table
        key={blockIndex} aria-label={blockIndex===0?`${projection.title} by band`:`${projection.title} by band continuation ${blockIndex+1}`}><thead><tr><th scope="col">{projection.title === "DXCC" ? "DXCC" : "Zone"}</th>
        {visibleBands.map(band => <th key={band} scope="col">{band}</th>)}<th scope="col">Total</th></tr></thead><tbody>
        {block.map(row => { const key = row.label.trim().toLocaleUpperCase(), current = !!selectedKey && key === selectedKey,
          visibleTotal=visibleBands.reduce((sum,band)=>sum+(row.counts[band]??0),0); return <tr key={row.label}
          ref={element => { if (element) rows.current.set(key, element); else rows.current.delete(key); }} aria-current={current ? "true" : undefined}>
          <th scope="row">{row.label}</th>{visibleBands.map(band => <td key={band} className={row.counts[band] > 0 ? "contest-surface-worked" : undefined}>
          {(row.counts[band]??0).toLocaleString()}</td>)}<td>{visibleTotal.toLocaleString()}</td></tr>; })}
      </tbody></table>)}</div></div>
  </section>;
}
function ManualLogTable({rows,disabled,onEdit,onDeleteMenu,label,emptyMessage}:{rows:any[];disabled:boolean;onEdit:(qsoID:string)=>void;
    onDeleteMenu:(qsoID:string,callsign:string,event:ReactMouseEvent<HTMLElement>)=>void;label:string;emptyMessage?:string}) {
  const columns=["YYYY-MM-DD HH:MM:SS","Call","Freq","Snt","Rcv","M1","ZN","M2","PFX","PTS"];
  return <div className="contest-surface-log-scroll"><table className="contest-surface-original-log" aria-label={label}><thead><tr>{columns.map(title=><th key={title} scope="col">{title}</th>)}</tr></thead><tbody>{rows.length===0
    ? <tr className="contest-surface-empty-row"><td colSpan={columns.length}>{emptyMessage ?? (label === "Callsign partial matches" ? "No partial matches" : "No contacts")}</td></tr>
    : rows.map(row=><tr key={row.qsoID} onDoubleClick={event=>{if(!disabled&&!(event.target as Element).closest("button"))onEdit(row.qsoID);}}
      onContextMenu={event=>{event.preventDefault();if(!disabled)onEdit(row.qsoID);}}>
    <td>{row.TS??new Date(row.workedAt).toISOString().slice(0,19).replace("T"," ")}</td><td onContextMenu={event=>{event.preventDefault();event.stopPropagation();
      if(!disabled)onDeleteMenu(row.qsoID,String(row.Call??row.callsign??"Contact"),event);}}><button disabled={disabled} onDoubleClick={event=>event.stopPropagation()} onClick={()=>onEdit(row.qsoID)}>{row.Call??row.callsign}</button></td>
    <td>{row.Freq??"—"}</td><td>{row.SNT??"—"}</td><td>{row.RCV??"—"}</td>
    <td>{row.M1??""}</td><td>{row.ZN??"—"}</td><td>{row.M2??""}</td><td>{row.prefix??"—"}</td><td>{row.Points??row.points}</td></tr>)}</tbody></table></div>;
}
type InlineLogCell = { qsoID:string; columnIndex:number; source:string; edit:ContestLogInlineEdit; value:string;
  projectionRevision:number; expectedSessionRevision:number };
const contestLogColumnStoragePrefix="xlog.contesting.log-column-widths.v1:";
const minimumLogColumnWidth=4;
function defaultLogColumnWidths(columns:string[]) {
  const raw=columns.map(column=>{const value=column.toLowerCase();
    if(value.includes("yyyy")||value==="ts")return 19;
    if(value==="call")return 14;
    if(value.includes("country"))return 12;
    if(value.includes("freq"))return 11;
    if(value.includes("mult"))return 9;
    return 7;
  }),total=raw.reduce((sum,value)=>sum+value,0)||1;
  return raw.map(value=>value*100/total);
}
function readLogColumnWidths(columns:string[]) {
  const fallback=defaultLogColumnWidths(columns);
  try { const value=JSON.parse(localStorage.getItem(contestLogColumnStoragePrefix+columns.join("\u001f"))||"null");
    return Array.isArray(value)&&value.length===columns.length&&value.every(width=>typeof width==="number"&&Number.isFinite(width)&&width>=minimumLogColumnWidth)
      ? value as number[]:fallback;
  } catch { return fallback; }
}
function persistLogColumnWidths(columns:string[],widths:number[]) {
  try { localStorage.setItem(contestLogColumnStoragePrefix+columns.join("\u001f"),JSON.stringify(widths)); } catch { /* storage is optional */ }
}
function logCellClass(column:string,editable:boolean) {
  const normalized=column.trim().toLowerCase(),classes=editable?["contest-surface-inline-editable"]:[];
  if(["snt","rcv","cq zone","zn","pts","points"].includes(normalized))classes.push("contest-surface-log-centered");
  if(normalized==="call"||normalized==="callsign")classes.push("contest-surface-log-call");
  else if(normalized.includes("freq"))classes.push("contest-surface-log-frequency");
  else if(normalized==="band")classes.push("contest-surface-log-band");
  else if(normalized.includes("mult")||normalized==="m1"||normalized==="m2")classes.push("contest-surface-log-multiplier");
  else if(normalized.includes("zone")||normalized==="zn")classes.push("contest-surface-log-zone");
  else if(normalized==="country"||normalized==="pfx")classes.push("contest-surface-log-country");
  else if(normalized==="pts"||normalized==="points")classes.push("contest-surface-log-points");
  return classes.join(" ")||undefined;
}
function startLogColumnResize(event:ReactPointerEvent<HTMLButtonElement>,index:number,widths:number[],onWidths:(value:number[])=>void) {
  event.preventDefault();
  const table=event.currentTarget.closest("table"),tableWidth=Math.max(1,table?.getBoundingClientRect().width||table?.clientWidth||1),
    startX=event.clientX,start=widths[index],pairTotal=widths[index]+widths[index+1];
  const move=(next:PointerEvent)=>{const left=Math.max(minimumLogColumnWidth,Math.min(pairTotal-minimumLogColumnWidth,start+(next.clientX-startX)*100/tableWidth));
    const value=[...widths];value[index]=left;value[index+1]=pairTotal-left;onWidths(value);};
  const finish=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",finish);window.removeEventListener("pointercancel",finish);};
  window.addEventListener("pointermove",move);window.addEventListener("pointerup",finish);window.addEventListener("pointercancel",finish);
}
function PluginLogTable({columns,rows,columnWidths,onColumnWidths,disabled,onEdit,onDeleteMenu,onInlineEdit,inline,inlineInput,label,emptyMessage}:{columns:string[];
  rows:{qsoID:string;values:string[];isDupe?:boolean;inlineEdits?:(ContestLogInlineEdit|null)[]}[];columnWidths:number[];
  onColumnWidths:(value:number[])=>void;disabled:boolean;onEdit:(qsoID:string)=>void;
  onDeleteMenu:(qsoID:string,callsign:string,event:ReactMouseEvent<HTMLElement>)=>void;
  onInlineEdit:(qsoID:string,columnIndex:number,edit:ContestLogInlineEdit)=>void;inline:InlineLogCell|null;inlineInput:ReactNode;label:string;emptyMessage?:string}) {
  const callIndex=columns.indexOf("Call");
  const adjust=(index:number,delta:number)=>{const pairTotal=columnWidths[index]+columnWidths[index+1],
    left=Math.max(minimumLogColumnWidth,Math.min(pairTotal-minimumLogColumnWidth,columnWidths[index]+delta)),value=[...columnWidths];
    value[index]=left;value[index+1]=pairTotal-left;onColumnWidths(value);};
  return <div className="contest-surface-log-scroll"><table aria-label={label}><colgroup>{columns.map((column,index)=><col key={`${column}-${index}`} style={{width:`${columnWidths[index]??0}%`}}/>)}</colgroup><thead><tr>{columns.map((column,index)=><th key={`${column}-${index}`} scope="col"><span>{column}</span>{index<columns.length-1&&<button type="button" className="contest-surface-log-column-resizer" role="separator" aria-orientation="vertical" aria-label={`Resize ${column} column`} aria-valuemin={minimumLogColumnWidth} aria-valuemax={Math.round(columnWidths[index]+columnWidths[index+1]-minimumLogColumnWidth)} aria-valuenow={Math.round(columnWidths[index])}
      onPointerDown={event=>startLogColumnResize(event,index,columnWidths,onColumnWidths)} onKeyDown={event=>{if(event.key==="ArrowLeft"||event.key==="ArrowRight"){event.preventDefault();adjust(index,event.key==="ArrowLeft"?-2:2);}else if(event.key==="Home"){event.preventDefault();adjust(index,minimumLogColumnWidth-columnWidths[index]);}else if(event.key==="End"){event.preventDefault();adjust(index,columnWidths[index+1]-minimumLogColumnWidth);}}}/>}</th>)}</tr></thead>
    <tbody>{rows.length===0?<tr className="contest-surface-empty-row"><td colSpan={columns.length}>{emptyMessage ?? (label === "Callsign partial matches" ? "No partial matches" : "No contacts")}</td></tr>
      :rows.map(row=><tr key={row.qsoID} className={row.isDupe?"contest-surface-log-dupe":undefined} aria-label={row.isDupe?`${row.values[callIndex]??"Contact"} duplicate`:undefined} onContextMenu={event=>{event.preventDefault();if(!disabled)onEdit(row.qsoID);}}>
        {row.values.map((value,index)=>{const edit=row.inlineEdits?.[index]??null,
          isEditing=inline?.qsoID===row.qsoID&&inline.columnIndex===index&&inline.source===label;
          const content=<>{value}{index===callIndex&&row.isDupe&&<span className="contest-surface-dupe-badge">DUPE</span>}</>;
          return <td key={`${columns[index]}-${index}`} className={logCellClass(columns[index],!!edit)}
            onContextMenu={event=>{if(index!==callIndex)return;event.preventDefault();event.stopPropagation();
              if(!disabled)onDeleteMenu(row.qsoID,String(row.values[callIndex]??"Contact"),event);}}
            onDoubleClick={event=>{event.preventDefault();event.stopPropagation();if(!disabled&&edit)onInlineEdit(row.qsoID,index,edit);}}>
            {isEditing?inlineInput:index===callIndex&&!edit?<button disabled={disabled} onClick={()=>onEdit(row.qsoID)}>{content}</button>:content}</td>;})}</tr>)}</tbody></table></div>;
}
function ReadOnlyContactField({label,value,wide=false}:{label:string;value:string;wide?:boolean}) {
  return <div className={`contest-surface-readonly${wide?" contest-surface-editor-wide":""}`}><span>{label}</span><output>{value}</output></div>;
}
function ContactEditor({projection,disabled,sending,projectionRevision,receipts,send}:{projection:any;disabled:boolean;sending:boolean;projectionRevision:number;receipts:ContestSurfaceTerminalReceipt[];send:Send}) {
  const editing=projection.editing;
  if(!editing)return <section className="contest-surface-contact-editor contest-surface-unavailable"><h1>Edit Contact</h1>
    <p>The selected contact is no longer being edited. Choose it again in Log Display.</p>
    <button type="button" onClick={()=>void closeContestContactEditorWindow()}>Close</button></section>;
  const finish=async(action:ContestSurfaceAction)=>{const result=await send(action,projectionRevision);if(result.applied)await closeContestContactEditorWindow();};
  const details=editing.details??{};
  const entryFields=Array.isArray(editing.entryFields)?editing.entryFields:null;
  const entryLabels=new Set((entryFields??[]).map((field:any)=>String(field.label??"").trim().toLowerCase()));
  const renderEntryField=(field:any)=><div key={field.id} className={`contest-surface-editor-field${String(field.label??"").trim().toLowerCase()==="comment"?" contest-surface-editor-wide":""}`}>{field.readOnly
    ?<ReadOnlyContactField label={field.label} value={field.value}/>
    :<IntentInput label={field.label} value={field.value} identity={`${editing.qsoID}/field/${field.id}`} projectionRevision={projectionRevision}
      receipts={receipts} disabled={disabled||field.enabled===false} maximumUTF8Bytes={field.maximumUTF8Bytes} send={send}
      action={value=>field.id==="sent"||field.id==="receive"?{action:"log_edit_set_text",params:{qsoID:editing.qsoID,
        field:field.id==="sent"?"sentReport":"receivedReport",value}}:{action:"log_edit_set_exchange",params:{qsoID:editing.qsoID,fieldID:field.id,value}}}/>}</div>;
  const topEntryFields=entryFields?.filter((field:any)=>["sent","receive"].includes(field.id)||["name","qth","comment"].includes(String(field.label??"").trim().toLowerCase()))??[];
  const lowerEntryFields=entryFields?.filter((field:any)=>!topEntryFields.includes(field))??[];
  return <section className="contest-surface-contact-editor"><header><h1>Edit Contact</h1><span>{editing.callsign}</span></header>
    <div className="contest-surface-editor"><div className="contest-surface-editor-primary"><IntentInput label="Callsign" value={editing.callsign} identity={`${editing.qsoID}/callsign`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={32} send={send} action={value=>({action:"log_edit_set_text",params:{qsoID:editing.qsoID,field:"callsign",value}})}/>
    <IntentInput label="TimeStamp (UTC)" value={editing.workedAt??""} identity={`${editing.qsoID}/timestamp`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={32} send={send} action={value=>({action:"log_edit_set_text",params:{qsoID:editing.qsoID,field:"timestamp",value}})}/>
    <ReadOnlyContactField label="RX" value={details.rxFrequency??""}/>
    <IntentInput label="Tx Freq (Hz)" value={editing.editFrequencyText} identity={`${editing.qsoID}/frequency`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={11} send={send} action={value=>({action:"log_edit_set_frequency_text",params:{qsoID:editing.qsoID,value}})}/>
    <ReadOnlyContactField label="Mode" value={editing.mode}/><ReadOnlyContactField label="Contest" value={details.contest??""}/>
    {entryFields?topEntryFields.map(renderEntryField):editing.reportsVisible!==false&&<><IntentInput label="RST Sent" value={editing.sentReport} identity={`${editing.qsoID}/sentReport`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={160} send={send} action={value=>({action:"log_edit_set_text",params:{qsoID:editing.qsoID,field:"sentReport",value}})}/>
      <IntentInput label="RST Rcv" value={editing.receivedReport} identity={`${editing.qsoID}/receivedReport`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={160} send={send} action={value=>({action:"log_edit_set_text",params:{qsoID:editing.qsoID,field:"receivedReport",value}})}/></>}
    <ReadOnlyContactField label="Country" value={details.country??""}/><ReadOnlyContactField label="Station Call" value={details.stationCall??""}/>
    {!entryLabels.has("name")&&<IntentInput label="Name" value={editing.name??details.name??""} identity={`${editing.qsoID}/name`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={20} send={send} action={value=>({action:"log_edit_set_text",params:{qsoID:editing.qsoID,field:"name",value}})}/>}
    {!entryLabels.has("qth")&&<IntentInput label="QTH" value={editing.qth??details.qth??""} identity={`${editing.qsoID}/qth`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={25} send={send} action={value=>({action:"log_edit_set_text",params:{qsoID:editing.qsoID,field:"qth",value}})}/>}
    {!entryLabels.has("comment")&&<div className="contest-surface-editor-wide"><IntentInput label="Comment" value={editing.comment??details.comment??""} identity={`${editing.qsoID}/comment`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={60} send={send} action={value=>({action:"log_edit_set_text",params:{qsoID:editing.qsoID,field:"comment",value}})}/></div>}
    </div><div className="contest-surface-editor-secondary">
    {entryFields?lowerEntryFields.map(renderEntryField):editing.receivedFields.map((field:any)=><IntentInput key={field.id} label={field.label} value={field.value} identity={`${editing.qsoID}/exchange/${field.id}`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={field.maximumUTF8Bytes} send={send} action={value=>({action:"log_edit_set_exchange",params:{qsoID:editing.qsoID,fieldID:field.id,value}})}/>)}
    <ReadOnlyContactField label="Nr" value={details.receivedNumber??""}/><ReadOnlyContactField label="Nr Sent" value={details.sentNumber??""}/>
    <ReadOnlyContactField label="Points" value={details.points??""}/><ReadOnlyContactField label="Power" value={details.power??""}/>
    <ReadOnlyContactField label="Zone" value={details.zone??""}/><ReadOnlyContactField label="Section" value={details.section??""}/>
    <ReadOnlyContactField label="Multiplier 1" value={details.multiplier1??""}/><ReadOnlyContactField label="Band" value={editing.band}/>
    <ReadOnlyContactField label="Check" value={details.check??""}/><ReadOnlyContactField label="Precedence" value={details.precedence??""}/>
    <ReadOnlyContactField label="Multiplier 2" value={details.multiplier2??""}/><ReadOnlyContactField label="WPX" value={details.wpx??""}/>
    <ReadOnlyContactField label="Exchange" value={details.exchange??""}/><ReadOnlyContactField label="Run 1/2" value={details.run??""}/>
    <ReadOnlyContactField label="Multiplier 3" value={details.multiplier3??""}/><ReadOnlyContactField label="Radio" value={details.radio??""}/>
    <ReadOnlyContactField label="Grid" value={details.grid??""}/>
    <IntentInput label="Op" value={editing.operator??""} identity={`${editing.qsoID}/operator`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={32} send={send} action={value=>({action:"log_edit_set_text",params:{qsoID:editing.qsoID,field:"operator",value}})}/>
    <ReadOnlyContactField label="Misc" value={details.misc??""}/><ReadOnlyContactField label="Rover QTH" value={details.roverQTH??""}/>
    </div><div className="contest-surface-editor-note"><IntentInput label="Correction note" value={editing.correctionReason} identity={`${editing.qsoID}/correctionReason`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={1024} send={send} action={value=>({action:"log_edit_set_text",params:{qsoID:editing.qsoID,field:"correctionReason",value}})}/></div>
    </div>{editing.frequencyError&&<p role="alert">{editing.frequencyError}</p>}
    {editing.confirmDelete&&<div className="contest-surface-delete"><IntentInput label="Deletion reason" value={editing.deletionReason} identity={`${editing.qsoID}/deletionReason`} projectionRevision={projectionRevision} receipts={receipts} disabled={disabled} maximumUTF8Bytes={1024} send={send} action={value=>({action:"log_edit_set_text",params:{qsoID:editing.qsoID,field:"deletionReason",value}})}/>
      <button disabled={disabled||sending||!editing.deletionReason.trim()} onClick={()=>void finish({action:"log_edit_delete",params:{qsoID:editing.qsoID,expectedSessionRevision:projection.sessionRevision}})}>Delete contact</button></div>}
    <footer className="contest-surface-editor-actions"><button disabled={disabled||sending} aria-pressed={editing.confirmDelete} onClick={()=>void send({action:"log_edit_confirm_delete",params:{qsoID:editing.qsoID,confirmed:!editing.confirmDelete}},projectionRevision)}>{editing.confirmDelete?"Keep contact":"Delete…"}</button>
      <button disabled={disabled||sending} onClick={()=>void finish({action:"log_edit_cancel",params:{qsoID:editing.qsoID}})}>Cancel</button>
      <button disabled={disabled||sending||!!editing.frequencyError||!editing.correctionReason.trim()} onClick={()=>void finish({action:"log_edit_save",params:{qsoID:editing.qsoID,expectedSessionRevision:projection.sessionRevision}})}>OK</button></footer>
  </section>;
}
function Log({projection,disabled,sending,projectionRevision,send,openEditor}:{projection:any;disabled:boolean;sending:boolean;projectionRevision:number;send:Send;
    openEditor:(qsoID:string,deleteIntent?:boolean)=>Promise<void>}) {
  const partialRows=projection.partialRows??[], pluginPartialRows=projection.pluginPartialRows??[], [inline,setInline]=useState<InlineLogCell|null>(null);
  const [deleteMenu,setDeleteMenu]=useState<{qsoID:string;callsign:string;x:number;y:number}|null>(null);
  const pluginColumns:string[]=projection.exchangeLayout==="plugin"?projection.pluginColumns:[],columnSignature=pluginColumns.join("\u001f"),
    [columnLayout,setColumnLayout]=useState(()=>({signature:columnSignature,widths:readLogColumnWidths(pluginColumns)}));
  const columnWidths=columnLayout.signature===columnSignature?columnLayout.widths:readLogColumnWidths(pluginColumns);
  useEffect(()=>{if(columnLayout.signature!==columnSignature)setColumnLayout({signature:columnSignature,widths:readLogColumnWidths(pluginColumns)});},[columnLayout.signature,columnSignature]);
  const setColumnWidths=useCallback((widths:number[])=>{persistLogColumnWidths(pluginColumns,widths);setColumnLayout({signature:columnSignature,widths});},[columnSignature]);
  const primaryPane=useRef<HTMLElement|null>(null);
  useLayoutEffect(()=>{
    const element=primaryPane.current;
    if(!element||typeof ResizeObserver==="undefined")return;
    let last=projection.page.limit;
    const resize=new ResizeObserver(()=>{
      const next=Math.max(1,Math.min(20,Math.floor((element.clientHeight-48)/24)));
      if(next===last||next===projection.page.limit)return;
      last=next;
      const offset=Math.floor(projection.page.offset/next)*next;
      void send({action:"log_page",params:{offset,limit:next}},projectionRevision);
    });
    resize.observe(element);return()=>resize.disconnect();
  },[projection.page.limit,projection.page.offset,projectionRevision,send]);
  const beginInline=async(qsoID:string,columnIndex:number,edit:ContestLogInlineEdit,source:string)=>{
    const result=await send({action:"log_edit_begin",params:{qsoID}},projectionRevision);
    if(result.applied&&result.projectionRevision!==null)setInline({qsoID,columnIndex,source,edit,value:edit.value,
      projectionRevision:result.projectionRevision,expectedSessionRevision:projection.sessionRevision});
  };
  const cancelInline=async()=>{if(!inline)return;const current=inline;setInline(null);
    await send({action:"log_edit_cancel",params:{qsoID:current.qsoID}},current.projectionRevision,{safePresentation:true});};
  const commitInline=async()=>{if(!inline)return;const current=inline;
    const setter:ContestSurfaceAction=current.edit.kind==="text"
      ? {action:"log_edit_set_text",params:{qsoID:current.qsoID,field:current.edit.field,value:current.value}}
      : current.edit.kind==="exchange"
        ? {action:"log_edit_set_exchange",params:{qsoID:current.qsoID,fieldID:current.edit.fieldID,value:current.value}}
        : {action:"log_edit_set_frequency_text",params:{qsoID:current.qsoID,value:current.value}};
    if(current.value===current.edit.value){await cancelInline();return;}
    const changed=await send(setter,current.projectionRevision,{safePresentation:true});
    if(!changed.applied||changed.projectionRevision===null)return;
    const saved=await send({action:"log_edit_save",params:{qsoID:current.qsoID,expectedSessionRevision:current.expectedSessionRevision}},
      changed.projectionRevision,{safePresentation:true});
    if(saved.applied)setInline(null);
  };
  const inlineInput=inline?<input aria-label={`Edit ${projection.pluginColumns?.[inline.columnIndex]??"log cell"}`} autoFocus
    disabled={disabled||sending} value={inline.value} onChange={event=>{const value=event.target.value;
      if(new TextEncoder().encode(value).length<=inline.edit.maximumUTF8Bytes)setInline(current=>current?{...current,value}:current);}}
    onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();void commitInline();}else if(event.key==="Escape"){event.preventDefault();void cancelInline();}}}/>:null;
  const openDeleteMenu=(qsoID:string,callsign:string,event:ReactMouseEvent<HTMLElement>)=>setDeleteMenu({qsoID,callsign,
    x:Math.max(4,Math.min(event.clientX,window.innerWidth-176)),y:Math.max(4,Math.min(event.clientY,window.innerHeight-80))});
  return <section className="contest-surface-log"><header><h1>Log Display</h1>
  <details className="contest-surface-log-tools"><summary>Log tools</summary><div className="contest-surface-log-actions">{projection.canExportCabrillo&&<button disabled={disabled||sending} onClick={()=>void send({action:"log_export_cabrillo",params:{}},projectionRevision)}>Export Cabrillo…</button>}
  <button disabled={disabled||sending||projection.canExportAdif!==true} onClick={()=>void send({action:"log_export_adif",params:{}},projectionRevision)}>Export ADIF…</button>
  {projection.canExportEdi===true&&<button disabled={disabled||sending} onClick={()=>void send({action:"log_export_edi",params:{}},projectionRevision)}>Export EDI…</button>}
  <button disabled={disabled||sending} onClick={()=>void send({action:"log_recalculate",params:{expectedSessionRevision:projection.sessionRevision}},projectionRevision)}>Recalculate</button></div></details></header>
  <div className="contest-surface-log-panes">{projection.exchangeLayout==="plugin" ? <>
    <section ref={primaryPane} className="contest-surface-log-pane-primary"><h2>Chronological log</h2><PluginLogTable columns={projection.pluginColumns} rows={projection.pluginRows} columnWidths={columnWidths} onColumnWidths={setColumnWidths} disabled={disabled} label="Contest log" emptyMessage={projection.busy?"Loading…":undefined} inline={inline} inlineInput={inlineInput}
      onInlineEdit={(qsoID,columnIndex,edit)=>void beginInline(qsoID,columnIndex,edit,"Contest log")} onEdit={qsoID=>{setInline(null);void openEditor(qsoID);}} onDeleteMenu={openDeleteMenu}/></section>
    <section className="contest-surface-log-pane-secondary"><h2>Callsign partial matches</h2><PluginLogTable columns={projection.pluginColumns} rows={pluginPartialRows} columnWidths={columnWidths} onColumnWidths={setColumnWidths} disabled={disabled} label="Callsign partial matches" inline={inline} inlineInput={inlineInput}
      onInlineEdit={(qsoID,columnIndex,edit)=>void beginInline(qsoID,columnIndex,edit,"Callsign partial matches")} onEdit={qsoID=>{setInline(null);void openEditor(qsoID);}} onDeleteMenu={openDeleteMenu}/></section></>
    : <><section ref={primaryPane} className="contest-surface-log-pane-primary"><h2>Chronological log</h2><ManualLogTable rows={projection.manualRows??projection.page.rows} disabled={disabled} label="Contest log" emptyMessage={projection.busy?"Loading…":undefined} onEdit={qsoID=>void openEditor(qsoID)} onDeleteMenu={openDeleteMenu}/></section>
      <section className="contest-surface-log-pane-secondary"><h2>Callsign partial matches</h2><ManualLogTable rows={partialRows} disabled={disabled} label="Callsign partial matches" onEdit={qsoID=>void openEditor(qsoID)} onDeleteMenu={openDeleteMenu}/></section></>}</div>
  {deleteMenu&&<div className="contest-spot-menu" role="menu" aria-label={`Contact actions for ${deleteMenu.callsign}`} style={{left:deleteMenu.x,top:deleteMenu.y}}
      onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();setDeleteMenu(null);}}}>
    <button type="button" role="menuitem" autoFocus onClick={()=>{const target=deleteMenu;setDeleteMenu(null);setInline(null);void openEditor(target.qsoID,true);}}>Delete contact…</button>
    <button type="button" role="menuitem" onClick={()=>setDeleteMenu(null)}>Cancel</button></div>}
  <footer><button disabled={disabled||projection.page.offset===0} onClick={()=>void send({action:"log_page",params:{offset:Math.max(0,projection.page.offset-projection.page.limit),limit:projection.page.limit}},projectionRevision)}>Previous</button>
    <span>{projection.page.total?`${projection.page.offset+1}–${projection.page.offset+projection.page.rows.length} of ${projection.page.total}`:projection.busy?"Loading…":"No contacts"}</span>
    <button disabled={disabled||projection.page.offset+projection.page.rows.length>=projection.page.total} onClick={()=>void send({action:"log_page",params:{offset:projection.page.offset+projection.page.limit,limit:projection.page.limit}},projectionRevision)}>Next</button></footer></section>; }

function SharedContestSurface() {
  const context = useMemo(() => contestSurfaceContextFromSearch(window.location.search), []);
  return <div className="app live contest-detached-surface"><Surface context={context}/></div>;
}

export function DetachedContestSurface() {
  return new URLSearchParams(window.location.search).get("view") === "qrz-details"
    ? <ContestQRZDetailsSurface/> : <SharedContestSurface/>;
}

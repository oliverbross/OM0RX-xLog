import { useEffect, useRef, useState } from "react";
import type { ContestRequest } from "./types";
import { ContestServerError } from "./client";
import type { ContestExportSavePrepared } from "./contestExportSave";

type NoteLane = {laneID?:"laneA"|"laneB";bindingVersion?:number;bindingGeneration?:string|number|null};
type Scope = { sessionID:string; workspaceGeneration:string; revision:number; draftID:string } & NoteLane;
export type NoteTarget = ({draftID:string}|{qsoID:string}) & NoteLane;
type Note = {id:string;draft_id:string|null;qso_id:string|null;body:string;created_utc:string;callsign:string|null};
const message=(cause:unknown)=>cause instanceof Error?cause.message:String(cause);
async function read<T>(request:ContestRequest,method:Parameters<ContestRequest>[0],params:Record<string,unknown>):Promise<T>{
  const frame=await request<T>(method,params);if(!frame.ok)throw Error(frame.error.message||"The contest read failed.");return frame.result;
}

export function ContestNotesPanel({scope,request,disabled,onSave,onLast}:{scope:Scope;request:ContestRequest;disabled:boolean;
  onSave(target:NoteTarget,text:string,noteID:string):Promise<void>;onLast():Promise<{qsoID:string;callsign:string}&NoteLane>}) {
  const [target,setTarget]=useState<{identity:NoteTarget;label:string;sessionID:string}|null>(null),[text,setText]=useState("");
  const [notes,setNotes]=useState<Note[]>([]),[offset,setOffset]=useState(0),[total,setTotal]=useState(0),[error,setError]=useState("");
  const [saving,setSaving]=useState(false),[uncertain,setUncertain]=useState(false);
  const [recoveryFailure,setRecoveryFailure]=useState<{message:string;raw:string|null}|null>(null);
  const pending=useRef<{target:NoteTarget;text:string;noteID:string}|null>(null),ticket=useRef(0);
  const identity=`${scope.sessionID}/${scope.workspaceGeneration}`;
  const readIdentity=`${identity}/${scope.laneID??"laneA"}`;
  const laneTarget:NoteLane=scope.laneID?{laneID:scope.laneID,bindingVersion:scope.bindingVersion,bindingGeneration:scope.bindingGeneration}:{};
  const laneLabel=scope.laneID?` · ${scope.laneID==="laneA"?"Lane A":"Lane B"}`:"";
  const recoveryKey=`xlog.contest.note-editor.v1/${identity}`;
  const readRecovery=()=>{setTarget(null);setText("");pending.current=null;setUncertain(false);setRecoveryFailure(null);
    let raw:string|null=null;
    try{raw=localStorage.getItem(recoveryKey);if(raw===null)return;const saved=JSON.parse(raw);
      if(typeof saved.noteID!=="string"||typeof saved.text!=="string"||!saved.target||
        !(typeof saved.target.draftID==="string"||typeof saved.target.qsoID==="string")||
        saved.target.laneID!==undefined&&!["laneA","laneB"].includes(saved.target.laneID)||
        saved.target.bindingVersion!==undefined&&(!Number.isSafeInteger(saved.target.bindingVersion)||saved.target.bindingVersion<0)||
        saved.target.bindingGeneration!==undefined&&saved.target.bindingGeneration!==null&&typeof saved.target.bindingGeneration!=="string"&&typeof saved.target.bindingGeneration!=="number")throw new Error("Invalid saved note identity.");
      pending.current=saved;setTarget({identity:saved.target,label:`Recovered ${saved.target.qsoID?"QSO":"draft"} note`,sessionID:scope.sessionID});setText(saved.text);setUncertain(true);
    }catch{setRecoveryFailure({message:"Saved note recovery data is unreadable. It has been preserved; resolve recovery before writing another note.",raw});}
  };
  useEffect(()=>{readRecovery();setOffset(0);},[identity]);
  const archiveRecovery=()=>{if(!recoveryFailure||recoveryFailure.raw===null)return;
    try{const raw=recoveryFailure.raw;if(localStorage.getItem(recoveryKey)!==raw)throw Error("Saved recovery changed. Retry reading it before resolving recovery.");
      const archiveKey=`${recoveryKey}/unreadable/${crypto.randomUUID()}`;
      localStorage.setItem(archiveKey,raw);
      if(localStorage.getItem(archiveKey)!==raw||localStorage.getItem(recoveryKey)!==raw)throw Error("Recovery archive could not be verified. The original record is retained.");
      localStorage.removeItem(recoveryKey);setRecoveryFailure(null);setError("Unreadable recovery record archived on this device; its original content is retained.");
    }catch(cause){setRecoveryFailure({...recoveryFailure,message:message(cause)});}
  };
  useEffect(()=>{const current=++ticket.current;setError("");void read<{rows:Note[];total:number}>(request,"contest_notes",{
    sessionID:scope.sessionID,workspaceGeneration:scope.workspaceGeneration,expectedRevision:scope.revision,offset,limit:50,...laneTarget,
  }).then(value=>{if(ticket.current===current){setNotes(value.rows);setTotal(value.total);}},cause=>{if(ticket.current===current)setError(message(cause));});
    return()=>{ticket.current++;};},[readIdentity,scope.revision,offset,request]);
  const save=async()=>{if(recoveryFailure||!target||target.sessionID!==scope.sessionID)return;setSaving(true);setError("");
    const operation=pending.current??{target:target.identity,text,noteID:crypto.randomUUID()};pending.current=operation;
    try{localStorage.setItem(recoveryKey,JSON.stringify(operation));await onSave(operation.target,operation.text,operation.noteID);
      localStorage.removeItem(recoveryKey);pending.current=null;setUncertain(false);setTarget(null);setText("");}
    catch(cause){const confirmed=cause instanceof ContestServerError&&cause.outcome!=="uncertain";
      if(confirmed){pending.current=null;localStorage.removeItem(recoveryKey);}setUncertain(!confirmed);setError(message(cause));}finally{setSaving(false);}};
  return <section className="contest-productivity-section" aria-label="Contest notes"><h2>Notes</h2>
    {recoveryFailure&&<div role="alert"><p>{recoveryFailure.message}</p><button onClick={readRecovery}>Retry saved recovery</button>
      <button disabled={recoveryFailure.raw===null} onClick={archiveRecovery}>Archive unreadable recovery record</button></div>}
    <div className="contest-productivity-actions"><button disabled={disabled||saving||uncertain||!!recoveryFailure} onClick={()=>setTarget({identity:{draftID:scope.draftID,...laneTarget},label:`Current draft ${scope.draftID.slice(0,8)}${laneLabel}`,sessionID:scope.sessionID})}>Note current</button>
      <button disabled={disabled||saving||uncertain||!!recoveryFailure} onClick={()=>{const sessionID=scope.sessionID,origin={...laneTarget};void onLast().then(row=>setTarget({identity:{qsoID:row.qsoID,...origin,...(row.laneID?{laneID:row.laneID,bindingVersion:row.bindingVersion,bindingGeneration:row.bindingGeneration}:{})},label:`Last QSO ${row.callsign}${laneLabel}`,sessionID})).catch(cause=>setError(message(cause)));}}>Note last QSO</button></div>
    {target&&<div className="contest-note-editor"><p>Bound to {target.label}. A later entry cannot take this note.</p>
      <label>Operator note<textarea aria-label="Operator note" value={text} disabled={saving||uncertain} maxLength={4096} onChange={event=>setText(event.target.value)}/></label>
      <button disabled={disabled||saving||!!recoveryFailure||!text.trim()} onClick={()=>void save()}>{uncertain?"Reconcile same note":"Save note"}</button>
      {!uncertain&&<button disabled={saving} onClick={()=>{setTarget(null);setText("");}}>Cancel note</button>}</div>}
    {error&&<p role="alert">{error}</p>}
    <ul aria-label="Saved contest notes">{notes.map(note=><li key={note.id}><strong>{note.callsign||`Draft ${note.draft_id?.slice(0,8)}`}</strong> <time>{note.created_utc}</time><p>{note.body}</p></li>)}</ul>
    {!total&&<p>No notes yet. Attach an observation to the current draft or last saved QSO.</p>}
    <div className="contest-productivity-actions"><button disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-50))}>Previous notes</button><span>{total} notes</span><button disabled={offset+50>=total} onClick={()=>setOffset(offset+50)}>Next notes</button></div>
  </section>;
}

type Preflight={revision:number;checks:{id:string;status:string;message:string}[];manifest:Record<string,unknown>;prepared?:ContestExportSavePrepared;archiveManifest?:Record<string,unknown>};
export function ContestSubmissionPanel({scope,request,formats,disabled,onExport,onArchive,onRecordingIndex,onInspectArchive}:{scope:Scope;request:ContestRequest;formats:string[];disabled:boolean;
    onExport(format:"cabrillo"|"adif"|"edi",expectedRevision:number,expectedSHA256:string,siteID?:string):Promise<unknown>;
    onArchive?(prepared:ContestExportSavePrepared):Promise<unknown>;onRecordingIndex?():Promise<Record<string,unknown>>;onInspectArchive?():Promise<unknown>}) {
  const [format,setFormat]=useState(formats.includes("cabrillo")?"cabrillo":formats[0]??"adif"),[review,setReview]=useState<Preflight|null>(null),[error,setError]=useState("");
  const [reading,setReading]=useState(false);const ticket=useRef(0);
  const [sites,setSites]=useState<{id:string;name:string;locator:string;contacts:number}[]>([]),[siteID,setSiteID]=useState("");
  const [inspection,setInspection]=useState<unknown>(null);
  const identity=`${scope.sessionID}/${scope.workspaceGeneration}`;
  useEffect(()=>{ticket.current++;setReview(null);setError("");setReading(false);},[identity,scope.revision]);
  useEffect(()=>{setSiteID("");},[identity]);
  useEffect(()=>{let active=true;setSites([]);if(format==="edi")void read<{sites:typeof sites}>(request,"contest_strategy",{
    sessionID:scope.sessionID,workspaceGeneration:scope.workspaceGeneration,expectedRevision:scope.revision,section:"vhf",
  }).then(value=>{if(active)setSites(value.sites);},cause=>{if(active)setError(message(cause));});return()=>{active=false;};},[identity,scope.revision,format,request]);
  const retainedArchive=useRef<ContestExportSavePrepared|null>(null);
  const releaseArchive=()=>{const saved=retainedArchive.current;retainedArchive.current=null;if(saved)void request("contest_export_release",{sessionID:saved.sessionID,workspaceGeneration:saved.workspaceGeneration,exportID:saved.artifactID}).catch(()=>{});};
  useEffect(()=>()=>releaseArchive(),[identity,scope.revision,format,siteID]);
  const preflight=async(archive=false)=>{const current=++ticket.current;setReading(true);setError("");releaseArchive();try{
    const recordingIndex=archive&&onRecordingIndex?await onRecordingIndex():undefined;
    const value=await read<Preflight>(request,"contest_submission_preflight",{
    sessionID:scope.sessionID,workspaceGeneration:scope.workspaceGeneration,expectedRevision:scope.revision,format,...(format==="edi"&&siteID?{siteID}:{}),
    ...(archive?{archive:true,...(recordingIndex?{recordingIndex}:{})}:{}),
  });if(ticket.current===current){setReview(value);retainedArchive.current=value.prepared??null;}else if(value.prepared)void request("contest_export_release",{sessionID:value.prepared.sessionID,workspaceGeneration:value.prepared.workspaceGeneration,exportID:value.prepared.artifactID}).catch(()=>{});
  }catch(cause){if(ticket.current===current)setError(message(cause));}finally{if(ticket.current===current)setReading(false);}};
  return <section className="contest-productivity-section" aria-label="Submission preflight"><h2>Submission preflight</h2><p>Review the complete log and exact export digest. Saving a file leaves submission status as “not submitted”.</p>
    <div className="contest-productivity-actions"><label>Output format<select aria-label="Submission format" value={format} onChange={event=>{ticket.current++;setReading(false);setFormat(event.target.value);setReview(null);}}>{formats.map(item=><option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label>
      {format==="edi"&&sites.length>0&&<label>EDI station site<select aria-label="EDI station site" value={siteID} onChange={event=>{ticket.current++;setReading(false);setSiteID(event.target.value);setReview(null);}}>
        <option value="">Whole log (one historical locator required)</option>{sites.map(site=><option key={site.id} value={site.id} disabled={!site.contacts}>{site.name||site.id.slice(0,8)} · {site.locator} · {site.contacts} contacts</option>)}</select></label>}
      <button disabled={disabled||reading} onClick={()=>void preflight()}>Review submission</button>
      {onArchive&&<button disabled={disabled||reading} onClick={()=>void preflight(true)}>Review immutable archive</button>}
      {onInspectArchive&&<button disabled={disabled||reading} onClick={()=>void onInspectArchive().then(setInspection).catch(cause=>setError(message(cause)))}>Inspect saved archive…</button>}</div>
    {inspection!==null&&<details open><summary>Read-only archive verification</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify(inspection,null,2)}</pre></details>}
    {error&&<p role="alert">{error}</p>}{review&&<><ul>{review.checks.map(item=><li key={item.id}><strong>{item.status.toUpperCase()}</strong> · {item.message}</li>)}</ul>
      <p>Revision {review.revision} · {String(review.manifest.byteLength)} bytes · SHA-256 <code>{String(review.manifest.sha256)}</code></p>
      <div className="contest-productivity-actions"><button disabled={disabled||review.revision!==scope.revision} onClick={()=>{const selected=typeof review.manifest.siteID==="string"?review.manifest.siteID:undefined;
        void(selected?onExport(format as "edi",review.revision,String(review.manifest.sha256),selected):onExport(format as "cabrillo"|"adif"|"edi",review.revision,String(review.manifest.sha256))).catch(cause=>setError(message(cause)));}}>Save reviewed export</button>
        <button onClick={()=>void navigator.clipboard.writeText(JSON.stringify(review.manifest,null,2)).catch(cause=>setError(message(cause)))}>Copy export manifest</button></div>
      {review.prepared&&onArchive&&<><p>Immutable archive · {review.prepared.byteLength} bytes · SHA-256 <code>{review.prepared.sha256}</code>. Export, source contacts, notes, checks and recording index are frozen. No audio is included; this is not organizer submission.</p>
        <button disabled={disabled||review.revision!==scope.revision} onClick={()=>void onArchive(review.prepared!).then(()=>setReview(null)).catch(cause=>setError(message(cause)))}>Save reviewed immutable archive</button></>}
      {review.archiveManifest&&<details><summary>Archive member manifest</summary><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify(review.archiveManifest,null,2)}</pre></details>}
      <details><summary>Export manifest</summary><pre>{JSON.stringify(review.manifest,null,2)}</pre></details></>}
  </section>;
}

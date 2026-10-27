import { useEffect, useRef, useState } from "react";
import type { ContestRequest } from "./types";
import { ContestServerError } from "./client";
import type { ContestExportSavePrepared } from "./contestExportSave";
import { UnfinishedRecovery, useUnfinishedEditor } from "./unfinishedEditors";

type NoteLane = {laneID?:"laneA"|"laneB";bindingVersion?:number;bindingGeneration?:string|number|null};
type Scope = { sessionID:string; workspaceGeneration:string; revision:number; draftID:string } & NoteLane;
export type NoteTarget = ({draftID:string}|{qsoID:string}) & NoteLane;
type Note = {id:string;draft_id:string|null;qso_id:string|null;body:string;created_utc:string;callsign:string|null};
const message=(cause:unknown)=>cause instanceof Error?cause.message:String(cause);
async function read<T>(request:ContestRequest,method:Parameters<ContestRequest>[0],params:Record<string,unknown>):Promise<T>{
  const frame=await request<T>(method,params);if(!frame.ok)throw Error(frame.error.message||"The contest read failed.");return frame.result;
}

export function ContestNotesPanel(props:Parameters<typeof NotesEditor>[0]) {
  return <NotesEditor key={`${props.scope.sessionID}/${props.scope.workspaceGeneration}`} {...props}/>;
}
type CapturedNoteTarget={identity:NoteTarget;label:string;sessionID:string;workspaceGeneration:string};
function validNoteTarget(value:unknown):value is CapturedNoteTarget {
  const target=value as CapturedNoteTarget;
  return !!target&&typeof target.sessionID==="string"&&typeof target.workspaceGeneration==="string"&&typeof target.label==="string"&&!!target.identity&&
    (("draftID" in target.identity&&typeof target.identity.draftID==="string"&&!("qsoID" in target.identity))||("qsoID" in target.identity&&typeof target.identity.qsoID==="string"&&!("draftID" in target.identity)))&&
    (target.identity.laneID===undefined||["laneA","laneB"].includes(target.identity.laneID))&&
    (target.identity.bindingVersion===undefined||Number.isSafeInteger(target.identity.bindingVersion))&&
    (target.identity.bindingGeneration===undefined||target.identity.bindingGeneration===null||["number","string"].includes(typeof target.identity.bindingGeneration));
}
function NotesEditor({scope,request,disabled,onSave,onLast}:{scope:Scope;request:ContestRequest;disabled:boolean;
  onSave(target:NoteTarget,text:string,noteID:string):Promise<void>;onLast():Promise<{qsoID:string;callsign:string}&NoteLane>}) {
  const identity=`${scope.sessionID}/${scope.workspaceGeneration}`;
  const retained=useUnfinishedEditor(`xlog.contest.unsent-notes.v1/${identity}`,validNoteTarget,4096);
  const [attemptTarget,setAttemptTarget]=useState<CapturedNoteTarget|null>(null),[attemptText,setAttemptText]=useState(""),[hidden,setHidden]=useState(false);
  const target=attemptTarget??retained.draft?.target??null,text=attemptTarget?attemptText:retained.draft?.text??"";
  const [notes,setNotes]=useState<Note[]>([]),[offset,setOffset]=useState(0),[total,setTotal]=useState(0),[error,setError]=useState("");
  const [saving,setSaving]=useState(false),[uncertain,setUncertain]=useState(false),[notice,setNotice]=useState("");
  const [recoveryFailure,setRecoveryFailure]=useState<{message:string;raw:string|null;key:string}|null>(null),[operations,setOperations]=useState<string[]>([]);
  const pendingKey=useRef<string|null>(null);
  const pendingRaw=useRef<string|null>(null);
  const pending=useRef<{target:NoteTarget;text:string;noteID:string;editorID?:string}|null>(null),ticket=useRef(0);
  const readIdentity=`${identity}/${scope.laneID??"laneA"}`;
  const laneTarget:NoteLane=scope.laneID?{laneID:scope.laneID,bindingVersion:scope.bindingVersion,bindingGeneration:scope.bindingGeneration}:{};
  const laneLabel=scope.laneID?` · ${scope.laneID==="laneA"?"Lane A":"Lane B"}`:"";
  const recoveryKey=`xlog.contest.note-editor.v1/${identity}`;
  const attemptKeys=()=>Object.keys(localStorage).filter(name=>name===recoveryKey||name.startsWith(`${recoveryKey}/operation/`)&&!name.slice(`${recoveryKey}/operation/`.length).includes("/"));
  const readRecovery=(selected?:string)=>{setAttemptTarget(null);setAttemptText("");pending.current=null;pendingKey.current=null;pendingRaw.current=null;setUncertain(false);setRecoveryFailure(null);
    let raw:string|null=null;
    let key=selected??recoveryKey;
    try{const keys=attemptKeys();setOperations(keys);
      key=selected??keys[0]??recoveryKey;raw=localStorage.getItem(key);if(raw===null)return;const saved=JSON.parse(raw);
      if(typeof saved.noteID!=="string"||typeof saved.text!=="string"||!saved.target||
        !(typeof saved.target.draftID==="string"||typeof saved.target.qsoID==="string")||
        saved.target.laneID!==undefined&&!["laneA","laneB"].includes(saved.target.laneID)||
        saved.target.bindingVersion!==undefined&&(!Number.isSafeInteger(saved.target.bindingVersion)||saved.target.bindingVersion<0)||
        saved.target.bindingGeneration!==undefined&&saved.target.bindingGeneration!==null&&typeof saved.target.bindingGeneration!=="string"&&typeof saved.target.bindingGeneration!=="number"||
        saved.editorID!==undefined&&typeof saved.editorID!=="string")throw new Error("Invalid saved note identity.");
      pending.current=saved;pendingKey.current=key;pendingRaw.current=raw;setAttemptTarget({identity:saved.target,label:`Recovered ${saved.target.qsoID?"QSO":"draft"} note`,sessionID:scope.sessionID,workspaceGeneration:scope.workspaceGeneration});setAttemptText(saved.text);setUncertain(true);
    }catch{setRecoveryFailure({message:"Saved note recovery data is unreadable. It has been preserved; resolve recovery before writing another note.",raw,key});}
  };
  useEffect(()=>{readRecovery();setOffset(0);},[identity]);
  const checkAttempt=()=>{try{if(pending.current)return true;const key=attemptKeys()[0];if(key){readRecovery(key);return true;}return false;}
    catch{readRecovery();return true;}};
  useEffect(()=>{const changed=(event:StorageEvent)=>{if(event.key===recoveryKey||event.key?.startsWith(`${recoveryKey}/operation/`))checkAttempt();};window.addEventListener("storage",changed);return()=>window.removeEventListener("storage",changed);},[identity]);
  const archiveRecovery=()=>{if(!recoveryFailure||recoveryFailure.raw===null)return;
    try{const raw=recoveryFailure.raw,key=recoveryFailure.key;if(localStorage.getItem(key)!==raw)throw Error("Saved recovery changed. Retry reading it before resolving recovery.");
      const archiveKey=`${key}/unreadable/${crypto.randomUUID()}`;
      localStorage.setItem(archiveKey,raw);
      if(localStorage.getItem(archiveKey)!==raw||localStorage.getItem(key)!==raw)throw Error("Recovery archive could not be verified. The original record is retained.");
      localStorage.removeItem(key);readRecovery();setError("Unreadable recovery record archived on this device; its original content is retained.");
    }catch(cause){setRecoveryFailure({...recoveryFailure,message:message(cause)});}
  };
  useEffect(()=>{const current=++ticket.current;setError("");void read<{rows:Note[];total:number}>(request,"contest_notes",{
    sessionID:scope.sessionID,workspaceGeneration:scope.workspaceGeneration,expectedRevision:scope.revision,offset,limit:50,...laneTarget,
  }).then(value=>{if(ticket.current===current){setNotes(value.rows);setTotal(value.total);}},cause=>{if(ticket.current===current)setError(message(cause));});
    return()=>{ticket.current++;};},[readIdentity,scope.revision,offset,request]);
  const save=async()=>{if(recoveryFailure||!target||target.sessionID!==scope.sessionID||target.workspaceGeneration!==scope.workspaceGeneration)return;setSaving(true);setError("");setNotice("");
    if(!pending.current&&checkAttempt()){setSaving(false);return;}
    // The editor UUID is also the first operation ID: two windows recovering
    // the same editor cannot submit it under competing fresh save identities.
    const recovered=pending.current!==null;
    const operation=pending.current??{target:target.identity,text,noteID:retained.draft?.id??crypto.randomUUID(),editorID:retained.draft?.id},raw=JSON.stringify(operation);
    const journalRaw=recovered?pendingRaw.current??raw:raw;let attempted=recovered;
    const operationKey=pendingKey.current??`${recoveryKey}/operation/${operation.noteID}`;
    try{retained.flush();const stored=localStorage.getItem(operationKey);
      if(recovered?stored!==journalRaw:stored!==null&&stored!==raw)throw Error("Another attempted note is retained or its bytes changed. Reconcile the original identity; no recovery was overwritten.");
      // A recovered journal is an opaque receipt: preserve its exact bytes,
      // including valid JSON whitespace/escapes, until confirmed completion.
      if(!recovered){localStorage.setItem(operationKey,raw);if(localStorage.getItem(operationKey)!==raw)throw Error("Attempt journal could not be verified. Nothing was sent.");}
      pending.current=operation;pendingKey.current=operationKey;pendingRaw.current=journalRaw;attempted=true;await onSave(operation.target,operation.text,operation.noteID);
      if(localStorage.getItem(operationKey)!==journalRaw)throw Error("Note saved, but its recovery changed. Reconcile the original identity.");
      if(operation.editorID)retained.complete(operation.editorID,operation.text);
      localStorage.removeItem(operationKey);readRecovery();setNotice("Note saved");}
    catch(cause){const confirmed=cause instanceof ContestServerError&&cause.outcome!=="uncertain";
      if(confirmed){try{retained.restore(target,operation.text);if(operation.editorID)retained.complete(operation.editorID,operation.text);if(localStorage.getItem(operationKey)===journalRaw)localStorage.removeItem(operationKey);pending.current=null;pendingKey.current=null;pendingRaw.current=null;setAttemptTarget(null);}
        catch(storageError){setUncertain(true);setError(`${message(cause)} ${message(storageError)}`);return;}}
      setUncertain(attempted&&!confirmed);setError(message(cause));}finally{setSaving(false);}};
  const begin=(captured:CapturedNoteTarget)=>{try{retained.start(captured);setHidden(false);setNotice("");}catch(cause){setError(message(cause));}};
  return <section className="contest-productivity-section" aria-label="Contest notes"><h2>Notes</h2>
    {recoveryFailure&&<div role="alert"><p>{recoveryFailure.message}</p><button onClick={()=>readRecovery(recoveryFailure.key)}>Retry saved recovery</button>
      <button disabled={recoveryFailure.raw===null} onClick={archiveRecovery}>Archive unreadable recovery record</button></div>}
    <UnfinishedRecovery editor={retained}/>
    {operations.filter(key=>key!==pendingKey.current).map(key=><button key={key} disabled={saving} onClick={()=>readRecovery(key)}>Reconcile retained note {key.slice(-8)}</button>)}
    {uncertain&&<p role="status">Save outcome uncertain. Reconcile the same note operation; its text cannot be edited or discarded.</p>}
    {target&&(target.sessionID!==scope.sessionID||target.workspaceGeneration!==scope.workspaceGeneration)&&<p role="alert">Original note workspace or contest is incompatible. Copy or discard the retained draft; it cannot be rebound.</p>}
    <div className="contest-productivity-actions"><button disabled={disabled||saving||uncertain||!!recoveryFailure||!!retained.draft} onClick={()=>begin({identity:{draftID:scope.draftID,...laneTarget},label:`Current draft ${scope.draftID.slice(0,8)}${laneLabel}`,sessionID:scope.sessionID,workspaceGeneration:scope.workspaceGeneration})}>Note current</button>
      <button disabled={disabled||saving||uncertain||!!recoveryFailure||!!retained.draft} onClick={()=>{const sessionID=scope.sessionID,workspaceGeneration=scope.workspaceGeneration,origin={...laneTarget};void onLast().then(row=>begin({identity:{qsoID:row.qsoID,...origin,...(row.laneID?{laneID:row.laneID,bindingVersion:row.bindingVersion,bindingGeneration:row.bindingGeneration}:{})},label:`Last QSO ${row.callsign}${laneLabel}`,sessionID,workspaceGeneration})).catch(cause=>setError(message(cause)));}}>Note last QSO</button></div>
    {hidden&&target&&<button onClick={()=>setHidden(false)}>Resume retained note</button>}
    {target&&!hidden&&<div className="contest-note-editor"><p>Bound to {target.label}. A later entry cannot take this note.</p>
      <label>Operator note<textarea aria-label="Operator note" value={text} disabled={saving||uncertain||!!recoveryFailure} maxLength={4096} onChange={event=>{if(!checkAttempt())retained.update(target,event.target.value);}}/></label>
      <button disabled={disabled||saving||!!recoveryFailure||!text.trim()||target.sessionID!==scope.sessionID||target.workspaceGeneration!==scope.workspaceGeneration} onClick={()=>void save()}>{uncertain?"Reconcile same note":"Save note"}</button>
      <button onClick={()=>void navigator.clipboard.writeText(text).catch(cause=>setError(message(cause)))}>Copy note draft</button>
      {!uncertain&&<><button disabled={saving} onClick={()=>{try{retained.flush();setHidden(true);}catch(cause){setError(message(cause));}}}>Cancel note (retain draft)</button>
        <button disabled={saving} onClick={()=>{try{if(checkAttempt())return;retained.keepForLater();setHidden(false);}catch(cause){setError(message(cause));}}}>Keep draft for later</button>
        <button disabled={saving} onClick={()=>{try{if(checkAttempt())return;retained.clear();setHidden(false);}catch(cause){setError(message(cause));}}}>Discard draft</button></>}</div>}
    {error&&<p role="alert">{error}</p>}
    {notice&&<p role="status">{notice}</p>}
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

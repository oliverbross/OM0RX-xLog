import { useEffect, useRef, useState } from "react";
import type { ContestRequest } from "./types";
import { ContestServerError } from "./client";

type Scope = { sessionID:string; workspaceGeneration:string; revision:number; draftID:string };
export type NoteTarget = {draftID:string}|{qsoID:string};
type Note = {id:string;draft_id:string|null;qso_id:string|null;body:string;created_utc:string;callsign:string|null};
const message=(cause:unknown)=>cause instanceof Error?cause.message:String(cause);
async function read<T>(request:ContestRequest,method:Parameters<ContestRequest>[0],params:Record<string,unknown>):Promise<T>{
  const frame=await request<T>(method,params);if(!frame.ok)throw Error(frame.error.message||"The contest read failed.");return frame.result;
}

export function ContestNotesPanel({scope,request,disabled,onSave,onLast}:{scope:Scope;request:ContestRequest;disabled:boolean;
  onSave(target:NoteTarget,text:string,noteID:string):Promise<void>;onLast():Promise<{qsoID:string;callsign:string}>}) {
  const [target,setTarget]=useState<{identity:NoteTarget;label:string;sessionID:string}|null>(null),[text,setText]=useState("");
  const [notes,setNotes]=useState<Note[]>([]),[offset,setOffset]=useState(0),[total,setTotal]=useState(0),[error,setError]=useState("");
  const [saving,setSaving]=useState(false),[uncertain,setUncertain]=useState(false);
  const pending=useRef<{target:NoteTarget;text:string;noteID:string}|null>(null),ticket=useRef(0);
  const identity=`${scope.sessionID}/${scope.workspaceGeneration}`;
  const recoveryKey=`xlog.contest.note-editor.v1/${identity}`;
  useEffect(()=>{setTarget(null);setText("");pending.current=null;setUncertain(false);setOffset(0);
    try{const raw=localStorage.getItem(recoveryKey);if(!raw)return;const saved=JSON.parse(raw);
      if(typeof saved.noteID!=="string"||typeof saved.text!=="string"||!saved.target||
        !(typeof saved.target.draftID==="string"||typeof saved.target.qsoID==="string"))throw new Error("Invalid saved note identity.");
      pending.current=saved;setTarget({identity:saved.target,label:`Recovered ${saved.target.qsoID?"QSO":"draft"} note`,sessionID:scope.sessionID});setText(saved.text);setUncertain(true);
    }catch{setError("Saved note recovery data is unreadable. It has been preserved; review recovery before writing another note.");}
  },[identity]);
  useEffect(()=>{const current=++ticket.current;setError("");void read<{rows:Note[];total:number}>(request,"contest_notes",{
    sessionID:scope.sessionID,workspaceGeneration:scope.workspaceGeneration,expectedRevision:scope.revision,offset,limit:50,
  }).then(value=>{if(ticket.current===current){setNotes(value.rows);setTotal(value.total);}},cause=>{if(ticket.current===current)setError(message(cause));});
    return()=>{ticket.current++;};},[identity,scope.revision,offset,request]);
  const save=async()=>{if(!target||target.sessionID!==scope.sessionID)return;setSaving(true);setError("");
    const operation=pending.current??{target:target.identity,text,noteID:crypto.randomUUID()};pending.current=operation;
    try{localStorage.setItem(recoveryKey,JSON.stringify(operation));await onSave(operation.target,operation.text,operation.noteID);
      localStorage.removeItem(recoveryKey);pending.current=null;setUncertain(false);setTarget(null);setText("");}
    catch(cause){const confirmed=cause instanceof ContestServerError&&cause.outcome!=="uncertain";
      if(confirmed){pending.current=null;localStorage.removeItem(recoveryKey);}setUncertain(!confirmed);setError(message(cause));}finally{setSaving(false);}};
  return <section className="contest-productivity-section" aria-label="Contest notes"><h2>Notes</h2>
    <div className="contest-productivity-actions"><button disabled={disabled||saving||uncertain} onClick={()=>setTarget({identity:{draftID:scope.draftID},label:`Current draft ${scope.draftID.slice(0,8)}`,sessionID:scope.sessionID})}>Note current</button>
      <button disabled={disabled||saving||uncertain} onClick={()=>{const sessionID=scope.sessionID;void onLast().then(row=>setTarget({identity:{qsoID:row.qsoID},label:`Last QSO ${row.callsign}`,sessionID})).catch(cause=>setError(message(cause)));}}>Note last QSO</button></div>
    {target&&<div className="contest-note-editor"><p>Bound to {target.label}. A later entry cannot take this note.</p>
      <label>Operator note<textarea aria-label="Operator note" value={text} disabled={saving||uncertain} maxLength={4096} onChange={event=>setText(event.target.value)}/></label>
      <button disabled={disabled||saving||!text.trim()} onClick={()=>void save()}>{uncertain?"Reconcile same note":"Save note"}</button>
      {!uncertain&&<button disabled={saving} onClick={()=>{setTarget(null);setText("");}}>Cancel note</button>}</div>}
    {error&&<p role="alert">{error}</p>}
    <ul aria-label="Saved contest notes">{notes.map(note=><li key={note.id}><strong>{note.callsign||`Draft ${note.draft_id?.slice(0,8)}`}</strong> <time>{note.created_utc}</time><p>{note.body}</p></li>)}</ul>
    {!total&&<p>No notes yet. Attach an observation to the current draft or last saved QSO.</p>}
    <div className="contest-productivity-actions"><button disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-50))}>Previous notes</button><span>{total} notes</span><button disabled={offset+50>=total} onClick={()=>setOffset(offset+50)}>Next notes</button></div>
  </section>;
}

type Preflight={revision:number;checks:{id:string;status:string;message:string}[];manifest:Record<string,unknown>};
export function ContestSubmissionPanel({scope,request,formats,disabled,onExport}:{scope:Scope;request:ContestRequest;formats:string[];disabled:boolean;
    onExport(format:"cabrillo"|"adif"|"edi",expectedRevision:number,expectedSHA256:string):Promise<unknown>}) {
  const [format,setFormat]=useState(formats.includes("cabrillo")?"cabrillo":formats[0]??"adif"),[review,setReview]=useState<Preflight|null>(null),[error,setError]=useState("");
  const [reading,setReading]=useState(false);const ticket=useRef(0);
  const identity=`${scope.sessionID}/${scope.workspaceGeneration}`;
  useEffect(()=>{ticket.current++;setReview(null);setError("");setReading(false);},[identity,scope.revision]);
  const preflight=async()=>{const current=++ticket.current;setReading(true);setError("");try{const value=await read<Preflight>(request,"contest_submission_preflight",{
    sessionID:scope.sessionID,workspaceGeneration:scope.workspaceGeneration,expectedRevision:scope.revision,format,
  });if(ticket.current===current)setReview(value);}catch(cause){if(ticket.current===current)setError(message(cause));}finally{if(ticket.current===current)setReading(false);}};
  return <section className="contest-productivity-section" aria-label="Submission preflight"><h2>Submission preflight</h2><p>Review the complete log and exact export digest. Saving a file leaves submission status as “not submitted”.</p>
    <div className="contest-productivity-actions"><label>Output format<select aria-label="Submission format" value={format} onChange={event=>{ticket.current++;setReading(false);setFormat(event.target.value);setReview(null);}}>{formats.map(item=><option key={item} value={item}>{item.toUpperCase()}</option>)}</select></label>
      <button disabled={disabled||reading} onClick={()=>void preflight()}>Review submission</button></div>
    {error&&<p role="alert">{error}</p>}{review&&<><ul>{review.checks.map(item=><li key={item.id}><strong>{item.status.toUpperCase()}</strong> · {item.message}</li>)}</ul>
      <p>Revision {review.revision} · {String(review.manifest.byteLength)} bytes · SHA-256 <code>{String(review.manifest.sha256)}</code></p>
      <div className="contest-productivity-actions"><button disabled={disabled||review.revision!==scope.revision} onClick={()=>void onExport(format as "cabrillo"|"adif"|"edi",review.revision,String(review.manifest.sha256)).catch(cause=>setError(message(cause)))}>Save reviewed export</button>
        <button onClick={()=>void navigator.clipboard.writeText(JSON.stringify(review.manifest,null,2)).catch(cause=>setError(message(cause)))}>Copy export manifest</button></div>
      <details><summary>Export manifest</summary><pre>{JSON.stringify(review.manifest,null,2)}</pre></details></>}
  </section>;
}

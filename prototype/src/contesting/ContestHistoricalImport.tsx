import { useEffect, useRef, useState } from "react";
import { historicalADIFRecords,type HistoricalADIFRecord } from "./contestAdifImport";
import type { ADIFImportEncoding } from "../live/adifTransfer";
import type { ContestRequest } from "./types";
import type { StrategyScope } from "./ContestReminders";

type Preview={qsoID:string;status:string;family:string;timestamp:string;fields:{callsign:string};frequencyHz:number;radioAttribution:string};
export function ContestHistoricalImport({scope,request,disabled,onApply}:{scope:StrategyScope;request:ContestRequest;disabled:boolean;
    onApply(records:HistoricalADIFRecord[],progress:(value:string)=>void):Promise<void>}){
  const [records,setRecords]=useState<HistoricalADIFRecord[]>([]),[reviews,setReviews]=useState<Preview[]>([]),[encoding,setEncoding]=useState<ADIFImportEncoding>("utf-8");
  const [working,setWorking]=useState(false),[error,setError]=useState(""),[progress,setProgress]=useState(""),[revision,setRevision]=useState(-1);
  const ticket=useRef(0),applying=useRef(false);
  // Invalidated reads cannot run their finally handler for the newer ticket.
  // Retire their busy state here; Apply owns its own lifetime across revisions.
  useEffect(()=>{ticket.current++;setRecords([]);setReviews([]);setError("");setProgress("");
    if(!applying.current)setWorking(false);},[scope.sessionID,scope.workspaceGeneration]);
  useEffect(()=>{if(!applying.current){ticket.current++;setReviews([]);setProgress("");setWorking(false);}},[scope.revision]);
  const choose=async(file:File)=>{const id=++ticket.current;setWorking(true);setReviews([]);setRecords([]);setError("");setProgress("");try{
    const parsed=await historicalADIFRecords(await file.arrayBuffer(),encoding);
    if(ticket.current===id)setRecords(parsed);
  }catch(cause){if(ticket.current===id)setError(String(cause));}finally{if(ticket.current===id)setWorking(false);}};
  const review=async()=>{const id=++ticket.current;setWorking(true);setError("");setReviews([]);const seen=new Set<string>(),contacts=new Set<string>();try{
    const values:Preview[]=[];
    for(const record of records){const reply=await request<Preview>("contest_strategy",{sessionID:scope.sessionID,workspaceGeneration:scope.workspaceGeneration,expectedRevision:scope.revision,section:"adif_preview",record});
      if(!reply.ok)throw Error(reply.error.message);if(ticket.current!==id)return;
      const coordinate=JSON.stringify([reply.result.fields.callsign,reply.result.timestamp,reply.result.frequencyHz]);
      if(seen.has(reply.result.qsoID)||contacts.has(coordinate))throw Error("This file repeats an identity or caller/time/RF; reconcile the source before applying.");seen.add(reply.result.qsoID);contacts.add(coordinate);values.push(reply.result);
      setProgress(`Reviewed ${values.length}/${records.length}; no contacts changed.`);}
    setRevision(scope.revision);setReviews(values);
  }catch(cause){if(ticket.current===id)setError(String(cause));}finally{if(ticket.current===id)setWorking(false);}};
  const apply=async()=>{setWorking(true);applying.current=true;setError("");try{await onApply(records,setProgress);setReviews([]);setRecords([]);}
    catch(cause){setError(`${String(cause)} Completed rows stay committed; re-review the same file to reconcile safely. No rollback or draft clear was attempted.`);setReviews([]);}
    finally{applying.current=false;setWorking(false);}};
  return <section className="contest-productivity-section" aria-label="Historical contest ADIF import"><h2>Reviewed historical ADIF import</h2>
    <p>Finite WPX serial, NAQP name/location, DARC/NAC/TA serial-grid, ARRL VHF grid and CQ WW CW/SSB zone mappings. Select the matching entrant/session first. WAE QTC transfer, general UDC and native N1MM database conversion are separate.</p>
    <p>Actual sent exchanges, source metadata and explicit site identity are retained. Missing radio attribution stays unknown. Existing entry drafts and serial reservations are preserved. Application is per contact with receipt reconciliation; a partial failure is reported.</p>
    <label>ADIF encoding<select aria-label="Historical ADIF encoding" value={encoding} disabled={working} onChange={event=>{ticket.current++;setRecords([]);setReviews([]);setEncoding(event.target.value as ADIFImportEncoding);}}>
      <option>utf-8</option><option>windows-1252</option><option>iso-8859-1</option></select></label>
    <label>Source ADIF<input aria-label="Historical ADIF file" type="file" accept=".adi,.adif,.adx" disabled={disabled||working} onChange={event=>{const file=event.target.files?.[0];if(file)void choose(file);event.target.value="";}}/></label>
    <button disabled={disabled||working||!records.length} onClick={()=>void review()}>Review all source contacts</button>
    <p role="status">{progress||`${records.length} decoded source contacts; no preview yet.`}</p>{error&&<p role="alert">{error}</p>}
    {reviews.length>0&&<><p>{reviews.length} contacts reviewed at revision {revision}. Raw file SHA-256 <code>{records[0]?.sourceSHA256}</code>.</p>
      <ul>{reviews.slice(0,25).map(row=><li key={row.qsoID}>{row.status} · {row.fields.callsign} · {row.timestamp} · {row.frequencyHz} Hz · {row.family} · radio {row.radioAttribution}</li>)}</ul>
      {reviews.length>25&&<p>First 25 shown; every decoded contact was reviewed.</p>}
      <button disabled={disabled||working||revision!==scope.revision} onClick={()=>void apply()}>Apply reviewed historical contacts</button></>}
  </section>;
}

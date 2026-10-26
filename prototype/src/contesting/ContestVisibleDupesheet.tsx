import { useEffect, useRef, useState } from "react";
import type { ContestRequest } from "./types";
import { assistanceCoordinates, assistanceKey, visibleDupesheet, type AssistanceScope, type DupesheetResult } from "./contestReverseAssistance";

export type VisibleDupesheetProps={request:ContestRequest;scope:AssistanceScope;disabled?:boolean};
export function ContestVisibleDupesheet({request,scope,disabled=false}:VisibleDupesheetProps){
  const [query,setQuery]=useState(""),[offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0),[open,setOpen]=useState(false);
  const [result,setResult]=useState<{key:string;value:DupesheetResult}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const ticket=useRef(0),key=`${assistanceKey(scope)}/${query}/${offset}/${refresh}/${disabled}/${open}`;
  const current=useRef(key);current.current=key;
  useEffect(()=>{
    const sequence=++ticket.current;setResult(null);setError("");setBusy(false);if(disabled||!open)return;
    setBusy(true);void visibleDupesheet(request,assistanceCoordinates(scope),query,offset).then(value=>{
      if(sequence===ticket.current&&current.current===key)setResult({key,value});
    }).catch(cause=>{if(sequence===ticket.current&&current.current===key)setError(cause instanceof Error?cause.message:String(cause));})
      .finally(()=>{if(sequence===ticket.current&&current.current===key)setBusy(false);});
    return()=>{ticket.current+=1;};
  },[request,key]);
  // Re-evaluate time-scoped plugin dupes while this optional read-only view is open.
  useEffect(()=>{if(!open||disabled)return;const timer=setInterval(()=>setRefresh(v=>v+1),15_000);return()=>clearInterval(timer);},[open,disabled]);
  const value=result?.key===key?result.value:null;
  return <section aria-label="Visible dupesheet"><label><input type="checkbox" checked={open} onChange={e=>setOpen(e.target.checked)}/>Visible Dupesheet</label>{open&&<>
    <p>Whole-contest calls in alphabetical order. Duplicate status uses the same plugin check as Entry for the current band, mode, grid and time.</p>
    <label>Find worked call<input value={query} maxLength={64} disabled={disabled} onChange={e=>{setQuery(e.target.value);setOffset(0);}} placeholder="Any call fragment"/></label><button type="button" disabled={disabled||busy} onClick={()=>setRefresh(v=>v+1)}>Refresh dupesheet</button>
    {busy&&<p role="status">Checking worked calls…</p>}{value&&<><p>{value.totalCalls.toLocaleString()} matching calls · {(value.frequencyHz/1_000_000).toFixed(3)} MHz · {value.mode}{value.roverLocation?` · sent grid ${value.roverLocation}`:""}<br/>{value.scopeDescription}<br/><small>Evaluated {value.evaluatedAtUTC} UTC · updates every 15 seconds while open</small></p>
    <table><caption>Worked calls {value.totalCalls?offset+1:0}–{offset+value.rows.length} of {value.totalCalls}</caption><thead><tr><th>Call</th><th>Current Entry scope</th><th>Contacts</th><th>Last worked UTC</th></tr></thead><tbody>{value.rows.map(row=><tr key={row.callsign}><td><strong>{row.callsign}</strong></td><td>{row.isDupe===true?"Duplicate":row.isDupe===false?"Clear":"Unchecked"}</td><td>{row.contactCount}</td><td>{row.lastWorkedUTC}</td></tr>)}</tbody></table>
    <nav aria-label="Dupesheet pages"><button type="button" disabled={disabled||busy||offset===0} onClick={()=>setOffset(v=>Math.max(0,v-50))}>Previous calls</button><button type="button" disabled={disabled||busy||value.nextOffset===null} onClick={()=>setOffset(value.nextOffset??0)}>More calls</button></nav></>}{error&&<p role="alert">{error}</p>}
  </>}</section>;
}

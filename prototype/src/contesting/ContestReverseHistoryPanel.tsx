import { useEffect, useRef, useState } from "react";
import type { ContestRequest } from "./types";
import { assistanceCoordinates, assistanceKey, reverseHistory, type AssistanceScope, type ReverseResult } from "./contestReverseAssistance";

export type ReverseHistoryPanelProps={request:ContestRequest;scope:AssistanceScope;disabled?:boolean;
  onSelect?:(callsign:string,scope:AssistanceScope)=>void};
export function ContestReverseHistoryPanel({request,scope,disabled=false,onSelect}:ReverseHistoryPanelProps){
  const [query,setQuery]=useState(""),[fieldID,setFieldID]=useState("call"),[source,setSource]=useState<"history"|"log">("history");
  const [matchMode,setMatchMode]=useState<"prefix"|"contains">("prefix"),[offset,setOffset]=useState(0),[refresh,setRefresh]=useState(0);
  const [result,setResult]=useState<{key:string;value:ReverseResult}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const ticket=useRef(0),key=`${assistanceKey(scope)}/${query}/${fieldID}/${source}/${matchMode}/${offset}/${refresh}/${disabled}`;
  const current=useRef(key);current.current=key;
  useEffect(()=>{
    const sequence=++ticket.current;setResult(null);setError("");setBusy(false);if(disabled)return;
    setBusy(true);
    void reverseHistory(request,assistanceCoordinates(scope),{query,fieldID,source,matchMode,offset,limit:50}).then(value=>{
      if(sequence===ticket.current&&current.current===key)setResult({key,value});
    }).catch(cause=>{if(sequence===ticket.current&&current.current===key)setError(cause instanceof Error?cause.message:String(cause));})
      .finally(()=>{if(sequence===ticket.current&&current.current===key)setBusy(false);});
    return()=>{ticket.current+=1;};
  },[request,key]); // Identity key fences every query, source, draft and log change.
  const value=result?.key===key?result.value:null;
  const fields=value?.fields??[{id:"call",label:"Partial call"}];
  return <section className="contest-history" aria-label="Reverse call history"><header><strong>Reverse call history</strong></header>
    <p>Search declared stable exchange fields. Suggestions load a callsign only; heard exchange stays in Entry.</p>
    <label>Search source<select value={source} disabled={disabled} onChange={e=>{setSource(e.target.value as "history"|"log");setOffset(0);}}><option value="history">Activated call history</option><option value="log">Current contest log</option></select></label>
    <label>Compared field<select value={fieldID} disabled={disabled} onChange={e=>{setFieldID(e.target.value);setOffset(0);}}>{fields.map(field=><option key={field.id} value={field.id}>{field.label}</option>)}{!fields.some(field=>field.id===fieldID)&&<option value={fieldID}>{fieldID}</option>}<option value="serial">Rolling serial (unsupported)</option></select></label>
    <label>Match<select value={matchMode} disabled={disabled} onChange={e=>{setMatchMode(e.target.value as "prefix"|"contains");setOffset(0);}}><option value="prefix">Starts with</option><option value="contains">Contains</option></select></label>
    <label>Reverse lookup<input value={query} maxLength={64} disabled={disabled} onChange={e=>{setQuery(e.target.value);setOffset(0);}} placeholder="At least two characters"/></label>
    <button type="button" disabled={disabled} onClick={()=>setRefresh(v=>v+1)}>Refresh lookup</button>
    {busy&&<><span role="status">Searching…</span><button type="button" onClick={()=>{ticket.current+=1;setBusy(false);setResult(null);}}>Cancel lookup</button></>}
    {value?.dataset&&<p><small>History generation {value.dataset.generation} · SHA-256 {value.dataset.digest.slice(0,12)}</small></p>}
    {value?.unsupportedReason&&<p role="status">{value.unsupportedReason}</p>}
    {value&&!value.unsupportedReason&&value.rows.length===0&&<p>No matching calls in this source.</p>}
    {value&&value.rows.length>0&&<table><caption>{value.matchMode==="prefix"?"Starts with":"Contains"} “{value.query}” · {value.fields.find(f=>f.id===value.fieldID)?.label}</caption><thead><tr><th>Call</th><th>Source / date</th><th>Compared fields</th>{onSelect&&<th>Action</th>}</tr></thead><tbody>{value.rows.map(row=><tr key={row.candidateID}><td><strong>{row.callsign}</strong></td><td>{row.sourceLabel}<br/>{row.sourceDate||"Source date unavailable"}</td><td>{row.comparedFields.map(field=><div key={field.id}>{field.label}: {field.value||"—"}</div>)}</td>{onSelect&&<td><button type="button" disabled={disabled} onClick={()=>{if(current.current===key&&!disabled)onSelect(row.callsign,{...scope});}}>Load {row.callsign}</button></td>}</tr>)}</tbody></table>}
    {value&&<nav aria-label="Reverse history pages"><button type="button" disabled={disabled||busy||offset===0} onClick={()=>setOffset(v=>Math.max(0,v-50))}>Previous candidates</button><button type="button" disabled={disabled||busy||value.nextOffset===null} onClick={()=>setOffset(value.nextOffset??0)}>More candidates</button></nav>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}

import { useEffect, useRef, useState } from "react";
import type { ContestRequest } from "./types";
import "./ContestReminders.css";

export type StrategyHistory = {action:string;atUTC:string;status?:string;dueUTC?:string};
export type Sked = {id:string;callsign:string;text:string;frequencyHz:number|null;mode:string;dueUTC:string;
  radioID:"radio1"|"radio2"|null;note:string;source:string;status:"active"|"dismissed"|"completed"|"cancelled";
  schedule:number;deliveredSchedule:number|null;deliveredUTC:string|null;createdUTC:string;updatedUTC:string;history:StrategyHistory[]};
export type PlannedMove = Omit<Sked,"dueUTC"|"schedule"|"deliveredSchedule"|"deliveredUTC"|"status"> & {
  band:string;skedID:string|null;status:"Watch"|"Planned"|"Requested"|"Waiting"|"Worked"|"Abandoned";workedQSOID:string|null};
export type StrategyProjection = {version:number;skeds:Sked[];moves:PlannedMove[];dueCount:number;notifications?:Sked[]};
export type StrategyScope = {sessionID:string;workspaceGeneration:string;revision:number;draftID?:string};
export type StrategyMutation = (action:string,values:Record<string,unknown>)=>Promise<unknown>;
type Editor = {id:string;callsign:string;text:string;frequency:string;mode:string;dueUTC:string;radioID:string;note:string;source:string;editing:boolean};
const explanation=(cause:unknown)=>cause instanceof Error?cause.message:String(cause);
const utcInFiveMinutes=()=>new Date(Date.now()+300_000).toISOString();

export function ContestReminders({scope,request,disabled,onMutate,onLoad,onLoadAndTune,prefill={},visible=true}: {
  scope:StrategyScope;request:ContestRequest;disabled:boolean;onMutate:StrategyMutation;
  onLoad(item:Sked):Promise<unknown>;onLoadAndTune(item:Sked,radioID:"radio1"|"radio2"):Promise<unknown>;
  prefill?:Partial<Sked>;visible?:boolean;
}) {
  const [data,setData]=useState<StrategyProjection|null>(null),[editor,setEditor]=useState<Editor|null>(null);
  const [selected,setSelected]=useState<string|null>(null),[error,setError]=useState(""),[working,setWorking]=useState(false);
  const [announcement,setAnnouncement]=useState(""),[showHistory,setShowHistory]=useState(false),[pulse,setPulse]=useState(0);
  const ticket=useRef(0),claiming=useRef(false),scopeKey=`${scope.sessionID}/${scope.workspaceGeneration}`;
  const currentScope=useRef(scopeKey);currentScope.current=scopeKey;
  const callbacks=useRef({onMutate,disabled});callbacks.current={onMutate,disabled};
  useEffect(()=>{setData(null);setEditor(null);setSelected(null);setError("");setAnnouncement("");},[scopeKey]);
  useEffect(()=>{
    const recover=()=>setPulse(value=>value+1),timer=window.setInterval(recover,30_000);
    window.addEventListener("focus",recover);document.addEventListener("visibilitychange",recover);
    return()=>{window.clearInterval(timer);window.removeEventListener("focus",recover);document.removeEventListener("visibilitychange",recover);};
  },[]);
  useEffect(()=>{
    const current=++ticket.current;
    void request<StrategyProjection>("contest_strategy",{sessionID:scope.sessionID,workspaceGeneration:scope.workspaceGeneration,
      expectedRevision:scope.revision,nowUTC:new Date().toISOString()}).then(async frame=>{
      if(ticket.current!==current)return;
      if(!frame.ok)throw Error(frame.error.message||"Reminders could not be read.");
      setData(frame.result);
      const due=frame.result.skeds.filter(item=>item.status==="active"&&Date.parse(item.dueUTC)<=Date.now()&&item.deliveredSchedule!==item.schedule);
      if(!due.length||claiming.current||callbacks.current.disabled)return;
      claiming.current=true;
      try {
        const result=await callbacks.current.onMutate("claim_due",{nowUTC:new Date().toISOString()}) as StrategyProjection|undefined;
        if(currentScope.current===scopeKey&&result?.notifications?.length){
          setAnnouncement(`${result.notifications.length} contest reminder${result.notifications.length===1?" is":"s are"} due. Open Skeds to review.`);
          if(ticket.current===current)setData(result);
        }
      }finally{claiming.current=false;}
    }).catch(cause=>{if(ticket.current===current)setError(explanation(cause));});
    return()=>{ticket.current++;};
  },[scopeKey,scope.revision,pulse,request]);
  const run=async(action:()=>Promise<unknown>)=>{if(working||disabled)return;setWorking(true);setError("");
    try{await action();setPulse(value=>value+1);}catch(cause){setError(explanation(cause));}finally{setWorking(false);}};
  const openEditor=(item?:Sked)=>{const source=item??prefill;setEditor({id:item?.id??crypto.randomUUID(),callsign:source.callsign??"",text:source.text??"",
    frequency:source.frequencyHz?.toString()??"",mode:source.mode??"",dueUTC:source.dueUTC??utcInFiveMinutes(),radioID:source.radioID??"",
    note:source.note??"",source:source.source??"",editing:!!item});};
  const save=()=>{if(!editor)return;void run(async()=>{await onMutate(editor.editing?"sked_edit":"sked_add",{itemID:editor.id,
    callsign:editor.callsign,text:editor.text,frequencyHz:editor.frequency===""?null:Number(editor.frequency),mode:editor.mode,dueUTC:editor.dueUTC,
    radioID:editor.radioID||null,note:editor.note,source:editor.source});setSelected(editor.id);setEditor(null);});};
  const change=(key:keyof Editor,value:string)=>setEditor(previous=>previous?{...previous,[key]:value}:null);
  const item=data?.skeds.find(row=>row.id===selected),locked=disabled||working;
  const shown=data?.skeds.filter(row=>showHistory||row.status==="active").slice().sort((a,b)=>a.dueUTC.localeCompare(b.dueUTC)||a.id.localeCompare(b.id))??[];
  return <><span className="contest-reminder-announcement" role="status" aria-live="polite">{announcement}</span>
    <section className="contest-reminders contest-productivity-section" aria-label="Contest skeds and reminders" hidden={!visible}>
      <h2>Skeds & reminders</h2><p>UTC reminders stay in this contest. Loading and tuning are explicit actions; completion is separate.</p>
      <div className="contest-productivity-actions"><button disabled={locked} onClick={()=>openEditor()}>New sked</button>
        <label><input type="checkbox" checked={showHistory} onChange={event=>setShowHistory(event.target.checked)}/> Include closed reminders</label>
        <span>{data?.dueCount??0} due</span></div>
      {error&&<p role="alert">{error}</p>}
      {editor&&<form className="contest-sked-editor" onSubmit={event=>{event.preventDefault();save();}}>
        <label>Callsign<input value={editor.callsign} disabled={locked} maxLength={32} onChange={event=>change("callsign",event.target.value)}/></label>
        <label>Reminder text<input value={editor.text} disabled={locked} maxLength={512} onChange={event=>change("text",event.target.value)}/></label>
        <label>Due UTC<input required value={editor.dueUTC} disabled={locked} placeholder="2026-10-28T00:05:00Z" onChange={event=>change("dueUTC",event.target.value)}/></label>
        <label>Frequency (Hz)<input type="number" min={100000} max={100000000000} step={1} value={editor.frequency} disabled={locked} onChange={event=>change("frequency",event.target.value)}/></label>
        <label>Mode<input value={editor.mode} disabled={locked} maxLength={16} onChange={event=>change("mode",event.target.value)}/></label>
        <label>Radio target<select value={editor.radioID} disabled={locked} onChange={event=>change("radioID",event.target.value)}>
          <option value="">No target</option><option value="radio1">Radio 1</option><option value="radio2">Radio 2</option></select></label>
        <label className="contest-sked-wide">Note<textarea value={editor.note} disabled={locked} maxLength={4096} onChange={event=>change("note",event.target.value)}/></label>
        <label className="contest-sked-wide">Source context<input value={editor.source} disabled={locked} maxLength={512} onChange={event=>change("source",event.target.value)}/></label>
        <div className="contest-productivity-actions"><button type="submit" disabled={locked||!(editor.callsign.trim()||editor.text.trim())}>Save sked</button>
          <button type="button" disabled={locked} onClick={()=>setEditor(null)}>Close editor</button></div>
      </form>}
      <ul className="contest-sked-list" aria-label="Contest reminders">{shown.map(row=><li key={row.id}>
        <button type="button" aria-pressed={selected===row.id} onClick={()=>setSelected(row.id)}><strong>{row.callsign||row.text}</strong>{row.callsign&&row.text?` · ${row.text}`:""}
          <span><time>{row.dueUTC}</time> · {row.frequencyHz?`${row.frequencyHz} Hz · `:""}{row.mode} · {row.status}</span></button>
      </li>)}</ul>{data&&!shown.length&&<p>No reminders in this view.</p>}
      {item&&<div className="contest-sked-detail" aria-label={`Reminder ${item.callsign||item.text}`}><p>{item.note}</p>{item.source&&<p>Source: {item.source}</p>}
        <div className="contest-productivity-actions"><button disabled={locked||!item.callsign} onClick={()=>void run(()=>onLoad(item))}>Load</button>
          <button disabled={locked||!item.callsign||!item.frequencyHz||!item.mode||!item.radioID} onClick={()=>{if(item.radioID)void run(()=>onLoadAndTune(item,item.radioID!));}}>Load and tune {item.radioID==="radio1"?"Radio 1":item.radioID==="radio2"?"Radio 2":"— choose target"}</button>
          <button disabled={locked||!["active","dismissed"].includes(item.status)} onClick={()=>void run(()=>onMutate("sked_snooze",{itemID:item.id,dueUTC:utcInFiveMinutes(),nowUTC:new Date().toISOString()}))}>Later 5 min</button>
          <button disabled={locked||item.status!=="active"} onClick={()=>openEditor(item)}>Edit sked</button>
          <button disabled={locked||item.status!=="active"} onClick={()=>void run(()=>onMutate("sked_dismiss",{itemID:item.id}))}>Dismiss</button>
          <button disabled={locked||!["active","dismissed"].includes(item.status)} onClick={()=>void run(()=>onMutate("sked_complete",{itemID:item.id}))}>Complete</button>
          <button disabled={locked||!["active","dismissed"].includes(item.status)} onClick={()=>void run(()=>onMutate("sked_cancel",{itemID:item.id}))}>Cancel sked</button>
        </div><details><summary>Reminder history</summary><ol>{item.history.map((entry,index)=><li key={index}><time>{entry.atUTC}</time> · {entry.action}{entry.status?` · ${entry.status}`:""}</li>)}</ol></details>
      </div>}
    </section></>;
}

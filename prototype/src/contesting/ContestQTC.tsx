import { useEffect, useRef, useState } from "react";
import type { ContestRequest } from "./types";
import type { StrategyMutation, StrategyScope } from "./ContestReminders";

type Item={sourceQSOID?:string;time:string;callsign:string;serial:string;status:"pending"|"confirmed";repeats:string[]};
type Batch={id:string;number:number;count:number;direction:"send"|"receive";counterpart:string;timestamp:string;frequencyHz:number;status:string;items:Item[]};
type Review={available:boolean;reason?:string;eligibility:string|null;ruleEdition:string;batches:Batch[];eligibleSources:Item[];score:{qtcPoints:number;total:number}};

export function ContestQTC({scope,request,disabled,onMutate,onEntry}:{scope:StrategyScope&{frequencyHz:number};request:ContestRequest;disabled:boolean;
  onMutate:StrategyMutation;onEntry():void}){
  const [data,setData]=useState<Review|null>(null),[direction,setDirection]=useState<"send"|"receive">("receive"),[call,setCall]=useState("");
  const [number,setNumber]=useState("1"),[time,setTime]=useState(()=>new Date().toISOString().slice(0,19).replace("T"," "));
  const [text,setText]=useState(""),[selected,setSelected]=useState<string[]>([]),[error,setError]=useState(""),[working,setWorking]=useState(false),[pulse,setPulse]=useState(0);
  const [editing,setEditing]=useState<{batchID:string;index:number;text:string}|null>(null);
  const ticket=useRef(0),identity=`${scope.sessionID}/${scope.workspaceGeneration}`;
  useEffect(()=>{setData(null);setSelected([]);setText("");setCall("");setError("");setEditing(null);},[identity]);
  useEffect(()=>{const current=++ticket.current;setError("");void request<Review>("contest_strategy",{sessionID:scope.sessionID,workspaceGeneration:scope.workspaceGeneration,
    expectedRevision:scope.revision,section:"qtc",counterpart:call,direction}).then(frame=>{
    if(current!==ticket.current)return;if(!frame.ok)throw Error(frame.error.message);setData(frame.result);
  }).catch(cause=>{if(current===ticket.current)setError(String(cause instanceof Error?cause.message:cause));});return()=>{ticket.current++;};},[identity,scope.revision,request,call,direction,pulse]);
  const run=async(action:string,values:Record<string,unknown>)=>{if(disabled||working)return;setWorking(true);setError("");
    try{await onMutate(action,values);setPulse(value=>value+1);}catch(cause){setError(cause instanceof Error?cause.message:String(cause));}finally{setWorking(false);}};
  const locked=disabled||working;
  const create=()=>{let items:Record<string,unknown>[];
    if(direction==="send")items=selected.map(sourceQSOID=>({sourceQSOID}));
    else{const lines=text.trim().split(/\n/);items=lines.map(line=>{const [time,callsign,serial,...extra]=line.trim().toUpperCase().split(/\s+/);
      if(!time||!callsign||!serial||extra.length)throw Error("Enter one HHMM CALL SERIAL per line.");return {time,callsign,serial};});}
    void run("qtc_create",{batchID:crypto.randomUUID(),number:Number(number),direction,counterpart:call,items,timestamp:time,frequencyHz:scope.frequencyHz});};
  return <section className="contest-productivity-section" aria-label="WAE QTC desk"><h2>WAE QTC desk</h2>
    <p>Manual entry and explicit acknowledgements. No message is transmitted. Source snapshots and confirmed items remain immutable.</p>
    <button type="button" onClick={onEntry}>Return to Entry</button>
    {error&&<p role="alert">{error}</p>}
    {data&&!data.available?<p>{data.reason}</p>:<>
      <p>{data?.ruleEdition} · {data?.score.qtcPoints??0} confirmed QTC points · shared score {data?.score.total??0}</p>
      <form onSubmit={event=>{event.preventDefault();try{create();}catch(cause){setError(String(cause instanceof Error?cause.message:cause));}}}>
        <div className="contest-productivity-actions"><label>QTC direction<select aria-label="QTC direction" disabled={locked} value={direction} onChange={event=>{setDirection(event.target.value as "send"|"receive");setSelected([]);}}><option value="receive">Receive</option><option value="send">Send</option></select></label>
          <label>QTC counterpart<input aria-label="QTC counterpart" disabled={locked} maxLength={32} value={call} onChange={event=>{setCall(event.target.value.toUpperCase());setSelected([]);}}/></label>
          <label>Series number<input aria-label="QTC series number" disabled={locked} type="number" min={1} max={99999} value={number} onChange={event=>setNumber(event.target.value)}/></label>
          <label>Transfer UTC<input aria-label="QTC transfer UTC" disabled={locked} value={time} onChange={event=>setTime(event.target.value)}/></label></div>
        <p>{data?.eligibility??`Transfer frequency: ${scope.frequencyHz} Hz. Ordinary QSO duplicate status does not block eligible QTCs.`}</p>
        {direction==="receive"?<label>Received items (HHMM CALL SERIAL, one per line)<textarea aria-label="Received QTC items" disabled={locked} maxLength={1500} rows={5} value={text} onChange={event=>setText(event.target.value)}/></label>:
          <fieldset disabled={locked}><legend>Eligible unsent source contacts</legend>{data?.eligibleSources.map(item=><label key={item.sourceQSOID}><input type="checkbox" checked={selected.includes(item.sourceQSOID!)} onChange={event=>setSelected(ids=>event.target.checked?[...ids,item.sourceQSOID!]:ids.filter(id=>id!==item.sourceQSOID))}/>{item.time} {item.callsign} {item.serial}</label>)}</fieldset>}
        <button disabled={locked||!!data?.eligibility||!data?.available} type="submit">Create pending QTC series</button>
      </form>
      {editing&&<form onSubmit={event=>{event.preventDefault();const [time,callsign,serial,...extra]=editing.text.trim().toUpperCase().split(/\s+/);
        if(!time||!callsign||!serial||extra.length){setError("Enter HHMM CALL SERIAL.");return;}
        void run("qtc_item",{batchID:editing.batchID,index:editing.index,item:{time,callsign,serial}});}}>
        <label>Correct pending received item {editing.index+1}<input aria-label="Correct pending QTC item" value={editing.text} disabled={locked} onChange={event=>setEditing({...editing,text:event.target.value})}/></label>
        <button disabled={locked}>Save pending item correction</button><button type="button" disabled={locked} onClick={()=>setEditing(null)}>Close item editor</button>
      </form>}
      <div aria-label="Saved QTC series">{data?.batches.map(batch=><section key={batch.id}><h3>{batch.direction} {batch.number}/{batch.count} · {batch.counterpart} · {batch.status}</h3>
        <p>{batch.timestamp} UTC · {batch.frequencyHz} Hz</p><ol>{batch.items.map((item,index)=><li key={index}>
          <strong>{item.time} {item.callsign} {item.serial}</strong> · {item.status} · {item.repeats.length} repeat requests
          <div className="contest-productivity-actions"><button disabled={locked||batch.status!=="open"||item.status==="confirmed"} onClick={()=>void run("qtc_confirm",{batchID:batch.id,index})}>Acknowledge item {index+1}</button>
            {batch.direction==="receive"&&batch.status==="open"&&item.status==="pending"&&<button disabled={locked} onClick={()=>setEditing({batchID:batch.id,index,text:`${item.time} ${item.callsign} ${item.serial}`})}>Correct pending item {index+1}</button>}
            {["all","time","callsign","serial","header"].map(fields=><button key={fields} disabled={locked} onClick={()=>void run("qtc_repeat",{batchID:batch.id,index,fields})}>Repeat {fields} {index+1}</button>)}</div></li>)}</ol>
        <button disabled={locked} onClick={()=>void run(batch.status==="open"?"qtc_cancel":"qtc_resume",{batchID:batch.id})}>{batch.status==="open"?"Interrupt series":"Resume same series"}</button>
        {!batch.items.some(item=>item.status==="confirmed")&&<button disabled={locked} onClick={()=>void run("qtc_header",{batchID:batch.id,number:Number(number)})}>Use reviewed series number</button>}
      </section>)}</div>
    </>}
  </section>;
}

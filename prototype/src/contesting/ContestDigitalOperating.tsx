import {useEffect,useRef,useState} from "react";
type Decode={id:string;sender:string;instanceID:string;engineVersion:string;periodMS:number;snr:number;deltaSeconds:number;message:string;mode:string;frequencyHz:number;lowConfidence:boolean;offAir:boolean;replyLimitation:string};
type Scope={sessionID:string;workspaceGeneration:string;draftID:string;selectedLaneID?:string;bindingVersion?:number;revision:number;fields:{id:string;label?:string;readOnly?:boolean;enabled?:boolean}[]};
export function ContestDigitalOperating({scope,serviceRequest,onApply,disabled}:{scope:Scope;serviceRequest:(method:string,params?:Record<string,unknown>)=>Promise<any>;onApply:(values:Record<string,unknown>)=>Promise<unknown>;disabled:boolean}){
  const [snapshot,setSnapshot]=useState<any>(null),[selected,setSelected]=useState<any>(null),[received,setReceived]=useState<any>(null),[field,setField]=useState("callsign"),[token,setToken]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[reviewedCompleted,setReviewedCompleted]=useState("");
  const identity=`${scope.sessionID}/${scope.workspaceGeneration}/${scope.selectedLaneID??"laneA"}/${scope.bindingVersion??0}/${scope.draftID}`;
  const current=useRef(identity);current.current=identity;
  useEffect(()=>{let active=true,timer:ReturnType<typeof setTimeout>;setSelected(null);setReceived(null);setToken("");setReviewedCompleted("");
    const refresh=async()=>{try{const [value,fldigi]=await Promise.all([serviceRequest("wsjtx_snapshot"),serviceRequest("fldigi_snapshot")]);if(active){setSnapshot({...value,fldigi});setError("");}}catch(cause){if(active)setError(String(cause));}finally{if(active)timer=setTimeout(()=>void refresh(),2000);}};
    void refresh();return()=>{active=false;clearTimeout(timer);};},[identity,serviceRequest]);
  const run=async(work:()=>Promise<void>)=>{if(busy||disabled)return;const origin=identity;setBusy(true);setError("");try{await work();}catch(cause){if(current.current===origin)setError(cause instanceof Error?cause.message:String(cause));}finally{if(current.current===origin)setBusy(false);}};
  const select=async(row:Decode)=>{const origin=identity,value=await serviceRequest("wsjtx_select",{decodeID:row.id,sessionID:scope.sessionID,workspaceGeneration:scope.workspaceGeneration,laneID:scope.selectedLaneID??"laneA",bindingVersion:scope.bindingVersion??0});if(current.current!==origin)return;
    setSelected(value);setReceived(null);setToken("");};
  const apply=async()=>{if(!token)return;const origin=identity;let value=token,source="";
    if(selected){const fresh=await serviceRequest("wsjtx_select",{decodeID:selected.id,sessionID:scope.sessionID,workspaceGeneration:scope.workspaceGeneration,laneID:scope.selectedLaneID??"laneA",bindingVersion:scope.bindingVersion??0});
      if(!fresh.message.split(/\s+/).includes(token))throw Error("Select an exact received token.");source=`wsjtx/${fresh.sender}/${fresh.instanceID}/${fresh.id}`;}
    else if(received){const fresh=await serviceRequest("fldigi_select",{id:received.id,token});value=fresh.value;source=fresh.source;
      if(fresh.sessionID!==scope.sessionID||fresh.workspaceGeneration!==scope.workspaceGeneration||fresh.laneID!==(scope.selectedLaneID??"laneA")||fresh.bindingVersion!==(scope.bindingVersion??0))throw Error("The selected digital lane changed.");}
    else return;
    if(current.current!==origin)throw Error("The draft changed. Review again.");
    await onApply({draftID:scope.draftID,fieldID:field,value,source});setToken("");};
  const evidence=selected?.message??received?.text??"";
  return <section aria-label="Digital operating evidence"><h2>Digital operating evidence</h2><p>Target {scope.selectedLaneID??"laneA"} · draft {scope.draftID.slice(0,8)}. Decoded candidate → explicit selection → external completion → durable contact are separate states.</p>
    <p>{snapshot?.status??"Digital listener unavailable"}. Configure listening in Contest Setup → Digital logging. Completed contest ADIF requires selection from that exact instance; restart retires selection.</p>
    <div className="contest-log-scroll"><table><thead><tr><th>Instance / version</th><th>UTC period / report</th><th>Mode / Hz</th><th>Received evidence</th><th>Action</th></tr></thead><tbody>{(snapshot?.decodes??[]).map((row:Decode)=><tr key={row.id}><td>{row.instanceID} · {row.engineVersion}<br/>{row.sender}</td><td>{new Date(row.periodMS).toISOString().slice(11,23)} · {row.snr} dB / {row.deltaSeconds}s</td><td>{row.mode} / {row.frequencyHz}</td><td>{row.message}{row.lowConfidence&&" · low confidence"}{row.offAir&&" · replay"}</td><td><button type="button" disabled={disabled||busy||row.lowConfidence||row.offAir} onClick={()=>void run(()=>select(row))}>Select decode</button><button type="button" disabled title={row.replyLimitation}>Reply unavailable</button></td></tr>)}</tbody></table></div>
    <p>Reply can start external transmission. It remains unavailable until the engine has an admitted shared-output/confirmed-release contract; UDP send would not establish TX success.</p>
    {snapshot?.fldigi?.completed?.map((row:any)=><div key={row.id}><p>Externally completed · {row.sender} · {row.instanceEvidence}</p><pre style={{whiteSpace:"pre-wrap"}}>{JSON.stringify(row.packet)}</pre>
      <label><input type="checkbox" checked={reviewedCompleted===`${identity}/${row.id}`} disabled={disabled||busy}
        onChange={event=>setReviewedCompleted(event.target.checked?`${identity}/${row.id}`:"")}/>I verified the external app, exchange and target lane · {scope.selectedLaneID??"laneA"}</label>
      <button type="button" disabled={disabled||busy||!snapshot.fldigi.receive_running||reviewedCompleted!==`${identity}/${row.id}`} onClick={()=>void run(async()=>{
        if(reviewedCompleted!==`${identity}/${row.id}`)throw Error("Review this completed event and current target lane first.");
        await serviceRequest("fldigi_accept_completed",{id:row.id,sessionID:scope.sessionID,workspaceGeneration:scope.workspaceGeneration,laneID:scope.selectedLaneID??"laneA",bindingVersion:scope.bindingVersion??0});setReviewedCompleted("");})}>Accept completed QSO</button></div>)}
    <button type="button" disabled={disabled||busy} onClick={()=>void run(async()=>{const origin=identity,value=await serviceRequest("fldigi_rx_text");if(current.current===origin){setReceived(value);setSelected(null);setToken("");}})}>Read fldigi received text</button>
    {snapshot?.fldigi?.recovery_error&&<p role="alert">{snapshot.fldigi.recovery_error}</p>}
    {evidence&&<><p>{selected?`Selected candidate ${selected.instanceID}`:`fldigi ${received.engineVersion}`} · evidence only</p><pre style={{whiteSpace:"pre-wrap",maxHeight:160,overflow:"auto"}}>{evidence}</pre>
      <label>Received token<select aria-label="Received token" value={token} onChange={e=>setToken(e.target.value)}><option value="">Choose an exact token</option>{[...new Set<string>(evidence.split(/\s+/).filter((item:string)=>item&&item.length<=128))].map(item=><option key={item}>{item}</option>)}</select></label>
      <label>Plugin field<select aria-label="Digital target field" value={field} onChange={e=>setField(e.target.value)}>{scope.fields.filter(item=>!item.readOnly&&item.enabled!==false).map(item=><option key={item.id} value={item.id}>{item.label??item.id}</option>)}</select></label>
      <button type="button" disabled={disabled||busy||!token} onClick={()=>void run(apply)}>Load token into empty field</button><p>Conflicting text stays evidence. Occupied fields and stale drafts are protected. Use the existing Call Stack to park a reviewed caller.</p></>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}

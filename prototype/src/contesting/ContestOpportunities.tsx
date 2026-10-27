import { useEffect, useMemo, useRef, useState } from "react";
import type { ContestRequest } from "./types";
import type { ContestSurfaceSpot } from "./contestSurfaceProtocol";
import type { PlannedMove, StrategyProjection, StrategyScope, StrategyMutation } from "./ContestReminders";
import { formatSpotAge, useSpotAgeClock } from "../live/spotAge";

type Candidate = {spotID:string;callsign:string;frequencyHz:number;mode:string};
type Dimension = {dimension:string;label:string;value:string;scope:string};
type Preview = {spotID:string;dupe:boolean|null;points:number|null;multiplierCount:number|null;reason:string|null;
  conditionalScoreGain:number|null;newDimensions:Dimension[];dimensionsVerified:boolean;inferredExchange:Record<string,string>;valueBasis:string;exchangeProvenance:string};
type Opportunity = {id:string;callsign:string;band:string;mode:string;frequencyHz:number;observations:ContestSurfaceSpot[]};
export function unifyContestOpportunities(spots:ContestSurfaceSpot[]):Opportunity[] {
  const groups=new Map<string,Opportunity>();
  for(const spot of spots){const callsign=spot.callsign.trim().toUpperCase(),mode=["USB","LSB","PH"].includes(spot.mode)?"SSB":spot.mode;
    if(!/^[A-Z0-9/]{3,32}$/.test(callsign))continue;
    const id=`${callsign}/${spot.band}/${mode}`,previous=groups.get(id);
    if(previous){previous.observations.push(spot);if(spot.receivedAt>=Math.max(...previous.observations.slice(0,-1).map(row=>row.receivedAt)))previous.frequencyHz=Math.round(spot.frequencyKHz*1000);}
    else groups.set(id,{id,callsign,band:spot.band,mode,frequencyHz:Math.round(spot.frequencyKHz*1000),observations:[spot]});
  }
  return [...groups.values()].sort((a,b)=>a.id.localeCompare(b.id));
}
const scopeParams=(scope:StrategyScope)=>({sessionID:scope.sessionID,workspaceGeneration:scope.workspaceGeneration,expectedRevision:scope.revision});
const message=(error:unknown)=>error instanceof Error?error.message:String(error);
export function ContestOpportunities({scope,request,spots,bands,mode,currentCall,disabled,onMutate,onLoad,onSked}: {
  scope:StrategyScope;request:ContestRequest;spots:ContestSurfaceSpot[];bands:{id:string;frequencyHz:number}[];mode:string;currentCall:string;
  disabled:boolean;onMutate:StrategyMutation;onLoad(item:{callsign:string;frequencyHz:number;mode:string}):Promise<unknown>;
  onSked(item:Partial<PlannedMove>):void;
}){
  const ageClock=useSpotAgeClock();
  const opportunities=useMemo(()=>unifyContestOpportunities(spots).filter(row=>bands.some(band=>band.id===row.band)),[spots,bands]);
  const [selected,setSelected]=useState(""),[call,setCall]=useState(""),[band,setBand]=useState(""),[radio,setRadio]=useState("");
  const [data,setData]=useState<StrategyProjection|null>(null),[previews,setPreviews]=useState<Record<string,Preview>>({}),[error,setError]=useState(""),[working,setWorking]=useState(false);
  const sequence=useRef(0),scopeKey=`${scope.sessionID}/${scope.workspaceGeneration}`;
  const chosen=opportunities.find(row=>row.id===selected),targetBand=bands.find(row=>row.id===band)??bands[0];
  const moveCall=(call||chosen?.callsign||currentCall).trim().toUpperCase();
  const candidates=useMemo<Candidate[]>(()=>[...opportunities.map(row=>({spotID:row.id,callsign:row.callsign,frequencyHz:row.frequencyHz,mode:row.mode})),
    ...(/^[A-Z0-9/]{3,32}$/.test(moveCall)?bands.map(row=>({spotID:`move/${moveCall}/${row.id}/${mode}`,callsign:moveCall,frequencyHz:row.frequencyHz,mode})):[])],
    [opportunities,moveCall,bands,mode]);
  const signature=JSON.stringify(candidates);
  useEffect(()=>{setSelected("");setData(null);setCall("");setError("");},[scopeKey]);
  useEffect(()=>{const ticket=++sequence.current;setPreviews({});let active=true;
    void(async()=>{const strategy=await request<StrategyProjection>("contest_strategy",scopeParams(scope));
      if(!strategy.ok)throw Error(strategy.error.message||"Strategy unavailable");if(active&&ticket===sequence.current)setData(strategy.result);
      for(let offset=0;offset<candidates.length;offset+=8){if(!active)return;
        const frame=await request<{sessionID:string;workspaceGeneration:string;revision:number;spots:Preview[]}>("contest_opportunities",{...scopeParams(scope),spots:candidates.slice(offset,offset+8)});
        if(!frame.ok)throw Error(frame.error.message||"Opportunity review unavailable");
        if(frame.result.sessionID!==scope.sessionID||frame.result.workspaceGeneration!==scope.workspaceGeneration||frame.result.revision!==scope.revision)throw Error("Opportunity snapshot changed");
        if(active&&ticket===sequence.current)setPreviews(previous=>({...previous,...Object.fromEntries(frame.result.spots.map(row=>[row.spotID,row]))}));
        await new Promise<void>(resolve=>window.setTimeout(resolve,0));
      }
    })().catch(cause=>{if(active)setError(message(cause));});return()=>{active=false;};
  },[scopeKey,scope.revision,signature,request]);
  const run=async(action:()=>Promise<unknown>)=>{if(disabled||working)return;setWorking(true);setError("");try{await action();}catch(cause){setError(message(cause));}finally{setWorking(false);}};
  const label=(preview?:Preview)=>!preview?"Review pending":preview.reason==="unsupported_band"||preview.reason==="unsupported_mode"||preview.reason==="ineligible_category"?"Ineligible":preview.reason==="exchange_required"?"Unknown exchange":preview.dupe===true?"Worked / duplicate":preview.reason?`Unknown · ${preview.reason}`:preview.multiplierCount?"Conditionally new":"No new multiplier";
  const shared=new Map<string,number>();for(const row of opportunities)for(const item of previews[row.id]?.newDimensions??[]){const key=JSON.stringify(item);shared.set(key,(shared.get(key)??0)+1);}
  return <section className="contest-productivity-section" aria-label="Opportunities and Move Multipliers"><h2>Opportunities & Move Multipliers</h2>
    <p>Observations are grouped by call, band and mode. Conditional gains are not guaranteed results or expected probabilities. Shared new multipliers are not additive.</p>
    {error&&<p role="alert">{error}</p>}
    <div className="contest-opportunity-scroll"><table><thead><tr><th>Opportunity</th><th>Evidence</th><th>Plugin review</th><th>Conditional score gain</th></tr></thead><tbody>
      {opportunities.map(row=>{const preview=previews[row.id],age=formatSpotAge(Math.max(...row.observations.map(item=>item.receivedAt)),ageClock);return <tr key={row.id}>
        <th scope="row"><button type="button" aria-pressed={selected===row.id} onClick={()=>setSelected(row.id)}>{row.callsign} · {row.band}/{row.mode}</button></th>
        <td>{row.observations.length} observations · {age} · {[...new Set(row.observations.map(item=>item.source||item.clusterName))].join(", ")}</td>
        <td>{label(preview)} · duplicate: {preview?.dupe===true?"yes":preview?.dupe===false?"no":"unknown"}</td><td>{preview?.conditionalScoreGain??"Unknown"}
          {preview?.newDimensions.map(item=><small key={JSON.stringify(item)}> {item.label} {item.value} / {item.scope}{(shared.get(JSON.stringify(item))??0)>1?" · shared, nonadditive":""}</small>)}</td>
      </tr>;})}</tbody></table></div>{!opportunities.length&&<p>No eligible observations. Cluster, Band Map and Needed remain available.</p>}
    {chosen&&<div className="contest-productivity-actions"><button disabled={disabled||working} onClick={()=>void run(()=>onLoad(chosen))}>Load selected call only</button>
      <button disabled={disabled} onClick={()=>onSked({...chosen,source:`Spot observations: ${chosen.observations.map(item=>item.source||item.clusterName).join(", ")}`})}>Prepare selected sked</button>
      <p>{previews[chosen.id]?.exchangeProvenance} {previews[chosen.id]?.valueBasis}</p></div>}
    <h3>Move Multipliers</h3><div className="contest-productivity-actions"><label>Move callsign<input value={call} placeholder={chosen?.callsign||currentCall} maxLength={32} onChange={event=>setCall(event.target.value.toUpperCase())}/></label>
      <label>Target band<select value={targetBand?.id??""} onChange={event=>setBand(event.target.value)}>{bands.map(row=><option key={row.id} value={row.id}>{row.id}</option>)}</select></label>
      <label>Explicit radio target<select value={radio} onChange={event=>setRadio(event.target.value)}><option value="">No target</option><option value="radio1">Radio 1</option><option value="radio2">Radio 2</option></select></label>
      <button disabled={disabled||working||!targetBand||!/^[A-Z0-9/]{3,32}$/.test(moveCall)} onClick={()=>void run(()=>onMutate("move_add",{itemID:crypto.randomUUID(),callsign:moveCall,band:targetBand.id,frequencyHz:targetBand.frequencyHz,mode,radioID:radio||null,text:"Planned multiplier move",note:"",source:chosen?`Opportunity ${chosen.id}`:"Operator plan",skedID:null,status:"Planned"}))}>Plan move</button></div>
    <ul aria-label="Move band review">{moveCall&&bands.map(row=>{const preview=previews[`move/${moveCall}/${row.id}/${mode}`];return <li key={row.id}>{moveCall} · {row.id}/{mode}: {label(preview)} · duplicate: {preview?.dupe===true?"yes":preview?.dupe===false?"no":"unknown"} · {opportunities.some(item=>item.callsign===moveCall&&item.band===row.id&&item.mode===mode)?"spotted":"not currently spotted"} · conditional gain {preview?.conditionalScoreGain??"unknown"}</li>;})}</ul>
    <ul aria-label="Planned moves">{data?.moves.map(item=><li key={item.id}><strong>{item.callsign} · {item.band}/{item.mode} · {item.status}</strong> · {item.radioID??"no radio target"}
      {item.workedQSOID&&<span> · committed QSO {item.workedQSOID}</span>}
      <select aria-label={`Plan state ${item.callsign} ${item.band}`} value={item.status} disabled={disabled||working||item.status==="Worked"} onChange={event=>void run(()=>onMutate("move_state",{itemID:item.id,status:event.target.value}))}>
        {["Watch","Planned","Requested","Waiting",...(item.status==="Worked"?["Worked"]:[]),"Abandoned"].map(status=><option key={status}>{status}</option>)}</select>
      <button disabled={disabled} onClick={()=>onSked(item)}>Prepare reminder</button></li>)}</ul><p>Worked requires matching committed log evidence. Planning and feed changes never tune or transmit. Missing exchange stays unknown; no generic CQ WW formula is applied.</p>
  </section>;
}

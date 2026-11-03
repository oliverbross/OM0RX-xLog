import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {commandTitle} from "./normalCommands";
import { validSpotActivationSnapshot, type SpotActivationSnapshot } from "./spotActivation";

type Candidate = {callsign:string;frequencyHz:number;offsetHz:number;ageSeconds:number;spotId:string;spotVersion:string;draftRevision:number;[key:string]:unknown};
type Snapshot = {enabled:boolean;candidates:Candidate[];reason?:string};
export function NearbyCallsigns({disabled=false,beforeApply,onApplied}:{
  disabled?:boolean;beforeApply:()=>Promise<void>;onApplied:(result:SpotActivationSnapshot)=>Promise<unknown>;
}) {
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[error,setError]=useState(""),[working,setWorking]=useState(false);
  const latest=useRef({disabled,beforeApply,onApplied,snapshot}); latest.current={disabled,beforeApply,onApplied,snapshot};
  const applying=useRef(false), mounted=useRef(true);
  useEffect(()=>{
    mounted.current=true;let active=true,reading=false,again=false,stops:(()=>void)[]=[], timer:number|undefined;
    const read=async()=>{if(!active)return;if(reading){again=true;return;}reading=true;
      do{again=false;try{const value=await invoke<Snapshot>("nearby_callsign_snapshot");
        if(typeof value?.enabled!=="boolean"||!Array.isArray(value.candidates)||value.candidates.length>3||
          value.candidates.some(c=>typeof c.callsign!=="string"||!Number.isSafeInteger(c.offsetHz)||!Number.isSafeInteger(c.ageSeconds)||typeof c.spotVersion!=="string"))
          throw new Error("Nearby spot evidence could not be verified.");
        if(active)setSnapshot(value);
      }catch{if(active)setSnapshot(null);}}while(active&&again);reading=false;};
    const wake=()=>{clearTimeout(timer);timer=window.setTimeout(()=>void read(),150);};
    if(isTauri()) for(const event of ["xlog:station-telemetry","xlog:cluster-session","xlog:operator-draft-changed","xlog:settings-changed"])
      void listen(event,wake).then(stop=>active?stops.push(stop):stop()).catch(()=>{});
    window.addEventListener("focus",wake);void read();
    return()=>{active=false;mounted.current=false;stops.forEach(stop=>stop());clearTimeout(timer);window.removeEventListener("focus",wake);};
  },[]);
  const apply=async(candidate:Candidate)=>{
    if(applying.current||latest.current.disabled)return;
    applying.current=true;setWorking(true);setError("");
    try{
      await latest.current.beforeApply();
      const operationId=crypto.randomUUID();
      const result=await invoke("nearby_callsign_accept",{operationId,candidate});
      if(!validSpotActivationSnapshot(result)||result.operationId!==operationId)throw new Error("Nearby result is unavailable. Review the current shared draft before another action.");
      await latest.current.onApplied(result);
      if(result.phase!=="confirmed")throw new Error(result.error||"Nearby callsign was not applied. Your draft is retained.");
      if(mounted.current)setSnapshot(current=>current?{...current,candidates:[]}:current);
    }catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:"Nearby callsign unavailable.");}
    finally{applying.current=false;if(mounted.current)setWorking(false);}
  };
  const currentApply=useRef(apply);currentApply.current=apply;
  useEffect(()=>{const accept=()=>{const current=latest.current.snapshot;if(current?.candidates.length===1)void currentApply.current(current.candidates[0]);else setError("Choose a nearby spotted callsign explicitly from the list.");};
    window.addEventListener("xlog:accept-nearby-callsign",accept);return()=>window.removeEventListener("xlog:accept-nearby-callsign",accept);},[]);
  if(!snapshot?.enabled)return null;
  return <aside aria-label="Nearby spotted callsigns"><p>Nearby spotted callsigns · receiver suggestion</p>
    {snapshot.candidates.length?<ul>{snapshot.candidates.map(candidate=><li key={candidate.spotId+candidate.spotVersion}>
      {candidate.callsign} · {candidate.offsetHz>=0?"+":""}{candidate.offsetHz} Hz · {candidate.ageSeconds<60?candidate.ageSeconds+" s":Math.floor(candidate.ageSeconds/60)+" min"}
      <button type="button" title={commandTitle("accept-nearby-callsign")} disabled={disabled||working} onClick={()=>void apply(candidate)}>Use callsign</button>
    </li>)}</ul>:<small>{snapshot.reason||"No recent mode-compatible spot near the selected receiver."}</small>}
    {error&&<p role="alert">{error}</p>}
  </aside>;
}

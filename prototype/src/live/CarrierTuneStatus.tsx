import { useEffect, useState, useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import { carrierTuneSession, type CarrierTuneSession } from "./carrierTune";
import { nativeStationSelection } from "./stationSelection";
export function CarrierTuneStatus({session=carrierTuneSession()}:{session?:CarrierTuneSession}){
  const state=useSyncExternalStore(session.subscribe,session.getSnapshot),[error,setError]=useState("");
  useEffect(()=>{
    if(session===carrierTuneSession()&&!nativeStationSelection())return;
    let active=true,stop:(()=>void)|undefined;
    const refresh=()=>{void session.refresh().catch(cause=>{if(active)setError(String(cause));});};
    refresh();void listen("xlog:carrier-tune",refresh).then(unlisten=>{if(active)stop=unlisten;else unlisten();}).catch(()=>{});
    return()=>{active=false;stop?.();};
  },[session]);
  const recover=(action:()=>Promise<void>)=>{setError("");void action().catch(cause=>setError(cause instanceof Error?cause.message:"Carrier Tune receipt unavailable."));};
  return <section aria-label="Carrier Tune receipts">{state.message&&<p role="status">{state.message}</p>}{error&&<p role="alert">{error}</p>}
    {state.pending&&<button type="button" disabled={state.busy} onClick={()=>recover(()=>session.check())}>Check carrier Tune receipt</button>}
    {state.reviewable&&<button type="button" disabled={state.busy} onClick={()=>recover(()=>session.review())}>I have reviewed carrier Tune and observed radio state</button>}
  </section>;
}

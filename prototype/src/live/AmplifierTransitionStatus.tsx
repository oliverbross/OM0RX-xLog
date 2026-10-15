import { useEffect,useState,useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import { amplifierTransitionSession,type AmplifierTransitionSession } from "./amplifierTransition";
import { nativeStationSelection } from "./stationSelection";
export function AmplifierTransitionStatus({session=amplifierTransitionSession()}:{session?:AmplifierTransitionSession}){
  const state=useSyncExternalStore(session.subscribe,session.getSnapshot),[error,setError]=useState("");
  useEffect(()=>{if(session===amplifierTransitionSession()&&!nativeStationSelection())return;let active=true,stop:(()=>void)|undefined;
    const refresh=()=>{void session.refresh().catch(e=>{if(active)setError(String(e));});};refresh();
    void listen("xlog:amplifier-transition",refresh).then(fn=>{if(active)stop=fn;else fn();}).catch(()=>{});return()=>{active=false;stop?.();};},[session]);
  const recover=(run:()=>Promise<void>)=>{setError("");void run().catch(e=>setError(String(e)));};
  return <section aria-label="Amplifier transition receipts">{state.message&&<p role="status">{state.message}</p>}{error&&<p role="alert">{error}</p>}
    {state.pending.map(id=><span key={id}><button type="button" onClick={()=>recover(()=>session.check(id))}>Check amplifier receipt {id.slice(0,8)}</button>{state.receipts.some(r=>r.operation_id===id&&r.status==="unknown")&&<button type="button" onClick={()=>recover(()=>session.review(id))}>I have reviewed amplifier transition {id.slice(0,8)}</button>}</span>)}
  </section>;
}

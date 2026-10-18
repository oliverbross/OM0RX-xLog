import { useEffect,useState,useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import { amplifierTransitionSession,type AmplifierTransitionSession } from "./amplifierTransition";
import { nativeStationSelection } from "./stationSelection";
export function AmplifierTransitionStatus({session=amplifierTransitionSession()}:{session?:AmplifierTransitionSession}){
  const state=useSyncExternalStore(session.subscribe,session.getSnapshot),[error,setError]=useState("");
  useEffect(()=>{if(session===amplifierTransitionSession()&&!nativeStationSelection())return;let active=true,stop:(()=>void)|undefined;
    const refresh=()=>{void session.refresh().catch(e=>{if(active)setError(String(e));});};refresh();
    void listen("xlog:amplifier-transition",refresh).then(fn=>{if(active)stop=fn;else fn();}).catch(()=>{});return()=>{active=false;stop?.();};},[session]);
  if(!state.message&&!error)return null;
  return <section aria-label="Amplifier status">{state.message&&<p role="status">{state.message}</p>}{error&&<p role="alert">{error}</p>}</section>;
}

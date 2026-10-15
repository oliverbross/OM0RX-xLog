import {useEffect,useState,useSyncExternalStore} from "react";
import {listen} from "@tauri-apps/api/event";
import {pttSession,type PTTSession} from "./pttSession";
import {nativeStationSelection} from "./stationSelection";
export function PTTStatus({session=pttSession()}:{session?:PTTSession}){const s=useSyncExternalStore(session.subscribe,session.getSnapshot),[error,setError]=useState("");
  useEffect(()=>{if(session===pttSession()&&!nativeStationSelection())return;let active=true,stop:(()=>void)|undefined;const refresh=()=>{void session.refresh().catch(e=>{if(active)setError(String(e));});};refresh();const timer=setInterval(refresh,1500);void listen("xlog:ptt-session",refresh).then(fn=>{if(active)stop=fn;else fn();}).catch(()=>{});return()=>{active=false;clearInterval(timer);stop?.();};},[session]);
  const recover=(fn:()=>Promise<void>)=>{setError("");void fn().catch(e=>setError(String(e)));};
  return <section aria-label="GUI PTT receipts">{s.message&&<p role="status">{s.message}</p>}{error&&<p role="alert">{error}</p>}{s.releaseRequired&&<><p role="status">Owned GUI PTT release remains required. PTT off is independent of other pending actions.</p><button onClick={()=>recover(()=>session.recoverRetiredOwner())}>Recover retired PTT owner using fresh RX proof</button><p>Recovery sends no Off command. Native proof that the original worker was reaped and fresh RX on the same selected station are required.</p></>}{s.pending.map(id=><span key={id}><button onClick={()=>recover(()=>session.check(id))}>Check PTT receipt {id.slice(0,8)}</button>{s.receipts.some(r=>r.operation_id===id&&r.status==="unknown")&&<button onClick={()=>recover(()=>session.review(id))}>Review PTT uncertainty {id.slice(0,8)}</button>}</span>)}</section>;
}

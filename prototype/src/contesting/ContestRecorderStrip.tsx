import { Circle, Headphones, Bookmark } from "lucide-react";
import { openRecorder, recorderKeyAction, useRecorderStatus } from "./contestRecorder";
import { useState } from "react";

export function ContestRecorderStrip(){
  const {state,error}=useRecorderStatus(),[message,setMessage]=useState("");const active=state?.active;
  const run=(action:string)=>void recorderKeyAction(action).catch(e=>setMessage(String(e)));
  const healthError=error||state?.error;
  const savedSeconds=active?Math.floor((active.savedFrames??0)/active.rate):0;
  const savedTime=`${Math.floor(savedSeconds/60)}:${String(savedSeconds%60).padStart(2,"0")}`;
  const input=active?.inputState?.startsWith("Input silent")?"Input silent":active?.inputState??"Input unknown";
  const details=message||healthError||(active?`${active.status} · ${active.roles.join(" / ")} · ${active.inputState??"Input state unknown"} · Synced through ${new Date(active.startUtcMs+(active.savedFrames??0)/active.rate*1000).toISOString().slice(11,19)}Z`:"Recorder stopped");
  const summary=message?"Recorder action failed":healthError?"Recorder unavailable":active?`${active.status} · ${input} · Saved ${savedTime}`:"Recorder stopped";
  return <div className="contest-recorder-strip" aria-label="Contest recorder"><Circle size={10} aria-hidden="true"/>
    <span className="contest-recorder-strip-status" title={details} role={message?"status":undefined}>{summary}</span>
    {active&&<><button onClick={()=>run("REPLAY_10")}><Headphones size={12}/> Replay 10 s</button><button onClick={()=>run("BOOKMARK_NOW")}><Bookmark size={12}/> Bookmark</button></>}
    <button onClick={()=>void openRecorder().catch(e=>setMessage(String(e)))}>Recorder…</button>
  </div>;
}

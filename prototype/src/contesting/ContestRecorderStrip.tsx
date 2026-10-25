import { Circle, Headphones, Bookmark } from "lucide-react";
import { openRecorder, recorderKeyAction, useRecorderStatus } from "./contestRecorder";
import { useState } from "react";

export function ContestRecorderStrip(){
  const {state,error}=useRecorderStatus(),[message,setMessage]=useState("");const active=state?.active;
  const run=(action:string)=>void recorderKeyAction(action).catch(e=>setMessage(String(e)));
  return <div className="contest-recorder-strip" aria-label="Contest recorder"><Circle size={10} aria-hidden="true"/>
    <span title={error||undefined}>{error?"Recorder health unavailable — no fresh writer proof":active?`${active.status} · ${active.roles.join(" / ")} · ${active.inputState??"Input state unknown"} · ${Math.floor(active.frames/active.rate)} s · Synced through ${new Date(active.startUtcMs+(active.savedFrames??0)/active.rate*1000).toISOString().slice(11,19)}Z`:"Recorder stopped"}</span>
    {active&&<><button onClick={()=>run("REPLAY_10")}><Headphones size={12}/> Replay 10 s</button><button onClick={()=>run("BOOKMARK_NOW")}><Bookmark size={12}/> Bookmark</button></>}
    <button onClick={()=>void openRecorder().catch(e=>setMessage(String(e)))}>Recorder…</button>
    {message&&<span role="status">{message}</span>}
  </div>;
}

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export type RecorderConfig={inputId:string;outputId:string;channels:number;rate:number;mapping:string;roles:string[];routeVerified:boolean;preSeconds:number;postSeconds:number;reserveBytes:number;warningBytes:number};
export type RecorderLink={id:string;qsoId:string|null;frame:number;anchorUtcMs:number;basis:string;current:{Call?:string;TS?:string}|null;original:unknown;note:string;deleted:boolean;coverage:string};
export type RecorderManifest={logId:string;captureId:string;status:string;frames:number;cursor?:number;startUtcMs:number;config:RecorderConfig;gaps:{reason:string;utcMs:number;afterFrame:number}[];segments:{id:number;firstFrame:number;frames:number}[];timeBasis:string};
export type RecorderSelection={logId:string;captureId:string;startFrame:number;endFrame:number;basis?:string;label?:{Call?:string}};
export type RecorderStatus={context:{logId:string;workspaceGeneration:string}|null;config:RecorderConfig|null;root:string;freeBytes:number|null;permission:string;error:string;stationState:string;
  captures:{logId:string;captureId:string;startedUtcMs?:number;controlledTest?:boolean}[];selected:{manifest:RecorderManifest;bookmarks:RecorderLink[];bookmarkCount:number}|null;selection:RecorderSelection|null;
  active:{logId:string;captureId:string;status:string;frames:number;savedFrames?:number;startUtcMs:number;rate:number;roles:string[];finished:boolean;inputLevel?:number;inputState?:string}|null;
  playback:{position:number;frames:number;rate:number;paused:boolean}|null};
export type RecorderRead=<T=any>(request:Record<string,unknown>)=>Promise<T>;
export const recorderRequest:RecorderRead=request=>invoke("contest_recorder_request",{request});
export const openRecorder=()=>invoke<void>("open_contest_recorder");
export async function listenToAudio(request:{logId:string;qsoId?:string;fromUtcMs?:number;toUtcMs?:number},read:RecorderRead=recorderRequest,open:()=>Promise<void>=openRecorder){
  // Full dataset identity goes to native lookup; never substitutes the active log.
  await read({action:"prepare",...request});await open();
}
export function useRecorderStatus(read:RecorderRead=recorderRequest){
  const [state,setState]=useState<RecorderStatus|null>(null),[error,setError]=useState("");
  useEffect(()=>{let live=true,pending=false;
    const refresh=async()=>{if(pending)return;pending=true;try{const next=await read<RecorderStatus>({action:"status"});if(live){setState(next);setError("");}}catch(e){if(live)setError(String(e));}finally{pending=false;}};
    void refresh();const timer=setInterval(()=>{if(!document.hidden)void refresh();},1000);
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape")void read({action:"stop_replay"}).catch(()=>{});};
    window.addEventListener("keydown",escape,true);
    return()=>{live=false;clearInterval(timer);window.removeEventListener("keydown",escape,true);};
  },[read]);return {state,error};
}
export async function recorderKeyAction(action:string,read:RecorderRead=recorderRequest):Promise<boolean>{
  if(action==="OPEN_RECORDER"){await openRecorder();return true;}
  if(action==="STOP_REPLAY"){await read({action:"stop_replay"});return true;}
  if(!["REPLAY_5","REPLAY_10","REPLAY_30","BOOKMARK_NOW"].includes(action))return false;
  if(action.startsWith("REPLAY_")){await read({action:"replay_recent",lastSeconds:Number(action.slice(7)),channel:0,outputChannel:0,volume:0.15});return true;}
  const status=await read<RecorderStatus>({action:"status"}),active=status.active;
  if(!active)throw new Error("No local recording is available. Open Contest → Recorder.");
  if(action==="BOOKMARK_NOW"){await read({action:"bookmark",captureId:active.captureId,note:""});return true;}
  return false;
}

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Headphones } from "lucide-react";
import { listenToAudio, recorderRequest } from "./contestRecorder";
type LinkState={status:string;captureId?:string;basis?:string};
const AudioContext=createContext<{logId:string;links:Record<string,LinkState>}>({logId:"",links:{}});
export function RecorderAudioProvider({logId,ids,children}:{logId:string;ids:string[];children:ReactNode}){
  const [links,setLinks]=useState<Record<string,LinkState>>({}),signature=ids.join("/");
  useEffect(()=>{let alive=true,pending=false;setLinks({});
    const load=async()=>{if(pending||!logId||!ids.length)return;pending=true;try{const value=await recorderRequest<Record<string,LinkState>>({action:"links",logId,qsoIds:ids.filter(Boolean).slice(0,500)});if(alive)setLinks(value&&typeof value==="object"?value:{});}catch{if(alive)setLinks({});}finally{pending=false;}};
    void load();const timer=setInterval(()=>{if(!document.hidden)void load();},3000);return()=>{alive=false;clearInterval(timer);};
  },[logId,signature]);
  return <AudioContext.Provider value={{logId,links}}>{children}</AudioContext.Provider>;
}
export function RecorderAudioAction({qsoId}:{qsoId:string}){
  const {logId,links}=useContext(AudioContext),[error,setError]=useState(""),link=links[qsoId];
  const status=link?.status??"Audio source unknown / unavailable";
  return <><button type="button" title={`${status}${link?.basis?` · ${link.basis}`:""}`} aria-label={`Listen to contact audio · ${status}`} onDoubleClick={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();setError("");void listenToAudio({logId,qsoId}).catch(e=>setError(String(e)));}}><Headphones size={12} aria-hidden="true"/></button>{error&&<span role="status">{error}</span>}</>;
}

import {useEffect,useRef} from "react";
import {invoke,isTauri} from "@tauri-apps/api/core";
import {listen} from "@tauri-apps/api/event";
import {actionForEvent,setNormalBindings,currentNormalBindings,selectNormalBindingScope} from "./normalCommands";
export function useNormalCommands(active:boolean,onError:(message:string)=>void,workspaceGeneration?:string,scope:"normal"|"cw"="normal"){
  const current=useRef({active,onError,workspaceGeneration,scope});current.current={active,onError,workspaceGeneration,scope};
  selectNormalBindingScope(workspaceGeneration);
  useEffect(()=>{
    let live=true,readEpoch=0,stops:(()=>void)[]=[];
    const load=()=>{
      const generation=current.current.workspaceGeneration,epoch=++readEpoch;
      if(!isTauri()||!generation)return;
      void invoke<any>("normal_command_preferences").then(value=>{
        if(!live||epoch!==readEpoch||generation!==current.current.workspaceGeneration)return;
        if(value?.generation!==generation||!Number.isSafeInteger(value?.revision)||value.revision<0)return;
        setNormalBindings(value.preferences?.normalCommandBindings,{generation,revision:value.revision});
      }).catch(()=>{});
    };
    const key=(event:KeyboardEvent)=>{
      if(!current.current.active||event.defaultPrevented||document.documentElement.dataset.shortcutCapture==="true"||!document.hasFocus())return;
      const action=actionForEvent(event,currentNormalBindings());
      if(!action || action==="save-current-qso"||action==="focus-callsign")return;
      if(current.current.scope==="cw"&&!["cw-compose-preview","cw-compose-send"].includes(action))return;
      if(["cw-compose-preview","cw-compose-send"].includes(action)) {
        if(document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]'))return;
        event.preventDefault();event.stopPropagation();
        window.dispatchEvent(new Event(`xlog:${action}`));return;
      }
      if(action==="accept-nearby-callsign"){
        if(!document.querySelector('[aria-label="Nearby spotted callsigns"]'))return;
        event.preventDefault();event.stopPropagation();window.dispatchEvent(new Event("xlog:accept-nearby-callsign"));return;
      }
      event.preventDefault();event.stopPropagation();
      void invoke("normal_command_navigate",{action}).catch(cause=>current.current.onError(String(cause)));
    };
    window.addEventListener("keydown",key);window.addEventListener("focus",load);
    if(isTauri())void listen("xlog:workspace-preferences",load).then(stop=>live?stops.push(stop):stop()).catch(()=>{});
    load();return()=>{live=false;readEpoch++;stops.forEach(stop=>stop());window.removeEventListener("keydown",key);window.removeEventListener("focus",load);};
  },[workspaceGeneration]);
}

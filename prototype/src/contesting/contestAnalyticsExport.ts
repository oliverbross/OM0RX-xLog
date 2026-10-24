import { invoke, isTauri } from "@tauri-apps/api/core";
import { useRef, useState } from "react";

export async function saveAnalyticsFile(filename:string,content:string,type="application/json"):Promise<string>{
  if(isTauri()){
    const result=await invoke<{saved:boolean;cancelled:boolean}>("contest_analytics_export",{filename,content});
    if(result.cancelled)return "Export cancelled.";
    if(result.saved)return "Export saved.";
    throw new Error("The export did not complete. Please try again.");
  }
  const url=URL.createObjectURL(new Blob([content],{type})),anchor=document.createElement("a");
  try{anchor.href=url;anchor.download=filename;document.body.appendChild(anchor);anchor.click();}
  finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return "Download requested.";
}

export function useAnalyticsExport(){
  const active=useRef(false);
  const [pending,setPending]=useState(false),[pendingLabel,setPendingLabel]=useState(""),[message,setMessage]=useState(""),[error,setError]=useState("");
  const perform=async(label:string,waiting:string,action:()=>Promise<string>)=>{
    if(active.current)return;
    active.current=true;setPending(true);setPendingLabel(waiting);setMessage("");setError("");
    try{setMessage(await action());}
    catch(cause){setError(`${label} failed: ${cause instanceof Error?cause.message:String(cause)}`);}
    finally{active.current=false;setPending(false);}
  };
  const save=(filename:string,content:()=>string,type?:string)=>perform("Export","Choose where to save the export…",()=>saveAnalyticsFile(filename,content(),type));
  const print=()=>perform("Print","Opening print dialog…",async()=>{
    if(isTauri())await invoke<void>("contest_analytics_print");
    else window.print();
    return "Print dialog requested.";
  });
  return {pending,pendingLabel,message,error,save,print};
}
export type AnalyticsExport=ReturnType<typeof useAnalyticsExport>;

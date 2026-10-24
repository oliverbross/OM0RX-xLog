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
  const [pending,setPending]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
  const save=async(filename:string,content:()=>string,type?:string)=>{
    if(active.current)return;
    active.current=true;setPending(true);setMessage("");setError("");
    try{setMessage(await saveAnalyticsFile(filename,content(),type));}
    catch(cause){setError(`Export failed: ${cause instanceof Error?cause.message:String(cause)}`);}
    finally{active.current=false;setPending(false);}
  };
  return {pending,message,error,save};
}
export type AnalyticsExport=ReturnType<typeof useAnalyticsExport>;

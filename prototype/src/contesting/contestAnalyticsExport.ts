import { invoke, isTauri } from "@tauri-apps/api/core";
import { useRef, useState } from "react";

export async function saveTextFile(filename:string,content:string,type="application/json",
    command:"contest_analytics_export"|"logbook_export_file"="contest_analytics_export"):Promise<string>{
  if(isTauri()){
    const result=await invoke<{saved:boolean;cancelled:boolean}>(command,{filename,content});
    if(result?.cancelled===true&&result.saved===false)return "Export cancelled.";
    if(result?.saved===true&&result.cancelled===false)return "Export saved.";
    throw new Error("The export did not complete. Please try again.");
  }
  const url=URL.createObjectURL(new Blob([content],{type})),anchor=document.createElement("a");
  try{anchor.href=url;anchor.download=filename;document.body.appendChild(anchor);anchor.click();}
  finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),command==="logbook_export_file"?60_000:1000);}
  return "Download requested.";
}

export const saveAnalyticsFile=saveTextFile;

export function saveLogbookFile(content:string,format:"adi"|"adx"):Promise<string>{
  return saveTextFile(`OM0RX-xLog-integrated-${new Date().toISOString().slice(0,10)}.${format}`,content,
    format==="adx"?"application/xml;charset=utf-8":"text/plain;charset=utf-8","logbook_export_file");
}

export function useAnalyticsExport(){
  const active=useRef(false);
  const [pending,setPending]=useState(false),[pendingLabel,setPendingLabel]=useState(""),[message,setMessage]=useState(""),[error,setError]=useState("");
  const perform=async(label:string,waiting:string,action:()=>Promise<string>)=>{
    if(active.current)return;
    active.current=true;setPending(true);setPendingLabel(waiting);setMessage("");setError("");
    try{const outcome=await action();setMessage(outcome);return outcome;}
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

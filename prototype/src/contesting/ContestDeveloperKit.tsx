import { useEffect, useRef, useState } from "react";
import type { ContestRequest } from "./types";
import type { StrategyScope } from "./ContestReminders";

export function ContestDeveloperKit({scope,request}:{scope:StrategyScope;request:ContestRequest}){
  const [template,setTemplate]=useState("cq_wpx_cw"),[review,setReview]=useState<Record<string,unknown>|null>(null),[text,setText]=useState("");
  const [error,setError]=useState(""),[working,setWorking]=useState(false),ticket=useRef(0);
  useEffect(()=>{ticket.current++;setReview(null);setError("");setWorking(false);},[scope.sessionID,scope.workspaceGeneration,scope.revision,template]);
  const read=async(udc=false)=>{const id=++ticket.current;setWorking(true);setError("");try{
    const frame=await request<Record<string,unknown>>("contest_strategy",{sessionID:scope.sessionID,workspaceGeneration:scope.workspaceGeneration,expectedRevision:scope.revision,
      section:"developer",...(udc?{udcText:text}:{templateID:template})});
    if(!frame.ok)throw Error(frame.error.message);if(ticket.current===id)setReview(frame.result);
  }catch(cause){if(ticket.current===id)setError(cause instanceof Error?cause.message:String(cause));}finally{if(ticket.current===id)setWorking(false);}};
  return <section className="contest-productivity-section" aria-label="Python contest developer kit"><h2>Python contest developer kit</h2>
    <p>Reference examples use the current contest registry, field roles, lifecycle fixtures and export oracles. A scaffold needs official rule, category and reference review plus independent expected results.</p>
    <label>Developer example<select aria-label="Developer template" value={template} disabled={working} onChange={event=>setTemplate(event.target.value)}>
      <option value="cq_wpx_cw">Serial — CQ WPX CW</option><option value="naqp_cw">Name/location — NAQP CW</option><option value="darc_vhf">Grid/distance — DARC VHF</option><option value="wae_cw">Separate QTC journal — WAE CW</option></select></label>
    <button disabled={working} onClick={()=>void read()}>Review Python template manifest</button>
    <details><summary>Unsupported UDC inspection</summary><p>Inspection retains the supplied text and diagnoses unsupported declarations. It never executes commands, converts rules or installs a definition. General UDC conversion remains deferred.</p>
      <label>Original UDC text<textarea aria-label="Original UDC text" rows={5} maxLength={65536} value={text} disabled={working} onChange={event=>{ticket.current++;setReview(null);setText(event.target.value);}}/></label>
      <button disabled={working||!text} onClick={()=>void read(true)}>Inspect without executing or installing</button></details>
    {error&&<p role="alert">{error}</p>}{review&&<><p>{review.converted===false?"Conversion rejected; original input retained in this diagnostic.":"Bundled reference example; no new definition is installed."}</p>
      <button onClick={()=>void navigator.clipboard.writeText(JSON.stringify(review,null,2)).catch(cause=>setError(String(cause)))}>Copy developer evidence</button>
      <pre aria-label="Developer manifest and diagnostics" style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify(review,null,2)}</pre></>}
  </section>;
}

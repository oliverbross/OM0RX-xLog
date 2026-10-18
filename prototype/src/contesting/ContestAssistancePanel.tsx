import { useEffect, useRef, useState } from "react";
import { nativeSCPImport, scpCancel, scpQuery, scpSelect, scpStatus, validateSCPImportResponse,
  type AssistanceRequest, type SCPContext, type SCPDataset, type SCPImport, type SCPMatch, type SCPResult } from "./contestAssistance";
import "./ContestAssistancePanel.css";

export type SCPSelectionScope = { ownerLeaseID: number; sessionID: string; workspaceGeneration: string; draftID: string; inputCallsign: string };
export type ContestSCPPanelSurface = { source: string | null; candidates: { candidateID: string; callsign: string }[];
  busy: boolean; selectCandidate: (candidateID: string) => Promise<void> };
type Props = { request: AssistanceRequest; ownerLeaseID: number; sessionID: string; workspaceGeneration: string; draftID: string; callsign: string;
  disabled?: boolean; onSelect: (callsign: string, scope: SCPSelectionScope) => void; importDataset?: SCPImport;
  onSurfaceChange?: (surface: ContestSCPPanelSurface | null) => void };

export function ContestAssistancePanel({request,ownerLeaseID,sessionID,workspaceGeneration,draftID,callsign,disabled=false,onSelect,importDataset=nativeSCPImport,onSurfaceChange}:Props) {
  const [dataset,setDataset]=useState<SCPDataset|null>(null), [unavailable,setUnavailable]=useState<string|null>(null);
  const [result,setResult]=useState<SCPResult|null>(null), [error,setError]=useState("");
  const [importing,setImporting]=useState(false), [querying,setQuerying]=useState(false), [selecting,setSelecting]=useState(false);
  const [recoveryRequired,setRecoveryRequired]=useState(false);
  const mounted=useRef(true), statusTicket=useRef(0), datasetTicket=useRef(0), queryTicket=useRef(0), selectTicket=useRef(0);
  const currentQuery=useRef<SCPContext|null>(null);

  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;statusTicket.current+=1;datasetTicket.current+=1;queryTicket.current+=1;selectTicket.current+=1;const context=currentQuery.current;if(context)void scpCancel(request,context);currentQuery.current=null;};},[request]);
  useEffect(()=>{selectTicket.current+=1;if(disabled){queryTicket.current+=1;const context=currentQuery.current;if(context)void scpCancel(request,context);currentQuery.current=null;setQuerying(false);setSelecting(false);setResult(null);}},[disabled,request]);
  useEffect(()=>{
    const ticket=++statusTicket.current, datasetVersion=datasetTicket.current;
    void scpStatus(request).then(status=>{if(mounted.current&&ticket===statusTicket.current&&datasetVersion===datasetTicket.current){setDataset(status.dataset);setUnavailable(status.unavailableReason);setRecoveryRequired(false);}})
      .catch(cause=>{if(mounted.current&&ticket===statusTicket.current&&datasetVersion===datasetTicket.current){setDataset(null);setResult(null);setRecoveryRequired(true);setError(message(cause));}});
  },[request]);
  useEffect(()=>{
    const query=callsign.trim().toUpperCase(), ticket=++queryTicket.current;
    selectTicket.current+=1;setQuerying(false);setSelecting(false);setResult(null);
    if(disabled||!dataset||!/^[A-Z0-9/]{2,32}$/.test(query))return;
    const context:SCPContext={sessionID,workspaceGeneration,requestID:crypto.randomUUID()};
    currentQuery.current=context;
    setQuerying(true);setError("");
    const timer=window.setTimeout(()=>void scpQuery(request,context,query).then(value=>{
      if(mounted.current&&queryTicket.current===ticket)setResult(value);
    }).catch(cause=>{if(mounted.current&&queryTicket.current===ticket){setResult(null);setError(message(cause));}})
      .finally(()=>{if(currentQuery.current===context)currentQuery.current=null;if(mounted.current&&queryTicket.current===ticket)setQuerying(false);}),120);
    return()=>{window.clearTimeout(timer);if(currentQuery.current===context)currentQuery.current=null;void scpCancel(request,context);};
  },[request,dataset,ownerLeaseID,sessionID,workspaceGeneration,draftID,callsign,disabled]);

  async function choose(){
    if(disabled||importing)return;
    const ticket=++datasetTicket.current;statusTicket.current+=1;queryTicket.current+=1;selectTicket.current+=1;
    const context=currentQuery.current;if(context)void scpCancel(request,context);currentQuery.current=null;
    setImporting(true);setQuerying(false);setSelecting(false);setResult(null);setError("");
    try{
      const response=await importDataset();
      if(response===null)return;
      const announced=validateSCPImportResponse(response), status=await scpStatus(request);
      if(!status.dataset||status.dataset.sha256!==announced.sha256)throw new Error("The imported SCP dataset could not be confirmed.");
      if(mounted.current&&datasetTicket.current===ticket){setDataset(status.dataset);setUnavailable(status.unavailableReason);setRecoveryRequired(false);}
    }catch(cause){
      if(mounted.current&&datasetTicket.current===ticket){setDataset(null);setResult(null);setUnavailable(null);}
      try{
        const status=await scpStatus(request);
        if(mounted.current&&datasetTicket.current===ticket){setDataset(status.dataset);setUnavailable(status.unavailableReason);setRecoveryRequired(false);setError(message(cause));}
      }catch{
        if(mounted.current&&datasetTicket.current===ticket){setDataset(null);setUnavailable(null);setRecoveryRequired(true);setError("The import outcome could not be confirmed. Check local status before importing again.");}
      }
    }
    finally{if(mounted.current&&datasetTicket.current===ticket)setImporting(false);}
  }
  async function recover(){
    if(disabled||importing)return;const ticket=++datasetTicket.current;statusTicket.current+=1;setImporting(true);setError("");
    try{const status=await scpStatus(request);if(mounted.current&&datasetTicket.current===ticket){setDataset(status.dataset);setUnavailable(status.unavailableReason);setRecoveryRequired(false);}}
    catch{if(mounted.current&&datasetTicket.current===ticket){setDataset(null);setResult(null);setRecoveryRequired(true);setError("Local SCP status is still unavailable. No import was started.");}}
    finally{if(mounted.current&&datasetTicket.current===ticket)setImporting(false);}
  }
  async function select(match:SCPMatch){
    if(!result||disabled||selecting)return;
    const ticket=++selectTicket.current, queryVersion=queryTicket.current;
    const context:SCPContext={sessionID,workspaceGeneration,requestID:result.requestID};
    const scope:SCPSelectionScope={ownerLeaseID,sessionID,workspaceGeneration,draftID,inputCallsign:callsign.trim().toUpperCase()};
    setSelecting(true);setError("");
    try{
      const selected=await scpSelect(request,context,match);
      if(mounted.current&&selectTicket.current===ticket&&queryTicket.current===queryVersion&&!disabled)onSelect(selected,scope);
    }catch(cause){if(mounted.current&&selectTicket.current===ticket)setError(message(cause));}
    finally{if(mounted.current&&selectTicket.current===ticket)setSelecting(false);}
  }
  const busy=importing||querying||selecting;
  useEffect(()=>{if(!onSurfaceChange)return;const current:ContestSCPPanelSurface={source:dataset?.version??null,
    candidates:result?.matches.map(match=>({candidateID:match.matchID,callsign:match.callsign}))??[],busy,
    selectCandidate:async candidateID=>{const match=result?.matches.find(item=>item.matchID===candidateID);
      if(!match)throw new Error("The SCP candidate no longer matches the current query.");await select(match);}};
    onSurfaceChange(current);return()=>onSurfaceChange(null);},[onSurfaceChange,dataset?.version,result,busy]);
  return <section className="contest-scp" aria-label="Super Check Partial"><header><strong>Super Check Partial</strong><button type="button" disabled={disabled||importing||selecting} onClick={()=>void (recoveryRequired?recover():choose())}>{recoveryRequired?"Check local status":dataset?"Replace local file":"Import local file"}</button></header>
    {!dataset?<p>{recoveryRequired?"Local SCP status must be checked before another import.":unavailable==="invalid_cache"?"The saved local SCP index is invalid. Import the source file again.":"No local MASTER.SCP file imported."}</p>:<><small>{dataset.version} · {dataset.recordCount.toLocaleString()} calls · local computed digest</small>{busy&&<p>Checking…</p>}<div className="contest-scp-matches">{result?.matches.map(match=><button type="button" key={match.matchID} disabled={disabled||selecting||importing} onClick={()=>void select(match)}><strong>{match.callsign}</strong><span>{Math.round(match.score)}</span></button>)}</div>{result?.isPartial&&<small>Results cover the bounded catalog prefix.</small>}</>}{error&&<p role="alert">{error}</p>}
  </section>;
}

function message(cause:unknown){return cause instanceof Error?cause.message:String(cause);}

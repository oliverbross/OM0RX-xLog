// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContestAssistancePanel, type ContestSCPPanelSurface } from "./ContestAssistancePanel";
import { scpQuery, scpSelect, validateSCPImportResponse } from "./contestAssistance";
import type { SCPDataset } from "./contestAssistance";
import type { ContestRequest, ContestWorkerResponse } from "./types";

afterEach(cleanup);
const dataset={sourceID:"operator-managed-local",version:"tiny.scp",retrievedAtUTC:"2026-10-18T00:00:00.000Z",sha256:"a".repeat(64),byteCount:16,recordCount:2,duplicateCount:0,digestVerification:"computedOnly" as const};
const context={ownerLeaseID:7,sessionID:"11111111-1111-4111-8111-111111111111",workspaceGeneration:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",draftID:"draft-1"};

it("starts a durable-draft SCP query without relying on a background window timer",async()=>{
  const methods:string[]=[];
  const request=(async(method:string,params:Record<string,unknown>={})=>{
    methods.push(method);
    if(method==="contest_scp_status")return{id:"status",ok:true,result:{dataset,unavailableReason:null}};
    if(method==="contest_scp_query")return{id:"query",ok:true,result:{sessionID:context.sessionID,
      workspaceGeneration:context.workspaceGeneration,requestID:params.requestID,normalizedQuery:"K1",
      matches:[{matchID:`${dataset.sha256}:0`,callsign:"K1ABC",score:100,isPrefixMatch:true}],dataset,
      evaluatedRecordCount:2,isPartial:false}};
    if(method==="contest_scp_cancel")return{id:"cancel",ok:true,result:{cancelled:true}};
    throw new Error(method);
  }) as ContestRequest;
  render(<ContestAssistancePanel request={request} {...context} callsign="K1" onSelect={vi.fn()}/>);
  await act(async()=>{await Promise.resolve();await Promise.resolve();});
  expect(methods).toContain("contest_scp_query");
});

it("shows honest unavailable state then imports, queries, and selects only the authoritative callsign", async()=>{
  let available=false; const calls:string[]=[];
  const request=(async(method:string,params:Record<string,unknown>={})=>{
    calls.push(method);
    if(method==="contest_scp_status")return {id:"x",ok:true,result:{dataset:available?dataset:null,unavailableReason:available?null:"not_imported"}};
    if(method==="contest_scp_query")return {id:"x",ok:true,result:{sessionID:context.sessionID,workspaceGeneration:context.workspaceGeneration,requestID:params.requestID,normalizedQuery:"K1",matches:[{matchID:`${dataset.sha256}:0`,callsign:"K1ABC",score:100,isPrefixMatch:true}],dataset,evaluatedRecordCount:2,isPartial:false}};
    if(method==="contest_scp_select")return {id:"x",ok:true,result:{callsign:"K1ABC"}};
    if(method==="contest_scp_cancel")return {id:"x",ok:true,result:{cancelled:true}};
    throw new Error(method);
  }) as ContestRequest;
  const selected=vi.fn();
  render(<ContestAssistancePanel request={request} {...context} callsign="K1" onSelect={selected} importDataset={async()=>{available=true;return {id:"native",ok:true,result:{dataset}} as ContestWorkerResponse<{dataset:typeof dataset}>;}}/>);
  expect(await screen.findByText(/No MASTER\.SCP dataset is active/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Import local file"}));
  expect(await screen.findByText(/tiny\.scp/)).toBeTruthy();
  const candidate=await screen.findByRole("button",{name:/K1ABC/},{timeout:1500}); fireEvent.click(candidate);
  await waitFor(()=>expect(selected).toHaveBeenCalledWith("K1ABC",expect.objectContaining({ownerLeaseID:7,draftID:"draft-1",inputCallsign:"K1"})));
  expect(calls).toContain("contest_scp_query"); expect(calls).toContain("contest_scp_select");
});

it("keeps the shared Check Partial surface mounted while a query advances",async()=>{
  const publications:(ContestSCPPanelSurface|null)[]=[];
  let finishQuery:(()=>void)|undefined;
  const request=(async(method:string,params:Record<string,unknown>={})=>{
    if(method==="contest_scp_status")return{id:"status",ok:true,result:{dataset,unavailableReason:null}};
    if(method==="contest_scp_query")return new Promise<ContestWorkerResponse<any>>(resolve=>{finishQuery=()=>resolve({id:"query",ok:true,result:{
      sessionID:context.sessionID,workspaceGeneration:context.workspaceGeneration,requestID:String(params.requestID),normalizedQuery:"K1",
      matches:[{matchID:`${dataset.sha256}:0`,callsign:"K1ABC",score:100,isPrefixMatch:true}],dataset,evaluatedRecordCount:2,isPartial:false}});});
    if(method==="contest_scp_cancel")return{id:"cancel",ok:true,result:{cancelled:true}};
    throw new Error(method);
  }) as ContestRequest;
  const view=render(<ContestAssistancePanel request={request} {...context} callsign="K1" onSelect={vi.fn()}
    onSurfaceChange={value=>publications.push(value)}/>);
  await waitFor(()=>expect(finishQuery).toBeTypeOf("function"));
  expect(publications).not.toContain(null);
  finishQuery!();
  await waitFor(()=>expect(publications.at(-1)?.candidates.map(item=>item.callsign)).toEqual(["K1ABC"]));
  expect(publications).not.toContain(null);
  view.unmount();
  expect(publications.at(-1)).toBeNull();
});

it("downloads and reports verified official metadata with the native worker UTC spelling",async()=>{
  const official={sourceID:"supercheckpartial-official",version:"MASTER.SCP",retrievedAtUTC:"2026-10-21T00:02:51Z",
    sha256:"0655f71c2fcafb658c7dd52a87c757a023f6449811f06caaae8cfa6da7b31c33",byteCount:359670,recordCount:50005,
    duplicateCount:0,digestVerification:"matchedExpectedSHA256" as const};
  let current:SCPDataset|null=null;
  const request=(async(method:string)=>{
    if(method==="contest_scp_status")return {id:"status",ok:true,result:{dataset:current,unavailableReason:current?null:"not_imported"}};
    if(method==="contest_scp_download"){current=official;return {id:"download",ok:true,result:{dataset:official,updated:true}};}
    if(method==="contest_scp_query")return new Promise(()=>{});
    if(method==="contest_scp_cancel")return {id:"cancel",ok:true,result:{cancelled:true}};
    throw new Error(method);
  }) as ContestRequest;
  render(<ContestAssistancePanel request={request} {...context} callsign="" onSelect={vi.fn()}/>);
  await screen.findByText(/No MASTER\.SCP dataset is active/);fireEvent.click(screen.getByRole("button",{name:"Download latest"}));
  expect(await screen.findByText(/50,005 calls · official provider · 2026-10-21 UTC/)).toBeTruthy();
  expect(screen.getByText(/SHA-256 0655f71c2fca… · verified digest/)).toBeTruthy();
  expect(screen.getByRole("status").textContent).toMatch(/downloaded and activated/i);
  expect(screen.getByRole("button",{name:"Replace local file"})).toBeTruthy();
});

it("shows retryable provider failure and retains the active dataset",async()=>{
  const request=(async(method:string)=>{
    if(method==="contest_scp_status")return {id:"status",ok:true,result:{dataset,unavailableReason:null}};
    if(method==="contest_scp_download")return {id:"download",ok:false,error:{code:"scp_download_failed",message:"The official SCP service could not be reached. Existing data was retained; try Download Latest again.",outcome:"confirmed"}};
    if(method==="contest_scp_query")return new Promise(()=>{});
    if(method==="contest_scp_cancel")return {id:"cancel",ok:true,result:{cancelled:true}};
    throw new Error(method);
  }) as ContestRequest;
  render(<ContestAssistancePanel request={request} {...context} callsign="" onSelect={vi.fn()}/>);
  await screen.findByText(/tiny\.scp/);fireEvent.click(screen.getByRole("button",{name:"Download latest"}));
  expect((await screen.findByRole("alert")).textContent).toMatch(/try Download Latest again/);
  expect(screen.getByText(/tiny\.scp/)).toBeTruthy();
  expect((screen.getByRole("button",{name:"Download latest"}) as HTMLButtonElement).disabled).toBe(false);
});

it("retains the prior corpus when a failed download cannot refresh status, then recovers on retry",async()=>{
  let statusAvailable=true, statusCalls=0, surface:ContestSCPPanelSurface|null=null;
  const request=(async(method:string)=>{
    if(method==="contest_scp_status"){
      statusCalls+=1;if(!statusAvailable)throw new Error("status unavailable");
      return {id:"status",ok:true,result:{dataset,unavailableReason:null}};
    }
    if(method==="contest_scp_download")return {id:"download",ok:false,error:{code:"scp_download_failed",
      message:"The provider is unavailable.",outcome:"confirmed"}};
    if(method==="contest_scp_cancel")return {id:"cancel",ok:true,result:{cancelled:true}};
    throw new Error(method);
  }) as ContestRequest;
  render(<ContestAssistancePanel request={request} {...context} callsign="" onSelect={vi.fn()}
    onSurfaceChange={value=>{surface=value;}}/>);
  await waitFor(()=>expect(surface?.source).toBe("tiny.scp"));
  statusAvailable=false;
  await act(async()=>{await surface!.downloadLatest();});
  await waitFor(()=>expect(surface?.availability).toBe("status_unavailable"));
  expect((surface as ContestSCPPanelSurface|null)?.source).toBe("tiny.scp");
  expect((surface as ContestSCPPanelSurface|null)?.error).toMatch(/Existing data was retained/);
  statusAvailable=true;
  await act(async()=>{await surface!.refresh();});
  await waitFor(()=>expect(surface?.availability).toBe("ready"));
  expect(statusCalls).toBeGreaterThanOrEqual(3);
});

it("recovers a missing cache through the shared download path, reruns the query, and survives restart",async()=>{
  const official={...dataset,sourceID:"supercheckpartial-official",version:"MASTER.SCP",sha256:"b".repeat(64)};
  let current:SCPDataset|null=null, surface:ContestSCPPanelSurface|null=null, queries=0;
  const request=(async(method:string,params:Record<string,unknown>={})=>{
    if(method==="contest_scp_status")return {id:"status",ok:true,result:{dataset:current,unavailableReason:current?null:"invalid_cache"}};
    if(method==="contest_scp_download"){current=official;return {id:"download",ok:true,result:{dataset:official,updated:true}};}
    if(method==="contest_scp_query"){queries+=1;return {id:"query",ok:true,result:{sessionID:context.sessionID,
      workspaceGeneration:context.workspaceGeneration,requestID:params.requestID,normalizedQuery:"K1",
      matches:[{matchID:`${official.sha256}:0`,callsign:"K1ABC",score:100,isPrefixMatch:true}],dataset:official,
      evaluatedRecordCount:official.recordCount,isPartial:false}};}
    if(method==="contest_scp_cancel")return {id:"cancel",ok:true,result:{cancelled:true}};
    throw new Error(method);
  }) as ContestRequest;
  const props={request,...context,callsign:"K1",onSelect:vi.fn(),onSurfaceChange:(value:ContestSCPPanelSurface|null)=>{surface=value;}};
  const view=render(<ContestAssistancePanel {...props}/>);
  await waitFor(()=>expect(surface?.availability).toBe("invalid_cache"));
  await act(async()=>{await surface!.downloadLatest();});
  await waitFor(()=>expect(surface?.availability).toBe("ready"));
  await waitFor(()=>expect(surface?.candidates.map(item=>item.callsign)).toEqual(["K1ABC"]));
  const beforeRestart=queries;
  view.unmount();
  render(<ContestAssistancePanel {...props}/>);
  await waitFor(()=>expect(queries).toBeGreaterThan(beforeRestart));
  expect((surface as ContestSCPPanelSurface|null)?.source).toBe("MASTER.SCP");
});

it("cancels stale query context on callsign change and never selects implicitly", async()=>{
  const selected=vi.fn(), cancelled:string[]=[];
  const request=(async(method:string,params:Record<string,unknown>={})=>{
    if(method==="contest_scp_status")return {id:"x",ok:true,result:{dataset,unavailableReason:null}};
    if(method==="contest_scp_cancel"){cancelled.push(String(params.requestID));return {id:"x",ok:true,result:{cancelled:true}};}
    if(method==="contest_scp_query")return new Promise(()=>{});
    throw new Error(method);
  }) as ContestRequest;
  const view=render(<ContestAssistancePanel request={request} {...context} callsign="K1" onSelect={selected}/>);
  await screen.findByText(/tiny\.scp/); view.rerender(<ContestAssistancePanel request={request} {...context} callsign="N1" onSelect={selected}/>);
  await waitFor(()=>expect(cancelled.length).toBeGreaterThan(0)); expect(selected).not.toHaveBeenCalled();
});

it("publishes query identity and never restores candidates from an obsolete callsign", async()=>{
  let surface:ContestSCPPanelSurface|null=null;
  let finishObsolete:((value:ContestWorkerResponse<any>)=>void)|undefined;
  const response=(params:Record<string,unknown>,query:string,callsign:string):ContestWorkerResponse<any>=>({id:"query",ok:true,result:{
    sessionID:context.sessionID,workspaceGeneration:context.workspaceGeneration,requestID:String(params.requestID),
    normalizedQuery:query,matches:[{matchID:`${dataset.sha256}:0`,callsign,score:100,isPrefixMatch:true}],
    dataset,evaluatedRecordCount:dataset.recordCount,isPartial:false}});
  const request=(async(method:string,params:Record<string,unknown>={})=>{
    if(method==="contest_scp_status")return{id:"status",ok:true,result:{dataset,unavailableReason:null}};
    if(method==="contest_scp_cancel")return{id:"cancel",ok:true,result:{cancelled:true}};
    if(method==="contest_scp_query"){
      if(params.query==="K8")return new Promise<ContestWorkerResponse<any>>(resolve=>{finishObsolete=resolve;});
      return response(params,"DL3AO","DL3AO");
    }
    throw new Error(method);
  }) as ContestRequest;
  const props={request,...context,onSelect:vi.fn(),onSurfaceChange:(value:ContestSCPPanelSurface|null)=>{surface=value;}};
  const view=render(<ContestAssistancePanel {...props} callsign="K8"/>);
  await waitFor(()=>expect(finishObsolete).toBeTypeOf("function"));
  view.rerender(<ContestAssistancePanel {...props} callsign="DL3AO"/>);
  await waitFor(()=>expect(surface).toMatchObject({query:"DL3AO",candidates:[{callsign:"DL3AO"}]}));
  await act(async()=>{finishObsolete!(response({requestID:"obsolete"},"K8","K8SB"));await Promise.resolve();});
  expect(surface).toMatchObject({query:"DL3AO",candidates:[{callsign:"DL3AO"}]});
});

it("drops a delayed authoritative selection after the active session changes", async()=>{
  let finishSelection:((value:ContestWorkerResponse<{callsign:string}>)=>void)|undefined;
  const selected=vi.fn();
  const request=(async(method:string,params:Record<string,unknown>={})=>{
    if(method==="contest_scp_status")return {id:"x",ok:true,result:{dataset,unavailableReason:null}};
    if(method==="contest_scp_query")return {id:"x",ok:true,result:{sessionID:params.sessionID,workspaceGeneration:context.workspaceGeneration,requestID:params.requestID,normalizedQuery:"K1",matches:[{matchID:`${dataset.sha256}:0`,callsign:"K1ABC",score:100,isPrefixMatch:true}],dataset,evaluatedRecordCount:2,isPartial:false}};
    if(method==="contest_scp_select")return new Promise<ContestWorkerResponse<{callsign:string}>>(resolve=>{finishSelection=resolve;});
    if(method==="contest_scp_cancel")return {id:"x",ok:true,result:{cancelled:true}};
    throw new Error(method);
  }) as ContestRequest;
  const view=render(<ContestAssistancePanel request={request} {...context} callsign="K1" onSelect={selected}/>);
  const candidate=await screen.findByRole("button",{name:/K1ABC/},{timeout:1500}); fireEvent.click(candidate);
  await waitFor(()=>expect(finishSelection).toBeTypeOf("function"));
  view.rerender(<ContestAssistancePanel request={request} {...context} ownerLeaseID={8} sessionID="22222222-2222-4222-8222-222222222222" callsign="K1" onSelect={selected}/>);
  finishSelection!({id:"x",ok:true,result:{callsign:"K1ABC"}});
  await Promise.resolve(); expect(selected).not.toHaveBeenCalled();
});

it("invalidates delayed selection on disable and unmount", async()=>{
  let finish:((value:ContestWorkerResponse<{callsign:string}>)=>void)|undefined;
  const selected=vi.fn(), request=(async(method:string,params:Record<string,unknown>={})=>{
    if(method==="contest_scp_status")return {id:"x",ok:true,result:{dataset,unavailableReason:null}};
    if(method==="contest_scp_query")return {id:"x",ok:true,result:{sessionID:context.sessionID,workspaceGeneration:context.workspaceGeneration,requestID:params.requestID,normalizedQuery:"K1",matches:[{matchID:`${dataset.sha256}:0`,callsign:"K1ABC",score:100,isPrefixMatch:true}],dataset,evaluatedRecordCount:2,isPartial:false}};
    if(method==="contest_scp_select")return new Promise<ContestWorkerResponse<{callsign:string}>>(resolve=>{finish=resolve;});
    if(method==="contest_scp_cancel")return {id:"x",ok:true,result:{cancelled:true}};
    throw new Error(method);
  }) as ContestRequest;
  const view=render(<ContestAssistancePanel request={request} {...context} callsign="K1" onSelect={selected}/>);
  fireEvent.click(await screen.findByRole("button",{name:/K1ABC/},{timeout:1500}));await waitFor(()=>expect(finish).toBeTypeOf("function"));
  view.rerender(<ContestAssistancePanel request={request} {...context} callsign="K1" disabled onSelect={selected}/>);view.unmount();
  finish!({id:"x",ok:true,result:{callsign:"K1ABC"}});await Promise.resolve();expect(selected).not.toHaveBeenCalled();
});

it("clears an obsolete query and keeps import usable without an older status regression", async()=>{
  let resolveInitial:((value:ContestWorkerResponse<unknown>)=>void)|undefined, statusCount=0;
  const replacement={...dataset,version:"replacement.scp",sha256:"b".repeat(64),recordCount:1};
  const request=(async(method:string)=>{
    if(method==="contest_scp_status"&&statusCount++===0)return new Promise<ContestWorkerResponse<unknown>>(resolve=>{resolveInitial=resolve;});
    if(method==="contest_scp_status")return {id:"status",ok:true,result:{dataset:replacement,unavailableReason:null}};
    if(method==="contest_scp_cancel")return {id:"cancel",ok:true,result:{cancelled:true}};
    if(method==="contest_scp_query")return new Promise(()=>{});
    throw new Error(method);
  }) as ContestRequest;
  const view=render(<ContestAssistancePanel request={request} {...context} callsign="K1" onSelect={vi.fn()} importDataset={async()=>({id:"import",ok:true,result:{dataset:replacement}})}/>);
  fireEvent.click(screen.getByRole("button",{name:"Import local file"}));
  expect(await screen.findByText(/replacement\.scp/)).toBeTruthy();
  resolveInitial!({id:"old",ok:true,result:{dataset:null,unavailableReason:"not_imported"}});await Promise.resolve();
  expect(screen.getByText(/replacement\.scp/)).toBeTruthy();
  view.rerender(<ContestAssistancePanel request={request} {...context} callsign="" onSelect={vi.fn()}/>);
  expect((screen.getByRole("button",{name:"Replace local file"}) as HTMLButtonElement).disabled).toBe(false);
});

it("recovers the installed replacement after the native import reply is lost",async()=>{
  const replacement={...dataset,version:"replacement.scp",sha256:"b".repeat(64),recordCount:1};let current=dataset,statusCount=0;
  const request=(async(method:string)=>{
    if(method==="contest_scp_status"){statusCount+=1;return {id:"status",ok:true,result:{dataset:current,unavailableReason:null}};}
    if(method==="contest_scp_query")return new Promise(()=>{});
    if(method==="contest_scp_cancel")return {id:"cancel",ok:true,result:{cancelled:true}};
    throw new Error(method);
  }) as ContestRequest;
  render(<ContestAssistancePanel request={request} {...context} callsign="K1" onSelect={vi.fn()} importDataset={async()=>{current=replacement;throw new Error("Native import reply was lost.");}}/>);
  await screen.findByText(/tiny\.scp/);fireEvent.click(screen.getByRole("button",{name:"Replace local file"}));
  expect(await screen.findByText(/replacement\.scp/)).toBeTruthy();
  expect(statusCount).toBeGreaterThanOrEqual(2);expect(screen.getByRole("button",{name:"Replace local file"})).toBeTruthy();
});

it("blocks another import when a lost reply cannot be recovered from status",async()=>{
  let statusCount=0,imports=0;
  const request=(async(method:string)=>{
    if(method==="contest_scp_status"&&statusCount++===0)return {id:"status",ok:true,result:{dataset,unavailableReason:null}};
    if(method==="contest_scp_status")throw new Error("status unavailable");
    if(method==="contest_scp_query")return new Promise(()=>{});
    if(method==="contest_scp_cancel")return {id:"cancel",ok:true,result:{cancelled:true}};
    throw new Error(method);
  }) as ContestRequest;
  render(<ContestAssistancePanel request={request} {...context} callsign="K1" onSelect={vi.fn()} importDataset={async()=>{imports+=1;throw new Error("lost");}}/>);
  await screen.findByText(/tiny\.scp/);fireEvent.click(screen.getByRole("button",{name:"Replace local file"}));
  expect(await screen.findByRole("button",{name:"Check local status"})).toBeTruthy();
  expect(screen.queryByText(/tiny\.scp/)).toBeNull();expect(screen.queryByRole("button",{name:"Replace local file"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Check local status"}));await screen.findByText(/still unavailable/);
  expect(imports).toBe(1);expect(screen.getByRole("button",{name:"Check local status"})).toBeTruthy();
});

it("rejects malformed frames, stale normalization, digest ordinals, and mismatched selections", async()=>{
  expect(()=>validateSCPImportResponse({id:"x",ok:1,result:{dataset}})).toThrow(/Malformed/);
  const queryRequest=(async()=>({id:"x",ok:true,result:{sessionID:context.sessionID,workspaceGeneration:context.workspaceGeneration,
    requestID:"cccccccc-cccc-cccc-cccc-cccccccccccc",normalizedQuery:"OTHER",matches:[{matchID:`${"b".repeat(64)}:0`,callsign:"K1ABC",score:100,isPrefixMatch:true}],dataset,evaluatedRecordCount:2,isPartial:false}})) as ContestRequest;
  await expect(scpQuery(queryRequest,{sessionID:context.sessionID,workspaceGeneration:context.workspaceGeneration,requestID:"cccccccc-cccc-cccc-cccc-cccccccccccc"},"K1")).rejects.toThrow(/Malformed or stale/);
  const selectRequest=(async()=>({id:"x",ok:true,result:{callsign:"N1WRONG"}})) as ContestRequest;
  await expect(scpSelect(selectRequest,{sessionID:context.sessionID,workspaceGeneration:context.workspaceGeneration,requestID:"dddddddd-dddd-dddd-dddd-dddddddddddd"},{matchID:`${dataset.sha256}:0`,callsign:"K1ABC",score:100,isPrefixMatch:true})).rejects.toThrow(/Malformed/);
});

it("rejects LF CR and CRLF suffixes even when query and selection replies are coherent",async()=>{
  const validContext={sessionID:context.sessionID,workspaceGeneration:context.workspaceGeneration,requestID:"cccccccc-cccc-cccc-cccc-cccccccccccc"};
  for(const suffix of ["\n","\r","\r\n"]){
    const neverCalled=vi.fn(async()=>({id:"x",ok:true,result:{}})) as ContestRequest;
    await expect(scpQuery(neverCalled,validContext,`K1${suffix}`)).rejects.toThrow(/Invalid SCP query context/);expect(neverCalled).not.toHaveBeenCalled();
    const tainted=`K1ABC${suffix}`,selectRequest=(async()=>({id:"x",ok:true,result:{callsign:tainted}})) as ContestRequest;
    await expect(scpSelect(selectRequest,validContext,{matchID:`${dataset.sha256}:0`,callsign:tainted,score:100,isPrefixMatch:true})).rejects.toThrow(/Malformed/);
  }
});

it("rejects UUID digest and ordinal suffixes independently",async()=>{
  const requestID="cccccccc-cccc-cccc-cccc-cccccccccccc";
  const validContext={sessionID:context.sessionID,workspaceGeneration:context.workspaceGeneration,requestID};
  const response=(resultDataset:typeof dataset,matchID:string)=>(async()=>({id:"x",ok:true,result:{...validContext,normalizedQuery:"K1",
    matches:[{matchID,callsign:"K1ABC",score:100,isPrefixMatch:true}],dataset:resultDataset,evaluatedRecordCount:2,isPartial:false}})) as ContestRequest;
  await expect(scpQuery(response(dataset,`${dataset.sha256}:0`),{...validContext,requestID:`${requestID}\n`},"K1")).rejects.toThrow(/Invalid SCP query context/);
  const badDigest={...dataset,sha256:`${dataset.sha256}\n`};
  await expect(scpQuery(response(badDigest,`${badDigest.sha256}:0`),validContext,"K1")).rejects.toThrow(/Malformed or stale/);
  await expect(scpQuery(response(dataset,`${dataset.sha256}:0\r\n`),validContext,"K1")).rejects.toThrow(/Malformed or stale/);
});

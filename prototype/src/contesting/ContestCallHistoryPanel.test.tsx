// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContestCallHistoryPanel } from "./ContestCallHistoryPanel";
import type { ContestDraftSnapshot, ContestRequest, ContestSessionSummary } from "./types";

afterEach(cleanup);
const generation="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",sessionID="11111111-1111-4111-8111-111111111111",draftID="22222222-2222-4222-8222-222222222222";
const identity={id:"cq-ww-cw",version:"1.0.0",edition:"pilot",sourceRevision:"fixture"} as const;
const session={sessionID,workspaceGeneration:generation,revision:2,name:"History",rule:{identity,displayName:"CQ WW CW",mode:"CW",entryDescriptorVersion:1,entry:{mode:"CW",adifMode:"CW",cabrilloQSOType:"CW",cabrilloFormatterVersion:"pilot-1",cabrilloProjectionFormatterVersion:"pilot-2",report:{format:"cwRST",defaultSent:"599",defaultReceived:"599",maximumUTF8Bytes:3},exchange:{sent:"cqZone",received:"cqZone",sentDefault:"stationSnapshot",adifFields:"none"},serial:{requirement:"none",allowedScopes:[]}},referenceDataVersion:"fixture",sourceVerification:"provisional",sourceNote:"fixture"},referenceDataVersion:"fixture",station:{callsign:"OM0RX",cqZone:"15",dxccEntity:"SLOVAK REPUBLIC"},operator:{callsign:"OM0RX",category:"single-op"},qsoCount:0,updatedAt:"2026-10-18T00:00:00.000Z"} as ContestSessionSummary;
const draft={draftID,sessionID,workspaceGeneration:generation,revision:2,fields:{callsign:"K1ABC",sentReport:"599",sentExchange:"15",receivedReport:"599",receivedExchange:"",frequencyHz:14025000,band:"20m",mode:"CW"},reservedSerial:null,validation:{errors:[],warnings:[]},dupe:{state:"clear",reason:"clear"},updatedAt:"2026-10-18T00:00:00.000Z"} as ContestDraftSnapshot;
const dataset={generation:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",sha256:"a".repeat(64),sourceName:"history.any",importedAtUTC:"2026-10-18T00:00:00.000Z",byteCount:80,recordCount:1,indexableRecordCount:1,unindexableRecordCount:0,duplicateCallCount:0};
const preview={previewID:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",sha256:"b".repeat(64),expiresAtUTC:"2026-10-18T00:10:00.000Z",activeDatasetGeneration:null,workspaceGeneration:generation,sourceName:"history.any",byteCount:80,recordCount:2,duplicateCallCount:0,indexableRecordCount:1,unindexableRecordCount:1,isCommittable:true,requiresAdvisoryConfirmation:true,diagnosticCount:1,headers:[{originalName:"Call",canonicalName:"call",knownKey:"call"},{originalName:"X-Unknown",canonicalName:"x-unknown",knownKey:null},{originalName:"CqZone",canonicalName:"cqzone",knownKey:"cqzone"}]};

it("runs private preview, advisory commit, exact selection, and explicit typed apply without exposing a path",async()=>{
  let active=false;const calls:{method:string;params:Record<string,unknown>}[]=[];const applied=vi.fn(async()=>{});
  const request=(async(method:string,params:Record<string,unknown>={})=>{calls.push({method,params});
    if(method==="contest_history_status")return {id:"x",ok:true,result:{dataset:active?dataset:null,pendingPreview:null,unavailableReason:active?null:"not_imported"}};
    if(method==="contest_history_preview_page")return {id:"x",ok:true,result:{preview,offset:0,limit:20,total:1,diagnostics:[{severity:"advisory",code:"invalidCall",line:3,detail:"Row retained for review."}]}};
    if(method==="contest_history_preview_commit"){active=true;return {id:"x",ok:true,result:{dataset}};}
    if(method==="contest_history_query")return {id:"x",ok:true,result:{context:{sessionID,workspaceGeneration:generation,sessionRevision:2,draftID,draftRevision:2,inputCallsign:"K1ABC",requestID:params.requestID,ruleIdentity:identity,referenceDataVersion:"fixture"},normalizedCallsign:"K1ABC",dataset,totalRecords:1,recordOffset:0,recordLimit:20,valueOffset:0,valueLimit:128,records:[{recordID:`${dataset.sha256}:0`,sourceOrdinal:0,sourceLine:2,normalizedCallsign:"K1ABC",indexingIssue:null,values:[{header:preview.headers[0],value:"K1ABC"},{header:preview.headers[1],value:"kept"},{header:preview.headers[2],value:"05"}]}],next:null}};
    if(method==="contest_history_select")return {id:"x",ok:true,result:{context:{sessionID,workspaceGeneration:generation,sessionRevision:2,draftID,draftRevision:2,inputCallsign:"K1ABC",requestID:params.requestID,ruleIdentity:identity,referenceDataVersion:"fixture"},dataset,record:{recordID:`${dataset.sha256}:0`,sourceOrdinal:0,sourceLine:2,normalizedCallsign:"K1ABC",indexingIssue:null,values:[{header:preview.headers[0],value:"K1ABC"},{header:preview.headers[1],value:"kept"},{header:preview.headers[2],value:"05"}]},valueOffset:0,valueLimit:128,nextValueOffset:null,projections:[{id:"legacy-received-zone",sourceKey:"cqzone",target:"legacyReceivedExchange",fieldID:null,label:"CQ zone",rawValue:"05",normalizedValue:"05"}]}};
    if(method==="contest_history_query_cancel")return {id:"x",ok:true,result:{cancelled:true}};
    throw new Error(method);
  }) as ContestRequest;
  render(<ContestCallHistoryPanel request={request} ownerLeaseID={7} session={session} draft={draft} onApply={applied}
    importDataset={async()=>({id:"native",ok:true,result:preview})}/>);
  expect(await screen.findByText("No local call-history file imported.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Import local file"}));
  expect(await screen.findByText(/Row retained/)).toBeTruthy();
  expect(JSON.stringify(calls)).not.toContain("path");
  fireEvent.click(screen.getByRole("checkbox",{name:/reviewed/}));
  fireEvent.click(screen.getByRole("button",{name:"Use this history"}));
  const row=await screen.findByRole("button",{name:/Row 1/},{timeout:2000});fireEvent.click(row);
  expect(await screen.findByText("X-Unknown")).toBeTruthy();expect(screen.getByText("kept")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Apply to blank fields"}));
  await waitFor(()=>expect(applied).toHaveBeenCalledWith(expect.objectContaining({dataset}),["legacy-received-zone"],expect.objectContaining({ownerLeaseID:7,draftRevision:2,datasetGeneration:dataset.generation})));
});

it("does not activate history for an unsupported rule",()=>{
  const unsupported={...session,rule:{...session.rule,identity:{...identity,id:"jidx-cw" as const}}};
  const request=vi.fn() as unknown as ContestRequest;
  const {container}=render(<ContestCallHistoryPanel request={request} ownerLeaseID={1} session={unsupported} draft={draft} onApply={async()=>{}}/>);
  expect(container.textContent).toBe("");expect(request).not.toHaveBeenCalled();
});

it("cancels the scoped query when the history surface unmounts",async()=>{
  const calls:{method:string;params:Record<string,unknown>}[]=[];
  const request=(async(method:string,params:Record<string,unknown>={})=>{calls.push({method,params});
    if(method==="contest_history_status")return {id:"x",ok:true,result:{dataset,pendingPreview:null,unavailableReason:null}};
    if(method==="contest_history_query")return {id:"x",ok:true,result:{context:{sessionID,workspaceGeneration:generation,sessionRevision:2,draftID,draftRevision:2,inputCallsign:"K1ABC",requestID:params.requestID,ruleIdentity:identity,referenceDataVersion:"fixture"},normalizedCallsign:"K1ABC",dataset,totalRecords:0,recordOffset:0,recordLimit:20,valueOffset:0,valueLimit:128,records:[],next:null}};
    if(method==="contest_history_query_cancel")return {id:"x",ok:true,result:{cancelled:true}};
    throw new Error(method);
  }) as ContestRequest;
  const view=render(<ContestCallHistoryPanel request={request} ownerLeaseID={7} session={session} draft={draft} onApply={async()=>{}}/>);
  await waitFor(()=>expect(calls.some(call=>call.method==="contest_history_query")).toBe(true));
  const query= calls.find(call=>call.method==="contest_history_query")!;
  view.unmount();
  await waitFor(()=>expect(calls.some(call=>call.method==="contest_history_query_cancel"&&call.params.requestID===query.params.requestID)).toBe(true));
});

it("fences a late callsign result after the authoritative draft context changes",async()=>{
  const calls:{method:string;params:Record<string,unknown>}[]=[];let resolveOld!:(value:any)=>void;
  const response=(params:Record<string,unknown>,records:unknown[])=>({id:"x",ok:true,result:{context:{sessionID,workspaceGeneration:generation,sessionRevision:params.expectedRevision,draftID,draftRevision:params.expectedDraftRevision,inputCallsign:params.callsign,requestID:params.requestID,ruleIdentity:identity,referenceDataVersion:"fixture"},normalizedCallsign:params.callsign,dataset,totalRecords:records.length,recordOffset:0,recordLimit:20,valueOffset:0,valueLimit:128,records,next:null}});
  const request=(async(method:string,params:Record<string,unknown>={})=>{calls.push({method,params});
    if(method==="contest_history_status")return {id:"x",ok:true,result:{dataset,pendingPreview:null,unavailableReason:null}};
    if(method==="contest_history_query"&&params.callsign==="K1ABC")return new Promise(resolve=>{resolveOld=resolve;});
    if(method==="contest_history_query")return response(params,[]);
    if(method==="contest_history_query_cancel")return {id:"x",ok:true,result:{cancelled:true}};
    throw new Error(method);
  }) as ContestRequest;
  const view=render(<ContestCallHistoryPanel request={request} ownerLeaseID={7} session={session} draft={draft} onApply={async()=>{}}/>);
  await waitFor(()=>expect(calls.some(call=>call.method==="contest_history_query"&&call.params.callsign==="K1ABC")).toBe(true));
  const nextSession={...session,revision:3},nextDraft={...draft,revision:3,fields:{...draft.fields,callsign:"K2XYZ"}};
  view.rerender(<ContestCallHistoryPanel request={request} ownerLeaseID={7} session={nextSession} draft={nextDraft} onApply={async()=>{}}/>);
  const oldParams=calls.find(call=>call.method==="contest_history_query"&&call.params.callsign==="K1ABC")!.params;
  resolveOld(response(oldParams,[{recordID:`${dataset.sha256}:0`,sourceOrdinal:0,sourceLine:2,normalizedCallsign:"K1ABC",indexingIssue:null,values:[]} ]));
  expect(await screen.findByText("0 exact records for K2XYZ")).toBeTruthy();
  expect(screen.queryByRole("button",{name:/Row 1/})).toBeNull();
  expect(calls.some(call=>call.method==="contest_history_query_cancel"&&call.params.requestID===oldParams.requestID)).toBe(true);
});

it.each([
  ["cleared callsign",{draft:{...draft,revision:3,fields:{...draft.fields,callsign:""}},disabled:false,ready:true}],
  ["disabled surface",{draft,disabled:true,ready:true}],
  ["unready surface",{draft,disabled:false,ready:false}],
])("releases a pending query busy owner for a %s",async(_name,next)=>{
  let resolveQuery!:(value:any)=>void;const calls:string[]=[];
  const request=(async(method:string)=>{calls.push(method);
    if(method==="contest_history_status")return {id:"x",ok:true,result:{dataset,pendingPreview:null,unavailableReason:null}};
    if(method==="contest_history_query")return new Promise(resolve=>{resolveQuery=resolve;});
    if(method==="contest_history_query_cancel")return {id:"x",ok:true,result:{cancelled:true}};
    throw new Error(method);
  }) as ContestRequest;
  const view=render(<ContestCallHistoryPanel request={request} ownerLeaseID={7} session={session} draft={draft} onApply={async()=>{}}/>);
  expect(await screen.findByText("Checking…")).toBeTruthy();
  await waitFor(()=>expect(calls).toContain("contest_history_query"));
  view.rerender(<ContestCallHistoryPanel request={request} ownerLeaseID={7} session={session} draft={next.draft} disabled={next.disabled} ready={next.ready} onApply={async()=>{}}/>);
  await waitFor(()=>expect(screen.queryByText("Checking…")).toBeNull());
  if(!next.disabled)expect((screen.getByRole("button",{name:"Preview replacement"}) as HTMLButtonElement).disabled).toBe(false);
  resolveQuery({id:"x",ok:false,error:{message:"late"}});
});

it("releases apply busy ownership when the successful mutation advances revision",async()=>{
  let resolveApply!:()=>void;const applied=vi.fn(()=>new Promise<void>(resolve=>{resolveApply=resolve;}));
  const record={recordID:`${dataset.sha256}:0`,sourceOrdinal:0,sourceLine:2,normalizedCallsign:"K1ABC",indexingIssue:null,values:[{header:preview.headers[0],value:"K1ABC"},{header:preview.headers[2],value:"05"}]};
  const request=(async(method:string,params:Record<string,unknown>={})=>{
    if(method==="contest_history_status")return {id:"x",ok:true,result:{dataset,pendingPreview:null,unavailableReason:null}};
    const queryContext={sessionID,workspaceGeneration:generation,sessionRevision:Number(params.expectedRevision),draftID,draftRevision:Number(params.expectedDraftRevision),inputCallsign:params.callsign,requestID:params.requestID,ruleIdentity:identity,referenceDataVersion:"fixture"};
    if(method==="contest_history_query")return {id:"x",ok:true,result:{context:queryContext,normalizedCallsign:"K1ABC",dataset,totalRecords:1,recordOffset:0,recordLimit:20,valueOffset:0,valueLimit:128,records:[record],next:null}};
    if(method==="contest_history_select")return {id:"x",ok:true,result:{context:queryContext,dataset,record,valueOffset:0,valueLimit:128,nextValueOffset:null,projections:[{id:"legacy-received-zone",sourceKey:"cqzone",target:"legacyReceivedExchange",fieldID:null,label:"CQ zone",rawValue:"05",normalizedValue:"05"}]}};
    if(method==="contest_history_query_cancel")return {id:"x",ok:true,result:{cancelled:true}};
    throw new Error(method);
  }) as ContestRequest;
  const view=render(<ContestCallHistoryPanel request={request} ownerLeaseID={7} session={session} draft={draft} onApply={applied}/>);
  fireEvent.click(await screen.findByRole("button",{name:/Row 1/},{timeout:2000}));
  fireEvent.click(await screen.findByRole("button",{name:"Apply to blank fields"}));
  expect(screen.getByText("Checking…")).toBeTruthy();
  view.rerender(<ContestCallHistoryPanel request={request} ownerLeaseID={7} session={{...session,revision:3}} draft={{...draft,revision:3}} onApply={applied}/>);
  await waitFor(()=>expect(screen.queryByText("Checking…")).toBeNull());
  expect((screen.getByRole("button",{name:"Preview replacement"}) as HTMLButtonElement).disabled).toBe(false);
  resolveApply();
});

it("surfaces an expired diagnostic page without an unhandled rejection",async()=>{
  const request=(async(method:string)=>{
    if(method==="contest_history_status")return {id:"x",ok:true,result:{dataset:null,pendingPreview:preview,unavailableReason:null}};
    if(method==="contest_history_preview_page")return {id:"x",ok:false,error:{message:"The call-history preview expired."}};
    throw new Error(method);
  }) as ContestRequest;
  render(<ContestCallHistoryPanel request={request} ownerLeaseID={7} session={session} draft={draft} onApply={async()=>{}}/>);
  expect((await screen.findByRole("alert")).textContent).toContain("expired");
  await waitFor(()=>expect(screen.queryByText("Checking…")).toBeNull());
});

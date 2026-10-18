import { expect, it } from "vitest";
import { historyProjectedFields, historyQueryAll, historyQueryPage, historySelectAll, type HistoryQueryCoordinates, type HistorySelection } from "./contestCallHistory";
import type { ContestDraftSnapshot, ContestRequest } from "./types";

const base:Omit<ContestDraftSnapshot,"fields">={draftID:"d",sessionID:"s",workspaceGeneration:"g",revision:1,reservedSerial:null,validation:{errors:[],warnings:[]},dupe:{state:"clear",reason:""},updatedAt:"2026-10-18T00:00:00.000Z"};
const selection={dataset:{generation:"g",sha256:"a".repeat(64),sourceName:"h",importedAtUTC:"2026-10-18T00:00:00.000Z",byteCount:1,recordCount:1,indexableRecordCount:1,unindexableRecordCount:0,duplicateCallCount:0},projections:[],context:{},record:{}} as unknown as HistorySelection;

it("projects legacy CQWW without adding structured fields",()=>{
  const draft:ContestDraftSnapshot={...base,fields:{callsign:"K1ABC",sentReport:"599",sentExchange:"15",receivedReport:"599",receivedExchange:"",frequencyHz:null,band:"20m",mode:"CW"}};
  const chosen={...selection,projections:[{id:"zone",sourceKey:"cqzone",target:"legacyReceivedExchange" as const,fieldID:null,label:"CQ zone",rawValue:"05",normalizedValue:"05"}]};
  const fields=historyProjectedFields(chosen,["zone"],draft);
  expect(fields.receivedExchange).toBe("05");expect("receivedExchangeFields" in fields).toBe(false);
});

it("projects only selected blank structured fields in descriptor order",()=>{
  const draft:ContestDraftSnapshot={...base,fields:{callsign:"K1ABC",sentReport:"",sentExchange:"OLIVER CT",receivedReport:"",receivedExchange:"",frequencyHz:null,band:"20m",mode:"CW",sentExchangeFields:{name:"OLIVER",location:"CT"},receivedExchangeFields:{name:"",location:""}}};
  const chosen={...selection,projections:[{id:"name",sourceKey:"name",target:"receivedField" as const,fieldID:"name",label:"Name",rawValue:"Sam",normalizedValue:"SAM"},{id:"location",sourceKey:"state",target:"receivedField" as const,fieldID:"location",label:"Location",rawValue:"CA",normalizedValue:"CA"}]};
  expect(historyProjectedFields(chosen,["location"],draft)).toMatchObject({receivedExchange:"CA",receivedExchangeFields:{name:"",location:"CA"}});
  expect(()=>historyProjectedFields(chosen,["missing"],draft)).toThrow(/Invalid/);
});

const coordinates:HistoryQueryCoordinates={sessionID:"11111111-1111-4111-8111-111111111111",workspaceGeneration:"22222222-2222-4222-8222-222222222222",expectedRevision:2,draftID:"33333333-3333-4333-8333-333333333333",expectedDraftRevision:3,requestID:"44444444-4444-4444-8444-444444444444",callsign:"K1ABC",ruleIdentity:{id:"cq-ww-cw",version:"1",edition:"2026",sourceRevision:"fixture"},referenceDataVersion:"fixture"};
const historyDataset={generation:"55555555-5555-4555-8555-555555555555",sha256:"b".repeat(64),sourceName:"history",importedAtUTC:"2026-10-18T00:00:00.000Z",byteCount:20,recordCount:1,indexableRecordCount:1,unindexableRecordCount:0,duplicateCallCount:0};
const header=(name:string)=>({originalName:name,canonicalName:name.toLowerCase(),knownKey:name.toLowerCase()});
const context=(ruleIdentity:Record<string,string>=coordinates.ruleIdentity)=>({sessionID:coordinates.sessionID,workspaceGeneration:coordinates.workspaceGeneration,sessionRevision:coordinates.expectedRevision,draftID:coordinates.draftID,draftRevision:coordinates.expectedDraftRevision,inputCallsign:coordinates.callsign,requestID:coordinates.requestID,ruleIdentity,referenceDataVersion:coordinates.referenceDataVersion});
const queryResult=(overrides:Record<string,unknown>={})=>({context:context(),normalizedCallsign:"K1ABC",dataset:historyDataset,totalRecords:1,recordOffset:0,recordLimit:20,valueOffset:0,valueLimit:128,records:[{recordID:`${historyDataset.sha256}:0`,sourceOrdinal:0,sourceLine:2,normalizedCallsign:"K1ABC",indexingIssue:null,values:[{header:header("Call"),value:"K1ABC"}]}],next:null,...overrides});
const framed=(result:unknown)=>({id:"x",ok:true as const,result});

it("accepts a valid rule identity regardless of JSON key order",async()=>{
  const reordered={sourceRevision:"fixture",edition:"2026",version:"1",id:"cq-ww-cw"};
  const request=(async()=>framed(queryResult({context:context(reordered)}))) as ContestRequest;
  await expect(historyQueryPage(request,coordinates)).resolves.toMatchObject({totalRecords:1});
});

it("rejects mixed dataset generations and record identities across query pages",async()=>{
  let page=0;
  const request=(async()=>framed(page++===0?queryResult({records:[{...queryResult().records[0],values:[{header:header("Call"),value:"K1ABC"}]}],next:{recordOffset:0,valueOffset:1}}):queryResult({dataset:{...historyDataset,generation:"66666666-6666-4666-8666-666666666666"},valueOffset:1,records:[{...queryResult().records[0],sourceLine:9,values:[{header:header("State"),value:"CT"}]}]}))) as ContestRequest;
  await expect(historyQueryAll(request,coordinates)).rejects.toThrow(/Mixed/);
});

it("rejects mixed dataset, record, or projection data across selection pages",async()=>{
  const projection={id:"zone",sourceKey:"cqzone",target:"legacyReceivedExchange",fieldID:null,label:"CQ zone",rawValue:"05",normalizedValue:"05"};let page=0;
  const request=(async()=>framed(page++===0?{context:context(),dataset:historyDataset,record:{...queryResult().records[0],values:[{header:header("Call"),value:"K1ABC"}]},valueOffset:0,valueLimit:128,nextValueOffset:1,projections:[projection]}:{context:context(),dataset:{...historyDataset,generation:"66666666-6666-4666-8666-666666666666"},record:{...queryResult().records[0],values:[{header:header("CqZone"),value:"05"}]},valueOffset:1,valueLimit:128,nextValueOffset:null,projections:[projection]})) as ContestRequest;
  await expect(historySelectAll(request,coordinates,`${historyDataset.sha256}:0`)).rejects.toThrow(/Mixed/);
});

import { beforeEach, expect, it, vi } from "vitest";
import { directedPassComplete, readDirectedPass, journalDirectedPass, executeDirectedPass, type DirectedPassPorts } from "./contestDirectedPass";
import { validateContestSurfaceActionEnvelope } from "./contestSurfaceProtocol";
import type { ContestDirectedProposal } from "./contestGroupChat";
const native=vi.hoisted(()=>({request:vi.fn()}));
vi.mock("./contestGroupChat",()=>({requestContestGroupAuthority:native.request}));
const context={operatingContext:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",sessionID:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",workspaceGeneration:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"};
const proposal:ContestDirectedProposal={id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",sender:"A",target:"B",kind:"pass",body:"review",call:"K1ABC",frequencyHz:14025000,mode:"CW",laneID:"laneB",
  createdUTC:"2026-11-04T00:00:00.000Z",acknowledgedUTC:null,schema:2,version:1,sessionID:context.sessionID,workspaceGeneration:context.workspaceGeneration,frequencyMeaning:"rx",observedUTC:"2026-11-03T14:00:00Z",source:"operator",supersedesID:null,superseded:false};
const group=(item=proposal)=>({senderStation:"B",authority:{sessionID:context.sessionID,workspaceGeneration:context.workspaceGeneration},directed:[item]});
beforeEach(()=>vi.resetAllMocks());

it("requires a complete versioned receive proposal and never fills legacy values",()=>{
  expect(directedPassComplete(proposal)).toBe(true);
  for(const change of [{schema:undefined},{version:2},{frequencyHz:0},{mode:""},{frequencyMeaning:"tx"},{observedUTC:"bad"},{superseded:true},{recipientActions:[{event:"declined",operationID:"id",atUTC:"now"}]}])
    expect(directedPassComplete({...proposal,...change})).toBe(false);
});

it("rereads authoritative identity and rejects wrong recipient, context, revision or withdrawal",async()=>{
  native.request.mockResolvedValue(group());
  await expect(readDirectedPass(context,proposal.id,1)).resolves.toEqual(proposal);
  expect(native.request).toHaveBeenCalledWith(context,"coordination",{action:"read"});
  for(const change of [{target:"A"},{sessionID:crypto.randomUUID()},{workspaceGeneration:crypto.randomUUID()},{version:2},{superseded:true}]){
    native.request.mockResolvedValue(group({...proposal,...change}));
    await expect(readDirectedPass(context,proposal.id,1)).rejects.toThrow();
  }
});

it("journals a requested action separately from owner acceptance using original operation and context",async()=>{
  native.request.mockResolvedValue(group());
  const operationID=crypto.randomUUID(),capture={draftID:"draft",laneID:"laneB",bindingVersion:2,connectionGeneration:"connection-7"};
  await journalDirectedPass(context,proposal,operationID,"tune_requested",capture);
  await journalDirectedPass(context,proposal,operationID,"tune_accepted",capture,"CAT command accepted; frequency observation unavailable");
  expect(native.request.mock.calls.map(call=>call[2].event)).toEqual(["tune_requested","tune_accepted"]);
  expect(native.request.mock.calls.every(call=>call[2].operationID===operationID&&call[2].context===capture)).toBe(true);
});

it("captures draft, addressed lane and connection generation in the shared surface protocol",()=>{
  const envelope={...context,scope:"contesting",panelID:"active-qso",projectionRevision:7,requestID:crypto.randomUUID(),action:"entry_group_pass",
    params:{draftID:crypto.randomUUID(),expectedDraftRevision:4,messageID:proposal.id,messageVersion:1,operation:"tune",targetLaneID:"laneB",bindingVersion:2,connectionGeneration:"connection-7",reviewedUTC:"2026-11-04T00:00:00.000Z"}};
  expect(()=>validateContestSurfaceActionEnvelope(envelope)).not.toThrow();
  for(const change of [{messageVersion:2},{operation:"transmit"},{targetLaneID:"active"},{connectionGeneration:true},{reviewedUTC:"now"},{frequencyHz:14025000}])
    expect(()=>validateContestSurfaceActionEnvelope({...envelope,params:{...envelope.params,...change}})).toThrow();
});

function ports():DirectedPassPorts{return{context,isCurrent:()=>true,occupied:()=>false,load:vi.fn(async()=>{}),tune:vi.fn(async()=>{}),parkAndLoad:vi.fn(async()=>{})};}
it("rejects occupied drafts and uses the existing explicit Park-and-load port",async()=>{
  native.request.mockResolvedValue(group());
  const owner={...ports(),occupied:()=>true},captured={draftID:"draft",laneID:"laneB"};
  await expect(executeDirectedPass(proposal,crypto.randomUUID(),"load",captured,owner)).rejects.toThrow(/occupied/);
  expect(native.request).not.toHaveBeenCalled();expect(owner.load).not.toHaveBeenCalled();
  await executeDirectedPass(proposal,crypto.randomUUID(),"park",captured,owner);
  expect(owner.parkAndLoad).toHaveBeenCalledExactlyOnceWith(proposal);
  expect(native.request.mock.calls.map(call=>call[2].event)).toEqual(["load_requested","loaded"]);
});
it("journals before effects and blocks duplicate/lost request receipts without another tune",async()=>{
  const trace:string[]=[],seen=new Set<string>(),owner=ports(),operationID=crypto.randomUUID();
  owner.tune=vi.fn(async()=>{trace.push("effect");});
  native.request.mockImplementation(async(_context,_operation,params)=>{
    trace.push(params.event);
    if(params.event==="tune_requested"){
      if(seen.has(params.operationID))throw new Error("already attempted");seen.add(params.operationID);
    }
    return group();
  });
  await executeDirectedPass(proposal,operationID,"tune",{generation:"g"},owner);
  expect(trace).toEqual(["tune_requested","effect","tune_accepted"]);
  await expect(executeDirectedPass(proposal,operationID,"tune",{generation:"g"},owner)).rejects.toThrow(/already attempted/);
  expect(owner.tune).toHaveBeenCalledTimes(1);
  native.request.mockImplementation(async(_context,_operation,params)=>{trace.push(params.event);throw new Error("reply lost");});
  await expect(executeDirectedPass(proposal,crypto.randomUUID(),"tune",{generation:"g"},owner)).rejects.toThrow(/reply lost/);
  expect(owner.tune).toHaveBeenCalledTimes(1);
});
it("rechecks retired context after claim and preserves uncertainty when an effect or final receipt fails",async()=>{
  let current=true;const owner={...ports(),isCurrent:()=>current};
  native.request.mockImplementation(async(_context,_operation,params)=>{if(params.event==="load_requested")current=false;return group();});
  await expect(executeDirectedPass(proposal,crypto.randomUUID(),"load",{},owner)).rejects.toThrow(/changed during/);
  expect(owner.load).not.toHaveBeenCalled();
  expect(native.request.mock.calls.at(-1)?.[2].event).toBe("failed");
  current=true;native.request.mockImplementation(async(_context,_operation,params)=>{if(params.event!=="tune_requested")throw new Error("journal unavailable");return group();});
  await expect(executeDirectedPass(proposal,crypto.randomUUID(),"tune",{},owner)).rejects.toThrow(/journal unavailable/);
  expect(owner.tune).toHaveBeenCalledTimes(1);
  expect(native.request.mock.calls.at(-1)?.[2].event).toBe("uncertain");
});

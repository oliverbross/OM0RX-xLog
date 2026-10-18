// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { contestSurfacePanelIDs, type ContestEntrySurfaceProjection, type ContestSurfaceActionEnvelope, type ContestSurfaceProjection } from "./contestSurfaceProtocol";
import { ContestMutationUncertain } from "./client";
import { useContestSurfaceOwner } from "./useContestSurfaceOwner";

const native=vi.hoisted(()=>({invoke:vi.fn(),listen:vi.fn(),wake:null as null|(()=>void),wakes:[] as (()=>void)[]}));
vi.mock("@tauri-apps/api/core",()=>({invoke:native.invoke,isTauri:()=>true}));
vi.mock("@tauri-apps/api/event",()=>({listen:native.listen}));
const context={operatingContext:"00000000-0000-4000-8000-000000000001",sessionID:"00000000-0000-4000-8000-000000000002",workspaceGeneration:"00000000-0000-4000-8000-000000000003"};
const unavailable=()=>Object.fromEntries(contestSurfacePanelIDs.map(id=>[id,{schemaVersion:1,status:"unavailable"}])) as Record<(typeof contestSurfacePanelIDs)[number],ContestSurfaceProjection>;
const entry:ContestEntrySurfaceProjection={schemaVersion:1,status:"ready",session:{name:"Test",ruleName:"Rule",mode:"CW"},draft:{draftID:"draft-1",revision:5,callsign:"",sentReport:"599",receivedReport:"599",receivedFields:[],frequencyHz:null,frequencyText:"",frequencyError:"",band:"20m",mode:"CW",dupe:{state:"unchecked",reason:""},validation:{errors:[],warnings:[]},reservedSerial:null},busy:false,dirty:false,uncertain:false};
const action=(revision:number):ContestSurfaceActionEnvelope=>({...context,scope:"contesting",panelID:"active-qso",projectionRevision:revision,requestID:crypto.randomUUID(),action:"entry_commit",params:{draftID:"draft-1",expectedDraftRevision:5}});
function Harness({projections,handle,report=vi.fn()}:{projections:ReturnType<typeof unavailable>;handle:(value:ContestSurfaceActionEnvelope)=>Promise<void>;report?:(message:string)=>void}){
  useContestSurfaceOwner({context,projections,handle,report});return null;
}
beforeEach(()=>{vi.resetAllMocks();native.wake=null;native.wakes=[];native.listen.mockImplementation(async(_name,callback)=>{native.wakes.push(callback);
  native.wake=()=>native.wakes.forEach(wake=>wake());return()=>{native.wakes=native.wakes.filter(wake=>wake!==callback);};});});
afterEach(cleanup);

it("rejects unavailable and stale actions before the owner side effect, then applies one exact ready action",async()=>{
  const queue:ContestSurfaceActionEnvelope[]=[];const completed:Record<string,unknown>[]=[];
  native.invoke.mockImplementation(async(command:string,args:Record<string,unknown>)=>{
    if(command==="contest_surface_publish"||command==="contest_surface_context_close")return;
    if(command==="contest_surface_escape_next")return null;
    if(command==="contest_surface_action_next")return queue.shift()??null;
    if(command==="contest_surface_action_complete"){completed.push(args);return;}
    throw new Error(command);
  });
  const handle=vi.fn(async()=>{}),projections=unavailable(),view=render(<Harness projections={projections} handle={handle}/>);
  await waitFor(()=>expect(native.wake).toBeTypeOf("function"));
  queue.push(action(1));await act(async()=>{native.wake!();});
  await waitFor(()=>expect(completed).toHaveLength(1));expect(completed[0]).toMatchObject({outcome:"rejected",message:"The requested contest panel is not available."});
  expect(handle).not.toHaveBeenCalled();
  projections["active-qso"]=entry;view.rerender(<Harness projections={{...projections}} handle={handle}/>);
  await waitFor(()=>expect(native.invoke.mock.calls.filter(([name])=>name==="contest_surface_publish").length).toBeGreaterThanOrEqual(13));
  queue.push(action(2));await act(async()=>{native.wake!();});
  await waitFor(()=>expect(handle).toHaveBeenCalledOnce());expect(completed.at(-1)).toMatchObject({outcome:"applied",projectionRevision:2});
});

it("keeps Entry admission stable and publishes only monitor when a rate clock refresh changes",async()=>{
  const queue:ContestSurfaceActionEnvelope[]=[],completed:Record<string,unknown>[]=[],published:Record<string,unknown>[]=[];
  native.invoke.mockImplementation(async(command:string,args:Record<string,unknown>)=>{
    if(command==="contest_surface_publish"){published.push(args);return;}
    if(command==="contest_surface_context_close")return;
    if(command==="contest_surface_escape_next")return null;
    if(command==="contest_surface_action_next")return queue.shift()??null;
    if(command==="contest_surface_action_complete"){completed.push(args);return;}
    throw new Error(command);
  });
  const handle=vi.fn(async()=>{}),projections={...unavailable(),"active-qso":entry},view=render(<Harness projections={projections} handle={handle}/>);
  await waitFor(()=>expect(published).toHaveLength(contestSurfacePanelIDs.length));
  const rate:any={schemaVersion:1,status:"ready",sessionRevision:5,asOfUTC:"2026-10-18T00:00:00.000Z",fullLogQSOs:0,loggedQSOs:0,
    acceptedQSOs:0,duplicateQSOs:0,invalidQSOs:0,currentHourQSOs:0,operatorStyles:{total:{run:0,searchAndPounce:0,unknown:0},
      currentHour:{run:0,searchAndPounce:0,unknown:0}},trailing60Minutes:{qsoCount:0,spanSeconds:null,qsosPerHour:null},latest10:null,latest100:null,busy:false};
  view.rerender(<Harness projections={{...projections,monitor:rate}} handle={handle}/>);
  await waitFor(()=>expect(published).toHaveLength(contestSurfacePanelIDs.length+1));
  expect(published.at(-1)).toMatchObject({panelID:"monitor",projectionRevision:2});
  queue.push(action(1));await act(async()=>{native.wake!();});await waitFor(()=>expect(handle).toHaveBeenCalledOnce());
  expect(completed.at(-1)).toMatchObject({outcome:"applied",projectionRevision:1});
  view.rerender(<Harness projections={{...projections,monitor:rate,"active-qso":{...entry,dirty:true}}} handle={handle}/>);
  queue.push(action(1));await act(async()=>{native.wake!();});await waitFor(()=>expect(completed.at(-1)).toMatchObject({outcome:"rejected"}));
});

it("recovers one failed Entry publication on the next rate refresh without republishing successful siblings",async()=>{
  const published:Record<string,any>[]=[],report=vi.fn();let failEntry=true;
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_publish"){published.push(args);if(args.panelID==="active-qso"&&failEntry){failEntry=false;throw new Error("entry publish lost");}return;}
    if(command==="contest_surface_context_close")return;if(command==="contest_surface_escape_next"||command==="contest_surface_action_next")return null;
    throw new Error(command);
  });
  const projections={...unavailable(),"active-qso":entry},view=render(<Harness projections={projections} handle={vi.fn()} report={report}/>);
  await waitFor(()=>expect(report).toHaveBeenCalledWith("entry publish lost"));
  expect(published).toHaveLength(contestSurfacePanelIDs.length);
  const rate:any={schemaVersion:1,status:"ready",sessionRevision:5,asOfUTC:"2026-10-18T00:01:00.000Z",fullLogQSOs:0,loggedQSOs:0,
    acceptedQSOs:0,duplicateQSOs:0,invalidQSOs:0,currentHourQSOs:0,operatorStyles:{total:{run:0,searchAndPounce:0,unknown:0},
      currentHour:{run:0,searchAndPounce:0,unknown:0}},trailing60Minutes:{qsoCount:0,spanSeconds:null,qsosPerHour:null},latest10:null,latest100:null,busy:false};
  view.rerender(<Harness projections={{...projections,monitor:rate}} handle={vi.fn()} report={report}/>);
  await waitFor(()=>expect(published.filter(item=>item.panelID==="active-qso")).toHaveLength(2));
  expect(published.filter(item=>item.panelID==="active-qso").at(-1)).toMatchObject({projectionRevision:2});
  expect(published.filter(item=>item.panelID==="monitor")).toHaveLength(2);
  for(const panelID of contestSurfacePanelIDs.filter(id=>id!=="active-qso"&&id!=="monitor"))
    expect(published.filter(item=>item.panelID===panelID)).toHaveLength(1);
});

it("does not execute a dequeued action after its owner context closes",async()=>{
  let release!:(value:ContestSurfaceActionEnvelope)=>void;const pending=new Promise<ContestSurfaceActionEnvelope>(resolve=>{release=resolve;});
  native.invoke.mockImplementation((command:string)=>command==="contest_surface_action_next"?pending:
    command==="contest_surface_escape_next"?Promise.resolve(null):Promise.resolve());
  const handle=vi.fn(async()=>{}),view=render(<Harness projections={{...unavailable(),"active-qso":entry}} handle={handle}/>);
  await waitFor(()=>expect(native.wake).toBeTypeOf("function"));view.unmount();release(action(1));await act(async()=>{await Promise.resolve();});
  expect(handle).not.toHaveBeenCalled();
  expect(native.invoke.mock.calls.some(([name])=>name==="contest_surface_context_close")).toBe(true);
});

it("rebases safe presentation edits across a sibling projection update but rejects a stale commit",async()=>{
  const queue:ContestSurfaceActionEnvelope[]=[],completed:Record<string,unknown>[]=[];
  native.invoke.mockImplementation(async(command:string,args:Record<string,unknown>)=>{
    if(command==="contest_surface_publish"||command==="contest_surface_context_close")return;
    if(command==="contest_surface_escape_next")return null;
    if(command==="contest_surface_action_next")return queue.shift()??null;
    if(command==="contest_surface_action_complete"){completed.push(args);return;}
    throw new Error(command);
  });
  const handle=vi.fn(async()=>{}),projections={...unavailable(),"active-qso":entry},view=render(<Harness projections={projections} handle={handle}/>);
  await waitFor(()=>expect(native.wake).toBeTypeOf("function"));
  view.rerender(<Harness projections={{...projections,"active-qso":{...entry,dirty:true}}} handle={handle}/>);
  const safe={...action(1),requestID:crypto.randomUUID(),action:"entry_set_text" as const,
    params:{draftID:"draft-1",expectedDraftRevision:5,field:"callsign" as const,value:"K1ABC"}};
  queue.push(safe,action(1));await act(async()=>{native.wake!();});
  await waitFor(()=>expect(completed).toHaveLength(2));expect(handle).toHaveBeenCalledOnce();expect(handle).toHaveBeenCalledWith(safe);
  expect(completed[0]).toMatchObject({requestID:safe.requestID,outcome:"applied"});
  expect(completed[1]).toMatchObject({outcome:"rejected",message:"The contest panel changed before this action reached the owner."});
});

it("keeps a successful action uncertain when the applied completion reply is lost",async()=>{
  const queued=action(1),completed:Record<string,unknown>[]=[],report=vi.fn();let delivered=false;
  native.invoke.mockImplementation(async(command:string,args:Record<string,unknown>)=>{
    if(command==="contest_surface_publish"||command==="contest_surface_context_close")return;
    if(command==="contest_surface_escape_next")return null;
    if(command==="contest_surface_action_next"){if(delivered)return null;delivered=true;return queued;}
    if(command==="contest_surface_action_complete"){completed.push(args);throw new Error("completion reply lost");}
    throw new Error(command);
  });
  const handle=vi.fn(async()=>{});render(<Harness projections={{...unavailable(),"active-qso":entry}} handle={handle} report={report}/>);
  await waitFor(()=>expect(handle).toHaveBeenCalledOnce());
  await waitFor(()=>expect(report).toHaveBeenCalledWith("completion reply lost"));
  expect(completed).toHaveLength(1);expect(completed[0]).toMatchObject({outcome:"applied"});
  expect(completed.some(item=>item.outcome==="rejected")).toBe(false);
});

it("leaves the native receipt uncertain when the admitted worker mutation outcome is unknown",async()=>{
  const queued=action(1),completed:Record<string,unknown>[]=[],report=vi.fn();let delivered=false;
  native.invoke.mockImplementation(async(command:string,args:Record<string,unknown>)=>{
    if(command==="contest_surface_publish"||command==="contest_surface_context_close")return;
    if(command==="contest_surface_escape_next")return null;
    if(command==="contest_surface_action_next"){if(delivered)return null;delivered=true;return queued;}
    if(command==="contest_surface_action_complete"){completed.push(args);return;}
    throw new Error(command);
  });
  const uncertain=new ContestMutationUncertain({method:"contest_qso_commit",scope:{sessionID:context.sessionID,
    workspaceGeneration:context.workspaceGeneration,requestID:queued.requestID,expectedRevision:5,draftID:"draft-1",
    payloadDigest:"a".repeat(64),operationTimestamp:"2026-10-18T00:00:00.000Z"},payload:{}},new Error("worker reply lost"));
  const handle=vi.fn(async()=>{throw uncertain;});render(<Harness projections={{...unavailable(),"active-qso":entry}} handle={handle} report={report}/>);
  await waitFor(()=>expect(handle).toHaveBeenCalledOnce());
  await waitFor(()=>expect(report).toHaveBeenCalledWith(uncertain.message));
  expect(completed).toHaveLength(0);
});

it("applies stale Escape through its dedicated drain while an ordinary mutation remains blocked",async()=>{
  const commit=action(1),escape:ContestSurfaceActionEnvelope={...context,scope:"contesting",panelID:"active-qso",
    projectionRevision:0,requestID:crypto.randomUUID(),action:"entry_operator_key",
    params:{draftID:"draft-1",expectedDraftRevision:4,key:"Escape",focusedField:"callsign"}};
  let ordinary:ContestSurfaceActionEnvelope|null=commit,priority:ContestSurfaceActionEnvelope|null=null,releaseCommit!:()=>void,started!:()=>void;
  const commitStarted=new Promise<void>(resolve=>{started=resolve;}),commitGate=new Promise<void>(resolve=>{releaseCommit=resolve;}),
    completed:Record<string,unknown>[]=[],handled:string[]=[];
  native.invoke.mockImplementation(async(command:string,args:Record<string,unknown>)=>{
    if(command==="contest_surface_publish"||command==="contest_surface_context_close")return;
    if(command==="contest_surface_action_next"){const value=ordinary;ordinary=null;return value;}
    if(command==="contest_surface_escape_next"){const value=priority;priority=null;return value;}
    if(command==="contest_surface_action_complete"){completed.push(args);return;}
    throw new Error(command);
  });
  const handle=vi.fn(async(value:ContestSurfaceActionEnvelope)=>{if(value.action==="entry_commit"){started();await commitGate;handled.push("commit");}
    else handled.push("Escape");});
  render(<Harness projections={{...unavailable(),"active-qso":entry}} handle={handle}/>);await commitStarted;
  priority=escape;await act(async()=>{native.wake!();});
  await waitFor(()=>expect(handled).toEqual(["Escape"]));
  expect(completed).toHaveLength(1);expect(completed[0]).toMatchObject({requestID:escape.requestID,outcome:"applied"});
  releaseCommit();await waitFor(()=>expect(handled).toEqual(["Escape","commit"]));
  expect(completed).toHaveLength(2);expect(completed[1]).toMatchObject({requestID:commit.requestID,outcome:"applied"});
});

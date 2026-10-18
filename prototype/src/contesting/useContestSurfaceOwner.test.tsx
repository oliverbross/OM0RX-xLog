// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { contestSurfacePanelIDs, type ContestEntrySurfaceProjection, type ContestSurfaceActionEnvelope, type ContestSurfaceProjection } from "./contestSurfaceProtocol";
import { ContestMutationUncertain } from "./client";
import { useContestSurfaceOwner } from "./useContestSurfaceOwner";

const native=vi.hoisted(()=>({invoke:vi.fn(),listen:vi.fn(),wake:null as null|(()=>void)}));
vi.mock("@tauri-apps/api/core",()=>({invoke:native.invoke,isTauri:()=>true}));
vi.mock("@tauri-apps/api/event",()=>({listen:native.listen}));
const context={operatingContext:"00000000-0000-4000-8000-000000000001",sessionID:"00000000-0000-4000-8000-000000000002",workspaceGeneration:"00000000-0000-4000-8000-000000000003"};
const unavailable=()=>Object.fromEntries(contestSurfacePanelIDs.map(id=>[id,{schemaVersion:1,status:"unavailable"}])) as Record<(typeof contestSurfacePanelIDs)[number],ContestSurfaceProjection>;
const entry:ContestEntrySurfaceProjection={schemaVersion:1,status:"ready",session:{name:"Test",ruleName:"Rule",mode:"CW"},draft:{draftID:"draft-1",revision:5,callsign:"",sentReport:"599",receivedReport:"599",receivedFields:[],frequencyHz:null,frequencyText:"",frequencyError:"",band:"20m",mode:"CW",dupe:{state:"unchecked",reason:""},validation:{errors:[],warnings:[]},reservedSerial:null},busy:false,dirty:false,uncertain:false};
const action=(revision:number):ContestSurfaceActionEnvelope=>({...context,scope:"contesting",panelID:"active-qso",projectionRevision:revision,requestID:crypto.randomUUID(),action:"entry_commit",params:{draftID:"draft-1",expectedDraftRevision:5}});
function Harness({projections,handle,report=vi.fn()}:{projections:ReturnType<typeof unavailable>;handle:(value:ContestSurfaceActionEnvelope)=>Promise<void>;report?:(message:string)=>void}){
  useContestSurfaceOwner({context,projections,handle,report});return null;
}
beforeEach(()=>{vi.resetAllMocks();native.wake=null;native.listen.mockImplementation(async(_name,callback)=>{native.wake=callback;return vi.fn();});});
afterEach(cleanup);

it("rejects unavailable and stale actions before the owner side effect, then applies one exact ready action",async()=>{
  const queue:ContestSurfaceActionEnvelope[]=[];const completed:Record<string,unknown>[]=[];
  native.invoke.mockImplementation(async(command:string,args:Record<string,unknown>)=>{
    if(command==="contest_surface_publish"||command==="contest_surface_context_close")return;
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
  await waitFor(()=>expect(native.invoke.mock.calls.filter(([name])=>name==="contest_surface_publish").length).toBeGreaterThanOrEqual(24));
  queue.push(action(2));await act(async()=>{native.wake!();});
  await waitFor(()=>expect(handle).toHaveBeenCalledOnce());expect(completed.at(-1)).toMatchObject({outcome:"applied",projectionRevision:2});
});

it("does not execute a dequeued action after its owner context closes",async()=>{
  let release!:(value:ContestSurfaceActionEnvelope)=>void;const pending=new Promise<ContestSurfaceActionEnvelope>(resolve=>{release=resolve;});
  native.invoke.mockImplementation((command:string)=>command==="contest_surface_action_next"?pending:Promise.resolve());
  const handle=vi.fn(async()=>{}),view=render(<Harness projections={{...unavailable(),"active-qso":entry}} handle={handle}/>);
  await waitFor(()=>expect(native.wake).toBeTypeOf("function"));view.unmount();release(action(1));await act(async()=>{await Promise.resolve();});
  expect(handle).not.toHaveBeenCalled();
  expect(native.invoke.mock.calls.some(([name])=>name==="contest_surface_context_close")).toBe(true);
});

it("keeps a successful action uncertain when the applied completion reply is lost",async()=>{
  const queued=action(1),completed:Record<string,unknown>[]=[],report=vi.fn();let delivered=false;
  native.invoke.mockImplementation(async(command:string,args:Record<string,unknown>)=>{
    if(command==="contest_surface_publish"||command==="contest_surface_context_close")return;
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

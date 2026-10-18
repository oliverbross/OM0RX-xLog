// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DetachedContestSurface } from "./DetachedContestSurface";
import { loadWindowSurface } from "../windowSurface";

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), wake: null as null|(()=>void) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));

const operatingContext="00000000-0000-4000-8000-000000000001", sessionID="00000000-0000-4000-8000-000000000002",
  workspaceGeneration="00000000-0000-4000-8000-000000000003";
const search=`?view=active-qso&scope=contesting&operatingContext=${operatingContext}&sessionID=${sessionID}&workspaceGeneration=${workspaceGeneration}`;
const projection={schemaVersion:1,status:"ready",session:{name:"ARRL DX",ruleName:"ARRL DX CW",mode:"CW"},draft:{draftID:"draft-1",revision:5,
  callsign:"OM0RX",sentReport:"599",receivedReport:"599",receivedFields:[{id:"power",label:"Power",value:"100",required:true,maximumUTF8Bytes:4}],
  frequencyHz:null,frequencyText:"14.025A",frequencyError:"Frequency must contain digits only.",band:"20m",mode:"CW",dupe:{state:"clear",reason:""},
  validation:{errors:[],warnings:[]},reservedSerial:null},busy:false,dirty:true,uncertain:false};
const snapshot={operatingContext,scope:"contesting",sessionID,workspaceGeneration,panelID:"active-qso",projectionRevision:6,projection,receipts:[]};

beforeEach(()=>{vi.resetAllMocks();native.wake=null;native.listen.mockImplementation(async(_name,callback)=>{native.wake=callback;return()=>{};});window.history.replaceState({},"",search);});
afterEach(()=>{cleanup();window.history.replaceState({},"","/");});

it("routes a scoped native contest child without mounting the normal surface",async()=>{
  expect(await loadWindowSurface(search)).toBe(DetachedContestSurface);
});

it("renders the owner projection and forwards raw edits with exact revision fencing",async()=>{
  native.invoke.mockImplementation(async(command:string,args:Record<string,unknown>)=>{
    if(command==="contest_surface_snapshot")return snapshot;
    if(command==="contest_surface_action")return {requestID:args.requestID,status:"queued"};
    throw new Error(`unexpected ${command}`);
  });
  render(<DetachedContestSurface/>);
  expect(await screen.findByRole("heading",{name:"ARRL DX"})).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("Frequency must contain digits only.");
  fireEvent.change(screen.getByLabelText("Frequency Hz"),{target:{value:"14.025B"}});
  await waitFor(()=>expect(native.invoke.mock.calls.some(([command])=>command==="contest_surface_action")).toBe(true));
  const call=native.invoke.mock.calls.find(([command])=>command==="contest_surface_action")!;
  expect(call[1]).toMatchObject({operatingContext,sessionID,workspaceGeneration,panelID:"active-qso",projectionRevision:6,
    action:"entry_set_frequency_text",params:{draftID:"draft-1",expectedDraftRevision:5,value:"14.025B"}});
});

it("renders Entry v2 sent and simulation state and forwards an exact style action",async()=>{
  const v2={...snapshot,projection:{...projection,schemaVersion:2,
    descriptor:{bands:["20m","40m"],modes:["CW"],sentFields:[{id:"power",label:"Power",value:"100",required:true,maximumUTF8Bytes:4}],
      serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},
    operator:{output:"simulation-only",armed:false,style:"run",status:"disarmed",pending:null,
      functionKeys:[{key:"F1",macro:"CQ"}],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},
      trace:[{operationID:"simulation-1",mode:"CW",macro:"CQ",text:"CQ OM0RX",status:"confirmed"}]}}};
  native.invoke.mockImplementation(async(command:string,args:Record<string,unknown>)=>{
    if(command==="contest_surface_snapshot")return v2;
    if(command==="contest_surface_action")return {requestID:args.requestID,status:"queued"};
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);expect(await screen.findByText("CQ OM0RX")).toBeTruthy();expect(screen.getByText("100")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Operating style"),{target:{value:"search-and-pounce"}});
  await waitFor(()=>expect(native.invoke.mock.calls.some(([command,args])=>command==="contest_surface_action"&&args.action==="entry_operator_style")).toBe(true));
  expect(native.invoke.mock.calls.find(([command,args])=>command==="contest_surface_action"&&args.action==="entry_operator_style")?.[1])
    .toMatchObject({panelID:"active-qso",projectionRevision:6,params:{draftID:"draft-1",expectedDraftRevision:5,value:"search-and-pounce"}});
});

it("does not replay an action when its reply is lost",async()=>{
  let snapshots=0,actions=0;
  native.invoke.mockImplementation(async(command:string)=>{
    if(command==="contest_surface_snapshot"){snapshots+=1;return snapshot;}
    if(command==="contest_surface_action"){actions+=1;throw new Error("IPC reply lost");}
    throw new Error(`unexpected ${command}`);
  });
  render(<DetachedContestSurface/>); await screen.findByRole("heading",{name:"ARRL DX"});
  fireEvent.click(screen.getByRole("button",{name:"Reserve serial"}));
  expect(await screen.findByText("IPC reply lost")).toBeTruthy();
  expect(actions).toBe(1); expect(snapshots).toBeGreaterThanOrEqual(2);
});

it("coalesces rapid Entry typing and forwards the latest text after the authoritative receipt",async()=>{
  let current:any=structuredClone(snapshot);const actions:Record<string,any>[]=[];
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return structuredClone(current);
    if(command==="contest_surface_action"){actions.push(args);return {requestID:args.requestID,status:"queued"};}
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);const input=await screen.findByLabelText("Callsign");
  fireEvent.change(input,{target:{value:"K"}});fireEvent.change(input,{target:{value:"K1"}});fireEvent.change(input,{target:{value:"K1A"}});
  expect((input as HTMLInputElement).value).toBe("K1A");await waitFor(()=>expect(actions).toHaveLength(1));
  current={...current,projectionRevision:7,projection:{...current.projection,draft:{...current.projection.draft,callsign:"K"}},
    receipts:[{requestID:actions[0].requestID,status:"applied",message:null,projectionRevision:7}]};
  await act(async()=>{native.wake!();});
  await waitFor(()=>expect(actions).toHaveLength(2));
  expect(actions[1]).toMatchObject({projectionRevision:7,action:"entry_set_text",params:{value:"K1A"}});
});

it("coalesces rapid log edits and resets the presentation buffer when the owner switches contacts",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=logbook"));
  const editing=(qsoID:string,callsign:string)=>({qsoID,callsign,band:"20m",mode:"CW",sentReport:"599",receivedReport:"599",receivedFields:[],
    frequencyHz:14_025_000,editFrequencyText:"14025000",frequencyError:"",correctionReason:"Operator correction",confirmDelete:false,deletionReason:"Operator deletion"});
  let current:any={...snapshot,panelID:"logbook",projectionRevision:3,projection:{schemaVersion:1,status:"ready",sessionRevision:8,
    page:{offset:0,limit:20,total:2,rows:[]},editing:editing("qso-1","K1ABC"),busy:false},receipts:[]};const actions:Record<string,any>[]=[];
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return structuredClone(current);
    if(command==="contest_surface_action"){actions.push(args);return {requestID:args.requestID,status:"queued"};}
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);const input=await screen.findByLabelText("Callsign");
  fireEvent.change(input,{target:{value:"W"}});fireEvent.change(input,{target:{value:"W1"}});fireEvent.change(input,{target:{value:"W1AW"}});
  expect((input as HTMLInputElement).value).toBe("W1AW");await waitFor(()=>expect(actions).toHaveLength(1));
  current={...current,projectionRevision:4,projection:{...current.projection,editing:editing("qso-1","W")},
    receipts:[{requestID:actions[0].requestID,status:"applied",message:null,projectionRevision:4}]};await act(async()=>{native.wake!();});
  await waitFor(()=>expect(actions).toHaveLength(2));expect(actions[1]).toMatchObject({projectionRevision:4,action:"log_edit_set_text",params:{qsoID:"qso-1",value:"W1AW"}});
  current={...current,projectionRevision:5,projection:{...current.projection,editing:editing("qso-2","VE3XYZ")},receipts:[]};await act(async()=>{native.wake!();});
  await waitFor(()=>expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("VE3XYZ"));
});

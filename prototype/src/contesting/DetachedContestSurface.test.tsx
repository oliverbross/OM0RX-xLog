// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useMemo, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DetachedContestSurface } from "./DetachedContestSurface";
import { loadWindowSurface } from "../windowSurface";
import { contestSurfacePanelIDs, type ContestEntrySurfaceProjection, type ContestSurfaceActionEnvelope,
  type ContestSurfaceProjection } from "./contestSurfaceProtocol";
import { useContestSurfaceOwner } from "./useContestSurfaceOwner";

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), wake: null as null|(()=>void),wakes:[] as (()=>void)[] }));
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

beforeEach(()=>{vi.resetAllMocks();native.wake=null;native.wakes=[];native.listen.mockImplementation(async(_name,callback)=>{native.wakes.push(callback);
  native.wake=()=>native.wakes.forEach(wake=>wake());return()=>{native.wakes=native.wakes.filter(wake=>wake!==callback);};});window.history.replaceState({},"",search);});
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
    operator:{output:"simulation-only",armed:false,style:"run",status:"disarmed",pending:null,focusedField:"callsign",
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

it("flushes true multi-keystroke callsign and exchange intent before detached Enter and waits for terminal receipts",async()=>{
  const operator={output:"simulation-only",armed:true,style:"search-and-pounce",status:"armed",pending:null,focusedField:"callsign",
    functionKeys:[{key:"F1",macro:"CQ"}],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]};
  let current:any={...snapshot,projection:{...projection,schemaVersion:2,
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},operator}};
  const actions:Record<string,any>[]=[];
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return structuredClone(current);
    if(command==="contest_surface_action"){actions.push(args);return {requestID:args.requestID,status:"queued"};}
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);const call=await screen.findByLabelText("Callsign"),exchange=screen.getByLabelText("Power");
  fireEvent.change(call,{target:{value:"K"}});await waitFor(()=>expect(actions).toHaveLength(1));
  fireEvent.change(call,{target:{value:"K1"}});fireEvent.change(call,{target:{value:"K1ABC"}});
  exchange.focus();fireEvent.change(exchange,{target:{value:"14"}});fireEvent.change(exchange,{target:{value:"15"}});fireEvent.keyDown(exchange,{key:"Enter"});
  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({action:"entry_set_text",params:{value:"K"}});
  for(const status of ["queued","uncertain"]){current={...current,receipts:[{requestID:actions[0].requestID,status,message:null,projectionRevision:6}]};
    await act(async()=>{native.wake!();});expect(actions).toHaveLength(1);}
  current={...current,projectionRevision:7,projection:{...current.projection,draft:{...current.projection.draft,revision:6,callsign:"K"}},
    receipts:[{requestID:actions[0].requestID,status:"applied",message:null,projectionRevision:7}]};await act(async()=>{native.wake!();});
  await waitFor(()=>expect(actions).toHaveLength(2));expect(actions[1]).toMatchObject({projectionRevision:7,action:"entry_set_text",
    params:{draftID:"draft-1",expectedDraftRevision:6,value:"K1ABC"}});
  current={...current,projectionRevision:8,projection:{...current.projection,draft:{...current.projection.draft,revision:7,callsign:"K1ABC"}},
    receipts:[{requestID:actions[1].requestID,status:"applied",message:null,projectionRevision:8}]};await act(async()=>{native.wake!();});
  await waitFor(()=>expect(actions).toHaveLength(3));expect(actions[2]).toMatchObject({projectionRevision:8,action:"entry_set_exchange",
    params:{draftID:"draft-1",expectedDraftRevision:7,fieldID:"power",value:"15"}});
  current={...current,projectionRevision:9,projection:{...current.projection,draft:{...current.projection.draft,revision:8,
    receivedFields:[{...current.projection.draft.receivedFields[0],value:"15"}]}},
    receipts:[{requestID:actions[2].requestID,status:"applied",message:null,projectionRevision:9}]};await act(async()=>{native.wake!();});
  await waitFor(()=>expect(actions).toHaveLength(4));expect(actions[3]).toMatchObject({projectionRevision:9,action:"entry_operator_key",
    params:{draftID:"draft-1",expectedDraftRevision:8,key:"Enter",focusedField:"exchange"}});
  expect(actions.filter(item=>item.action==="entry_operator_key")).toHaveLength(1);
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

it("keeps a failed presentation edit explicit until the operator retries or discards it",async()=>{
  let actions=0;native.invoke.mockImplementation(async(command:string)=>{
    if(command==="contest_surface_snapshot")return snapshot;
    if(command==="contest_surface_action"){actions+=1;throw new Error("pre-submit IPC failure");}
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);const input=await screen.findByLabelText("Callsign");
  fireEvent.change(input,{target:{value:"K1ABC"}});await screen.findByText("This edit is not confirmed.");
  expect((input as HTMLInputElement).value).toBe("K1ABC");expect(actions).toBe(1);
  await act(async()=>{native.wake!();});expect(actions).toBe(1);
  fireEvent.click(screen.getByRole("button",{name:"Apply edit again"}));await waitFor(()=>expect(actions).toBe(2));
  fireEvent.click(screen.getByRole("button",{name:"Use shared value"}));
  await waitFor(()=>expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("OM0RX"));
});

it("coalesces synchronous rapid Entry typing into one full-value action",async()=>{
  let current:any=structuredClone(snapshot);const actions:Record<string,any>[]=[];
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return structuredClone(current);
    if(command==="contest_surface_action"){actions.push(args);return {requestID:args.requestID,status:"queued"};}
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);const input=await screen.findByLabelText("Callsign");
  fireEvent.change(input,{target:{value:"K"}});fireEvent.change(input,{target:{value:"K1"}});fireEvent.change(input,{target:{value:"K1A"}});
  expect((input as HTMLInputElement).value).toBe("K1A");await waitFor(()=>expect(actions).toHaveLength(1));
  expect(actions[0]).toMatchObject({projectionRevision:6,action:"entry_set_text",params:{value:"K1A"}});
});

it("submits Escape outside a blocked edit queue without replaying either action",async()=>{
  const operator={output:"simulation-only",armed:true,style:"run",status:"armed",pending:null,focusedField:"callsign",
    functionKeys:[{key:"F1",macro:"CQ"}],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]};
  const current:any={...snapshot,projection:{...projection,schemaVersion:2,
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},operator}};
  const actions:Record<string,any>[]=[];native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return structuredClone(current);
    if(command==="contest_surface_action"){actions.push(args);return {requestID:args.requestID,status:"queued"};}throw new Error(command);
  });
  render(<DetachedContestSurface/>);const callsign=await screen.findByLabelText("Callsign");
  fireEvent.change(callsign,{target:{value:"K"}});await waitFor(()=>expect(actions).toHaveLength(1));
  fireEvent.keyDown(callsign,{key:"Escape"});await waitFor(()=>expect(actions).toHaveLength(2));
  expect(actions.map(item=>item.action)).toEqual(["entry_set_text","entry_operator_key"]);
  expect(actions[1]).toMatchObject({projectionRevision:6,params:{key:"Escape",focusedField:"callsign"}});
});

it("does not silently rebase a control action after another surface revision wins",async()=>{
  const operator={output:"simulation-only",armed:false,style:"run",status:"disarmed",pending:null,focusedField:"callsign",
    functionKeys:[],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]};
  let current:any={...snapshot,projection:{...projection,schemaVersion:2,
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},operator}};
  const actions:Record<string,any>[]=[];native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return structuredClone(current);
    if(command==="contest_surface_action"){actions.push(args);return {requestID:args.requestID,status:"queued"};}throw new Error(command);
  });
  render(<DetachedContestSurface/>);const callsign=await screen.findByLabelText("Callsign");
  fireEvent.change(callsign,{target:{value:"K"}});await waitFor(()=>expect(actions).toHaveLength(1));
  fireEvent.change(screen.getByLabelText("Operating style"),{target:{value:"search-and-pounce"}});
  current={...current,projectionRevision:7,projection:{...current.projection,draft:{...current.projection.draft,revision:6,callsign:"K"}},
    receipts:[{requestID:actions[0].requestID,status:"applied",message:null,projectionRevision:7}]};await act(async()=>{native.wake!();});
  expect(await screen.findByText("The shared contest panel changed before this action could be applied.")).toBeTruthy();
  expect(actions).toHaveLength(1);
});

it("carries delayed multi-field typing through the real owner drain before one Enter intent",async()=>{
  const initial:any={...projection,schemaVersion:2,draft:{...projection.draft,callsign:"",receivedFields:[{...projection.draft.receivedFields[0],value:""}],frequencyError:""},
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},
    operator:{output:"simulation-only",armed:true,style:"search-and-pounce",status:"armed",pending:null,focusedField:"callsign",
      functionKeys:[],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]}};
  let bridgeProjection:any=initial,bridgeRevision=1,receipts:any[]=[],releaseFirst!:()=>void,firstStarted!:()=>void;
  const firstStart=new Promise<void>(resolve=>{firstStarted=resolve;}),firstGate=new Promise<void>(resolve=>{releaseFirst=resolve;}),
    queue:ContestSurfaceActionEnvelope[]=[],keys:string[]=[];
  const unavailable=()=>Object.fromEntries(contestSurfacePanelIDs.map(id=>[id,{schemaVersion:1,status:"unavailable"}])) as
    Record<(typeof contestSurfacePanelIDs)[number],ContestSurfaceProjection>;
  function Owner(){const [entry,setEntry]=useState<ContestEntrySurfaceProjection>(initial);const projections=useMemo(()=>
      ({...unavailable(),"active-qso":entry}),[entry]);
    useContestSurfaceOwner({context:{operatingContext,sessionID,workspaceGeneration},projections,report:vi.fn(),handle:async action=>{
      if(action.action==="entry_set_text"&&action.params.field==="callsign"&&action.params.value==="K"){firstStarted();await firstGate;}
      if(action.action==="entry_operator_key"){keys.push(action.params.key);return;}
      setEntry(previous=>{if(previous.status!=="ready")return previous;const draft={...previous.draft};
        if(action.action==="entry_set_text"&&action.params.field==="callsign")draft.callsign=action.params.value;
        if(action.action==="entry_set_exchange")draft.receivedFields=draft.receivedFields.map(field=>field.id===action.params.fieldID?{...field,value:action.params.value}:field);
        draft.revision+=1;return {...previous,draft};});await new Promise(resolve=>window.setTimeout(resolve,0));
    }});return null;}
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_publish"){if(args.panelID==="active-qso"){bridgeProjection=structuredClone(args.projection);bridgeRevision=args.projectionRevision;}return;}
    if(command==="contest_surface_snapshot")return {operatingContext,scope:"contesting",sessionID,workspaceGeneration,panelID:"active-qso",
      projectionRevision:bridgeRevision,projection:structuredClone(bridgeProjection),receipts:structuredClone(receipts)};
    if(command==="contest_surface_action"){queue.push(args as ContestSurfaceActionEnvelope);receipts=[{requestID:args.requestID,status:"queued",message:null,projectionRevision:bridgeRevision}];
      queueMicrotask(()=>native.wake?.());return {requestID:args.requestID,status:"queued"};}
    if(command==="contest_surface_action_next"){const action=queue.shift()??null;if(action){receipts=[{requestID:action.requestID,status:"uncertain",message:null,projectionRevision:bridgeRevision}];
      queueMicrotask(()=>native.wake?.());}return action;}
    if(command==="contest_surface_action_complete"){receipts=[{requestID:args.requestID,status:args.outcome,message:args.message??null,projectionRevision:args.projectionRevision}];
      queueMicrotask(()=>native.wake?.());return;}
    if(command==="contest_surface_context_close")return;throw new Error(command);
  });
  render(<><Owner/><DetachedContestSurface/></>);const callsign=await screen.findByLabelText("Callsign"),exchange=screen.getByLabelText("Power");
  fireEvent.change(callsign,{target:{value:"K"}});await firstStart;
  fireEvent.change(callsign,{target:{value:"K1"}});fireEvent.change(callsign,{target:{value:"K1ABC"}});exchange.focus();
  fireEvent.change(exchange,{target:{value:"14"}});fireEvent.change(exchange,{target:{value:"15"}});fireEvent.keyDown(exchange,{key:"Enter"});
  expect(keys).toEqual([]);releaseFirst();await waitFor(()=>expect(keys).toEqual(["Enter"]),{timeout:5000});
  await waitFor(()=>{expect(bridgeProjection.draft.callsign).toBe("K1ABC");expect(bridgeProjection.draft.receivedFields[0].value).toBe("15");});
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

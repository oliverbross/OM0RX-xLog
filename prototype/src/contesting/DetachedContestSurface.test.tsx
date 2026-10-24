// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Profiler, useMemo, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { contestMapSpots, contestMapView, DetachedContestSurface } from "./DetachedContestSurface";
import { loadWindowSurface } from "../windowSurface";
import { syntheticMapContext } from "../live/mapContextFixtures";
import { contestSurfacePanelIDs, type ContestEntrySurfaceProjection, type ContestSurfaceActionEnvelope,
  type ContestSurfaceProjection, validContestSurfaceProjection } from "./contestSurfaceProtocol";
import { useContestSurfaceOwner } from "./useContestSurfaceOwner";

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), wake: null as null|(()=>void), emit:null as null|((payload:unknown)=>void),
  wakes:[] as ((event:{payload:unknown})=>void)[],
  closeRequested:null as null|((event:{preventDefault:()=>void})=>Promise<void>) }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: Record<string, any>) =>
    native.invoke(command, command === "contest_surface_action" ? args.envelope : args),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
vi.mock("@tauri-apps/api/window",()=>({getCurrentWindow:()=>({onCloseRequested:async(handler:typeof native.closeRequested)=>{
  native.closeRequested=handler;return()=>{native.closeRequested=null;};}})}));
vi.mock("../Map",()=>({default:(props:any)=><button type="button" data-testid="world-map" onClick={()=>props.onSpot?.(props.data[0])}>
  {[props.data[0]?.band,props.data.length,props.home?.call,props.target?.call,props.data[0]?.statusHex].join("|")}</button>}));

const operatingContext="00000000-0000-4000-8000-000000000001", sessionID="00000000-0000-4000-8000-000000000002",
  workspaceGeneration="00000000-0000-4000-8000-000000000003";
const search=`?view=active-qso&scope=contesting&operatingContext=${operatingContext}&sessionID=${sessionID}&workspaceGeneration=${workspaceGeneration}`;
const projection={schemaVersion:1,status:"ready",session:{name:"ARRL DX",ruleName:"ARRL DX CW",mode:"CW"},draft:{draftID:"draft-1",revision:5,
  callsign:"OM0RX",sentReport:"599",receivedReport:"599",receivedFields:[{id:"power",label:"Power",value:"100",required:true,maximumUTF8Bytes:4}],
  frequencyHz:null,frequencyText:"14.025A",frequencyError:"Frequency must contain digits only.",band:"20m",mode:"CW",dupe:{state:"clear",reason:""},
  validation:{errors:[],warnings:[]},reservedSerial:null},busy:false,dirty:true,uncertain:false};
const snapshot={operatingContext,scope:"contesting",sessionID,workspaceGeneration,panelID:"active-qso",projectionRevision:6,projection,receipts:[]};
const sharedSpot={id:"spot-1",receivedAt:Math.floor(Date.now()/1000)-978_307_200,clusterName:"SK6AW",spotter:"K1ABC",spotterContinent:null,
  frequencyKHz:14025,frequencyText:"14025.0",callsign:"DL1ABC",comment:"CQ",band:"20m",mode:"CW",country:"Germany",adif:230,
  continent:"EU",cqZone:14,ituZone:28,callStatus:"New",dxccStatus:"New",workedBefore:null,specialTags:[],score:80,contestPoints:null,
  contestDupe:null,contestMultiplierCount:null,contestCountryMultiplier:null,contestZoneMultiplier:null,
  scoreReasons:[],aggregateCount:1,aggregateSpotters:["K1ABC"],source:"DX Cluster",statusHex:"",bandHex:"",modeHex:"",marked:false};
const tabMaps={tabNext:{callsign:"sent",sent:"receive",receive:"other_1",other_1:"other_2",other_2:"callsign"},
  tabPrevious:{callsign:"other_2",sent:"callsign",receive:"sent",other_1:"receive",other_2:"other_1"}} as const;

beforeEach(()=>{vi.resetAllMocks();localStorage.clear();native.wake=null;native.emit=null;native.wakes=[];native.listen.mockImplementation(async(_name,callback)=>{native.wakes.push(callback);
  native.wake=()=>native.wakes.forEach(wake=>wake({payload:null}));native.emit=payload=>native.wakes.forEach(wake=>wake({payload}));
  return()=>{native.wakes=native.wakes.filter(wake=>wake!==callback);};});window.history.replaceState({},"",search);});
afterEach(()=>{cleanup();window.history.replaceState({},"","/");});

it("maps only contest-projected located spots with CQ WW multiplier colors",()=>{
  const located={...sharedSpot,latitude:51,longitude:13};
  const projected=[
    {...sharedSpot,id:"double",callsign:"DL1PROJECTED",frequencyKHz:7125,frequencyText:"7125.0",band:"40m",mode:"SSB",
      country:"Projected Germany",adif:999,spotter:"PROJECTED",contestDupe:false,contestMultiplierCount:2,contestCountryMultiplier:true,contestZoneMultiplier:true},
    {...sharedSpot,id:"single",contestDupe:false,contestMultiplierCount:1,contestCountryMultiplier:true,contestZoneMultiplier:false},
    {...sharedSpot,id:"qso",contestDupe:false,contestMultiplierCount:0,contestCountryMultiplier:false,contestZoneMultiplier:false},
    {...sharedSpot,id:"dupe",contestDupe:true,contestMultiplierCount:0,contestCountryMultiplier:false,contestZoneMultiplier:false},
  ];
  const shared=projected.map((spot,index)=>({...located,id:spot.id,callsign:`DL${index}ABC`,latitude:51+index,longitude:13+index}));
  shared.push({...located,id:"not-in-contest",callsign:"K1ABC"});
  expect(contestMapSpots(projected,shared)).toEqual([
    expect.objectContaining({id:"double",call:"DL1PROJECTED",mhz:7.125,band:"40m",mode:"SSB",country:"Projected Germany",
      adif:999,reporter:"PROJECTED",lat:51,lon:13,callStatus:"Double multiplier",statusHex:"#00e51b"}),
    expect.objectContaining({id:"single",callStatus:"Single multiplier",statusHex:"#ff5267"}),
    expect.objectContaining({id:"qso",callStatus:"Valid QSO",statusHex:"#3da5f4"}),
    expect.objectContaining({id:"dupe",callStatus:"Dupe / non-workable",statusHex:"#aeb5b7",state:"worked"}),
  ]);
});

it("limits the contest map to the operating band and reuses the normal map home and selected path target",()=>{
  const forty={...sharedSpot,id:"forty",callsign:"DL1ABC",frequencyKHz:7125,frequencyText:"7125.0",band:"40m",mode:"SSB",
      contestDupe:false,contestMultiplierCount:2,contestCountryMultiplier:true,contestZoneMultiplier:true},
    twenty={...sharedSpot,id:"twenty",callsign:"K1ABC",frequencyKHz:14225,frequencyText:"14225.0",band:"20m",mode:"SSB",
      contestDupe:false,contestMultiplierCount:0,contestCountryMultiplier:false,contestZoneMultiplier:false},
    shared=[{...forty,latitude:51,longitude:13},{...twenty,latitude:38,longitude:-77}],context=syntheticMapContext(),
    projection={schemaVersion:2,status:"ready",draftID:"draft-1",draftRevision:5,radioFrequencyHz:7_125_000,
      connectedClusters:1,loadedSpots:2,selectedSpotID:"forty",configuredClusters:[],connections:[],
      contestSessionID:sessionID,supportedBands:["20m","40m"],allowedModeGroups:["phone"],bandSegments:[],markedOnly:false,
      spots:[forty,twenty],busy:false} as const;
  const view=contestMapView(projection as any,shared,context);
  expect(view.currentBand).toBe("40m");
  expect(view.spots).toEqual([expect.objectContaining({id:"forty",statusHex:"#00e51b"})]);
  expect(view.home).toEqual(context.metadata.home);
  expect(view.target).toEqual({call:"DL1ABC",lat:51,lon:13,country:"Germany",locationSource:"Selected contest spot"});
  expect(view.selected).toBe("forty");
  expect(contestMapView({...projection,radioFrequencyHz:null,supportedBands:["40m"]} as any,shared,context).spots)
    .toEqual([expect.objectContaining({id:"forty"})]);
  expect(contestMapView({...projection,radioFrequencyHz:null} as any,shared,context).spots).toEqual([]);
});

it("renders the current-band contest map with the normal home path and selects a clicked spot",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=world-map"));
  const spot={...sharedSpot,id:"forty",callsign:"DL1ABC",frequencyKHz:7125,frequencyText:"7125.0",band:"40m",mode:"SSB",
      contestDupe:false,contestMultiplierCount:2,contestCountryMultiplier:true,contestZoneMultiplier:true},
    view={schemaVersion:2,status:"ready",draftID:"draft-1",draftRevision:5,radioFrequencyHz:7_125_000,
      connectedClusters:1,loadedSpots:1,selectedSpotID:"forty",configuredClusters:[],connections:[],
      contestSessionID:sessionID,supportedBands:["40m"],allowedModeGroups:["phone"],bandSegments:[],markedOnly:false,
      spots:[spot],busy:false},context=syntheticMapContext();
  context.cluster.response={snapshot:{spots:[{...spot,latitude:51,longitude:13}]},configuration:{palette:{}}};
  native.invoke.mockImplementation(async(command:string,args:any)=>{
    if(command==="contest_surface_snapshot")return{...snapshot,panelID:"world-map",projection:view};
    if(command==="map_context_snapshot")return context;
    if(command==="contest_surface_action")return{applied:true,projectionRevision:7,message:null};
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);
  const map=await screen.findByTestId("world-map");
  await waitFor(()=>expect(map.textContent).toBe("40m|1|TESTHOME|DL1ABC|#00e51b"));
  fireEvent.click(map);
  await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith("contest_surface_action",expect.objectContaining({
    action:"spot_select",params:{draftID:"draft-1",expectedDraftRevision:5,spotID:"forty"}})));
});

it("rereads a restored Main Logging window after the replacement context listener is installed",async()=>{
  const unavailable={...snapshot,projectionRevision:0,projection:{schemaVersion:1,status:"unavailable"}};
  let registered!:()=>void,ready=false;
  native.invoke.mockImplementation(async(command:string)=>{
    if(command!=="contest_surface_snapshot")throw new Error(command);
    return ready?snapshot:unavailable;
  });
  native.listen.mockImplementation(()=>new Promise(resolve=>{registered=()=>resolve(()=>{});}));
  render(<DetachedContestSurface/>);
  expect(await screen.findByText("Loading shared contest panel…")).toBeTruthy();
  // The saved window opened while contest_open reset the native context. Its
  // first ready publication lands before the asynchronous listener is live.
  ready=true;registered();
  expect(await screen.findByLabelText("Callsign")).toHaveProperty("value","OM0RX");
  expect(screen.queryByText("Loading shared contest panel…")).toBeNull();
  expect(native.invoke.mock.calls.filter(([command])=>command==="contest_surface_snapshot")).toHaveLength(2);
});

it("ignores publication wakes for other detached contest panels",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=callsign-intelligence"));
  const check={schemaVersion:1,status:"ready",draftID:"draft-1",draftRevision:5,inputCallsign:"OM0A",
    loggedCandidates:[],clusterCandidates:[],scp:{source:"MASTER.SCP",candidates:[]},history:{source:null,rows:[]},busy:false};
  native.invoke.mockImplementation(async(command:string)=>command==="contest_surface_snapshot"
    ?{...snapshot,panelID:"callsign-intelligence",projection:check}:Promise.reject(new Error(command)));
  render(<DetachedContestSurface/>);
  expect(await screen.findByRole("heading",{name:"Check Partial"})).toBeTruthy();
  const reads=()=>native.invoke.mock.calls.filter(([command])=>command==="contest_surface_snapshot").length;
  const initial=reads();
  await act(async()=>{native.emit!("active-qso");await Promise.resolve();});
  expect(reads()).toBe(initial);
  await act(async()=>{native.emit!("callsign-intelligence");});
  await waitFor(()=>expect(reads()).toBe(initial+1));
});

it("does not rerender Check Partial for a generic wake when its snapshot is unchanged",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=callsign-intelligence"));
  const check={schemaVersion:1,status:"ready",draftID:"draft-1",draftRevision:5,inputCallsign:"OM0A",
    loggedCandidates:[],clusterCandidates:[],scp:{source:"MASTER.SCP",candidates:[]},history:{source:null,rows:[]},busy:false};
  let current:any={...snapshot,panelID:"callsign-intelligence",projection:check};
  native.invoke.mockImplementation(async(command:string)=>command==="contest_surface_snapshot"
    ?structuredClone(current):Promise.reject(new Error(command)));
  const commits:number[]=[];
  render(<Profiler id="check" onRender={()=>commits.push(commits.length+1)}><DetachedContestSurface/></Profiler>);
  expect(await screen.findByRole("heading",{name:"Check Partial"})).toBeTruthy();
  const reads=()=>native.invoke.mock.calls.filter(([command])=>command==="contest_surface_snapshot").length;
  await waitFor(()=>expect(reads()).toBeGreaterThanOrEqual(2));
  await act(async()=>{await Promise.resolve();});
  const initialReads=reads(), initialCommits=commits.length;
  await act(async()=>{native.emit!(null);});
  await waitFor(()=>expect(reads()).toBe(initialReads+1));
  expect(commits).toHaveLength(initialCommits);

  current={...current,projectionRevision:7,projection:{...check,
    scp:{source:"MASTER.SCP",candidates:[{candidateID:"scp-1",callsign:"OM0RX"}]}}};
  await act(async()=>{native.emit!("callsign-intelligence");});
  expect(await screen.findByRole("button",{name:/OM0RX/})).toBeTruthy();
  expect(commits.length).toBeGreaterThan(initialCommits);
});

it("recovers a restored Main Logging window when its ready publication was missed",async()=>{
  vi.useFakeTimers();
  try {
    const unavailable={...snapshot,projectionRevision:0,projection:{schemaVersion:1,status:"unavailable"}};
    let ready=false;
    native.invoke.mockImplementation(async(command:string)=>{
      if(command!=="contest_surface_snapshot")throw new Error(command);
      return ready?snapshot:unavailable;
    });
    render(<DetachedContestSurface/>);
    await act(async()=>{await Promise.resolve();await Promise.resolve();});
    expect(screen.getByText("Loading shared contest panel…")).toBeTruthy();
    ready=true;
    await act(async()=>{await vi.advanceTimersByTimeAsync(250);});
    expect(screen.getByLabelText("Callsign")).toHaveProperty("value","OM0RX");
    expect(screen.queryByText("Loading shared contest panel…")).toBeNull();
  } finally { vi.useRealTimers(); }
});

it("retries a restored Main Logging window after its startup snapshot reads are rejected",async()=>{
  vi.useFakeTimers();
  try {
    let reads=0;
    native.invoke.mockImplementation(async(command:string)=>{
      if(command!=="contest_surface_snapshot")throw new Error(command);
      reads+=1;
      if(reads<=2)throw new Error("The replacement contest window is still settling.");
      return snapshot;
    });
    render(<DetachedContestSurface/>);
    await act(async()=>{await Promise.resolve();await Promise.resolve();});
    expect(screen.getByText("Loading shared contest panel…")).toBeTruthy();
    await act(async()=>{await vi.advanceTimersByTimeAsync(250);});
    expect(screen.getByLabelText("Callsign")).toHaveProperty("value","OM0RX");
    expect(reads).toBeGreaterThanOrEqual(3);
  } finally { vi.useRealTimers(); }
});

it("supersedes a hung startup snapshot with the scheduled restored-window retry",async()=>{
  vi.useFakeTimers();
  try {
    let reads=0;
    native.invoke.mockImplementation((command:string)=>{
      if(command!=="contest_surface_snapshot")return Promise.reject(new Error(command));
      reads+=1;
      return reads===1?new Promise(()=>{}):Promise.resolve(snapshot);
    });
    native.listen.mockImplementation(()=>new Promise(()=>{}));
    render(<DetachedContestSurface/>);
    await act(async()=>{await Promise.resolve();});
    expect(screen.getByText("Loading shared contest panel…")).toBeTruthy();
    await act(async()=>{await vi.advanceTimersByTimeAsync(250);});
    expect(screen.getByLabelText("Callsign")).toHaveProperty("value","OM0RX");
    expect(reads).toBe(2);
  } finally { vi.useRealTimers(); }
});

it("keeps unsupported multiplier trackers terminal instead of polling them",async()=>{
  vi.useFakeTimers();
  try {
    window.history.replaceState({},"",search.replace("view=active-qso","view=awards"));
    native.invoke.mockResolvedValue({...snapshot,panelID:"awards",projection:{schemaVersion:1,status:"unavailable"}});
    render(<DetachedContestSurface/>);
    await act(async()=>{await Promise.resolve();await Promise.resolve();});
    expect(screen.getByRole("heading",{name:"DXCC"})).toBeTruthy();
    const reads=native.invoke.mock.calls.filter(([command])=>command==="contest_surface_snapshot").length;
    await act(async()=>{await vi.advanceTimersByTimeAsync(10_000);});
    expect(native.invoke.mock.calls.filter(([command])=>command==="contest_surface_snapshot")).toHaveLength(reads);
  } finally { vi.useRealTimers(); }
});

it.each(["band-maps","dx-cluster"] as const)("offers accessible Not1MM spot lifecycle actions in the contest %s window",async panelID=>{
  window.history.replaceState({},"",search.replace("view=active-qso",`view=${panelID}`));
  const view={schemaVersion:2,status:"ready",draftID:"draft-1",draftRevision:5,radioFrequencyHz:14_025_000,
    connectedClusters:1,loadedSpots:1,selectedSpotID:"spot-1",configuredClusters:[],connections:[],
    markedOnly:false,spots:[{...sharedSpot,marked:true}],busy:false};
  native.invoke.mockImplementation(async(command,args)=>command==="contest_surface_snapshot"?{...snapshot,panelID,projection:view}:
    command==="contest_surface_action"?{requestID:args.requestID,status:"applied",projectionRevision:7}:Promise.reject(new Error(`unexpected ${command}`)));
  render(<DetachedContestSurface/>);
  const callsign=await screen.findByText("DL1ABC"),target=panelID==="dx-cluster"?callsign.closest("tr")!:callsign.closest("button")!;
  if(panelID==="dx-cluster")expect(screen.getByLabelText("Marked")).toBeTruthy();
  else {expect(target.textContent).toBe("DL1ABC");expect(target.getAttribute("aria-label")).toContain("Marked");}
  fireEvent.contextMenu(target,{clientX:40,clientY:50});
  expect(await screen.findByRole("menu",{name:"Spot actions for DL1ABC"})).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitem",{name:"Unmark"}));
  await waitFor(()=>expect(native.invoke.mock.calls.find(([command,args])=>command==="contest_surface_action"&&args.action==="spot_set_marked")?.[1])
    .toMatchObject({panelID,action:"spot_set_marked",params:{draftID:"draft-1",expectedDraftRevision:5,spotID:"spot-1",marked:false}}));
  fireEvent.click(screen.getByLabelText("Marked only"));
  await waitFor(()=>expect(native.invoke.mock.calls.find(([command,args])=>command==="contest_surface_action"&&args.action==="spot_set_marked_only")?.[1])
    .toMatchObject({panelID,action:"spot_set_marked_only",params:{markedOnly:true}}));
});

it("can untick Marked only from an empty Cluster after its shared projection advances",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=dx-cluster"));
  let current:any={...snapshot,panelID:"dx-cluster",projectionRevision:6,projection:{schemaVersion:2,status:"ready",draftID:"draft-1",draftRevision:5,
    radioFrequencyHz:14_025_000,connectedClusters:1,loadedSpots:1,selectedSpotID:null,
    configuredClusters:[{serverID:"server-1",serverName:"ShackCQ",enabled:true}],
    connections:[{serverID:"server-1",serverName:"ShackCQ",phase:"connected",error:null}],markedOnly:true,spots:[],busy:false}};
  native.invoke.mockImplementation(async(command,args)=>{
    if(command==="contest_surface_snapshot")return structuredClone(current);
    if(command==="contest_surface_action"){
      expect(args).toMatchObject({panelID:"dx-cluster",projectionRevision:7,action:"spot_set_marked_only",
        params:{draftID:"draft-1",expectedDraftRevision:6,markedOnly:false}});
      current={...current,projectionRevision:8,projection:{...current.projection,markedOnly:false}};
      return{requestID:args.requestID,status:"applied",projectionRevision:8};
    }
    throw new Error(`unexpected ${command}`);
  });
  render(<DetachedContestSurface/>);
  const markedOnly=await screen.findByLabelText("Marked only");
  expect(markedOnly).toHaveProperty("checked",true);
  current={...current,projectionRevision:7,projection:{...current.projection,draftRevision:6}};
  fireEvent.click(markedOnly);
  await waitFor(()=>expect(native.invoke.mock.calls.some(([command])=>command==="contest_surface_action")).toBe(true));
  await waitFor(()=>expect(markedOnly).toHaveProperty("checked",false));
  expect(screen.queryByText("The shared contest panel changed before this action could be applied.")).toBeNull();
});

it("shows fresh observed receive-filter bandwidth only on the contest Band Map",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=band-maps"));
  const view={schemaVersion:2,status:"ready",draftID:"draft-1",draftRevision:5,radioFrequencyHz:14_025_000,
    connectedClusters:1,loadedSpots:1,selectedSpotID:null,configuredClusters:[],connections:[],markedOnly:false,spots:[sharedSpot],busy:false};
  const selectionID="00000000-0000-4000-8000-000000000004",now=Date.now();
  native.invoke.mockImplementation(async command=>command==="contest_surface_snapshot"?{...snapshot,panelID:"band-maps",projection:view}:
    command==="monitor_context_snapshot"?{epoch:"00000000-0000-4000-8000-000000000005",revision:1,
      selection:{provider:"direct_tci",generation:2,selection_id:selectionID},
      radio:{available:true,revision:1,received_at_ms:now,provider:"direct_tci",selection_id:selectionID,selection_generation:2,
        snapshot:{source:"direct_tci",generated_at:now/1000,radio:{connected:true,observed:true},station:{radio_stale:false},
          tci:{filter_lower_hz:-500,filter_upper_hz:500}}},rotor:{available:false,snapshot:null}}:
    Promise.reject(new Error(`unexpected ${command}`)));
  render(<DetachedContestSurface/>);
  expect((await screen.findByLabelText("Observed receive-filter bandwidth")).textContent).toBe("RX filter 1,000 Hz");
});

it("opens Cluster spot actions from the keyboard, clamps them after resize, and restores row focus",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=dx-cluster"));
  const view={schemaVersion:2,status:"ready",draftID:"draft-1",draftRevision:5,radioFrequencyHz:14_025_000,
    connectedClusters:1,loadedSpots:1,selectedSpotID:null,configuredClusters:[],connections:[],
    markedOnly:false,spots:[{...sharedSpot,marked:false}],busy:false};
  native.invoke.mockImplementation(async(command,args)=>command==="contest_surface_snapshot"?{...snapshot,panelID:"dx-cluster",projection:view}:
    command==="contest_surface_action"?{requestID:args.requestID,status:"applied",projectionRevision:7}:Promise.reject(new Error(`unexpected ${command}`)));
  Object.defineProperty(window,"innerWidth",{configurable:true,value:320});Object.defineProperty(window,"innerHeight",{configurable:true,value:240});
  render(<DetachedContestSurface/>);const row=(await screen.findByLabelText("DL1ABC spot")).closest("tr")!;row.focus();
  fireEvent.keyDown(row,{key:"Enter"});
  await waitFor(()=>expect(native.invoke.mock.calls.some(([command,args])=>command==="contest_surface_action"&&args.action==="spot_select")).toBe(true));
  fireEvent.keyDown(row,{key:"F10",shiftKey:true});const menu=await screen.findByRole("menu",{name:"Spot actions for DL1ABC"});
  vi.spyOn(menu,"getBoundingClientRect").mockReturnValue({x:0,y:0,left:0,top:0,right:150,bottom:120,width:150,height:120,toJSON:()=>({})});
  fireEvent(window,new Event("resize"));
  await waitFor(()=>{expect(Number.parseInt(menu.style.left)).toBeLessThanOrEqual(162);expect(Number.parseInt(menu.style.top)).toBeLessThanOrEqual(112);});
  fireEvent.keyDown(menu,{key:"ArrowDown"});expect(document.activeElement).toBe(screen.getByRole("menuitem",{name:"Mark"}));
  fireEvent.keyDown(menu,{key:"Escape"});await waitFor(()=>expect(document.activeElement).toBe(row));
});

it("renders validated manual main context without manufacturing headings or distance",async()=>{
  const manual={operator:"OM0RX/P",cwSpeedWpm:27,cwSpeedStepWpm:1,country:"Germany",cqZone:14,ituZone:28,
    headingDegrees:null,longPathHeadingDegrees:null,distanceKm:null,qsos:42,multipliers:17,total:2142};
  const view={...projection,manual};
  expect(validContestSurfaceProjection("active-qso",view)).toBe(true);
  expect(validContestSurfaceProjection("active-qso",{...view,manual:{...manual,distanceKm:"unknown"}})).toBe(false);
  native.invoke.mockResolvedValue({...snapshot,projection:view});render(<DetachedContestSurface/>);
  expect(await screen.findByLabelText("Current operator")).toHaveProperty("textContent","OP OM0RX/P");
  expect(screen.getByLabelText("Country and zones").textContent).toBe("Germany cq:14 itu:28");
  expect(screen.getByLabelText("Current CW speed").textContent).toBe("27");
  expect(screen.getByLabelText("Contact heading, long path and distance").textContent).toContain("—° Hdg · LP —° / distance — km");
  expect(screen.getByLabelText("QSOs and multipliers").textContent).toBe("QSO / mults42/17");
  expect(screen.getByLabelText("Score").textContent).toBe("Score2142");
  expect((document.querySelector(".contest-surface-main-fields") as HTMLElement).style.getPropertyValue("--contest-entry-field-columns"))
    .toBe("minmax(140px,1.6fr) repeat(3,minmax(64px,1fr))");
});

it("renders Statistics v3 as the original compact table with TOTAL last", async () => {
  window.history.replaceState({}, "", search.replace("view=active-qso", "view=propagation"));
  const view = { schemaVersion:3, status:"ready", score:{qsos:6,points:21,multipliers:8,claimedScore:168,
    multiplierLabels:["K","W"],multiplierDisplayLabels:["United States","United States"],sourceVerification:"verified"},
    rows:[{band:"20m",qsos:4,calls:3,cw:2,phone:1,digital:1,wpx:2,points:15},
      {band:"40m",qsos:2,calls:2,cw:2,phone:0,digital:0,wpx:1,points:6}],
    total:{band:"TOTAL",qsos:6,calls:4,cw:4,phone:1,digital:1,wpx:3,points:21},busy:false } as const;
  expect(validContestSurfaceProjection("propagation", view)).toBe(true);
  native.invoke.mockResolvedValue({...snapshot,panelID:"propagation",projection:view}); render(<DetachedContestSurface/>);
  const table = await screen.findByRole("table", {name:"Contest statistics"});
  expect(screen.getByRole("region", {name:"Scrollable contest statistics"}).getAttribute("tabindex")).toBe("0");
  expect(Array.from(table.querySelectorAll("thead th")).map(cell=>cell.textContent)).toEqual(["BAND","QSO","CALLS","CW","PH","DI","WPX","PTS"]);
  expect(Array.from(table.querySelectorAll("tbody tr")).map(row=>Array.from(row.children).map(cell=>cell.textContent))).toEqual([
    ["20m","4","3","2","1","1","2","15"], ["40m","2","2","2","0","0","1","6"],
    ["TOTAL","6","4","4","1","1","3","21"],
  ]);
  expect(screen.queryByRole("heading")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
  expect(document.querySelector("canvas")).toBeNull();
  expect(document.querySelector("dl")).toBeNull();
});

it("renders the CQ WW score breakdown with zones, countries and claimed score", async () => {
  window.history.replaceState({}, "", search.replace("view=active-qso", "view=propagation"));
  const view={schemaVersion:3,status:"ready",layout:"cq_ww",score:{qsos:6,points:21,multipliers:8,claimedScore:168,
    multiplierLabels:["4 countries","4 zones"],multiplierDisplayLabels:["4 countries","4 zones"],sourceVerification:"verified"},
    rows:[{band:"20m",qsos:4,points:15,countries:3,zones:2},{band:"40m",qsos:2,points:6,countries:1,zones:2}],
    total:{band:"TOTAL",qsos:6,points:21,countries:4,zones:4},busy:false} as const;
  expect(validContestSurfaceProjection("propagation",view)).toBe(true);
  native.invoke.mockResolvedValue({...snapshot,panelID:"propagation",projection:view});render(<DetachedContestSurface/>);
  const table=await screen.findByRole("table",{name:"CQ WW statistics"});
  expect(Array.from(table.querySelectorAll("thead th")).map(cell=>cell.textContent)).toEqual(["BAND","QSO","PTS","ZN","CTY"]);
  expect(Array.from(table.querySelectorAll("tbody tr")).map(row=>Array.from(row.children).map(cell=>cell.textContent))).toEqual([
    ["20m","4","15","2","3"],["40m","2","6","2","1"],["TOTAL","6","21","4","4"],
  ]);
  expect(screen.getByText("Claimed score").parentElement?.textContent).toContain("168");
});

it("shows actionable bounded HTTPS RTC reporting separately from legacy and UDP paths", async () => {
  window.history.replaceState({}, "", search.replace("view=active-qso", "view=score-reporting"));
  const view = { schemaVersion:1, status:"ready", score:{qsos:42,points:315,multipliers:18,claimedScore:5670,
    multiplierLabels:["K"],multiplierDisplayLabels:["United States"],sourceVerification:"verified"},
    intervalMinutes:2,reportingEnabled:false,availability:"available",reason:"HTTPS RTC posting is separate from N1MM UDP.",
    service:"hamscore",username:"OM0RX",credentialSaved:true,reportState:"disabled",lastOutcome:"Not sent yet.",nextAttempt:null,
    services:[
      {id:"hamscore",name:"Real Time Contest Server",url:"https://hamscore.com/postxml/",transportSecurity:"https"},
      {id:"contestonlinescore",name:"Contest Online ScoreBoard",url:"https://contestonlinescore.com/post/",transportSecurity:"https"},
      {id:"contest-run",name:"Live Contest Score",url:"http://contest.run",transportSecurity:"legacy-http"},
    ],busy:false } as const;
  expect(validContestSurfaceProjection("score-reporting",view)).toBe(true);
  expect(validContestSurfaceProjection("score-reporting",{...view,reportingEnabled:true,reportState:"scheduled"})).toBe(true);
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>command==="contest_surface_snapshot"
    ? {...snapshot,panelID:"score-reporting",projection:view}
    : command==="contest_surface_action" ? {requestID:args.requestID,status:"applied",projectionRevision:7}
    : Promise.reject(new Error(`unexpected ${command}`)));
  render(<DetachedContestSurface/>);
  expect(await screen.findByRole("heading",{name:"Score Reporting"})).toBeTruthy();
  expect(screen.getByLabelText("Current contest score").textContent).toContain("5670");
  expect(screen.getByLabelText("Periodically send XML score").matches(":disabled")).toBe(false);
  expect(screen.getByLabelText("Username")).toHaveProperty("value","OM0RX");
  expect(screen.getByRole("status").textContent).toContain("Not sent yet");
  expect(screen.getByText("http://contest.run").closest("li")?.textContent).toContain("Legacy HTTP endpoint");
  fireEvent.click(screen.getByRole("button",{name:"Send score now"}));
  await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith("contest_surface_action",expect.objectContaining({
    panelID:"score-reporting",action:"score_send_now",params:{},
  })));
});

it("allows the compact Statistics table to fit the supported 400px window minimum", () => {
  const css = readFileSync(`${process.cwd()}/src/contesting/DetachedContestSurface.css`, "utf8");
  expect(css).toContain(".contest-surface-statistics-scroll { flex:1; width:100%; min-width:0; min-height:0; overflow:auto;");
  expect(css).toContain(".contest-surface-statistics-v3 table { width:100%; min-width:0;");
  expect(css).not.toContain(".contest-surface-statistics-v3 table { width:100%; min-width:430px;");
});

it("contains matrix overflow inside its scroll region", () => {
  const css = readFileSync(`${process.cwd()}/src/contesting/DetachedContestSurface.css`, "utf8");
  expect(css).toContain(".contest-surface-matrix { align-items:flex-start; overflow:hidden;");
  expect(css).toContain(".contest-surface-matrix-scroll { flex:1 1 auto; width:100%; max-width:100%; min-width:0;");
  expect(css).toContain(".contest-surface-matrix-blocks { display:grid; align-items:start; gap:8px; width:100%; min-width:max-content;");
  expect(css).toContain(".contest-surface-matrix-scroll table { width:100%; min-width:max-content;");
  expect(css).toContain(".contest-surface-matrix :is(th,td) { min-width:34px; padding:3px 6px !important;");
});

it("renders ICWC original name/serial input while omitting hidden report fields", async()=>{
  const view={...projection,schemaVersion:2,session:{name:"ICWC MST",ruleName:"ICWC Medium Speed Test",mode:"CW"},
    draft:{...projection.draft,reservedSerial:3,receivedFields:[{id:"other_2",label:"Name + S/N",value:"BOB 12",required:true,maximumUTF8Bytes:128}]},
    descriptor:{reportsVisible:false,bands:["20m"],modes:["CW"],automaticSerial:true,sentFields:[{id:"other_1",label:"Sent S/N",value:"003",required:true,maximumUTF8Bytes:32}],
      serial:{requirement:"requiredForCommit",allocatedFieldID:"other_1",reservedSerial:3}},operator:null};
  expect(validContestSurfaceProjection("active-qso",view)).toBe(true);
  expect(validContestSurfaceProjection("active-qso",{...view,descriptor:{...view.descriptor,reportsVisible:"false"}})).toBe(false);
  native.invoke.mockResolvedValue({...snapshot,projection:view}); render(<DetachedContestSurface/>);
  expect(await screen.findByLabelText("Name + S/N")).toHaveProperty("value","BOB 12");
  expect(screen.queryByLabelText("SNT")).toBeNull(); expect(screen.queryByLabelText("RCV")).toBeNull();
  expect(screen.getByLabelText("Sent exchange")).toHaveProperty("value","003");
  expect(screen.getByText("Sent S/N").getAttribute("title")).toBe("Sent S/N");
});

it.each([
  {plugin:"QSO PARTY SN",reports:[{id:"sent",label:"Sent serial",value:"001",required:true,maximumUTF8Bytes:160,enabled:true,readOnly:true},
    {id:"receive",label:"Received serial",value:"42",required:true,maximumUTF8Bytes:160,enabled:true,readOnly:false}],
    received:[{id:"other_1",label:"Received location",value:"NEW",required:true,maximumUTF8Bytes:32,enabled:true,readOnly:false}]},
  {plugin:"California QSO Party",reports:[{id:"sent",label:"Sent serial",value:"001",required:true,maximumUTF8Bytes:160,enabled:true,readOnly:true},
    {id:"receive",label:"Received serial",value:"42",required:true,maximumUTF8Bytes:160,enabled:true,readOnly:false}],
    received:[{id:"other_1",label:"Received county",value:"ALAM",required:true,maximumUTF8Bytes:32,enabled:true,readOnly:false}]},
  {plugin:"RAEM",reports:[{id:"sent",label:"Sent serial",value:"001",required:true,maximumUTF8Bytes:160,enabled:true,readOnly:true}],
    received:[{id:"other_1",label:"Received serial",value:"101",required:true,maximumUTF8Bytes:32,enabled:true,readOnly:false},
      {id:"other_2",label:"Received coordinates",value:"40N74W",required:true,maximumUTF8Bytes:128,enabled:true,readOnly:false}]},
])("renders $plugin from host field identity and flags",async({plugin,reports,received})=>{
  const view={...projection,schemaVersion:2,session:{name:plugin,ruleName:plugin,mode:"CW"},
    draft:{...projection.draft,sentReport:"001",receivedReport:reports.some(field=>field.id==="receive")?"42":"",reservedSerial:1,receivedFields:received},
    descriptor:{reportsVisible:true,reportFields:reports,bands:["20m"],modes:["CW"],automaticSerial:true,sentFields:[],
      serial:{requirement:"requiredForCommit",allocatedFieldID:"sent",reservedSerial:1}},operator:null};
  expect(validContestSurfaceProjection("active-qso",view)).toBe(true);
  native.invoke.mockResolvedValue({...snapshot,projection:view});render(<DetachedContestSurface/>);
  const sent=await screen.findByLabelText("Sent serial");
  expect(sent).toHaveProperty("value","001");expect(sent).toHaveProperty("readOnly",true);
  for(const field of received){const input=document.querySelector(`[data-contest-field-id="${field.id}"]`) as HTMLInputElement;
    expect(input).toBeTruthy();expect(input.readOnly).toBe(false);expect(input.disabled).toBe(false);}
});

it("keeps legacy serial state without exposing the removed developer entry panel",async()=>{
  const view={...projection,schemaVersion:2,draft:{...projection.draft,reservedSerial:3},
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[{id:"serial",label:"Serial",value:"003",required:true,maximumUTF8Bytes:32}],
      serial:{requirement:"requiredForCommit",allocatedFieldID:"serial",reservedSerial:3}},operator:null};
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>command==="contest_surface_snapshot"
    ? {...snapshot,projection:view}:{requestID:args.requestID,status:"queued"});
  render(<DetachedContestSurface/>);expect(await screen.findByLabelText("Sent exchange")).toHaveProperty("value","003");
  expect(screen.queryByText("Entry controls")).toBeNull();
  expect(screen.queryByRole("button",{name:"Reserve serial",hidden:true})).toBeNull();
});

it("keeps Trans Tasman duplicates loggable and presents the original period explanation",async()=>{
  const reason="Worked on this band and mode in this 2-hour UTC block (08–10, 10–12, 12–14).";
  const view={...projection,schemaVersion:2,session:{name:"Trans Tasman",ruleName:"Trans Tasman CW",mode:"CW"},
    draft:{...projection.draft,frequencyHz:7_025_000,frequencyText:"7025000",frequencyError:"",band:"40m",reservedSerial:1,
      dupe:{state:"duplicate",reason},receivedFields:[{id:"other_2",label:"RcvNR",value:"012",required:true,maximumUTF8Bytes:128}]},
    descriptor:{bands:["160m","80m","40m"],modes:["CW"],allowDuplicateCommit:true,automaticSerial:true,
      sentFields:[{id:"other_1",label:"SentNR",value:"001",required:true,maximumUTF8Bytes:32}],
      serial:{requirement:"requiredForCommit",allocatedFieldID:"other_1",reservedSerial:1}},operator:null};
  expect(validContestSurfaceProjection("active-qso",view)).toBe(true);
  native.invoke.mockResolvedValue({...snapshot,projection:view});render(<DetachedContestSurface/>);
  expect(await screen.findByLabelText("Sent exchange")).toHaveProperty("value","001");
  expect(screen.getByLabelText("Callsign").closest(".contest-surface-intent")?.classList.contains("is-duplicate")).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain("DUPE");
  expect(screen.getByRole("alert").textContent).toContain(reason);
  expect(screen.getByRole("button",{name:/^Log It/})).toBeTruthy();
  expect(screen.getByRole("button",{name:"Wipe"})).toBeTruthy();
  expect(screen.getByRole("button",{name:/^Stop/})).toBeTruthy();
  expect(screen.getByRole("button",{name:"Edit last"})).toBeTruthy();
  expect(screen.queryByRole("button",{name:"Reserve serial",hidden:true})).toBeNull();
  expect(screen.getByLabelText("Current band and mode").textContent).toBe("CW1608040");
});

it("shows Checking instead of attaching a stale DUPE result to locally typed callsign text",async()=>{
  const view={...projection,draft:{...projection.draft,callsign:"OM0A",frequencyError:"",dupe:{state:"duplicate",reason:"Worked at 09:43 UTC."}}};
  native.invoke.mockImplementation(async(command:string)=>{
    if(command==="contest_surface_snapshot")return{...snapshot,projection:view};
    if(command==="contest_surface_action")return new Promise(()=>{});
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);
  const callsign=await screen.findByLabelText("Callsign");
  expect(screen.getByRole("alert").textContent).toContain("DUPE — OM0A");
  expect(callsign.closest(".contest-surface-intent")?.classList.contains("is-duplicate")).toBe(true);
  fireEvent.change(callsign,{target:{value:"K1ABC"}});
  expect(await screen.findByText("Checking — K1ABC")).toBeTruthy();
  expect(callsign.closest(".contest-surface-intent")?.classList.contains("is-duplicate")).toBe(false);
  expect(screen.queryByText(/DUPE — OM0A/)).toBeNull();
});

it.each(["legacy", "manual", "plugin"])("reserves chronological and partial-match panes for the %s log",async layout=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=logbook"));
  const row={qsoID:"logged-qso",workedAt:"2026-10-20T12:00:00.000Z",callsign:"K1ABC",band:"20m",mode:"CW",
    sentExchange:"599",receivedExchange:"599",points:2,multiplierLabels:[]};
  const view={schemaVersion:1,status:"ready",sessionRevision:1,canExportCabrillo:true,
    page:{offset:0,limit:20,total:1,rows:[row]},editing:null,busy:false,
    ...(layout==="plugin"?{exchangeLayout:"plugin",pluginColumns:["Call"],pluginRows:[{qsoID:row.qsoID,values:[row.callsign]}],pluginPartialRows:[]}
      :layout==="manual"?{manualRows:[{qsoID:row.qsoID,TS:"2026-10-20 12:00:00",Call:row.callsign,Freq:"14025",SNT:"599",RCV:"599",M1:"✓",ZN:"5",M2:"",prefix:"K1",Points:"2"}],partialRows:[]}:{})};
  expect(validContestSurfaceProjection("logbook",view)).toBe(true);
  native.invoke.mockResolvedValue({...snapshot,panelID:"logbook",projection:view});render(<DetachedContestSurface/>);
  expect(await screen.findByRole("table",{name:"Contest log"})).toBeTruthy();
  expect(screen.getByRole("button",{name:"K1ABC"})).toBeTruthy();
  expect(screen.getByRole("table",{name:"Callsign partial matches"})).toBeTruthy();
  expect(screen.getByText("No partial matches")).toBeTruthy();
  expect(document.querySelectorAll(".contest-surface-log-scroll")).toHaveLength(2);
});

it("shows Loading instead of No contacts while the initial log page is pending",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=logbook"));
  const view={schemaVersion:1,status:"ready",sessionRevision:1,canExportCabrillo:true,
    exchangeLayout:"plugin",pluginColumns:["Call"],pluginRows:[],pluginPartialRows:[],
    page:{offset:0,limit:20,total:0,rows:[]},editing:null,busy:true};
  native.invoke.mockResolvedValue({...snapshot,panelID:"logbook",projection:view});
  render(<DetachedContestSurface/>);
  expect(await screen.findAllByText("Loading…")).toHaveLength(2);
  expect(screen.queryByText("No contacts")).toBeNull();
});

it("opens editing from Log Display in a separate native Edit Contact window",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=logbook"));
  const row={qsoID:"logged-qso",workedAt:"2026-10-20T12:00:00.000Z",callsign:"K1ABC",band:"20m",mode:"CW",
    sentExchange:"599",receivedExchange:"599",points:2,multiplierLabels:[]};
  const view={schemaVersion:1,status:"ready",sessionRevision:1,canExportCabrillo:true,
    page:{offset:0,limit:20,total:1,rows:[row]},manualRows:[{qsoID:row.qsoID,TS:"2026-10-20 12:00:00",Call:row.callsign,
      Freq:"14025",SNT:"599",RCV:"599",M1:"✓",ZN:"5",M2:"",prefix:"K1",Points:"2"}],partialRows:[],editing:null,busy:false};
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return {...snapshot,panelID:"logbook",projection:view};
    if(command==="contest_surface_action")return {requestID:args.requestID,status:"applied"};
    if(command==="contest_contact_editor_open")return;
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);fireEvent.click(await screen.findByRole("button",{name:"K1ABC"}));
  await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith("contest_contact_editor_open",{operatingContext,sessionID,workspaceGeneration}));
  expect(screen.queryByRole("heading",{name:"Edit Contact"})).toBeNull();
});

it.each(["doubleClick","contextMenu"] as const)("opens Edit Contact on log-row %s",async gesture=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=logbook"));
  const row={qsoID:"logged-qso",workedAt:"2026-10-20T12:00:00.000Z",callsign:"K1ABC",band:"20m",mode:"CW",
    sentExchange:"599",receivedExchange:"599",points:2,multiplierLabels:[]};
  const manual={qsoID:row.qsoID,TS:"2026-10-20 12:00:00",Call:row.callsign,Freq:"14025",SNT:"599",RCV:"599",M1:"",ZN:"5",M2:"",prefix:"K1",Points:"2"};
  const view={schemaVersion:1,status:"ready",sessionRevision:1,canExportCabrillo:true,page:{offset:0,limit:20,total:1,rows:[row]},manualRows:[manual],partialRows:[],editing:null,busy:false};
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return {...snapshot,panelID:"logbook",projection:view};
    if(command==="contest_surface_action")return {requestID:args.requestID,status:"applied"};
    if(command==="contest_contact_editor_open")return;
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);const frequency=(await screen.findByText("14025")).closest("tr")!.children[2];
  fireEvent[gesture](frequency);
  await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith("contest_contact_editor_open",{operatingContext,sessionID,workspaceGeneration}));
});

it("edits an explicitly writable plugin cell inline through begin, set, and revision-fenced save",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=logbook"));
  const pageRow={qsoID:"logged-qso",workedAt:"2026-10-20T12:00:00.000Z",callsign:"K1ABC",band:"20m",mode:"CW",
    sentExchange:"599",receivedExchange:"14",points:2,multiplierLabels:[]};
  const columns=["Call","ZN","PTS"],pluginRow={qsoID:pageRow.qsoID,values:["K1ABC","14","2"],inlineEdits:[
    {kind:"text",field:"callsign",value:"K1ABC",maximumUTF8Bytes:32},
    {kind:"exchange",fieldID:"other_2",value:"14",maximumUTF8Bytes:128},null]};
  let current:any={schemaVersion:1,status:"ready",sessionRevision:7,canExportCabrillo:true,exchangeLayout:"plugin",
    pluginColumns:columns,pluginRows:[pluginRow],pluginPartialRows:[],page:{offset:0,limit:20,total:1,rows:[pageRow]},editing:null,busy:false};
  const editing={qsoID:"logged-qso",workedAt:"2026-10-20 12:00:00",operator:"OM0RX",callsign:"K1ABC",band:"20m",mode:"CW",
    sentReport:"599",receivedReport:"599",receivedFields:[],frequencyHz:14025000,editFrequencyText:"14025000",frequencyError:"",
    correctionReason:"Operator correction",confirmDelete:false,deletionReason:"Operator deletion"};
  const actions:Record<string,any>[]=[];
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return {...snapshot,panelID:"logbook",projection:current};
    if(command==="contest_surface_action"){
      actions.push(args);
      if(args.action==="log_edit_begin")current={...current,editing};
      if(args.action==="log_edit_save")current={...current,editing:null};
      return {requestID:args.requestID,status:"applied"};
    }
    if(command==="contest_contact_editor_open")return;
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);
  const call=(await screen.findByText("K1ABC")).closest("td")!;fireEvent.doubleClick(call);
  const input=await screen.findByLabelText("Edit Call");fireEvent.change(input,{target:{value:"K1XYZ"}});
  fireEvent.keyDown(input,{key:"Enter"});
  await waitFor(()=>expect(actions.map(action=>action.action)).toEqual(["log_edit_begin","log_edit_set_text","log_edit_save"]));
  expect(actions[1]).toMatchObject({params:{qsoID:"logged-qso",field:"callsign",value:"K1XYZ"}});
  expect(actions[2]).toMatchObject({params:{qsoID:"logged-qso",expectedSessionRevision:7}});
  expect(native.invoke).not.toHaveBeenCalledWith("contest_contact_editor_open",expect.anything());
  const zone=screen.getByText("14").closest("td")!;fireEvent.doubleClick(zone);
  const zoneInput=await screen.findByLabelText("Edit ZN");fireEvent.change(zoneInput,{target:{value:"15"}});
  fireEvent.keyDown(zoneInput,{key:"Enter"});
  await waitFor(()=>expect(actions.map(action=>action.action)).toEqual([
    "log_edit_begin","log_edit_set_text","log_edit_save","log_edit_begin","log_edit_set_exchange","log_edit_save"]));
  expect(actions[4]).toMatchObject({params:{qsoID:"logged-qso",fieldID:"other_2",value:"15"}});
});

it("offers mouse-accessible Save and Cancel controls for callsign and CQ zone inline edits",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=logbook"));
  const pageRow={qsoID:"logged-qso",workedAt:"2026-10-20T12:00:00.000Z",callsign:"K1ABC",band:"20m",mode:"SSB",
    sentExchange:"59",receivedExchange:"5",points:3,multiplierLabels:[]};
  const columns=["Call","CQ Zone","PTS"],pluginRow={qsoID:pageRow.qsoID,values:["K1ABC","5","3"],inlineEdits:[
    {kind:"text",field:"callsign",value:"K1ABC",maximumUTF8Bytes:32},
    {kind:"exchange",fieldID:"other_2",value:"5",maximumUTF8Bytes:128},null]};
  let current:any={schemaVersion:1,status:"ready",sessionRevision:7,canExportCabrillo:true,exchangeLayout:"plugin",
    pluginColumns:columns,pluginRows:[pluginRow],pluginPartialRows:[],page:{offset:0,limit:20,total:1,rows:[pageRow]},editing:null,busy:false};
  const editing={qsoID:"logged-qso",workedAt:"2026-10-20 12:00:00",operator:"OM0RX",callsign:"K1ABC",band:"20m",mode:"SSB",
    sentReport:"59",receivedReport:"59",receivedFields:[],frequencyHz:14250000,editFrequencyText:"14250000",frequencyError:"",
    correctionReason:"Operator correction",confirmDelete:false,deletionReason:"Operator deletion"};
  const actions:Record<string,any>[]=[];
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return {...snapshot,panelID:"logbook",projection:current};
    if(command==="contest_surface_action"){
      actions.push(args);
      if(args.action==="log_edit_begin")current={...current,editing};
      if(args.action==="log_edit_save"||args.action==="log_edit_cancel")current={...current,editing:null};
      return {requestID:args.requestID,status:"applied"};
    }
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);
  fireEvent.doubleClick((await screen.findByText("K1ABC")).closest("td")!);
  const callInput=await screen.findByLabelText("Edit Call");fireEvent.change(callInput,{target:{value:"K1XYZ"}});
  fireEvent.click(screen.getByRole("button",{name:"Save Call"}));
  await waitFor(()=>expect(actions.map(action=>action.action)).toEqual(["log_edit_begin","log_edit_set_text","log_edit_save"]));
  fireEvent.doubleClick(screen.getByText("5").closest("td")!);
  expect(await screen.findByLabelText("Edit CQ Zone")).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Cancel CQ Zone"}));
  await waitFor(()=>expect(actions.map(action=>action.action)).toEqual(["log_edit_begin","log_edit_set_text","log_edit_save","log_edit_begin","log_edit_cancel"]));
});

it("uses compact CQ WW multiplier headings and centers report, zone, and points values only",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=logbook"));
  const columns=["YYYY-MM-DD HH:MM:SS","Call","Freq","Snt","Rcv","M1","CQ Zone","M2","Country","PTS"],
    values=["2026-10-20 12:00:00","K1ABC","14250","59","58","✓","5","✓","K","3"],
    pageRow={qsoID:"logged-qso",workedAt:"2026-10-20T12:00:00.000Z",callsign:"K1ABC",band:"20m",mode:"SSB",
      sentExchange:"59 15",receivedExchange:"58 5",points:3,multiplierLabels:["K","Zone 5"]},
    view={schemaVersion:1,status:"ready",sessionRevision:7,canExportCabrillo:true,exchangeLayout:"plugin",
      pluginColumns:columns,pluginRows:[{qsoID:pageRow.qsoID,values,inlineEdits:Array(columns.length).fill(null)}],pluginPartialRows:[],
      page:{offset:0,limit:20,total:1,rows:[pageRow]},editing:null,busy:false};
  native.invoke.mockResolvedValue({...snapshot,panelID:"logbook",projection:view});
  render(<DetachedContestSurface/>);
  const table=await screen.findByRole("table",{name:"Contest log"}),headers=Array.from(table.querySelectorAll("thead th")),
    cells=Array.from(table.querySelectorAll("tbody td"));
  expect(headers.map(cell=>cell.textContent)).toEqual(columns);
  expect(headers.some(cell=>cell.classList.contains("contest-surface-log-centered"))).toBe(false);
  for(const index of [3,4,6,9])expect(cells[index].classList.contains("contest-surface-log-centered")).toBe(true);
  for(const index of [0,1,2,5,7,8])expect(cells[index].classList.contains("contest-surface-log-centered")).toBe(false);
});

it("offers Delete contact from the call context menu and opens the editor in its confirmed reason workflow without deleting",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=logbook"));
  const pageRow={qsoID:"logged-qso",workedAt:"2026-10-20T12:00:00.000Z",callsign:"K1ABC",band:"20m",mode:"SSB",
      sentExchange:"59 15",receivedExchange:"59 5",points:3,multiplierLabels:["K","Zone 5"]},
    editing={qsoID:"logged-qso",workedAt:"2026-10-20 12:00:00",operator:"OM0RX",callsign:"K1ABC",band:"20m",mode:"SSB",
      sentReport:"59",receivedReport:"59",receivedFields:[],frequencyHz:14250000,editFrequencyText:"14250000",frequencyError:"",
      correctionReason:"Operator correction",confirmDelete:false,deletionReason:""};
  let current:any={schemaVersion:1,status:"ready",sessionRevision:7,canExportCabrillo:true,exchangeLayout:"plugin",
    pluginColumns:["Call","CQ Zone","PTS"],pluginRows:[{qsoID:pageRow.qsoID,values:["K1ABC","5","3"],inlineEdits:[
      {kind:"text",field:"callsign",value:"K1ABC",maximumUTF8Bytes:32},{kind:"exchange",fieldID:"other_2",value:"5",maximumUTF8Bytes:128},null]}],
    pluginPartialRows:[],page:{offset:0,limit:20,total:1,rows:[pageRow]},editing:null,busy:false};
  const actions:Record<string,any>[]=[];let projectionRevision=6;
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return {...snapshot,panelID:"logbook",projectionRevision,projection:current};
    if(command==="contest_surface_action"){
      actions.push(args);
      if(args.action==="log_edit_begin_delete"){current={...current,editing:{...editing,confirmDelete:true}};projectionRevision+=1;}
      return{requestID:args.requestID,status:"applied"};
    }
    if(command==="contest_contact_editor_open")return;
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);
  fireEvent.contextMenu((await screen.findByText("K1ABC")).closest("td")!,{clientX:50,clientY:60});
  expect(await screen.findByRole("menu",{name:"Contact actions for K1ABC"})).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitem",{name:"Delete contact…"}));
  await waitFor(()=>expect(actions.map(action=>action.action)).toEqual(["log_edit_begin_delete"]));
  expect(actions[0]).toMatchObject({projectionRevision:6,params:{qsoID:"logged-qso"}});
  expect(actions.some(action=>action.action==="log_edit_delete")).toBe(false);
  expect(native.invoke).toHaveBeenCalledWith("contest_contact_editor_open",{operatingContext,sessionID,workspaceGeneration});
});

it("keeps computed plugin cells read-only and opens the full editor from the context menu",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=logbook"));
  const pageRow={qsoID:"logged-qso",workedAt:"2026-10-20T12:00:00.000Z",callsign:"K1ABC",band:"20m",mode:"CW",
    sentExchange:"599",receivedExchange:"14",points:2,multiplierLabels:[]};
  const view={schemaVersion:1,status:"ready",sessionRevision:7,canExportCabrillo:true,exchangeLayout:"plugin",
    pluginColumns:["Call","PTS"],pluginRows:[{qsoID:pageRow.qsoID,values:["K1ABC","2"],inlineEdits:[
      {kind:"text",field:"callsign",value:"K1ABC",maximumUTF8Bytes:32},null]}],pluginPartialRows:[],
    page:{offset:0,limit:20,total:1,rows:[pageRow]},editing:null,busy:false};
  const actions:Record<string,any>[]=[];
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return {...snapshot,panelID:"logbook",projection:view};
    if(command==="contest_surface_action"){actions.push(args);return {requestID:args.requestID,status:"applied"};}
    if(command==="contest_contact_editor_open")return;
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);const points=(await screen.findByText("2")).closest("td")!;
  fireEvent.doubleClick(points);expect(actions).toHaveLength(0);
  fireEvent.contextMenu(points);
  await waitFor(()=>expect(actions[0]).toMatchObject({action:"log_edit_begin",params:{qsoID:"logged-qso"}}));
  expect(native.invoke).toHaveBeenCalledWith("contest_contact_editor_open",{operatingContext,sessionID,workspaceGeneration});
});

it("renders the original contact fields in the dedicated editor and closes after Save",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=edit-contact"));
  const editing={qsoID:"logged-qso",workedAt:"2026-10-20 12:00:00",operator:"OM0RX",callsign:"K1ABC",reportsVisible:true,
    name:"Alice",qth:"Darwin",comment:"Paper log",band:"20m",mode:"CW",sentReport:"599",receivedReport:"579",
    receivedFields:[{id:"other_1",label:"Sent exchange",value:"001",required:true,maximumUTF8Bytes:32},
      {id:"other_2",label:"Received exchange",value:"005",required:true,maximumUTF8Bytes:128}],
    frequencyHz:14025000,editFrequencyText:"14025000",frequencyError:"",correctionReason:"Operator correction",
    confirmDelete:false,deletionReason:"Operator deletion"};
  const view={schemaVersion:1,status:"ready",sessionRevision:7,canExportCabrillo:true,
    page:{offset:0,limit:20,total:1,rows:[]},manualRows:[],partialRows:[],editing,busy:false};
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return {...snapshot,panelID:"logbook",projection:view};
    if(command==="contest_surface_action")return {requestID:args.requestID,status:"applied"};
    if(command==="contest_contact_editor_close")return;
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);
  expect(await screen.findByRole("heading",{name:"Edit Contact"})).toBeTruthy();
  expect(screen.getByLabelText("Callsign")).toHaveProperty("value","K1ABC");
  expect(screen.getByLabelText("TimeStamp (UTC)")).toHaveProperty("value","2026-10-20 12:00:00");
  expect(screen.getByText("20m")).toBeTruthy();
  expect(screen.getByText("CW")).toBeTruthy();
  expect(screen.getByText("Station Call")).toBeTruthy();
  expect(screen.getByLabelText("Name")).toHaveProperty("value","Alice");
  expect(screen.getByLabelText("QTH")).toHaveProperty("value","Darwin");
  expect(screen.getByLabelText("Comment")).toHaveProperty("value","Paper log");
  expect(screen.getByLabelText("Op")).toHaveProperty("value","OM0RX");
  for(const label of ["Contest","Country","Name","QTH","Comment","Nr","Nr Sent","Points","Power","Zone","Section",
    "Check","Precedence","Multiplier 1","Multiplier 2","Multiplier 3","Band","WPX","Exchange","Run 1/2","Radio","Grid","Misc","Rover QTH"])
    expect(screen.getByText(label)).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"OK"}));
  await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith("contest_contact_editor_close",undefined));
  expect(native.invoke.mock.calls.find(([command])=>command==="contest_surface_action")?.[1]).toMatchObject({
    panelID:"logbook",action:"log_edit_save",params:{qsoID:"logged-qso",expectedSessionRevision:7},
  });
});

it("limits CQ WW SSB contact correction to operator-owned fields",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=edit-contact"));
  const editing={editorProfile:"cq_ww_ssb",qsoID:"logged-qso",workedAt:"2026-10-20 12:00:00",operator:"OM0RX",
    callsign:"DL1ABC",name:"Alice",qth:"Berlin",comment:"Imported",band:"40m",mode:"SSB",sentReport:"59",receivedReport:"59",
    entryFields:[
      {id:"sent",label:"SNT",value:"59",required:true,maximumUTF8Bytes:160,enabled:true,readOnly:false},
      {id:"receive",label:"RCV",value:"59",required:true,maximumUTF8Bytes:160,enabled:true,readOnly:false},
      {id:"other_1",label:"Sent zone",value:"15",required:true,maximumUTF8Bytes:32,enabled:true,readOnly:false},
      {id:"other_2",label:"CQ Zone",value:"14",required:true,maximumUTF8Bytes:128,enabled:true,readOnly:false},
    ],receivedFields:[],details:{country:"DL",stationCall:"OM0RX",receivedNumber:"14",sentNumber:"15",points:"1",power:"100",
      zone:"14",section:"",multiplier1:"Yes",multiplier2:"Yes",multiplier3:"",check:"",precedence:"",wpx:"DL1",exchange:"",
      run:"1",radio:"1",grid:"JO62",misc:"",roverQTH:"",contest:"CQ-WW-SSB",rxFrequency:"7126500",name:"Alice",qth:"Berlin",comment:"Imported"},
    frequencyHz:7125000,editFrequencyText:"7125000",frequencyError:"",receiveFrequencyHz:7126500,
    editReceiveFrequencyText:"7126500",receiveFrequencyError:"",editPower:"100",powerError:"",
    correctionReason:"Operator correction",confirmDelete:false,deletionReason:""};
  const view={schemaVersion:1,status:"ready",sessionRevision:7,canExportCabrillo:true,exchangeLayout:"plugin",
    pluginColumns:["Call"],pluginRows:[],pluginPartialRows:[],page:{offset:0,limit:20,total:0,rows:[]},editing,busy:false};
  const actions:Record<string,any>[]=[];
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return {...snapshot,panelID:"logbook",projection:view};
    if(command==="contest_surface_action"){actions.push(args);return {requestID:args.requestID,status:"queued"};}
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);await screen.findByRole("heading",{name:"Edit Contact"});
  for(const label of ["Callsign","TimeStamp (UTC)","RX Freq (Hz)","Tx Freq (Hz)","CQ Zone","Power","Correction note"])
    expect(screen.getByLabelText(label)).toBeTruthy();
  for(const label of ["SNT","RCV","Sent zone","Country","Points","Band","Name","QTH","Comment","Op"])
    expect(screen.queryByLabelText(label)).toBeNull();
  fireEvent.change(screen.getByLabelText("RX Freq (Hz)"),{target:{value:"7127000"}});
  await waitFor(()=>expect(actions.some(action=>action.action==="log_edit_set_text"&&action.params.field==="receiveFrequency"&&
    action.params.value==="7127000")).toBe(true));
});

it("uses General Logging entry fields as the single Name and Comment authority",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=edit-contact"));
  const editing={qsoID:"logged-qso",workedAt:"2026-10-20 12:00:00",operator:"OM0RX",callsign:"K1ABC",reportsVisible:true,
    name:"stale generic name",qth:"Darwin",comment:"stale generic comment",band:"20m",mode:"CW",sentReport:"599",receivedReport:"579",
    entryFields:[{id:"other_1",label:"Name",value:"Alice",required:true,maximumUTF8Bytes:32,enabled:true,readOnly:false},
      {id:"other_2",label:"Comment",value:"portable",required:true,maximumUTF8Bytes:128,enabled:true,readOnly:false}],receivedFields:[],
    frequencyHz:14025000,editFrequencyText:"14025000",frequencyError:"",correctionReason:"Operator correction",
    confirmDelete:false,deletionReason:"Operator deletion"};
  const view={schemaVersion:1,status:"ready",sessionRevision:7,canExportCabrillo:true,
    page:{offset:0,limit:20,total:1,rows:[]},manualRows:[],partialRows:[],editing,busy:false};
  const actions:Record<string,any>[]=[];
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return {...snapshot,panelID:"logbook",projection:view};
    if(command==="contest_surface_action"){actions.push(args);return {requestID:args.requestID,status:"queued"};}
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);
  const name=(await screen.findAllByLabelText("Name"))[0];
  expect(screen.getAllByLabelText("Name")).toHaveLength(1);expect(screen.getAllByLabelText("Comment")).toHaveLength(1);
  expect(screen.getAllByLabelText("QTH")).toHaveLength(1);
  fireEvent.change(name,{target:{value:"Bob"}});
  await waitFor(()=>expect(actions.some((action)=>action.action==="log_edit_set_exchange"&&
    action.params.fieldID==="other_1"&&action.params.value==="Bob")).toBe(true));
  expect(actions.some((action)=>action.action==="log_edit_set_text"&&action.params.field==="name")).toBe(false);
});

it("treats the native Edit Contact traffic-light close as Cancel before destroying the window",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=edit-contact"));
  const editing={qsoID:"logged-qso",workedAt:"2026-10-20 12:00:00",operator:"OM0RX",callsign:"K1ABC",reportsVisible:true,
    name:"",qth:"",comment:"",band:"20m",mode:"CW",sentReport:"599",receivedReport:"579",receivedFields:[],frequencyHz:14025000,
    editFrequencyText:"14025000",frequencyError:"",correctionReason:"Operator correction",confirmDelete:false,deletionReason:""};
  const view={schemaVersion:1,status:"ready",sessionRevision:7,canExportCabrillo:true,
    page:{offset:0,limit:20,total:1,rows:[]},manualRows:[],partialRows:[],editing,busy:false};
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return {...snapshot,panelID:"logbook",projection:view};
    if(command==="contest_surface_action")return {requestID:args.requestID,status:"applied"};
    if(command==="contest_contact_editor_close")return;
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);await screen.findByRole("heading",{name:"Edit Contact"});
  await waitFor(()=>expect(native.closeRequested).toBeTypeOf("function"));
  const preventDefault=vi.fn();await act(async()=>{await native.closeRequested!({preventDefault});});
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(native.invoke.mock.calls.find(([command])=>command==="contest_surface_action")?.[1]).toMatchObject({
    panelID:"logbook",action:"log_edit_cancel",params:{qsoID:"logged-qso"},
  });
  expect(native.invoke).toHaveBeenCalledWith("contest_contact_editor_close",undefined);
});

it("lays out Edit Contact actions as a wrapping right-aligned native-style row",()=>{
  const css=readFileSync(`${process.cwd()}/src/contesting/DetachedContestSurface.css`,"utf8");
  expect(css).toMatch(/contest-surface-editor-actions[^}]*display:flex[^}]*justify-content:flex-end[^}]*flex-wrap:wrap[^}]*gap:8px/);
});

it("groups Edit Contact into paired primary rows, a wide comment and dense lower details",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=edit-contact"));
  const editing={qsoID:"logged-qso",workedAt:"2026-10-20 12:00:00",operator:"OM0RX",callsign:"K1ABC",reportsVisible:true,
    name:"",qth:"",comment:"",band:"20m",mode:"CW",sentReport:"599",receivedReport:"579",receivedFields:[],frequencyHz:14025000,
    editFrequencyText:"14025000",frequencyError:"",correctionReason:"Operator correction",confirmDelete:false,deletionReason:""};
  native.invoke.mockResolvedValue({...snapshot,panelID:"logbook",projection:{schemaVersion:1,status:"ready",sessionRevision:7,canExportCabrillo:true,
    page:{offset:0,limit:20,total:1,rows:[]},manualRows:[],partialRows:[],editing,busy:false}});
  render(<DetachedContestSurface/>);await screen.findByRole("heading",{name:"Edit Contact"});
  expect(document.querySelector(".contest-surface-editor-primary")?.contains(screen.getByLabelText("Callsign"))).toBe(true);
  expect(screen.getByLabelText("Comment").closest(".contest-surface-editor-wide")).toBeTruthy();
  expect(document.querySelector(".contest-surface-editor-secondary")?.contains(screen.getByLabelText("Op"))).toBe(true);
});

it("renders authoritative raw DXLOG values in the log and full-log partial table",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=logbook"));
  const row={qsoID:"outside-current-page",TS:"2026-10-19 01:02:03",Call:"DL1ABC",Freq:"14025.125",SNT:"579",RCV:"589",M1:"✓",ZN:"14",M2:"",prefix:"DL1",Points:"3"};
  const view={schemaVersion:1,status:"ready",sessionRevision:1,canExportCabrillo:true,page:{offset:0,limit:20,total:1,rows:[]},manualRows:[row],partialRows:[row],editing:null,busy:false};
  expect(validContestSurfaceProjection("logbook",view)).toBe(true);
  expect(validContestSurfaceProjection("logbook",{...view,partialRows:[{...row,Freq:14025}]})).toBe(false);
  native.invoke.mockResolvedValue({...snapshot,panelID:"logbook",projection:view});render(<DetachedContestSurface/>);
  await screen.findByRole("heading",{name:"Log Display"});
  for(const name of ["Contest log","Callsign partial matches"])
    expect(Array.from(screen.getByRole("table",{name}).querySelectorAll("tbody td")).map(cell=>cell.textContent)).toEqual([row.TS,row.Call,row.Freq,row.SNT,row.RCV,row.M1,row.ZN,row.M2,row.prefix,row.Points]);
  expect(document.querySelectorAll(".contest-surface-log-scroll")).toHaveLength(2);
});

it("renders the exact plugin log columns for both paged and partial rows",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=logbook"));
  const columns=["YYYY-MM-DD HH:MM:SS","Call","Freq","Snt","Rcv","SentNr","RcvNr","CK","Prec","Sect","M1","PTS"];
  const row={qsoID:"ss-qso",values:["2026-10-20 12:00:00","K1ABC","14025","599","599","1","123","67","A","CT","✓","2"]};
  const partial={qsoID:"ss-partial",values:["2026-10-20 12:01:00","K1ABD","14026","599","599","2","124","68","B","EMA","","2"]};
  const pageRow={qsoID:row.qsoID,workedAt:"2026-10-20T12:00:00.000Z",callsign:"K1ABC",band:"20m",mode:"CW",
    sentExchange:"1",receivedExchange:"123 A K1ABC 67 CT",points:2,multiplierLabels:["CT"]};
  const view={schemaVersion:1,status:"ready",sessionRevision:1,canExportCabrillo:true,exchangeLayout:"plugin",
    pluginColumns:columns,pluginRows:[row],pluginPartialRows:[partial],page:{offset:0,limit:20,total:1,rows:[pageRow]},
    editing:null,busy:false};
  expect(validContestSurfaceProjection("logbook",view)).toBe(true);
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>command==="contest_surface_snapshot"?
    {...snapshot,panelID:"logbook",projection:view}:{requestID:args.requestID,status:"queued"});
  render(<DetachedContestSurface/>);
  await screen.findByRole("heading",{name:"Log Display"});
  for(const [label,expected] of [["Contest log",row.values],["Callsign partial matches",partial.values]] as const) {
    const table=screen.getByRole("table",{name:label});
    expect(Array.from(table.querySelectorAll("thead th")).map(cell=>cell.textContent)).toEqual(columns);
    expect(Array.from(table.querySelectorAll("tbody td")).map(cell=>cell.textContent)).toEqual(expected);
  }
  expect(document.querySelectorAll(".contest-surface-log-scroll")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button",{name:"K1ABD"}));
  await waitFor(()=>expect(native.invoke.mock.calls.find(([command])=>command==="contest_surface_action")?.[1]).toMatchObject({
    panelID:"logbook",projectionRevision:6,action:"log_edit_begin",params:{qsoID:"ss-partial"},
  }));
});

it("marks explicit same-band dupes and shares persistent keyboard-resizable columns between both log tables",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=logbook"));
  const columns=["Call","Freq","Zone mult","PTS"],row={qsoID:"dupe-qso",values:["K1ABC","14250","","0"],isDupe:true},
    partial={qsoID:"partial-qso",values:["K1ABD","14255","✓","3"],isDupe:false},
    pageRow={qsoID:row.qsoID,workedAt:"2026-10-20T12:00:00.000Z",callsign:"K1ABC",band:"20m",mode:"SSB",
      sentExchange:"59 15",receivedExchange:"59 5",points:0,multiplierLabels:[]},
    view={schemaVersion:1,status:"ready",sessionRevision:1,canExportCabrillo:true,exchangeLayout:"plugin",
      pluginColumns:columns,pluginRows:[row],pluginPartialRows:[partial],page:{offset:0,limit:20,total:1,rows:[pageRow]},editing:null,busy:false};
  native.invoke.mockResolvedValue({...snapshot,panelID:"logbook",projection:view});
  const mounted=render(<DetachedContestSurface/>);await screen.findByRole("heading",{name:"Log Display"});
  const duplicateRow=screen.getByRole("row",{name:/K1ABC duplicate/});
  expect(duplicateRow.classList.contains("contest-surface-log-dupe")).toBe(true);
  expect(screen.getByText("DUPE")).toBeTruthy();
  expect(duplicateRow.querySelector(".contest-surface-log-points")?.textContent).toBe("0");
  expect(screen.getByRole("table",{name:"Callsign partial matches"}).querySelector(".contest-surface-log-multiplier")?.textContent).toBe("✓");
  const before=(screen.getByRole("table",{name:"Contest log"}).querySelector("col") as HTMLElement).style.width;
  fireEvent.keyDown(screen.getAllByRole("separator",{name:"Resize Call column"})[0],{key:"ArrowRight"});
  await waitFor(()=>{const primary=(screen.getByRole("table",{name:"Contest log"}).querySelector("col") as HTMLElement).style.width,
    secondary=(screen.getByRole("table",{name:"Callsign partial matches"}).querySelector("col") as HTMLElement).style.width;
    expect(primary).not.toBe(before);expect(secondary).toBe(primary);});
  const saved=(screen.getByRole("table",{name:"Contest log"}).querySelector("col") as HTMLElement).style.width;
  mounted.unmount();render(<DetachedContestSurface/>);await screen.findByRole("heading",{name:"Log Display"});
  expect((screen.getByRole("table",{name:"Contest log"}).querySelector("col") as HTMLElement).style.width).toBe(saved);
});

it("fits the detached Log page to the visible primary pane and requests that exact limit",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=logbook"));
  let resized=()=>{};
  class TestResizeObserver { constructor(callback:()=>void){resized=callback;} observe(){} disconnect(){} }
  vi.stubGlobal("ResizeObserver",TestResizeObserver);
  const height=Object.getOwnPropertyDescriptor(HTMLElement.prototype,"clientHeight");
  Object.defineProperty(HTMLElement.prototype,"clientHeight",{configurable:true,get:()=>240});
  try {
    const view={schemaVersion:1,status:"ready",sessionRevision:1,canExportCabrillo:true,
      page:{offset:20,limit:20,total:32,rows:[]},manualRows:[],partialRows:[],editing:null,busy:false};
    native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>command==="contest_surface_snapshot"
      ? {...snapshot,panelID:"logbook",projection:view}:{requestID:args.requestID,status:"queued"});
    render(<DetachedContestSurface/>);await screen.findByRole("heading",{name:"Log Display"});
    await act(async()=>resized());
    await waitFor(()=>expect(native.invoke.mock.calls.find(([command,args])=>command==="contest_surface_action"&&args.action==="log_page")?.[1])
      .toMatchObject({panelID:"logbook",action:"log_page",params:{offset:16,limit:8}}));
  } finally {
    if(height)Object.defineProperty(HTMLElement.prototype,"clientHeight",height);else delete (HTMLElement.prototype as any).clientHeight;
    vi.unstubAllGlobals();
  }
});

it.each([
  ["Export Cabrillo…","log_export_cabrillo",{}],
  ["Export ADIF…","log_export_adif",{}],
  ["Export EDI…","log_export_edi",{}],
  ["Recalculate","log_recalculate",{expectedSessionRevision:1}],
] as const)("routes %s from the detached Log window to its contest owner",async(button,action,params)=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=logbook"));
  const view={schemaVersion:1,status:"ready",sessionRevision:1,canExportCabrillo:true,canExportAdif:true,canExportEdi:true,
    page:{offset:0,limit:20,total:0,rows:[]},editing:null,busy:false};
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>command==="contest_surface_snapshot"?
    {...snapshot,panelID:"logbook",projection:view}:{requestID:args.requestID,status:"queued"});
  render(<DetachedContestSurface/>);
  fireEvent.click(await screen.findByText("Log tools"));
  fireEvent.click(await screen.findByRole("button",{name:button}));
  await waitFor(()=>expect(native.invoke.mock.calls.find(([command])=>command==="contest_surface_action")?.[1]).toMatchObject({
    panelID:"logbook",projectionRevision:6,action,params,
  }));
});

it("hides Cabrillo when the Python contest projection only admits ADIF export",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=logbook"));
  const view={schemaVersion:1,status:"ready",sessionRevision:1,canExportCabrillo:false,canExportAdif:true,
    page:{offset:0,limit:20,total:0,rows:[]},editing:null,busy:false};
  native.invoke.mockResolvedValue({...snapshot,panelID:"logbook",projection:view});render(<DetachedContestSurface/>);
  expect(await screen.findByRole("button",{name:"Export ADIF…"})).toBeTruthy();
  expect(screen.queryByRole("button",{name:"Export Cabrillo…"})).toBeNull();
  expect(screen.queryByRole("button",{name:"Export EDI…"})).toBeNull();
});

it("uses four N1MM Check Partial panes with exact, changed, and extra character highlighting",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=callsign-intelligence"));
  const view={schemaVersion:1,status:"ready",draftID:"draft-1",draftRevision:5,inputCallsign:"DL1A",
    loggedCandidates:[{candidateID:"log:DL1A",callsign:"DL1A"}],clusterCandidates:[{candidateID:"cluster:DL1E",callsign:"DL1E"}],
    scp:{source:"MASTER.SCP",candidates:[{candidateID:"scp:KDL1A",callsign:"KDL1A"},{candidateID:"scp:DL1ABC",callsign:"DL1ABC"}]},
    history:{source:"Call History",rows:[{candidateID:"history:DL1AX",callsign:"DL1AX",fields:[]}]},busy:false};
  expect(validContestSurfaceProjection("callsign-intelligence",view)).toBe(true);
  native.invoke.mockResolvedValue({...snapshot,panelID:"callsign-intelligence",projection:view});render(<DetachedContestSurface/>);
  await screen.findByRole("heading",{name:"Check Partial"});
  expect(["Log","Master","Telnet","Call History"].map(name=>screen.getByRole("heading",{name}).textContent)).toHaveLength(4);
  expect(screen.getByRole("button",{name:"DL1A"}).querySelector(".contest-check-exact")?.textContent).toBe("DL1A");
  expect(screen.getByRole("button",{name:"DL1E"}).querySelector(".contest-check-changed")?.textContent).toBe("E");
  expect(screen.getByRole("button",{name:"DL1ABC"}).querySelectorAll(".contest-check-extra")).toHaveLength(2);
  expect(screen.getByRole("button",{name:"KDL1A"}).querySelector(".contest-check-extra")?.textContent).toBe("K");
  expect(screen.getByRole("button",{name:"KDL1A"}).querySelectorAll(".contest-check-match")).toHaveLength(4);
  expect(screen.getByRole("button",{name:"KDL1A"}).querySelectorAll(".contest-check-callsign")).toHaveLength(1);
  expect(screen.getByRole("heading",{name:"Master"}).parentElement?.dataset.pane).toBe("scp");
});

it("identifies the three Check Partial panes for the full-height Master layout",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=callsign-intelligence"));
  const view={schemaVersion:1,status:"ready",draftID:"draft-1",draftRevision:5,inputCallsign:"OM",
    loggedCandidates:[{candidateID:"log:OM0A",callsign:"OM0A"}],clusterCandidates:[{candidateID:"cluster:OM2KI",callsign:"OM2KI"}],
    scp:{source:"MASTER.SCP",candidates:[{candidateID:"scp:OM0RX",callsign:"OM0RX"}]},history:{source:null,rows:[]},busy:false};
  native.invoke.mockResolvedValue({...snapshot,panelID:"callsign-intelligence",projection:view});render(<DetachedContestSurface/>);
  await screen.findByRole("heading",{name:"Check Partial"});
  const columns=screen.getByRole("heading",{name:"Master"}).parentElement?.parentElement;
  expect(columns?.dataset.paneCount).toBe("3");
  expect(["log","scp","cluster"].map(kind=>columns?.querySelector(`[data-pane="${kind}"]`)?.getAttribute("data-pane")))
    .toEqual(["log","scp","cluster"]);
});

it("routes missing-corpus download, refresh, and retry through the contest owner",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=callsign-intelligence"));
  const view={schemaVersion:1,status:"ready",draftID:"draft-1",draftRevision:5,inputCallsign:"DL1",
    scp:{source:null,candidates:[],availability:"invalid_cache",notice:null,error:"The previous download failed."},
    history:{source:null,rows:[]},busy:false};
  expect(validContestSurfaceProjection("callsign-intelligence",view)).toBe(true);
  native.invoke.mockImplementation(async(command,args)=>command==="contest_surface_snapshot"?
    {...snapshot,panelID:"callsign-intelligence",projection:view}:{requestID:args.requestID,status:"applied",projectionRevision:7});
  render(<DetachedContestSurface/>);
  expect(await screen.findByText(/saved local MASTER\.SCP index is invalid/)).toBeTruthy();
  expect(screen.getAllByRole("heading",{level:2}).map(node=>node.textContent)).toEqual(["Log","Master"]);
  fireEvent.click(screen.getByRole("button",{name:"Download latest"}));
  fireEvent.click(screen.getByRole("button",{name:"Refresh"}));
  fireEvent.click(screen.getByRole("button",{name:"Retry"}));
  await waitFor(()=>expect(native.invoke.mock.calls.filter(([command])=>command==="contest_surface_action").map(([,args])=>args.action))
    .toEqual(["assistance_download","assistance_refresh","assistance_download"]));
  for(const [,args] of native.invoke.mock.calls.filter(([command])=>command==="contest_surface_action"))
    expect(args).toMatchObject({panelID:"callsign-intelligence",projectionRevision:6,
      params:{draftID:"draft-1",expectedDraftRevision:5}});
});

it.each(["log", "scp", "cluster", "history"])("selects the %s Check Partial candidate with exact owner revisions",async kind=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=callsign-intelligence"));
  const candidate={candidateID:`${kind}:DL1ABC`,callsign:"DL1ABC"};
  const view={schemaVersion:1,status:"ready",draftID:"draft-1",draftRevision:5,inputCallsign:"DL1",
    loggedCandidates:kind==="log"?[candidate]:[],clusterCandidates:kind==="cluster"?[candidate]:[],
    scp:{source:null,candidates:kind==="scp"?[candidate]:[]},
    history:{source:null,rows:kind==="history"?[{...candidate,fields:[]}]:[]},busy:false};
  native.invoke.mockImplementation(async(command,args)=>command==="contest_surface_snapshot"?
    {...snapshot,panelID:"callsign-intelligence",projection:view}:{requestID:args.requestID,status:"queued"});
  render(<DetachedContestSurface/>);
  const button=await screen.findByRole("button",{name:"DL1ABC"});
  fireEvent.click(button);
  await waitFor(()=>expect(native.invoke.mock.calls.find(([command])=>command==="contest_surface_action")?.[1]).toMatchObject({
    panelID:"callsign-intelligence",projectionRevision:6,action:"assistance_select",
    params:{draftID:"draft-1",expectedDraftRevision:5,kind,candidateID:candidate.candidateID}}));
});

it("routes a scoped native contest child without mounting the normal surface",async()=>{
  expect(await loadWindowSurface(search)).toBe(DetachedContestSurface);
});

it.each(["band-maps","dx-cluster"] as const)("selects shared spots from the contest %s window through only its fenced owner action",async panelID=>{
  window.history.replaceState({},"",search.replace("view=active-qso",`view=${panelID}`));
  localStorage.setItem("xlog.integration.bandMaps.workspace.bands","normal-band-map-sentinel");
  localStorage.setItem("xlog.integration.full-cluster-columns.v1","normal-cluster-sentinel");
  const view={schemaVersion:2,status:"ready",draftID:"draft-1",draftRevision:5,radioFrequencyHz:14_025_000,
    connectedClusters:1,loadedSpots:25,selectedSpotID:null,
    contestSessionID:sessionID,supportedBands:["40m","20m"],allowedModeGroups:["cw"],
    configuredClusters:[{serverID:"server-1",serverName:"ShackCQ",enabled:true}],
    connections:panelID==="dx-cluster"?[{serverID:"server-1",serverName:"ShackCQ",phase:"connected",error:null}]:[],
    markedOnly:false,spots:[sharedSpot],busy:false};
  native.invoke.mockImplementation(async(command,args)=>command==="contest_surface_snapshot"?{...snapshot,panelID,projection:view}:
    command==="contest_surface_action"?{requestID:args.requestID,status:"queued"}:Promise.reject(new Error(`unexpected ${command}`)));
  render(<DetachedContestSurface/>);
  const callsign=await screen.findByText("DL1ABC");
  if(panelID==="dx-cluster"){
    expect(screen.getByLabelText("CQ WW opportunity totals")).toBeTruthy();
    expect(Array.from((screen.getByLabelText("CQ WW band") as HTMLSelectElement).options).map(option=>option.value))
      .toEqual(["all","40m","20m"]);
    expect((screen.getByLabelText("CQ WW band") as HTMLSelectElement).value).toBe("20m");
    expect(screen.queryByLabelText("Spot filters")).toBeNull();
    expect(screen.getByRole("button",{name:"Connect"})).toHaveProperty("disabled",true);
    expect(screen.getByRole("button",{name:"Disconnect"})).toHaveProperty("disabled",false);
    expect(screen.getByLabelText("Contest cluster connections").textContent).toContain("ShackCQ · Connected");
    expect(screen.queryByRole("button",{name:/^(Refresh|Console|Settings)$/})).toBeNull();
  }
  fireEvent.click(panelID==="dx-cluster" ? callsign.closest("tr")! : callsign.closest("button")!);
  await waitFor(()=>expect(native.invoke.mock.calls.find(([command])=>command==="contest_surface_action")?.[1]).toMatchObject({
    panelID,projectionRevision:6,action:"spot_select",params:{draftID:"draft-1",expectedDraftRevision:5,spotID:"spot-1"}}));
  expect(native.invoke.mock.calls.some(([command])=>command==="activate_spot")).toBe(false);
  expect(localStorage.getItem("xlog.integration.bandMaps.workspace.bands")).toBe("normal-band-map-sentinel");
  expect(localStorage.getItem("xlog.integration.full-cluster-columns.v1")).toBe("normal-cluster-sentinel");
  if(panelID==="band-maps"){
    expect(document.querySelector(".band-maps-compact.band-maps-contest")).not.toBeNull();
    expect(screen.getByRole("region",{name:"20m band map"})).toBeTruthy();
    expect(screen.queryByLabelText("Add band map")).toBeNull();
    expect(screen.getByRole("button",{name:"Zoom 20m in"}).textContent).toBe("+");
    expect(screen.getByLabelText("Spot age")).toBeTruthy();
  }
  await waitFor(()=>expect(localStorage.getItem(panelID==="band-maps"
    ? `xlog.integration.bandMaps.contest.${sessionID}.bands`:"xlog.integration.contest.cluster-columns.v1")).not.toBeNull());
});

it.each([
  {phase:"disconnected",label:"Connect",method:"cluster_connect"},
  {phase:"connected",label:"Disconnect",method:"cluster_disconnect"},
] as const)("routes contest Cluster $label through the existing shared owner",async({phase,label,method})=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=dx-cluster"));
  const view={schemaVersion:2,status:"ready",draftID:"draft-1",draftRevision:5,radioFrequencyHz:14_025_000,
    connectedClusters:phase==="connected"?1:0,loadedSpots:1,selectedSpotID:null,
    configuredClusters:[{serverID:"server-1",serverName:"ShackCQ",enabled:true}],
    connections:[{serverID:"server-1",serverName:"ShackCQ",phase,error:null}],markedOnly:false,spots:[sharedSpot],busy:false};
  let finishWorker!:()=>void;
  native.invoke.mockImplementation(async(command,args)=>{
    if(command==="contest_surface_snapshot")return {...snapshot,panelID:"dx-cluster",projection:view};
    if(command==="worker_request")return new Promise(resolve=>{finishWorker=()=>resolve({id:args.request.id,ok:true,result:{snapshot:{spots:[]}}});});
    throw new Error(`unexpected ${command}`);
  });
  const rendered=render(<DetachedContestSurface/>);
  const actionButton=await screen.findByRole("button",{name:label});
  fireEvent.click(actionButton);fireEvent.click(actionButton);
  await waitFor(()=>expect(native.invoke.mock.calls.find(([command])=>command==="worker_request")?.[1].request)
    .toMatchObject({method,params:{}}));
  expect(native.invoke.mock.calls.filter(([command])=>command==="worker_request")).toHaveLength(1);
  expect(actionButton).toHaveProperty("disabled",true);
  const reconciled={...view,connections:[{...view.connections[0],phase:method==="cluster_connect"?"connected":"disconnected"}]};
  native.invoke.mockImplementation(async(command,args)=>{
    if(command==="contest_surface_snapshot")return {...snapshot,panelID:"dx-cluster",projection:reconciled};
    if(command==="worker_request")return new Promise(resolve=>{finishWorker=()=>resolve({id:args.request.id,ok:true,result:{snapshot:{spots:[]}}});});
    throw new Error(`unexpected ${command}`);
  });
  rendered.rerender(<DetachedContestSurface/>);
  native.wake?.();
  finishWorker();
  await waitFor(()=>expect(actionButton).toHaveProperty("disabled",true));
  expect(screen.queryByText(method==="cluster_connect"?"Cluster connected.":"Cluster disconnected.")).toBeNull();
  expect(native.invoke.mock.calls.some(([command])=>command==="contest_surface_action")).toBe(false);
});

it("requests 100 recent spots once from the connected Contest Cluster even while the contest owner is busy",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=dx-cluster"));
  const view={schemaVersion:2,status:"ready",draftID:"draft-1",draftRevision:5,radioFrequencyHz:7_150_000,
    connectedClusters:1,loadedSpots:0,selectedSpotID:null,supportedBands:["40m"],allowedModeGroups:["phone"],
    configuredClusters:[{serverID:"server-1",serverName:"ShackCQ",enabled:true}],
    connections:[{serverID:"server-1",serverName:"ShackCQ",phase:"connected",error:null}],markedOnly:false,spots:[],busy:true};
  let finishWorker!:()=>void;
  native.invoke.mockImplementation(async(command,args)=>{
    if(command==="contest_surface_snapshot")return {...snapshot,panelID:"dx-cluster",projection:view};
    if(command==="worker_request")return new Promise(resolve=>{finishWorker=()=>resolve({id:args.request.id,ok:true,result:{snapshot:{spots:[]}}});});
    if(command==="contest_surface_diagnostic_report")return;
    throw new Error(`unexpected ${command}`);
  });
  render(<DetachedContestSurface/>);
  const recent=await screen.findByRole("button",{name:"SH/DX/100"});
  expect(recent).toHaveProperty("disabled",false);
  fireEvent.click(recent);fireEvent.click(recent);
  await waitFor(()=>expect(native.invoke.mock.calls.filter(([command])=>command==="worker_request")).toHaveLength(1));
  expect(native.invoke.mock.calls.find(([command])=>command==="worker_request")?.[1].request)
    .toMatchObject({method:"cluster_command",params:{command:"SH/DX/100"}});
  expect(recent).toHaveProperty("disabled",true);
  finishWorker();
  await waitFor(()=>expect(recent).toHaveProperty("disabled",false));
  expect(native.invoke.mock.calls.some(([command,args])=>command==="contest_surface_diagnostic_report"&&
    args.kind==="notice"&&args.message==="Requested 100 recent DX spots.")).toBe(true);
});

it("settles a successful Cluster request when the shared connection snapshot is unchanged",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=dx-cluster"));
  const view={schemaVersion:2,status:"ready",draftID:"draft-1",draftRevision:5,radioFrequencyHz:null,
    connectedClusters:0,loadedSpots:0,selectedSpotID:null,
    configuredClusters:[{serverID:"server-1",serverName:"ShackCQ",enabled:true}],
    connections:[{serverID:"server-1",serverName:"ShackCQ",phase:"disconnected",error:null}],markedOnly:false,spots:[],busy:false};
  native.invoke.mockImplementation(async(command,args)=>{
    if(command==="contest_surface_snapshot")return {...snapshot,panelID:"dx-cluster",projection:view};
    if(command==="worker_request")return {id:args.request.id,ok:true,result:{snapshot:{spots:[]}}};
    if(command==="contest_surface_diagnostic_report")return;
    throw new Error(`unexpected ${command}`);
  });
  render(<DetachedContestSurface/>);
  const connect=await screen.findByRole("button",{name:"Connect"});
  expect(screen.getByRole("button",{name:"Disconnect"})).toHaveProperty("disabled",true);
  fireEvent.click(connect);
  await waitFor(()=>expect(connect).toHaveProperty("disabled",false));
  expect(screen.queryByText("Cluster connected.")).toBeNull();
  expect(native.invoke.mock.calls.filter(([command])=>command==="worker_request")).toHaveLength(1);
  expect(native.invoke.mock.calls.some(([command,args])=>command==="contest_surface_diagnostic_report"&&
    args.kind==="notice"&&args.message==="Cluster connected.")).toBe(true);
});

it("routes a Cluster failure across windows into Messages without rendering it in Cluster",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=dx-cluster"));
  const view={schemaVersion:2,status:"ready",draftID:"draft-1",draftRevision:5,radioFrequencyHz:null,
    connectedClusters:0,loadedSpots:0,selectedSpotID:null,
    configuredClusters:[{serverID:"server-1",serverName:"ShackCQ",enabled:true}],connections:[],markedOnly:false,spots:[],busy:false};
  const diagnostics:Array<{kind:"error"|"notice";text:string}>=[];
  native.invoke.mockImplementation(async(command,args)=>{
    if(command==="contest_surface_snapshot")return window.location.search.includes("view=messages")
      ? {...snapshot,panelID:"messages",projection:{schemaVersion:1,status:"ready",busy:false,messages:diagnostics}}
      : {...snapshot,panelID:"dx-cluster",projection:view};
    if(command==="worker_request")return {id:args.request.id,ok:false,error:{message:"Cluster connection failed."}};
    if(command==="contest_surface_diagnostic_report"){if(!diagnostics.some(item=>item.kind===args.kind&&item.text===args.message))
      diagnostics.push({kind:args.kind,text:args.message});return;}
    throw new Error(`unexpected ${command}`);
  });
  const rendered=render(<DetachedContestSurface/>);fireEvent.click(await screen.findByRole("button",{name:"Connect"}));
  await waitFor(()=>expect(screen.getByRole("button",{name:"Connect"})).toHaveProperty("disabled",false));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(native.invoke.mock.calls.filter(([command])=>command==="worker_request")).toHaveLength(1);
  await waitFor(()=>expect(diagnostics).toEqual([{kind:"error",text:"Cluster connection failed."}]));
  rendered.unmount();window.history.replaceState({},"",search.replace("view=active-qso","view=messages"));
  render(<DetachedContestSurface/>);
  expect((await screen.findByRole("alert")).textContent).toBe("Cluster connection failed.");
});

it("matches the Not1MM Cluster age control without deleting shared spots",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=dx-cluster"));
  const appleNow=Math.floor(Date.now()/1000)-978_307_200;
  const oldSpot={...sharedSpot,id:"spot-old",callsign:"VK8OLD",receivedAt:appleNow-40*60};
  const markedOldSpot={...sharedSpot,id:"spot-marked",callsign:"VK8MARK",receivedAt:appleNow-90*60,marked:true};
  const view={schemaVersion:2,status:"ready",draftID:"draft-1",draftRevision:5,radioFrequencyHz:14_025_000,
    connectedClusters:1,loadedSpots:3,selectedSpotID:null,
    configuredClusters:[{serverID:"server-1",serverName:"ShackCQ",enabled:true}],
    connections:[{serverID:"server-1",serverName:"ShackCQ",phase:"connected",error:null}],
    markedOnly:false,spots:[sharedSpot,oldSpot,markedOldSpot],busy:false};
  native.invoke.mockImplementation(async command=>command==="contest_surface_snapshot"?{...snapshot,panelID:"dx-cluster",projection:view}:
    Promise.reject(new Error(`unexpected ${command}`)));
  render(<DetachedContestSurface/>);
  expect(await screen.findByText("DL1ABC")).toBeTruthy();
  expect(screen.queryByText("VK8OLD")).toBeNull();
  expect(screen.getByText("VK8MARK")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Cluster spot age"),{target:{value:"60"}});
  expect(await screen.findByText("VK8OLD")).toBeTruthy();
  expect(localStorage.getItem("xlog.integration.contest.cluster-age-minutes.v1")).toBe("60");
  expect(native.invoke.mock.calls.some(([command])=>command==="worker_request"||command==="contest_surface_action")).toBe(false);
});

it("gives the nested contest Cluster table all remaining window height without page scrolling",()=>{
  const css=readFileSync(`${process.cwd()}/src/contesting/DetachedContestSurface.css`,"utf8");
  expect(css).toContain(".contest-detached-surface > main:has(> .contest-spots) { overflow:hidden; }");
  expect(css).toContain(".contest-spots > .live-cluster > :not(.live-cluster-table) { flex-shrink:0; }");
  expect(css).toContain(".contest-spots > .live-cluster > .live-cluster-table { flex:1 1 0; min-height:60px; max-height:none; overflow:hidden;");
});

it("lets Band Map and Rates fill a resized contest window without changing their compact defaults",()=>{
  const css=readFileSync(`${process.cwd()}/src/contesting/DetachedContestSurface.css`,"utf8");
  expect(css).toContain(".contest-spots > .band-maps-contest { align-self:stretch; width:100%; max-width:none; }");
  expect(css).toContain(".contest-surface-rates { width:100%; font-family:");
  expect(css).not.toContain(".contest-surface-rates { width:100%; max-width:340px;");
  expect(css).not.toContain(".contest-surface-rates { align-self:flex-start;");
});

it.each(["band-maps", "monitor", "dx-cluster"])(
  "keeps disconnected contest %s waiting and mutation-passive", async panelID => {
    window.history.replaceState({}, "", search.replace("view=active-qso", `view=${panelID}`));
    native.invoke.mockImplementation(async (command:string) => {
      if (command === "contest_surface_snapshot") return { ...snapshot, panelID, projection: { schemaVersion:1, status:"unavailable" } };
      throw new Error(`unexpected ${command}`);
    });
    render(<DetachedContestSurface/>);
    expect(await screen.findByText("Loading shared contest panel…")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(native.invoke.mock.calls.every(([command]) => command === "contest_surface_snapshot")).toBe(true);
  });

it.each([
  ["awards", "DXCC", "This contest does not score DXCC multipliers."],
  ["chaser-dx", "Zones", "This contest does not score CQ or ITU zone multipliers."],
])("explains why the contest %s window has no scoring data",async(panelID,heading,message)=>{
  window.history.replaceState({},"",search.replace("view=active-qso",`view=${panelID}`));
  native.invoke.mockImplementation(async(command:string)=>{
    if(command==="contest_surface_snapshot")return{...snapshot,panelID,projection:{schemaVersion:1,status:"unavailable"}};
    throw new Error(`unexpected ${command}`);
  });
  render(<DetachedContestSurface/>);
  expect(await screen.findByRole("heading",{name:heading})).toBeTruthy();
  expect(screen.getByText(message)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

it("renders exact owner Rates independently of the current log page and refreshes on wake", async () => {
  window.history.replaceState({}, "", search.replace("view=active-qso", "view=monitor"));
  let revision=6, rates = { schemaVersion: 1, status: "ready", lastHourQsoPerHour: 48, last10QsoPerHour: 72.5,
    last100QsoPerHour: null, sinceHourUTC: 19, sinceHourQso: 2, runQso: 210, searchAndPounceQso: 70,
    hourRunQso: 30, hourSearchAndPounceQso: 18, busy: false };
  native.invoke.mockImplementation(async (command: string) => {
    if (command === "contest_surface_snapshot") return { ...snapshot, panelID: "monitor", projectionRevision:revision, projection: rates };
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);
  expect(await screen.findByRole("heading", { name: "Rates" })).toBeTruthy();
  expect(screen.getByText("72.5")).toBeTruthy();
  expect(screen.getByText("Since 19:00:00z:")).toBeTruthy();
  expect(screen.getByText("QSO")).toBeTruthy();
  expect(screen.getByLabelText("Not enough contacts")).toBeTruthy();
  expect(screen.getByText("48").closest(".contest-surface-rate-current")).toBeTruthy();
  expect(screen.getByText("72.5").closest(".contest-surface-rate-ten")).toBeTruthy();
  const rateTable=screen.getByRole("table", { name: "Run and Search & Pounce QSOs" });
  expect(rateTable.textContent).toContain("210");
  expect(screen.getByRole("row",{name:/^Run QSO:/}).classList.contains("contest-surface-rate-run")).toBe(true);
  expect(screen.getByRole("row",{name:/^S&P QSO:/}).classList.contains("contest-surface-rate-search")).toBe(true);
  revision=7; rates = { ...rates, runQso: 211 };
  await act(async () => { native.wake!(); });
  expect(await screen.findByText("211")).toBeTruthy();
  expect(native.invoke.mock.calls.every(([command]) => command === "contest_surface_snapshot")).toBe(true);
});

it.each([{ panelID: "awards", title: "DXCC", label: "Slovakia" }, { panelID: "chaser-dx", title: "Zone", label: "15" }])(
  "renders the session-owned $title matrix with per-band cells", async ({ panelID, title, label }) => {
    window.history.replaceState({}, "", search.replace("view=active-qso", `view=${panelID}`));
    native.invoke.mockImplementation(async (command: string) => {
      if (command === "contest_surface_snapshot") return { ...snapshot, panelID, projection: { schemaVersion: 1, status: "ready",
        title, bands: ["20m", "40m"], rows: [{ label, counts: { "20m": 21, "40m": 0 }, total: 21 }], total: 1, busy: false } };
      throw new Error(command);
    });
    render(<DetachedContestSurface/>);
    expect(await screen.findByRole("heading", { name: title })).toBeTruthy();
    expect(screen.getByRole("table", { name: `${title} by band` })).toBeTruthy();
    expect(screen.getByRole("rowheader", { name: label })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "0" })).toBeTruthy();
    expect(screen.getByText("1 worked in view")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(native.invoke.mock.calls.every(([command]) => command === "contest_surface_snapshot")).toBe(true);
  });

it("highlights and scrolls to the contest's current CQ zone without a misleading CQ/ITU switch", async () => {
  window.history.replaceState({}, "", search.replace("view=active-qso", "view=chaser-dx"));
  const scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable:true, value:scrollIntoView });
  native.invoke.mockImplementation(async (command: string) => {
    if (command === "contest_surface_snapshot") return { ...snapshot, panelID:"chaser-dx", projection:{schemaVersion:4,status:"ready",
      title:"CQ Zones",tracker:"zone",zoneSystem:"cq",current:{dxcc:"Germany",cqZone:14,ituZone:28},bands:["20m","40m"],
      configuredBands:["20m"],currentBand:"20m",
      rows:[{label:"14",counts:{"20m":1,"40m":0},total:1},{label:"28",counts:{"20m":0,"40m":0},total:0}],total:1,busy:false} };
    throw new Error(command);
  });
  const mounted=render(<DetachedContestSurface/>);
  expect(await screen.findByRole("heading", { name:"CQ Zones" })).toBeTruthy();
  expect(screen.queryByRole("radio")).toBeNull();
  expect(screen.getAllByRole("columnheader", { name:"20m" })).toHaveLength(2);
  expect(screen.queryByRole("columnheader", { name:"40m" })).toBeNull();
  fireEvent.change(screen.getByRole("combobox", { name:"Multiplier band scope" }), { target:{value:"all"} });
  expect(screen.getAllByRole("columnheader", { name:"40m" }).length).toBeGreaterThan(0);
  fireEvent.change(screen.getByRole("combobox", { name:"Multiplier row filter" }), { target:{value:"needed"} });
  mounted.unmount();render(<DetachedContestSurface/>);
  expect(await screen.findByRole("combobox", { name:"Multiplier band scope" })).toHaveProperty("value","all");
  expect(screen.getByRole("combobox", { name:"Multiplier row filter" })).toHaveProperty("value","needed");
  expect(screen.getByRole("rowheader", { name:"14" }).closest("tr")?.getAttribute("aria-current")).toBe("true");
  await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  expect(native.invoke.mock.calls.every(([command]) => command === "contest_surface_snapshot")).toBe(true);
});

it("highlights and scrolls to the current DXCC entity", async () => {
  window.history.replaceState({}, "", search.replace("view=active-qso", "view=awards"));
  const scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable:true, value:scrollIntoView });
  native.invoke.mockImplementation(async (command: string) => {
    if (command === "contest_surface_snapshot") return { ...snapshot, panelID:"awards", projection:{schemaVersion:4,status:"ready",
      title:"DXCC",tracker:"dxcc",zoneSystem:null,current:{dxcc:"Germany",cqZone:14,ituZone:28},bands:["20m"],
      rows:[{label:"Germany",counts:{"20m":1},total:1}],total:1,busy:false} };
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);
  const row = (await screen.findByRole("rowheader", { name:"Germany" })).closest("tr");
  expect(row?.getAttribute("aria-current")).toBe("true");
  await waitFor(() => expect(scrollIntoView).toHaveBeenCalledOnce());
  expect(screen.queryByRole("radio")).toBeNull();
});

it("fills a wide DXCC window with as many country blocks as its width permits",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=awards"));
  const priorWidth=window.innerWidth;Object.defineProperty(window,"innerWidth",{configurable:true,value:1400});
  try {
    native.invoke.mockImplementation(async(command:string)=>{
      if(command==="contest_surface_snapshot")return{...snapshot,panelID:"awards",projection:{schemaVersion:4,status:"ready",
        title:"DXCC",tracker:"dxcc",zoneSystem:null,current:{dxcc:"Slovak Republic",cqZone:15,ituZone:28},bands:["15m"],
        configuredBands:["15m"],currentBand:"15m",rows:[
          {label:"DL",counts:{"15m":1},total:1},{label:"VK",counts:{"15m":1},total:1},{label:"OM",counts:{"15m":1},total:1},
          {label:"Slovak Republic",counts:{"15m":1},total:1},
        ],total:4,busy:false}};
      throw new Error(command);
    });
    render(<DetachedContestSurface/>);await screen.findByRole("heading",{name:"DXCC"});
    const summary=document.querySelector(".contest-surface-matrix-summary")!;
    expect(Array.from(summary.children).map(item=>item.textContent)).toEqual(["4 shown · 4 worked in view"]);
    expect(screen.getAllByRole("table")).toHaveLength(4);
    expect((document.querySelector(".contest-surface-matrix-blocks") as HTMLElement).style.gridTemplateColumns)
      .toBe("repeat(4,minmax(148px,1fr))");
  } finally {Object.defineProperty(window,"innerWidth",{configurable:true,value:priorWidth});}
});

it("shows only DXCC entities worked within the selected band scope",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=awards"));
  native.invoke.mockImplementation(async(command:string)=>{
    if(command==="contest_surface_snapshot")return{...snapshot,panelID:"awards",projection:{schemaVersion:4,status:"ready",
      title:"DXCC",tracker:"dxcc",zoneSystem:null,current:{dxcc:"Slovak Republic",cqZone:15,ituZone:28},bands:["15m","40m"],
      configuredBands:["40m"],currentBand:"40m",rows:[
        {label:"DL",counts:{"15m":1,"40m":0},total:1},{label:"VK",counts:{"15m":0,"40m":1},total:1},
        {label:"OM",counts:{"15m":0,"40m":2},total:2},
      ],total:3,busy:false}};
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);await screen.findByRole("heading",{name:"DXCC"});
  expect(screen.queryByRole("rowheader",{name:"DL"})).toBeNull();
  expect(screen.queryByRole("rowheader",{name:"Slovak Republic"})).toBeNull();
  expect(screen.getByRole("rowheader",{name:"VK"})).toBeTruthy();
  expect(screen.getByRole("rowheader",{name:"OM"})).toBeTruthy();
  const summary=document.querySelector(".contest-surface-matrix-summary")!;
  expect(Array.from(summary.children).map(item=>item.textContent)).toEqual(["2 shown · 2 worked in view","3 unique total"]);
});

it.each([{ panelID: "awards", title: "DXCC", column: "DXCC" }, { panelID: "chaser-dx", title: "CQ Zones", column: "Zone" }])(
  "renders an empty $title tracker with its band headings", async ({ panelID, title, column }) => {
    window.history.replaceState({}, "", search.replace("view=active-qso", `view=${panelID}`));
    const bands = ["160m", "80m", "40m", "20m", "15m", "10m"];
    native.invoke.mockImplementation(async (command: string) => {
      if (command === "contest_surface_snapshot") return { ...snapshot, panelID, projection: {
        schemaVersion: 1, status: "ready", title, bands, rows: [], total: 0, busy: false } };
      throw new Error(command);
    });
    render(<DetachedContestSurface/>);
    expect(await screen.findByRole("heading", { name: title })).toBeTruthy();
    expect(screen.getByRole("table", { name: `${title} by band` })).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map(cell => cell.textContent)).toEqual([column, ...bands, "Total"]);
    expect(screen.getByText("0 worked in view")).toBeTruthy();
    expect(screen.queryAllByRole("rowheader")).toHaveLength(0);
    expect(screen.queryByText("Panel unavailable")).toBeNull();
    expect(native.invoke.mock.calls.every(([command]) => command === "contest_surface_snapshot")).toBe(true);
  });

it("renders the owner projection without the removed developer frequency editor",async()=>{
  native.invoke.mockImplementation(async(command:string,args:Record<string,unknown>)=>{
    if(command==="contest_surface_snapshot")return snapshot;
    if(command==="contest_surface_action")return {requestID:args.requestID,status:"applied",projectionRevision:6};
    throw new Error(`unexpected ${command}`);
  });
  render(<DetachedContestSurface/>);
  expect(await screen.findByRole("heading",{name:"ARRL DX"})).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByLabelText("Frequency Hz")).toBeNull();
  expect(screen.queryByText("Entry controls")).toBeNull();
  expect(native.invoke.mock.calls.every(([command])=>command==="contest_surface_snapshot")).toBe(true);
});

it("renders Entry v2 sent and simulation state and forwards an exact style action",async()=>{
  const v2={...snapshot,projection:{...projection,schemaVersion:2,draft:{...projection.draft,frequencyHz:14025000,
      receivedFields:[{...projection.draft.receivedFields[0],label:"sn prec ck sec"}]},
    descriptor:{bands:["20m","40m"],modes:["CW"],sentFields:[{id:"power",label:"Power",value:"100",required:true,maximumUTF8Bytes:4}],
      serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},
    operator:{output:"simulation-only",outputAvailable:true,outputUnavailableReason:null,armed:false,style:"run",status:"disarmed",pending:null,focusedField:"callsign",...tabMaps,
      functionKeys:[{key:"F1",macro:"CQ",highlighted:true}],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},
      trace:[{operationID:"simulation-1",mode:"CW",macro:"CQ",text:"CQ OM0RX",status:"confirmed"}]}}};
  native.invoke.mockImplementation(async(command:string,args:Record<string,unknown>)=>{
    if(command==="contest_surface_snapshot")return v2;
    if(command==="contest_surface_action")return {requestID:args.requestID,status:"queued"};
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);expect(await screen.findByRole("button",{name:"F1 CQ"})).toBeTruthy();
  expect(screen.getByRole("region",{name:"Main Logging"})).toBeTruthy();
  expect(screen.getByLabelText("Current frequency").textContent).toBe("14,025.00 kHz");
  expect(screen.getByRole("group",{name:"Function key macros"}).querySelectorAll("button")).toHaveLength(12);
  expect(screen.getByLabelText("Current band and mode").textContent).toBe("CW2040");
  expect(screen.getByLabelText("Sent exchange")).toHaveProperty("value","100");
  expect(screen.getByLabelText("CW speed unavailable").textContent).toBe("—");
  expect((screen.getByLabelText("Increase CW speed") as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByLabelText("QSOs and multipliers").textContent).toBe("QSO / mults—/—");
  expect(screen.getByLabelText("Score").textContent).toBe("Score—");
  expect(Array.from(document.querySelectorAll(".contest-surface-main-fields > *")).map(field=>field.querySelector("label")?.firstChild?.textContent??field.firstChild?.textContent))
    .toEqual(["Callsign","SNT","RCV","Power","sn prec ck sec"]);
  expect(screen.getByLabelText("Received exchange 1")).toHaveProperty("value","100");
  expect(screen.getAllByRole("radio").map(input=>input.parentElement?.textContent)).toEqual(["Run","S&P"]);
  expect(screen.queryByLabelText("Operating style")).toBeNull();
  expect(document.querySelector(".contest-surface-entry > footer")).toBeNull();
  expect(document.querySelector(".contest-surface-entry-options")).toBeNull();
  expect(screen.queryByText("Entry controls")).toBeNull();
  expect(screen.queryByRole("button",{name:"Reserve serial",hidden:true})).toBeNull();
    expect(screen.getByRole("group",{name:"Function key macros"}).textContent).toContain("F1: CQ");
  expect((screen.getByRole("button",{name:"F12 Unassigned"}) as HTMLButtonElement).disabled).toBe(true);
  expect(document.querySelector("canvas")).toBeNull();
  fireEvent.click(screen.getByRole("radio",{name:"S&P"}));
  await waitFor(()=>expect(native.invoke.mock.calls.some(([command,args])=>command==="contest_surface_action"&&args.action==="entry_operator_style")).toBe(true));
  expect(native.invoke.mock.calls.find(([command,args])=>command==="contest_surface_action"&&args.action==="entry_operator_style")?.[1])
    .toMatchObject({panelID:"active-qso",projectionRevision:6,params:{draftID:"draft-1",expectedDraftRevision:5,value:"search-and-pounce"}});
});

it("uses the configured CW speed step for buttons and PgUp/PgDown with station bounds",async()=>{
  const manual={operator:"OM0RX",cwSpeedWpm:98,cwSpeedStepWpm:5,country:null,cqZone:null,ituZone:null,
    headingDegrees:null,longPathHeadingDegrees:null,distanceKm:null,qsos:0,multipliers:0,total:0};
  const v2={...snapshot,projection:{...projection,schemaVersion:2,manual,
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null},
      keyBindings:[{context:"*",key:"PgUp",action:"CW_SPEED_UP"},{context:"*",key:"PgDown",action:"CW_SPEED_DOWN"}]},
    operator:null}};
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return v2;
    if(command==="contest_surface_action")return{requestID:args.requestID,status:"applied",projectionRevision:7};
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);await screen.findByLabelText("Current CW speed");
  fireEvent.click(screen.getByLabelText("Increase CW speed"));
  await waitFor(()=>expect(native.invoke.mock.calls.some(([command,args])=>command==="contest_surface_action"&&args.action==="entry_set_cw_speed"&&args.params.value===100)).toBe(true));
  fireEvent.keyDown(screen.getByRole("region",{name:"Main Logging"}),{key:"PageDown"});
  await waitFor(()=>expect(native.invoke.mock.calls.some(([command,args])=>command==="contest_surface_action"&&args.action==="entry_set_cw_speed"&&args.params.value===93)).toBe(true));
});

it("keeps SSB macros visible while optional unconfigured voice controls and setup guidance stay out of Main Logging",async()=>{
  const view={...snapshot,projection:{...projection,schemaVersion:2,draft:{...projection.draft,mode:"SSB",sentReport:"59",receivedReport:"59"},
    descriptor:{bands:["20m"],modes:["SSB"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},
    operator:{output:"xlog-native",outputAvailable:false,outputUnavailableReason:"Recorded phone output is unavailable until a Voice WAV profile folder is saved in Contest Setup.",armed:false,style:"run",status:"disarmed",pending:null,focusedField:"callsign",...tabMaps,
      functionKeys:[{key:"F1",macro:"CQ",highlighted:true},{key:"F2",macro:"Exchange",highlighted:false}],
      readiness:{canSendCQ:false,canSendCall:false,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]}}};
  native.invoke.mockImplementation(async(command:string)=>{if(command==="contest_surface_snapshot")return view;throw new Error(command);});
  render(<DetachedContestSurface/>);
  await screen.findByRole("region",{name:"Main Logging"});
  expect(screen.getByRole("radio",{name:"Run"})).toBeTruthy();
  expect(screen.queryByRole("group",{name:"CW speed"})).toBeNull();
  const macros=screen.getByRole("group",{name:"Function key macros"});
  expect(macros.querySelectorAll("button")).toHaveLength(12);
  expect((screen.getByRole("button",{name:"F1 CQ"}) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button",{name:"F2 Exchange"}) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button",{name:"F12 Unassigned"}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button",{name:"Arm recorded phone"})).toBeNull();
  expect(screen.queryByText(/recorded phone/i)).toBeNull();
  expect(screen.queryByText(/Voice WAV profile folder/i)).toBeNull();
  fireEvent.keyDown(screen.getByRole("region",{name:"Main Logging"}),{key:"F1"});
  expect(native.invoke.mock.calls.some(([command])=>command==="contest_surface_action")).toBe(false);
  expect(screen.queryByText(/Phone contest voice output is unavailable in production/i)).toBeNull();
});

it.each([
  ["Callsign","callsign","DL1ABC"],["SNT","sent","58"],["RCV","receive","58"],["CQ Zone","other_2","15"],
] as const)("flushes a freshly typed CQ WW %s value and accepts Enter immediately",async(label,focusedField,typedValue)=>{
  let view:any={...snapshot,projection:{...projection,schemaVersion:2,session:{name:"CQ WW SSB",ruleName:"CQ WW SSB",mode:"SSB"},draft:{...projection.draft,callsign:focusedField==="callsign"?"":"DL1ABC",mode:"SSB",
      sentReport:"59",receivedReport:"59",receivedFields:[{id:"other_2",label:"CQ Zone",value:"14",required:true,maximumUTF8Bytes:128,enabled:true,readOnly:false}]},
    descriptor:{bands:["40m"],modes:["SSB"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},
    operator:{output:"xlog-native",outputAvailable:false,outputUnavailableReason:"Optional voice output is not configured.",armed:false,style:"search-and-pounce",status:"disarmed",
      pending:null,focusedField,...tabMaps,functionKeys:[],readiness:{canSendCQ:false,canSendCall:false,canSendDuplicate:false,
        canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]}}};
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return view;
    if(command==="contest_surface_action"){
      const draft=view.projection.draft;
      if(args.action==="entry_set_text")view={...view,projectionRevision:view.projectionRevision+1,projection:{...view.projection,
        draft:{...draft,revision:draft.revision+1,[args.params.field]:args.params.value}}};
      if(args.action==="entry_set_exchange")view={...view,projectionRevision:view.projectionRevision+1,projection:{...view.projection,
        draft:{...draft,revision:draft.revision+1,receivedFields:draft.receivedFields.map((field:any)=>field.id===args.params.fieldID?{...field,value:args.params.value}:field)}}};
      return{requestID:args.requestID,status:"applied"};
    }
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);const input=await screen.findByLabelText(label);
  fireEvent.change(input,{target:{value:typedValue}});
  fireEvent.keyDown(input,{key:"Enter"});
  await waitFor(()=>expect(native.invoke.mock.calls.filter(([command])=>command==="contest_surface_action").map(([,args])=>args))
    .toContainEqual(expect.objectContaining({action:"entry_commit",params:expect.objectContaining({draftID:"draft-1"})})));
});

it("shows saved only after a confirmed commit advances to a new draft",async()=>{
  const operator={output:"xlog-native",outputAvailable:false,outputUnavailableReason:"Optional voice is not configured.",armed:false,style:"run",status:"disarmed",pending:null,focusedField:"callsign",...tabMaps,
    functionKeys:[],readiness:{canSendCQ:false,canSendCall:false,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]};
  let current:any={...snapshot,projection:{...projection,schemaVersion:2,draft:{...projection.draft,frequencyHz:14_250_000,frequencyText:"14250000",frequencyError:"",mode:"SSB",sentReport:"59",receivedReport:"59"},
    descriptor:{bands:["20m"],modes:["SSB"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},operator}};
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return structuredClone(current);
    if(command==="contest_surface_action"){
      expect(args.action).toBe("entry_commit");
      current={...current,projectionRevision:7,projection:{...current.projection,
        draft:{...current.projection.draft,draftID:"draft-2",revision:6,callsign:"",dupe:{state:"unchecked",reason:""}},
        operator:{...current.projection.operator,focusedField:"callsign"}}};
      return{requestID:args.requestID,status:"applied"};
    }
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);
  fireEvent.click(await screen.findByRole("button",{name:/^Log It/}));
  expect((await screen.findByText("QSO saved")).getAttribute("role")).toBe("status");
  expect(screen.getByLabelText("Callsign")).toHaveProperty("value","");
});

it.each([{available:false},{available:true}])("keeps original RTTY macros visible with truthful fldigi availability ($available)",async({available})=>{
  const reason="fldigi macro output is unavailable. Enable fldigi macro transmit in Digital Logging Setup.";
  const view={...snapshot,projection:{...projection,schemaVersion:2,draft:{...projection.draft,mode:"RTTY"},
    descriptor:{bands:["20m"],modes:["RTTY"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},
    operator:{output:"xlog-native",outputAvailable:available,outputUnavailableReason:available?null:reason,armed:available,
      style:"run",status:available?"armed":"disarmed",pending:null,focusedField:"callsign",...tabMaps,
      functionKeys:[{key:"F1",macro:"CQ TEST",highlighted:true},{key:"F2",macro:"Exchange",highlighted:false}],
      readiness:{canSendCQ:available,canSendCall:available,canSendDuplicate:available,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]}}};
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return view;
    if(command==="contest_surface_action")return{requestID:args.requestID,status:"queued"};
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);
  await screen.findByRole("region",{name:"Run and S&P fldigi controls"});
  const f1=screen.getByRole("button",{name:"F1 CQ TEST"})as HTMLButtonElement;
  expect(f1.disabled).toBe(!available);
  expect(f1.className).toContain("contest-primary");
  expect(screen.queryByRole("button",{name:"Arm CW"})).toBeNull();
  if(!available)expect(screen.getByText(reason)).toBeTruthy();
  else {
    fireEvent.click(f1);
    await waitFor(()=>expect(native.invoke.mock.calls.some(([command,args])=>command==="contest_surface_action"&&
      args.action==="entry_operator_key"&&args.params.key==="F1")).toBe(true));
  }
});

it.each([{armed:false,label:"Arm recorded phone",next:true},{armed:true,label:"Disarm",next:false}])(
  "routes truthful production SSB $label controls through the owner",async({armed,label,next})=>{
  const view={...snapshot,projection:{...projection,schemaVersion:2,draft:{...projection.draft,mode:"SSB",sentReport:"59",receivedReport:"59"},
    descriptor:{bands:["20m"],modes:["SSB"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},
    operator:{output:"xlog-native",outputAvailable:true,outputUnavailableReason:null,armed,style:"run",status:armed?"armed":"disarmed",pending:null,focusedField:"callsign",...tabMaps,
      functionKeys:[{key:"F1",macro:"CQ",highlighted:false}],readiness:{canSendCQ:armed,canSendCall:armed,canSendDuplicate:armed,
        canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]}}};
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return view;
    if(command==="contest_surface_action")return{requestID:args.requestID,status:"queued"};
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);
  await screen.findByRole("region",{name:"Run and S&P phone controls"});
  expect(screen.getByText(new RegExp(`xLog recorded phone · ${armed?"armed":"disarmed"}`,"i"))).toBeTruthy();
  expect((screen.getByRole("button",{name:"F1 CQ"})as HTMLButtonElement).disabled).toBe(!armed);
  fireEvent.click(screen.getByRole("button",{name:label}));
  await waitFor(()=>expect(native.invoke.mock.calls.some(([command,args])=>command==="contest_surface_action"&&args.action==="entry_operator_arm"&&args.params.armed===next)).toBe(true));
  if(armed){fireEvent.keyDown(screen.getByRole("region",{name:"Main Logging"}),{key:"Escape"});
    await waitFor(()=>expect(native.invoke.mock.calls.some(([command,args])=>command==="contest_surface_action"&&args.action==="entry_operator_key"&&args.params.key==="Escape")).toBe(true));}
});

it("keeps uncertain production phone ownership visible while blocking every send",async()=>{
  const view={...snapshot,projection:{...projection,schemaVersion:2,draft:{...projection.draft,mode:"SSB",sentReport:"59",receivedReport:"59"},
    descriptor:{bands:["20m"],modes:["SSB"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},
    operator:{output:"xlog-native",outputAvailable:true,outputUnavailableReason:null,armed:true,style:"run",status:"uncertain",pending:null,focusedField:"callsign",...tabMaps,
      functionKeys:[{key:"F1",macro:"CQ",highlighted:false}],readiness:{canSendCQ:false,canSendCall:false,canSendDuplicate:false,
        canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]}}};
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return view;
    if(command==="contest_surface_action")return{requestID:args.requestID,status:"queued"};
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);
  await screen.findByText(/xLog recorded phone · uncertain/i);
  expect((screen.getByRole("button",{name:"F1 CQ"})as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button",{name:"Enter / ESM"})).toBeNull();
  expect(screen.queryByRole("button",{name:"Escape"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Disarm"}));
  await waitFor(()=>expect(native.invoke.mock.calls.some(([command,args])=>command==="contest_surface_action"&&
    args.action==="entry_operator_arm"&&args.params.armed===false)).toBe(true));
});

it("makes CQ WW SSB Contesting Test intent simulation unmistakable without CW controls",async()=>{
  const view={...snapshot,projection:{...projection,schemaVersion:2,draft:{...projection.draft,mode:"SSB",sentReport:"59",receivedReport:"59"},
    descriptor:{bands:["20m"],modes:["SSB"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},
    operator:{output:"test-simulation",outputAvailable:true,outputUnavailableReason:null,armed:true,style:"run",status:"armed",pending:null,focusedField:"callsign",...tabMaps,
      functionKeys:[{key:"F1",macro:"CQ",highlighted:true},{key:"F12",macro:"His call TU",highlighted:false}],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:true,
        canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[{operationID:"operation-1:0",mode:"SSB",macro:"Their call",text:"K1ABC",status:"confirmed"}]}}};
  native.invoke.mockImplementation(async(command:string)=>{if(command==="contest_surface_snapshot")return view;throw new Error(command);});
  render(<DetachedContestSurface/>);
  expect(await screen.findByText(/simulated SSB voice-keyer intent only · no audio playback, RF, PTT, radio, or network output/i)).toBeTruthy();
  expect(screen.getByRole("button",{name:"F1 CQ"})).toBeTruthy();
  expect(screen.getByRole("button",{name:"F12 His call TU"})).toBeTruthy();
  expect(screen.queryByRole("button",{name:"Enter / ESM"})).toBeNull();
  expect(screen.queryByRole("group",{name:"CW speed"})).toBeNull();
  expect(screen.getByRole("region",{name:"Run and S&P test simulation"}).textContent).toContain("Test simulation · armed");
});

it("makes the contesting-test nontransmitting CW simulator unmistakable",async()=>{
  const view={...snapshot,projection:{...projection,schemaVersion:2,draft:{...projection.draft,mode:"CW"},
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},
    operator:{output:"test-simulation",outputAvailable:true,outputUnavailableReason:null,armed:true,style:"run",status:"armed",pending:null,focusedField:"callsign",...tabMaps,
      functionKeys:[{key:"F1",macro:"CQ",highlighted:false}],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]}}};
  native.invoke.mockImplementation(async(command:string)=>{if(command==="contest_surface_snapshot")return view;throw new Error(command);});
  render(<DetachedContestSurface/>);
  expect(await screen.findByText(/CONTESTING TEST · simulated CW only · no RF, audio, PTT, radio, or network output/i)).toBeTruthy();
  expect(screen.getByRole("region",{name:"Run and S&P test simulation"})).toBeTruthy();
  expect(screen.getByText("Test simulation · armed")).toBeTruthy();
});

it("executes saved finite Not1MM key bindings and stops using the replaced chord",async()=>{
  const view={...snapshot,projection:{...projection,schemaVersion:2,draft:{...projection.draft,frequencyHz:14025000,frequencyError:""},
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[{id:"power",label:"Power",value:"100",required:true,maximumUTF8Bytes:4}],
      serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null},keyBindings:[
        {context:"*",key:"Alt+R",action:"TOGGLE_RUN"},{context:"Callsign",key:"Up",action:"NEXT_SPOT"}]},
    operator:{output:"simulation-only",outputAvailable:true,outputUnavailableReason:null,armed:false,style:"run",status:"disarmed",pending:null,focusedField:"callsign",...tabMaps,
      functionKeys:[],readiness:{canSendCQ:false,canSendCall:false,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]}}};
  native.invoke.mockImplementation(async(command:string,args:Record<string,unknown>)=>{
    if(command==="contest_surface_snapshot")return view;
    if(command==="contest_surface_action")return {requestID:args.requestID,status:"queued"};
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);
  const region=await screen.findByRole("region",{name:"Main Logging"});
  fireEvent.keyDown(region,{key:"r",ctrlKey:true});
  expect(native.invoke.mock.calls.some(([command])=>command==="contest_surface_action")).toBe(false);
  fireEvent.keyDown(region,{key:"r",altKey:true});
  await waitFor(()=>expect(native.invoke.mock.calls.find(([command,args])=>command==="contest_surface_action"&&args.action==="entry_operator_style")?.[1])
    .toMatchObject({action:"entry_operator_style",params:{value:"search-and-pounce"}}));
});

it.each([
  ["∫","KeyB","WIN_BAND","band-maps"], ["ç","KeyC","WIN_CHECK","callsign-intelligence"],
  ["¬","KeyL","WIN_LOG","logbook"], ["®","KeyR","WIN_RATE","monitor"],
  ["ß","KeyS","WIN_STATS","propagation"], ["√","KeyV","WIN_VFO","station-control"],
] as const)("routes macOS Option physical %s to the native %s window toggle",async(key,code,action,panelID)=>{
  const view={...snapshot,projection:{...projection,schemaVersion:2,
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null},
      keyBindings:[{context:"*",key:`Alt+${code.slice(-1)}`,action}]},
    operator:{output:"simulation-only",outputAvailable:true,outputUnavailableReason:null,armed:false,style:"run",status:"disarmed",pending:null,focusedField:"callsign",...tabMaps,
      functionKeys:[],readiness:{canSendCQ:false,canSendCall:false,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]}}};
  native.invoke.mockImplementation(async(command:string)=>{if(command==="contest_surface_snapshot")return view;if(command==="contest_window_toggle")return null;throw new Error(command);});
  render(<DetachedContestSurface/>);const region=await screen.findByRole("region",{name:"Main Logging"});
  fireEvent.keyDown(region,{key,code,altKey:true});
  await waitFor(()=>expect(native.invoke.mock.calls.find(([command])=>command==="contest_window_toggle")?.[1]).toMatchObject({panelID}));
  expect(native.invoke.mock.calls.some(([command])=>command==="contest_surface_action")).toBe(false);
});

it("executes saved function-macro and explicit S&P bindings through the existing operator router",async()=>{
  const view={...snapshot,projection:{...projection,schemaVersion:2,draft:{...projection.draft,frequencyHz:14025000,frequencyError:""},
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[{id:"power",label:"Power",value:"100",required:true,maximumUTF8Bytes:4}],
      serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null},keyBindings:[
        {context:"*",key:"Ctrl+1",action:"SEND_F2"},{context:"*",key:"Ctrl+Shift+S",action:"SET_S_AND_P"}]},
    operator:{output:"simulation-only",outputAvailable:true,outputUnavailableReason:null,armed:true,style:"run",status:"armed",pending:null,focusedField:"callsign",...tabMaps,
      functionKeys:[{key:"F2",macro:"Exchange",highlighted:true}],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:true,
        canReserveCall:true,canReserveCommit:true,canCommit:true},trace:[]}}};
  native.invoke.mockImplementation(async(command:string,args:Record<string,unknown>)=>{
    if(command==="contest_surface_snapshot")return view;
    if(command==="contest_surface_action")return {requestID:args.requestID,status:"applied",projectionRevision:6};
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);const region=await screen.findByRole("region",{name:"Main Logging"});
  fireEvent.keyDown(region,{key:"1",ctrlKey:true});
  await waitFor(()=>expect(native.invoke.mock.calls.find(([command,args])=>command==="contest_surface_action"&&args.action==="entry_operator_key")?.[1])
    .toMatchObject({action:"entry_operator_key",params:{key:"F2",focusedField:"callsign"}}));
  fireEvent.keyDown(region,{key:"s",ctrlKey:true,shiftKey:true});
  await waitFor(()=>expect(native.invoke.mock.calls.find(([command,args])=>command==="contest_surface_action"&&args.action==="entry_operator_style")?.[1])
    .toMatchObject({action:"entry_operator_style",params:{value:"search-and-pounce"}}));
});

it("executes a saved field-navigation binding through authoritative focus",async()=>{
  const view={...snapshot,projection:{...projection,schemaVersion:2,draft:{...projection.draft,frequencyHz:14025000,frequencyError:""},
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null},
      keyBindings:[{context:"Callsign",key:"Ctrl+N",action:"FOCUS_NEXT"}]},
    operator:{output:"simulation-only",outputAvailable:true,outputUnavailableReason:null,armed:false,style:"run",status:"disarmed",pending:null,focusedField:"callsign",...tabMaps,
      functionKeys:[],readiness:{canSendCQ:false,canSendCall:false,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]}}};
  native.invoke.mockImplementation(async(command:string,args:Record<string,unknown>)=>{
    if(command==="contest_surface_snapshot")return view;
    if(command==="contest_surface_action")return {requestID:args.requestID,status:"applied",projectionRevision:6};
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);const callsign=await screen.findByLabelText("Callsign");callsign.focus();
  fireEvent.keyDown(callsign,{key:"n",ctrlKey:true});
  expect(document.activeElement).toBe(screen.getByLabelText("SNT"));
  await waitFor(()=>expect(native.invoke.mock.calls.find(([command,args])=>command==="contest_surface_action"&&args.action==="entry_focus")?.[1])
    .toMatchObject({action:"entry_focus",params:{fieldID:"sent"}}));
});

it("executes a field-context Not1MM key binding",async()=>{
  const view={...snapshot,projection:{...projection,schemaVersion:2,draft:{...projection.draft,frequencyHz:14025000,frequencyError:""},
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[{id:"power",label:"Power",value:"100",required:true,maximumUTF8Bytes:4}],
      serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null},keyBindings:[{context:"Callsign",key:"Up",action:"NEXT_SPOT"}]},
    operator:{output:"simulation-only",outputAvailable:true,outputUnavailableReason:null,armed:false,style:"run",status:"disarmed",pending:null,focusedField:"callsign",...tabMaps,
      functionKeys:[],readiness:{canSendCQ:false,canSendCall:false,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]}}};
  native.invoke.mockImplementation(async(command:string,args:Record<string,unknown>)=>{
    if(command==="contest_surface_snapshot")return view;
    if(command==="contest_surface_action")return {requestID:args.requestID,status:"applied",projectionRevision:6};
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);await screen.findByRole("region",{name:"Main Logging"});
  fireEvent.keyDown(screen.getByLabelText("Callsign"),{key:"ArrowUp"});
  await waitFor(()=>expect(native.invoke.mock.calls.find(([command,args])=>command==="contest_surface_action"&&args.action==="entry_step_spot")?.[1])
    .toMatchObject({action:"entry_step_spot",params:{direction:"next"}}));
});

it("opens its bounded CW composer and routes text through the fenced active-QSO action",async()=>{
  const view={...snapshot,projection:{...projection,schemaVersion:2,draft:{...projection.draft,frequencyHz:14025000,frequencyError:""},
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null},
      keyBindings:[{context:"Report",key:"Ctrl+K",action:"TOGGLE_CW_INPUT"}]},
    operator:{output:"test-simulation",outputAvailable:true,outputUnavailableReason:null,armed:true,style:"run",status:"armed",pending:null,focusedField:"callsign",...tabMaps,
      functionKeys:[],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]}}};
  native.invoke.mockImplementation(async(command:string,args:Record<string,unknown>)=>{
    if(command==="contest_surface_snapshot")return view;
    if(command==="contest_surface_action")return {requestID:args.requestID,status:"applied"};
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);await screen.findByRole("region",{name:"Main Logging"});
  const launchField=screen.getByLabelText("RCV");launchField.focus();fireEvent.keyDown(launchField,{key:"k",ctrlKey:true});
  let input=await screen.findByLabelText("Send CW text");expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input,{key:"k",ctrlKey:true});await waitFor(()=>expect(screen.queryByLabelText("Send CW text")).toBeNull());
  expect(document.activeElement).toBe(launchField);fireEvent.keyDown(launchField,{key:"k",ctrlKey:true});input=await screen.findByLabelText("Send CW text");
  fireEvent.change(input,{target:{value:"CQ TEST DE OM0RX"}});
  expect(fireEvent.keyDown(input,{key:" "})).toBe(true);expect(fireEvent.keyDown(input,{key:"Enter"})).toBe(true);
  expect(native.invoke.mock.calls.some(([command,args])=>command==="contest_surface_action"&&args.action==="entry_operator_key")).toBe(false);
  fireEvent.keyDown(input,{key:"Escape"});await waitFor(()=>expect(screen.queryByLabelText("Send CW text")).toBeNull());expect(document.activeElement).toBe(launchField);
  fireEvent.keyDown(launchField,{key:"k",ctrlKey:true});input=await screen.findByLabelText("Send CW text");
  fireEvent.change(input,{target:{value:"CQ TEST DE OM0RX"}});fireEvent.submit(input.closest("form")!);
  await waitFor(()=>expect(native.invoke.mock.calls.find(([command,args])=>command==="contest_surface_action"&&args.action==="entry_send_cw_text")?.[1])
    .toMatchObject({panelID:"active-qso",action:"entry_send_cw_text",params:{draftID:"draft-1",expectedDraftRevision:5,value:"CQ TEST DE OM0RX"}}));
  await waitFor(()=>expect(document.activeElement).toBe(launchField));
});

it("steps long numeric exchanges without losing precision",async()=>{
  const view={...snapshot,projection:{...projection,schemaVersion:2,draft:{...projection.draft,
    receivedFields:[{id:"serial",label:"Serial",value:"9007199254740992",required:true,maximumUTF8Bytes:32}],frequencyHz:14025000,frequencyError:""},
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],reportFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null},
      keyBindings:[{context:"Exchange",key:"Ctrl+E",action:"EXCH_INCR"}]},
    operator:{output:"test-simulation",outputAvailable:true,outputUnavailableReason:null,armed:true,style:"run",status:"armed",pending:null,focusedField:"callsign",...tabMaps,
      functionKeys:[],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]}}};
  native.invoke.mockImplementation(async(command:string,args:Record<string,unknown>)=>{
    if(command==="contest_surface_snapshot")return view;
    if(command==="contest_surface_action")return {requestID:args.requestID,status:"applied",projectionRevision:7};
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);const input=await screen.findByLabelText("Received exchange 1");input.focus();
  fireEvent.keyDown(input,{key:"e",ctrlKey:true});
  await waitFor(()=>expect(native.invoke.mock.calls.find(([command,args])=>command==="contest_surface_action"&&args.action==="entry_set_exchange")?.[1])
    .toMatchObject({action:"entry_set_exchange",params:{fieldID:"serial",value:"9007199254740993"}}));
});

it.each([
  ["r","RST_INCR","RCV","entry_set_text",{field:"receivedReport",value:"600"}],
  ["r","RST_DECR","RCV","entry_set_text",{field:"receivedReport",value:"598"}],
  ["e","EXCH_INCR","Received exchange 1","entry_set_exchange",{fieldID:"zone",value:"015"}],
  ["e","EXCH_DECR","Received exchange 1","entry_set_exchange",{fieldID:"zone",value:"013"}],
] as const)("dispatches %s-bound %s against the focused plugin field identity",async(key,bindingAction,label,wireAction,expected)=>{
  const view={...snapshot,projection:{...projection,schemaVersion:2,draft:{...projection.draft,receivedFields:[{id:"zone",label:"Zone",value:"014",required:true,maximumUTF8Bytes:3}],frequencyHz:14025000,frequencyError:""},
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],reportFields:[{id:"sent",label:"SNT",value:"599",required:true,maximumUTF8Bytes:3,enabled:true,readOnly:false},
      {id:"receive",label:"RCV",value:"599",required:true,maximumUTF8Bytes:3,enabled:true,readOnly:false}],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null},
      keyBindings:[{context:bindingAction.startsWith("RST")?"Report":"Exchange",key:`Ctrl+${key.toUpperCase()}`,action:bindingAction}]},
    operator:{output:"test-simulation",outputAvailable:true,outputUnavailableReason:null,armed:true,style:"run",status:"armed",pending:null,focusedField:"callsign",...tabMaps,
      functionKeys:[],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]}}};
  native.invoke.mockImplementation(async(command:string,args:Record<string,unknown>)=>{
    if(command==="contest_surface_snapshot")return view;
    if(command==="contest_surface_action")return {requestID:args.requestID,status:"applied",projectionRevision:7};
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);const input=await screen.findByLabelText(label);input.focus();fireEvent.keyDown(input,{key,ctrlKey:true});
  await waitFor(()=>expect(native.invoke.mock.calls.find(([command,args])=>command==="contest_surface_action"&&args.action===wireAction)?.[1])
    .toMatchObject({action:wireAction,params:expected}));
});

it.each([["s","entry_spot"],["m","entry_mark_spot"],["g","entry_tune_spot"]] as const)(
  "routes Ctrl-%s through the bounded %s Edit Keys action",async(key,action)=>{
  const bindingAction={entry_spot:"SPOT_DX",entry_mark_spot:"MARK_SPOT",entry_tune_spot:"TUNE_SPOT"}[action];
  const view={...snapshot,projection:{...projection,schemaVersion:2,draft:{...projection.draft,frequencyHz:14025000,frequencyError:""},
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null},
      keyBindings:[{context:"*",key:`Ctrl+${key.toUpperCase()}`,action:bindingAction}]},
    operator:{output:"simulation-only",outputAvailable:true,outputUnavailableReason:null,armed:false,style:"run",status:"disarmed",pending:null,focusedField:"callsign",...tabMaps,
      functionKeys:[],readiness:{canSendCQ:false,canSendCall:false,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]}}};
  native.invoke.mockImplementation(async(command:string,args:Record<string,unknown>)=>{
    if(command==="contest_surface_snapshot")return view;
    if(command==="contest_surface_action")return {requestID:args.requestID,status:"applied",projectionRevision:7};
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);const region=await screen.findByRole("region",{name:"Main Logging"});
  fireEvent.keyDown(region,{key,ctrlKey:true});
  await waitFor(()=>expect(native.invoke.mock.calls.find(([command,args])=>command==="contest_surface_action"&&args.action===action)?.[1])
    .toMatchObject({action,params:{draftID:"draft-1",expectedDraftRevision:5}}));
});

it.each([["≥","Period","VFO_UP","up"],["≤","Comma","VFO_DOWN","down"]] as const)(
  "routes macOS Option %s through the fenced %s action",async(key,code,bindingAction,direction)=>{
  const view={...snapshot,projection:{...projection,schemaVersion:2,draft:{...projection.draft,frequencyHz:14025000,frequencyError:""},
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null},
      keyBindings:[{context:"*",key:`Alt+${code==="Period"?".":","}`,action:bindingAction}]},
    operator:{output:"simulation-only",outputAvailable:true,outputUnavailableReason:null,armed:false,style:"run",status:"disarmed",pending:null,focusedField:"callsign",...tabMaps,
      functionKeys:[],readiness:{canSendCQ:false,canSendCall:false,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]}}};
  native.invoke.mockImplementation(async(command:string,args:Record<string,unknown>)=>{
    if(command==="contest_surface_snapshot")return view;
    if(command==="contest_surface_action")return {requestID:args.requestID,status:"applied",projectionRevision:7};
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);const region=await screen.findByRole("region",{name:"Main Logging"});
  fireEvent.keyDown(region,{key,code,altKey:true});
  await waitFor(()=>expect(native.invoke.mock.calls.find(([command,args])=>command==="contest_surface_action"&&args.action==="entry_step_vfo")?.[1])
    .toMatchObject({action:"entry_step_vfo",params:{direction}}));
});

it("routes the default Ctrl+Q return-to-CQ binding through one fenced owner action",async()=>{
  const view={...snapshot,projection:{...projection,schemaVersion:2,draft:{...projection.draft,frequencyHz:14025000,frequencyError:""},
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null},
      keyBindings:[{context:"*",key:"Ctrl+Q",action:"RETURN_CQ_FREQUENCY"}]},
    operator:{output:"simulation-only",outputAvailable:true,outputUnavailableReason:null,armed:false,style:"run",status:"disarmed",pending:null,focusedField:"callsign",...tabMaps,
      functionKeys:[],readiness:{canSendCQ:false,canSendCall:false,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]}}};
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>command==="contest_surface_snapshot"?view:
    command==="contest_surface_action"?{requestID:args.requestID,status:"applied",projectionRevision:7}:Promise.reject(new Error(command)));
  render(<DetachedContestSurface/>);const region=await screen.findByRole("region",{name:"Main Logging"});
  fireEvent.keyDown(region,{key:"q",ctrlKey:true});
  await waitFor(()=>expect(native.invoke.mock.calls.find(([command,args])=>command==="contest_surface_action"&&args.action==="entry_return_cq_frequency")?.[1])
    .toMatchObject({action:"entry_return_cq_frequency",params:{draftID:"draft-1",expectedDraftRevision:5}}));
});

it("collapses unloaded Check Partial sources instead of reserving empty rows",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=callsign-intelligence"));
  native.invoke.mockResolvedValue({...snapshot,panelID:"callsign-intelligence",projection:{schemaVersion:1,status:"ready",draftID:"draft-1",draftRevision:5,
    inputCallsign:"OM0",scp:{source:null,candidates:[{candidateID:"scp-1",callsign:"OM0RX"}]},history:{source:null,rows:[]},busy:false}});
  render(<DetachedContestSurface/>);
  await screen.findByRole("heading",{name:"Check Partial"});
  expect(screen.getAllByRole("heading",{level:2}).map(node=>node.textContent)).toEqual(["Log","Master"]);
  expect(screen.getByLabelText("Matching logged calls unavailable").textContent).toBe("—");
  expect(screen.getByRole("button",{name:"OM0RX"})).toBeTruthy();
  expect(screen.queryByLabelText("Callsign query")).toBeNull();
});

it("renders contest diagnostics only in the dedicated Messages window",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=messages"));
  native.invoke.mockResolvedValue({...snapshot,panelID:"messages",projection:{schemaVersion:1,status:"ready",busy:false,messages:[
    {kind:"error",text:"Contest action failed."},{kind:"notice",text:"Score recalculated."},
  ]}});
  render(<DetachedContestSurface/>);
  expect(await screen.findByRole("heading",{name:"Messages"})).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toBe("Contest action failed.");
  expect(screen.getByRole("status").textContent).toBe("Score recalculated.");
});

it("retains the original log headings and an empty partial pane when the log is empty",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=logbook"));
  native.invoke.mockResolvedValue({...snapshot,panelID:"logbook",projection:{schemaVersion:1,status:"ready",sessionRevision:1,canExportCabrillo:true,
    page:{offset:0,limit:20,total:0,rows:[]},editing:null,busy:false}});
  render(<DetachedContestSurface/>);await screen.findByRole("heading",{name:"Log Display"});
  const table=screen.getByRole("table",{name:"Contest log"});
  expect(Array.from(table.querySelectorAll("th")).map(cell=>cell.textContent)).toEqual(["YYYY-MM-DD HH:MM:SS","Call","Freq","Snt","Rcv","M1","ZN","M2","PFX","PTS"]);
  expect(screen.getByRole("table",{name:"Callsign partial matches"})).toBeTruthy();
  expect(document.querySelectorAll(".contest-surface-log-scroll")).toHaveLength(2);
});

it("serializes rapid Python tab-map focus changes and sends exact report focus to ESM",async()=>{
  const operator={output:"simulation-only",outputAvailable:true,outputUnavailableReason:null,armed:true,style:"run",status:"armed",pending:null,focusedField:"receive",...tabMaps,
    functionKeys:[],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]};
  let current:any={...snapshot,projection:{...projection,schemaVersion:2,
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},operator}};
  const actions:Record<string,any>[]=[];
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return structuredClone(current);
    if(command==="contest_surface_action"){
      actions.push(args);current={...current,projectionRevision:current.projectionRevision+1,
        projection:{...current.projection,draft:{...current.projection.draft,revision:current.projection.draft.revision+1},
          operator:{...current.projection.operator,focusedField:args.action==="entry_focus"?args.params.fieldID:args.params.focusedField}}};
      return {requestID:args.requestID,status:"applied",projectionRevision:current.projectionRevision};
    }
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);const receive=await screen.findByLabelText("RCV"),exchange=screen.getByLabelText("Power");
  expect(document.activeElement).toBe(receive);fireEvent.keyDown(receive,{key:"Enter"});
  await waitFor(()=>expect(actions[0]).toMatchObject({action:"entry_operator_key",params:{key:"Enter",focusedField:"receive"}}));
  fireEvent.keyDown(receive,{key:"Tab"});
  expect(document.activeElement).toBe(exchange);fireEvent.keyDown(exchange,{key:"Tab"});
  expect(document.activeElement).toBe(screen.getByLabelText("Callsign"));
  await waitFor(()=>expect(actions[1]).toMatchObject({action:"entry_focus",params:{fieldID:"other_2"}}));
  await waitFor(()=>expect(actions[2]).toMatchObject({action:"entry_focus",params:{fieldID:"callsign"}}));
  expect(document.activeElement).toBe(screen.getByLabelText("Callsign"));
});

it("uses the pinned plugin space-advance fields instead of limiting space to Callsign",async()=>{
  const operator={output:"simulation-only",outputAvailable:true,outputUnavailableReason:null,armed:false,style:"run",status:"disarmed",pending:null,focusedField:"sent",...tabMaps,
    functionKeys:[],readiness:{canSendCQ:false,canSendCall:false,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]};
  const view={...snapshot,projection:{...projection,schemaVersion:2,
    descriptor:{bands:["20m"],modes:["CW"],advanceOnSpace:["callsign","sent","receive","other_1","other_2"],
      sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},operator}};
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return view;
    if(command==="contest_surface_action")return {requestID:args.requestID,status:"queued"};
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);const sent=await screen.findByLabelText("SNT"),receive=screen.getByLabelText("RCV");
  expect(document.activeElement).toBe(sent);fireEvent.keyDown(sent,{key:" "});
  expect(document.activeElement).toBe(receive);
});

it("uses CQ WW smart Space from callsign directly to the received zone while Tab still visits both reports",async()=>{
  const operator={output:"xlog-native",outputAvailable:false,outputUnavailableReason:"Recorded phone output is optional.",armed:false,style:"search-and-pounce",status:"disarmed",pending:null,focusedField:"callsign",...tabMaps,
    functionKeys:[],readiness:{canSendCQ:false,canSendCall:false,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]};
  const view={...snapshot,projection:{...projection,schemaVersion:2,draft:{...projection.draft,mode:"SSB",sentReport:"59",receivedReport:"59",
      frequencyHz:7_100_000,frequencyText:"7100000",frequencyError:"",receivedFields:[{id:"other_2",label:"CQ Zone",value:"5",required:true,maximumUTF8Bytes:2}]},
    descriptor:{bands:["40m"],modes:["SSB"],advanceOnSpace:["callsign"],spaceNext:{callsign:"other_2"},sentFields:[],
      serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},operator}};
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>command==="contest_surface_snapshot"?view:
    command==="contest_surface_action"?{requestID:args.requestID,status:"queued"}:Promise.reject(new Error(command)));
  render(<DetachedContestSurface/>);const callsign=await screen.findByLabelText("Callsign"),zone=screen.getByLabelText("Received exchange 1");
  callsign.focus();fireEvent.keyDown(callsign,{key:" "});expect(document.activeElement).toBe(zone);
  callsign.focus();fireEvent.keyDown(callsign,{key:"Tab"});expect(document.activeElement).toBe(screen.getByLabelText("SNT"));
});

it("opens Operator for exact OPON Space while ordinary callsigns keep space advance",async()=>{
  const operator={output:"simulation-only",outputAvailable:true,outputUnavailableReason:null,armed:false,style:"run",status:"disarmed",pending:null,focusedField:"callsign",...tabMaps,
    functionKeys:[],readiness:{canSendCQ:false,canSendCall:false,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]};
  const view={...snapshot,projection:{...projection,schemaVersion:2,draft:{...projection.draft,callsign:""},
    descriptor:{bands:["20m"],modes:["CW"],advanceOnSpace:["callsign"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},operator}};
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return view;
    if(command==="contest_surface_action")return {requestID:args.requestID,status:"queued"};
    if(command==="contest_setup_dialog_open")return null;
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);const callsign=await screen.findByLabelText("Callsign"),sent=screen.getByLabelText("SNT");
  fireEvent.change(callsign,{target:{value:"K1ABC"}});fireEvent.keyDown(callsign,{key:" "});
  expect(document.activeElement).toBe(sent);
  expect(native.invoke.mock.calls.some(([command])=>command==="contest_setup_dialog_open")).toBe(false);
  callsign.focus();fireEvent.change(callsign,{target:{value:"OPON"}});fireEvent.keyDown(callsign,{key:" "});
  await waitFor(()=>expect(native.invoke).toHaveBeenCalledWith("contest_setup_dialog_open",{kind:"operator"}));
  expect(document.activeElement).toBe(callsign);
});

it("routes Not1MM callsign mode and kHz commands on Space without advancing normal command focus",async()=>{
  const operator={output:"simulation-only",outputAvailable:true,outputUnavailableReason:null,armed:false,style:"run",status:"disarmed",pending:null,focusedField:"callsign",...tabMaps,
    functionKeys:[],readiness:{canSendCQ:false,canSendCall:false,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]};
  let current:any={...snapshot,projection:{...projection,schemaVersion:2,draft:{...projection.draft,callsign:"",frequencyHz:14_025_000,frequencyText:"14025000",frequencyError:""},
    descriptor:{bands:["160m","80m","40m","20m","15m","10m"],modes:["CW","SSB"],advanceOnSpace:["callsign"],sentFields:[],
      serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},operator}};
  const actions:Record<string,any>[]=[];
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return structuredClone(current);
    if(command==="contest_surface_action"){
      actions.push(args);const draft={...current.projection.draft,revision:current.projection.draft.revision+1};
      if(args.action==="entry_set_text"&&args.params.field==="callsign")draft.callsign=args.params.value;
      if(args.action==="entry_set_mode")Object.assign(draft,{callsign:"",mode:args.params.value==="USB"?"SSB":args.params.value,sentReport:"59",receivedReport:"59"});
      if(args.action==="entry_set_frequency_text")Object.assign(draft,{callsign:"",frequencyHz:Number(args.params.value),frequencyText:args.params.value});
      current={...current,projectionRevision:current.projectionRevision+1,projection:{...current.projection,draft}};
      return{requestID:args.requestID,status:"applied"};
    }
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);const callsign=await screen.findByLabelText("Callsign"),sent=screen.getByLabelText("SNT");

  fireEvent.change(callsign,{target:{value:"USB"}});fireEvent.keyDown(callsign,{key:" "});
  await waitFor(()=>expect(actions.at(-1)).toMatchObject({action:"entry_set_mode",params:{value:"USB",callsignCommand:true}}));
  expect(actions.slice(-2).map(action=>action.action)).toEqual(["entry_set_text","entry_set_mode"]);
  expect(document.activeElement).toBe(callsign);await waitFor(()=>expect((callsign as HTMLInputElement).value).toBe(""));

  fireEvent.change(callsign,{target:{value:"7025.5"}});fireEvent.keyDown(callsign,{key:" "});
  await waitFor(()=>expect(actions.at(-1)).toMatchObject({action:"entry_set_frequency_text",params:{value:"7025500",callsignCommand:true}}));
  expect(document.activeElement).toBe(callsign);

  fireEvent.change(callsign,{target:{value:"K1ABC"}});fireEvent.keyDown(callsign,{key:" "});
  expect(document.activeElement).toBe(sent);
});

it("restores authoritative callsign focus when a logged QSO creates a new draft",async()=>{
  const operator={output:"simulation-only",outputAvailable:true,outputUnavailableReason:null,armed:true,style:"run",status:"armed",pending:null,focusedField:"receive",...tabMaps,
    functionKeys:[],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]};
  let current:any={...snapshot,projection:{...projection,schemaVersion:2,
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},operator}};
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return structuredClone(current);
    if(command==="contest_surface_action"){
      current={...current,projectionRevision:current.projectionRevision+1,projection:{...current.projection,
        draft:{...current.projection.draft,revision:current.projection.draft.revision+1},operator:{...current.projection.operator,focusedField:args.params.fieldID}}};
      return {requestID:args.requestID,status:"applied",projectionRevision:current.projectionRevision};
    }
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);const receive=await screen.findByLabelText("RCV"),exchange=screen.getByLabelText("Power");
  fireEvent.keyDown(receive,{key:"Tab"});await waitFor(()=>expect(document.activeElement).toBe(exchange));
  current={...current,projectionRevision:current.projectionRevision+1,projection:{...current.projection,
    draft:{...current.projection.draft,draftID:"draft-2",revision:1},operator:{...current.projection.operator,focusedField:"callsign"}}};
  await act(async()=>{native.wake!();});await waitFor(()=>expect(document.activeElement).toBe(screen.getByLabelText("Callsign")));
});

it("keeps a CWT keyboard burst and its Name tab target live while the owner persists the first character",async()=>{
  const cwtTabs={tabNext:{callsign:"other_1",other_1:"other_2",other_2:"callsign"},
    tabPrevious:{callsign:"other_2",other_1:"callsign",other_2:"other_1"}};
  const operator={output:"simulation-only",outputAvailable:true,outputUnavailableReason:null,armed:true,style:"search-and-pounce",status:"armed",pending:null,focusedField:"callsign",...cwtTabs,
    functionKeys:[],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]};
  let current:any={...snapshot,projection:{...projection,schemaVersion:2,session:{name:"CWT",ruleName:"CWT",mode:"CW"},
    draft:{...projection.draft,callsign:"",receivedFields:[
      {id:"other_1",label:"Name",value:"",required:true,maximumUTF8Bytes:32},
      {id:"other_2",label:"Member No./SPC",value:"",required:true,maximumUTF8Bytes:128}]},
    descriptor:{reportsVisible:false,bands:["20m"],modes:["CW"],sentFields:[],
      serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},operator}};
  const actions:Record<string,any>[]=[];
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return structuredClone(current);
    if(command==="contest_surface_action"){actions.push(args);return {requestID:args.requestID,status:"queued"};}
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);const callsign=await screen.findByLabelText("Callsign"),name=screen.getByLabelText("Name");
  expect((document.querySelector(".contest-surface-main-fields") as HTMLElement).style.getPropertyValue("--contest-entry-field-columns"))
    .toBe("minmax(140px,1.6fr) repeat(2,minmax(64px,1fr))");
  expect(screen.getByText("Member No./SPC", { selector: ".contest-field-label" }).getAttribute("title")).toBe("Member No./SPC");
  expect(screen.queryByLabelText("Sent exchange")).toBeNull();
  fireEvent.change(callsign,{target:{value:"K"}});await waitFor(()=>expect(actions).toHaveLength(1));
  current={...current,projection:{...current.projection,busy:true}};await act(async()=>{native.wake!();});
  expect((callsign as HTMLInputElement).disabled).toBe(false);expect((name as HTMLInputElement).disabled).toBe(false);
  expect((callsign as HTMLInputElement).value).toBe("K");fireEvent.change(callsign,{target:{value:"K2XYZ"}});
  fireEvent.keyDown(callsign,{key:"Tab"});expect(document.activeElement).toBe(name);
  expect((callsign as HTMLInputElement).value).toBe("K2XYZ");
  expect(document.activeElement).toBe(name);
});

it("flushes true multi-keystroke callsign and exchange intent before detached Enter and waits for terminal receipts",async()=>{
  const operator={output:"simulation-only",outputAvailable:true,outputUnavailableReason:null,armed:true,style:"search-and-pounce",status:"armed",pending:null,focusedField:"callsign",...tabMaps,
    functionKeys:[{key:"F1",macro:"CQ",highlighted:false}],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]};
  let current:any={...snapshot,projection:{...projection,schemaVersion:2,
    draft:{...projection.draft,receivedFields:[{...projection.draft.receivedFields[0],id:"other_2"}]},
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
  fireEvent.change(exchange,{target:{value:"14"}});fireEvent.change(exchange,{target:{value:"15"}});fireEvent.keyDown(exchange,{key:"Enter"});
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
    params:{draftID:"draft-1",expectedDraftRevision:7,fieldID:"other_2",value:"15"}});
  current={...current,projectionRevision:9,projection:{...current.projection,draft:{...current.projection.draft,revision:8,
    receivedFields:[{...current.projection.draft.receivedFields[0],value:"15"}]}},
    receipts:[{requestID:actions[2].requestID,status:"applied",message:null,projectionRevision:9}]};await act(async()=>{native.wake!();});
  await waitFor(()=>expect(actions).toHaveLength(4));expect(actions[3]).toMatchObject({projectionRevision:9,action:"entry_operator_key",
    params:{draftID:"draft-1",expectedDraftRevision:8,key:"Enter",focusedField:"other_2"}});
  expect(actions.filter(item=>item.action==="entry_operator_key")).toHaveLength(1);
});

it("does not replay a field action when its reply is lost",async()=>{
  let snapshots=0,actions=0;
  native.invoke.mockImplementation(async(command:string)=>{
    if(command==="contest_surface_snapshot"){snapshots+=1;return snapshot;}
    if(command==="contest_surface_action"){actions+=1;throw new Error("IPC reply lost");}
    throw new Error(`unexpected ${command}`);
  });
  render(<DetachedContestSurface/>);const callsign=await screen.findByLabelText("Callsign");
  fireEvent.change(callsign,{target:{value:"K1ABC"}});
  await waitFor(()=>expect(actions).toBe(1));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent","IPC reply lost");
  expect(actions).toBe(1); expect(snapshots).toBeGreaterThanOrEqual(2);
});

it("keeps a failed presentation edit local without leaking reconciliation controls",async()=>{
  let actions=0;native.invoke.mockImplementation(async(command:string)=>{
    if(command==="contest_surface_snapshot")return snapshot;
    if(command==="contest_surface_action"){actions+=1;throw new Error("pre-submit IPC failure");}
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);const input=await screen.findByLabelText("Callsign");
  fireEvent.change(input,{target:{value:"K1ABC"}});await waitFor(()=>expect(actions).toBe(1));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent","pre-submit IPC failure");
  expect((input as HTMLInputElement).value).toBe("K1ABC");expect(actions).toBe(1);
  await act(async()=>{native.wake!();});expect(actions).toBe(1);
  expect(screen.queryByText("This edit is not confirmed.")).toBeNull();
  expect(screen.queryByRole("button",{name:"Apply edit again"})).toBeNull();
  expect(screen.queryByRole("button",{name:"Use shared value"})).toBeNull();
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

it("reconciles a queued callsign receipt that settles before its wake and restores DUPE actions",async()=>{
  let current:any={...snapshot,projection:{...projection,schemaVersion:2,session:{name:"CQ WW SSB",ruleName:"CQ WW SSB",mode:"SSB"},
    draft:{...projection.draft,callsign:"",sentReport:"59",receivedReport:"59",frequencyHz:7_115_000,frequencyText:"7115000",frequencyError:"",
      band:"40m",mode:"SSB",dupe:{state:"clear",reason:"Clear for this contest."},
      receivedFields:[{id:"other_2",label:"CQ Zone",value:"14",required:true,maximumUTF8Bytes:2}]},
    descriptor:{bands:["40m"],modes:["SSB"],advanceOnSpace:["callsign"],spaceNext:{callsign:"other_2"},sentFields:[],
      serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},operator:null}};
  const actions:Record<string,any>[]=[];
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return structuredClone(current);
    if(command==="contest_surface_action"){
      actions.push(args);
      current={...current,projectionRevision:7,receipts:[{requestID:args.requestID,status:"applied",message:null,projectionRevision:7}],
        projection:{...current.projection,draft:{...current.projection.draft,revision:6,callsign:args.params.value,
          dupe:{state:"duplicate",reason:"Worked at 02:06 UTC."}}}};
      // Deliberately omit a wake: the terminal receipt became visible in the
      // narrow queued/waiter race that previously left Main Logging stuck.
      return{requestID:args.requestID,status:"queued"};
    }
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);const callsign=await screen.findByLabelText("Callsign");
  fireEvent.change(callsign,{target:{value:"DL3A"}});fireEvent.change(callsign,{target:{value:"DL3AO"}});
  expect(await screen.findByText("Checking — DL3AO")).toBeTruthy();
  expect(await screen.findByText("DUPE — DL3AO already worked on 40m")).toBeTruthy();
  expect(actions).toHaveLength(1);expect(actions[0]).toMatchObject({action:"entry_set_text",params:{value:"DL3AO"}});
  expect(screen.getByRole("button",{name:/^Log It/})).toHaveProperty("disabled",false);
});

it("submits Escape outside a blocked edit queue without replaying either action",async()=>{
  const operator={output:"simulation-only",outputAvailable:true,outputUnavailableReason:null,armed:true,style:"run",status:"armed",pending:null,focusedField:"callsign",...tabMaps,
    functionKeys:[{key:"F1",macro:"CQ",highlighted:false}],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]};
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

it("admits only Escape across benign refresh churn",async()=>{
  const operator={output:"simulation-only",outputAvailable:true,outputUnavailableReason:null,armed:true,style:"run",status:"armed",pending:null,focusedField:"callsign",...tabMaps,
    functionKeys:[],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]};
  const base:any={...snapshot,projection:{...projection,schemaVersion:2,
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},operator}};
  let reads=0;const actions:Record<string,any>[]=[];native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot"){reads+=1;return structuredClone(reads>=4?{...base,projectionRevision:7,
      projection:{...base.projection,draft:{...base.projection.draft,revision:6}}}:base);}
    if(command==="contest_surface_action"){actions.push(args);return {requestID:args.requestID,status:"queued"};}throw new Error(command);
  });
  const view=render(<DetachedContestSurface/>),callsign=await screen.findByLabelText("Callsign");fireEvent.keyDown(callsign,{key:"Escape"});
  await waitFor(()=>expect(actions).toHaveLength(1));expect(actions[0]).toMatchObject({projectionRevision:6,action:"entry_operator_key",params:{key:"Escape",expectedDraftRevision:5}});
  view.unmount();reads=0;actions.length=0;render(<DetachedContestSurface/>);const ordinary=await screen.findByLabelText("Callsign");fireEvent.keyDown(ordinary,{key:"Enter"});
  await waitFor(()=>expect(reads).toBeGreaterThanOrEqual(4));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent","The shared contest panel changed before this action could be applied.");expect(actions).toHaveLength(0);
});

it("does not silently rebase a control action after another surface revision wins",async()=>{
  const operator={output:"simulation-only",outputAvailable:true,outputUnavailableReason:null,armed:false,style:"run",status:"disarmed",pending:null,focusedField:"callsign",...tabMaps,
    functionKeys:[],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]};
  let current:any={...snapshot,projection:{...projection,schemaVersion:2,
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},operator}};
  const actions:Record<string,any>[]=[],diagnostics:Record<string,string>[]=[];native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return structuredClone(current);
    if(command==="contest_surface_action"){actions.push(args);return {requestID:args.requestID,status:"queued"};}
    if(command==="contest_surface_diagnostic_report"){diagnostics.push(args);return;}throw new Error(command);
  });
  render(<DetachedContestSurface/>);const callsign=await screen.findByLabelText("Callsign");
  fireEvent.change(callsign,{target:{value:"K"}});await waitFor(()=>expect(actions).toHaveLength(1));
  fireEvent.click(screen.getByRole("radio",{name:"S&P"}));
  current={...current,projectionRevision:7,projection:{...current.projection,draft:{...current.projection.draft,revision:6,callsign:"K"}},
    receipts:[{requestID:actions[0].requestID,status:"applied",message:null,projectionRevision:7}]};await act(async()=>{native.wake!();});
  expect(await screen.findByRole("alert")).toHaveProperty("textContent","The shared contest panel changed before this action could be applied.");
  expect(actions).toHaveLength(1);
  await waitFor(()=>expect(diagnostics).toContainEqual(expect.objectContaining({kind:"error",
    message:"The shared contest panel changed before this action could be applied."})));
});

it("admits Enter after same-value sibling revision churn",async()=>{
  const operator={output:"simulation-only",outputAvailable:true,outputUnavailableReason:null,armed:true,style:"search-and-pounce",status:"armed",pending:null,focusedField:"callsign",...tabMaps,
    functionKeys:[],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]};
  let current:any={...snapshot,projection:{...projection,schemaVersion:2,
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},operator}};
  const actions:Record<string,any>[]=[];native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return structuredClone(current);
    if(command==="contest_surface_action"){actions.push(args);return {requestID:args.requestID,status:"queued"};}throw new Error(command);
  });
  render(<DetachedContestSurface/>);const callsign=await screen.findByLabelText("Callsign");
  current={...current,projectionRevision:7,projection:{...current.projection,draft:{...current.projection.draft,revision:6}}};
  fireEvent.keyDown(callsign,{key:"Enter"});
  await waitFor(()=>expect(actions).toHaveLength(1));
  expect(actions[0]).toMatchObject({projectionRevision:7,action:"entry_operator_key",
    params:{draftID:"draft-1",expectedDraftRevision:6,key:"Enter",focusedField:"callsign"}});
});

it("accepts Enter when an already-running flush had partly completed before key capture",async()=>{
  const operator={output:"simulation-only",outputAvailable:true,outputUnavailableReason:null,armed:true,style:"search-and-pounce",status:"armed",pending:null,focusedField:"callsign",...tabMaps,
    functionKeys:[],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]};
  let current:any={...snapshot,projection:{...projection,schemaVersion:2,
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},operator}};
  const actions:Record<string,any>[]=[];native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return structuredClone(current);
    if(command==="contest_surface_action"){actions.push(args);return {requestID:args.requestID,status:"queued"};}throw new Error(command);
  });
  render(<DetachedContestSurface/>);const callsign=await screen.findByLabelText("Callsign");
  fireEvent.change(callsign,{target:{value:"K"}});await waitFor(()=>expect(actions).toHaveLength(1));
  fireEvent.change(callsign,{target:{value:"K1ABC"}});
  current={...current,projectionRevision:7,projection:{...current.projection,draft:{...current.projection.draft,revision:6,callsign:"K"}},
    receipts:[{requestID:actions[0].requestID,status:"applied",message:null,projectionRevision:7}]};await act(async()=>{native.wake!();});
  await waitFor(()=>expect(actions).toHaveLength(2));fireEvent.keyDown(callsign,{key:"Enter"});
  current={...current,projectionRevision:8,projection:{...current.projection,draft:{...current.projection.draft,revision:7,callsign:"K1ABC"}},
    receipts:[{requestID:actions[1].requestID,status:"applied",message:null,projectionRevision:8}]};await act(async()=>{native.wake!();});
  await waitFor(()=>expect(actions).toHaveLength(3));expect(actions[2]).toMatchObject({projectionRevision:8,action:"entry_operator_key",
    params:{expectedDraftRevision:7,key:"Enter"}});
});

it("ignores repeated, composing, prevented, and modified detached operator keys",async()=>{
  const operator={output:"simulation-only",outputAvailable:true,outputUnavailableReason:null,armed:true,style:"run",status:"armed",pending:null,focusedField:"callsign",...tabMaps,
    functionKeys:[{key:"F1",macro:"CQ",highlighted:false}],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]};
  const current:any={...snapshot,projection:{...projection,schemaVersion:2,
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},operator}};
  const actions:Record<string,any>[]=[];native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return structuredClone(current);
    if(command==="contest_surface_action"){actions.push(args);return {requestID:args.requestID,status:"queued"};}throw new Error(command);
  });
  render(<DetachedContestSurface/>);const callsign=await screen.findByLabelText("Callsign");
  fireEvent.keyDown(callsign,{key:"Enter",repeat:true});fireEvent.keyDown(callsign,{key:"Enter",isComposing:true});
  for(const modifier of ["altKey","ctrlKey","metaKey"])
    fireEvent.keyDown(callsign,{key:"F1",[modifier]:true});
  const prevented=new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true});prevented.preventDefault();callsign.dispatchEvent(prevented);
  await act(async()=>{await Promise.resolve();});expect(actions).toHaveLength(0);
});

it("admits Shift-F1 as Auto CQ from the detached Main Logging window",async()=>{
  const operator={output:"simulation-only",outputAvailable:true,outputUnavailableReason:null,armed:true,style:"run",status:"armed",pending:null,focusedField:"callsign",...tabMaps,
    functionKeys:[{key:"F1",macro:"CQ",highlighted:false}],autoCQ:{active:true,delaySeconds:15,remainingMs:7500},
    readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]};
  const current:any={...snapshot,projection:{...projection,schemaVersion:2,
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},operator}};
  const actions:Record<string,any>[]=[];native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return structuredClone(current);
    if(command==="contest_surface_action"){actions.push(args);return {requestID:args.requestID,status:"queued"};}throw new Error(command);
  });
  render(<DetachedContestSurface/>);const callsign=await screen.findByLabelText("Callsign");
  expect(screen.getByText("Auto CQ")).toBeTruthy();
  expect(screen.getByLabelText("Auto CQ countdown").getAttribute("value")).toBe("7500");
  fireEvent.keyDown(callsign,{key:"F1",shiftKey:true});
  await waitFor(()=>expect(actions).toHaveLength(1));
  expect(actions[0]).toMatchObject({action:"entry_operator_key",params:{key:"F1",focusedField:"callsign",shifted:true}});
});

it("carries delayed multi-field typing through the real owner drain before one Enter intent",async()=>{
  const initial:any={...projection,schemaVersion:2,draft:{...projection.draft,callsign:"",receivedFields:[{...projection.draft.receivedFields[0],value:""}],frequencyError:""},
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},
    operator:{output:"simulation-only",outputAvailable:true,outputUnavailableReason:null,armed:true,style:"search-and-pounce",status:"armed",pending:null,focusedField:"callsign",...tabMaps,
      functionKeys:[],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]}};
  let bridgeProjection:any=initial,bridgeRevision=1,receipts:any[]=[],releaseFirst!:()=>void,firstStarted!:()=>void;
  const firstStart=new Promise<void>(resolve=>{firstStarted=resolve;}),firstGate=new Promise<void>(resolve=>{releaseFirst=resolve;}),
    queue:ContestSurfaceActionEnvelope[]=[],keys:string[]=[];
  const unavailable=()=>Object.fromEntries(contestSurfacePanelIDs.map(id=>[id,{schemaVersion:1,status:"unavailable"}])) as
    Record<(typeof contestSurfacePanelIDs)[number],ContestSurfaceProjection>;
  function Owner(){const [entry,setEntry]=useState<ContestEntrySurfaceProjection>(initial);const projections=useMemo(()=>
      ({...unavailable(),"active-qso":entry}),[entry]);
    useContestSurfaceOwner({context:{operatingContext,sessionID,workspaceGeneration},projections,report:vi.fn(),handle:async action=>{
      if(action.action==="entry_set_text"&&action.params.field==="callsign"&&action.params.value===" k"){firstStarted();await firstGate;}
      if(action.action==="entry_operator_key"){keys.push(action.params.key);return;}
      setEntry(previous=>{if(previous.status!=="ready")return previous;const draft={...previous.draft};
        if(action.action==="entry_set_text"&&action.params.field==="callsign")draft.callsign=action.params.value.trim().toUpperCase();
        if(action.action==="entry_set_exchange")draft.receivedFields=draft.receivedFields.map(field=>field.id===action.params.fieldID?{...field,value:action.params.value}:field);
        draft.revision+=1;return {...previous,draft};});await new Promise(resolve=>window.setTimeout(resolve,0));
    }});return null;}
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_owner_claim")return {ownerEpoch:args.ownerEpoch,projectionRevision:bridgeRevision};
    if(command==="contest_surface_publish"){if(args.panelID==="active-qso"){bridgeProjection=structuredClone(args.projection);bridgeRevision=args.projectionRevision;}return;}
    if(command==="contest_surface_snapshot")return {operatingContext,scope:"contesting",sessionID,workspaceGeneration,panelID:"active-qso",
      projectionRevision:bridgeRevision,projection:structuredClone(bridgeProjection),receipts:structuredClone(receipts)};
    if(command==="contest_surface_action"){queue.push(args as ContestSurfaceActionEnvelope);receipts=[{requestID:args.requestID,status:"queued",message:null,projectionRevision:bridgeRevision}];
      queueMicrotask(()=>native.wake?.());return {requestID:args.requestID,status:"queued"};}
    if(command==="contest_surface_action_next"){const action=queue.shift()??null;if(action){receipts=[{requestID:action.requestID,status:"uncertain",message:null,projectionRevision:bridgeRevision}];
      queueMicrotask(()=>native.wake?.());}return action;}
    if(command==="contest_surface_escape_next")return null;
    if(command==="contest_surface_action_complete"){receipts=[{requestID:args.requestID,status:args.outcome,message:args.message??null,projectionRevision:args.projectionRevision}];
      queueMicrotask(()=>native.wake?.());return;}
    if(command==="contest_surface_context_close")return;throw new Error(command);
  });
  render(<><Owner/><DetachedContestSurface/></>);const callsign=await screen.findByLabelText("Callsign"),exchange=screen.getByLabelText("Power");
  await waitFor(()=>expect(native.wakes.length).toBeGreaterThanOrEqual(2));
  fireEvent.change(callsign,{target:{value:" k"}});await firstStart;
  fireEvent.change(callsign,{target:{value:" k1"}});fireEvent.change(callsign,{target:{value:" k1abc "}});exchange.focus();
  fireEvent.change(exchange,{target:{value:"14"}});fireEvent.change(exchange,{target:{value:"15"}});fireEvent.keyDown(exchange,{key:"Enter"});
  expect(keys).toEqual([]);releaseFirst();await waitFor(()=>expect(keys).toEqual(["Enter"]),{timeout:5000});
  await waitFor(()=>{expect(bridgeProjection.draft.callsign).toBe("K1ABC");expect(bridgeProjection.draft.receivedFields[0].value).toBe("15");});
});

it("preserves the latest rapid log edit and resets the presentation buffer when the owner switches contacts",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=edit-contact"));
  const editing=(qsoID:string,callsign:string)=>({qsoID,callsign,workedAt:"2026-10-19T10:00:00Z",operator:"OM0RX",name:"",qth:"",comment:"",band:"20m",mode:"CW",sentReport:"599",receivedReport:"599",receivedFields:[],
    frequencyHz:14_025_000,editFrequencyText:"14025000",frequencyError:"",correctionReason:"Operator correction",confirmDelete:false,deletionReason:"Operator deletion"});
  let current:any={...snapshot,panelID:"logbook",projectionRevision:3,projection:{schemaVersion:1,status:"ready",sessionRevision:8,canExportCabrillo:true,
    page:{offset:0,limit:20,total:2,rows:[]},editing:editing("qso-1","K1ABC"),busy:false},receipts:[]};const actions:Record<string,any>[]=[];
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return structuredClone(current);
    if(command==="contest_surface_action"){actions.push(args);return {requestID:args.requestID,status:"queued"};}
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);const input=await screen.findByLabelText("Callsign");
  fireEvent.change(input,{target:{value:"W"}});fireEvent.change(input,{target:{value:"W1"}});fireEvent.change(input,{target:{value:"W1AW"}});
  expect((input as HTMLInputElement).value).toBe("W1AW");await waitFor(()=>expect(actions).toHaveLength(1));
  let nextReceipt=0,ownerRevision=4;
  while(actions.at(-1)?.params.value!=="W1AW"&&nextReceipt<3){
    const pending=actions[nextReceipt];expect(pending).toBeTruthy();
    current={...current,projectionRevision:ownerRevision,projection:{...current.projection,editing:editing("qso-1",pending.params.value)},
      receipts:[{requestID:pending.requestID,status:"applied",message:null,projectionRevision:ownerRevision}]};await act(async()=>{native.wake!();});
    expect((input as HTMLInputElement).value).toBe("W1AW");
    nextReceipt+=1;if(actions.at(-1)?.params.value!=="W1AW")await waitFor(()=>expect(actions.length).toBeGreaterThan(nextReceipt));
    expect(actions[nextReceipt]).toMatchObject({projectionRevision:ownerRevision,action:"log_edit_set_text",params:{qsoID:"qso-1"}});ownerRevision+=1;
  }
  expect(actions.length).toBeLessThanOrEqual(3);expect(actions.at(-1)).toMatchObject({params:{qsoID:"qso-1",value:"W1AW"}});
  current={...current,projectionRevision:ownerRevision,projection:{...current.projection,editing:editing("qso-2","VE3XYZ")},receipts:[]};await act(async()=>{native.wake!();});
  await waitFor(()=>expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("VE3XYZ"));
});

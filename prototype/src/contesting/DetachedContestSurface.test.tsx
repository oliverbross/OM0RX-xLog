// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { useMemo, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DetachedContestSurface } from "./DetachedContestSurface";
import { loadWindowSurface } from "../windowSurface";
import { contestSurfacePanelIDs, type ContestEntrySurfaceProjection, type ContestSurfaceActionEnvelope,
  type ContestSurfaceProjection, validContestSurfaceProjection } from "./contestSurfaceProtocol";
import { useContestSurfaceOwner } from "./useContestSurfaceOwner";

const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), wake: null as null|(()=>void),wakes:[] as (()=>void)[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: Record<string, any>) =>
    native.invoke(command, command === "contest_surface_action" ? args.envelope : args),
  isTauri: () => true,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));

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
  continent:"EU",cqZone:14,ituZone:28,callStatus:"New",dxccStatus:"New",workedBefore:null,specialTags:[],score:80,
  scoreReasons:[],aggregateCount:1,aggregateSpotters:["K1ABC"],source:"DX Cluster",statusHex:"",bandHex:"",modeHex:""};
const tabMaps={tabNext:{callsign:"sent",sent:"receive",receive:"other_1",other_1:"other_2",other_2:"callsign"},
  tabPrevious:{callsign:"other_2",sent:"callsign",receive:"sent",other_1:"receive",other_2:"other_1"}} as const;

beforeEach(()=>{vi.resetAllMocks();native.wake=null;native.wakes=[];native.listen.mockImplementation(async(_name,callback)=>{native.wakes.push(callback);
  native.wake=()=>native.wakes.forEach(wake=>wake());return()=>{native.wakes=native.wakes.filter(wake=>wake!==callback);};});window.history.replaceState({},"",search);});
afterEach(()=>{cleanup();window.history.replaceState({},"","/");});

it("renders validated manual main context without manufacturing headings or distance",async()=>{
  const manual={operator:"OM0RX/P",cwSpeedWpm:27,country:"Germany",cqZone:14,ituZone:28,
    headingDegrees:null,longPathHeadingDegrees:null,distanceKm:null,qsos:42,multipliers:17,total:2142};
  const view={...projection,manual};
  expect(validContestSurfaceProjection("active-qso",view)).toBe(true);
  expect(validContestSurfaceProjection("active-qso",{...view,manual:{...manual,distanceKm:"unknown"}})).toBe(false);
  native.invoke.mockResolvedValue({...snapshot,projection:view});render(<DetachedContestSurface/>);
  expect(await screen.findByLabelText("Current operator")).toHaveProperty("textContent","OP OM0RX/P");
  expect(screen.getByLabelText("Country and zones").textContent).toBe("Germany cq:14 itu:28");
  expect(screen.getByLabelText("Current CW speed").textContent).toBe("27");
  expect(screen.getByLabelText("Contact heading, long path and distance").textContent).toContain("—° Hdg · LP —° / distance — km");
  expect(screen.getByLabelText("QSOs, multipliers and score").textContent).toBe("42/17 2142");
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

it("allows the compact Statistics table to fit the supported 400px window minimum", () => {
  const css = readFileSync(`${process.cwd()}/src/contesting/DetachedContestSurface.css`, "utf8");
  expect(css).toContain(".contest-surface-statistics-scroll { flex:1; width:100%; min-width:0; min-height:0; overflow:auto;");
  expect(css).toContain(".contest-surface-statistics-v3 table { width:100%; min-width:0;");
  expect(css).not.toContain(".contest-surface-statistics-v3 table { width:100%; min-width:430px;");
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
});

it("retains manual Reserve serial for legacy detached entries",async()=>{
  const view={...projection,schemaVersion:2,draft:{...projection.draft,reservedSerial:3},
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[{id:"serial",label:"Serial",value:"003",required:true,maximumUTF8Bytes:32}],
      serial:{requirement:"requiredForCommit",allocatedFieldID:"serial",reservedSerial:3}},operator:null};
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>command==="contest_surface_snapshot"
    ? {...snapshot,projection:view}:{requestID:args.requestID,status:"queued"});
  render(<DetachedContestSurface/>);fireEvent.click(await screen.findByRole("button",{name:"Reserve serial",hidden:true}));
  await waitFor(()=>expect(native.invoke.mock.calls.find(([command])=>command==="contest_surface_action")?.[1]).toMatchObject({
    panelID:"active-qso",action:"entry_reserve_serial",params:{draftID:"draft-1",expectedDraftRevision:5}}));
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
  expect(screen.getByText(`Duplicate: ${reason}`)).toBeTruthy();
  expect((screen.getByRole("button",{name:"Log QSO",hidden:true}) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByRole("button",{name:"Reserve serial",hidden:true})).toBeNull();
  expect(screen.getByLabelText("Current band and mode").textContent).toBe("CW1608040");
});

it.each(["legacy", "manual", "plugin"])("lets the %s log use the full pane when partial matches are empty",async layout=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=logbook"));
  const row={qsoID:"logged-qso",workedAt:"2026-10-20T12:00:00.000Z",callsign:"K1ABC",band:"20m",mode:"CW",
    sentExchange:"599",receivedExchange:"599",points:2,multiplierLabels:[]};
  const view={schemaVersion:1,status:"ready",sessionRevision:1,canExportCabrillo:true,
    page:{offset:0,limit:20,total:1,rows:[row]},editing:null,busy:false,
    ...(layout==="plugin"?{exchangeLayout:"plugin",pluginColumns:["Call"],pluginRows:[{qsoID:row.qsoID,values:[row.callsign]}],pluginPartialRows:[]}
      :layout==="manual"?{manualRows:[{qsoID:row.qsoID,TS:"2026-10-20 12:00:00",Call:row.callsign,Freq:"14025",SNT:"599",RCV:"599",ZN:"5",SentNr:"1",prefix:"K1",Points:"2"}],partialRows:[]}:{})};
  expect(validContestSurfaceProjection("logbook",view)).toBe(true);
  native.invoke.mockResolvedValue({...snapshot,panelID:"logbook",projection:view});render(<DetachedContestSurface/>);
  expect(await screen.findByRole("table",{name:"Contest log"})).toBeTruthy();
  expect(screen.getByRole("button",{name:"K1ABC"})).toBeTruthy();
  expect(screen.queryByRole("table",{name:"Callsign partial matches"})).toBeNull();
  expect(document.querySelectorAll(".contest-surface-log-scroll")).toHaveLength(1);
});

it("renders authoritative raw DXLOG values in the log and full-log partial table",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=logbook"));
  const row={qsoID:"outside-current-page",TS:"2026-10-19 01:02:03",Call:"DL1ABC",Freq:"14025.125",SNT:"579",RCV:"589",ZN:"14",SentNr:"15",prefix:"DL1",Points:"3"};
  const view={schemaVersion:1,status:"ready",sessionRevision:1,canExportCabrillo:true,page:{offset:0,limit:20,total:1,rows:[]},manualRows:[row],partialRows:[row],editing:null,busy:false};
  expect(validContestSurfaceProjection("logbook",view)).toBe(true);
  expect(validContestSurfaceProjection("logbook",{...view,partialRows:[{...row,Freq:14025}]})).toBe(false);
  native.invoke.mockResolvedValue({...snapshot,panelID:"logbook",projection:view});render(<DetachedContestSurface/>);
  await screen.findByRole("heading",{name:"Log Display"});
  for(const name of ["Contest log","Callsign partial matches"])
    expect(Array.from(screen.getByRole("table",{name}).querySelectorAll("tbody td")).map(cell=>cell.textContent)).toEqual([row.TS,row.Call,row.Freq,row.SNT,row.RCV,row.ZN,row.SentNr,row.prefix,row.Points]);
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

it("routes Cabrillo export from the detached Log window to its contest owner",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=logbook"));
  const view={schemaVersion:1,status:"ready",sessionRevision:1,canExportCabrillo:true,
    page:{offset:0,limit:20,total:0,rows:[]},editing:null,busy:false};
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>command==="contest_surface_snapshot"?
    {...snapshot,panelID:"logbook",projection:view}:{requestID:args.requestID,status:"queued"});
  render(<DetachedContestSurface/>);
  fireEvent.click(await screen.findByRole("button",{name:"Export Cabrillo…"}));
  await waitFor(()=>expect(native.invoke.mock.calls.find(([command])=>command==="contest_surface_action")?.[1]).toMatchObject({
    panelID:"logbook",projectionRevision:6,action:"log_export_cabrillo",params:{},
  }));
});

it("uses supplied full-log and cluster calls in their manual Check Partial columns",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=callsign-intelligence"));
  const view={schemaVersion:1,status:"ready",draftID:"draft-1",draftRevision:5,inputCallsign:"DL1",loggedCalls:["DL1ABC"],clusterCalls:["DL1XYZ"],scp:{source:null,candidates:[]},history:{source:null,rows:[]},busy:false};
  expect(validContestSurfaceProjection("callsign-intelligence",view)).toBe(true);
  native.invoke.mockResolvedValue({...snapshot,panelID:"callsign-intelligence",projection:view});render(<DetachedContestSurface/>);
  await screen.findByRole("heading",{name:"Check Partial"});
  expect(screen.getByRole("heading",{name:"Log"}).parentElement?.textContent).toBe("LogDL1ABC");
  expect(screen.getByRole("heading",{name:"Telnet"}).parentElement?.textContent).toBe("TelnetDL1XYZ");
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
  const view={schemaVersion:1,status:"ready",draftID:"draft-1",draftRevision:5,radioFrequencyHz:14_025_000,
    connectedClusters:1,loadedSpots:25,spots:[sharedSpot],busy:false};
  native.invoke.mockImplementation(async(command,args)=>command==="contest_surface_snapshot"?{...snapshot,panelID,projection:view}:
    command==="contest_surface_action"?{requestID:args.requestID,status:"queued"}:Promise.reject(new Error(`unexpected ${command}`)));
  render(<DetachedContestSurface/>);
  const callsign=await screen.findByText("DL1ABC");
  if(panelID==="dx-cluster"){
    expect(screen.getByText("1 live · 1 shown / 25 received")).toBeTruthy();
    expect(screen.queryByLabelText("Spot filters")).toBeNull();
    expect(screen.queryByRole("button",{name:/^(Connect|Disconnect|Refresh|Console|Settings)$/})).toBeNull();
  }
  fireEvent.click(panelID==="dx-cluster" ? callsign.closest("tr")! : callsign.closest("button")!);
  await waitFor(()=>expect(native.invoke.mock.calls.find(([command])=>command==="contest_surface_action")?.[1]).toMatchObject({
    panelID,projectionRevision:6,action:"spot_select",params:{draftID:"draft-1",expectedDraftRevision:5,spotID:"spot-1"}}));
  expect(native.invoke.mock.calls.some(([command])=>command==="activate_spot")).toBe(false);
  expect(localStorage.getItem("xlog.integration.bandMaps.workspace.bands")).toBe("normal-band-map-sentinel");
  expect(localStorage.getItem("xlog.integration.full-cluster-columns.v1")).toBe("normal-cluster-sentinel");
  if(panelID==="band-maps")expect(document.querySelector(".band-maps-compact")).not.toBeNull();
  await waitFor(()=>expect(localStorage.getItem(panelID==="band-maps"
    ? "xlog.integration.bandMaps.contest.bands":"xlog.integration.contest.cluster-columns.v1")).not.toBeNull());
});

it.each(["band-maps", "monitor", "alerts", "awards", "chaser-dx", "rotor", "station-control", "dx-cluster"])(
  "keeps disconnected contest %s explicitly unavailable and passive", async panelID => {
    window.history.replaceState({}, "", search.replace("view=active-qso", `view=${panelID}`));
    native.invoke.mockImplementation(async (command:string) => {
      if (command === "contest_surface_snapshot") return { ...snapshot, panelID, projection: { schemaVersion:1, status:"unavailable" } };
      throw new Error(`unexpected ${command}`);
    });
    render(<DetachedContestSurface/>);
    expect(await screen.findByRole("heading", { name:"Panel unavailable" })).toBeTruthy();
    expect(screen.getByText("This shared contest panel is not connected yet.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(native.invoke.mock.calls.every(([command]) => command === "contest_surface_snapshot")).toBe(true);
  });

it("renders exact owner Rates independently of the current log page and refreshes on wake", async () => {
  window.history.replaceState({}, "", search.replace("view=active-qso", "view=monitor"));
  let rates = { schemaVersion: 1, status: "ready", lastHourQsoPerHour: 48, last10QsoPerHour: 72.5,
    last100QsoPerHour: null, sinceHourUTC: 19, sinceHourQso: 2, runQso: 210, searchAndPounceQso: 70,
    hourRunQso: 30, hourSearchAndPounceQso: 18, busy: false };
  native.invoke.mockImplementation(async (command: string) => {
    if (command === "contest_surface_snapshot") return { ...snapshot, panelID: "monitor", projection: rates };
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);
  expect(await screen.findByRole("heading", { name: "Rates" })).toBeTruthy();
  expect(screen.getByText("72.5")).toBeTruthy();
  expect(screen.getByText("Since 19:00:00z:")).toBeTruthy();
  expect(screen.getByText("QSO")).toBeTruthy();
  expect(screen.getByLabelText("Not enough contacts")).toBeTruthy();
  expect(screen.getByRole("table", { name: "Run and Search & Pounce QSOs" }).textContent).toContain("210");
  rates = { ...rates, runQso: 211 };
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
    expect(screen.getByText("1 worked")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(native.invoke.mock.calls.every(([command]) => command === "contest_surface_snapshot")).toBe(true);
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
    expect(screen.getByText("0 worked")).toBeTruthy();
    expect(screen.queryAllByRole("rowheader")).toHaveLength(0);
    expect(screen.queryByText("Panel unavailable")).toBeNull();
    expect(native.invoke.mock.calls.every(([command]) => command === "contest_surface_snapshot")).toBe(true);
  });

it("renders the owner projection and forwards raw edits with exact revision fencing",async()=>{
  native.invoke.mockImplementation(async(command:string,args:Record<string,unknown>)=>{
    if(command==="contest_surface_snapshot")return snapshot;
    if(command==="contest_surface_action")return {requestID:args.requestID,status:"applied",projectionRevision:6};
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
  const v2={...snapshot,projection:{...projection,schemaVersion:2,draft:{...projection.draft,frequencyHz:14025000},
    descriptor:{bands:["20m","40m"],modes:["CW"],sentFields:[{id:"power",label:"Power",value:"100",required:true,maximumUTF8Bytes:4}],
      serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},
    operator:{output:"simulation-only",armed:false,style:"run",status:"disarmed",pending:null,focusedField:"callsign",...tabMaps,
      functionKeys:[{key:"F1",macro:"CQ"}],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},
      trace:[{operationID:"simulation-1",mode:"CW",macro:"CQ",text:"CQ OM0RX",status:"confirmed"}]}}};
  native.invoke.mockImplementation(async(command:string,args:Record<string,unknown>)=>{
    if(command==="contest_surface_snapshot")return v2;
    if(command==="contest_surface_action")return {requestID:args.requestID,status:"queued"};
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);expect(await screen.findByText("CQ OM0RX")).toBeTruthy();
  expect(screen.getByRole("region",{name:"Main Logging"})).toBeTruthy();
  expect(screen.getByLabelText("Current frequency").textContent).toBe("14,025.00 kHz");
  expect(screen.getByRole("group",{name:"Function key macros"}).querySelectorAll("button")).toHaveLength(12);
  expect(screen.getByLabelText("Current band and mode").textContent).toBe("CW2040");
  expect(screen.getByLabelText("Sent exchange")).toHaveProperty("value","100");
  expect(screen.getByLabelText("CW speed unavailable").textContent).toBe("—");
  expect((screen.getByLabelText("Increase CW speed") as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByLabelText("QSOs, multipliers and score").textContent).toBe("—/— —");
  expect(Array.from(document.querySelectorAll(".contest-surface-main-fields > *")).map(field=>field.querySelector("label")?.firstChild?.textContent??field.firstChild?.textContent))
    .toEqual(["Callsign","SNT","RCV","Power","RcvNR"]);
  expect(screen.getAllByRole("radio").map(input=>input.parentElement?.textContent)).toEqual(["Run","S&P"]);
  expect(screen.queryByLabelText("Operating style")).toBeNull();
  expect(document.querySelector(".contest-surface-entry > footer")).toBeNull();
  const options=document.querySelector(".contest-surface-entry-options") as HTMLDetailsElement;
  expect(options.open).toBe(false);
  expect(options.querySelector("footer")?.textContent).toBe("Log QSO");
  expect(screen.queryByRole("button",{name:"Reserve serial",hidden:true})).toBeNull();
    expect(screen.getByRole("group",{name:"Function key macros"}).textContent).toContain("F1: CQ");
  expect((screen.getByRole("button",{name:"F12 Unassigned"}) as HTMLButtonElement).disabled).toBe(true);
  expect(document.querySelector("canvas")).toBeNull();
  fireEvent.click(screen.getByRole("radio",{name:"S&P"}));
  await waitFor(()=>expect(native.invoke.mock.calls.some(([command,args])=>command==="contest_surface_action"&&args.action==="entry_operator_style")).toBe(true));
  expect(native.invoke.mock.calls.find(([command,args])=>command==="contest_surface_action"&&args.action==="entry_operator_style")?.[1])
    .toMatchObject({panelID:"active-qso",projectionRevision:6,params:{draftID:"draft-1",expectedDraftRevision:5,value:"search-and-pounce"}});
});

it("executes saved finite Not1MM key bindings and stops using the replaced chord",async()=>{
  const view={...snapshot,projection:{...projection,schemaVersion:2,draft:{...projection.draft,frequencyHz:14025000,frequencyError:""},
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[{id:"power",label:"Power",value:"100",required:true,maximumUTF8Bytes:4}],
      serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null},keyBindings:[
        {context:"*",key:"Alt+R",action:"TOGGLE_RUN"},{context:"Callsign",key:"Up",action:"NEXT_SPOT"}]},
    operator:{output:"simulation-only",armed:false,style:"run",status:"disarmed",pending:null,focusedField:"callsign",...tabMaps,
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

it("executes a field-context Not1MM key binding",async()=>{
  const view={...snapshot,projection:{...projection,schemaVersion:2,draft:{...projection.draft,frequencyHz:14025000,frequencyError:""},
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[{id:"power",label:"Power",value:"100",required:true,maximumUTF8Bytes:4}],
      serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null},keyBindings:[{context:"Callsign",key:"Up",action:"NEXT_SPOT"}]},
    operator:{output:"simulation-only",armed:false,style:"run",status:"disarmed",pending:null,focusedField:"callsign",...tabMaps,
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

it("retains the manual Check Partial Log, Master and Telnet columns with explicit missing sources",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=callsign-intelligence"));
  native.invoke.mockResolvedValue({...snapshot,panelID:"callsign-intelligence",projection:{schemaVersion:1,status:"ready",draftID:"draft-1",draftRevision:5,
    inputCallsign:"OM0",scp:{source:null,candidates:[{candidateID:"scp-1",callsign:"OM0RX"}]},history:{source:null,rows:[]},busy:false}});
  render(<DetachedContestSurface/>);
  await screen.findByRole("heading",{name:"Check Partial"});
  expect(["Log","Master","Telnet"].map(name=>screen.getByRole("heading",{name}).textContent)).toEqual(["Log","Master","Telnet"]);
  expect(screen.getByLabelText("Matching logged calls unavailable").textContent).toBe("—");
  expect(screen.getByLabelText("Matching cluster calls unavailable").textContent).toBe("—");
  expect(screen.getByRole("button",{name:"OM0RX"})).toBeTruthy();
});

it("retains the main log headings without an empty partial pane when the log is empty",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=logbook"));
  native.invoke.mockResolvedValue({...snapshot,panelID:"logbook",projection:{schemaVersion:1,status:"ready",sessionRevision:1,canExportCabrillo:true,
    page:{offset:0,limit:20,total:0,rows:[]},editing:null,busy:false}});
  render(<DetachedContestSurface/>);await screen.findByRole("heading",{name:"Log Display"});
  const table=screen.getByRole("table",{name:"Contest log"});
  expect(Array.from(table.querySelectorAll("th")).map(cell=>cell.textContent)).toEqual(["YYYY-MM-DD HH:MM:SS","Call","Freq","Snt","Rcv","ZN","NR","PFX","PTS"]);
  expect(screen.queryByRole("table",{name:"Callsign partial matches"})).toBeNull();
  expect(document.querySelectorAll(".contest-surface-log-scroll")).toHaveLength(1);
});

it("serializes rapid Python tab-map focus changes and sends exact report focus to ESM",async()=>{
  const operator={output:"simulation-only",armed:true,style:"run",status:"armed",pending:null,focusedField:"receive",...tabMaps,
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

it("restores authoritative callsign focus when a logged QSO creates a new draft",async()=>{
  const operator={output:"simulation-only",armed:true,style:"run",status:"armed",pending:null,focusedField:"receive",...tabMaps,
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
  const operator={output:"simulation-only",armed:true,style:"search-and-pounce",status:"armed",pending:null,focusedField:"callsign",...cwtTabs,
    functionKeys:[],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]};
  let current:any={...snapshot,projection:{...projection,schemaVersion:2,session:{name:"CWT",ruleName:"CWT",mode:"CW"},
    draft:{...projection.draft,callsign:"",receivedFields:[
      {id:"other_1",label:"Name",value:"",required:true,maximumUTF8Bytes:32},
      {id:"other_2",label:"Member No./SPC",value:"",required:true,maximumUTF8Bytes:128}]},
    descriptor:{reportsVisible:false,bands:["20m"],modes:["CW"],sentFields:[
      {id:"sent-exchange",label:"Sent exchange",value:"OLIVER",required:true,maximumUTF8Bytes:64}],
      serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},operator}};
  const actions:Record<string,any>[]=[];
  native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return structuredClone(current);
    if(command==="contest_surface_action"){actions.push(args);return {requestID:args.requestID,status:"queued"};}
    throw new Error(command);
  });
  render(<DetachedContestSurface/>);const callsign=await screen.findByLabelText("Callsign"),name=screen.getByLabelText("Name");
  expect((document.querySelector(".contest-surface-main-fields") as HTMLElement).style.getPropertyValue("--contest-entry-field-columns"))
    .toBe("minmax(130px,1.3fr) minmax(110px,.8fr) minmax(120px,1fr) minmax(120px,1fr)");
  fireEvent.change(callsign,{target:{value:"K"}});await waitFor(()=>expect(actions).toHaveLength(1));
  current={...current,projection:{...current.projection,busy:true}};await act(async()=>{native.wake!();});
  expect((callsign as HTMLInputElement).disabled).toBe(false);expect((name as HTMLInputElement).disabled).toBe(false);
  expect((callsign as HTMLInputElement).value).toBe("K");fireEvent.change(callsign,{target:{value:"K2XYZ"}});
  fireEvent.keyDown(callsign,{key:"Tab"});expect(document.activeElement).toBe(name);
  expect((callsign as HTMLInputElement).value).toBe("K2XYZ");
  expect(document.activeElement).not.toBe(screen.getByLabelText("Sent exchange"));
});

it("flushes true multi-keystroke callsign and exchange intent before detached Enter and waits for terminal receipts",async()=>{
  const operator={output:"simulation-only",armed:true,style:"search-and-pounce",status:"armed",pending:null,focusedField:"callsign",...tabMaps,
    functionKeys:[{key:"F1",macro:"CQ"}],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]};
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

it("does not replay an action when its reply is lost",async()=>{
  let snapshots=0,actions=0;
  native.invoke.mockImplementation(async(command:string)=>{
    if(command==="contest_surface_snapshot"){snapshots+=1;return snapshot;}
    if(command==="contest_surface_action"){actions+=1;throw new Error("IPC reply lost");}
    throw new Error(`unexpected ${command}`);
  });
  render(<DetachedContestSurface/>); await screen.findByRole("heading",{name:"ARRL DX"});
  fireEvent.click(screen.getByText("Entry controls"));
  fireEvent.click(screen.getByRole("button",{name:"Log QSO"}));
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
  const operator={output:"simulation-only",armed:true,style:"run",status:"armed",pending:null,focusedField:"callsign",...tabMaps,
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

it("admits only Escape across benign refresh churn",async()=>{
  const operator={output:"simulation-only",armed:true,style:"run",status:"armed",pending:null,focusedField:"callsign",...tabMaps,
    functionKeys:[],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]};
  const base:any={...snapshot,projection:{...projection,schemaVersion:2,
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},operator}};
  let reads=0;const actions:Record<string,any>[]=[];native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot"){reads+=1;return structuredClone(reads>=3?{...base,projectionRevision:7,
      projection:{...base.projection,draft:{...base.projection.draft,revision:6}}}:base);}
    if(command==="contest_surface_action"){actions.push(args);return {requestID:args.requestID,status:"queued"};}throw new Error(command);
  });
  const view=render(<DetachedContestSurface/>),callsign=await screen.findByLabelText("Callsign");fireEvent.keyDown(callsign,{key:"Escape"});
  await waitFor(()=>expect(actions).toHaveLength(1));expect(actions[0]).toMatchObject({projectionRevision:6,action:"entry_operator_key",params:{key:"Escape",expectedDraftRevision:5}});
  view.unmount();reads=0;actions.length=0;render(<DetachedContestSurface/>);const ordinary=await screen.findByLabelText("Callsign");fireEvent.keyDown(ordinary,{key:"Enter"});
  expect(await screen.findByText("The shared contest panel changed before this action could be applied.")).toBeTruthy();expect(actions).toHaveLength(0);
});

it("does not silently rebase a control action after another surface revision wins",async()=>{
  const operator={output:"simulation-only",armed:false,style:"run",status:"disarmed",pending:null,focusedField:"callsign",...tabMaps,
    functionKeys:[],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]};
  let current:any={...snapshot,projection:{...projection,schemaVersion:2,
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},operator}};
  const actions:Record<string,any>[]=[];native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return structuredClone(current);
    if(command==="contest_surface_action"){actions.push(args);return {requestID:args.requestID,status:"queued"};}throw new Error(command);
  });
  render(<DetachedContestSurface/>);const callsign=await screen.findByLabelText("Callsign");
  fireEvent.change(callsign,{target:{value:"K"}});await waitFor(()=>expect(actions).toHaveLength(1));
  fireEvent.click(screen.getByRole("radio",{name:"S&P"}));
  current={...current,projectionRevision:7,projection:{...current.projection,draft:{...current.projection.draft,revision:6,callsign:"K"}},
    receipts:[{requestID:actions[0].requestID,status:"applied",message:null,projectionRevision:7}]};await act(async()=>{native.wake!();});
  expect(await screen.findByText("The shared contest panel changed before this action could be applied.")).toBeTruthy();
  expect(actions).toHaveLength(1);
});

it("rejects Enter after same-value sibling revision churn",async()=>{
  const operator={output:"simulation-only",armed:true,style:"search-and-pounce",status:"armed",pending:null,focusedField:"callsign",...tabMaps,
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
  expect(await screen.findByText("The shared contest entry changed before this operator action. Review it and press the key again.")).toBeTruthy();
  expect(actions).toHaveLength(0);
});

it("accepts Enter when an already-running flush had partly completed before key capture",async()=>{
  const operator={output:"simulation-only",armed:true,style:"search-and-pounce",status:"armed",pending:null,focusedField:"callsign",...tabMaps,
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
  const operator={output:"simulation-only",armed:true,style:"run",status:"armed",pending:null,focusedField:"callsign",...tabMaps,
    functionKeys:[{key:"F1",macro:"CQ"}],readiness:{canSendCQ:true,canSendCall:true,canSendDuplicate:false,canReserveCall:false,canReserveCommit:false,canCommit:true},trace:[]};
  const current:any={...snapshot,projection:{...projection,schemaVersion:2,
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},operator}};
  const actions:Record<string,any>[]=[];native.invoke.mockImplementation(async(command:string,args:Record<string,any>)=>{
    if(command==="contest_surface_snapshot")return structuredClone(current);
    if(command==="contest_surface_action"){actions.push(args);return {requestID:args.requestID,status:"queued"};}throw new Error(command);
  });
  render(<DetachedContestSurface/>);const callsign=await screen.findByLabelText("Callsign");
  fireEvent.keyDown(callsign,{key:"Enter",repeat:true});fireEvent.keyDown(callsign,{key:"Enter",isComposing:true});
  for(const modifier of ["altKey","ctrlKey","metaKey","shiftKey"])
    fireEvent.keyDown(callsign,{key:"F1",[modifier]:true});
  const prevented=new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true});prevented.preventDefault();callsign.dispatchEvent(prevented);
  await act(async()=>{await Promise.resolve();});expect(actions).toHaveLength(0);
});

it("carries delayed multi-field typing through the real owner drain before one Enter intent",async()=>{
  const initial:any={...projection,schemaVersion:2,draft:{...projection.draft,callsign:"",receivedFields:[{...projection.draft.receivedFields[0],value:""}],frequencyError:""},
    descriptor:{bands:["20m"],modes:["CW"],sentFields:[],serial:{requirement:"none",allocatedFieldID:null,reservedSerial:null}},
    operator:{output:"simulation-only",armed:true,style:"search-and-pounce",status:"armed",pending:null,focusedField:"callsign",...tabMaps,
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
  fireEvent.change(callsign,{target:{value:" k"}});await firstStart;
  fireEvent.change(callsign,{target:{value:" k1"}});fireEvent.change(callsign,{target:{value:" k1abc "}});exchange.focus();
  fireEvent.change(exchange,{target:{value:"14"}});fireEvent.change(exchange,{target:{value:"15"}});fireEvent.keyDown(exchange,{key:"Enter"});
  expect(keys).toEqual([]);releaseFirst();await waitFor(()=>expect(keys).toEqual(["Enter"]),{timeout:5000});
  await waitFor(()=>{expect(bridgeProjection.draft.callsign).toBe("K1ABC");expect(bridgeProjection.draft.receivedFields[0].value).toBe("15");});
});

it("coalesces rapid log edits and resets the presentation buffer when the owner switches contacts",async()=>{
  window.history.replaceState({},"",search.replace("view=active-qso","view=logbook"));
  const editing=(qsoID:string,callsign:string)=>({qsoID,callsign,workedAt:"2026-10-19T10:00:00Z",operator:"OM0RX",band:"20m",mode:"CW",sentReport:"599",receivedReport:"599",receivedFields:[],
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
  current={...current,projectionRevision:4,projection:{...current.projection,editing:editing("qso-1","W")},
    receipts:[{requestID:actions[0].requestID,status:"applied",message:null,projectionRevision:4}]};await act(async()=>{native.wake!();});
  await waitFor(()=>expect(actions).toHaveLength(2));expect(actions[1]).toMatchObject({projectionRevision:4,action:"log_edit_set_text",params:{qsoID:"qso-1",value:"W1AW"}});
  current={...current,projectionRevision:5,projection:{...current.projection,editing:editing("qso-2","VE3XYZ")},receipts:[]};await act(async()=>{native.wake!();});
  await waitFor(()=>expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("VE3XYZ"));
});

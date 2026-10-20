// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Not1MMContestWorkspace } from "./Not1MMContestWorkspace";
import { ContestMutationUncertain } from "./client";
import { contestSurfacePanelIDs, validContestSurfaceProjection } from "./contestSurfaceProtocol";
import { newContestSetup } from "./ContestSetupPanel";
const stationControl = vi.hoisted(() => ({ speed: vi.fn(async () => ({accepted:true})) }));
vi.mock("./contestStationControl", () => ({ setContestCWSpeed: stationControl.speed }));
const nativeCW = vi.hoisted(() => ({ execute: vi.fn(), stop:vi.fn(async () => {}) }));
const surfaceOwner = vi.hoisted(() => ({ current: null as any, waitForPublication: vi.fn(async () => {}) }));
const surfaceWindow = vi.hoisted(() => ({ open: vi.fn(async () => {}), openHistory: vi.fn(async () => {}), openDialog: vi.fn(async (_kind: string) => {}) }));

vi.mock("./useContestSurfaceOwner", () => ({ useContestSurfaceOwner: (owner: unknown) => {
  surfaceOwner.current = owner; return surfaceOwner.waitForPublication;
} }));
vi.mock("./contestSurfaceNative", () => ({ openContestSurfaceWindow: surfaceWindow.open,
  openContestCallHistoryWindow: surfaceWindow.openHistory }));
vi.mock("./contestSetupDialogs", () => ({ openContestSetupDialog: surfaceWindow.openDialog, useContestSetupDialogs: vi.fn() }));
vi.mock("../live/BandMaps", () => ({ default: () => <div>Shared bandmap</div> }));
vi.mock("../live/ClusterPanel", () => ({ default: () => <div>Shared cluster</div> }));
vi.mock("../live/useSharedCW", () => ({ useSharedCW: () => ({
  controller: { refresh: vi.fn(async () => {}), arm: vi.fn(async () => {}), stop: nativeCW.stop, send: vi.fn(async () => {}), executeContest: nativeCW.execute },
  state: { pending: false, armed: false, message: "CW disarmed", error: "" },
  profile: { macros: [{ id: 2, enabled: true, shortcut: "F2", text: "{CALL} {RST} {EXCHANGE}" }] },
}) }));

afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); vi.restoreAllMocks(); surfaceOwner.current = null; });

const operatingContext = "44444444-4444-4444-8444-444444444444";
const workspaceGeneration = "33333333-3333-4333-8333-333333333333";
const workspaceProps = { operatingContext, workspaceGeneration, stationCall: "OM0RX", radioFrequencyHz: 14_025_000,
  spots: [] as any[], cluster: null, stationTune: vi.fn(async () => ({ accepted:true, confirmed:true })) };
const unavailableSCP = () => ({ id: "scp-status", ok: true,
  result: { dataset: null, unavailableReason: "not_imported" } });
const unavailableHistory = () => ({ id: "history-status", ok: true,
  result: { dataset: null, pendingPreview: null, unavailableReason: "not_imported",
    activation: { state: "not_imported", generation: null, digest: null, rowCount: null, message: null } } });

it("keeps the detached owner on the compact Contest Setup panel instead of embedding a contest desk", async () => {
  const request = vi.fn(async (method: string) => {
    if (method === "contest_catalog") return { id:crypto.randomUUID(), ok:true, result:{plugins:[]} };
    if (method === "contest_sessions") return { id:crypto.randomUUID(), ok:true, result:{sessions:[]} };
    throw new Error(method);
  });
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}/>);
  expect(await screen.findByRole("heading", { name: "Contest Setup", level: 1 })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Contest Setup", level: 2 })).toBeTruthy();
  expect(screen.queryByRole("heading", { name:"Contest Manager / Desk" })).toBeNull();
  expect(screen.queryByRole("button", { name:"Back to desk" })).toBeNull();
});

it("shows a string rejection from the detached contest owner", async () => {
  const request = vi.fn(async () => Promise.reject("Contest mutations require backend admission."));
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}/>);
  expect((await screen.findByRole("alert")).textContent).toContain("Contest mutations require backend admission.");
});

it("opens all separate setup dialogs from the hub and Contest menu before a session exists", async () => {
  const request = vi.fn(async (method: string) => ({ id:crypto.randomUUID(), ok:true,
    result:method === "contest_catalog" ? {plugins:[]} : {sessions:[]} }));
  let route: ((value: string) => boolean | Promise<boolean>) | null = null;
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}
    registerMenuRoute={handler => { route = handler; }}/>);
  await userEvent.click(await screen.findByRole("button", {name:"Station Settings"}));
  await userEvent.click(screen.getByRole("button", {name:"Configuration Settings"}));
  await act(async () => { await route!("contest-dialog-operator"); await route!("contest-dialog-station"); await route!("contest-dialog-configuration"); });
  expect(surfaceWindow.openDialog.mock.calls.map(([kind]) => kind)).toEqual(["station", "configuration", "operator", "station", "configuration"]);
  expect(screen.queryByRole("textbox", {name:"City"})).toBeNull();
  expect(request.mock.calls.every(([method]) => ["contest_catalog", "contest_sessions"].includes(method))).toBe(true);
});

it("persists station settings before the first contest exists", async () => {
  const request = vi.fn(async (method: string) => {
    if (method === "contest_catalog") return { id:crypto.randomUUID(), ok:true, result:{plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]} };
    if (method === "contest_sessions") return { id:crypto.randomUUID(), ok:true, result:{sessions:[]} };
    throw new Error(method);
  });
  const view = render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await userEvent.click(await screen.findByRole("button", { name:"Station Settings" }));
  fireEvent.change(screen.getByRole("textbox", { name:"Name" }), { target:{value:"Oliver"} });
  const save = screen.getByRole("button", { name:"OK" });
  expect((save as HTMLButtonElement).disabled).toBe(false);
  await userEvent.click(save);
  expect(JSON.parse(localStorage.getItem("xlog.contesting.not1mm.setup-draft.v1") ?? "{}").station.Name).toBe("Oliver");
  expect(request).not.toHaveBeenCalledWith("contest_setup_save", expect.anything());
  view.unmount();
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await userEvent.click(await screen.findByRole("button", { name:"Station Settings" }));
  expect((screen.getByRole("textbox", { name:"Name" }) as HTMLInputElement).value).toBe("Oliver");
});
async function createContestThroughSetup() {
  await userEvent.click(await screen.findByRole("button", { name: "New Contest" }));
  await userEvent.click(await screen.findByRole("button", { name: "OK" }));
}
const workspaceSupport = (method: string, params: Record<string, unknown>, current: ReturnType<typeof projection>) => {
  const id = crypto.randomUUID();
  if (method === "contest_rates") return { id, ok:true, result:{ sessionID:current.sessionID, revision:current.revision,
    lastHourQsoPerHour:null,last10QsoPerHour:null,last100QsoPerHour:null,sinceHourUTC:0,sinceHourQso:0,
    runQso:0,searchAndPounceQso:0,hourRunQso:0,hourSearchAndPounceQso:0 } };
  if (method === "contest_setup_save") return { id, ok:true, result:{ projection:{...current,
    cwSpeedWpm:(params.setup as any)?.preferences?.cwSpeed ?? (current as any).cwSpeedWpm}, setup:params.setup, actions:[], messages:[] } };
  if (method === "contest_setup_get") return { id, ok:true, result:{ sessionID:current.sessionID, revision:current.revision,
    setup:{...newContestSetup("OM0RX"),name:"Preserved session"} } };
  return null;
};

it("queries the full contest log for partials and retains raw rows beyond the displayed page",async()=>{
  const current={...projection(9,{callsign:"DL1"}),operator:"OM0RX/P",cwSpeedWpm:27,
    callContext:{callsign:"DL1",country:"Germany",cqZone:14,ituZone:28,headingDegrees:null,longPathHeadingDegrees:null,distanceKm:null},
    score:{qsos:25,points:50,countries:4,zones:3,multipliers:7,total:350}};
  const raw={ID:"off-page",TS:"2026-10-19 01:02:03",Call:"DL1ABC",Freq:14025.125,SNT:"579",RCV:"589",ZN:14,SentNr:15,WPXPrefix:"DL1",CountryPrefix:"DL",Points:3,Band:14,Mode:"CW"};
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    const result=method==="contest_catalog"?{plugins:[]}:method==="contest_sessions"?{sessions:[]}:
      method==="contest_create"?{projection:current}:method==="contest_log_page"?{rows:[],total:25}:
      method==="contest_score"?{score:current.score}:method==="contest_check_partial"?{query:"DL1",rows:[raw],total:1}:null;
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} spots={[{callsign:"DL1XYZ"},{callsign:"K1ABC"}]}/>);
  await createContestThroughSetup();
  await waitFor(()=>expect(surfaceOwner.current.projections["callsign-intelligence"].loggedCalls).toEqual(["DL1ABC"]));
  expect(request.mock.calls.some(([method])=>method==="contest_history_status")).toBe(false);
  expect(request.mock.calls.find(([method])=>method==="contest_check_partial")?.[1]).toEqual({sessionID:current.sessionID,expectedRevision:9,query:"DL1",limit:500});
  expect(surfaceOwner.current.projections["callsign-intelligence"].clusterCalls).toEqual(["DL1XYZ"]);
  expect(surfaceOwner.current.projections.logbook.page.rows).toEqual([]);
  expect(surfaceOwner.current.projections.logbook.partialRows).toEqual([{qsoID:"off-page",TS:raw.TS,Call:raw.Call,Freq:"14025.125",SNT:"579",RCV:"589",ZN:"14",SentNr:"15",prefix:"DL1",Points:"3"}]);
  expect(surfaceOwner.current.projections["active-qso"].manual).toMatchObject({operator:"OM0RX/P",cwSpeedWpm:25,country:"Germany",cqZone:14,ituZone:28,qsos:25,multipliers:7,total:350,distanceKm:null});
  for(const panel of contestSurfacePanelIDs)expect(validContestSurfaceProjection(panel,surfaceOwner.current.projections[panel])).toBe(true);
});

const projection = (revision = 1, values: Record<string, string> = {}) => ({
  sessionID: "11111111-1111-4111-8111-111111111111", engine: "not1mm-python", pluginID: "cq_ww_cw",
  workspaceGeneration: "33333333-3333-4333-8333-333333333333",
  sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f", referenceID: "cty-test", revision,
  ruleIdentity:{id:"cq-ww-cw",version:"26.10.11",edition:"not1mm-python",sourceRevision:"7c8b499225a73f7f8f792246881bd7aefc05452f"},
  draftID: "22222222-2222-4222-8222-222222222222", frequencyHz: 14025000, mode: "CW", band: 14,
  focus: "callsign", tabNext: { callsign: "sent", sent: "receive", receive: "other_2", other_2: "callsign" },
  tabPrevious: { callsign: "other_2", sent: "callsign", receive: "sent", other_2: "receive" },
  advanceOnSpace: ["callsign", "sent", "receive", "other_1", "other_2"], run: false,
  functionKeys: Array.from({ length: 12 }, (_, index) => ({ id: `F${index + 1}`, highlighted: index === 1 })),
  dupe: false, countryResolved: true, history: "K1ABC United States", columns: [] as string[], matrixTrackers: ["countries", "zones"] as Array<"countries" | "zones">,
  score: { qsos: 0, points: 0, countries: 0, zones: 0, total: 0 },
  fields: [
    ["callsign", "Call", true, ""], ["sent", "SNT", true, "599"], ["receive", "RCV", true, "599"],
    ["other_1", "", false, "15"], ["other_2", "CQ Zone", true, ""],
  ].map(([id, label, visible, value]) => ({ id, label, accessibleName: label, visible, value: values[id as string] ?? value, readOnly: false, enabled: true })),
});
const statisticsFor = (current: ReturnType<typeof projection>) => ({
  rows: current.score.qsos ? [{band:"20m",qsos:current.score.qsos,calls:current.score.qsos,cw:current.score.qsos,
    phone:0,digital:0,wpx:current.score.qsos,points:current.score.points}] : [],
  total:{band:"TOTAL",qsos:current.score.qsos,calls:current.score.qsos,cw:current.score.qsos,
    phone:0,digital:0,wpx:current.score.qsos,points:current.score.points},
});

it.each([false, true])("publishes ready empty CQ WW trackers and preserves populated matrices (worked=%s)", async worked => {
  const current = projection();
  const matrices = { countries: worked ? [{ value: "Slovakia", band: 14, qsos: 2 }] : [],
    zones: worked ? [{ value: "15", band: 7, qsos: 1 }] : [] };
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const support = workspaceSupport(method, params, current); if (support) return support;
    if (method === "contest_scp_status") return unavailableSCP();
    if (method === "contest_history_status") return unavailableHistory();
    const result = method === "contest_catalog" ? { plugins: [{ id: "cq_ww_cw", name: "CQ WW CW" }] } :
      method === "contest_sessions" ? { sessions: [] } : method === "contest_create" ? { projection: current } :
      method === "contest_log_page" ? { rows: [], total: 0 } : method === "contest_score" ? { score: current.score, matrices } : null;
    if (!result) throw new Error(method);
    return { id: crypto.randomUUID(), ok: true, result };
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();
  await waitFor(() => expect(surfaceOwner.current.projections.awards.status).toBe("ready"));
  const bands = ["160m", "80m", "40m", "20m", "15m", "10m"];
  const countries = surfaceOwner.current.projections.awards;
  const zones = surfaceOwner.current.projections["chaser-dx"];
  expect(countries).toMatchObject({ schemaVersion: 4, status: "ready", title: "DXCC", tracker:"dxcc", zoneSystem:null,
    current:{dxcc:null,cqZone:null,ituZone:null}, bands, total: worked ? 1 : 0 });
  expect(zones).toMatchObject({ schemaVersion: 4, status: "ready", title: "CQ Zones", tracker:"zone", zoneSystem:"cq",
    current:{dxcc:null,cqZone:null,ituZone:null}, bands, total: worked ? 1 : 0 });
  expect(countries.rows).toEqual(worked ? [{ label: "Slovakia", counts: { "160m": 0, "80m": 0, "40m": 0, "20m": 2, "15m": 0, "10m": 0 }, total: 2 }] : []);
  expect(zones.rows).toEqual(worked ? [{ label: "15", counts: { "160m": 0, "80m": 0, "40m": 1, "20m": 0, "15m": 0, "10m": 0 }, total: 1 }] : []);
  expect(validContestSurfaceProjection("awards", countries)).toBe(true);
  expect(validContestSurfaceProjection("chaser-dx", zones)).toBe(true);
});

it("refreshes the current contest Rates snapshot every ten seconds", async () => {
  const current = projection();
  let rateReads = 0;
  let poll: (() => void) | undefined;
  vi.spyOn(window, "setInterval").mockImplementation(((handler: TimerHandler, timeout?: number) => {
    if (timeout === 10_000 && typeof handler === "function") poll = handler as () => void;
    return 1;
  }) as typeof window.setInterval);
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const id = crypto.randomUUID();
    if (method === "contest_rates") {
      rateReads += 1;
      return { id, ok:true, result:{ sessionID:current.sessionID, revision:current.revision,
        lastHourQsoPerHour:null,last10QsoPerHour:null,last100QsoPerHour:null,sinceHourUTC:19,
        sinceHourQso:rateReads === 1 ? 0 : 3,runQso:3,searchAndPounceQso:0,hourRunQso:3,hourSearchAndPounceQso:0 } };
    }
    const support = workspaceSupport(method, params, current); if (support) return support;
    if (method === "contest_scp_status") return unavailableSCP();
    if (method === "contest_history_status") return unavailableHistory();
    const result = method === "contest_catalog" ? {plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]} :
      method === "contest_sessions" ? {sessions:[]} : method === "contest_create" ? {projection:current} :
      method === "contest_log_page" ? {rows:[],total:0} : method === "contest_score" ? {score:current.score,matrices:{countries:[],zones:[]}} : null;
    if (!result) throw new Error(method);
    return {id,ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();
  await waitFor(() => expect(surfaceOwner.current.projections.monitor.sinceHourQso).toBe(0));
  expect(poll).toBeTypeOf("function");
  await act(async () => { poll?.(); });
  await waitFor(() => expect(surfaceOwner.current.projections.monitor).toMatchObject({sinceHourUTC:19,sinceHourQso:3}));
  const rateCalls = request.mock.calls.filter(([method]) => method === "contest_rates");
  expect(rateCalls).toHaveLength(2);
  expect(rateCalls.at(-1)?.[1]).toEqual({sessionID:current.sessionID});
});

it("publishes exact Statistics v3 once per score refresh without adding a statistics timer", async () => {
  const current={...projection(4),score:{qsos:2,points:6,countries:1,zones:1,total:12}};
  let poll:(()=>void)|undefined;
  vi.spyOn(window,"setInterval").mockImplementation(((handler:TimerHandler,timeout?:number)=>{
    if(timeout===10_000&&typeof handler==="function")poll=handler as()=>void;return 1;
  }) as typeof window.setInterval);
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    const result=method==="contest_catalog"?{plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]}:
      method==="contest_sessions"?{sessions:[]}:method==="contest_create"?{projection:current}:
      method==="contest_log_page"?{rows:[],total:0}:method==="contest_score"?{sessionID:current.sessionID,revision:current.revision,
        score:current.score,matrices:{countries:[],zones:[]},statistics:statisticsFor(current)}:null;
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);await createContestThroughSetup();
  await waitFor(()=>expect(surfaceOwner.current.projections.propagation).toEqual({schemaVersion:3,status:"ready",
    score:{claimedScore:12,qsos:2,points:6,multipliers:2,multiplierLabels:["1 countries","1 zones"],
      multiplierDisplayLabels:["1 countries","1 zones"],sourceVerification:"verified"},
    ...statisticsFor(current),busy:false}));
  expect(request.mock.calls.filter(([method])=>method==="contest_score")).toHaveLength(1);
  await act(async()=>poll?.());
  expect(request.mock.calls.filter(([method])=>method==="contest_score")).toHaveLength(1);
});

it.each(["wrong session","stale revision","malformed"])("fails closed on a Statistics response with a %s",async mismatch=>{
  const current={...projection(4),score:{qsos:2,points:6,countries:1,zones:1,total:12}};
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    const result=method==="contest_catalog"?{plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]}:
      method==="contest_sessions"?{sessions:[]}:method==="contest_create"?{projection:current}:
      method==="contest_log_page"?{rows:[],total:0}:method==="contest_score"?{
        sessionID:mismatch==="wrong session"?crypto.randomUUID():current.sessionID,
        revision:mismatch==="stale revision"?current.revision-1:current.revision,score:current.score,matrices:{countries:[],zones:[]},
        statistics:mismatch==="malformed"?{...statisticsFor(current),extra:true}:statisticsFor(current)}:null;
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);await createContestThroughSetup();
  await waitFor(()=>expect(surfaceOwner.current.context.sessionID).toBe(current.sessionID));
  expect(surfaceOwner.current.projections.propagation).toEqual({schemaVersion:1,status:"unavailable"});
});

it.each(["wrong session", "stale revision"])("rejects an initial Rates snapshot with a %s", async mismatch => {
  const current = projection(4);
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const support = workspaceSupport(method, params, current); if (method !== "contest_rates" && support) return support;
    const id = crypto.randomUUID();
    if (method === "contest_rates") return {id,ok:true,result:{
      sessionID:mismatch === "wrong session" ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : current.sessionID,
      revision:mismatch === "stale revision" ? current.revision - 1 : current.revision,
      lastHourQsoPerHour:1,last10QsoPerHour:null,last100QsoPerHour:null,sinceHourUTC:19,sinceHourQso:99,
      runQso:99,searchAndPounceQso:0,hourRunQso:99,hourSearchAndPounceQso:0,
    }};
    if (method === "contest_scp_status") return unavailableSCP();
    if (method === "contest_history_status") return unavailableHistory();
    const result = method === "contest_catalog" ? {plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]} :
      method === "contest_sessions" ? {sessions:[]} : method === "contest_create" ? {projection:current} :
      method === "contest_log_page" ? {rows:[],total:0} : method === "contest_score" ? {score:current.score,matrices:{countries:[],zones:[]}} : null;
    if (!result) throw new Error(method);
    return {id,ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();
  await waitFor(() => expect(surfaceOwner.current.context.sessionID).toBe(current.sessionID));
  expect(surfaceOwner.current.projections.monitor).toEqual({schemaVersion:1,status:"unavailable"});
});

it("projects CWT Name as received input and admits edits through the detached owner", async () => {
  let current:any={...projection(3,{other_1:"ALICE",other_2:"1234"}),pluginID:"cwt",pluginName:"CWT",matrixTrackers:[],
    columns:["YYYY-MM-DD HH:MM:SS","Call","Freq","Name","SPC","PTS"]};
  current.fields=current.fields.map((field:any)=>({...field,visible:!["sent","receive"].includes(field.id),
    readOnly:false,label:field.id==="other_1"?"Name":field.id==="other_2"?"Member No./SPC":field.label}));
  current.tabNext={callsign:"other_1",other_1:"other_2",other_2:"callsign"};
  current.tabPrevious={callsign:"other_2",other_1:"callsign",other_2:"other_1"};
  let applied:Record<string,unknown>|null=null;
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    let result:any;
    if(method==="contest_catalog")result={plugins:[{id:"cwt",name:"CWT"}]};
    else if(method==="contest_sessions")result={sessions:[]};
    else if(method==="contest_create")result={projection:current};
    else if(method==="contest_log_page")result={rows:[],total:0};
    else if(method==="contest_score")result={score:current.score,matrices:{countries:[],zones:[]}};
    else if(method==="contest_draft_apply"){
      applied=params;current={...current,revision:current.revision+1,fields:current.fields.map((field:any)=>
        ({...field,value:(params.fields as Record<string,string>)[field.id]??field.value}))};
      result={projection:current,actions:[],messages:[]};
    }else throw new Error(method);
    return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await userEvent.click(await screen.findByRole("button",{name:"New Contest"}));
  fireEvent.change(screen.getByLabelText("Log Type"),{target:{value:"cwt"}});
  fireEvent.change(screen.getByLabelText("Sent Exchange"),{target:{value:"OLIVER"}});
  await userEvent.click(screen.getByRole("button",{name:"OK"}));
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].status).toBe("ready"));
  let entry:any=surfaceOwner.current.projections["active-qso"];
  expect(entry.descriptor.sentFields).toEqual([]);
  expect(entry.draft.receivedFields).toEqual([
    {id:"other_1",label:"Name",value:"ALICE",required:true,maximumUTF8Bytes:32},
    {id:"other_2",label:"Member No./SPC",value:"1234",required:true,maximumUTF8Bytes:128},
  ]);
  await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"active-qso",projectionRevision:1,requestID:crypto.randomUUID(),action:"entry_set_exchange",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,fieldID:"other_1",value:"bob"}}));
  expect(applied).toMatchObject({fields:{other_1:"BOB",other_2:"1234"}});
  entry=surfaceOwner.current.projections["active-qso"];
  expect(entry.draft.receivedFields[0].value).toBe("BOB");
});

it.each([
  { pluginID:"cwt", pluginName:"CWT", exchangeLabel:"Number or State", exchangeColumn:"RcvNr",
    row:{Name:"ALICE",NR:"ALICE 123",Sect:"",ZN:5}, expectedOther2:"123" },
  { pluginID:"k1usn_sst", pluginName:"K1USN SLOW SPEED TEST", exchangeLabel:"SPC", exchangeColumn:"Sect",
    row:{Name:"ALICE",NR:"",Sect:"CT",ZN:5}, expectedOther2:"CT" },
])("opens $pluginID corrections with received Name/exchange instead of historical sent exchange or CQ zone",
  async ({pluginID,pluginName,exchangeLabel,exchangeColumn,row:exchangeRow,expectedOther2}) => {
    let current:any={...projection(3),pluginID,pluginName,matrixTrackers:[],
      columns:["YYYY-MM-DD HH:MM:SS","Call","Freq","SentNr","Name",exchangeColumn,"PTS"]};
    current.fields=current.fields.map((field:any)=>({...field,visible:!["sent","receive"].includes(field.id),readOnly:false,
      label:field.id==="other_1"?"Name":field.id==="other_2"?exchangeLabel:field.label}));
    const row={ID:`${pluginID}-qso`,TS:"2026-10-20 09:00:00",Call:"K1ABC",Freq:14025,Band:14,Mode:"CW",
      SNT:"599",RCV:"599",SentNr:"OLIVER",Operator:"OM0RX",Points:1,...exchangeRow};
    let corrected:Record<string,any>|null=null;
    const request=vi.fn(async(method:string,params:Record<string,any>={})=>{
      const support=workspaceSupport(method,params,current);if(support)return support;
      if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
      let result:any;
      if(method==="contest_catalog")result={plugins:[{id:pluginID,name:pluginName}]};
      else if(method==="contest_sessions")result={sessions:[]};
      else if(method==="contest_create")result={projection:current};
      else if(method==="contest_log_page")result={rows:[row],offset:0,limit:20,total:1};
      else if(method==="contest_score")result={score:current.score,matrices:{countries:[],zones:[]}};
      else if(method==="contest_qso_correct"){
        corrected=params;current={...current,revision:current.revision+1};result={projection:current,actions:[],messages:[]};
      }else throw new Error(method);
      return{id:crypto.randomUUID(),ok:true,result};
    });
    render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
    await userEvent.click(await screen.findByRole("button",{name:"New Contest"}));
    fireEvent.change(screen.getByLabelText("Log Type"),{target:{value:pluginID}});
    fireEvent.change(screen.getByLabelText("Sent Exchange"),{target:{value:"CHANGED"}});
    await userEvent.click(screen.getByRole("button",{name:"OK"}));
    await waitFor(()=>expect(surfaceOwner.current.projections.logbook.page.rows).toHaveLength(1));
    const envelope={operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
      panelID:"logbook",projectionRevision:1,requestID:crypto.randomUUID()} as const;
    await act(async()=>surfaceOwner.current.handle({...envelope,action:"log_edit_begin",params:{qsoID:row.ID}}));
    expect(surfaceOwner.current.projections.logbook.editing.receivedFields).toEqual([
      {id:"other_1",label:"Name",value:"ALICE",required:true,maximumUTF8Bytes:32},
      {id:"other_2",label:exchangeLabel,value:expectedOther2,required:true,maximumUTF8Bytes:128},
    ]);
    await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"log_edit_save",
      params:{qsoID:row.ID,expectedSessionRevision:current.revision}}));
    expect(corrected).toMatchObject({qsoID:row.ID,fields:{other_1:"ALICE",other_2:expectedOther2}});
    const correctedFields=(corrected as Record<string,any>|null)?.fields;
    expect(correctedFields.other_1).not.toBe("OLIVER");
    expect(correctedFields.other_2).not.toBe("5");
  });

it("projects ICWC serial, original exchange labels, unique calls and editable packed name/serial", async () => {
  const current = { ...projection(4, {other_1:"003",other_2:"BOB 12"}), pluginID:"icwc_mst", pluginName:"ICWC Medium Speed Test", reservedSerial:3, matrixTrackers:[],
    columns:["YYYY-MM-DD HH:MM:SS","Call","Freq","SentNr","Name","RcvNr","PTS"],
    score:{qsos:2,points:2,countries:0,zones:0,multipliers:1,uniqueCalls:1,total:2} };
  current.fields = current.fields.map(field => ({...field, visible: !["sent","receive"].includes(String(field.id)),
    readOnly:field.id==="other_1", label:field.id==="other_1"?"Sent S/N":field.id==="other_2"?"Name + S/N":field.label}));
  const row = {ID:"mst-qso",TS:"2026-10-20 08:00:00",Call:"K1ABC",Freq:14025,Band:14,Mode:"CW",SNT:"599",RCV:"599",SentNr:1,Name:"BOB",NR:12,ZN:5,Points:1};
  const request = vi.fn(async (method:string,params:Record<string,unknown>={}) => {
    const support=workspaceSupport(method,params,current); if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP(); if(method==="contest_history_status")return unavailableHistory();
    const result=method==="contest_catalog"?{plugins:[{id:"icwc_mst",name:"ICWC Medium Speed Test"}]}:
      method==="contest_sessions"?{sessions:[]}:method==="contest_create"?{projection:current}:
      method==="contest_log_page"?{rows:[row],total:1}:method==="contest_score"?{sessionID:current.sessionID,revision:current.revision,score:current.score,matrices:{countries:[],zones:[]}}:null;
    if(!result)throw new Error(method); return {id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await userEvent.click(await screen.findByRole("button",{name:"New Contest"}));
  fireEvent.change(screen.getByLabelText("Log Type"),{target:{value:"icwc_mst"}});
  fireEvent.change(screen.getByLabelText("Name"),{target:{value:"OLIVER"}});
  await userEvent.click(screen.getByRole("button",{name:"OK"}));
  await waitFor(()=>expect(surfaceOwner.current.projections.logbook.page.rows).toHaveLength(1));
  const entry=surfaceOwner.current.projections["active-qso"];
  expect(entry.session.ruleName).toBe("ICWC Medium Speed Test");
  expect(entry.descriptor).toMatchObject({reportsVisible:false,serial:{requirement:"requiredForCommit",allocatedFieldID:"other_1",reservedSerial:3}});
  expect(entry.draft).toMatchObject({reservedSerial:3,receivedFields:[{id:"other_2",label:"Name + S/N",value:"BOB 12",required:true,maximumUTF8Bytes:128}]});
  expect(surfaceOwner.current.projections.propagation.score).toMatchObject({multipliers:1,multiplierDisplayLabels:["1 unique calls"]});
  expect(surfaceOwner.current.projections.awards.status).toBe("unavailable");
  expect(surfaceOwner.current.projections["chaser-dx"].status).toBe("unavailable");
  expect(surfaceOwner.current.projections.logbook).toMatchObject({exchangeLayout:"plugin",
    pluginColumns:current.columns,pluginRows:[{qsoID:row.ID,values:[row.TS,row.Call,String(row.Freq),"1",row.Name,"12","1"]}],
    page:{rows:[{receivedExchange:"BOB 12",sentExchange:"1"}]}});
  await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"logbook",projectionRevision:1,requestID:crypto.randomUUID(),action:"log_edit_begin",params:{qsoID:row.ID}}));
  expect(surfaceOwner.current.projections.logbook.editing).toMatchObject({reportsVisible:false,
    receivedFields:[{id:"other_1",label:"Sent S/N",value:"1"},{id:"other_2",label:"Name + S/N",value:"BOB 12"}]});
  for(const panel of contestSurfacePanelIDs)expect(validContestSurfaceProjection(panel,surfaceOwner.current.projections[panel])).toBe(true);
});

it("projects CWOPS Open serial/name exchange, retained dupes and unique-call score", async () => {
  const current = { ...projection(4, {other_1:"003",other_2:"12 ALICE"}), pluginID:"cwo", pluginName:"CWOPS - Open",
    columns:["YYYY-MM-DD HH:MM:SS","Call","Freq","Snt","Rcv","SentNr","RcvNr","Name","M1","PTS"],
    reservedSerial:3,allowDuplicateCommit:true,dupe:true,dupeExplanation:"Worked on this band.",matrixTrackers:[],
    score:{qsos:2,points:1,countries:0,zones:0,multipliers:1,uniqueCalls:1,total:1} };
  current.fields = current.fields.map(field => ({...field, visible: !["sent","receive"].includes(String(field.id)),
    readOnly:field.id==="other_1", label:field.id==="other_1"?"SentNR":field.id==="other_2"?"Recd Number and Name":field.label}));
  const row = {ID:"cwo-qso",TS:"2026-10-20 10:00:00",Call:"K1ABC",Freq:14025,Band:14,Mode:"CW",SNT:"599",RCV:"599",SentNr:1,Name:"ALICE",NR:12,Points:1};
  const request = vi.fn(async (method:string,params:Record<string,unknown>={}) => {
    const support=workspaceSupport(method,params,current); if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP(); if(method==="contest_history_status")return unavailableHistory();
    const result=method==="contest_catalog"?{plugins:[{id:"cwo",name:"CWOPS - Open"}]}:
      method==="contest_sessions"?{sessions:[]}:method==="contest_create"?{projection:current}:
      method==="contest_log_page"?{rows:[row],total:1}:method==="contest_score"?{sessionID:current.sessionID,revision:current.revision,score:current.score}:null;
    if(!result)throw new Error(method); return {id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await userEvent.click(await screen.findByRole("button",{name:"New Contest"}));
  fireEvent.change(screen.getByLabelText("Log Type"),{target:{value:"cwo"}});
  fireEvent.change(screen.getByLabelText("Name"),{target:{value:"OLIVER"}});
  await userEvent.click(screen.getByRole("button",{name:"OK"}));
  await waitFor(()=>expect(surfaceOwner.current.projections.logbook.page.rows).toHaveLength(1));
  const entry=surfaceOwner.current.projections["active-qso"];
  expect(entry.session.ruleName).toBe("CWOPS - Open");
  expect(entry.descriptor).toMatchObject({reportsVisible:false,allowDuplicateCommit:true,
    serial:{requirement:"requiredForCommit",allocatedFieldID:"other_1",reservedSerial:3}});
  expect(entry.draft).toMatchObject({dupe:{state:"duplicate",reason:"Worked on this band."},reservedSerial:3,
    receivedFields:[{id:"other_2",label:"Recd Number and Name",value:"12 ALICE"}]});
  expect(surfaceOwner.current.projections.propagation.score).toMatchObject({multipliers:1,multiplierDisplayLabels:["1 unique calls"]});
  expect(surfaceOwner.current.projections.logbook).toMatchObject({exchangeLayout:"plugin",pluginColumns:current.columns,page:{rows:[{
    receivedExchange:"12 ALICE",sentExchange:"1",multiplierLabels:[]}]}});
  for(const panel of contestSurfacePanelIDs)expect(validContestSurfaceProjection(panel,surfaceOwner.current.projections[panel])).toBe(true);
});

it("projects Trans Tasman low bands, serial exchange, plugin dupe period and retained duplicate logging", async () => {
  const current = { ...projection(5, {other_1:"001",other_2:"012"}), pluginID:"trans_tasman", pluginName:"Trans Tasman CW",
    frequencyHz:7_025_000,band:7,reservedSerial:1,supportedBands:["160m","80m","40m"],supportedModes:["CW"],
    columns:["YYYY-MM-DD HH:MM:SS","Call","Freq","Mode","Snt","Rcv","SentNr","RcvNr","M1","PTS"],
    allowDuplicateCommit:true,dupe:true,dupeExplanation:"Worked on this band and mode in this 2-hour UTC block (08–10, 10–12, 12–14).",matrixTrackers:[],
    ruleIdentity:{id:"trans-tasman",version:"26.10.11",edition:"not1mm-python",sourceRevision:"7c8b499225a73f7f8f792246881bd7aefc05452f"},
    score:{qsos:1,points:1,countries:0,zones:0,multipliers:1,prefixes:1,total:1} };
  current.fields = current.fields.map(field => ({...field,readOnly:field.id==="other_1",
    label:field.id==="other_1"?"SentNR":field.id==="other_2"?"RcvNR":field.label}));
  const row={ID:"tt-qso",TS:"2026-10-20 08:10:00",Call:"ZL1ABC",Freq:7025,Band:7,Mode:"CW",SNT:"599",RCV:"599",SentNr:1,NR:12,WPXPrefix:"ZL1",Points:1};
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    const result=method==="contest_catalog"?{plugins:[{id:"trans_tasman",name:"Trans Tasman CW"}]}:
      method==="contest_sessions"?{sessions:[]}:method==="contest_create"?{projection:current}:
      method==="contest_log_page"?{rows:[row],total:1}:method==="contest_score"?{sessionID:current.sessionID,revision:current.revision,score:current.score}:null;
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} radioFrequencyHz={7_025_000}/>);
  await userEvent.click(await screen.findByRole("button",{name:"New Contest"}));
  fireEvent.change(screen.getByLabelText("Log Type"),{target:{value:"trans_tasman"}});
  await userEvent.click(screen.getByRole("button",{name:"OK"}));
  await waitFor(()=>expect(surfaceOwner.current.projections.logbook.page.rows).toHaveLength(1));
  const entry=surfaceOwner.current.projections["active-qso"];
  expect(entry.descriptor).toMatchObject({bands:["160m","80m","40m"],modes:["CW"],allowDuplicateCommit:true,
    serial:{requirement:"requiredForCommit",allocatedFieldID:"other_1",reservedSerial:1}});
  expect(entry.draft).toMatchObject({band:"40m",dupe:{state:"duplicate",reason:current.dupeExplanation},
    receivedFields:[{id:"other_2",label:"RcvNR",value:"012"}]});
  expect(surfaceOwner.current.projections.propagation.score).toMatchObject({multipliers:1,multiplierDisplayLabels:["1 prefixes"]});
  expect(surfaceOwner.current.projections.logbook).toMatchObject({exchangeLayout:"plugin",pluginColumns:current.columns,page:{rows:[{
    receivedExchange:"12",sentExchange:"1",multiplierLabels:["ZL1"]}]}});
  expect(surfaceOwner.current.projections.awards.status).toBe("unavailable");
  expect(surfaceOwner.current.projections["chaser-dx"].status).toBe("unavailable");
  expect(validContestSurfaceProjection("active-qso",entry)).toBe(true);
});

it.each([
  { pluginID:"oceania_dx_ssb", pluginName:"Oceania DX SSB",
    columns:["YYYY-MM-DD HH:MM:SS","Call","Freq","Snt","Rcv","SentNr","RcvNr","M1","PTS"],
    row:{ID:"oc-ssb-qso",TS:"2026-10-20 11:00:00",Call:"VK4ABC",Freq:14250,Band:14,Mode:"USB",SNT:"59",RCV:"59",SentNr:1,NR:123,WPXPrefix:"VK4",IsMultiplier1:1,Points:1},
    receivedExchange:"123", multiplierLabels:["VK4"], values:["2026-10-20 11:00:00","VK4ABC","14250","59","59","1","123","✓","1"], correction:undefined },
  { pluginID:"oceania_dx_cw", pluginName:"Oceania DX CW",
    columns:["YYYY-MM-DD HH:MM:SS","Call","Freq","Snt","Rcv","SentNr","RcvNr","M1","PTS"],
    row:{ID:"oc-qso",TS:"2026-10-20 11:00:00",Call:"VK4ABC",Freq:14025,Band:14,Mode:"CW",SNT:"599",RCV:"599",SentNr:1,NR:123,WPXPrefix:"VK4",IsMultiplier1:1,Points:1},
    receivedExchange:"123", multiplierLabels:["VK4"], values:["2026-10-20 11:00:00","VK4ABC","14025","599","599","1","123","✓","1"], correction:undefined },
  { pluginID:"cq_wpx_cw", pluginName:"CQ WPX CW",
    columns:["YYYY-MM-DD HH:MM:SS","Call","Freq","Snt","Rcv","SentNr","RcvNr","WPX","M1","PTS"],
    row:{ID:"wpx-qso",TS:"2026-10-20 11:00:00",Call:"K1ABC",Freq:14025,Band:14,Mode:"CW",SNT:"599",RCV:"599",SentNr:1,NR:123,WPXPrefix:"K1",IsMultiplier1:1,Points:3},
    receivedExchange:"123", multiplierLabels:["K1"], values:["2026-10-20 11:00:00","K1ABC","14025","599","599","1","123","K1","✓","3"],
    correction:[{id:"other_1",label:"SentNR",value:"1",required:true,maximumUTF8Bytes:32},{id:"other_2",label:"RcvNR",value:"123",required:true,maximumUTF8Bytes:128}] },
  { pluginID:"cq_wpx_ssb", pluginName:"CQ WPX SSB",
    columns:["YYYY-MM-DD HH:MM:SS","Call","Freq","Snt","Rcv","SentNr","RcvNr","WPX","M1","PTS"],
    row:{ID:"wpx-ssb-qso",TS:"2026-10-20 11:00:00",Call:"K1ABC",Freq:14250,Band:14,Mode:"USB",SNT:"59",RCV:"59",SentNr:1,NR:123,WPXPrefix:"K1",IsMultiplier1:1,Points:3},
    receivedExchange:"123", multiplierLabels:["K1"], values:["2026-10-20 11:00:00","K1ABC","14250","59","59","1","123","K1","✓","3"],
    correction:[{id:"other_1",label:"SentNR",value:"1",required:true,maximumUTF8Bytes:32},{id:"other_2",label:"RcvNR",value:"123",required:true,maximumUTF8Bytes:128}] },
  { pluginID:"arrl_ss_cw", pluginName:"ARRL Sweepstakes CW",
    columns:["YYYY-MM-DD HH:MM:SS","Call","Freq","Snt","Rcv","SentNr","RcvNr","CK","Prec","Sect","M1","PTS"],
    row:{ID:"ss-qso",TS:"2026-10-20 12:00:00",Call:"K1ABC",Freq:14025,Band:14,Mode:"CW",SNT:"599",RCV:"599",SentNr:1,NR:123,CK:67,Prec:"A",Sect:"CT",IsMultiplier1:1,Points:2},
    receivedExchange:"123 A K1ABC 67 CT", multiplierLabels:["Section CT"], values:["2026-10-20 12:00:00","K1ABC","14025","599","599","1","123","67","A","CT","✓","2"],
    correction:[{id:"other_1",label:"SentNR",value:"1",required:true,maximumUTF8Bytes:32},{id:"other_2",label:"sn: p: cl: ck: sec:",value:"123 A K1ABC 67 CT",required:true,maximumUTF8Bytes:128}] },
  { pluginID:"arrl_ss_phone", pluginName:"ARRL Sweepstakes Phone",
    columns:["YYYY-MM-DD HH:MM:SS","Call","Freq","Snt","Rcv","SentNr","RcvNr","CK","Prec","Sect","M1","PTS"],
    row:{ID:"ss-phone-qso",TS:"2026-10-20 12:00:00",Call:"K1ABC",Freq:14250,Band:14,Mode:"USB",SNT:"59",RCV:"59",SentNr:1,NR:123,CK:67,Prec:"A",Sect:"CT",IsMultiplier1:1,Points:2},
    receivedExchange:"123 A K1ABC 67 CT", multiplierLabels:["Section CT"], values:["2026-10-20 12:00:00","K1ABC","14250","59","59","1","123","67","A","CT","✓","2"],
    correction:[{id:"other_1",label:"SentNR",value:"1",required:true,maximumUTF8Bytes:32},{id:"other_2",label:"sn: p: cl: ck: sec:",value:"123 A K1ABC 67 CT",required:true,maximumUTF8Bytes:128}] },
])("projects the actual $pluginName log columns, exchange, multiplier and correction prefill", async ({pluginID,pluginName,columns,row,receivedExchange,multiplierLabels,values,correction}) => {
  const current={...projection(3,{other_1:"002"}),pluginID,pluginName,columns,matrixTrackers:[],
    reservedSerial:2,score:{qsos:1,points:row.Points,countries:0,zones:0,multipliers:1,total:row.Points}};
  current.fields=current.fields.map(field=>({...field,readOnly:field.id==="other_1",
    label:field.id==="other_1"&&correction?correction[0].label:field.id==="other_2"&&correction?correction[1].label:field.label}));
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    const result=method==="contest_catalog"?{plugins:[{id:pluginID,name:pluginName}]}:
      method==="contest_sessions"?{sessions:[]}:method==="contest_create"?{projection:current}:
      method==="contest_log_page"?{rows:[row],total:1}:method==="contest_score"?{score:current.score}:null;
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await userEvent.click(await screen.findByRole("button",{name:"New Contest"}));
  fireEvent.change(screen.getByLabelText("Log Type"),{target:{value:pluginID}});
  await userEvent.click(screen.getByRole("button",{name:"OK"}));
  await waitFor(()=>expect(surfaceOwner.current.projections.logbook.page.rows).toHaveLength(1));
  const logbook=surfaceOwner.current.projections.logbook;
  expect(logbook).toMatchObject({exchangeLayout:"plugin",pluginColumns:columns,
    pluginRows:[{qsoID:row.ID,values}],pluginPartialRows:[],page:{rows:[{receivedExchange,...(multiplierLabels ? {multiplierLabels} : {})}]}});
  expect(logbook).not.toHaveProperty("manualRows");
  expect(validContestSurfaceProjection("logbook",logbook)).toBe(true);
  if(correction){
    await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
      panelID:"logbook",projectionRevision:current.revision,requestID:crypto.randomUUID(),action:"log_edit_begin",params:{qsoID:row.ID}}));
    expect(surfaceOwner.current.projections.logbook.editing.receivedFields).toEqual(correction);
  }
});

it("creates an SSB session from catalog metadata and runs ESM without native CW admission", async () => {
  const current={...projection(3,{sent:"59",receive:"59",other_1:"001",other_2:"012"}),pluginID:"oceania_dx_ssb",
    pluginName:"Oceania DX SSB",mode:"SSB",supportedModes:["SSB"],reservedSerial:1,allowDuplicateCommit:true,matrixTrackers:[]};
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    const result=method==="contest_catalog"?{plugins:[{id:"cq_ww_cw",name:"CQ WW CW",modes:["CW"]},
      {id:"oceania_dx_ssb",name:"Oceania DX SSB",modes:["SSB"]}]}:
      method==="contest_sessions"?{sessions:[]}:method==="contest_create"||method==="contest_esm"?{projection:current,actions:[],messages:[]}:
      method==="contest_log_page"?{rows:[],total:0}:method==="contest_score"?{score:current.score}:null;
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await userEvent.click(await screen.findByRole("button",{name:"New Contest"}));
  fireEvent.change(screen.getByLabelText("Log Type"),{target:{value:"oceania_dx_ssb"}});
  expect((screen.getByLabelText("Mode") as HTMLSelectElement).value).toBe("SSB");
  expect((screen.getByLabelText("Mode") as HTMLSelectElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole("button",{name:"OK"}));
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].draft.mode).toBe("SSB"));
  const entry=surfaceOwner.current.projections["active-qso"];
  expect(entry).toMatchObject({descriptor:{modes:["SSB"],reportsVisible:true},
    draft:{sentReport:"59",receivedReport:"59"},operator:{armed:false,functionKeys:[],readiness:{canSendCQ:false}}});
  expect(request.mock.calls.find(([method])=>method==="contest_create")?.[1]?.settings).toMatchObject({ModeCategory:"SSB"});
  await act(async()=>{await surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:3,key:"Enter",focusedField:"other_2"}});});
  expect(request.mock.calls.some(([method])=>method==="contest_esm")).toBe(true);
  expect(nativeCW.execute).not.toHaveBeenCalled();
});

it.each([
  {pluginID:"cq_ww_ssb",pluginName:"CQ WW SSB",other1:"15",other2:"5",reservedSerial:null,esmPayload:"59 15"},
  {pluginID:"cq_wpx_ssb",pluginName:"CQ WPX SSB",other1:"001",other2:"123",reservedSerial:1,esmPayload:"59 001"},
  {pluginID:"arrl_ss_phone",pluginName:"ARRL Sweepstakes Phone",other1:"001",other2:"123 A K1ABC 67 CT",reservedSerial:1,esmPayload:"K1ABC 001 A OM0RX 67 CT"},
])("simulates only claimed $pluginName voice-keyer intents in Contesting Test", async ({pluginID,pluginName,other1,other2,reservedSerial,esmPayload}) => {
  let current={...projection(3,{sent:"59",receive:"59",other_1:other1,other_2:other2}),pluginID,
    pluginName,mode:"SSB",supportedModes:["SSB"] as const,reservedSerial,matrixTrackers:[] as Array<"countries"|"zones">};
  current.functionKeys=Array.from({length:12},(_,index)=>({id:`F${index+1}`,highlighted:false,label:index===11?"His call TU":`Message ${index+1}`}));
  let lastActions:any[]=[],completedClaims=0,claimMode:"normal"|"stop"|"recover"|"uncertain"|"double-uncertain"="normal",recoverAttempts=0,
    refreshMode:"hang"|"update"="hang",logged=false,releaseStale:Array<()=>void>=[],mutationMode:"normal"|"hold"|"hold-late"|"hold-fail"="normal",
    releaseMutation:(()=>void)|null=null,rejectMutation:(()=>void)|null=null,mutationRevisions:number[]=[],holdSetup=false,
    releaseSetup:(()=>void)|null=null,openedProjection:typeof current|null=null;
  const request=vi.fn(async(method:string,params:Record<string,any>={})=>{
    if(method==="contest_setup_get"&&holdSetup){
      const support=workspaceSupport(method,params,current);return new Promise(resolve=>{releaseSetup=()=>resolve(support);});
    }
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    let result:any;
    if(method==="contest_catalog")result={plugins:[{id:pluginID,name:pluginName,modes:["SSB"]}]};
    else if(method==="contest_sessions")result={sessions:[{sessionID:current.sessionID,workspaceGeneration:current.workspaceGeneration,
      name:pluginName,pluginID,sourceRevision:current.sourceRevision,revision:current.revision}]};
    else if(method==="contest_create")result={projection:current};
    else if(method==="contest_open")result={projection:openedProjection??current};
    else if(method==="contest_log_page")return completedClaims&&refreshMode==="hang" ? new Promise(resolve=>releaseStale.push(()=>resolve({
      id:crypto.randomUUID(),ok:true,result:{rows:[],total:99,offset:0}}))) : {id:crypto.randomUUID(),ok:true,
      result:{rows:logged?[{ID:"qso-1",TS:"2026-10-21 00:00:00",Call:"K1ABC",Freq:14250,Band:14,Mode:"SSB",SNT:"59",RCV:"59",
        SentNr:1,NR:"123",Points:1,WPXPrefix:"K1"}]:[],total:logged?1:0,offset:0}};
    else if(method==="contest_score")return completedClaims&&refreshMode==="hang" ? new Promise(resolve=>releaseStale.push(()=>resolve({
      id:crypto.randomUUID(),ok:true,result:{sessionID:current.sessionID,revision:current.revision-1,
        score:{...current.score,qsos:99,total:99},matrices:{},statistics:statisticsFor(current)}}))) : {id:crypto.randomUUID(),ok:true,
      result:{sessionID:current.sessionID,revision:current.revision,score:current.score,matrices:{},statistics:statisticsFor(current)}};
    else if(method==="contest_function_key"||method==="contest_esm"){
      mutationRevisions.push(params.expectedRevision);
      if(params.expectedRevision!==current.revision)throw new Error(`stale expectedRevision ${params.expectedRevision}; current ${current.revision}`);
      const next={...current,revision:current.revision+1};
      if(method==="contest_esm"){
        logged=true;next.score={...next.score,qsos:1,points:1,total:1};
      }
      const key=method==="contest_esm"?"F3":String(params.key),label=method==="contest_esm"?"Exchange":key==="F12"?"His call TU":`Message ${key.slice(1)}`;
      const payload=method==="contest_esm"?esmPayload:"K1ABC rr tu";
      lastActions=[{actionID:`${params.operationID}:0`,kind:"voice_keyer",signal:"phone",mode:"SSB",key,label,payload,
        payloadUTF8Bytes:new TextEncoder().encode(payload).byteLength,payloadSHA256:"0".repeat(64),sourceMacroSHA256:"1".repeat(64),
        sourceMacro:{origin:"pinned_not1mm",path:"not1mm/data/cwmacros.txt",revision:next.sourceRevision,mode:"S",key,label,template:payload},
        sessionID:next.sessionID,draftID:next.draftID}];
      result={operationID:params.operationID,revision:next.revision,projection:next,actions:lastActions,messages:[],replayed:false};
      if(mutationMode!=="normal"){
        const fail=mutationMode==="hold-fail",late=mutationMode==="hold-late";mutationMode="normal";
        if(!late)current=next;
        return new Promise((resolve,reject)=>{
          releaseMutation=()=>{if(late)current=next;resolve({id:crypto.randomUUID(),ok:true,result});};
          if(fail)rejectMutation=()=>reject(new Error("The original mutation outcome is uncertain."));
        });
      }
      current=next;
    } else if(method==="contest_output_claim"){
      if(claimMode==="stop")return new Promise(()=>{});
      if(claimMode==="recover"){
        recoverAttempts+=1;if(recoverAttempts===1)return new Promise(()=>{});
        return{id:crypto.randomUUID(),ok:false,error:{code:"output_consumed",
          message:"Output was already consumed; do not replay",outcome:"confirmed"}};
      }
      if(claimMode==="uncertain"){
        recoverAttempts+=1;if(recoverAttempts===1)return{id:crypto.randomUUID(),ok:false,error:{code:"contest_host_timeout",
          message:"Claim confirmation was lost",outcome:"uncertain"}};
        return{id:crypto.randomUUID(),ok:false,error:{code:"output_consumed",
          message:"Output was already consumed; do not replay",outcome:"confirmed"}};
      }
      if(claimMode==="double-uncertain"){
        recoverAttempts+=1;return{id:crypto.randomUUID(),ok:false,error:{code:"contest_host_timeout",
          message:"Claim confirmation remains unknown",outcome:"uncertain"}};
      }
      completedClaims+=1;result={claimed:true,operationID:params.operationID,actions:lastActions};
    }
    else throw new Error(method);
    return{id:crypto.randomUUID(),ok:true,result};
  });
  const view=render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} contestingTest/>);
  await createContestThroughSetup();
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].operator.functionKeys).toHaveLength(12));
  let entry=surfaceOwner.current.projections["active-qso"];
  const envelope={operatingContext,sessionID:current.sessionID,workspaceGeneration,action:"entry_operator_arm"} as const;
  const beginReopenCurrentSession=async()=>{
    const opensBefore=request.mock.calls.filter(([method])=>method==="contest_open").length;
    refreshMode="update";
    await userEvent.click(screen.getByRole("button",{name:"Select contest"}));
    await userEvent.click(screen.getByRole("button",{name:"Choose a Contest"}));
    await userEvent.click(screen.getByRole("radio",{name:pluginName}));
    await userEvent.click(screen.getByRole("button",{name:"OK"}));
    await waitFor(()=>expect(request.mock.calls.filter(([method])=>method==="contest_open")).toHaveLength(opensBefore+1));
  };
  const reopenCurrentSession=async()=>{
    await beginReopenCurrentSession();
    await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].draft.revision).toBe(current.revision));
  };
  await act(async()=>surfaceOwner.current.handle({...envelope,params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,armed:true}}));
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].operator.armed).toBe(true));
  entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"F12",focusedField:"callsign"}}));
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].operator.trace[0]).toMatchObject({mode:"SSB",macro:"His call TU",text:"K1ABC rr tu",status:"confirmed"}));
  entry=surfaceOwner.current.projections["active-qso"];
  refreshMode="update";
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"Enter",focusedField:"other_2"}}));
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].operator.trace[1]).toMatchObject({
    mode:"SSB",macro:"Exchange",text:esmPayload,status:"confirmed"}));
  await waitFor(()=>expect(surfaceOwner.current.projections.logbook.page.total).toBe(1));
  expect(surfaceOwner.current.projections.propagation.score).toMatchObject({qsos:1,points:1,claimedScore:1});
  const firstStale=releaseStale.splice(0,2);await act(async()=>firstStale.forEach(release=>release()));
  expect(surfaceOwner.current.projections.logbook.page.total).toBe(1);
  expect(surfaceOwner.current.projections.propagation.score).toMatchObject({qsos:1,claimedScore:1});
  expect(request.mock.calls.filter(([method])=>method==="contest_output_claim")).toHaveLength(2);
  expect(request.mock.calls.some(([method])=>method==="contest_function_key")).toBe(true);
  expect(request.mock.calls.some(([method])=>method==="contest_esm")).toBe(true);
  expect(nativeCW.execute).not.toHaveBeenCalled();
  expect(workspaceProps.stationTune).not.toHaveBeenCalled();
  expect(surfaceOwner.current.projections["active-qso"]).toMatchObject({busy:false,operator:{pending:null,status:"armed"}});

  refreshMode="hang";claimMode="stop";
  entry=surfaceOwner.current.projections["active-qso"];
  let stopped:Promise<void>;
  act(()=>{stopped=surfaceOwner.current.handle({...envelope,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"F3",focusedField:"callsign"}});});
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].operator.status).toBe("waiting"));
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"Escape",focusedField:"callsign"}}));
  await act(async()=>stopped!);
  expect(surfaceOwner.current.projections["active-qso"]).toMatchObject({busy:false,operator:{armed:false,pending:null,status:"disarmed"}});
  expect(surfaceOwner.current.projections["active-qso"].operator.trace).toHaveLength(2);

  entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"entry_operator_arm",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,armed:true}}));
  claimMode="recover";
  entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"F3",focusedField:"callsign"}}));
  expect(recoverAttempts).toBeGreaterThanOrEqual(2);
  expect(surfaceOwner.current.projections["active-qso"]).toMatchObject({busy:false,operator:{pending:null,status:"armed"}});
  expect(surfaceOwner.current.projections["active-qso"].operator.trace).toHaveLength(3);

  claimMode="uncertain";recoverAttempts=0;
  entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"F6",focusedField:"callsign"}}));
  expect(recoverAttempts).toBe(2);
  expect(surfaceOwner.current.projections["active-qso"].operator.trace).toHaveLength(4);

  claimMode="normal";mutationMode="hold";
  entry=surfaceOwner.current.projections["active-qso"];
  let interrupted:Promise<void>;
  act(()=>{interrupted=surfaceOwner.current.handle({...envelope,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"F4",focusedField:"callsign"}});});
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].operator.status).toBe("waiting"));
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"Escape",focusedField:"callsign"}}));
  await act(async()=>interrupted!);
  entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"entry_operator_arm",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,armed:true}}));
  const mutationsBefore=mutationRevisions.length;
  let afterRecovery:Promise<void>;
  act(()=>{afterRecovery=surfaceOwner.current.handle({...envelope,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"F5",focusedField:"callsign"}});});
  await act(async()=>Promise.resolve());
  expect(mutationRevisions).toHaveLength(mutationsBefore);
  await act(async()=>releaseMutation?.());
  await act(async()=>afterRecovery!);
  expect(mutationRevisions.at(-1)).toBe(current.revision-1);
  expect(surfaceOwner.current.projections["active-qso"].operator.trace).toHaveLength(5);

  mutationMode="hold-late";
  entry=surfaceOwner.current.projections["active-qso"];
  act(()=>{interrupted=surfaceOwner.current.handle({...envelope,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"F6",focusedField:"callsign"}});});
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].operator.status).toBe("waiting"));
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"Escape",focusedField:"callsign"}}));
  await act(async()=>interrupted!);
  openedProjection=current;holdSetup=true;
  await beginReopenCurrentSession();
  await waitFor(()=>expect(releaseSetup).toBeTypeOf("function"));
  await act(async()=>releaseMutation?.());
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].draft.revision).toBe(current.revision));
  const recoveredRevision=current.revision;
  await act(async()=>releaseSetup?.());holdSetup=false;openedProjection=null;
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"]).toMatchObject({busy:false,draft:{revision:recoveredRevision}}));
  expect(request.mock.calls.filter(([method])=>method==="contest_log_page").at(-1)?.[1]).toMatchObject({expectedRevision:recoveredRevision});
  entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"entry_operator_arm",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,armed:true}}));

  mutationMode="hold-fail";
  entry=surfaceOwner.current.projections["active-qso"];
  act(()=>{interrupted=surfaceOwner.current.handle({...envelope,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"F7",focusedField:"callsign"}});});
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].operator.status).toBe("waiting"));
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"Escape",focusedField:"callsign"}}));
  await act(async()=>interrupted!);
  entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"entry_operator_arm",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,armed:true}}));
  const uncertainBefore=mutationRevisions.length;
  let blocked:Promise<void>;
  act(()=>{blocked=surfaceOwner.current.handle({...envelope,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"F8",focusedField:"callsign"}});});
  const blockedAssertion=expect(blocked!).rejects.toThrow("Reopen the contest session to reconcile its revision");
  await act(async()=>Promise.resolve());expect(mutationRevisions).toHaveLength(uncertainBefore);
  await act(async()=>rejectMutation?.());
  await act(async()=>{await blockedAssertion;});
  expect(mutationRevisions).toHaveLength(uncertainBefore);

  await reopenCurrentSession();
  const firstOpenedRevision=current.revision;
  claimMode="normal";
  entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"F9",focusedField:"callsign"}}));
  expect(mutationRevisions.at(-1)).toBe(firstOpenedRevision);

  claimMode="double-uncertain";recoverAttempts=0;
  entry=surfaceOwner.current.projections["active-qso"];
  let doubleClaimError:unknown;
  await act(async()=>{try { await surfaceOwner.current.handle({...envelope,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"F10",focusedField:"callsign"}}); }
    catch(cause) { doubleClaimError=cause; }});
  expect(doubleClaimError).toEqual(expect.objectContaining({message:expect.stringContaining("Reopen the contest session to reconcile its revision")}));
  expect(recoverAttempts).toBe(2);
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].draft.revision).toBe(current.revision));
  const doubleUncertainBefore=mutationRevisions.length;
  entry=surfaceOwner.current.projections["active-qso"];
  await expect(surfaceOwner.current.handle({...envelope,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"F11",focusedField:"callsign"}}))
    .rejects.toThrow("Reopen the contest session to reconcile its revision");
  expect(mutationRevisions).toHaveLength(doubleUncertainBefore);

  await reopenCurrentSession();
  const secondOpenedRevision=current.revision;
  claimMode="normal";
  entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"F12",focusedField:"callsign"}}));
  expect(mutationRevisions.at(-1)).toBe(secondOpenedRevision);

  const generationBase=current,nextGeneration="55555555-5555-4555-8555-555555555555";
  mutationMode="hold";
  entry=surfaceOwner.current.projections["active-qso"];
  act(()=>{interrupted=surfaceOwner.current.handle({...envelope,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"F2",focusedField:"callsign"}});});
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].operator.status).toBe("waiting"));
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"entry_operator_key",
    params:{draftID:generationBase.draftID,expectedDraftRevision:generationBase.revision,key:"Escape",focusedField:"callsign"}}));
  await act(async()=>interrupted!);
  openedProjection={...generationBase,workspaceGeneration:nextGeneration};
  view.rerender(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}
    workspaceGeneration={nextGeneration} contestingTest/>);
  await beginReopenCurrentSession();
  await waitFor(()=>expect(surfaceOwner.current).toMatchObject({context:{workspaceGeneration:nextGeneration},
    projections:{"active-qso":{busy:false,draft:{revision:generationBase.revision}}}}));
  await act(async()=>releaseMutation?.());
  await act(async()=>Promise.resolve());
  expect(surfaceOwner.current).toMatchObject({context:{workspaceGeneration:nextGeneration},
    projections:{"active-qso":{draft:{revision:generationBase.revision}}}});
});

it.each([
  {pluginID:"cq_ww_ssb",pluginName:"CQ WW SSB"},
  {pluginID:"cq_wpx_ssb",pluginName:"CQ WPX SSB"},
  {pluginID:"arrl_ss_phone",pluginName:"ARRL Sweepstakes Phone"},
])("keeps production $pluginName voice intents inert before the worker mutation", async ({pluginID,pluginName}) => {
  const current={...projection(3,{sent:"59",receive:"59",other_1:"001"}),pluginID,pluginName,
    mode:"SSB",supportedModes:["SSB"] as const,reservedSerial:pluginID==="cq_ww_ssb"?null:1,matrixTrackers:[] as Array<"countries"|"zones">};
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    const result=method==="contest_catalog"?{plugins:[{id:pluginID,name:pluginName,modes:["SSB"]}]}:
      method==="contest_sessions"?{sessions:[]}:method==="contest_create"?{projection:current}:
      method==="contest_log_page"?{rows:[],total:0}:method==="contest_score"?{score:current.score}:null;
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();
  const entry=surfaceOwner.current.projections["active-qso"];
  expect(entry.operator.functionKeys).toEqual([]);
  await expect(surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"F1",focusedField:"callsign"}})).rejects.toThrow("unavailable in production");
  expect(request.mock.calls.some(([method])=>method==="contest_function_key")).toBe(false);
  expect(request.mock.calls.some(([method])=>method==="contest_output_claim")).toBe(false);
});

it("runs detached Shift-F1 Auto CQ immediately in Run and cancels it on callsign input",async()=>{
  const saved=newContestSetup("OM0RX");saved.pluginID="cq_ww_ssb";saved.name="CQ WW SSB";saved.settings.ModeCategory="SSB";
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1",JSON.stringify(saved));
  let current:any={...projection(),pluginID:"cq_ww_ssb",pluginName:"CQ WW SSB",mode:"SSB",supportedModes:["SSB"],run:false,
    fields:projection().fields.map(field=>({...field,value:field.id==="sent"||field.id==="receive"?"59":field.value})),matrixTrackers:[]};
  let outputActions:any[]=[];
  const request=vi.fn(async(method:string,params:Record<string,any>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    let result:any;
    if(method==="contest_catalog")result={plugins:[{id:"cq_ww_ssb",name:"CQ WW SSB",modes:["SSB"]}]};
    else if(method==="contest_sessions")result={sessions:[]};
    else if(method==="contest_create")result={projection:current};
    else if(method==="contest_log_page")result={rows:[],total:0};
    else if(method==="contest_score")result={sessionID:current.sessionID,revision:current.revision,score:current.score,matrices:{},statistics:statisticsFor(current)};
    else if(method==="contest_run_state"){
      current={...current,revision:current.revision+1,run:params.run};result={projection:current,actions:[],messages:[]};
    } else if(method==="contest_function_key"){
      current={...current,revision:current.revision+1};
      outputActions=[{actionID:`${params.operationID}:0`,kind:"voice_keyer",signal:"phone",mode:"SSB",key:params.key,label:"CQ",payload:"CQ OM0RX",
        payloadUTF8Bytes:8,payloadSHA256:"0".repeat(64),sourceMacroSHA256:"1".repeat(64),sourceMacro:{origin:"pinned_not1mm",path:"not1mm/data/cwmacros.txt",
          revision:current.sourceRevision,mode:"R",key:params.key,label:"CQ",template:"CQ {MYCALL}"},sessionID:current.sessionID,draftID:current.draftID}];
      result={operationID:params.operationID,revision:current.revision,projection:current,actions:outputActions,messages:[],replayed:false};
    } else if(method==="contest_output_claim")result={claimed:true,operationID:params.operationID,actions:outputActions};
    else if(method==="contest_draft_apply"){
      current={...current,revision:current.revision+1,fields:current.fields.map((field:any)=>({...field,value:params.fields[field.id]??field.value}))};
      result={projection:current,actions:[],messages:[]};
    } else throw new Error(method);
    return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} contestingTest/>);
  await createContestThroughSetup();let entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,action:"entry_operator_arm",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,armed:true}}));
  entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,action:"entry_operator_key",
    requestID:"auto-cq-start",params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"F1",focusedField:"callsign",shifted:true}}));
  expect(request.mock.calls.filter(([method])=>method==="contest_function_key")).toHaveLength(1);
  expect(surfaceOwner.current.projections["active-qso"]).toMatchObject({operator:{style:"run",autoCQ:{active:true,delaySeconds:15}}});
  entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,action:"entry_set_text",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,field:"callsign",value:"K1ABC"}}));
  expect(surfaceOwner.current.projections["active-qso"]).toMatchObject({operator:{armed:false,autoCQ:{active:false}}});
});

it("projects only configured bands into detached Main Logging", async () => {
  const current = projection();
  const saved = newContestSetup("OM0RX");
  saved.preferences.bands = ["40m", "20m", "2m"];
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1", JSON.stringify(saved));
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const support = workspaceSupport(method, params, current); if (support) return support;
    if (method === "contest_scp_status") return unavailableSCP();
    if (method === "contest_history_status") return unavailableHistory();
    const result = method === "contest_catalog" ? { plugins: [{ id: "cq_ww_cw", name: "CQ WW CW" }] }
      : method === "contest_sessions" ? { sessions: [] }
      : method === "contest_create" ? { projection: current }
      : method === "contest_log_page" ? { rows: [], total: 0 }
      : method === "contest_score" ? { score: current.score }
      : method === "contest_check_partial" ? { query: "", rows: [], total: 0 } : null;
    if (!result) throw new Error(method);
    return { id: crypto.randomUUID(), ok: true, result };
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();
  await waitFor(() => expect(surfaceOwner.current.projections["active-qso"].descriptor.bands).toEqual(["40m", "20m", "2m"]));
});

it.each(["log", "cluster"])("applies %s Check Partial only through the revision-fenced Python draft",async kind=>{
  let current=projection(9,{callsign:"DL1"});
  let partialAvailable=true;
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    let result:any=method==="contest_catalog"?{plugins:[]}:method==="contest_sessions"?{sessions:[]}:
      method==="contest_create"?{projection:current}:method==="contest_log_page"?{rows:[],total:0}:
      method==="contest_score"?{score:current.score}:method==="contest_check_partial"?{rows:partialAvailable?[{ID:"off-page",Call:"DL1ABC"}]:[]}:null;
    if(method==="contest_draft_apply"){
      current={...projection(current.revision+1,{...(params.fields as Record<string,string>),other_2:"14"}),dupe:true,
        functionKeys:current.functionKeys.map(key=>({...key,highlighted:key.id==="F6",label:key.id==="F6"?"QSOB4":key.id}))};
      result={projection:current,actions:[],messages:[]};
    }
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  const props={...workspaceProps,request,serviceRequest:request};
  const view=render(<Not1MMContestWorkspace {...props} spots={[{callsign:"DL1ABC"} as any]}/>);
  await createContestThroughSetup();
  const key=kind==="log"?"loggedCandidates":"clusterCandidates";
  await waitFor(()=>expect(surfaceOwner.current.projections["callsign-intelligence"][key]).toEqual([{candidateID:`${kind}:DL1ABC`,callsign:"DL1ABC"}]));
  const envelope={operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"callsign-intelligence",projectionRevision:1,requestID:crypto.randomUUID(),action:"assistance_select",
    params:{draftID:current.draftID,expectedDraftRevision:9,kind,candidateID:`${kind}:DL1ABC`}};
  await expect(surfaceOwner.current.handle({...envelope,params:{...envelope.params,expectedDraftRevision:8}})).rejects.toThrow("entry changed");
  await expect(surfaceOwner.current.handle({...envelope,params:{...envelope.params,candidateID:`${kind}:DL1GONE`}})).rejects.toThrow("no longer available");
  expect(request.mock.calls.filter(([method])=>method==="contest_draft_apply")).toHaveLength(0);
  partialAvailable=false;
  await act(async()=>surfaceOwner.current.handle(envelope));
  expect(request.mock.calls.filter(([method])=>method==="contest_draft_apply")).toHaveLength(1);
  expect(request.mock.calls.find(([method])=>method==="contest_draft_apply")?.[1]).toMatchObject({
    expectedRevision:9,draftID:current.draftID,frequencyHz:14_025_000,fields:{callsign:"DL1ABC"}});
  expect(surfaceOwner.current.projections["active-qso"].draft).toMatchObject({callsign:"DL1ABC",dupe:{state:"duplicate"}});
  expect(surfaceOwner.current.projections["active-qso"].draft.receivedFields).toContainEqual(expect.objectContaining({value:"14"}));
  expect(surfaceOwner.current.projections["active-qso"].operator.functionKeys).toContainEqual({key:"F6",macro:"QSOB4"});
  await expect(surfaceOwner.current.handle(envelope)).rejects.toThrow("entry changed");
  view.rerender(<Not1MMContestWorkspace {...props} spots={[]}/>);
  await waitFor(()=>expect(surfaceOwner.current.projections["callsign-intelligence"][key]).toEqual([]));
  const missing={...envelope,requestID:crypto.randomUUID(),params:{...envelope.params,expectedDraftRevision:current.revision}};
  await expect(surfaceOwner.current.handle(missing)).rejects.toThrow("no longer available");
  expect(workspaceProps.stationTune).not.toHaveBeenCalled();
  expect(nativeCW.execute).not.toHaveBeenCalled();
});

it("applies a contest-window spot only to the active Not1MM draft and tunes exactly once",async()=>{
  let current=projection();
  const tune=vi.fn(async()=>({accepted:true,confirmed:true}));
  const spot={id:"spot-1",callsign:"DL1ABC",frequencyKHz:14025,band:"20m",mode:"CW"};
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    let result:any=method==="contest_catalog"?{plugins:[]}:method==="contest_sessions"?{sessions:[]}:
      method==="contest_create"?{projection:current}:method==="contest_log_page"?{rows:[],total:0}:
      method==="contest_score"?{score:current.score}:null;
    if(method==="contest_draft_apply"){
      current={...projection(current.revision+1,params.fields as Record<string,string>),frequencyHz:Number(params.frequencyHz)};
      result={projection:current,actions:[],messages:[]};
    }
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} stationTune={tune} spots={[spot]}
    cluster={{snapshot:{connectedClusters:1,loadedSpots:25}}}/>);
  await createContestThroughSetup();
  await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"].spots).toHaveLength(1));
  expect(surfaceOwner.current.projections["dx-cluster"]).toMatchObject({connectedClusters:1,loadedSpots:25});
  const envelope={operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,panelID:"band-maps",
    projectionRevision:1,requestID:crypto.randomUUID(),action:"spot_select",params:{draftID:current.draftID,expectedDraftRevision:current.revision,spotID:"spot-1"}};
  await expect(surfaceOwner.current.handle({...envelope,params:{...envelope.params,expectedDraftRevision:current.revision-1}})).rejects.toThrow("entry changed");
  expect(tune).not.toHaveBeenCalled();
  await act(async()=>surfaceOwner.current.handle(envelope));
  expect(tune).toHaveBeenCalledExactlyOnceWith(14_025_000,"CW");
  expect(request.mock.calls.filter(([method])=>method==="contest_draft_apply")).toHaveLength(1);
  expect(request.mock.calls.some(([method])=>method==="activate_spot")).toBe(false);
});

it.each(["band-maps","dx-cluster"])("returns tune and draft failures to the originating detached %s action",async panelID=>{
  let current=projection(), failure:"tune"|"draft"|"uncertain"="tune";
  const spot={id:"spot-1",callsign:"DL1ABC",frequencyKHz:14025,band:"20m",mode:"CW"};
  const tune=vi.fn(async()=>{if(failure==="tune")throw new Error("Radio tune was not confirmed");return {accepted:true,confirmed:true};});
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    if(method==="contest_draft_apply")return{id:crypto.randomUUID(),ok:false,error:{code:"contest_revision",message:"Draft changed after tune",
      outcome:failure==="uncertain"?"uncertain":"confirmed"}};
    const result=method==="contest_catalog"?{plugins:[]}:method==="contest_sessions"?{sessions:[]}:
      method==="contest_create"?{projection:current}:method==="contest_log_page"?{rows:[],total:0}:
      method==="contest_score"?{score:current.score}:null;
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  const selected=vi.fn();
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} stationTune={tune} spots={[spot]} onSelectedSpot={selected}/>);
  await createContestThroughSetup();
  const envelope={operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,panelID,
    projectionRevision:1,requestID:crypto.randomUUID(),action:"spot_select",params:{draftID:current.draftID,expectedDraftRevision:current.revision,spotID:"spot-1"}};
  await act(async()=>{await expect(surfaceOwner.current.handle(envelope)).rejects.toThrow("Radio tune was not confirmed");});
  expect(request.mock.calls.filter(([method])=>method==="contest_draft_apply")).toHaveLength(0);
  failure="draft";
  await act(async()=>{await expect(surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID()})).rejects.toThrow("Draft changed after tune");});
  failure="uncertain";
  await act(async()=>{await expect(surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID()})).rejects.toBeInstanceOf(ContestMutationUncertain);});
  expect(tune).toHaveBeenCalledTimes(3);
  expect(selected).not.toHaveBeenCalled();
});

it.each(["", "10.1", "invalid"])("admits an offline contest only after the operator enters a valid manual frequency (initial %j)", async initial => {
  let current = projection();
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const support = workspaceSupport(method, params, current); if (support) return support;
    if (method === "contest_scp_status") return unavailableSCP();
    if (method === "contest_history_status") return unavailableHistory();
    let result: any;
    if (method === "contest_catalog") result = { plugins: [{ id:"cq_ww_cw", name:"CQ WW CW" }] };
    else if (method === "contest_sessions") result = { sessions:[] };
    else if (method === "contest_create") {
      current = { ...current, frequencyHz: Number(params.frequencyHz), band: 7 };
      result = { projection:current };
    } else if (method === "contest_log_page") result = { rows:[], total:0 };
    else if (method === "contest_score") result = { score:current.score };
    else throw new Error(`Unexpected ${method}`);
    return { id:crypto.randomUUID(), ok:true, result };
  });
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps} radioFrequencyHz={undefined}/>);
  fireEvent.change(screen.getByRole("textbox", {name:"Manual frequency MHz"}), {target:{value:initial}});
  await createContestThroughSetup();
  expect(await screen.findByText("Connect the selected radio or enter a valid HF contest frequency before creating a contest.")).toBeTruthy();
  expect(screen.queryByText("Contest created.")).toBeNull();
  expect(request.mock.calls.some(([method]) => method === "contest_create")).toBe(false);
  expect(screen.getByRole("button", {name:"OK"})).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", {name:"Manual frequency MHz"}), {target:{value:"7.025125"}});
  await userEvent.click(screen.getByRole("button", {name:"OK"}));
  await waitFor(() => expect(request.mock.calls.some(([method]) => method === "contest_create")).toBe(true));
  expect(request.mock.calls.find(([method]) => method === "contest_create")?.[1]).toMatchObject({frequencyHz:7_025_125});
  expect(screen.getByRole("heading", { name:"Contest Setup", level:1 })).toBeTruthy();
});

it("restores the saved manual frequency when reopening a session without CAT", async () => {
  const current = projection();
  localStorage.setItem("xlog.contesting.not1mm.active-session.v1", current.sessionID);
  let transition: any;
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const support = workspaceSupport(method, params, current); if (support) return support;
    if (method === "contest_scp_status") return unavailableSCP();
    if (method === "contest_history_status") return unavailableHistory();
    const result = method === "contest_catalog" ? {plugins:[]} : method === "contest_sessions"
      ? {sessions:[{...current,name:"Saved contest"}]} : method === "contest_open" ? {projection:current}
      : method === "contest_log_page" ? {rows:[],total:0} : method === "contest_score" ? {score:current.score} : null;
    if (!result) throw new Error(`Unexpected ${method}`);
    return {id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} radioFrequencyHz={undefined}
    registerTransition={value => {transition = value;}}/>);
  await screen.findByText("Contest windows are ready");
  expect(request.mock.calls.find(([method]) => method === "contest_open")?.[1]).toMatchObject({
    sessionID: current.sessionID, workspaceGeneration: current.workspaceGeneration,
  });
  await act(async () => { await expect(transition.prepare()).resolves.toBeUndefined(); });
  expect(request.mock.calls.some(([method]) => method === "contest_draft_apply")).toBe(false);
});

it("clears prior-session log rows when a newly opened session cannot refresh its log",async()=>{
  const first={...projection(),sessionID:"11111111-1111-4111-8111-111111111111",pluginName:"CQ WW CW",
    columns:["YYYY-MM-DD HH:MM:SS","Call","Freq","Snt","Rcv","SentNr","RcvNr","PTS"]};
  const second={...projection(2),sessionID:"22222222-2222-4222-8222-222222222222",draftID:"44444444-4444-4444-8444-444444444444",
    pluginID:"arrl_ss_cw",pluginName:"ARRL Sweepstakes CW",
    columns:["YYYY-MM-DD HH:MM:SS","Call","Freq","Snt","Rcv","SentNr","RcvNr","CK","Prec","Sect","M1","PTS"]};
  const sessions=[{...first,name:"First contest"},{...second,name:"Second contest"}];
  const oldRow={ID:"old-qso",TS:"2026-10-20 01:00:00",Call:"DL1ABC",Freq:14025,SNT:"599",RCV:"599",SentNr:1,NR:14,Points:3,
    Band:14,Mode:"CW"};
  localStorage.setItem("xlog.contesting.not1mm.active-session.v1",first.sessionID);
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    if(method==="contest_catalog")return{id:crypto.randomUUID(),ok:true,result:{plugins:[{id:"cq_ww_cw",name:"CQ WW CW"},{id:"arrl_ss_cw",name:"ARRL Sweepstakes CW"}]}};
    if(method==="contest_sessions")return{id:crypto.randomUUID(),ok:true,result:{sessions}};
    if(method==="contest_open")return{id:crypto.randomUUID(),ok:true,result:{projection:params.sessionID===first.sessionID?first:second}};
    if(method==="contest_setup_get")return{id:crypto.randomUUID(),ok:true,result:{setup:{...newContestSetup("OM0RX"),pluginID:params.sessionID===first.sessionID?first.pluginID:second.pluginID}}};
    if(method==="contest_log_page"){
      if(params.sessionID===first.sessionID)return{id:crypto.randomUUID(),ok:true,result:{rows:[oldRow],offset:0,total:1}};
      throw new Error("Second contest log is temporarily unavailable.");
    }
    if(method==="contest_score"){const active=params.sessionID===first.sessionID?first:second;return{id:crypto.randomUUID(),ok:true,result:{
      sessionID:active.sessionID,revision:active.revision,score:active.score,matrices:{countries:[],zones:[]},statistics:statisticsFor(active)}};}
    if(method==="contest_rates")return{id:crypto.randomUUID(),ok:true,result:{lastHourQsoPerHour:null,last10QsoPerHour:null,last100QsoPerHour:null,
      sinceHourUTC:0,sinceHourQso:0,runQso:0,searchAndPounceQso:0,hourRunQso:0,hourSearchAndPounceQso:0}};
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    throw new Error(method);
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await waitFor(()=>expect(surfaceOwner.current.projections.logbook.pluginRows).toEqual([
    {qsoID:"old-qso",values:[oldRow.TS,oldRow.Call,"14025","599","599","1","14","3"]},
  ]));
  expect(surfaceOwner.current.projections.propagation.schemaVersion).toBe(3);
  await userEvent.click(screen.getByRole("button",{name:"Select contest"}));
  await userEvent.click(screen.getByRole("button",{name:"Choose a Contest"}));
  await userEvent.click(screen.getByRole("radio",{name:"Second contest"}));
  await userEvent.click(screen.getByRole("button",{name:"OK"}));
  expect((await screen.findByRole("alert")).textContent).toContain("Second contest log is temporarily unavailable.");
  expect(surfaceOwner.current.context.sessionID).toBe(second.sessionID);
  expect(surfaceOwner.current.projections.logbook).toMatchObject({pluginColumns:second.columns,pluginRows:[],pluginPartialRows:[],
    page:{offset:0,total:0,rows:[]}});
  expect(surfaceOwner.current.projections.propagation).toEqual({schemaVersion:1,status:"unavailable"});
});

it("defers a native contest window command until the saved session is fully restored", async () => {
  const current = projection();
  localStorage.setItem("xlog.contesting.not1mm.active-session.v1", current.sessionID);
  let finishOpen: ((value: unknown) => void) | undefined;
  const delayedOpen = new Promise(resolve => { finishOpen = resolve; });
  let finishLog: ((value: unknown) => void) | undefined;
  const delayedLog = new Promise(resolve => { finishLog = resolve; });
  let route: ((value: string) => boolean | Promise<boolean>) | null = null;
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const support = workspaceSupport(method, params, current); if (support) return support;
    if (method === "contest_scp_status") return unavailableSCP();
    if (method === "contest_history_status") return unavailableHistory();
    if (method === "contest_catalog") return {id:crypto.randomUUID(),ok:true,result:{plugins:[]}};
    if (method === "contest_sessions") return {id:crypto.randomUUID(),ok:true,
      result:{sessions:[{...current,name:"Saved contest"}]}};
    if (method === "contest_open") return delayedOpen;
    if (method === "contest_log_page") return delayedLog;
    if (method === "contest_score") return {id:crypto.randomUUID(),ok:true,result:{score:current.score,matrices:{countries:[],zones:[]}}};
    throw new Error(`Unexpected ${method}`);
  });
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}
    registerMenuRoute={handler => { route = handler; }}/>);
  await waitFor(() => expect(route).not.toBeNull());
  await expect(route!("contest-window-active-qso")).resolves.toBe(false);
  expect(surfaceWindow.open).not.toHaveBeenCalled();
  await act(async () => finishOpen?.({id:crypto.randomUUID(),ok:true,result:{projection:current}}));
  await waitFor(() => expect(surfaceOwner.current.context).toMatchObject({sessionID:current.sessionID}));
  await expect(route!("contest-window-active-qso")).resolves.toBe(false);
  expect(surfaceWindow.open).not.toHaveBeenCalled();
  await act(async () => finishLog?.({id:crypto.randomUUID(),ok:true,result:{rows:[],offset:0,limit:20,total:0}}));
  await waitFor(async () => expect(await route!("contest-window-active-qso")).toBe(true));
  expect(surfaceWindow.open).toHaveBeenCalledTimes(1);
  expect(surfaceWindow.open).toHaveBeenCalledWith(expect.objectContaining({sessionID:current.sessionID}), "active-qso");
  await expect(route!("contest-window-call-history")).resolves.toBe(true);
  expect(surfaceWindow.openHistory).toHaveBeenCalledWith(expect.objectContaining({sessionID:current.sessionID}));
  await expect(route!("contest-window-qrz-details")).resolves.toBe(true);
  expect(surfaceWindow.open).not.toHaveBeenCalledWith(expect.anything(), "qrz-details");
  expect((await screen.findByRole("alert")).textContent).toContain("Enable Show QRZ details");
});

it("does not open Main Logging until its ready projection is published", async () => {
  const current = {...projection(),pluginID:"cq_wpx_cw",pluginName:"CQ WPX CW",
    ruleIdentity:{id:"cq-wpx-cw",version:"26.10.11",edition:"not1mm-python",sourceRevision:"7c8b499225a73f7f8f792246881bd7aefc05452f"}};
  localStorage.setItem("xlog.contesting.not1mm.active-session.v1", current.sessionID);
  let releasePublication!: () => void;
  const publication = new Promise<void>(resolve => { releasePublication = resolve; });
  surfaceOwner.waitForPublication.mockReturnValueOnce(publication);
  let route: ((value: string) => boolean | Promise<boolean>) | null = null;
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const support = workspaceSupport(method, params, current); if (support) return support;
    if (method === "contest_scp_status") return unavailableSCP();
    if (method === "contest_history_status") return unavailableHistory();
    if (method === "contest_catalog") return {id:crypto.randomUUID(),ok:true,result:{plugins:[]}};
    if (method === "contest_sessions") return {id:crypto.randomUUID(),ok:true,
      result:{sessions:[{...current,name:"CQ WPX CW"}]}};
    if (method === "contest_open") return {id:crypto.randomUUID(),ok:true,result:{projection:current}};
    if (method === "contest_log_page") return {id:crypto.randomUUID(),ok:true,result:{rows:[],offset:0,limit:20,total:0}};
    if (method === "contest_score") return {id:crypto.randomUUID(),ok:true,result:{score:current.score,matrices:{countries:[],zones:[]}}};
    throw new Error(`Unexpected ${method}`);
  });
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}
    registerMenuRoute={handler => { route = handler; }}/>);
  await waitFor(() => expect(surfaceOwner.current.context).toMatchObject({sessionID:current.sessionID}));
  let completed = false;
  const opening = Promise.resolve(route!("contest-window-active-qso")).then(value => { completed = true; return value; });
  await act(async () => { await Promise.resolve(); });
  expect(surfaceOwner.waitForPublication).toHaveBeenCalledOnce();
  expect(surfaceWindow.open).not.toHaveBeenCalled();
  expect(completed).toBe(false);
  releasePublication();
  await expect(opening).resolves.toBe(true);
  expect(surfaceWindow.open).toHaveBeenCalledWith(expect.objectContaining({sessionID:current.sessionID}), "active-qso");
});

it("acknowledges a native contest window command with Setup after startup finds no session", async () => {
  let route: ((value: string) => boolean | Promise<boolean>) | null = null;
  const request = vi.fn(async (method: string) => {
    if (method === "contest_catalog") return {id:crypto.randomUUID(),ok:true,result:{plugins:[]}};
    if (method === "contest_sessions") return {id:crypto.randomUUID(),ok:true,result:{sessions:[]}};
    throw new Error(`Unexpected ${method}`);
  });
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}
    registerMenuRoute={handler => { route = handler; }}/>);
  await waitFor(() => expect(route).not.toBeNull());
  await waitFor(async () => expect(await route!("contest-window-active-qso")).toBe(true));
  expect((await screen.findByRole("alert")).textContent).toContain("Open a contest session before opening its windows.");
  expect(surfaceWindow.open).not.toHaveBeenCalled();
});

it("creates a Python CQ WW session and logs through the actual-host wire", async () => {
  let current = projection(), logged: Record<string, unknown> | null = null;
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const support = workspaceSupport(method, params, current); if (support) return support;
    if (method === "contest_scp_status") return unavailableSCP();
    if (method === "contest_history_status") return unavailableHistory();
    let result: any;
    if (method === "contest_catalog") result = { plugins: [{ id: "cq_ww_cw", name: "CQ WW CW", engine: "not1mm-python" }] };
    else if (method === "contest_sessions") result = { sessions: [] };
    else if (method === "contest_create") result = { sessionID: current.sessionID, revision: 1, projection: current, actions: [], messages: [] };
    else if (method === "contest_log_page") result = { rows: [], total: 0, revision: current.revision };
    else if (method === "contest_score") result = { score: current.score, matrices: { countries: [], zones: [] }, revision: current.revision };
    else if (method === "contest_draft_apply" || method === "contest_focus") {
      const values = method === "contest_draft_apply" ? params.fields as Record<string, string> :
        Object.fromEntries(current.fields.map(field => [field.id, field.value]));
      current = { ...projection(current.revision + 1, values), focus: method === "contest_focus" ? String(params.field) : current.focus };
      result = { projection: current, actions: [], messages: [] };
    }
    else if (method === "contest_qso_commit") { logged = params; current = projection(current.revision + 1); result = { projection: current, actions: [], messages: [] }; }
    else throw new Error(`Unexpected ${method}`);
    return { id: crypto.randomUUID(), ok: true, result };
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();
  let entry = surfaceOwner.current.projections["active-qso"];
  const envelope = { operatingContext, scope:"contesting", sessionID:current.sessionID, workspaceGeneration,
    panelID:"active-qso", projectionRevision:1, requestID:crypto.randomUUID() } as const;
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"entry_set_text",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,field:"callsign",value:"k1abc"}}));
  entry = surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"entry_set_exchange",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,fieldID:"other_2",value:"5"}}));
  entry = surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"entry_focus",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,fieldID:"other_2"}}));
  entry = surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"entry_commit",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision}}));
  await waitFor(() => expect(logged).not.toBeNull());
  expect(logged).toMatchObject({ sessionID: current.sessionID, fields: { callsign: "K1ABC", other_2: "5" }, frequencyHz: 14025000 });
  expect(request.mock.calls.find(([method]) => method === "contest_create")?.[1]).toMatchObject({ workspaceGeneration });
  expect(surfaceOwner.current.context).toEqual({ operatingContext, sessionID: current.sessionID, workspaceGeneration });
  expect(request.mock.calls.find(([method])=>method==="contest_focus")?.[1]).toMatchObject({field:"other_2"});
  expect(surfaceOwner.current.projections["active-qso"]).toMatchObject({ schemaVersion: 2, status: "ready", operator: {
    output:"xlog-native",focusedField:"callsign",tabNext:{callsign:"sent",receive:"other_2"},tabPrevious:{other_2:"receive"} } });
  expect(surfaceOwner.current.projections["active-qso"].descriptor.advanceOnSpace)
    .toEqual(["callsign", "sent", "receive", "other_1", "other_2"]);
  expect(surfaceOwner.current.projections.logbook.page.limit).toBe(20);
  expect(validContestSurfaceProjection("active-qso", surfaceOwner.current.projections["active-qso"])).toBe(true);
  expect(validContestSurfaceProjection("logbook", surfaceOwner.current.projections.logbook)).toBe(true);
});

it("sends one native ESM operation with buffered fields and accepts its confirmed log even when CW fails", async () => {
  let current = projection();
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const support = workspaceSupport(method, params, current); if (support) return support;
    if (method === "contest_scp_status") return unavailableSCP();
    if (method === "contest_history_status") return unavailableHistory();
    let result: any;
    if (method === "contest_catalog") result = { plugins: [{ id:"cq_ww_cw", name:"CQ WW CW" }] };
    else if (method === "contest_sessions") result = { sessions:[] };
    else if (method === "contest_create") result = { sessionID:current.sessionID, projection:current };
    else if (method === "contest_log_page") result = { rows:[], total:0 };
    else if (method === "contest_score") result = { score:current.score, matrices:{countries:[],zones:[]} };
    else if (method === "contest_draft_apply" || method === "contest_focus") {
      const values = method === "contest_draft_apply" ? params.fields as Record<string, string> :
        Object.fromEntries(current.fields.map(field => [field.id, field.value]));
      current = { ...projection(current.revision + 1, values), focus: method === "contest_focus" ? String(params.field) : current.focus };
      result = { projection:current, actions:[], messages:[] };
    }
    else throw new Error(`Unexpected renderer request ${method}`);
    return { id:crypto.randomUUID(), ok:true, result };
  });
  let settle!:()=>void;
  const gate = new Promise<void>(resolve=>{settle=resolve;});
  nativeCW.execute.mockImplementation(async params => {
    await gate;
    current = projection(current.revision + 1);
    return { error:"CW acknowledgement was lost; use Stop.", contestResult:{ operationID:params.operationID,
      projection:current, actions:[{kind:"function_key",key:"F2",fields:{callsign:"K1ABC"}}] } };
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();
  let entry=surfaceOwner.current.projections["active-qso"];
  const envelope={operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"active-qso",projectionRevision:1,requestID:crypto.randomUUID()} as const;
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"entry_set_text",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,field:"callsign",value:"k1abc"}}));
  entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"entry_set_exchange",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,fieldID:"other_2",value:"5"}}));
  entry=surfaceOwner.current.projections["active-qso"];
  const esmRequestID=crypto.randomUUID();
  const esm=act(async()=>surfaceOwner.current.handle({...envelope,requestID:esmRequestID,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"Enter",focusedField:"other_2"}}));
  await waitFor(()=>expect(nativeCW.execute).toHaveBeenCalledTimes(1));
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"Escape",focusedField:"other_2"}}));
  expect(nativeCW.stop).toHaveBeenCalledTimes(1);
  settle(); await esm;
  expect(nativeCW.execute).toHaveBeenCalledTimes(1);
  expect(nativeCW.execute.mock.calls[0][0]).toMatchObject({operation:"esm",sessionID:current.sessionID,
    draftID:current.draftID,fields:{callsign:"K1ABC",other_2:"5"},field:"other_2",contestSurfaceRequestID:esmRequestID});
  expect(surfaceOwner.current.projections["active-qso"].draft.callsign).toBe("");
  expect(request.mock.calls.some(([method])=>method === "contest_esm")).toBe(false);
});

it("pages past QSO 100 and sends the complete correction contract", async () => {
  let current = projection(), corrected: Record<string, unknown> | null = null;
  const row = { ID:"qso-001", TS:"2026-10-19 08:00:00", Call:"DL1ABC", Freq:14025, Band:14,
    Mode:"CW", SNT:"599", RCV:"599", SentNr:15, ZN:14, Operator:"OM0RX", Points:1, CountryPrefix:"DL" };
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const support = workspaceSupport(method, params, current); if (support) return support;
    if (method === "contest_scp_status") return unavailableSCP();
    if (method === "contest_history_status") return unavailableHistory();
    let result: any;
    if (method === "contest_catalog") result = { plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}] };
    else if (method === "contest_sessions") result = { sessions:[] };
    else if (method === "contest_create") result = { projection:current };
    else if (method === "contest_log_page") {
      const offset = Number(params.offset ?? 0);
      result = { rows:offset === 100 ? [row] : [], offset, limit:20, total:101 };
    } else if (method === "contest_score") result = { score:current.score, matrices:{countries:[],zones:[]} };
    else if (method === "contest_qso_correct") {
      corrected = params; current = projection(current.revision + 1); result = { projection:current, actions:[], messages:[] };
    } else throw new Error(`Unexpected ${method}`);
    return { id:crypto.randomUUID(), ok:true, result };
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();
  const envelope={operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"logbook",projectionRevision:1,requestID:crypto.randomUUID()} as const;
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"log_page",params:{offset:100}}));
  await waitFor(()=>expect(surfaceOwner.current.projections.logbook.page.rows[0]?.qsoID).toBe("qso-001"));
  expect(surfaceOwner.current.projections.logbook.page.rows[0]?.workedAt).toBe("2026-10-19T08:00:00.000Z");
  expect(validContestSurfaceProjection("logbook", surfaceOwner.current.projections.logbook)).toBe(true);
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"log_edit_begin",params:{qsoID:"qso-001"}}));
  for (const [field,value] of [["timestamp","2026-10-19 09:15:30"],["operator","om0rx/p"],["sentReport","579"],["receivedReport","589"]] as const)
    await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"log_edit_set_text",params:{qsoID:"qso-001",field,value}}));
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"log_edit_set_frequency_text",params:{qsoID:"qso-001",value:"7025000"}}));
  for (const [fieldID,value] of [["other_1","16"],["other_2","14"]] as const)
    await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"log_edit_set_exchange",params:{qsoID:"qso-001",fieldID,value}}));
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"log_edit_save",
    params:{qsoID:"qso-001",expectedSessionRevision:current.revision}}));
  await waitFor(()=>expect(corrected).not.toBeNull());
  expect(corrected).toMatchObject({qsoID:"qso-001",timestamp:"2026-10-19 09:15:30",frequencyHz:7_025_000,
    operator:"OM0RX/P",fields:{callsign:"DL1ABC",sent:"579",receive:"589",other_1:"16",other_2:"14"}});
});

it("applies detached Entry mutations and commit through the Python session owner", async () => {
  let current = projection(), committed: Record<string, unknown> | null = null;
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const support = workspaceSupport(method, params, current); if (support) return support;
    if (method === "station_radio_control") return {};
    if (method === "contest_scp_status") return unavailableSCP();
    if (method === "contest_history_status") return unavailableHistory();
    let result: any;
    if (method === "contest_catalog") result = {plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]};
    else if (method === "contest_sessions") result = {sessions:[]};
    else if (method === "contest_create") result = {projection:current};
    else if (method === "contest_log_page") result = {rows:[],offset:0,limit:20,total:0};
    else if (method === "contest_score") result = {score:current.score,matrices:{countries:[],zones:[]}};
    else if (method === "contest_draft_apply") {
      current = projection(current.revision + 1, params.fields as Record<string,string>);
      result = {projection:current,actions:[],messages:[]};
    } else if (method === "contest_qso_commit") {
      committed = params; current = projection(current.revision + 1); result = {projection:current,actions:[],messages:[]};
    } else throw new Error(`Unexpected ${method}`);
    return {id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].status).toBe("ready"));
  let entry = surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,
    workspaceGeneration,panelID:"active-qso",projectionRevision:1,requestID:crypto.randomUUID(),action:"entry_set_cw_speed",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,value:26}}));
  expect(stationControl.speed).toHaveBeenCalledExactlyOnceWith(26);
  expect(surfaceOwner.current.projections["active-qso"].manual.cwSpeedWpm).toBe(26);
  entry = surfaceOwner.current.projections["active-qso"];
  await expect(surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,
    workspaceGeneration,panelID:"callsign-intelligence",projectionRevision:1,requestID:crypto.randomUUID(),action:"assistance_query",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision-1,inputCallsign:"STALE"}})).rejects.toThrow(/changed/);
  expect(request.mock.calls.some(([method])=>method==="contest_draft_apply")).toBe(false);
  await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,
    workspaceGeneration,panelID:"active-qso",projectionRevision:1,requestID:crypto.randomUUID(),action:"entry_set_text",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,field:"callsign",value:"k1abc"}}));
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].draft.callsign).toBe("K1ABC"));
  entry = surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,
    workspaceGeneration,panelID:"active-qso",projectionRevision:2,requestID:crypto.randomUUID(),action:"entry_commit",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision}}));
  expect(committed).toMatchObject({sessionID:current.sessionID,fields:{callsign:"K1ABC"}});
  expect(nativeCW.execute).not.toHaveBeenCalled();
});

it("keeps an uncertain detached commit receipt uncertain", async () => {
  const current=projection();
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support = workspaceSupport(method, params, current); if (support) return support;
    if(method==="contest_scp_status")return unavailableSCP();
    if(method==="contest_history_status")return unavailableHistory();
    if(method==="contest_catalog")return {id:crypto.randomUUID(),ok:true,result:{plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]}};
    if(method==="contest_sessions")return {id:crypto.randomUUID(),ok:true,result:{sessions:[]}};
    if(method==="contest_create")return {id:crypto.randomUUID(),ok:true,result:{projection:current}};
    if(method==="contest_log_page")return {id:crypto.randomUUID(),ok:true,result:{rows:[],offset:0,limit:20,total:0}};
    if(method==="contest_score")return {id:crypto.randomUUID(),ok:true,result:{score:current.score,matrices:{countries:[],zones:[]}}};
    if(method==="contest_qso_commit")return {id:crypto.randomUUID(),ok:false,
      error:{code:"contest_host_timeout",message:"Commit confirmation timed out.",outcome:"uncertain"}};
    throw new Error(`Unexpected ${method}`);
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();
  const entry=surfaceOwner.current.projections["active-qso"];
  await expect(surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,
    workspaceGeneration,panelID:"active-qso",projectionRevision:1,requestID:crypto.randomUUID(),action:"entry_commit",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision}})).rejects.toBeInstanceOf(ContestMutationUncertain);
});

it("keeps a lost focus reply uncertain and never reports a following failed ESM as applied", async()=>{
  const current=projection();
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    if(method==="contest_catalog")return{id:crypto.randomUUID(),ok:true,result:{plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]}};
    if(method==="contest_sessions")return{id:crypto.randomUUID(),ok:true,result:{sessions:[]}};
    if(method==="contest_create")return{id:crypto.randomUUID(),ok:true,result:{projection:current}};
    if(method==="contest_log_page")return{id:crypto.randomUUID(),ok:true,result:{rows:[],offset:0,limit:20,total:0}};
    if(method==="contest_score")return{id:crypto.randomUUID(),ok:true,result:{score:current.score,matrices:{countries:[],zones:[]}}};
    if(method==="contest_focus")return{id:crypto.randomUUID(),ok:false,
      error:{code:"contest_host_timeout",message:"Focus confirmation timed out.",outcome:"uncertain"}};
    throw new Error(`Unexpected ${method}`);
  });
  nativeCW.execute.mockResolvedValue({error:"Session changed; refresh before editing"});
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);await createContestThroughSetup();
  const entry=surfaceOwner.current.projections["active-qso"],envelope={operatingContext,scope:"contesting",sessionID:current.sessionID,
    workspaceGeneration,panelID:"active-qso",projectionRevision:1,requestID:crypto.randomUUID()} as const;
  await expect(surfaceOwner.current.handle({...envelope,action:"entry_focus",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,fieldID:"other_2"}})).rejects.toBeInstanceOf(ContestMutationUncertain);
  await expect(surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"Enter",focusedField:"other_2"}})).rejects.toThrow("Session changed");
});

it("pages, edits, and deletes through the detached Log owner actions", async () => {
  let current = projection(), deleted: Record<string, unknown> | null = null;
  const row = {ID:"qso-021",TS:"2026-10-19 08:00:00",Call:"DL1ABC",Freq:14025,Band:14,Mode:"CW",
    SNT:"599",RCV:"599",SentNr:15,ZN:14,Operator:"OM0RX",Points:1,CountryPrefix:"DL"};
  const request = vi.fn(async (method:string,params:Record<string,unknown>={})=>{
    const support = workspaceSupport(method, params, current); if (support) return support;
    if(method==="contest_scp_status")return unavailableSCP();
    if(method==="contest_history_status")return unavailableHistory();
    let result:any;
    if(method==="contest_catalog")result={plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]};
    else if(method==="contest_sessions")result={sessions:[]};
    else if(method==="contest_create")result={projection:current};
    else if(method==="contest_log_page"){const offset=Number(params.offset??0);result={rows:offset===20?[row]:[],offset,limit:20,total:21};}
    else if(method==="contest_score")result={score:current.score,matrices:{countries:[],zones:[]}};
    else if(method==="contest_qso_delete"){deleted=params;current=projection(current.revision+1);result={projection:current,actions:[],messages:[]};}
    else throw new Error(`Unexpected ${method}`);
    return {id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();
  const envelope={operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"logbook",projectionRevision:1,requestID:crypto.randomUUID()};
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"log_page",params:{offset:20}}));
  await waitFor(()=>expect(surfaceOwner.current.projections.logbook.page.rows[0]?.qsoID).toBe("qso-021"));
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"log_edit_begin",params:{qsoID:"qso-021"}}));
  await waitFor(()=>expect(surfaceOwner.current.projections.logbook.editing?.qsoID).toBe("qso-021"));
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"log_edit_set_text",
    params:{qsoID:"qso-021",field:"deletionReason",value:"Duplicate import"}}));
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"log_edit_confirm_delete",
    params:{qsoID:"qso-021",confirmed:true}}));
  await waitFor(()=>expect(surfaceOwner.current.projections.logbook.editing?.confirmDelete).toBe(true));
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"log_edit_delete",
    params:{qsoID:"qso-021",expectedSessionRevision:current.revision}}));
  expect(deleted).toMatchObject({qsoID:"qso-021",reason:"Duplicate import"});
});

it("applies retained SCP selection through the active Python draft owner", async () => {
  let current=projection();
  const digest="a".repeat(64), matchID=`${digest}:0`;
  const dataset={sourceID:"local-private-file",version:"MASTER.SCP",retrievedAtUTC:null,sha256:digest,
    byteCount:12,recordCount:1,duplicateCount:0,digestVerification:"computedOnly"};
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support = workspaceSupport(method, params, current); if (support) return support;
    let result:any;
      if(method==="contest_history_status")result={dataset:null,pendingPreview:null,unavailableReason:"not_imported",activation:{state:"not_imported",generation:null,digest:null,rowCount:null,message:null}};
    else if(method==="contest_scp_status")result={dataset,unavailableReason:null};
    else if(method==="contest_scp_query")result={sessionID:params.sessionID,workspaceGeneration:params.workspaceGeneration,
      requestID:params.requestID,normalizedQuery:String(params.query).toUpperCase(),
      matches:[{matchID,callsign:"K1ABC",score:100,isPrefixMatch:true}],dataset,evaluatedRecordCount:1,isPartial:false};
    else if(method==="contest_scp_select")result={callsign:"K1ABC"};
    else if(method==="contest_scp_cancel")result={cancelled:true};
    else if(method==="contest_catalog")result={plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]};
    else if(method==="contest_sessions")result={sessions:[]};
    else if(method==="contest_create")result={projection:current};
    else if(method==="contest_log_page")result={rows:[],offset:0,limit:20,total:0};
    else if(method==="contest_score")result={score:current.score,matrices:{countries:[],zones:[]}};
    else if(method==="contest_draft_apply"){
      current=projection(current.revision+1,params.fields as Record<string,string>);
      result={projection:current,actions:[],messages:[]};
    }else throw new Error(`Unexpected ${method}`);
    return {id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();
  let entry=surfaceOwner.current.projections["active-qso"];
  const envelope={operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"callsign-intelligence",projectionRevision:1,requestID:crypto.randomUUID()} as const;
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"assistance_query",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,inputCallsign:"k1"}}));
  await waitFor(()=>expect(surfaceOwner.current.projections["callsign-intelligence"].scp.candidates)
    .toEqual([{candidateID:matchID,callsign:"K1ABC"}]));
  entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"assistance_select",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,kind:"scp",candidateID:matchID}}));
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].draft.callsign).toBe("K1ABC"));
  expect(request.mock.calls.filter(([method])=>method==="contest_draft_apply").at(-1)?.[1]).toMatchObject({
    sessionID:current.sessionID,fields:{callsign:"K1ABC"},frequencyHz:14_025_000,
  });
});

it("keeps legacy-generation Python sessions open in the main desk with detached windows disabled", async () => {
  const legacyGeneration="55555555-5555-4555-8555-555555555555";
  const legacy={...projection(),workspaceGeneration:legacyGeneration};
  localStorage.setItem("xlog.contesting.not1mm.active-session.v1",legacy.sessionID);
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support = workspaceSupport(method, params, legacy); if (support) return support;
    if(method==="contest_scp_status")return unavailableSCP();
    if(method==="contest_history_status")return unavailableHistory();
    let result:any;
    if(method==="contest_catalog")result={plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]};
    else if(method==="contest_sessions")result={sessions:[{sessionID:legacy.sessionID,workspaceGeneration:legacyGeneration,
      name:"Preserved session",pluginID:"cq_ww_cw",sourceRevision:legacy.sourceRevision,revision:legacy.revision}]};
    else if(method==="contest_open")result={projection:legacy};
    else if(method==="contest_log_page")result={rows:[],offset:0,limit:20,total:0};
    else if(method==="contest_score")result={score:legacy.score,matrices:{countries:[],zones:[]}};
    else throw new Error(`Unexpected ${method}`);
    return {id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  expect(await screen.findByText(/This session predates detached contest windows/)).toBeTruthy();
  expect(screen.queryByRole("form",{name:"CQ WW CW entry"})).toBeNull();
  expect(surfaceOwner.current.context).toBeNull();
  expect(request.mock.calls.find(([method])=>method==="contest_open")?.[1]).toMatchObject({workspaceGeneration:legacyGeneration});
});

it("recovers a stale remembered session to a discovered contest in Contest Setup", async () => {
  const current = projection();
  localStorage.setItem("xlog.contesting.not1mm.active-session.v1", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const support = workspaceSupport(method, params, current); if (support) return support;
    const result = method === "contest_catalog" ? {plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]}
      : method === "contest_sessions" ? {sessions:[{sessionID:current.sessionID,
        workspaceGeneration:current.workspaceGeneration,name:"Preserved session",pluginID:current.pluginID,
        sourceRevision:current.sourceRevision,revision:current.revision}]}
      : method === "contest_open" ? {projection:current}
      : method === "contest_log_page" ? {rows:[],offset:0,limit:20,total:0}
      : method === "contest_score" ? {score:current.score,matrices:{countries:[],zones:[]}} : null;
    if (!result) throw new Error(`Unexpected ${method}`);
    return {id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}/>);
  await waitFor(() => expect(localStorage.getItem("xlog.contesting.not1mm.active-session.v1")).toBe(current.sessionID));
  expect(request.mock.calls.find(([method]) => method === "contest_open")?.[1]).toMatchObject({sessionID:current.sessionID});
  await userEvent.click(screen.getByRole("button", {name:"Choose a Contest"}));
  expect(screen.getByText("Preserved session")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("clears a stale remembered session and leaves multiple discovered contests for the operator to choose", async () => {
  localStorage.setItem("xlog.contesting.not1mm.active-session.v1", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  const sessions = ["First preserved contest", "Second preserved contest"].map(name => ({
    sessionID:crypto.randomUUID(),workspaceGeneration,name,pluginID:"cq_ww_cw",sourceRevision:"pinned",revision:1,
  }));
  const request = vi.fn(async (method: string) => {
    if (method === "contest_catalog") return {id:crypto.randomUUID(),ok:true,result:{plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]}};
    if (method === "contest_sessions") return {id:crypto.randomUUID(),ok:true,result:{sessions}};
    throw new Error(`Unexpected ${method}`);
  });
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}/>);
  await waitFor(() => expect(localStorage.getItem("xlog.contesting.not1mm.active-session.v1")).toBeNull());
  expect(request.mock.calls.some(([method]) => method === "contest_open")).toBe(false);
  await userEvent.click(screen.getByRole("button", {name:"Choose a Contest"}));
  expect(screen.getByText("First preserved contest")).toBeTruthy();
  expect(screen.getByText("Second preserved contest")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

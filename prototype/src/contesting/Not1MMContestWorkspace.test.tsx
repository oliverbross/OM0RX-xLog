// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Not1MMContestWorkspace } from "./Not1MMContestWorkspace";
import { ContestMutationUncertain } from "./client";
import { contestSurfacePanelIDs, validContestSurfaceProjection } from "./contestSurfaceProtocol";
import { newContestSetup } from "./ContestSetupPanel";
const nativeCW = vi.hoisted(() => ({ execute: vi.fn(), stop:vi.fn(async () => {}) }));
const surfaceOwner = vi.hoisted(() => ({ current: null as any }));
const surfaceWindow = vi.hoisted(() => ({ open: vi.fn(async () => {}) }));

vi.mock("./useContestSurfaceOwner", () => ({ useContestSurfaceOwner: (owner: unknown) => { surfaceOwner.current = owner; } }));
vi.mock("./contestSurfaceNative", () => ({ openContestSurfaceWindow: surfaceWindow.open }));
vi.mock("../live/BandMaps", () => ({ default: () => <div>Shared bandmap</div> }));
vi.mock("../live/ClusterPanel", () => ({ default: () => <div>Shared cluster</div> }));
vi.mock("../live/useSharedCW", () => ({ useSharedCW: () => ({
  controller: { refresh: vi.fn(async () => {}), arm: vi.fn(async () => {}), stop: nativeCW.stop, send: vi.fn(async () => {}), executeContest: nativeCW.execute },
  state: { pending: false, armed: false, message: "CW disarmed", error: "" },
  profile: { macros: [{ id: 2, enabled: true, shortcut: "F2", text: "{CALL} {RST} {EXCHANGE}" }] },
}) }));

afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); surfaceOwner.current = null; });

const operatingContext = "44444444-4444-4444-8444-444444444444";
const workspaceGeneration = "33333333-3333-4333-8333-333333333333";
const workspaceProps = { operatingContext, workspaceGeneration, stationCall: "OM0RX", radioFrequencyHz: 14_025_000,
  spots: [] as any[], cluster: null, stationTune: vi.fn(async () => ({ accepted:true, confirmed:true })) };
const unavailableSCP = () => ({ id: "scp-status", ok: true,
  result: { dataset: null, unavailableReason: "not_imported" } });
const unavailableHistory = () => ({ id: "history-status", ok: true,
  result: { dataset: null, pendingPreview: null, unavailableReason: "not_imported" } });

it("keeps the detached owner on Contest Setup instead of embedding a contest desk", async () => {
  const request = vi.fn(async (method: string) => {
    if (method === "contest_catalog") return { id:crypto.randomUUID(), ok:true, result:{plugins:[]} };
    if (method === "contest_sessions") return { id:crypto.randomUUID(), ok:true, result:{sessions:[]} };
    throw new Error(method);
  });
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}/>);
  expect(await screen.findByRole("heading", { name: "Contest Setup", level: 1 })).toBeTruthy();
  expect(screen.queryByRole("heading", { name:"Contest Manager / Desk" })).toBeNull();
  expect(screen.queryByRole("button", { name:"Back to desk" })).toBeNull();
});

it("shows a string rejection from the detached contest owner", async () => {
  const request = vi.fn(async () => Promise.reject("Contest mutations require backend admission."));
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}/>);
  expect((await screen.findByRole("alert")).textContent).toContain("Contest mutations require backend admission.");
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
    lastHourQsoPerHour:null,last10QsoPerHour:null,last100QsoPerHour:null,sinceMinuteQsoPerHour:null,
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
  expect(request.mock.calls.some(([method])=>method==="contest_history_status")).toBe(true);
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
  tabPrevious: { callsign: "other_2", sent: "callsign", receive: "sent", other_2: "receive" }, run: false,
  functionKeys: Array.from({ length: 12 }, (_, index) => ({ id: `F${index + 1}`, highlighted: index === 1 })),
  dupe: false, countryResolved: true, history: "K1ABC United States", columns: [],
  score: { qsos: 0, points: 0, countries: 0, zones: 0, total: 0 },
  fields: [
    ["callsign", "Call", true, ""], ["sent", "SNT", true, "599"], ["receive", "RCV", true, "599"],
    ["other_1", "", false, "15"], ["other_2", "CQ Zone", true, ""],
  ].map(([id, label, visible, value]) => ({ id, label, accessibleName: label, visible, value: values[id as string] ?? value, readOnly: false, enabled: true })),
});

it("projects ICWC serial, original exchange labels, unique calls and editable packed name/serial", async () => {
  const current = { ...projection(4, {other_1:"003",other_2:"BOB 12"}), pluginID:"icwc_mst", pluginName:"ICWC Medium Speed Test", reservedSerial:3,
    score:{qsos:2,points:2,countries:0,zones:0,multipliers:1,uniqueCalls:1,total:2} };
  current.fields = current.fields.map(field => ({...field, visible: !["sent","receive"].includes(String(field.id)),
    readOnly:field.id==="other_1", label:field.id==="other_1"?"Sent S/N":field.id==="other_2"?"Name + S/N":field.label}));
  const row = {ID:"mst-qso",TS:"2026-10-20 08:00:00",Call:"K1ABC",Freq:14025,Band:14,Mode:"CW",SNT:"599",RCV:"599",SentNr:1,Name:"BOB",NR:12,ZN:5,Points:1};
  const request = vi.fn(async (method:string,params:Record<string,unknown>={}) => {
    const support=workspaceSupport(method,params,current); if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP(); if(method==="contest_history_status")return unavailableHistory();
    const result=method==="contest_catalog"?{plugins:[{id:"icwc_mst",name:"ICWC Medium Speed Test"}]}:
      method==="contest_sessions"?{sessions:[]}:method==="contest_create"?{projection:current}:
      method==="contest_log_page"?{rows:[row],total:1}:method==="contest_score"?{score:current.score}:null;
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
  expect(surfaceOwner.current.projections.logbook).toMatchObject({exchangeLayout:"plugin",page:{rows:[{receivedExchange:"BOB 12",sentExchange:"1"}]}});
  await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"logbook",projectionRevision:1,requestID:crypto.randomUUID(),action:"log_edit_begin",params:{qsoID:row.ID}}));
  expect(surfaceOwner.current.projections.logbook.editing).toMatchObject({reportsVisible:false,
    receivedFields:[{id:"other_1",label:"Sent S/N",value:"1"},{id:"other_2",label:"Name + S/N",value:"BOB 12"}]});
  for(const panel of contestSurfacePanelIDs)expect(validContestSurfaceProjection(panel,surfaceOwner.current.projections[panel])).toBe(true);
});

it("projects Trans Tasman low bands, serial exchange, plugin dupe period and retained duplicate logging", async () => {
  const current = { ...projection(5, {other_1:"001",other_2:"012"}), pluginID:"trans_tasman", pluginName:"Trans Tasman CW",
    frequencyHz:7_025_000,band:7,reservedSerial:1,supportedBands:["160m","80m","40m"],supportedModes:["CW"],
    allowDuplicateCommit:true,dupe:true,dupeExplanation:"Worked on this band and mode in this 2-hour UTC block (08–10, 10–12, 12–14).",
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
      method==="contest_log_page"?{rows:[row],total:1}:method==="contest_score"?{score:current.score}:null;
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
  expect(surfaceOwner.current.projections.logbook).toMatchObject({exchangeLayout:"plugin",page:{rows:[{
    receivedExchange:"12",sentExchange:"1",multiplierLabels:["ZL1"]}]}});
  expect(surfaceOwner.current.projections.awards.status).toBe("unavailable");
  expect(surfaceOwner.current.projections["chaser-dx"].status).toBe("unavailable");
  expect(validContestSurfaceProjection("active-qso",entry)).toBe(true);
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
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} radioFrequencyHz={undefined}/>);
  fireEvent.change(screen.getByRole("textbox", {name:"Manual frequency MHz"}), {target:{value:initial}});
  await createContestThroughSetup();
  expect(await screen.findByText("Connect the selected radio or enter a valid HF contest frequency before creating a contest.")).toBeTruthy();
  expect(screen.queryByText("Contest created.")).toBeNull();
  expect(request.mock.calls.some(([method]) => method === "contest_create")).toBe(false);
  expect(screen.getByRole("button", {name:"OK"})).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", {name:"Manual frequency MHz"}), {target:{value:"7.025125"}});
  await userEvent.click(screen.getByRole("button", {name:"OK"}));
  await screen.findByText("Contest windows are ready");
  expect(request.mock.calls.find(([method]) => method === "contest_create")?.[1]).toMatchObject({frequencyHz:7_025_125});
  expect(surfaceOwner.current.projections["active-qso"].status).toBe("ready");
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
  await act(async () => { await expect(transition.prepare()).resolves.toBeUndefined(); });
  expect(request.mock.calls.some(([method]) => method === "contest_draft_apply")).toBe(false);
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
  const esm=act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"Enter",focusedField:"other_2"}}));
  await waitFor(()=>expect(nativeCW.execute).toHaveBeenCalledTimes(1));
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"Escape",focusedField:"other_2"}}));
  expect(nativeCW.stop).toHaveBeenCalledTimes(1);
  settle(); await esm;
  expect(nativeCW.execute).toHaveBeenCalledTimes(1);
  expect(nativeCW.execute.mock.calls[0][0]).toMatchObject({operation:"esm",sessionID:current.sessionID,
    draftID:current.draftID,fields:{callsign:"K1ABC",other_2:"5"},field:"other_2"});
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
  expect(request).toHaveBeenCalledWith("station_radio_control",{control:"set_cw_speed",words_per_minute:26});
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
    if(method==="contest_history_status")result={dataset:null,pendingPreview:null,unavailableReason:"not_imported"};
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

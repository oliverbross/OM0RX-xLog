// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Not1MMContestWorkspace } from "./Not1MMContestWorkspace";
import { ContestMutationUncertain } from "./client";
import { validContestSurfaceProjection } from "./contestSurfaceProtocol";
import { newContestSetup } from "./ContestSetupPanel";
const nativeCW = vi.hoisted(() => ({ execute: vi.fn(), stop:vi.fn(async () => {}) }));
const surfaceOwner = vi.hoisted(() => ({ current: null as any }));

vi.mock("./useContestSurfaceOwner", () => ({ useContestSurfaceOwner: (owner: unknown) => { surfaceOwner.current = owner; } }));
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
  spots: [] as any[], cluster: null };
const unavailableSCP = () => ({ id: "scp-status", ok: true,
  result: { dataset: null, unavailableReason: "not_imported" } });
const unavailableHistory = () => ({ id: "history-status", ok: true,
  result: { dataset: null, pendingPreview: null, unavailableReason: "not_imported" } });
const workspaceSupport = (method: string, params: Record<string, unknown>, current: ReturnType<typeof projection>) => {
  const id = crypto.randomUUID();
  if (method === "contest_rates") return { id, ok:true, result:{ sessionID:current.sessionID, revision:current.revision,
    lastHourQsoPerHour:null,last10QsoPerHour:null,last100QsoPerHour:null,sinceMinuteQsoPerHour:null,
    runQso:0,searchAndPounceQso:0,hourRunQso:0,hourSearchAndPounceQso:0 } };
  if (method === "contest_setup_save") return { id, ok:true, result:{ projection:current, setup:params.setup, actions:[], messages:[] } };
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
  await screen.findByRole("heading",{name:"New / Select / Edit Contest"});
  await userEvent.click(screen.getByRole("button",{name:"Create and open new contest"}));
  await waitFor(()=>expect(surfaceOwner.current.projections["callsign-intelligence"].loggedCalls).toEqual(["DL1ABC"]));
  expect(request.mock.calls.find(([method])=>method==="contest_check_partial")?.[1]).toEqual({sessionID:current.sessionID,expectedRevision:9,query:"DL1",limit:500});
  expect(surfaceOwner.current.projections["callsign-intelligence"].clusterCalls).toEqual(["DL1XYZ"]);
  expect(surfaceOwner.current.projections.logbook.page.rows).toEqual([]);
  expect(surfaceOwner.current.projections.logbook.partialRows).toEqual([{qsoID:"off-page",TS:raw.TS,Call:raw.Call,Freq:"14025.125",SNT:"579",RCV:"589",ZN:"14",SentNr:"15",prefix:"DL1",Points:"3"}]);
  expect(surfaceOwner.current.projections["active-qso"].manual).toMatchObject({operator:"OM0RX/P",cwSpeedWpm:27,country:"Germany",cqZone:14,ituZone:28,qsos:25,multipliers:7,total:350,distanceKm:null});
  for(const panel of ["active-qso","callsign-intelligence","logbook"] as const)expect(validContestSurfaceProjection(panel,surfaceOwner.current.projections[panel])).toBe(true);
});

const projection = (revision = 1, values: Record<string, string> = {}) => ({
  sessionID: "11111111-1111-4111-8111-111111111111", engine: "not1mm-python", pluginID: "cq_ww_cw",
  workspaceGeneration: "33333333-3333-4333-8333-333333333333",
  sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f", referenceID: "cty-test", revision,
  draftID: "22222222-2222-4222-8222-222222222222", frequencyHz: 14025000, mode: "CW", band: 14,
  focus: "callsign", tabNext: { callsign: "sent", sent: "receive", receive: "other_2", other_2: "callsign" },
  tabPrevious: { callsign: "other_2", sent: "callsign", receive: "sent", other_2: "receive" }, run: false,
  functionKeys: Array.from({ length: 12 }, (_, index) => ({ id: `F${index + 1}`, highlighted: index === 1 })),
  dupe: false, countryResolved: true, history: "K1ABC United States", columns: [],
  score: { qsos: 0, points: 0, countries: 0, zones: 0, total: 0 },
  fields: [
    ["callsign", "Call", true, ""], ["sent", "SNT", true, "599"], ["receive", "RCV", true, "599"],
    ["other_1", "Sent CQ Zone", false, "15"], ["other_2", "CQ Zone", true, ""],
  ].map(([id, label, visible, value]) => ({ id, label, accessibleName: label, visible, value: values[id as string] ?? value, readOnly: false, enabled: true })),
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
  await screen.findByRole("heading", { name: "New / Select / Edit Contest" });
  await userEvent.click(screen.getByRole("button", { name: "Create and open new contest" }));
  let entry = surfaceOwner.current.projections["active-qso"];
  const envelope = { operatingContext, scope:"contesting", sessionID:current.sessionID, workspaceGeneration,
    panelID:"active-qso", projectionRevision:1, requestID:crypto.randomUUID() } as const;
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"entry_set_text",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,field:"callsign",value:"k1abc"}}));
  entry = surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"entry_set_exchange",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,fieldID:"other_2",value:"5"}}));
  entry = surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"entry_commit",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision}}));
  await waitFor(() => expect(logged).not.toBeNull());
  expect(logged).toMatchObject({ sessionID: current.sessionID, fields: { callsign: "K1ABC", other_2: "5" }, frequencyHz: 14025000 });
  expect(request.mock.calls.find(([method]) => method === "contest_create")?.[1]).toMatchObject({ workspaceGeneration });
  expect(surfaceOwner.current.context).toEqual({ operatingContext, sessionID: current.sessionID, workspaceGeneration });
  expect(surfaceOwner.current.projections["active-qso"]).toMatchObject({ schemaVersion: 2, status: "ready", operator: { output:"xlog-native" } });
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
  await userEvent.click(await screen.findByRole("button", {name:"Create and open new contest"}));
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
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"Enter",focusedField:"exchange"}}));
  await waitFor(()=>expect(nativeCW.execute).toHaveBeenCalledTimes(1));
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"Escape",focusedField:"exchange"}}));
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
  await userEvent.click(await screen.findByRole("button", {name:"Create and open new contest"}));
  const envelope={operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"logbook",projectionRevision:1,requestID:crypto.randomUUID()} as const;
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"log_page",params:{offset:100}}));
  await waitFor(()=>expect(surfaceOwner.current.projections.logbook.page.rows[0]?.qsoID).toBe("qso-001"));
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
  await userEvent.click(await screen.findByRole("button",{name:"Create and open new contest"}));
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].status).toBe("ready"));
  let entry = surfaceOwner.current.projections["active-qso"];
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
  await userEvent.click(await screen.findByRole("button",{name:"Create and open new contest"}));
  const entry=surfaceOwner.current.projections["active-qso"];
  await expect(surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,
    workspaceGeneration,panelID:"active-qso",projectionRevision:1,requestID:crypto.randomUUID(),action:"entry_commit",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision}})).rejects.toBeInstanceOf(ContestMutationUncertain);
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
  await userEvent.click(await screen.findByRole("button",{name:"Create and open new contest"}));
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
  await userEvent.click(await screen.findByRole("button",{name:"Create and open new contest"}));
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

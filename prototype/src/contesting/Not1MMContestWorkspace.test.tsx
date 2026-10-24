// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { compactContestSpotWorkflow, contestSpotWorkflowMaxBytes, contestSpotWorkflowMaxEntries, contestSpotWorkflowStorageKey,
  contestSpotWorkflowTTLms, decodeContestSpotWorkflow, encodeContestSpotWorkflow, Not1MMContestWorkspace, persistContestSpotWorkflow,
  projectContestSpotWorkflow, updateContestSpotWorkflow, authoritativeChangeRevision, observedContestSpot, localContestHeardSpot,
  contestPathMetrics, rtcConfigurationRequired, rtcReportState, storedPendingClientMutation } from "./Not1MMContestWorkspace";
import { ContestScoreSummary } from "./ContestPresentation";
import { ContestMutationUncertain } from "./client";
import { contestSurfacePanelIDs, validContestSurfaceProjection } from "./contestSurfaceProtocol";
import { newContestSetup } from "./ContestSetupPanel";
const stationControl = vi.hoisted(() => ({ speed: vi.fn(async () => ({accepted:true})) }));
vi.mock("./contestStationControl", () => ({ setContestCWSpeed: stationControl.speed }));
const nativeCW = vi.hoisted(() => ({ execute: vi.fn(), stop:vi.fn(async () => {}) }));
const nativeExport = vi.hoisted(() => ({ save: vi.fn() }));
const surfaceOwner = vi.hoisted(() => ({ current: null as any, waitForPublication: vi.fn(async () => {}) }));
const surfaceWindow = vi.hoisted(() => ({ open: vi.fn(async () => {}), openHistory: vi.fn(async () => {}), openDialog: vi.fn(async (_kind: string) => {}) }));
const groupChat = vi.hoisted(() => ({ configure: vi.fn(async () => ({})), open: vi.fn(async () => {}),
  read:vi.fn(async()=>({})),authority:vi.fn(),sync:vi.fn(),
  publish: vi.fn(async () => {}), acknowledgements: vi.fn(async () => [] as string[]) }));
const setupDialogOwner = vi.hoisted(() => ({ current: null as any }));
const nativeVoice = vi.hoisted(() => ({ play: vi.fn(async () => {}), stop: vi.fn(async () => {}) }));
const mapContext = vi.hoisted(() => ({ changed:null as ((value:any)=>void)|null, refresh:vi.fn(), dispose:vi.fn() }));

vi.mock("./useContestSurfaceOwner", async importOriginal => ({ ...await importOriginal<typeof import("./useContestSurfaceOwner")>(), useContestSurfaceOwner: (owner: unknown) => {
  surfaceOwner.current = owner; return surfaceOwner.waitForPublication;
} }));
vi.mock("./contestSurfaceNative", () => ({ openContestSurfaceWindow: surfaceWindow.open,
  openContestCallHistoryWindow: surfaceWindow.openHistory }));
vi.mock("./contestSetupDialogs", () => ({ openContestSetupDialog: surfaceWindow.openDialog,
  useContestSetupDialogs: (owner: unknown) => { setupDialogOwner.current = owner; } }));
vi.mock("./contestGroupChat", () => ({ configureContestGroupChat: groupChat.configure, openContestGroupChatWindow: groupChat.open,
  readContestGroupNetwork:groupChat.read,requestContestGroupAuthority:groupChat.authority,syncContestGroupReplicaPage:groupChat.sync,
  publishContestGroupContact: groupChat.publish, takeContestGroupUnverifiedAcknowledgements: groupChat.acknowledgements }));
vi.mock("../live/BandMaps", () => ({
  default: () => <div>Shared bandmap</div>,
  deduplicateBandMapSpots: <T,>(spots: T[]) => spots,
}));
vi.mock("../live/mapContext",()=>({connectMapContext:(changed:(value:any)=>void)=>{
  mapContext.changed=changed;return{refresh:mapContext.refresh,dispose:mapContext.dispose};}}));
vi.mock("../live/ClusterPanel", () => ({ default: () => <div>Shared cluster</div> }));

it("calculates the main logger route from the same home and target coordinates as the map",()=>{
  expect(contestPathMetrics({call:"OM0RX",grid:"JN98",lat:48.15,lon:17.12},{latitude:41.38,longitude:2.17}))
    .toEqual(expect.objectContaining({headingDegrees:expect.any(Number),longPathHeadingDegrees:expect.any(Number),distanceKm:expect.any(Number)}));
  expect(contestPathMetrics(null,{latitude:41.38,longitude:2.17})).toBeNull();
});

it("reports RTC success and failure before the next scheduled attempt",()=>{
  const status={configured:true,enabled:true,service:"hamscore",username:"OM0RX",interval_minutes:2,posting:false,
    consecutive_failures:0,last_outcome:"accepted",last_attempt:"2026-10-22T00:00:00Z",next_attempt:"2026-10-22T00:02:00Z"};
  expect(rtcReportState(status)).toBe("sent");
  expect(rtcReportState({...status,consecutive_failures:1,last_outcome:"failed"})).toBe("failed");
  expect(rtcReportState({...status,enabled:false,consecutive_failures:3,last_outcome:"paused"})).toBe("paused");
  expect(rtcReportState({...status,posting:true})).toBe("posting");
  expect(rtcReportState({...status,last_attempt:null})).toBe("scheduled");
  expect(rtcConfigurationRequired("same","same",status)).toBe(false);
  expect(rtcConfigurationRequired("same","same",{...status,configured:false})).toBe(true);
});
it("selects only the nearest contest spot inside N1MM's 300 Hz tuning tolerance",()=>{
  const spots=[
    {id:"far",callsign:"FAR",frequencyKHz:14_025.301,receivedAt:30},
    {id:"older",callsign:"OLD",frequencyKHz:14_025.200,receivedAt:10},
    {id:"newer",callsign:"NEW",frequencyKHz:14_024.800,receivedAt:20},
  ] as any[];
  expect(observedContestSpot(spots,14_025_000)?.callsign).toBe("NEW");
  expect(observedContestSpot([spots[0]],14_025_000)).toBeNull();
});
it("creates a local marked S&P spot at the frequency being left without transmitting it",()=>{
  const heard=localContestHeardSpot({callsign:" k1ttt ",frequencyHz:7_152_100,mode:"SSB",stationCall:"OM0RX",
    bandDefinitions:[{id:"40m",lowHz:7_000_000,highHz:7_300_000,value:7}],receivedAt:123,
    callContext:{callsign:"K1TTT",country:"United States",cqZone:5,ituZone:8}});
  expect(heard).toMatchObject({id:"contest-heard:7152100:K1TTT",callsign:"K1TTT",frequencyKHz:7152.1,
    band:"40m",mode:"SSB",country:"United States",cqZone:5,ituZone:8,marked:true,source:"Contest S&P"});
  expect(localContestHeardSpot({callsign:"?",frequencyHz:7_152_100,mode:"SSB",stationCall:"OM0RX",
    bandDefinitions:[{id:"40m",lowHz:7_000_000,highHz:7_300_000,value:7}]})).toBeNull();
});
vi.mock("../live/useSharedCW", () => ({ useSharedCW: () => ({
  controller: { refresh: vi.fn(async () => {}), arm: vi.fn(async () => {}), stop: nativeCW.stop, send: vi.fn(async () => {}), executeContest: nativeCW.execute },
  state: { pending: false, armed: false, message: "CW disarmed", error: "" },
  profile: { macros: [{ id: 2, enabled: true, shortcut: "F2", text: "{CALL} {RST} {EXCHANGE}" }] },
}) }));
vi.mock("./contestExportSave", () => ({ nativeContestExportSave: nativeExport.save }));
vi.mock("./contestVoiceOutput", () => ({ ContestVoiceOutput: class {
  play = nativeVoice.play; stop = nativeVoice.stop;
} }));

afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); vi.restoreAllMocks(); surfaceOwner.current = null; setupDialogOwner.current = null; });

const operatingContext = "44444444-4444-4444-8444-444444444444";
const workspaceGeneration = "33333333-3333-4333-8333-333333333333";
const workspaceProps = { operatingContext, workspaceGeneration, stationCall: "OM0RX", radioFrequencyHz: 14_025_000,
  spots: [] as any[], cluster: null, stationTune: vi.fn(async () => ({ accepted:true, confirmed:true })),
  contestSpot: vi.fn(async () => ({ accepted:true, confirmed:true })) };
const clientGroupSnapshot=()=>({status:"connected",error:null,enabled:true,operator:"OM0RX",multicastGroup:"239.1.1.1",multicastPort:2239,
  messages:[],unverifiedTransportAcknowledgements:[],capabilities:{chat:true,contactPublication:true,remotePersistenceVerified:true,
    sharedSerial:true,duplicateInquiry:true,authorityLimitation:"Trusted LAN"},authority:{role:"client",status:"connected",masterStation:"MASTER",
    sessionID:crypto.randomUUID(),workspaceGeneration:crypto.randomUUID(),leaseExpiresAtMs:Date.now()+3000,reconnectCursor:1}});
it("fails closed for missing, legacy, or malformed replicated contact revisions",()=>{
  for(const value of [undefined,0,-1,1.5,"stale"])expect(()=>authoritativeChangeRevision({change_revision:value})).toThrow(/Synchronise/);
  expect(authoritativeChangeRevision({change_revision:7})).toBe(7);
});
it("ignores unrelated corrupt pending records before parsing the current scope",()=>{
  localStorage.setItem("xlog.contest.pending-client-mutation.v1/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bad","{");
  const scope="xlog.contest.pending-client-mutation.v1/11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222/commit/4/";
  expect(storedPendingClientMutation(scope,"44444444-4444-4444-8444-444444444444","55555555-5555-4555-8555-555555555555")).toBeNull();
});
it("blocks stale current-scope pending evidence unless the operator confirms quarantine",()=>{
  const scope="xlog.contest.pending-client-mutation.v1/11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222/commit/4/",
    qsoID="66666666-6666-4666-8666-666666666666",oldAuthority="77777777-7777-4777-8777-777777777777",oldGeneration="88888888-8888-4888-8888-888888888888",
    item={schemaVersion:1,localSessionID:"11111111-1111-4111-8111-111111111111",localWorkspaceGeneration:"33333333-3333-4333-8333-333333333333",
      authoritySessionID:oldAuthority,authorityWorkspaceGeneration:oldGeneration,draftID:"22222222-2222-4222-8222-222222222222",action:"commit",baseRevision:4,
      requestID:"99999999-9999-4999-8999-999999999999",qsoID,params:{action:"commit",qsoID,timestamp:"2026-10-22 03:00:00",frequencyHz:14025000,
        mode:"CW",operator:"OM0RX",fields:{callsign:"VK6ABC"}},createdAt:1},key=`${scope}${qsoID}/${oldAuthority}/${oldGeneration}`;
  localStorage.setItem(key,JSON.stringify(item));vi.spyOn(window,"confirm").mockReturnValue(false);
  expect(()=>storedPendingClientMutation(scope,"44444444-4444-4444-8444-444444444444","55555555-5555-4555-8555-555555555555")).toThrow(/remains blocked/);
  expect(localStorage.getItem(key)).toBe(JSON.stringify(item));
});
it("quarantines confirmed corrupt current-scope evidence without discarding its raw bytes",()=>{
  const scope="xlog.contest.pending-client-mutation.v1/11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333/22222222-2222-4222-8222-222222222222/delete/9/",
    key=`${scope}66666666-6666-4666-8666-666666666666/77777777-7777-4777-8777-777777777777/88888888-8888-4888-8888-888888888888`,raw="{not-json";
  localStorage.setItem(key,raw);vi.spyOn(window,"confirm").mockReturnValue(true);
  expect(()=>storedPendingClientMutation(scope,"77777777-7777-4777-8777-777777777777","88888888-8888-4888-8888-888888888888")).toThrow(/quarantined/);
  expect(localStorage.getItem(key)).toBeNull();const quarantine=Object.keys(localStorage).find(item=>item.startsWith("xlog.contest.pending-client-mutation-quarantine.v1/"));
  expect(quarantine).toBeTruthy();expect(localStorage.getItem(quarantine!)).toBe(raw);
});
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

it("keeps a detached owner rejection out of the contest workspace", async () => {
  const request = vi.fn(async () => Promise.reject("Contest mutations require backend admission."));
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}/>);
  await waitFor(() => expect(request).toHaveBeenCalled());
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText("Contest mutations require backend admission.")).toBeNull();
});

it("keeps New Contest unavailable until the contest catalog is ready", async () => {
  let resolveCatalog!: (value: unknown) => void;
  const catalog = new Promise<any>(resolve => { resolveCatalog = resolve; });
  const request = vi.fn(async (method: string) => {
    if (method === "contest_catalog") return catalog;
    if (method === "contest_sessions") return { id:crypto.randomUUID(), ok:true, result:{sessions:[]} };
    throw new Error(method);
  });
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}/>);
  const create = screen.getByRole("button", {name:"New Contest"}) as HTMLButtonElement;
  expect(create.disabled).toBe(true);
  expect(screen.queryByText("Loading contest types…")).toBeNull();

  await act(async () => { resolveCatalog({ id:crypto.randomUUID(), ok:true,
    result:{plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]} }); await catalog; });
  await waitFor(() => expect(create.disabled).toBe(false));
  await userEvent.click(create);
  expect((screen.getByRole("combobox", {name:"Log Type"}) as HTMLSelectElement).value).toBe("cq_ww_cw");
});

it("replaces a cold catalog protocol failure with an actionable retry", async () => {
  let catalogAttempts = 0;
  const request = vi.fn(async (method: string) => {
    if (method === "contest_catalog" && ++catalogAttempts === 1) return { id:crypto.randomUUID(), ok:false,
      error:{code:"contest_host_protocol",message:"The contest host reply was invalid.",outcome:"uncertain"} };
    if (method === "contest_catalog") return { id:crypto.randomUUID(), ok:true,
      result:{plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]} };
    if (method === "contest_sessions") return { id:crypto.randomUUID(), ok:true, result:{sessions:[]} };
    throw new Error(method);
  });
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}/>);

  const retry = await screen.findByRole("button", {name:"Reload contest types"});
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText(/Contest types could not be loaded/)).toBeNull();
  expect((screen.getByRole("button", {name:"New Contest"}) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(retry);

  await waitFor(() => expect((screen.getByRole("button", {name:"New Contest"}) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByRole("alert")).toBeNull();
  await userEvent.click(screen.getByRole("button", {name:"New Contest"}));
  expect(screen.getByRole("combobox", {name:"Log Type"}).textContent).toContain("CQ WW CW");
});

it("opens all separate setup dialogs from the hub and Contest menu before a session exists", async () => {
  const request = vi.fn(async (method: string) => ({ id:crypto.randomUUID(), ok:true,
    result:method === "contest_catalog" ? {plugins:[]} : {sessions:[]} }));
  let route: ((value: string) => boolean | Promise<boolean>) | null = null;
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}
    registerMenuRoute={handler => { route = handler; }}/>);
  await userEvent.click(await screen.findByRole("button", {name:"Station Settings"}));
  await userEvent.click(screen.getByRole("button", {name:"Configuration Settings"}));
  await userEvent.click(screen.getByRole("button", {name:"Digital Setup"}));
  await act(async () => { await route!("contest-dialog-operator"); await route!("contest-dialog-station"); await route!("contest-dialog-configuration"); await route!("contest-dialog-digital"); });
  expect(surfaceWindow.openDialog.mock.calls.map(([kind]) => kind)).toEqual(["station", "configuration", "digital", "operator", "station", "configuration", "digital"]);
  expect(screen.queryByRole("textbox", {name:"City"})).toBeNull();
  expect(request.mock.calls.every(([method]) => ["contest_catalog", "contest_sessions", "wsjtx_snapshot", "fldigi_snapshot"].includes(method))).toBe(true);
});

it("routes Digital logging saves, starts, and stops through the real host service", async () => {
  const digital = { configuration:{enabled:false,address:"224.0.0.1",port:42424,destination:"active_contest"}, running:false,
    status:"Stopped", receive_only:true, contest_target_supported:true,
    active_contest:{session_id:"contest",plugin_id:"cq_ww_rtty"}, received_count:17, activity:{spots:[{}]} };
  const fldigi = { configuration:{receive_enabled:true,transmit_enabled:false},receive_supported:true,transmit_supported:true,
    receive_running:false,status:"Stopped",udp_endpoint:"127.0.0.1:9876",xmlrpc_endpoint:"http://127.0.0.1:7362/RPC2" };
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "contest_catalog") return { id:crypto.randomUUID(),ok:true,result:{plugins:[]} };
    if (method === "contest_sessions") return { id:crypto.randomUUID(),ok:true,result:{sessions:[]} };
    if (method === "wsjtx_snapshot") return digital;
    if (method === "wsjtx_configure") return {...digital,configuration:(params as any).configuration};
    if (method === "wsjtx_start") return {...digital,running:true,status:"Listening"};
    if (method === "wsjtx_stop") return digital;
    if (method === "fldigi_snapshot") return fldigi;
    if (method === "fldigi_configure") return {...fldigi,configuration:(params as any).configuration};
    if (method === "fldigi_start") return {...fldigi,receive_running:true,status:"Receiving"};
    if (method === "fldigi_stop") return {...fldigi,configuration:{receive_enabled:false,transmit_enabled:false}};
    throw new Error(method);
  });
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}/>);
  await waitFor(() => expect(setupDialogOwner.current?.auxiliary.digital).toEqual({
    configuration:digital.configuration,running:false,status:"Stopped",receive_only:true,contest_target_supported:true,
    active_contest:digital.active_contest,fldigi,
  }));

  const saveDigital = setupDialogOwner.current.saveDigital;
  await act(() => saveDigital({configuration:digital.configuration,fldigi_configuration:fldigi.configuration,action:"save"}));
  await act(() => saveDigital({configuration:digital.configuration,fldigi_configuration:fldigi.configuration,action:"start"}));
  await act(() => saveDigital({configuration:digital.configuration,fldigi_configuration:fldigi.configuration,action:"stop"}));
  expect(request.mock.calls.filter(([method]) => method.startsWith("wsjtx_")).map(([method]) => method)).toEqual([
    "wsjtx_snapshot", "wsjtx_configure", "wsjtx_configure", "wsjtx_start", "wsjtx_stop", "wsjtx_snapshot",
  ]);
  expect(request).toHaveBeenCalledWith("wsjtx_configure", {configuration:{...digital.configuration,enabled:true}});
  expect(request.mock.calls.filter(([method]) => method.startsWith("fldigi_")).map(([method]) => method)).toEqual([
    "fldigi_snapshot", "fldigi_configure", "fldigi_configure", "fldigi_start", "fldigi_stop", "fldigi_snapshot",
  ]);
});

it("persists exact confirm, mark, marked-only and delete spot lifecycle semantics",()=>{
  const base={receivedAt:1,clusterName:"SK6AW",spotter:"K1ABC",spotterContinent:null,frequencyText:"14025.0",comment:"CQ",
    band:"20m",mode:"CW",country:"Germany",adif:230,continent:"EU",cqZone:14,ituZone:28,callStatus:"New",dxccStatus:"New",
    workedBefore:null,specialTags:[],score:80,contestPoints:null,contestDupe:null,contestMultiplierCount:null,
    contestCountryMultiplier:null,contestZoneMultiplier:null,scoreReasons:[],aggregateCount:1,aggregateSpotters:["K1ABC"],source:"DX Cluster",
    statusHex:"",bandHex:"",modeHex:"",marked:false};
  const spots=[{...base,id:"one",callsign:"DL1ABC",frequencyKHz:14025},{...base,id:"collision",callsign:"DL2ABC",frequencyKHz:14025.1},
    {...base,id:"other",callsign:"DL3ABC",frequencyKHz:14025.2}];
  const scope={operatingContext:"radio:one",sessionID:"session-1",workspaceGeneration:"generation-1"};
  let workflow=decodeContestSpotWorkflow(null,scope,1_000);
  workflow=updateContestSpotWorkflow(workflow,spots,"one","confirm",false,200,1_000);
  expect(projectContestSpotWorkflow(spots,workflow,false).map(spot=>[spot.id,spot.receivedAt])).toEqual([["one",200],["other",1]]);
  workflow=updateContestSpotWorkflow(workflow,projectContestSpotWorkflow(spots,workflow,false),"one","mark",true,201,1_001);
  workflow={...workflow,markedOnly:true,showWorked:true};
  const restored=decodeContestSpotWorkflow(encodeContestSpotWorkflow(workflow,1_002),scope,1_002);
  expect(restored.showWorked).toBe(true);
  expect(projectContestSpotWorkflow(spots,restored).map(spot=>[spot.id,spot.marked])).toEqual([["one",true]]);
  workflow=updateContestSpotWorkflow(restored,projectContestSpotWorkflow(spots,restored,false),"one","delete",false,202,1_002);
  expect(projectContestSpotWorkflow(spots,workflow,false).map(spot=>spot.id)).toEqual(["other"]);
  expect(decodeContestSpotWorkflow("{bad",scope)).toEqual({...scope,markedOnly:false,showWorked:false,entries:{}});
});

it("namespaces, expires, compacts and quota-retries bounded persisted spot overlays",()=>{
  const scopeA={operatingContext:"radio:one",sessionID:"session-a",workspaceGeneration:"generation-1"};
  const scopeB={operatingContext:"radio:one",sessionID:"session-b",workspaceGeneration:"generation-1"};
  expect(contestSpotWorkflowStorageKey(scopeA)).not.toBe(contestSpotWorkflowStorageKey(scopeB));
  const base={receivedAt:1,clusterName:"SK6AW",spotter:"K1ABC",spotterContinent:null,frequencyKHz:14025,frequencyText:"14025",
    callsign:"DL1ABC",comment:"CQ",band:"20m",mode:"CW",country:"Germany",adif:230,continent:"EU",cqZone:14,ituZone:28,
    callStatus:"New",dxccStatus:"New",workedBefore:null,specialTags:[],score:80,contestPoints:null,contestDupe:null,contestMultiplierCount:null,
    contestCountryMultiplier:null,contestZoneMultiplier:null,scoreReasons:[],aggregateCount:1,
    aggregateSpotters:["K1ABC"],source:"DX Cluster",statusHex:"",bandHex:"",modeHex:"",marked:true};
  const now=contestSpotWorkflowTTLms+10_000,entries=Object.fromEntries(Array.from({length:contestSpotWorkflowMaxEntries+25},(_,index)=>{
    const id=`spot-${index}`;return[id,{spot:{...base,id,callsign:`D${index}`},deleted:false,updatedAt:now-index}];
  }));
  const compacted=compactContestSpotWorkflow({...scopeA,markedOnly:false,entries} as any,undefined,now);
  expect(Object.keys(compacted.entries).length).toBeGreaterThan(0);
  expect(Object.keys(compacted.entries).length).toBeLessThanOrEqual(contestSpotWorkflowMaxEntries);
  expect(new TextEncoder().encode(encodeContestSpotWorkflow(compacted,now)).length).toBeLessThanOrEqual(contestSpotWorkflowMaxBytes);
  const expired=JSON.stringify({...scopeA,markedOnly:false,entries:{old:{spot:{...base,id:"old"},deleted:false,updatedAt:now-contestSpotWorkflowTTLms-1}}});
  expect(decodeContestSpotWorkflow(expired,scopeA,now).entries).toEqual({});
  expect(decodeContestSpotWorkflow(" ".repeat(contestSpotWorkflowMaxBytes+1),scopeA,now).entries).toEqual({});
  const scopedStorage=new Map<string,string>(),mapStorage={setItem:(key:string,value:string)=>{scopedStorage.set(key,value);}};
  const workflowA={...scopeA,markedOnly:true,entries:{}} as any;
  const workflowB={...scopeB,markedOnly:false,entries:{}} as any;
  expect(persistContestSpotWorkflow(mapStorage,workflowA,now)).toBe(true);expect(persistContestSpotWorkflow(mapStorage,workflowB,now)).toBe(true);
  expect(decodeContestSpotWorkflow(scopedStorage.get(contestSpotWorkflowStorageKey(scopeA))!,scopeA,now).markedOnly).toBe(true);
  expect(decodeContestSpotWorkflow(scopedStorage.get(contestSpotWorkflowStorageKey(scopeB))!,scopeB,now).markedOnly).toBe(false);
  const saved=new Map<string,string>(),storage={setItem:vi.fn((key:string,value:string)=>{
    if(value.length>20_000)throw new DOMException("Quota exceeded","QuotaExceededError");saved.set(key,value);
  })};
  expect(persistContestSpotWorkflow(storage,compacted,now)).toBe(true);expect(storage.setItem.mock.calls.length).toBeGreaterThan(1);
  expect(saved.has(contestSpotWorkflowStorageKey(scopeA))).toBe(true);
});

it("never resurrects dropped confirmed or unmarked authority while retaining a marked local overlay",()=>{
  const scope={operatingContext:"radio:one",sessionID:"session-1",workspaceGeneration:"generation-1"},now=1_000;
  const spot={id:"one",receivedAt:1,clusterName:"SK6AW",spotter:"K1ABC",spotterContinent:null,frequencyKHz:14025,frequencyText:"14025",
    callsign:"DL1ABC",comment:"CQ",band:"20m",mode:"CW",country:"Germany",adif:230,continent:"EU",cqZone:14,ituZone:28,
    callStatus:"New",dxccStatus:"New",workedBefore:null,specialTags:[],score:80,contestPoints:null,contestDupe:null,contestMultiplierCount:null,
    contestCountryMultiplier:null,contestZoneMultiplier:null,scoreReasons:[],aggregateCount:1,
    aggregateSpotters:["K1ABC"],source:"DX Cluster",statusHex:"",bandHex:"",modeHex:"",marked:false};
  const confirmed=updateContestSpotWorkflow(decodeContestSpotWorkflow(null,scope,now),[spot],spot.id,"confirm",false,2,now);
  expect(projectContestSpotWorkflow([],confirmed,false)).toEqual([]);
  const marked=updateContestSpotWorkflow(confirmed,[spot],spot.id,"mark",true,3,now+1);
  expect(projectContestSpotWorkflow([],marked,false).map(item=>item.id)).toEqual(["one"]);
  const reconciled=compactContestSpotWorkflow(confirmed,new Set(),now+1);expect(reconciled.entries).toEqual({});
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
  const serviceRequest=vi.fn(async(method:string,params:Record<string,unknown>={})=>method==="lookup_call"
    ?{call:params.call,country:"Germany",cqZone:14,ituZone:28,latitude:51,longitude:10,bearing:null,long_path_bearing:null,distance_km:null}
    :request(method,params));
  render(<Not1MMContestWorkspace request={request} serviceRequest={serviceRequest} {...workspaceProps} spots={[{callsign:"DL1XYZ"},{callsign:"K1ABC"}]}/>);
  await createContestThroughSetup();
  await act(async()=>mapContext.changed?.({metadata:{home:{call:"OM0RX",grid:"JN98",lat:48.15,lon:17.12}}}));
  await waitFor(()=>expect(surfaceOwner.current.projections["callsign-intelligence"].loggedCalls).toEqual(["DL1ABC"]));
  expect(request.mock.calls.some(([method])=>method==="contest_history_status")).toBe(false);
  expect(request.mock.calls.find(([method])=>method==="contest_check_partial")?.[1]).toEqual({sessionID:current.sessionID,expectedRevision:9,query:"DL1",limit:500});
  expect(surfaceOwner.current.projections["callsign-intelligence"].clusterCalls).toEqual(["DL1XYZ"]);
  expect(surfaceOwner.current.projections.logbook.page.rows).toEqual([]);
  expect(surfaceOwner.current.projections.logbook.partialRows).toEqual([{qsoID:"off-page",TS:raw.TS,Call:raw.Call,Freq:"14025.125",SNT:"579",RCV:"589",M1:"",ZN:"14",M2:"",prefix:"DL1",Points:"3"}]);
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].manual).toMatchObject({operator:"OM0RX/P",cwSpeedWpm:25,
    cwSpeedStepWpm:1,country:"Germany",cqZone:14,ituZone:28,headingDegrees:expect.any(Number),longPathHeadingDegrees:expect.any(Number),
    distanceKm:expect.any(Number),qsos:25,multipliers:7,total:350}));
  expect(surfaceOwner.current.projections["station-control"]).toEqual({schemaVersion:1,status:"ready",
    radioFrequencyHz:14_025_000,contestFrequencyHz:14_025_000,band:"20m",mode:"CW",busy:false});
  expect(surfaceOwner.current.projections["world-map"]).toMatchObject({
    selectedSpotID:"contest-entry:22222222-2222-4222-8222-222222222222",
    spots:expect.arrayContaining([expect.objectContaining({callsign:"DL1",latitude:51,longitude:10,comment:"Current contest entry"})])});
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

it.each(["contest_log_page", "contest_score", "contest_rates"] as const)(
  "recovers a first-call %s failure without blocking the other auxiliary panels", async failedMethod => {
    const current = { ...projection(), score:{qsos:1,points:3,countries:1,zones:1,multipliers:2,total:6} };
    const row = {ID:"qso-1",TS:"2026-10-22 01:02:03",Call:"DL1ABC",Freq:14025,SNT:"599",RCV:"599",ZN:14,
      SentNr:1,WPXPrefix:"DL1",CountryPrefix:"DL",Points:3,Band:14,Mode:"CW"};
    const attempts: Record<string, number> = {};
    const laneResult = (method: string) => method === "contest_log_page"
      ? {sessionID:current.sessionID,revision:current.revision,rows:[row],offset:0,limit:20,total:1}
      : method === "contest_score" ? {sessionID:current.sessionID,revision:current.revision,score:current.score,
          matrices:{countries:[{value:"Germany",band:14,qsos:1}],zones:[{value:"14",band:14,qsos:1}]},
          statistics:{rows:[{band:"20m",qsos:1,calls:1,cw:1,phone:0,digital:0,wpx:1,points:3}],
            total:{band:"TOTAL",qsos:1,calls:1,cw:1,phone:0,digital:0,wpx:1,points:3}}}
      : {sessionID:current.sessionID,revision:current.revision,lastHourQsoPerHour:1,last10QsoPerHour:null,last100QsoPerHour:null,
          sinceHourUTC:1,sinceHourQso:1,runQso:1,searchAndPounceQso:0,hourRunQso:1,hourSearchAndPounceQso:0};
    const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
      const support = workspaceSupport(method, params, current); if (support && method !== "contest_rates") return support;
      if (method === "contest_scp_status") return unavailableSCP();
      if (method === "contest_history_status") return unavailableHistory();
      if (["contest_log_page", "contest_score", "contest_rates"].includes(method)) {
        attempts[method] = (attempts[method] ?? 0) + 1;
        if (method === failedMethod && attempts[method] === 1) throw new Error(`${method} transient failure`);
        return {id:crypto.randomUUID(),ok:true,result:laneResult(method)};
      }
      const result = method === "contest_catalog" ? {plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]} :
        method === "contest_sessions" ? {sessions:[]} : method === "contest_create" ? {projection:current} : null;
      if (!result) throw new Error(method);
      return {id:crypto.randomUUID(),ok:true,result};
    });
    render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
    await createContestThroughSetup();
    await waitFor(() => expect(Object.fromEntries(Object.entries(attempts).map(([lane,count]) => [lane,Math.min(count,1)]))).toEqual({
      contest_log_page:1,contest_score:1,contest_rates:1,
    }));
    if (failedMethod === "contest_log_page") {
      expect(surfaceOwner.current.projections.logbook).toMatchObject({status:"ready",busy:true,page:{rows:[]}});
      expect(surfaceOwner.current.projections.monitor.status).toBe("ready");
      expect(surfaceOwner.current.projections.awards.status).toBe("ready");
    } else if (failedMethod === "contest_score") {
      expect(surfaceOwner.current.projections.logbook.status).toBe("ready");
      expect(surfaceOwner.current.projections.logbook.page.rows).toHaveLength(1);
      expect(surfaceOwner.current.projections.monitor.status).toBe("ready");
      expect(surfaceOwner.current.projections.awards.status).toBe("unavailable");
    } else {
      expect(surfaceOwner.current.projections.logbook.status).toBe("ready");
      expect(surfaceOwner.current.projections.logbook.page.rows).toHaveLength(1);
      expect(surfaceOwner.current.projections.awards.status).toBe("ready");
      expect(surfaceOwner.current.projections.monitor.status).toBe("unavailable");
    }
    await waitFor(() => expect(attempts[failedMethod]).toBeGreaterThanOrEqual(2), {timeout:3_000});
    await waitFor(() => {
      expect(surfaceOwner.current.projections.logbook.status).toBe("ready");
      expect(surfaceOwner.current.projections.logbook.page.rows).toHaveLength(1);
      expect(surfaceOwner.current.projections.logbook.busy).toBe(false);
      expect(surfaceOwner.current.projections.monitor.status).toBe("ready");
      expect(surfaceOwner.current.projections.awards.status).toBe("ready");
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

it("keeps detached log, score, rates and multiplier windows stable while a callsign edit advances the draft", async () => {
  let current = { ...projection(), score:{qsos:1,points:3,countries:1,zones:1,multipliers:2,total:6} };
  const row = {ID:"qso-1",TS:"2026-10-22 01:02:03",Call:"DL1ABC",Freq:14025,SNT:"599",RCV:"599",ZN:14,
    SentNr:1,WPXPrefix:"DL1",CountryPrefix:"DL",Points:3,Band:14,Mode:"CW"};
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const support = workspaceSupport(method, params, current); if (support) return support;
    if (method === "contest_scp_status") return unavailableSCP();
    if (method === "contest_history_status") return unavailableHistory();
    if (method === "contest_draft_apply") {
      current = {...current,revision:current.revision+1,fields:current.fields.map(field=>field.id==="callsign"
        ? {...field,value:String((params.fields as Record<string,string>).callsign??"")} : field)};
      return {id:crypto.randomUUID(),ok:true,result:{projection:current,actions:[],messages:[]}};
    }
    const result = method === "contest_catalog" ? {plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]} :
      method === "contest_sessions" ? {sessions:[]} : method === "contest_create" ? {projection:current} :
      method === "contest_log_page" ? {sessionID:current.sessionID,revision:current.revision,rows:[row],offset:0,limit:20,total:1} :
      method === "contest_score" ? {sessionID:current.sessionID,revision:current.revision,score:current.score,
        matrices:{countries:[{value:"Germany",band:14,qsos:1}],zones:[{value:"14",band:14,qsos:1}]},
        statistics:{rows:[{band:"20m",qsos:1,calls:1,cw:1,phone:0,digital:0,wpx:1,points:3}],
          total:{band:"TOTAL",qsos:1,calls:1,cw:1,phone:0,digital:0,wpx:1,points:3}}} : null;
    if (!result) throw new Error(method);
    return {id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();
  await waitFor(()=>{
    expect(surfaceOwner.current.projections.logbook.status).toBe("ready");
    expect(surfaceOwner.current.projections.propagation.status).toBe("ready");
    expect(surfaceOwner.current.projections.monitor.status).toBe("ready");
    expect(surfaceOwner.current.projections.awards.status).toBe("ready");
    expect(surfaceOwner.current.projections["chaser-dx"].status).toBe("ready");
  });
  const entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,
    workspaceGeneration,panelID:"active-qso",projectionRevision:1,requestID:crypto.randomUUID(),action:"entry_set_text",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,field:"callsign",value:"D"}}));
  expect(current.revision).toBe(2);
  expect(surfaceOwner.current.projections.logbook).toMatchObject({status:"ready",page:{total:1}});
  expect(surfaceOwner.current.projections.propagation.status).toBe("ready");
  expect(surfaceOwner.current.projections.monitor.status).toBe("ready");
  expect(surfaceOwner.current.projections.awards.status).toBe("ready");
  expect(surfaceOwner.current.projections["chaser-dx"].status).toBe("ready");
});

it("publishes log rows without waiting for a pending sibling auxiliary lane", async () => {
  const current = { ...projection(), score:{qsos:1,points:3,countries:1,zones:1,multipliers:2,total:6} };
  const row = {ID:"qso-1",TS:"2026-10-22 01:02:03",Call:"DL1ABC",Freq:14025,SNT:"599",RCV:"599",ZN:14,
    SentNr:1,WPXPrefix:"DL1",CountryPrefix:"DL",Points:3,Band:14,Mode:"CW"};
  let releaseRates!: (value: any) => void;
  const pendingRates = new Promise(resolve => { releaseRates = resolve; });
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    if (method === "contest_rates") return pendingRates;
    const support = workspaceSupport(method, params, current); if (support) return support;
    if (method === "contest_scp_status") return unavailableSCP();
    if (method === "contest_history_status") return unavailableHistory();
    const result = method === "contest_catalog" ? {plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]} :
      method === "contest_sessions" ? {sessions:[]} : method === "contest_create" ? {projection:current} :
      method === "contest_log_page" ? {sessionID:current.sessionID,revision:current.revision,rows:[row],offset:0,limit:20,total:1} :
      method === "contest_score" ? {sessionID:current.sessionID,revision:current.revision,score:current.score,matrices:{countries:[],zones:[]}} : null;
    if (!result) throw new Error(method);
    return {id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();
  await waitFor(() => expect(surfaceOwner.current.projections.logbook.page.rows).toHaveLength(1));
  expect(surfaceOwner.current.projections.logbook.page.rows[0].qsoID).toBe("qso-1");
  expect(surfaceOwner.current.projections.logbook.busy).toBe(true);
  await act(async () => releaseRates({id:crypto.randomUUID(),ok:true,result:{sessionID:current.sessionID,revision:current.revision,
    lastHourQsoPerHour:1,last10QsoPerHour:null,last100QsoPerHour:null,sinceHourUTC:1,sinceHourQso:1,
    runQso:1,searchAndPounceQso:0,hourRunQso:1,hourSearchAndPounceQso:0}}));
});

it("retains the last good log page when a later refresh fails", async () => {
  const current = { ...projection(), score:{qsos:1,points:3,countries:1,zones:1,multipliers:2,total:6} };
  const row = {ID:"qso-1",TS:"2026-10-22 01:02:03",Call:"DL1ABC",Freq:14025,SNT:"599",RCV:"599",ZN:14,
    SentNr:1,WPXPrefix:"DL1",CountryPrefix:"DL",Points:3,Band:14,Mode:"CW"};
  let logReads = 0;
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const support = workspaceSupport(method, params, current); if (support) return support;
    if (method === "contest_scp_status") return unavailableSCP();
    if (method === "contest_history_status") return unavailableHistory();
    if (method === "contest_log_page" && ++logReads > 1) throw new Error("log refresh failed");
    const result = method === "contest_catalog" ? {plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]} :
      method === "contest_sessions" ? {sessions:[]} : method === "contest_create" ? {projection:current} :
      method === "contest_log_page" ? {sessionID:current.sessionID,revision:current.revision,rows:[row],offset:0,limit:20,total:1} :
      method === "contest_score" ? {sessionID:current.sessionID,revision:current.revision,score:current.score,matrices:{countries:[],zones:[]}} : null;
    if (!result) throw new Error(method);
    return {id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();
  await waitFor(() => expect(surfaceOwner.current.projections.logbook.page.rows[0]?.qsoID).toBe("qso-1"));
  const envelope = {operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"logbook",projectionRevision:current.revision,requestID:crypto.randomUUID()} as const;
  await act(async () => surfaceOwner.current.handle({...envelope,action:"log_page",params:{offset:0,limit:20}}));
  expect(logReads).toBe(2);
  expect(surfaceOwner.current.projections.logbook.page.rows[0]?.qsoID).toBe("qso-1");
  expect(surfaceOwner.current.projections.logbook.page.total).toBe(1);
});

it("projects the final seven plugin contracts into the compact contest setup form", async () => {
  const rttyModes = ["RTTY", "RTTY-R", "LSB-D", "USB-D", "AM-D", "FM-D", "DIGI-U", "DIGI-L", "RTTYR", "PKTLSB", "PKTUSB"];
  const vhfAndUp = ["6m", "4m", "2m", "1.25m", "70cm", "33cm", "23cm", "13cm", "9cm", "6cm", "3cm", "1.25cm", "6mm", "4mm", "2.5mm", "2mm", "1mm", "submm"];
  const plugins = [
    { id:"cq_ww_vhf", name:"CQ WW VHF", supportedBands:["6m", "2m"], modes:["CW", "SSB", "FM", ...rttyModes], sentExchangeHint:"4-character grid square", overlayChoices:["N/A"] },
    { id:"darc_vhf", name:"DARC VHF", supportedBands:["2m", "70cm", "23cm", "13cm", "9cm", "6cm", "3cm", "1.25cm", "6mm", "4mm", "2.5mm", "2mm", "1mm", "submm"], modes:["CW", "SSB", "FM"], sentExchangeHint:"# + 6char grid", overlayChoices:["N/A"] },
    { id:"john_moyle_field_day", name:"John Moyle Field Day", supportedBands:["160m", "80m", "40m", "20m", "15m", "10m", ...vhfAndUp.slice(0, -1)], modes:["CW", "SSB", "FM", "AM"], sentExchangeHint:"#", overlayChoices:["N/A"] },
    { id:"labre_rs_digi", name:"LABRE-RS Digi", supportedBands:["80m", "40m", "20m", "15m", "10m"], modes:rttyModes, sentExchangeHint:"4-character grid square", overlayChoices:["N/A"] },
    { id:"nac_vhf", name:"NAC VHF", supportedBands:vhfAndUp.slice(0, -1), modes:["CW", "SSB"], sentExchangeHint:"# + 6char grid", overlayChoices:["N/A"] },
    { id:"ta_vhf_uhf_contest", name:"TA VHF UHF", supportedBands:["6m", "2m", "70cm"], modes:["CW", "SSB"], sentExchangeHint:"# + 6char grid", overlayChoices:["N/A"] },
    { id:"vhf_sprint", name:"VHF SPRINT", supportedBands:["6m", "2m", "1.25m", "70cm", "33cm", "23cm", "13cm", "9cm", "6cm", "3cm", "1.25cm", "6mm", "4mm", "2.5mm", "2mm", "1mm", "submm"], modes:["CW", "SSB"], sentExchangeHint:"4-character grid square", overlayChoices:["N/A"] },
  ];
  const setup = newContestSetup("OM0RX");
  setup.pluginID = plugins[0].id;
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1", JSON.stringify(setup));
  let created: Record<string, any> | undefined;
  const request = vi.fn(async (method:string, params?:Record<string, any>) => {
    if (method === "contest_create") created = params;
    return { id:crypto.randomUUID(), ok:true,
      result:method === "contest_catalog" ? {plugins} : method === "contest_sessions" ? {sessions:[]} : null };
  });
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}/>);
  await userEvent.click(await screen.findByRole("button", {name:"New Contest"}));
  const logType = screen.getByLabelText("Log Type") as HTMLSelectElement;
  expect(Array.from(logType.options).map(option => option.value)).toEqual(plugins.map(plugin => plugin.id));
  for (const plugin of plugins) {
    fireEvent.change(logType, {target:{value:plugin.id}});
    expect(Array.from((screen.getByLabelText("Band") as HTMLSelectElement).options).map(option => option.value))
      .toEqual(["ALL", ...plugin.supportedBands.map(band => band.toUpperCase())]);
    expect(Array.from((screen.getByLabelText("Mode") as HTMLSelectElement).options).map(option => option.value))
      .toEqual(plugin.id === "cq_ww_vhf" ? ["CW", "SSB", "FM", "DIGITAL", "SSB+CW", "SSB+CW+DIGITAL"]
        : plugin.id === "labre_rs_digi" ? plugin.modes : [...plugin.modes, "MIXED"]);
    expect(Array.from((screen.getByLabelText("Overlay") as HTMLSelectElement).options).map(option => option.value)).toEqual(["N/A"]);
    expect(screen.getByLabelText(plugin.sentExchangeHint)).toBeTruthy();
  }
  expect(Array.from((screen.getByLabelText("Operator") as HTMLSelectElement).options).map(option => option.value))
    .toContain("MULTI-TWO");
  fireEvent.change(logType, {target:{value:"labre_rs_digi"}});
  expect((screen.getByLabelText("Mode") as HTMLSelectElement).value).toBe("RTTY");
  fireEvent.click(screen.getByRole("button", {name:"OK"}));
  await waitFor(() => expect(created?.settings.ModeCategory).toBe("RTTY"));
  expect(screen.getByRole("region", {name:"Contest Setup"}).getAttribute("data-setup-view")).toBe("New Contest");
});

it("projects WIA-like wide-band and aliased modes through the canonical detached surface contract", async () => {
  const bands = ["2190m", "630m", "560m", "160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m",
    "10m", "8m", "6m", "5m", "4m", "2m", "1.25m", "70cm", "33cm", "23cm", "13cm", "9cm"];
  const bandDefinitions = bands.map((id,index) => ({id,lowHz:(index+1)*1_000_000_000,highHz:(index+1)*1_000_000_000+1_000_000,value:index+100}));
  bandDefinitions[bands.indexOf("20m")] = {id:"20m",lowHz:14_000_000,highHz:14_350_000,value:14};
  const supportedModes = ["CW", "SSB", "FM", "RTTY", "RTTY-R", "LSB-D", "USB-D", "AM-D", "FM-D",
    "DIGI-U", "DIGI-L", "RTTYR", "PKTLSB", "PKTUSB"];
  const setup = newContestSetup("OM0RX");
  setup.pluginID = "wia_remembrance";
  setup.preferences.bands = bands;
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1", JSON.stringify(setup));
  const current: any = { ...projection(3), pluginID:"wia_remembrance", pluginName:"WIA REMEMBRANCE",
    supportedBands:bands, supportedModes, matrixTrackers:[] };
  const request = vi.fn(async (method:string, params:Record<string,unknown>={}) => {
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    const result=method==="contest_catalog"?{bandDefinitions,plugins:[{id:"wia_remembrance",name:"WIA REMEMBRANCE",supportedBands:bands,modes:supportedModes}]}:
      method==="contest_sessions"?{sessions:[]}:method==="contest_create"?{projection:current}:
      method==="contest_log_page"?{rows:[],total:0}:method==="contest_score"?{sessionID:current.sessionID,revision:current.revision,score:current.score}:null;
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"]?.status).toBe("ready"));
  const entry=surfaceOwner.current.projections["active-qso"];
  expect(entry.descriptor.bands).toEqual(bands);
  expect(entry.descriptor.modes).toEqual(["CW","SSB","FM","RTTY"]);
  expect(current.supportedModes).toEqual(supportedModes);
  expect(validContestSurfaceProjection("active-qso",entry)).toBe(true);
});

const operationalRequest=(current:()=>ReturnType<typeof projection>,point:(spotID:string)=>number|null=()=>null,
  classify:(spotID:string)=>{dupe:boolean|null;multiplierCount:number|null;countryMultiplier:boolean|null;zoneMultiplier:boolean|null}=spotID=>({
    dupe:false,multiplierCount:point(spotID)===null?null:0,countryMultiplier:point(spotID)===null?null:false,zoneMultiplier:point(spotID)===null?null:false}))=>vi.fn(async(method:string,params:Record<string,unknown>={})=>{
  const active=current(),support=workspaceSupport(method,params,active);if(support)return support;
  if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
  if(method==="contest_spot_points_preview")return{id:crypto.randomUUID(),ok:true,result:{sessionID:active.sessionID,
    workspaceGeneration:active.workspaceGeneration,revision:active.revision,spots:(params.spots as {spotID:string}[]).map(spot=>{
      const points=point(spot.spotID),classification=classify(spot.spotID);return{
        spotID:spot.spotID,points,dupe:classification.dupe,multiplierCount:classification.multiplierCount,
        countryMultiplier:classification.countryMultiplier,zoneMultiplier:classification.zoneMultiplier,
        reason:points===null?"scoring_unavailable":null};})}};
  const result=method==="contest_catalog"?{plugins:[]}:method==="contest_sessions"?{sessions:[]}:
    method==="contest_create"?{projection:active}:method==="contest_log_page"?{rows:[],total:0}:
    method==="contest_score"?{score:active.score}:null;
  if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
});

it("projects the expected country universe, classified opportunities, hourly timeline and advisory received-zone values",async()=>{
  const warnings=[{fieldID:"other_2",kind:"mismatch",message:"Received zone 9 differs from suggested zone 14."},
    {fieldID:"other_2",kind:"conflict",message:"Previous contacts used zone 14."}];
  const current:any={...projection(1,{callsign:"DL1ABC",other_2:"9"}),columns:["Call","CQ Zone","PTS"],
    exchangeWarnings:warnings,callContext:{callsign:"DL1ABC",country:"Germany",cqZone:14,ituZone:28},
    score:{qsos:1,points:3,countries:1,zones:1,total:6}};
  const base=operationalRequest(()=>current,()=>3,()=>({dupe:false,multiplierCount:2,countryMultiplier:true,zoneMultiplier:true}));
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const common={sessionID:current.sessionID,revision:current.revision};
    if(method==="contest_score")return{id:crypto.randomUUID(),ok:true,result:{...common,score:current.score,
      matrices:{countries:[{value:"DL",band:14,qsos:1}],zones:[{value:"14",band:14,qsos:1}]},
      countryUniverse:[{value:"DL",label:"Germany",continent:"EU"},{value:"VK",label:"Australia",continent:"OC"}]}};
    if(method==="contest_log_page")return{id:crypto.randomUUID(),ok:true,result:{...common,offset:0,limit:20,total:1,
      rows:[{ID:"qso-1",Call:"DL1ABC",TS:"2026-10-25 00:01:00",Freq:14025,Band:14,Mode:"CW",SNT:"599",RCV:"599",ZN:9,Points:3,exchangeWarnings:warnings}]}};
    if(method==="contest_rates")return{id:crypto.randomUUID(),ok:true,result:{...common,lastHourQsoPerHour:1,last10QsoPerHour:null,last100QsoPerHour:null,
      sinceHourUTC:0,sinceHourQso:1,runQso:0,searchAndPounceQso:1,hourRunQso:0,hourSearchAndPounceQso:1,
      hourly:[{hourUTC:"2026-10-25T00:00:00Z",qsos:1}],lastQsoAt:"2026-10-25T00:01:00Z"}};
    return base(method,params);
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} spots={[
    {id:"vk",callsign:"VK2ABC",frequencyKHz:7025,band:"40m",mode:"CW",country:"Australia",continent:"OC",cqZone:30,ituZone:59},
  ] as any}/>);await createContestThroughSetup();
  await waitFor(()=>expect(surfaceOwner.current.projections.awards.rows).toEqual(expect.arrayContaining([
    expect.objectContaining({label:"DL",continent:"EU",counts:expect.objectContaining({"20m":1})}),
    expect.objectContaining({label:"VK",continent:"OC",total:0,availableSpots:{"40m":[expect.objectContaining({spotID:"vk",contestDupe:false,contestMultiplierCount:2})]}}),
  ])));
  expect(surfaceOwner.current.projections.awards).toMatchObject({current:{dxcc:"DL"},total:1,draftID:current.draftID});
  expect(surfaceOwner.current.projections["active-qso"].draft).toMatchObject({exchangeWarnings:warnings,
    receivedFields:expect.arrayContaining([expect.objectContaining({id:"other_2",value:"9"})])});
  expect(surfaceOwner.current.projections.logbook.pluginRows[0]).toMatchObject({exchangeWarnings:warnings});
  expect(surfaceOwner.current.projections.monitor).toMatchObject({hourly:[{hourUTC:"2026-10-25T00:00:00.000Z",qsos:1}],lastQsoAt:"2026-10-25T00:01:00.000Z"});
  for(const panel of ["active-qso","logbook","monitor","awards","chaser-dx"] as const)
    expect(validContestSurfaceProjection(panel,surfaceOwner.current.projections[panel])).toBe(true);
});

it("does not report an unresolved country for an empty draft",async()=>{
  const current={...projection(),countryResolved:false},request=operationalRequest(()=>current);
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"]?.status).toBe("ready"));
  expect(surfaceOwner.current.projections["active-qso"].draft.validation.warnings).toEqual([]);
  expect(surfaceOwner.current.projections.messages.messages).not.toContainEqual({
    kind:"notice",text:"Country is unresolved; scoring credit may be zero.",
  });
});

it("projects only fenced host contest points without replacing cluster opportunity scores",async()=>{
  const current=projection(),request=operationalRequest(()=>current,id=>id==="one"?1:3),shared=[
    {id:"one",callsign:"DL1ABC",frequencyKHz:14025,band:"20m",mode:"CW",score:42},
    {id:"three",callsign:"K1ABC",frequencyKHz:14026,band:"20m",mode:"CW",score:80},
  ];
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} spots={shared as any}/>);
  await createContestThroughSetup();await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"].spots)
    .toEqual(expect.arrayContaining([expect.objectContaining({id:"one",score:42,contestPoints:1}),
      expect.objectContaining({id:"three",score:80,contestPoints:3})])));
  expect(request).toHaveBeenCalledWith("contest_spot_points_preview",expect.objectContaining({sessionID:current.sessionID,
    workspaceGeneration:current.workspaceGeneration,expectedRevision:current.revision}));
});

it("preserves authoritative CQ WW SSB dupe and country-zone multiplier classifications in both spot surfaces",async()=>{
  const current={...projection(),pluginID:"cq_ww_ssb",pluginName:"CQ WW SSB",mode:"SSB",supportedModes:["SSB"] as const},
    classifications:Record<string,{dupe:boolean;multiplierCount:number;countryMultiplier:boolean;zoneMultiplier:boolean}>={
      dupe:{dupe:true,multiplierCount:0,countryMultiplier:false,zoneMultiplier:false},
      qso:{dupe:false,multiplierCount:0,countryMultiplier:false,zoneMultiplier:false},
      countryOrZone:{dupe:false,multiplierCount:1,countryMultiplier:true,zoneMultiplier:false},
      countryAndZone:{dupe:false,multiplierCount:2,countryMultiplier:true,zoneMultiplier:true}},
    request=operationalRequest(()=>current,id=>id==="dupe"?0:3,id=>classifications[id]??{
      dupe:false,multiplierCount:0,countryMultiplier:false,zoneMultiplier:false}),
    shared=Object.keys(classifications).map((id,index)=>({id,callsign:["K1ABC","K2ABC","DL1ABC","JA1ABC"][index],
      frequencyKHz:7125+index,band:"40m",mode:"LSB",score:80}));
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} spots={shared as any}/>);
  await createContestThroughSetup();
  await waitFor(()=>expect(surfaceOwner.current.projections["dx-cluster"].spots)
    .toEqual(expect.arrayContaining(Object.entries(classifications).map(([id,value])=>expect.objectContaining({id,mode:"SSB",
      contestDupe:value.dupe,contestMultiplierCount:value.multiplierCount,contestCountryMultiplier:value.countryMultiplier,
      contestZoneMultiplier:value.zoneMultiplier,contestPoints:id==="dupe"?0:3})))));
  expect(surfaceOwner.current.projections["band-maps"].spots.map((spot:any)=>spot.id)).toEqual(["qso","countryOrZone","countryAndZone"]);
  expect(surfaceOwner.current.projections["world-map"].spots).toEqual(surfaceOwner.current.projections["band-maps"].spots);
});

it("retains a manually entered CQ WW QSO and publishes it to Band Map and radio only when Show worked is enabled",async()=>{
  const setup=newContestSetup("OM0RX");setup.pluginID="cq_ww_ssb";setup.preferences.bands=["40m"];
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1",JSON.stringify(setup));
  let current:any={...projection(1,{callsign:"DL1AAA"}),pluginID:"cq_ww_ssb",pluginName:"CQ WW SSB",mode:"SSB",band:7,frequencyHz:7_125_000,
    supportedModes:["SSB"],supportedBands:["160m","80m","40m","20m","15m","10m"]};
  const base=operationalRequest(()=>current,()=>0,()=>({dupe:true,multiplierCount:0,countryMultiplier:false,zoneMultiplier:false}));
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    if(method==="contest_qso_commit"){
      current={...current,revision:current.revision+1};
      return{id:crypto.randomUUID(),ok:true,result:{projection:current,actions:[],messages:[]}};
    }
    return base(method,params);
  });
  const serviceRequest=vi.fn(async(method:string,params:Record<string,unknown>={})=>method==="cluster_contest_radio_spots_publish"
    ?{accepted:1,removed:0,unchanged:0,filtered:0,rejected:0,stale:false}:request(method,params));
  render(<Not1MMContestWorkspace request={request} serviceRequest={serviceRequest} {...workspaceProps} radioFrequencyHz={7_125_000} spots={[]}/>);
  await createContestThroughSetup();
  expect(surfaceOwner.current.projections["band-maps"].spots).toEqual([]);

  const entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,
    workspaceGeneration,panelID:"active-qso",projectionRevision:entry.draft.revision,requestID:crypto.randomUUID(),
    action:"entry_commit",params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision}}));

  await waitFor(()=>expect(surfaceOwner.current.projections["dx-cluster"].spots[0]).toMatchObject({
    id:"contest-heard:7125000:DL1AAA",callsign:"DL1AAA",frequencyKHz:7125,marked:true,contestDupe:true,
    contestMultiplierCount:0,contestCountryMultiplier:false,contestZoneMultiplier:false}));
  expect(surfaceOwner.current.projections["band-maps"]).toMatchObject({showWorked:false,spots:[]});
  await waitFor(()=>expect(serviceRequest).toHaveBeenCalledWith("cluster_contest_radio_spots_publish",expect.objectContaining({
    action:"replace",revision:2,spots:[]})));

  const bandMap=surfaceOwner.current.projections["band-maps"];
  await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,
    workspaceGeneration,panelID:"band-maps",projectionRevision:bandMap.draftRevision,requestID:crypto.randomUUID(),
    // A passive radio/draft refresh may advance before this presentation-only preference reaches the owner.
    action:"spot_set_show_worked",params:{draftID:current.draftID,expectedDraftRevision:bandMap.draftRevision-1,showWorked:true}}));
  await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"]).toMatchObject({showWorked:true,
    spots:[expect.objectContaining({id:"contest-heard:7125000:DL1AAA",contestDupe:true})]}));
  await waitFor(()=>expect(JSON.parse(localStorage.getItem(contestSpotWorkflowStorageKey({operatingContext,
    workspaceGeneration,sessionID:current.sessionID}))!)).toMatchObject({showWorked:true}));
  await waitFor(()=>expect(serviceRequest).toHaveBeenCalledWith("cluster_contest_radio_spots_publish",expect.objectContaining({
    action:"replace",revision:2,spots:[expect.objectContaining({spot_id:"contest-heard:7125000:DL1AAA",dupe:true,
      multiplier_count:0,country_multiplier:false,zone_multiplier:false})]})));
});

it("projects only the configured mode and bands into Cluster and Band Map even when the plug-in supports more modes",async()=>{
  const current={...projection(),pluginID:"cq_ww_ssb",pluginName:"CQ WW SSB",mode:"SSB",supportedModes:["CW","SSB"] as const,
    supportedBands:["160m","80m","40m","20m","15m","10m"]};
  const setup=newContestSetup("OM0RX");setup.pluginID="cq_ww_ssb";setup.preferences.bands=["20m"];
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1",JSON.stringify(setup));
  const request=operationalRequest(()=>current,id=>id==="ssb"?3:1),shared=[
    {id:"ssb",callsign:"DL1ABC",frequencyKHz:14215,band:"20m",mode:"USB",score:42},
    {id:"disabled-band",callsign:"VK1ABC",frequencyKHz:7125,band:"40m",mode:"LSB",score:90},
    {id:"cw",callsign:"K1ABC",frequencyKHz:14025,band:"20m",mode:"CW",score:80},
    {id:"warc",callsign:"W1AW",frequencyKHz:24950,band:"12m",mode:"USB",score:90},
  ];
  let publicationAttempt=0;
  const serviceRequest=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    if(method!=="cluster_contest_radio_spots_publish")return request(method,params);
    publicationAttempt+=1;
    if(publicationAttempt===1)throw new Error("temporary radio publisher failure");
    return publicationAttempt===2?{accepted:0,removed:0,unchanged:0,filtered:0,rejected:1,stale:false}:
      {accepted:1,removed:0,unchanged:0,filtered:0,rejected:0,stale:false};
  });
  const view=render(<Not1MMContestWorkspace request={request} serviceRequest={serviceRequest} {...workspaceProps} spots={shared as any}/>);
  await createContestThroughSetup();
  await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"].spots)
    .toEqual([expect.objectContaining({id:"ssb",mode:"SSB",contestPoints:3})]));
  expect(surfaceOwner.current.projections["band-maps"]).toMatchObject({contestSessionID:current.sessionID,
    supportedBands:["20m"],allowedModeGroups:["phone"]});
  expect(surfaceOwner.current.projections["dx-cluster"].spots)
    .toEqual([expect.objectContaining({id:"ssb",mode:"SSB",contestPoints:3})]);
  expect(surfaceOwner.current.projections["world-map"].spots)
    .toEqual([expect.objectContaining({id:"ssb",mode:"SSB",contestPoints:3})]);
  const preview=request.mock.calls.find(([method])=>method==="contest_spot_points_preview");
  expect(preview?.[1]).toMatchObject({spots:[expect.objectContaining({spotID:"ssb",mode:"SSB"})]});
  expect((preview?.[1] as {spots:{spotID:string}[]}).spots).not.toEqual(expect.arrayContaining([
    expect.objectContaining({spotID:"disabled-band"}),expect.objectContaining({spotID:"cw"}),expect.objectContaining({spotID:"warc"})]));
  await waitFor(()=>expect(serviceRequest).toHaveBeenCalledWith("cluster_contest_radio_spots_publish",expect.objectContaining({
    publisher_id:expect.any(String),publisher_started_at:expect.any(Number),publication_sequence:1,action:"replace",chunk_index:0,chunk_count:1,
    session_id:current.sessionID,workspace_generation:current.workspaceGeneration,revision:current.revision,
    configured_bands:["20m"],allowed_mode_groups:["phone"],spots:[expect.objectContaining({
      spot_id:"ssb",callsign:"DL1ABC",frequency_hz:14_215_000,band:"20m",mode:"SSB",points:3,dupe:false,
      multiplier_count:0,country_multiplier:false,zone_multiplier:false})]})));
  const published=serviceRequest.mock.calls.find(([method])=>method==="cluster_contest_radio_spots_publish")?.[1] as {spots:{spot_id:string}[]};
  expect(published.spots.map(spot=>spot.spot_id)).toEqual(["ssb"]);
  await waitFor(()=>expect(serviceRequest.mock.calls.filter(([method])=>method==="cluster_contest_radio_spots_publish").length).toBeGreaterThanOrEqual(3));
  const firstThree=serviceRequest.mock.calls.filter(([method])=>method==="cluster_contest_radio_spots_publish").slice(0,3);
  expect(firstThree[1][1]).toMatchObject({publisher_id:(firstThree[0][1] as any).publisher_id,publication_sequence:1,action:"replace"});
  expect(firstThree[2][1]).toMatchObject({publisher_id:(firstThree[0][1] as any).publisher_id,publication_sequence:1,action:"replace"});

  view.rerender(<Not1MMContestWorkspace request={request} serviceRequest={serviceRequest} {...workspaceProps} spots={[]}/>);
  await waitFor(()=>expect(serviceRequest).toHaveBeenCalledWith("cluster_contest_radio_spots_publish",expect.objectContaining({
    publication_sequence:2,action:"replace",spots:[]})));
  view.unmount();
  await waitFor(()=>expect(serviceRequest).toHaveBeenCalledWith("cluster_contest_radio_spots_publish",expect.objectContaining({
    publication_sequence:3,action:"clear",spots:[]})));
});

it("keeps publishing live contest spots when an older full-list preview is overtaken",async()=>{
  const current:any={...projection(),pluginID:"cq_ww_ssb",pluginName:"CQ WW SSB",mode:"SSB",band:7,frequencyHz:7_125_000,
    supportedModes:["SSB"],supportedBands:["160m","80m","40m","20m","15m","10m"]};
  const setup=newContestSetup("OM0RX");setup.pluginID="cq_ww_ssb";setup.preferences.bands=["40m"];
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1",JSON.stringify(setup));
  const base=operationalRequest(()=>current,()=>3);let previewAttempt=0,release:(()=>void)|undefined;
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    if(method!=="contest_spot_points_preview")return base(method,params);
    const reply=await base(method,params);
    if(++previewAttempt===2)return new Promise(resolve=>{release=()=>resolve(reply);});
    return reply;
  }),serviceRequest=vi.fn(async(method:string,params:Record<string,unknown>={})=>
    method==="cluster_contest_radio_spots_publish"
      ?{accepted:(params.spots as unknown[]).length,removed:0,unchanged:0,filtered:0,rejected:0,stale:false}
      :request(method,params));
  const first=Array.from({length:9},(_,index)=>({id:`spot-${index}`,callsign:`DL1A${String(index).padStart(2,"0")}`,
    frequencyKHz:7100+index,band:"40m",mode:"LSB",score:42}));
  const newest={id:"newest",callsign:"K1ABC",frequencyKHz:7199,band:"40m",mode:"LSB",score:80};
  const view=render(<Not1MMContestWorkspace request={request} serviceRequest={serviceRequest} {...workspaceProps}
    radioFrequencyHz={7_125_000} spots={first as any}/>);
  await createContestThroughSetup();
  await waitFor(()=>expect(previewAttempt).toBe(2));
  await act(async()=>{await Promise.resolve();});
  expect(serviceRequest.mock.calls.filter(([method])=>method==="cluster_contest_radio_spots_publish")).toHaveLength(0);

  view.rerender(<Not1MMContestWorkspace request={request} serviceRequest={serviceRequest} {...workspaceProps}
    radioFrequencyHz={7_125_000} spots={[newest,...first] as any}/>);
  expect(previewAttempt).toBe(2);
  await act(async()=>release?.());
  await waitFor(()=>expect(serviceRequest).toHaveBeenCalledWith("cluster_contest_radio_spots_publish",expect.objectContaining({
    publication_sequence:1,action:"replace",revision:current.revision,spots:expect.arrayContaining([
      expect.objectContaining({spot_id:"spot-0"}),expect.objectContaining({spot_id:"spot-8"}),
      expect.objectContaining({spot_id:"newest",callsign:"K1ABC"})])})));
  const previewCalls=request.mock.calls.filter(([method])=>method==="contest_spot_points_preview");
  const latestPreview=previewCalls.at(-1)?.[1];expect(latestPreview).toMatchObject({spots:expect.arrayContaining([
    expect.objectContaining({spotID:"newest"})])});
  expect(((latestPreview?.spots??[]) as {spotID:string}[]).map(spot=>spot.spotID)).not.toContain("spot-0");
});

it("finishes in-flight classification across passive draft edits and classifies only arriving spots",async()=>{
  let current:any={...projection(),pluginID:"cq_ww_ssb",pluginName:"CQ WW SSB",mode:"SSB",band:7,frequencyHz:7_125_000,
    supportedModes:["SSB"],supportedBands:["40m"]};
  const setup=newContestSetup("OM0RX");setup.pluginID="cq_ww_ssb";setup.preferences.bands=["40m"];
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1",JSON.stringify(setup));
  const base=operationalRequest(()=>current,()=>3);let release:(()=>void)|undefined,previewCalls=0;
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    if(method==="contest_draft_apply"){
      current={...current,revision:current.revision+1,fields:current.fields.map((field:any)=>({...field,
        value:(params.fields as Record<string,string>)[String(field.id)]??field.value}))};
      return{id:crypto.randomUUID(),ok:true,result:{projection:current,actions:[],messages:[]}};
    }
    const reply=await base(method,params);
    if(method==="contest_spot_points_preview"&&++previewCalls===2)return new Promise(resolve=>{release=()=>resolve(reply);});
    return reply;
  }),serviceRequest=vi.fn(async(method:string,params:Record<string,unknown>={})=>method==="cluster_contest_radio_spots_publish"
    ?{accepted:1,removed:0,unchanged:0,filtered:0,rejected:0,stale:false}:request(method,params));
  const first=Array.from({length:9},(_,index)=>({id:`spot-${index}`,callsign:`DL1A${String(index).padStart(2,"0")}`,
    frequencyKHz:7100+index,band:"40m",mode:"LSB",score:42}));
  const props={request,serviceRequest,...workspaceProps,radioFrequencyHz:7_125_000};
  const view=render(<Not1MMContestWorkspace {...props} spots={first as any}/>);await createContestThroughSetup();
  await waitFor(()=>expect(release).toBeTypeOf("function"));
  const entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,
    action:"entry_set_text",params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,field:"callsign",value:"K1ABC"}}));
  expect(previewCalls).toBe(2);
  expect(request.mock.calls.filter(([method])=>method==="contest_spot_points_preview")
    .map(([,params])=>(params?.spots as unknown[]).length)).toEqual([8,1]);
  await act(async()=>release?.());
  await waitFor(()=>expect(serviceRequest).toHaveBeenCalledWith("cluster_contest_radio_spots_publish",expect.objectContaining({
    revision:2,spots:expect.arrayContaining([expect.objectContaining({spot_id:"spot-8",points:3})])})));
  const newest={id:"newest",callsign:"OK5D",frequencyKHz:7199,band:"40m",mode:"LSB",score:80};
  view.rerender(<Not1MMContestWorkspace {...props} spots={[newest,...first] as any}/>);
  await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"].spots.find((spot:any)=>spot.id==="newest"))
    .toMatchObject({contestPoints:3,contestDupe:false}));
  const last=request.mock.calls.filter(([method])=>method==="contest_spot_points_preview").at(-1)?.[1];
  expect(last).toMatchObject({expectedRevision:2,spots:[expect.objectContaining({spotID:"newest"})]});
});

it("coalesces burst spot arrivals behind one in-flight preview without duplicate candidates",async()=>{
  const current=projection(),base=operationalRequest(()=>current,()=>3);
  let release:(()=>void)|undefined,inFlight=0,maximumInFlight=0;
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    if(method!=="contest_spot_points_preview")return base(method,params);
    maximumInFlight=Math.max(maximumInFlight,++inFlight);
    try{const reply=await base(method,params);
      if(!release)await new Promise<void>(resolve=>{release=resolve;});
      return reply;
    }finally{inFlight-=1;}
  });
  const first=Array.from({length:9},(_,index)=>({id:`spot-${index}`,callsign:`DL1A${index}`,frequencyKHz:14025+index,band:"20m",mode:"CW",score:42}));
  const view=render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} spots={first as any}/>);
  await createContestThroughSetup();await waitFor(()=>expect(release).toBeTypeOf("function"));
  const arrivals=Array.from({length:4},(_,index)=>({...first[0],id:`new-${index}`,callsign:`OK5D${index}`,frequencyKHz:14040+index}));
  for(let count=1;count<=arrivals.length;count+=1)await act(async()=>{
    view.rerender(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} spots={[...first,...arrivals.slice(0,count)] as any}/>);
  });
  expect(request.mock.calls.filter(([method])=>method==="contest_spot_points_preview")).toHaveLength(1);
  await act(async()=>release?.());
  await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"].spots.every((spot:any)=>spot.contestPoints===3)).toBe(true));
  const batches=request.mock.calls.filter(([method])=>method==="contest_spot_points_preview").map(([,params])=>params?.spots as {spotID:string}[]);
  expect(maximumInFlight).toBe(1);expect(batches.map(batch=>batch.length)).toEqual([8,5]);
  const ids=batches.flatMap(batch=>batch.map(spot=>spot.spotID));expect(new Set(ids).size).toBe(ids.length);
});

it("retains rebuild progress across arrivals and publishes the new score classification atomically",async()=>{
  let current=projection();
  const base=operationalRequest(()=>current,()=>current.revision===1?3:1),releases:(()=>void)[]=[];
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    if(method==="contest_qso_commit"){
      current={...current,revision:2,draftID:crypto.randomUUID(),score:{...current.score,qsos:1}};
      return{id:crypto.randomUUID(),ok:true,result:{projection:current,actions:[],messages:[]}};
    }
    const reply=await base(method,params);
    return method==="contest_spot_points_preview"&&params.expectedRevision===2?new Promise(resolve=>releases.push(()=>resolve(reply))):reply;
  });
  const spots=Array.from({length:9},(_,index)=>({id:`spot-${index}`,callsign:`DL1A${index}`,frequencyKHz:14025+index,band:"20m",mode:"CW",score:42}));
  const props={request,serviceRequest:request,...workspaceProps};
  const view=render(<Not1MMContestWorkspace {...props} spots={spots as any}/>);
  await createContestThroughSetup();
  await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"].spots.every((spot:any)=>spot.contestPoints===3)).toBe(true));
  await act(async()=>surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,
    action:"entry_commit",params:{draftID:current.draftID,expectedDraftRevision:current.revision}}));
  await waitFor(()=>expect(releases).toHaveLength(1));
  await act(async()=>releases[0]());
  await waitFor(()=>expect(releases).toHaveLength(2));
  expect(surfaceOwner.current.projections["band-maps"].spots.every((spot:any)=>spot.contestPoints===3)).toBe(true);
  view.rerender(<Not1MMContestWorkspace {...props} spots={[...spots,{...spots[0],id:"new",callsign:"OK5D",frequencyKHz:14045}] as any}/>);
  await act(async()=>releases[1]());
  await waitFor(()=>expect(releases).toHaveLength(3));
  const rebuilding=request.mock.calls.filter(([method,params])=>method==="contest_spot_points_preview"&&params?.expectedRevision===2)
    .map(([,params])=>params?.spots as {spotID:string}[]);
  expect(rebuilding.map(batch=>batch.length)).toEqual([8,1,1]);
  expect(new Set(rebuilding.flatMap(batch=>batch.map(spot=>spot.spotID))).size).toBe(10);
  expect(surfaceOwner.current.projections["band-maps"].spots.filter((spot:any)=>spot.id!=="new").every((spot:any)=>spot.contestPoints===3)).toBe(true);
  await act(async()=>releases[2]());
  await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"].spots.every((spot:any)=>spot.contestPoints===1)).toBe(true));
});

it("discards an in-flight pre-QSO classification and drains the new scoring revision",async()=>{
  let current=projection();
  const base=operationalRequest(()=>current,()=>current.revision===1?3:1),releases:(()=>void)[]=[];
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    if(method==="contest_qso_commit"){
      current={...current,revision:current.revision+1,draftID:crypto.randomUUID(),score:{...current.score,qsos:1}};
      return{id:crypto.randomUUID(),ok:true,result:{projection:current,actions:[],messages:[]}};
    }
    const reply=await base(method,params);
    return method==="contest_spot_points_preview"?new Promise(resolve=>releases.push(()=>resolve(reply))):reply;
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}
    spots={[{id:"one",callsign:"DL1ABC",frequencyKHz:14025,band:"20m",mode:"CW",score:42}] as any}/>);
  await createContestThroughSetup();await waitFor(()=>expect(releases).toHaveLength(1));
  await act(async()=>surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,
    action:"entry_commit",params:{draftID:current.draftID,expectedDraftRevision:current.revision}}));
  expect(releases).toHaveLength(1);
  await act(async()=>releases[0]());
  await waitFor(()=>expect(releases).toHaveLength(2));
  expect(surfaceOwner.current.projections["band-maps"].spots[0].contestPoints).toBeNull();
  expect(request.mock.calls.filter(([method])=>method==="contest_spot_points_preview").map(([,params])=>params?.expectedRevision)).toEqual([1,2]);
  await act(async()=>releases[1]());
  await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"].spots[0].contestPoints).toBe(1));
});

it("retains completed classifications when new spots supersede an in-flight list",async()=>{
  const current=projection(),base=operationalRequest(()=>current,()=>3),releases:(()=>void)[]=[];
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const reply=await base(method,params);
    return method==="contest_spot_points_preview"?new Promise(resolve=>releases.push(()=>resolve(reply))):reply;
  });
  const old={id:"old",callsign:"DL1ABC",frequencyKHz:14025,band:"20m",mode:"CW",score:42},
    newest={...old,id:"newest",callsign:"OK5D",frequencyKHz:14026};
  const view=render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} spots={[old] as any}/>);
  await createContestThroughSetup();await waitFor(()=>expect(releases).toHaveLength(1));
  view.rerender(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} spots={[newest,old] as any}/>);
  expect(releases).toHaveLength(1);
  await act(async()=>releases[0]());
  await waitFor(()=>expect(releases).toHaveLength(2));
  await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"].spots.find((spot:any)=>spot.id==="old"))
    .toMatchObject({contestPoints:3}));
  expect(surfaceOwner.current.projections["band-maps"].spots.find((spot:any)=>spot.id==="newest").contestPoints).toBeNull();
  await act(async()=>releases[1]());
  await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"].spots.every((spot:any)=>spot.contestPoints===3)).toBe(true));
});

it("stops a superseded classification list before issuing its remaining batches",async()=>{
  const current=projection(),base=operationalRequest(()=>current,()=>3);let release:(()=>void)|undefined,previews=0;
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const reply=await base(method,params);
    if(method==="contest_spot_points_preview"&&++previews===1)return new Promise(resolve=>{release=()=>resolve(reply);});
    return reply;
  });
  const spots=Array.from({length:9},(_,index)=>({id:`spot-${index}`,callsign:`DL1A${String(index).padStart(2,"0")}`,
    frequencyKHz:14025+index,band:"20m",mode:"CW",score:42}));
  const view=render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} spots={spots as any}/>);
  await createContestThroughSetup();await waitFor(()=>expect(release).toBeTypeOf("function"));
  view.rerender(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} spots={[]}/>);
  await act(async()=>release?.());
  expect(previews).toBe(1);
});

it("renews an unchanged ready contest radio publication every minute",async()=>{
  const original=window.setInterval.bind(window);let renew:(()=>void)|undefined;
  const interval=vi.spyOn(window,"setInterval").mockImplementation(((handler:TimerHandler,timeout?:number,...args:any[])=>{
    if(timeout===60_000&&typeof handler==="function")renew=handler as ()=>void;
    return original(handler,timeout,...args);
  }) as typeof window.setInterval);
  try{
    const current=projection(),request=operationalRequest(()=>current,()=>3);
    const serviceRequest=vi.fn(async(method:string,params:Record<string,unknown>={})=>method==="cluster_contest_radio_spots_publish"
      ?{accepted:1,removed:0,unchanged:0,filtered:0,rejected:0,stale:false}:request(method,params));
    render(<Not1MMContestWorkspace request={request} serviceRequest={serviceRequest} {...workspaceProps}
      spots={[{id:"one",callsign:"DL1ABC",frequencyKHz:14025,band:"20m",mode:"CW",score:42}] as any}/>);
    await createContestThroughSetup();
    const publications=()=>serviceRequest.mock.calls.filter(([method])=>method==="cluster_contest_radio_spots_publish");
    await waitFor(()=>expect(publications()).toHaveLength(1));expect(renew).toBeTypeOf("function");
    await act(async()=>renew?.());
    await waitFor(()=>expect(publications()).toHaveLength(2));
    expect(publications()[1][1]).toEqual({...publications()[0][1],publication_sequence:2});
  }finally{interval.mockRestore();}
});

it("isolates malformed cluster callsigns from classification batches and radio readiness",async()=>{
  const current=projection(),base=operationalRequest(()=>current,()=>3);
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    if(method==="contest_spot_points_preview"&&(params.spots as {callsign:string}[]).some(spot=>!/^[A-Z0-9/]{3,32}$/.test(spot.callsign)))
      throw new Error("Invalid spot points preview item");
    return base(method,params);
  }),serviceRequest=vi.fn(async(method:string,params:Record<string,unknown>={})=>method==="cluster_contest_radio_spots_publish"
    ?{accepted:1,removed:0,unchanged:0,filtered:0,rejected:0,stale:false}:request(method,params));
  render(<Not1MMContestWorkspace request={request} serviceRequest={serviceRequest} {...workspaceProps}
    spots={["ZA","DL-ABC","OK5D"].map((callsign,index)=>({id:`spot-${index}`,callsign,
      frequencyKHz:14025+index,band:"20m",mode:"CW",score:42})) as any}/>);
  await createContestThroughSetup();
  await waitFor(()=>expect(serviceRequest).toHaveBeenCalledWith("cluster_contest_radio_spots_publish",expect.objectContaining({
    spots:[expect.objectContaining({callsign:"OK5D",points:3})]})));
  expect(request.mock.calls.find(([method])=>method==="contest_spot_points_preview")?.[1]).toMatchObject({
    spots:[expect.objectContaining({callsign:"OK5D"})]});
  expect(surfaceOwner.current.projections["band-maps"].spots.find((spot:any)=>spot.callsign==="ZA").contestPoints).toBeNull();
});

it("clears contest radio spots when the active radio band is outside the configured contest bands",async()=>{
  const current:any={...projection(),pluginID:"cq_ww_ssb",pluginName:"CQ WW SSB",mode:"SSB",band:7,frequencyHz:7_125_000,
    supportedModes:["SSB"],supportedBands:["160m","80m","40m","20m","15m","10m"]};
  const setup=newContestSetup("OM0RX");setup.pluginID="cq_ww_ssb";setup.preferences.bands=["20m"];
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1",JSON.stringify(setup));
  const request=operationalRequest(()=>current,()=>3);
  const serviceRequest=vi.fn(async(method:string,params:Record<string,unknown>={})=>method==="cluster_contest_radio_spots_publish"
    ?{accepted:0,removed:1,unchanged:0,filtered:0,rejected:0,stale:false}:request(method,params));
  render(<Not1MMContestWorkspace request={request} serviceRequest={serviceRequest} {...workspaceProps}
    spots={[{id:"twenty",callsign:"DL1ABC",frequencyKHz:14215,band:"20m",mode:"USB",score:42}] as any}/>);
  await createContestThroughSetup();
  await waitFor(()=>expect(serviceRequest).toHaveBeenCalledWith("cluster_contest_radio_spots_publish",expect.objectContaining({
    action:"replace",configured_bands:["20m"],allowed_mode_groups:["phone"],spots:[]})));
});

it("retains the last spot classification until a QSO mutation preview swaps atomically",async()=>{
  let current=projection(),releasePreview:(()=>void)|undefined;
  const base=operationalRequest(()=>current,()=>current.revision===1?1:3);
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    if(method==="contest_qso_commit"){
      current={...current,revision:current.revision+1};
      return{id:crypto.randomUUID(),ok:true,result:{projection:current,actions:[],messages:[]}};
    }
    if(method==="contest_spot_points_preview"&&current.revision===2)return new Promise(resolve=>{
      releasePreview=()=>void base(method,params).then(resolve);
    });
    return base(method,params);
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}
    spots={[{id:"one",callsign:"DL1ABC",frequencyKHz:14025,band:"20m",mode:"CW",score:42}] as any}/>);
  await createContestThroughSetup();
  await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"].spots[0].contestPoints).toBe(1));
  const entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,
    action:"entry_commit",params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision}}));
  await waitFor(()=>expect(releasePreview).toBeTypeOf("function"));
  expect(surfaceOwner.current.projections["band-maps"].spots[0].contestPoints).toBe(1);
  await act(async()=>releasePreview?.());
  await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"].spots[0].contestPoints).toBe(3));
});

it("retries a transient spot preview failure without blanking contest colors",async()=>{
  const current=projection(),base=operationalRequest(()=>current,()=>3);
  let previewAttempts=0;
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    if(method==="contest_spot_points_preview"&&++previewAttempts===1)throw new Error("temporary preview failure");
    return base(method,params);
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}
    spots={[{id:"one",callsign:"DL1ABC",frequencyKHz:14025,band:"20m",mode:"CW",score:42}] as any}/>);
  await createContestThroughSetup();
  await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"].spots[0]).toMatchObject({contestPoints:3,contestDupe:false}),
    {timeout:2_500});
  expect(previewAttempts).toBe(2);
});

it("routes the visible SPOT_DX action through the owned native contest spot adapter", async () => {
  const current=projection(1,{callsign:"dl1abc"}),request=operationalRequest(()=>current),contestSpot=vi.fn(async()=>({accepted:true}));
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} contestSpot={contestSpot}/>);
  await createContestThroughSetup();
  const entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"active-qso",projectionRevision:1,requestID:crypto.randomUUID(),action:"entry_spot",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision}}));
  expect(contestSpot).toHaveBeenCalledExactlyOnceWith("DL1ABC",14_025_000);
  expect(request.mock.calls.some(([method])=>method==="cluster_command")).toBe(false);
});

it("marks only the exact typed callsign at the current observed VFO and creates a local overlay spot",async()=>{
  const current=projection(1,{callsign:"DL1ABC"}),request=operationalRequest(()=>current);
  const shared=[{id:"partial",callsign:"DL1ABCD",frequencyKHz:14025,band:"20m",mode:"CW"},
    {id:"exact-away",callsign:"DL1ABC",frequencyKHz:14026,band:"20m",mode:"CW"}];
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} spots={shared as any}/>);
  await createContestThroughSetup();await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"].spots).toHaveLength(2));
  const entry=surfaceOwner.current.projections["active-qso"],envelope={operatingContext,scope:"contesting",sessionID:current.sessionID,
    workspaceGeneration,panelID:"active-qso",projectionRevision:entry.draft.revision,requestID:crypto.randomUUID(),
    action:"entry_mark_spot",params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision}};
  await act(async()=>surfaceOwner.current.handle(envelope));
  await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"].spots.some((spot:any)=>spot.callsign==="DL1ABC"&&spot.frequencyKHz===14025&&spot.marked)).toBe(true));
  expect(surfaceOwner.current.projections["band-maps"].spots.some((spot:any)=>spot.callsign==="DL1ABCD"&&spot.marked)).toBe(false);
  expect(surfaceOwner.current.projections["band-maps"].spots.find((spot:any)=>spot.id==="exact-away").marked).toBe(false);
});

it("reconciles a hidden marked-only selection and rejects Ctrl-G tuning it",async()=>{
  const current=projection(),request=operationalRequest(()=>current),tune=vi.fn(async()=>({accepted:true,confirmed:true}));
  const shared=[{id:"hidden",callsign:"DL1ABC",frequencyKHz:14025,band:"20m",mode:"CW"}];
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} stationTune={tune}
    spots={shared as any} selectedSpotId="hidden"/>);
  await createContestThroughSetup();await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"].selectedSpotID).toBe("hidden"));
  const entry=surfaceOwner.current.projections["active-qso"],base={operatingContext,scope:"contesting",sessionID:current.sessionID,
    workspaceGeneration,projectionRevision:entry.draft.revision,requestID:crypto.randomUUID()};
  await act(async()=>surfaceOwner.current.handle({...base,panelID:"band-maps",action:"spot_set_marked_only",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,markedOnly:true}}));
  await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"]).toMatchObject({markedOnly:true,selectedSpotID:null,spots:[]}));
  await expect(surfaceOwner.current.handle({...base,panelID:"active-qso",requestID:crypto.randomUUID(),action:"entry_tune_spot",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision}})).rejects.toThrow("No selected or matching shared spot");
  expect(tune).not.toHaveBeenCalled();
});

it("rejects a current-revision native selection for a spot hidden by marked-only",async()=>{
  const current=projection(),request=operationalRequest(()=>current),tune=vi.fn(async()=>({accepted:true,confirmed:true}));
  const shared=[{id:"hidden",callsign:"DL1ABC",frequencyKHz:14025,band:"20m",mode:"CW"}];
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} stationTune={tune} spots={shared as any}/>);
  await createContestThroughSetup();await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"].spots).toHaveLength(1));
  const entry=surfaceOwner.current.projections["active-qso"],base={operatingContext,scope:"contesting",sessionID:current.sessionID,
    workspaceGeneration,projectionRevision:entry.draft.revision,requestID:crypto.randomUUID()};
  await act(async()=>surfaceOwner.current.handle({...base,panelID:"band-maps",action:"spot_set_marked_only",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,markedOnly:true}}));
  await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"]).toMatchObject({markedOnly:true,spots:[]}));
  const appliesBefore=request.mock.calls.filter(([method])=>method==="contest_draft_apply").length;
  await expect(surfaceOwner.current.handle({...base,panelID:"band-maps",requestID:crypto.randomUUID(),action:"spot_select",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,spotID:"hidden"}}))
    .rejects.toThrow("That shared spot is no longer available");
  expect(tune).not.toHaveBeenCalled();
  expect(request.mock.calls.filter(([method])=>method==="contest_draft_apply")).toHaveLength(appliesBefore);
});

it("drops stale confirmed overlay state when authority disappears and reappears in the same mount",async()=>{
  const current=projection(),request=operationalRequest(()=>current);
  const authoritative={id:"returning",callsign:"DL1ABC",frequencyKHz:14025,band:"20m",mode:"CW",receivedAt:10};
  const props={request,serviceRequest:request,...workspaceProps};
  const view=render(<Not1MMContestWorkspace {...props} spots={[authoritative] as any}/>);
  await createContestThroughSetup();await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"].spots).toHaveLength(1));
  const entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"band-maps",projectionRevision:entry.draft.revision,requestID:crypto.randomUUID(),action:"spot_confirm",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,spotID:"returning"}}));
  await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"].spots[0].receivedAt).not.toBe(10));
  view.rerender(<Not1MMContestWorkspace {...props} spots={[]}/>);
  await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"].spots).toEqual([]));
  const scope={operatingContext,sessionID:current.sessionID,workspaceGeneration};
  await waitFor(()=>expect(decodeContestSpotWorkflow(localStorage.getItem(contestSpotWorkflowStorageKey(scope)),scope).entries).toEqual({}));
  view.rerender(<Not1MMContestWorkspace {...props} spots={[authoritative] as any}/>);
  await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"].spots[0]).toMatchObject({id:"returning",receivedAt:10}));
});

it("projects Python exportFormats and rejects an unsupported Cabrillo owner action",async()=>{
  const current={...projection(),exportFormats:["adif" as const]},request=operationalRequest(()=>current);
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}/>);await createContestThroughSetup();
  await waitFor(()=>expect(surfaceOwner.current.projections.logbook).toMatchObject({canExportCabrillo:false,canExportAdif:true,canExportEdi:false}));
  const log=surfaceOwner.current.projections.logbook;
  await expect(surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"logbook",projectionRevision:log.sessionRevision,requestID:crypto.randomUUID(),action:"log_export_cabrillo",params:{}}))
    .rejects.toThrow("Cabrillo export is not supported");
  expect(request.mock.calls.some(([method])=>method==="contest_export_prepare")).toBe(false);
});

it("routes detached EDI export through the prepared native single-completion owner", async () => {
  const current:any={...projection(),exportFormats:["adif","edi"]};let preparedFormat="";
  nativeExport.save.mockResolvedValue({status:"cancelled",artifactID:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",sha256:"b".repeat(64)});
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    const result=method==="contest_catalog"?{plugins:[{id:"darc_vhf",name:"DARC VHF",exportFormats:["cabrillo","adif","edi"]}]}:
      method==="contest_sessions"?{sessions:[]}:method==="contest_create"?{projection:current}:
      method==="contest_log_page"?{rows:[],offset:0,limit:20,total:0}:method==="contest_score"?{score:current.score,matrices:{countries:[],zones:[]}}:
      method==="contest_export_prepare"?(preparedFormat=String(params.format),{artifactID:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        sessionID:current.sessionID,workspaceGeneration,revision:current.revision,byteLength:128,sha256:"b".repeat(64),format:params.format}):null;
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);await createContestThroughSetup();
  await waitFor(()=>expect(surfaceOwner.current.projections.logbook).toMatchObject({canExportCabrillo:false,canExportAdif:true,canExportEdi:true}));
  const log=surfaceOwner.current.projections.logbook,envelope={operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"logbook",projectionRevision:log.sessionRevision,requestID:crypto.randomUUID()} as const;
  await act(async()=>expect(surfaceOwner.current.handle({...envelope,action:"log_export_edi",params:{}})).resolves.toBe("native-completed"));
  expect(preparedFormat).toBe("edi");
  expect(nativeExport.save).toHaveBeenCalledWith(expect.objectContaining({format:"edi"}),expect.objectContaining({requestID:envelope.requestID}));
  await waitFor(()=>expect(surfaceOwner.current.projections.messages.messages).toContainEqual({
    kind:"notice",text:"EDI save cancelled.",
  }));
  expect(screen.queryByText("EDI save cancelled.")).toBeNull();
});

it("routes detached ADIF export and manual recalculation through the active Python owner", async () => {
  let current:any=projection(4), preparedFormat="", recalculation:Record<string,unknown>|null=null;
  nativeExport.save.mockResolvedValue({status:"saved",artifactID:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    sha256:"b".repeat(64),filename:"OM0RX_CQ-WW-CW.adi"});
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    let result:any;
    if(method==="contest_catalog")result={plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]};
    else if(method==="contest_sessions")result={sessions:[]};
    else if(method==="contest_create")result={projection:current};
    else if(method==="contest_log_page")result={rows:[],offset:0,limit:20,total:0};
    else if(method==="contest_score")result={score:current.score,matrices:{countries:[],zones:[]}};
    else if(method==="contest_export_prepare"){
      preparedFormat=String(params.format);result={artifactID:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        sessionID:current.sessionID,workspaceGeneration,currentRevision:current.revision,revision:current.revision,
        byteLength:128,sha256:"b".repeat(64),format:params.format,filename:"OM0RX_CQ-WW-CW.adi"};
    }else if(method==="contest_recalculate"){
      recalculation=params;current={...current,revision:current.revision+1};result={projection:current,actions:[],messages:[]};
    }else throw new Error(method);
    return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();
  await waitFor(()=>expect(surfaceOwner.current.projections.logbook.canExportAdif).toBe(true));
  const envelope={operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"logbook",projectionRevision:1,requestID:crypto.randomUUID()} as const;
  await act(async()=>expect(surfaceOwner.current.handle({...envelope,action:"log_export_adif",params:{}})).resolves.toBe("native-completed"));
  expect(preparedFormat).toBe("adif");
  expect(nativeExport.save).toHaveBeenCalledWith(expect.objectContaining({format:"adif"}),expect.objectContaining({requestID:envelope.requestID}));
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"log_recalculate",
    params:{expectedSessionRevision:current.revision}}));
  expect(recalculation).toMatchObject({sessionID:current.sessionID,expectedRevision:4,draftID:current.draftID});
  await waitFor(()=>expect(surfaceOwner.current.projections.logbook.sessionRevision).toBe(5));
});

it.each([
  [{status:"cancelled",artifactID:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",sha256:"b".repeat(64)}, "ADIF save cancelled."],
  [{status:"failed",artifactID:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",sha256:"b".repeat(64),message:"Disk is full."}, "Disk is full."],
] as const)("consumes native terminal export completion for %s", async (saveResult, message) => {
  const current:any={...projection(),exportFormats:["adif" as const]};
  nativeExport.save.mockResolvedValue(saveResult);
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    const result=method==="contest_catalog"?{plugins:[{id:"cq_ww_cw",name:"CQ WW CW",supportedBands:["160m","80m","40m","20m","15m","10m"]}]}:
      method==="contest_sessions"?{sessions:[]}:method==="contest_create"?{projection:current}:
      method==="contest_log_page"?{rows:[],offset:0,limit:20,total:0}:method==="contest_score"?{score:current.score,matrices:{countries:[],zones:[]}}:
      method==="contest_export_prepare"?{artifactID:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",sessionID:current.sessionID,
        workspaceGeneration,revision:current.revision,byteLength:128,sha256:"b".repeat(64),format:params.format}:null;
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);await createContestThroughSetup();
  const log=surfaceOwner.current.projections.logbook;
  const action={operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,panelID:"logbook",
    projectionRevision:log.sessionRevision,requestID:crypto.randomUUID(),action:"log_export_adif",params:{}} as const;
  await act(async()=>expect(surfaceOwner.current.handle(action)).resolves.toBe("native-completed"));
  await waitFor(()=>expect(surfaceOwner.current.projections.messages.messages).toContainEqual({
    kind:saveResult.status==="failed"?"error":"notice",text:message,
  }));
  expect(screen.queryByText(message)).toBeNull();
});

it("leaves pre-native export failures for the React action owner to reject", async () => {
  const current:any={...projection(),exportFormats:["adif" as const]};
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    const result=method==="contest_catalog"?{plugins:[{id:"cq_ww_cw",name:"CQ WW CW",supportedBands:["160m","80m","40m","20m","15m","10m"]}]}:
      method==="contest_sessions"?{sessions:[]}:method==="contest_create"?{projection:current}:
      method==="contest_log_page"?{rows:[],offset:0,limit:20,total:0}:method==="contest_score"?{score:current.score,matrices:{countries:[],zones:[]}}:null;
    if(method==="contest_export_prepare")throw new Error("Export preparation failed.");
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);await createContestThroughSetup();
  const log=surfaceOwner.current.projections.logbook;
  await act(async()=>expect(surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"logbook",projectionRevision:log.sessionRevision,requestID:crypto.randomUUID(),action:"log_export_adif",params:{}}))
    .rejects.toThrow("Export preparation failed."));
  expect(nativeExport.save).not.toHaveBeenCalled();
});
const statisticsFor = (current: ReturnType<typeof projection>) => ({
  rows: current.score.qsos ? [{band:"20m",qsos:current.score.qsos,calls:current.score.qsos,cw:current.score.qsos,
    phone:0,digital:0,wpx:current.score.qsos,points:current.score.points}] : [],
  total:{band:"TOTAL",qsos:current.score.qsos,calls:current.score.qsos,cw:current.score.qsos,
    phone:0,digital:0,wpx:current.score.qsos,points:current.score.points},
});

it.each([false, true])("publishes ready empty CQ WW trackers and preserves populated matrices (worked=%s)", async worked => {
  const setup = newContestSetup("OM0RX");
  setup.preferences.bands = ["40m"];
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1", JSON.stringify(setup));
  const current = { ...projection(1,{callsign:"OM0A",other_2:"28"}), frequencyHz: 7_100_000, band: 7,
    callContext:{callsign:"OM0A",primaryPrefix:"OM",country:"Slovakia",cqZone:15,ituZone:28,
      headingDegrees:null,longPathHeadingDegrees:null,distanceKm:null} };
  const matrices = { countries: worked ? [{ value: "Slovakia", band: 7, qsos: 2 }] : [],
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
    current:{dxcc:"Slovakia",cqZone:15,ituZone:28}, bands, configuredBands:["40m"], currentBand:"40m", total: worked ? 1 : 0 });
  expect(zones).toMatchObject({ schemaVersion: 4, status: "ready", title: "CQ Zones", tracker:"zone", zoneSystem:"cq",
    current:{dxcc:"Slovakia",cqZone:28,ituZone:28}, bands, configuredBands:["40m"], currentBand:"40m", total: worked ? 1 : 0 });
  expect(countries.rows).toEqual(worked ? [{ label: "Slovakia", counts: { "160m": 0, "80m": 0, "40m": 2, "20m": 0, "15m": 0, "10m": 0 }, total: 2,continent:null,availableSpots:{} }] : []);
  expect(zones.rows).toHaveLength(40);
  expect(zones.rows.find((row:any)=>row.label==="15")).toEqual({label:"15",
    counts:{"160m":0,"80m":0,"40m":worked?1:0,"20m":0,"15m":0,"10m":0},total:worked?1:0,continent:null,availableSpots:{}});
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

it("adopts an externally committed digital revision and republishes Log and Stats", async () => {
  let current = projection();
  let revisionPoll: (() => void) | undefined;
  vi.spyOn(window, "setInterval").mockImplementation(((handler: TimerHandler, timeout?: number) => {
    if (timeout === 1_000 && typeof handler === "function") revisionPoll = handler as () => void;
    return 1;
  }) as typeof window.setInterval);
  const digitalRow = { ID:"digital-qso", TS:"2026-10-22 14:40:00", Call:"VK8ZY", Freq:14080,
    SNT:"599", RCV:"599", ZN:29, SentNr:15, WPXPrefix:"VK8", CountryPrefix:"VK", Points:3, Band:14, Mode:"RTTY" };
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const support = workspaceSupport(method, params, current); if (support) return support;
    if (method === "contest_scp_status") return unavailableSCP();
    if (method === "contest_history_status") return unavailableHistory();
    const result = method === "contest_catalog" ? { plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}] } :
      method === "contest_sessions" ? { sessions:[] } : method === "contest_create" ? { projection:current } :
      method === "contest_draft_get" ? { projection:current } : method === "contest_log_page" ? {
        sessionID:current.sessionID, revision:current.revision, rows:current.revision === 2 ? [digitalRow] : [],
        total:current.revision === 2 ? 1 : 0, offset:0, limit:20 } : method === "contest_score" ? {
        sessionID:current.sessionID, revision:current.revision, score:current.score, matrices:{countries:[],zones:[]},
        statistics:current.revision === 2 ? { rows:[{band:"20m",qsos:1,calls:1,cw:0,phone:0,digital:1,wpx:1,points:3}],
          total:{band:"TOTAL",qsos:1,calls:1,cw:0,phone:0,digital:1,wpx:1,points:3} } : statisticsFor(current) } : null;
    if (!result) throw new Error(method);
    return { id:crypto.randomUUID(), ok:true, result };
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();
  await waitFor(() => expect(surfaceOwner.current.projections.propagation.total.qsos).toBe(0));
  expect(revisionPoll).toBeTypeOf("function");

  current = { ...projection(2), score:{qsos:1,points:3,countries:1,zones:1,total:3} };
  await act(async () => { revisionPoll?.(); });

  await waitFor(() => expect(surfaceOwner.current.projections.propagation).toMatchObject({
    schemaVersion:3, status:"ready", total:{qsos:1,digital:1,points:3},
  }));
  expect(surfaceOwner.current.projections.logbook).toMatchObject({
    status:"ready", sessionRevision:2, page:{total:1, rows:[{qsoID:"digital-qso"}]},
  });
  expect(request.mock.calls.find(([method]) => method === "contest_draft_get")?.[1]).toEqual({
    sessionID:current.sessionID, workspaceGeneration:current.workspaceGeneration,
  });
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
        ({...field,value:(params.fields as Record<string,string>)[String(field.id)]??field.value}))};
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
    {id:"other_1",label:"Name",value:"ALICE",required:true,maximumUTF8Bytes:32,enabled:true,readOnly:false},
    {id:"other_2",label:"Member No./SPC",value:"1234",required:true,maximumUTF8Bytes:128,enabled:true,readOnly:false},
  ]);
  await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"active-qso",projectionRevision:1,requestID:crypto.randomUUID(),action:"entry_set_exchange",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,fieldID:"other_1",value:"bob"}}));
  expect(applied).toMatchObject({fields:{other_1:"BOB",other_2:"1234"}});
  entry=surfaceOwner.current.projections["active-qso"];
  expect(entry.draft.receivedFields[0].value).toBe("BOB");
});

it.each([
  {pluginID:"qso_party_sn",pluginName:"QSO PARTY SN",received:["other_1"]},
  {pluginID:"ca_qso_party",pluginName:"California QSO Party",received:["other_1"]},
  {pluginID:"raem",pluginName:"RAEM",received:["other_1","other_2"]},
])("projects the real host field roles for $pluginID Main Logging",async({pluginID,pluginName,received})=>{
  let current:any={...projection(),pluginID,pluginName,reservedSerial:1,allocatedSerialFieldID:"sent"};
  current.fields=current.fields.map((field:any)=>field.id==="sent"?{...field,label:"Sent serial",visible:true,value:"001",readOnly:true}:
    field.id==="receive"?{...field,label:"Received serial",visible:pluginID!=="raem",value:"42",readOnly:false}:
    field.id==="other_1"?{...field,label:pluginID==="raem"?"Received serial":"Received location",visible:true,value:pluginID==="raem"?"101":"NEW",readOnly:false}:
    field.id==="other_2"?{...field,label:"Received coordinates",visible:pluginID==="raem",value:"40N74W",readOnly:false}:field);
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    const result=method==="contest_catalog"?{plugins:[{id:pluginID,name:pluginName}]}:
      method==="contest_sessions"?{sessions:[]}:method==="contest_create"?{projection:current}:
      method==="contest_log_page"?{rows:[],total:0}:method==="contest_score"?{score:current.score,matrices:{countries:[],zones:[]}}:null;
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await userEvent.click(await screen.findByRole("button",{name:"New Contest"}));
  fireEvent.change(screen.getByLabelText("Log Type"),{target:{value:pluginID}});
  await userEvent.click(screen.getByRole("button",{name:"OK"}));
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].status).toBe("ready"));
  const entry=surfaceOwner.current.projections["active-qso"];
  expect(entry.descriptor.reportFields).toEqual(expect.arrayContaining([
    expect.objectContaining({id:"sent",value:"001",enabled:true,readOnly:true}),
  ]));
  expect(entry.descriptor.serial).toEqual({requirement:"requiredForCommit",allocatedFieldID:"sent",reservedSerial:1});
  expect(entry.descriptor.sentFields).toEqual([]);
  expect(entry.draft.receivedFields.map((field:any)=>field.id)).toEqual(received);
  expect(entry.draft.receivedFields).toEqual(expect.arrayContaining(received.map(id=>
    expect.objectContaining({id,enabled:true,readOnly:false}))));
});

it.each([
  { pluginID:"cwt", pluginName:"CWT", exchangeLabel:"Number or State", exchangeColumn:"RcvNr",
    row:{Name:"ALICE",NR:"ALICE 123",Sect:"",ZN:5}, expectedOther1:"ALICE", expectedOther2:"123" },
  { pluginID:"k1usn_sst", pluginName:"K1USN SLOW SPEED TEST", exchangeLabel:"SPC", exchangeColumn:"Sect",
    row:{Name:"ALICE",NR:"",Sect:"CT",ZN:5}, expectedOther1:"ALICE", expectedOther2:"CT" },
  { pluginID:"euhfc", pluginName:"EU HF Championship", exchangeLabel:"Lic Year", exchangeColumn:"RcvNr",
    row:{SentNr:"82",NR:"30",ZN:14}, expectedOther1:"82", expectedOther2:"30" },
])("opens $pluginID corrections with the plugin-owned historical exchanges",
  async ({pluginID,pluginName,exchangeLabel,exchangeColumn,row:exchangeRow,expectedOther1,expectedOther2}) => {
    let current:any={...projection(3),pluginID,pluginName,matrixTrackers:[],
      columns:["YYYY-MM-DD HH:MM:SS","Call","Freq","SentNr","Name",exchangeColumn,"PTS"]};
    current.fields=current.fields.map((field:any)=>({...field,visible:!["sent","receive"].includes(field.id),readOnly:false,
      label:field.id==="other_1"?(pluginID==="euhfc"?"":"Name"):field.id==="other_2"?exchangeLabel:field.label}));
    const row={ID:`${pluginID}-qso`,TS:"2026-10-20 09:00:00",Call:"K1ABC",Freq:14025,Band:14,Mode:"CW",
      SNT:"599",RCV:"599",SentNr:"OLIVER",Operator:"OM0RX",Points:1,ContestName:pluginName,CountryPrefix:"K",
      StationPrefix:"OM0RX",Name:"ALICE",QTH:"BOSTON",Comment:"Original note",Power:100,GridSquare:"FN42",...exchangeRow};
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
      {id:"other_1",label:pluginID==="euhfc"?"Sent exchange":"Name",value:expectedOther1,required:true,maximumUTF8Bytes:32},
      {id:"other_2",label:exchangeLabel,value:expectedOther2,required:true,maximumUTF8Bytes:128},
    ]);
    expect(surfaceOwner.current.projections.logbook.editing.details).toMatchObject({contest:pluginName,country:"K",stationCall:"OM0RX",
      name:"ALICE",qth:"BOSTON",comment:"Original note",power:"100",grid:"FN42"});
    await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"log_edit_save",
      params:{qsoID:row.ID,expectedSessionRevision:current.revision}}));
    expect(corrected).toMatchObject({qsoID:row.ID,fields:{other_1:expectedOther1,other_2:expectedOther2}});
  });

it("projects ICWC serial, original exchange labels, unique calls and editable packed name/serial", async () => {
  const current = { ...projection(4, {other_1:"003",other_2:"BOB 12"}), pluginID:"icwc_mst", pluginName:"ICWC Medium Speed Test", reservedSerial:3, allocatedSerialFieldID:"other_1", matrixTrackers:[],
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

it.each([
  { pluginID:"euhfc", pluginName:"EUHFC",
    score:{qsos:3,points:2,countries:0,zones:0,multipliers:2,total:4},
    labels:["2 license years"] },
  { pluginID:"iaru_hf", pluginName:"IARU HF",
    score:{qsos:3,points:7,countries:0,zones:2,headquarters:1,multipliers:3,total:21},
    labels:["1 headquarters","2 zones"] },
  { pluginID:"nac_vhf", pluginName:"NAC VHF",
    score:{qsos:3,points:72,countries:0,zones:0,gridSquares:2,multipliers:2,total:144},
    labels:["2 grid squares"] },
  { pluginID:"cq_ww_rtty", pluginName:"CQ WW RTTY",
    score:{qsos:3,points:7,countries:2,zones:1,states:1,multipliers:4,total:28},
    labels:["2 countries","1 zones","1 states/provinces"] },
  { pluginID:"arrl_dx_ssb", pluginName:"ARRL DX SSB",
    score:{qsos:3,points:9,countries:2,zones:0,states:1,multipliers:3,total:27},
    labels:["2 countries","1 states/provinces"] },
  { pluginID:"cqws", pluginName:"CQWS",
    score:{qsos:3,points:7,countries:2,zones:0,exchangeBandMultipliers:3,multipliers:5,total:35},
    labels:["2 countries","3 Brazilian units by band"] },
  { pluginID:"rda_contest", pluginName:"RDA Contest",
    score:{qsos:3,points:7,countries:2,zones:0,rdaDistricts:3,multipliers:5,total:35},
    labels:["2 countries","3 RDA districts"] },
  { pluginID:"rdxc", pluginName:"RDXC",
    score:{qsos:3,points:7,countries:2,zones:0,oblasts:3,multipliers:5,total:35},
    labels:["2 countries","3 oblasts"] },
])("renders $pluginName host multiplier semantics without country fallbacks", async ({pluginID,pluginName,score,labels}) => {
  const current={...projection(4),pluginID,pluginName,matrixTrackers:[],score};
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    const result=method==="contest_catalog"?{plugins:[{id:pluginID,name:pluginName}]}:
      method==="contest_sessions"?{sessions:[]}:method==="contest_create"?{projection:current}:
      method==="contest_log_page"?{sessionID:current.sessionID,revision:current.revision,rows:[],offset:0,limit:20,total:0}:
      method==="contest_score"?{sessionID:current.sessionID,revision:current.revision,score,matrices:{countries:[],zones:[]}}:null;
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await userEvent.click(await screen.findByRole("button",{name:"New Contest"}));
  fireEvent.change(screen.getByLabelText("Log Type"),{target:{value:pluginID}});
  await userEvent.click(screen.getByRole("button",{name:"OK"}));
  await waitFor(()=>expect(surfaceOwner.current.projections.propagation.score.multiplierDisplayLabels).toEqual(labels));
  const projected=surfaceOwner.current.projections.propagation.score;
  expect(surfaceOwner.current.projections["score-reporting"].score.multiplierDisplayLabels).toEqual(labels);
  const summary=within(render(<ContestScoreSummary score={projected}/>).container);
  for(const label of labels)expect(summary.getByText(label)).toBeTruthy();
  expect(summary.queryByText("0 countries")).toBeNull();
  expect(summary.getAllByText(String(score.multipliers)).length).toBeGreaterThan(0);
});

it.each([
  ["euhfc", "EUHFC"], ["iaru_hf", "IARU HF"], ["arrl_10m", "ARRL 10M"],
])("changes $1 current operating mode without rewriting the MIXED entry category", async (pluginID, pluginName) => {
  const saved=newContestSetup("OM0RX");saved.pluginID=pluginID;saved.name=pluginName;saved.settings.ModeCategory="MIXED";
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1",JSON.stringify(saved));
  let current:any={...projection(2),pluginID,pluginName,supportedModes:["CW","SSB"],matrixTrackers:[]};
  const request=vi.fn(async(method:string,params:Record<string,any>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    let result:any=method==="contest_catalog"?{plugins:[{id:pluginID,name:pluginName,modes:["CW","SSB"]}]}:
      method==="contest_sessions"?{sessions:[]}:method==="contest_create"?{projection:current}:
      method==="contest_log_page"?{rows:[],total:0}:method==="contest_score"?{sessionID:current.sessionID,revision:current.revision,score:current.score}:null;
    if(method==="contest_draft_apply"){
      const mode=params.mode??current.mode,report=mode==="SSB"?"59":"599";
      current={...current,revision:current.revision+1,mode,fields:current.fields.map((field:any)=>({...field,
        value:field.id==="sent"||field.id==="receive"?report:params.fields?.[field.id]??field.value}))};
      result={projection:current,actions:[],messages:[]};
    }
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} contestingTest/>);
  await createContestThroughSetup();
  let entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,
    panelID:"active-qso",projectionRevision:1,requestID:crypto.randomUUID(),action:"entry_set_mode",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,value:"SSB"}}));
  const phoneTransition=request.mock.calls.find(([method,params])=>method==="contest_draft_apply"&&params?.mode==="SSB")?.[1];
  expect(phoneTransition).toMatchObject({mode:"SSB"});
  expect(phoneTransition?.fields).not.toHaveProperty("sent");expect(phoneTransition?.fields).not.toHaveProperty("receive");
  expect(surfaceOwner.current.projections["active-qso"]).toMatchObject({session:{mode:"SSB"},draft:{mode:"SSB",sentReport:"59",receivedReport:"59"}});
  expect(setupDialogOwner.current.document.settings.ModeCategory).toBe("MIXED");
  entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,
    panelID:"active-qso",projectionRevision:2,requestID:crypto.randomUUID(),action:"entry_set_mode",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,value:"CW"}}));
  expect(surfaceOwner.current.projections["active-qso"]).toMatchObject({session:{mode:"CW"},draft:{mode:"CW",sentReport:"599",receivedReport:"599"}});
  expect(setupDialogOwner.current.document.settings.ModeCategory).toBe("MIXED");
});

it("projects CWOPS Open serial/name exchange, retained dupes and unique-call score", async () => {
  const current = { ...projection(4, {other_1:"003",other_2:"12 ALICE"}), pluginID:"cwo", pluginName:"CWOPS - Open",
    columns:["YYYY-MM-DD HH:MM:SS","Call","Freq","Snt","Rcv","SentNr","RcvNr","Name","M1","PTS"],
    reservedSerial:3,allocatedSerialFieldID:"other_1",allowDuplicateCommit:true,dupe:true,dupeExplanation:"Worked on this band.",matrixTrackers:[],
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
    frequencyHz:7_025_000,band:7,reservedSerial:1,allocatedSerialFieldID:"other_1",supportedBands:["160m","80m","40m"],supportedModes:["CW"],
    columns:["YYYY-MM-DD HH:MM:SS","Call","Freq","Mode","Snt","Rcv","SentNr","RcvNr","M1","PTS"],
    allowDuplicateCommit:true,dupe:true,dupeExplanation:"Worked on this band and mode in this 2-hour UTC block (08–10, 10–12, 12–14).",matrixTrackers:[],
    ruleIdentity:{id:"trans-tasman",version:"26.10.11",edition:"not1mm-python",sourceRevision:"7c8b499225a73f7f8f792246881bd7aefc05452f"},
    score:{qsos:1,points:1,countries:0,zones:0,multipliers:1,prefixes:1,total:1} };
  current.fields = current.fields.map(field => ({...field,visible:field.id === "other_1" ? true : field.visible,readOnly:field.id==="other_1",
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
  { pluginID:"cq_ww_ssb", pluginName:"CQ WW SSB",
    columns:["YYYY-MM-DD HH:MM:SS","Call","Freq","Snt","Rcv","M1","CQ Zone","M2","Country","PTS"],
    sourceColumns:[],
    row:{ID:"cqww-ssb-qso",TS:"2026-10-20 11:00:00",Call:"K1ABC",Freq:14250,QSXFreq:14260,Band:14,Mode:"USB",SNT:"59",RCV:"59",SentNr:15,ZN:5,Power:"100",
      CountryPrefix:"K",WPXPrefix:"K1",IsMultiplier1:1,IsMultiplier2:1,Points:3,is_dupe:1,raw_fields:{other_2:""}},
    receivedExchange:"5", multiplierLabels:["K","Zone 5"],
    values:["2026-10-20 11:00:00","K1ABC","14250","59","59","✓","5","✓","K","3"],
    correction:[{id:"other_1",label:"Sent exchange",value:"15",required:true,maximumUTF8Bytes:32},
      {id:"other_2",label:"CQ Zone",value:"5",required:true,maximumUTF8Bytes:128}] },
  { pluginID:"oceania_dx_ssb", pluginName:"Oceania DX SSB", sourceColumns:undefined,
    columns:["YYYY-MM-DD HH:MM:SS","Call","Freq","Snt","Rcv","SentNr","RcvNr","M1","PTS"],
    row:{ID:"oc-ssb-qso",TS:"2026-10-20 11:00:00",Call:"VK4ABC",Freq:14250,Band:14,Mode:"USB",SNT:"59",RCV:"59",SentNr:1,NR:123,WPXPrefix:"VK4",IsMultiplier1:1,Points:1},
    receivedExchange:"123", multiplierLabels:["VK4"], values:["2026-10-20 11:00:00","VK4ABC","14250","59","59","1","123","✓","1"], correction:undefined },
  { pluginID:"oceania_dx_cw", pluginName:"Oceania DX CW", sourceColumns:undefined,
    columns:["YYYY-MM-DD HH:MM:SS","Call","Freq","Snt","Rcv","SentNr","RcvNr","M1","PTS"],
    row:{ID:"oc-qso",TS:"2026-10-20 11:00:00",Call:"VK4ABC",Freq:14025,Band:14,Mode:"CW",SNT:"599",RCV:"599",SentNr:1,NR:123,WPXPrefix:"VK4",IsMultiplier1:1,Points:1},
    receivedExchange:"123", multiplierLabels:["VK4"], values:["2026-10-20 11:00:00","VK4ABC","14025","599","599","1","123","✓","1"], correction:undefined },
  { pluginID:"cq_wpx_cw", pluginName:"CQ WPX CW", sourceColumns:undefined,
    columns:["YYYY-MM-DD HH:MM:SS","Call","Freq","Snt","Rcv","SentNr","RcvNr","WPX","M1","PTS"],
    row:{ID:"wpx-qso",TS:"2026-10-20 11:00:00",Call:"K1ABC",Freq:14025,Band:14,Mode:"CW",SNT:"599",RCV:"599",SentNr:1,NR:123,WPXPrefix:"K1",IsMultiplier1:1,Points:3},
    receivedExchange:"123", multiplierLabels:["K1"], values:["2026-10-20 11:00:00","K1ABC","14025","599","599","1","123","K1","✓","3"],
    correction:[{id:"other_1",label:"SentNR",value:"1",required:true,maximumUTF8Bytes:32},{id:"other_2",label:"RcvNR",value:"123",required:true,maximumUTF8Bytes:128}] },
  { pluginID:"cq_wpx_ssb", pluginName:"CQ WPX SSB", sourceColumns:undefined,
    columns:["YYYY-MM-DD HH:MM:SS","Call","Freq","Snt","Rcv","SentNr","RcvNr","WPX","M1","PTS"],
    row:{ID:"wpx-ssb-qso",TS:"2026-10-20 11:00:00",Call:"K1ABC",Freq:14250,Band:14,Mode:"USB",SNT:"59",RCV:"59",SentNr:1,NR:123,WPXPrefix:"K1",IsMultiplier1:1,Points:3},
    receivedExchange:"123", multiplierLabels:["K1"], values:["2026-10-20 11:00:00","K1ABC","14250","59","59","1","123","K1","✓","3"],
    correction:[{id:"other_1",label:"SentNR",value:"1",required:true,maximumUTF8Bytes:32},{id:"other_2",label:"RcvNR",value:"123",required:true,maximumUTF8Bytes:128}] },
  { pluginID:"arrl_ss_cw", pluginName:"ARRL Sweepstakes CW", sourceColumns:undefined,
    columns:["YYYY-MM-DD HH:MM:SS","Call","Freq","Snt","Rcv","SentNr","RcvNr","CK","Prec","Sect","M1","PTS"],
    row:{ID:"ss-qso",TS:"2026-10-20 12:00:00",Call:"K1ABC",Freq:14025,Band:14,Mode:"CW",SNT:"599",RCV:"599",SentNr:1,NR:123,CK:67,Prec:"A",Sect:"CT",IsMultiplier1:1,Points:2},
    receivedExchange:"123 A K1ABC 67 CT", multiplierLabels:["Section CT"], values:["2026-10-20 12:00:00","K1ABC","14025","599","599","1","123","67","A","CT","✓","2"],
    correction:[{id:"other_1",label:"SentNR",value:"1",required:true,maximumUTF8Bytes:32},{id:"other_2",label:"sn: p: cl: ck: sec:",value:"123 A K1ABC 67 CT",required:true,maximumUTF8Bytes:128}] },
  { pluginID:"arrl_ss_phone", pluginName:"ARRL Sweepstakes Phone", sourceColumns:undefined,
    columns:["YYYY-MM-DD HH:MM:SS","Call","Freq","Snt","Rcv","SentNr","RcvNr","CK","Prec","Sect","M1","PTS"],
    row:{ID:"ss-phone-qso",TS:"2026-10-20 12:00:00",Call:"K1ABC",Freq:14250,Band:14,Mode:"USB",SNT:"59",RCV:"59",SentNr:1,NR:123,CK:67,Prec:"A",Sect:"CT",IsMultiplier1:1,Points:2},
    receivedExchange:"123 A K1ABC 67 CT", multiplierLabels:["Section CT"], values:["2026-10-20 12:00:00","K1ABC","14250","59","59","1","123","67","A","CT","✓","2"],
    correction:[{id:"other_1",label:"SentNR",value:"1",required:true,maximumUTF8Bytes:32},{id:"other_2",label:"sn: p: cl: ck: sec:",value:"123 A K1ABC 67 CT",required:true,maximumUTF8Bytes:128}] },
  ])("projects the actual $pluginName log columns, exchange, multiplier and correction prefill", async ({pluginID,pluginName,columns,sourceColumns,row,receivedExchange,multiplierLabels,values,correction}) => {
    const current={...projection(3,{other_1:"002"}),pluginID,pluginName,columns:sourceColumns??columns,matrixTrackers:[],
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
    pluginRows:[{qsoID:row.ID,values,isDupe:"is_dupe" in row&&row.is_dupe===1}],pluginPartialRows:[],page:{rows:[{receivedExchange,...(multiplierLabels ? {multiplierLabels} : {})}]}});
  if(pluginID==="cq_ww_ssb")expect(logbook.pluginRows[0].inlineEdits[columns.indexOf("CQ Zone")])
    .toMatchObject({kind:"exchange",fieldID:"other_2",value:"5"});
  expect(logbook).not.toHaveProperty("manualRows");
  expect(validContestSurfaceProjection("logbook",logbook)).toBe(true);
  if(correction){
    await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
      panelID:"logbook",projectionRevision:current.revision,requestID:crypto.randomUUID(),action:"log_edit_begin",params:{qsoID:row.ID}}));
    expect(surfaceOwner.current.projections.logbook.editing.receivedFields).toEqual(correction);
    if(pluginID==="cq_ww_ssb"){
      expect(surfaceOwner.current.projections.logbook.editing).toMatchObject({editorProfile:"cq_ww_ssb",
        editReceiveFrequencyText:"14260000",editPower:"100",band:"20m",details:{receivedNumber:"5",zone:"5",power:"100"}});
      for(const [field,value] of [["receiveFrequency","14261000"],["power","80"]] as const)
        await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
          panelID:"logbook",projectionRevision:current.revision,requestID:crypto.randomUUID(),action:"log_edit_set_text",
          params:{qsoID:row.ID,field,value}}));
      await waitFor(()=>expect(surfaceOwner.current.projections.logbook.editing).toMatchObject({
        editReceiveFrequencyText:"14261000",editPower:"80"}));
    }
  }
});

it("creates an SSB session from catalog metadata and runs ESM without native CW admission", async () => {
  const esmSetup=newContestSetup("OM0RX");esmSetup.preferences.useESM=true;
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1",JSON.stringify(esmSetup));
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
    draft:{sentReport:"59",receivedReport:"59"},operator:{armed:false,outputAvailable:false,
      functionKeys:expect.arrayContaining([expect.objectContaining({key:"F2",highlighted:true})]),readiness:{canSendCQ:false}}});
  expect(request.mock.calls.find(([method])=>method==="contest_create")?.[1]?.settings).toMatchObject({ModeCategory:"SSB"});
  await act(async()=>{await surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:3,key:"Enter",focusedField:"other_2"}});});
  expect(request.mock.calls.some(([method])=>method==="contest_esm")).toBe(true);
  expect(nativeCW.execute).not.toHaveBeenCalled();
});

it.each([
  {pluginID:"cq_wpx_ssb",pluginName:"CQ WPX SSB",other1:"001",other2:"123",reservedSerial:1,esmPayload:"59 001"},
  {pluginID:"arrl_ss_phone",pluginName:"ARRL Sweepstakes Phone",other1:"001",other2:"123 A K1ABC 67 CT",reservedSerial:1,esmPayload:"K1ABC 001 A OM0RX 67 CT"},
])("simulates only claimed $pluginName voice-keyer intents in Contesting Test", async ({pluginID,pluginName,other1,other2,reservedSerial,esmPayload}) => {
  const esmSetup=newContestSetup("OM0RX");esmSetup.preferences.useESM=true;
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1",JSON.stringify(esmSetup));
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
      const origin=current;
      const next:any={...current,revision:current.revision+1};
      if(method==="contest_esm"){
        logged=true;next.score={...next.score,qsos:1,points:1,total:1};
        next.draftID="99999999-9999-4999-8999-999999999999";
        next.fields=next.fields.map((field:any)=>({...field,value:field.id==="sent"||field.id==="receive"?"59":""}));
      }
      const key=method==="contest_esm"?"F3":String(params.key),label=method==="contest_esm"?"Exchange":key==="F12"?"His call TU":`Message ${key.slice(1)}`;
      const payload=method==="contest_esm"?esmPayload:"K1ABC rr tu";
      lastActions=[{actionID:`${params.operationID}:0`,kind:"voice_keyer",signal:"phone",mode:"SSB",key,label,payload,
        payloadUTF8Bytes:new TextEncoder().encode(payload).byteLength,payloadSHA256:"0".repeat(64),sourceMacroSHA256:"1".repeat(64),
        sourceMacro:{origin:"pinned_not1mm",path:"not1mm/data/cwmacros.txt",revision:next.sourceRevision,mode:"S",key,label,template:payload},
        sessionID:origin.sessionID,workspaceGeneration:origin.workspaceGeneration,sourceRevision:origin.sourceRevision,draftID:origin.draftID}];
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
    await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"]).toMatchObject({busy:false,draft:{draftID:current.draftID}}));
    expect(request.mock.calls.filter(([method])=>method==="contest_log_page").at(-1)?.[1]).toMatchObject({expectedRevision:current.revision});
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
  expect(surfaceOwner.current.projections["active-qso"].draft).toMatchObject({
    draftID:"99999999-9999-4999-8999-999999999999",callsign:"",sentReport:"59",receivedReport:"59"});
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
  const recoveredSurfaceRevision=surfaceOwner.current.projections["active-qso"].draft.revision;
  await act(async()=>releaseMutation?.());
  expect(surfaceOwner.current.projections["active-qso"].draft.revision).toBe(recoveredSurfaceRevision);
  const recoveredRevision=current.revision;
  await act(async()=>releaseSetup?.());holdSetup=false;openedProjection=null;
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"]).toMatchObject({busy:false,draft:{revision:recoveredSurfaceRevision}}));
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
  expect(surfaceOwner.current.projections["active-qso"].draft.revision).toBe(entry.draft.revision);
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
])("keeps production $pluginName voice optional while logging Enter without output", async ({pluginID,pluginName}) => {
  let current={...projection(3,{callsign:"K1ABC",sent:"59",receive:"59",other_1:"001"}),pluginID,pluginName,
    mode:"SSB",supportedModes:["SSB"] as const,reservedSerial:pluginID==="cq_ww_ssb"?null:1,matrixTrackers:[] as Array<"countries"|"zones">};
  let esmCalls=0,logged=0;
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    let result:any=method==="contest_catalog"?{plugins:[{id:pluginID,name:pluginName,modes:["SSB"]}]}:
      method==="contest_sessions"?{sessions:[]}:method==="contest_create"?{projection:current}:
      method==="contest_log_page"?{rows:[],total:logged}:method==="contest_score"?{score:current.score}:null;
    if(method==="contest_esm"){
      esmCalls+=1;const origin=current,final=esmCalls===2;
      current={...current,revision:current.revision+1,focus:final?"callsign":"other_2",
        ...(final?{draftID:"99999999-9999-4999-8999-999999999999",score:{...current.score,qsos:1,points:1,total:1}}:{})};
      if(final)logged+=1;
      const operationID=String(params.operationID);
      result={operationID,revision:current.revision,projection:current,replayed:false,messages:[],actions:[{
        actionID:`${operationID}:0`,kind:"voice_keyer",signal:"phone",mode:"SSB",sessionID:origin.sessionID,
        workspaceGeneration:origin.workspaceGeneration,sourceRevision:origin.sourceRevision,draftID:origin.draftID,
      }]};
    }else if(method==="contest_qso_commit"){
      logged+=1;current={...current,revision:current.revision+1,draftID:"99999999-9999-4999-8999-999999999999",
        focus:"callsign",score:{...current.score,qsos:1,points:1,total:1}};
      result={projection:current,actions:[],messages:[]};
    }
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();
  const entry=surfaceOwner.current.projections["active-qso"];
  expect(entry.operator).toMatchObject({outputAvailable:false,
    outputUnavailableReason:expect.stringMatching(/Voice WAV profile folder/)});
  if(pluginID==="cq_ww_ssb")expect(entry.descriptor.spaceNext).toEqual({callsign:"other_2"});
  expect(entry.operator.functionKeys).toHaveLength(12);
  expect(entry.operator.functionKeys[1]).toEqual({key:"F2",macro:"F2",highlighted:true});
  await expect(surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"F1",focusedField:"callsign"}})).rejects.toThrow("unavailable in production");
  expect(request.mock.calls.some(([method])=>method==="contest_function_key")).toBe(false);
  expect(request.mock.calls.some(([method])=>method==="contest_output_claim")).toBe(false);
  await act(async()=>surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"Enter",focusedField:"callsign"}}));
  expect(esmCalls).toBe(0);expect(logged).toBe(1);
  expect(surfaceOwner.current.projections["active-qso"].operator.focusedField).toBe("callsign");
  expect(request.mock.calls.filter(([method])=>method==="contest_qso_commit")).toHaveLength(1);
  expect(request.mock.calls.some(([method])=>method==="contest_output_claim")).toBe(false);
  expect(nativeVoice.play).not.toHaveBeenCalled();
});

it.each([false,true])("confirms a durable Enter save before auxiliary reads and fences their stale replies (publication fails: %s)",async(publicationFails)=>{
  let current:any={...projection(3,{callsign:"K1ABC",sent:"59",receive:"59",other_2:"5"}),
    pluginID:"cq_ww_ssb",pluginName:"CQ WW SSB",mode:"SSB",supportedModes:["SSB"],reservedSerial:null};
  let committed=false,completed=false;
  const releases:(()=>void)[]=[];
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    if(committed&&["contest_log_page","contest_score","contest_rates"].includes(method)){
      const reply=method==="contest_log_page"?{rows:[],total:1}:method==="contest_score"?{score:current.score}:
        workspaceSupport(method,params,current)?.result;
      return new Promise(resolve=>releases.push(()=>resolve({id:crypto.randomUUID(),ok:true,result:reply})));
    }
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    let result:any=method==="contest_catalog"?{plugins:[{id:"cq_ww_ssb",name:"CQ WW SSB",modes:["SSB"]}]}:
      method==="contest_sessions"?{sessions:[]}:method==="contest_create"?{projection:current}:
      method==="contest_log_page"?{rows:[],total:0}:method==="contest_score"?{score:current.score}:null;
    if(method==="contest_qso_commit"){
      committed=true;current={...current,revision:current.revision+1,draftID:crypto.randomUUID(),
        fields:current.fields.map((field:any)=>({...field,value:field.id==="callsign"?"":field.value})),
        score:{...current.score,qsos:1,points:1,total:1}};
      result={projection:current,actions:[],messages:[]};
    }else if(method==="contest_draft_apply"){
      current={...current,revision:current.revision+1,fields:current.fields.map((field:any)=>({...field,
        value:(params.fields as Record<string,string>)[field.id]??field.value}))};
      result={projection:current,actions:[],messages:[]};
    }
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();
  const originalDraft=current.draftID;
  surfaceOwner.waitForPublication.mockClear();
  if(publicationFails)surfaceOwner.waitForPublication.mockRejectedValueOnce(new Error("The saved contact view could not be published."));
  act(()=>{void surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,
    action:"entry_operator_key",params:{draftID:originalDraft,expectedDraftRevision:current.revision,key:"Enter",focusedField:"callsign"}})
    .then(()=>{completed=true;});});
  await waitFor(()=>expect(releases).toHaveLength(3));
  await waitFor(()=>expect(completed).toBe(true),{timeout:300});
  expect(surfaceOwner.current.projections["active-qso"]).toMatchObject({busy:false,draft:{draftID:current.draftID}});
  expect(current.draftID).not.toBe(originalDraft);
  expect(surfaceOwner.waitForPublication).toHaveBeenCalled();
  await act(async()=>surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,
    action:"entry_set_text",params:{draftID:current.draftID,expectedDraftRevision:current.revision,field:"callsign",value:"OK5D"}}));
  await act(async()=>releases.forEach(release=>release()));
  expect(surfaceOwner.current.projections["active-qso"].draft.callsign).toBe("OK5D");
  expect(surfaceOwner.current.projections.logbook.page.total).toBe(0);
  expect(request.mock.calls.filter(([method])=>method==="contest_qso_commit")).toHaveLength(1);
});

it.each([{configured:false},{configured:true}])("projects original RTTY macros with truthful fldigi availability ($configured)",async({configured})=>{
  const current={...projection(),pluginID:"cq_ww_rtty",pluginName:"CQ WW RTTY",mode:"RTTY",supportedModes:["RTTY"] as const,
    fldigiTransmitAvailable:true,matrixTrackers:["countries","zones"] as Array<"countries"|"zones">};
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    const result=method==="contest_catalog"?{plugins:[{id:"cq_ww_rtty",name:"CQ WW RTTY",modes:["RTTY"]}]}:
      method==="contest_sessions"?{sessions:[]}:method==="contest_create"?{projection:current}:
      method==="contest_log_page"?{rows:[],total:0}:method==="contest_score"?{score:current.score}:null;
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  const digital={configuration:{enabled:false,address:"224.0.0.1",port:42424,destination:"active_contest"},running:false,
    status:"Stopped",receive_only:true,contest_target_supported:true,active_contest:{session_id:current.sessionID,plugin_id:current.pluginID}};
  const fldigi={configuration:{receive_enabled:false,transmit_enabled:configured},receive_supported:true,transmit_supported:true,
    receive_running:false,status:configured?"Ready":"Stopped",udp_endpoint:"127.0.0.1:9876",xmlrpc_endpoint:"http://127.0.0.1:7362/RPC2"};
  const serviceRequest=vi.fn(async(method:string,params?:Record<string,unknown>)=>method==="wsjtx_snapshot"?digital:
    method==="fldigi_snapshot"?fldigi:request(method,params));
  render(<Not1MMContestWorkspace request={request} serviceRequest={serviceRequest} {...workspaceProps}/>);
  await createContestThroughSetup();
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].operator.outputAvailable).toBe(configured));
  const entry=surfaceOwner.current.projections["active-qso"];
  expect(entry.operator.status).toBe(configured?"armed":"disarmed");
  expect(entry.operator.functionKeys).toHaveLength(12);
  expect(entry.operator.functionKeys[1]).toEqual({key:"F2",macro:"F2",highlighted:true});
  expect(entry.operator.outputUnavailableReason).toBe(configured?null:
    "fldigi macro output is unavailable. Enable fldigi macro transmit in Digital Logging Setup.");
  if(!configured){
    await expect(surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,action:"entry_operator_key",
      params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"F1",focusedField:"callsign"}})).rejects.toThrow("Enable fldigi macro transmit");
    expect(request.mock.calls.some(([method])=>method==="contest_function_key")).toBe(false);
    expect(request.mock.calls.some(([method])=>method==="contest_output_claim")).toBe(false);
    expect(serviceRequest.mock.calls.some(([method])=>method==="fldigi_send")).toBe(false);
  }
});

it("projects and routes production recorded-phone arm and stop only with a saved profile",async()=>{
  const saved=newContestSetup("OM0RX");saved.pluginID="cq_ww_ssb";saved.name="CQ WW SSB";saved.settings.ModeCategory="SSB";
  saved.preferences.voiceProfilePath="/operator/voice";
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1",JSON.stringify(saved));
  const current={...projection(),pluginID:"cq_ww_ssb",pluginName:"CQ WW SSB",mode:"SSB",supportedModes:["SSB"] as const,
    fields:projection().fields.map(field=>({...field,value:field.id==="sent"||field.id==="receive"?"59":field.value})),matrixTrackers:[]};
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    const result=method==="contest_catalog"?{plugins:[{id:"cq_ww_ssb",name:"CQ WW SSB",modes:["SSB"]}]}:
      method==="contest_sessions"?{sessions:[]}:method==="contest_create"?{projection:current}:
      method==="contest_log_page"?{rows:[],total:0}:method==="contest_score"?{sessionID:current.sessionID,revision:current.revision,score:current.score,matrices:{},statistics:statisticsFor(current)}:null;
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);await createContestThroughSetup();
  let entry=surfaceOwner.current.projections["active-qso"];
  expect(entry.operator).toMatchObject({output:"xlog-native",armed:false,status:"disarmed"});
  expect(entry.operator.functionKeys.length).toBeGreaterThan(0);
  await act(async()=>surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,action:"entry_operator_arm",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,armed:true}}));
  entry=surfaceOwner.current.projections["active-qso"];expect(entry.operator).toMatchObject({armed:true,status:"armed"});
  const stopsBeforeDisarm=nativeVoice.stop.mock.calls.length;
  nativeVoice.stop.mockRejectedValueOnce(new Error("RX confirmation unavailable"));
  await act(async()=>{await expect(surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,action:"entry_operator_arm",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,armed:false}})).rejects.toThrow("RX confirmation unavailable");});
  entry=surfaceOwner.current.projections["active-qso"];
  expect(entry.operator).toMatchObject({armed:true,status:"uncertain",readiness:{canSendCQ:false,canSendCall:false,canSendDuplicate:false}});
  nativeVoice.stop.mockResolvedValueOnce(undefined);
  await act(async()=>surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,action:"entry_operator_arm",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,armed:false}}));
  expect(nativeVoice.stop.mock.calls.length).toBe(stopsBeforeDisarm+2);
  expect(surfaceOwner.current.projections["active-qso"].operator).toMatchObject({armed:false,status:"disarmed"});
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
          revision:current.sourceRevision,mode:"R",key:params.key,label:"CQ",template:"CQ {MYCALL}"},sessionID:current.sessionID,
          workspaceGeneration:current.workspaceGeneration,sourceRevision:current.sourceRevision,draftID:current.draftID}];
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

it("records only a confirmed CQ at the observed VFO and returns through the owned tune route",async()=>{
  let current=projection(),radioFrequencyHz=14_025_000;
  const request=vi.fn(async(method:string,params:Record<string,any>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    let result:any;
    if(method==="contest_catalog")result={plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]};
    else if(method==="contest_sessions")result={sessions:[]};
    else if(method==="contest_create")result={projection:current};
    else if(method==="contest_log_page")result={rows:[],total:0};
    else if(method==="contest_score")result={score:current.score};
    else if(method==="contest_draft_apply"){
      current={...current,revision:current.revision+1,frequencyHz:params.frequencyHz};result={projection:current,actions:[],messages:[]};
    }else throw new Error(method);
    return{id:crypto.randomUUID(),ok:true,result};
  });
  nativeCW.execute.mockImplementation(async params=>{
    current={...current,revision:current.revision+1};
    return{contestResult:{operationID:params.operationID,projection:current,actions:[]}};
  });
  const tune=vi.fn(async()=>({accepted:true,confirmed:true}));
  const view=render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}
    radioFrequencyHz={radioFrequencyHz} stationTune={tune}/>);
  await createContestThroughSetup();let entry=surfaceOwner.current.projections["active-qso"];
  const envelope={operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"active-qso",projectionRevision:1,requestID:crypto.randomUUID()} as const;
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"F1",focusedField:"callsign"}}));
  radioFrequencyHz=7_025_000;
  view.rerender(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}
    radioFrequencyHz={radioFrequencyHz} stationTune={tune}/>);
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].draft.frequencyHz).toBe(7_025_000));
  await waitFor(()=>expect(current.frequencyHz).toBe(7_025_000));
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].busy).toBe(false));
  expect(surfaceOwner.current.projections["active-qso"].draft.revision).toBe(entry.draft.revision+1);
  expect(current.revision).toBe(3);
  expect(request.mock.calls.find(([method])=>method==="contest_draft_apply")?.[1]).toMatchObject({expectedRevision:2});
  entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"entry_return_cq_frequency",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision}}));
  expect(tune).toHaveBeenCalledExactlyOnceWith(14_025_000,"CW");
});

it("keeps detached Escape scoped to contest output and independent from rotor availability",async()=>{
  const current=projection(),request=operationalRequest(()=>current),rotorStop=vi.fn(async()=>({generation:8}));
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} rotorStop={rotorStop}/>);
  await createContestThroughSetup();const entry=surfaceOwner.current.projections["active-qso"],envelope={operatingContext,scope:"contesting",
    sessionID:current.sessionID,workspaceGeneration,panelID:"active-qso",projectionRevision:1,requestID:crypto.randomUUID()} as const;
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"Escape",focusedField:"callsign"}}));
  expect(nativeCW.stop).toHaveBeenCalledTimes(1);expect(rotorStop).not.toHaveBeenCalled();
  rotorStop.mockRejectedValueOnce(new Error("Rotor stop acknowledgement lost"));
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"Escape",focusedField:"callsign"}}));
  expect(nativeCW.stop).toHaveBeenCalledTimes(2);expect(rotorStop).not.toHaveBeenCalled();
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
  expect(surfaceOwner.current.projections["active-qso"].operator.functionKeys).toContainEqual(
    expect.objectContaining({key:"F6",macro:"QSOB4",highlighted:true}));
  await expect(surfaceOwner.current.handle(envelope)).rejects.toThrow("entry changed");
  view.rerender(<Not1MMContestWorkspace {...props} spots={[]}/>);
  await waitFor(()=>expect(surfaceOwner.current.projections["callsign-intelligence"][key]).toEqual([]));
  const missing={...envelope,requestID:crypto.randomUUID(),params:{...envelope.params,expectedDraftRevision:current.revision}};
  await expect(surfaceOwner.current.handle(missing)).rejects.toThrow("no longer available");
  expect(workspaceProps.stationTune).not.toHaveBeenCalled();
  expect(nativeCW.execute).not.toHaveBeenCalled();
});

it("publishes imported plugin history to Check Partial and clears it with the next QSO",async()=>{
  let current={...projection(9,{callsign:"DL1ABC",other_2:"14"}),history:"DL1ABC, 14, imported"};
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    let result:any=method==="contest_catalog"?{plugins:[]}:method==="contest_sessions"?{sessions:[]}:
      method==="contest_create"?{projection:current}:method==="contest_log_page"?{rows:[],total:0}:
      method==="contest_score"?{score:current.score}:method==="contest_check_partial"?{rows:[]}:null;
    if(method==="contest_draft_apply"){
      current={...current,revision:current.revision+1,fields:current.fields.map(field=>
        ({...field,value:(params.fields as Record<string,string>)[String(field.id)]??field.value}))};
      result={projection:current,actions:[],messages:[]};
    }else if(method==="contest_qso_commit"){
      current={...current,revision:current.revision+1,history:"",fields:current.fields.map(field=>
        ({...field,value:field.id==="callsign"||field.id==="other_2"?"":field.value}))};
      result={projection:current,actions:[],messages:[]};
    }
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();
  const expected={candidateID:"history:DL1ABC",callsign:"DL1ABC",
    fields:[{id:"not1mm-history",label:"Not1MM",value:"DL1ABC, 14, imported"}]};
  await waitFor(()=>expect(surfaceOwner.current.projections["callsign-intelligence"].history)
    .toEqual({source:"Imported Call History",rows:[expected]}));
  const check=surfaceOwner.current.projections["callsign-intelligence"];
  await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"callsign-intelligence",projectionRevision:1,requestID:crypto.randomUUID(),action:"assistance_select",
    params:{draftID:current.draftID,expectedDraftRevision:check.draftRevision,kind:"history",candidateID:expected.candidateID}}));
  expect(request.mock.calls.find(([method])=>method==="contest_draft_apply")?.[1]).toMatchObject({fields:{callsign:"DL1ABC"}});
  const entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"active-qso",projectionRevision:entry.draft.revision,requestID:crypto.randomUUID(),action:"entry_commit",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision}}));
  await waitFor(()=>expect(surfaceOwner.current.projections["callsign-intelligence"].history)
    .toEqual({source:null,rows:[]}));
});

it.each([
  {label:"mixed-mode Band Map",panelID:"band-maps" as const,supportedModes:["CW","SSB"],expectedMode:"SSB"},
  {label:"single-mode Cluster",panelID:"dx-cluster" as const,supportedModes:["CW"],expectedMode:"CW"},
])("applies a $label contest spot mode to the radio and authoritative Not1MM draft exactly once",async({panelID,supportedModes,expectedMode})=>{
  let current={...projection(),supportedModes};
  const tune=vi.fn(async(_frequencyHz:number,_mode:string)=>({accepted:true,confirmed:true}));
  const frequencyKHz=expectedMode==="CW"?14025:14195;
  const spot={id:"spot-1",callsign:"DL1ABC",frequencyKHz,band:"20m",mode:supportedModes.length===1?"CW":"USB"};
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    let result:any=method==="contest_catalog"?{plugins:[]}:method==="contest_sessions"?{sessions:[]}:
      method==="contest_create"?{projection:current}:method==="contest_log_page"?{rows:[],total:0}:
      method==="contest_score"?{score:current.score}:null;
    if(method==="contest_draft_apply"){
      current={...projection(current.revision+1,params.fields as Record<string,string>),supportedModes,
        frequencyHz:Number(params.frequencyHz),mode:String(params.mode??current.mode)};
      result={projection:current,actions:[],messages:[]};
    }
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} stationTune={tune} spots={[spot]}
    cluster={{configuration:{servers:[{id:"server-1",name:"ShackCQ",enabled:true}]},snapshot:{connectedClusters:1,loadedSpots:25,
      connections:[{serverID:"server-1",serverName:"ShackCQ",phase:"connected",error:null}]}}}/>);
  await createContestThroughSetup();
  await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"].spots).toHaveLength(1));
  expect(surfaceOwner.current.projections["dx-cluster"]).toMatchObject({connectedClusters:1,loadedSpots:25,
    configuredClusters:[{serverID:"server-1",serverName:"ShackCQ",enabled:true}],
    connections:[{serverID:"server-1",serverName:"ShackCQ",phase:"connected",error:null}]});
  const envelope={operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,panelID,
    projectionRevision:1,requestID:crypto.randomUUID(),action:"spot_select",params:{draftID:current.draftID,expectedDraftRevision:current.revision,spotID:"spot-1"}};
  await expect(surfaceOwner.current.handle({...envelope,params:{...envelope.params,expectedDraftRevision:current.revision-1}})).rejects.toThrow("entry changed");
  expect(tune).not.toHaveBeenCalled();
  await act(async()=>surfaceOwner.current.handle(envelope));
  expect(tune).toHaveBeenCalledExactlyOnceWith(frequencyKHz*1_000,expectedMode);
  expect(request.mock.calls.filter(([method,params])=>method==="contest_draft_apply"&&params?.mode===expectedMode))
    .toEqual([expect.arrayContaining(["contest_draft_apply",expect.objectContaining({frequencyHz:frequencyKHz*1_000,mode:expectedMode})])]);
  expect(surfaceOwner.current.projections["active-qso"].draft.mode).toBe(expectedMode);
  expect(request.mock.calls.some(([method])=>method==="activate_spot")).toBe(false);
});

it("steps the observed VFO only through the injected durable station owner",async()=>{
  let current=projection();const step=vi.fn(async()=>({accepted:true,confirmed:true}));
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    const result=method==="contest_catalog"?{plugins:[]}:method==="contest_sessions"?{sessions:[]}:
      method==="contest_create"?{projection:current}:method==="contest_log_page"?{rows:[],total:0}:
      method==="contest_score"?{score:current.score}:null;
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} stationStep={step}/>);
  await createContestThroughSetup();const entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"active-qso",projectionRevision:entry.draft.revision,requestID:crypto.randomUUID(),action:"entry_step_vfo",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,direction:"up"}}));
  expect(step).toHaveBeenCalledExactlyOnceWith("up");
  expect(request.mock.calls.some(([method])=>method==="contest_draft_apply")).toBe(false);
});

it("steps through distinct displayed spots from the last mouse selection and reconciles a changed list",async()=>{
  let current={...projection(),frequencyHz:14_021_000,supportedModes:["CW","SSB"]};
  const tune=vi.fn(async(_frequencyHz:number,_mode:string)=>({accepted:true,confirmed:true}));
  const spots=[
    {id:"spot-1",callsign:"DL1AAA",frequencyKHz:14021,band:"20m",mode:"CW"},
    {id:"spot-2",callsign:"DL2BBB",frequencyKHz:14192,band:"20m",mode:"SSB"},
    {id:"spot-3",callsign:"DL3CCC",frequencyKHz:14023,band:"20m",mode:"CW"},
  ];
  const request=vi.fn(async(method:string,params:Record<string,any>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    let result:any=method==="contest_catalog"?{plugins:[]}:method==="contest_sessions"?{sessions:[]}:
      method==="contest_create"?{projection:current}:method==="contest_log_page"?{rows:[],total:0}:
      method==="contest_score"?{score:current.score}:null;
    if(method==="contest_draft_apply"){
      current={...current,revision:current.revision+1,frequencyHz:params.frequencyHz,
        mode:params.mode??current.mode,
        fields:current.fields.map((field:any)=>({...field,value:params.fields[field.id]??field.value}))};
      result={projection:current,actions:[],messages:[]};
    }
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  const selected=vi.fn((_id:string)=>{});
  const view=render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} stationTune={tune}
    radioFrequencyHz={current.frequencyHz} spots={spots as any} selectedSpotId="spot-1" onSelectedSpot={selected}/>);
  await createContestThroughSetup();
  const action=async(action:string,params:Record<string,unknown>)=>{
    const entry=surfaceOwner.current.projections["active-qso"];
    await act(async()=>surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,
      panelID:"active-qso",projectionRevision:entry.draft.revision,requestID:crypto.randomUUID(),action,
      params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,...params}}));
  };
  await action("entry_step_spot",{direction:"next"});
  await action("entry_step_spot",{direction:"next"});
  await action("spot_select",{spotID:"spot-1"});
  await action("entry_step_spot",{direction:"next"});
  expect(tune.mock.calls.map(([frequency])=>frequency)).toEqual([14_023_000,14_192_000,14_021_000,14_023_000]);
  expect(tune.mock.calls.map(([,mode])=>mode)).toEqual(["CW","SSB","CW","CW"]);
  expect(selected.mock.calls.map(([id])=>id)).toEqual(["spot-3","spot-2","spot-1","spot-3"]);
  view.rerender(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} stationTune={tune}
    radioFrequencyHz={current.frequencyHz} spots={[spots[2]] as any} selectedSpotId={null} onSelectedSpot={selected}/>);
  await action("entry_step_spot",{direction:"next"});
  expect(tune).toHaveBeenLastCalledWith(14_023_000,"CW");
});

it("navigates only fresh needed multipliers on the current band in frequency order and rejects old scoring during rebuild",async()=>{
  let current=projection(),release:(()=>void)|undefined;
  const tune=vi.fn(async()=>({accepted:true,confirmed:true}));
  const base=operationalRequest(()=>current,()=>3,id=>({dupe:id==="dupe",multiplierCount:["low","high","other-band"].includes(id)?2:0,
    countryMultiplier:["low","high","other-band"].includes(id),zoneMultiplier:["low","high","other-band"].includes(id)}));
  const request=vi.fn(async(method:string,params:Record<string,any>={})=>{
    if(method==="contest_draft_apply"){
      current={...current,revision:current.revision+1,frequencyHz:params.frequencyHz,fields:current.fields.map(field=>({...field,value:params.fields[String(field.id)]??field.value}))};
      return{id:crypto.randomUUID(),ok:true,result:{projection:current,actions:[],messages:[]}};
    }
    if(method==="contest_qso_commit"){
      current={...current,revision:current.revision+1,draftID:crypto.randomUUID(),score:{...current.score,qsos:1}};
      return{id:crypto.randomUUID(),ok:true,result:{projection:current,actions:[],messages:[]}};
    }
    const reply=await base(method,params);
    return method==="contest_spot_points_preview"&&current.score.qsos>0?new Promise(resolve=>{release=()=>resolve(reply);}):reply;
  });
  const spots=[
    {id:"high",callsign:"DL3ABC",frequencyKHz:14030,band:"20m",mode:"CW"},
    {id:"other-band",callsign:"DL4ABC",frequencyKHz:7025,band:"40m",mode:"CW"},
    {id:"ordinary",callsign:"DL2ABC",frequencyKHz:14027,band:"20m",mode:"CW"},
    {id:"low",callsign:"DL1ABC",frequencyKHz:14026,band:"20m",mode:"CW"},
    {id:"dupe",callsign:"DL5ABC",frequencyKHz:14028,band:"20m",mode:"CW"},
  ] as any;
  const view=render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} stationTune={tune} spots={spots}/>);
  await createContestThroughSetup();
  await waitFor(()=>expect(surfaceOwner.current.projections["dx-cluster"].spots.find((spot:any)=>spot.id==="low")?.contestMultiplierCount).toBe(2));
  const action=(name:string,params:Record<string,unknown>={})=>{const draft=surfaceOwner.current.projections["active-qso"].draft;
    return surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,panelID:"active-qso",requestID:crypto.randomUUID(),
      action:name,params:{draftID:draft.draftID,expectedDraftRevision:draft.revision,...params}});};
  await act(async()=>action("entry_step_spot",{direction:"next",multiplierOnly:true}));
  await act(async()=>action("entry_step_spot",{direction:"next",multiplierOnly:true}));
  await act(async()=>action("entry_step_spot",{direction:"previous",multiplierOnly:true}));
  expect(tune.mock.calls).toEqual([[14_026_000,"CW"],[14_030_000,"CW"],[14_026_000,"CW"]]);
  await act(async()=>action("entry_commit"));await waitFor(()=>expect(release).toBeTypeOf("function"));
  await expect(action("entry_step_spot",{direction:"next",multiplierOnly:true})).rejects.toThrow(/No needed multiplier/);
  expect(tune).toHaveBeenCalledTimes(3);await act(async()=>release?.());
});

it("tunes the selected spot ID when duplicate callsigns exist and rejects an ambiguous callsign fallback",async()=>{
  let current={...projection(1,{callsign:"DL1ABC"}),supportedModes:["CW","SSB"]};
  const tune=vi.fn(async(_frequencyHz:number,_mode:string)=>({accepted:true,confirmed:true}));
  const spots=[
    {id:"duplicate-cw",callsign:"DL1ABC",frequencyKHz:14025,band:"20m",mode:"CW"},
    {id:"duplicate-ssb",callsign:"DL1ABC",frequencyKHz:14195,band:"20m",mode:"SSB"},
  ];
  const request=vi.fn(async(method:string,params:Record<string,any>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    let result:any=method==="contest_catalog"?{plugins:[]}:method==="contest_sessions"?{sessions:[]}:
      method==="contest_create"?{projection:current}:method==="contest_log_page"?{rows:[],total:0}:
      method==="contest_score"?{score:current.score}:null;
    if(method==="contest_draft_apply"){
      current={...current,revision:current.revision+1,frequencyHz:params.frequencyHz,mode:params.mode??current.mode,
        fields:current.fields.map((field:any)=>({...field,value:params.fields[field.id]??field.value}))};
      result={projection:current,actions:[],messages:[]};
    }
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  const view=render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} stationTune={tune}
    spots={spots as any} selectedSpotId="duplicate-ssb"/>);
  await createContestThroughSetup();
  const tuneCurrent=async()=>{const entry=surfaceOwner.current.projections["active-qso"];
    await surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,panelID:"active-qso",
      projectionRevision:entry.draft.revision,requestID:crypto.randomUUID(),action:"entry_tune_spot",
      params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision}});};
  await act(tuneCurrent);
  expect(tune).toHaveBeenCalledExactlyOnceWith(14_195_000,"SSB");
  await act(async()=>view.rerender(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} stationTune={tune}
    spots={spots as any} selectedSpotId={null}/>));
  await expect(tuneCurrent()).rejects.toThrow("No selected or matching shared spot");
  expect(tune).toHaveBeenCalledTimes(1);
});

it.each(["band-maps","dx-cluster"])("loads the spot before returning tune failures and blocks tune after detached %s draft failures",async panelID=>{
  let current=projection(), failure:"tune"|"draft"|"uncertain"="tune";
  const spot={id:"spot-1",callsign:"DL1ABC",frequencyKHz:14025,band:"20m",mode:"CW"};
  const tune=vi.fn(async()=>{if(failure==="tune")throw new Error("Radio tune was not confirmed");return {accepted:true,confirmed:true};});
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    if(method==="contest_draft_apply"){
      if(failure==="tune"){
        current={...current,revision:current.revision+1,frequencyHz:Number(params.frequencyHz),mode:String(params.mode??current.mode),
          fields:current.fields.map((field:any)=>({...field,value:(params.fields as Record<string,string>)[field.id]??field.value}))};
        return{id:crypto.randomUUID(),ok:true,result:{projection:current,actions:[],messages:[]}};
      }
      return{id:crypto.randomUUID(),ok:false,error:{code:"contest_revision",message:"Draft changed before tune",
        outcome:failure==="uncertain"?"uncertain":"confirmed"}};
    }
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
  expect(request.mock.calls.filter(([method])=>method==="contest_draft_apply")).toHaveLength(1);
  expect(current.fields.find((field:any)=>field.id==="callsign")?.value).toBe("DL1ABC");
  expect(selected).toHaveBeenCalledWith("spot-1");
  failure="draft";
  const currentEnvelope={...envelope,projectionRevision:current.revision,requestID:crypto.randomUUID(),
    params:{...envelope.params,expectedDraftRevision:current.revision}};
  await act(async()=>{await expect(surfaceOwner.current.handle(currentEnvelope)).rejects.toThrow("Draft changed before tune");});
  failure="uncertain";
  await act(async()=>{await expect(surfaceOwner.current.handle({...currentEnvelope,requestID:crypto.randomUUID()})).rejects.toBeInstanceOf(ContestMutationUncertain);});
  expect(tune).toHaveBeenCalledTimes(1);
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
  expect(await screen.findByText("Connect the selected radio or enter a frequency on a band supported by this contest before creating a contest.")).toBeTruthy();
  expect(screen.queryByText("Contest created.")).toBeNull();
  expect(request.mock.calls.some(([method]) => method === "contest_create")).toBe(false);
  expect(screen.getByRole("button", {name:"OK"})).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", {name:"Manual frequency MHz"}), {target:{value:"7.025125"}});
  await userEvent.click(screen.getByRole("button", {name:"OK"}));
  await waitFor(() => expect(request.mock.calls.some(([method]) => method === "contest_create")).toBe(true));
  expect(request.mock.calls.find(([method]) => method === "contest_create")?.[1]).toMatchObject({frequencyHz:7_025_125});
  expect(screen.getByRole("heading", { name:"Contest Setup", level:1 })).toBeTruthy();
});

it("marks only a fresh observed VFO transition for authoritative S&P clearing", async () => {
  const saved = newContestSetup("OM0RX");
  saved.preferences.clearOnVFOChange = true;
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1", JSON.stringify(saved));
  let current = projection(), observedApply: Record<string, unknown> | undefined;
  const request = vi.fn(async (method:string, params:Record<string, any>={}) => {
    const support = workspaceSupport(method, params, current); if (support) return support;
    if (method === "contest_scp_status") return unavailableSCP();
    if (method === "contest_history_status") return unavailableHistory();
    let result: any = method === "contest_catalog" ? {plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]} :
      method === "contest_sessions" ? {sessions:[]} : method === "contest_create" ? {projection:current} :
      method === "contest_log_page" ? {rows:[],total:0} : method === "contest_score" ? {score:current.score} : null;
    if (method === "contest_draft_apply") {
      observedApply = params;
      current = {...current, revision:current.revision + 1, frequencyHz:Number(params.frequencyHz)};
      result = {projection:current, actions:[], messages:[]};
    }
    if (!result) throw new Error(method);
    return {id:crypto.randomUUID(),ok:true,result};
  });
  const liveSpots=[{id:"near",callsign:"DL1ABC",frequencyKHz:14026.2,band:"20m",mode:"CW",receivedAt:20}];
  const view = render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} spots={liveSpots as any}/>);
  await createContestThroughSetup();
  await waitFor(() => expect(surfaceOwner.current.projections["active-qso"].status).toBe("ready"));
  expect(observedApply).toBeUndefined();

  view.rerender(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} spots={liveSpots as any} radioFrequencyHz={14_026_000}/>);
  await waitFor(() => expect(observedApply).toMatchObject({frequencyHz:14_026_000, observedVFOChange:true, observedSpotCallsign:"DL1ABC"}));
});

it("leaving a CQ WW SSB Run frequency switches to S&P and loads a nearby spot", async () => {
  const saved = newContestSetup("OM0RX");
  saved.pluginID = "cq_ww_ssb"; saved.name = "CQ WW SSB"; saved.settings.ModeCategory = "SSB";
  saved.preferences.clearOnVFOChange = false; saved.preferences.bands = ["40m"];
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1", JSON.stringify(saved));
  let current:any = {...projection(1,{callsign:"OLD1",other_2:"14"}),pluginID:"cq_ww_ssb",mode:"SSB",band:7,frequencyHz:7_175_000,run:true};
  let observedApply:Record<string,unknown>|undefined,runChange:Record<string,unknown>|undefined;
  const request=vi.fn(async(method:string,params:Record<string,any>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    let result:any=method==="contest_catalog"?{plugins:[{id:"cq_ww_ssb",name:"CQ WW SSB"}]}:
      method==="contest_sessions"?{sessions:[]}:method==="contest_create"?{projection:current}:
      method==="contest_log_page"?{rows:[],total:0}:method==="contest_score"?{score:current.score}:null;
    if(method==="contest_draft_apply"){
      observedApply=params;current={...current,revision:current.revision+1,frequencyHz:Number(params.frequencyHz)};
      result={projection:current,actions:[],messages:[]};
    }
    if(method==="contest_run_state"){
      runChange=params;current={...current,revision:current.revision+1,run:Boolean(params.run)};
      result={projection:current,actions:[],messages:[]};
    }
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  const liveSpots=[{id:"pj4g",callsign:"PJ4G",frequencyKHz:7181.4,band:"40m",mode:"SSB",receivedAt:20}];
  const view=render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} spots={liveSpots as any} radioFrequencyHz={7_175_000}/>);
  await createContestThroughSetup();await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].status).toBe("ready"));
  view.rerender(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} spots={liveSpots as any} radioFrequencyHz={7_181_400}/>);
  await waitFor(()=>expect(runChange).toMatchObject({run:false}));
  await waitFor(()=>expect(observedApply).toMatchObject({frequencyHz:7_181_400,observedVFOChange:true,observedSpotCallsign:"PJ4G"}));
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].operator.style).toBe("search-and-pounce"));
  await waitFor(()=>expect(surfaceOwner.current.projections["band-maps"]).toMatchObject({radioFrequencyHz:7_181_400,
    spots:expect.arrayContaining([expect.objectContaining({id:"pj4g",callsign:"PJ4G",frequencyKHz:7181.4})])}));
  expect(surfaceOwner.current.projections["band-maps"].spots).not.toEqual(expect.arrayContaining([
    expect.objectContaining({id:"contest-heard:7175000:OLD1"})]));
});

it("adopts the radio-follow CQ zone and preserves a manual override through delayed lookup",async()=>{
  const saved=newContestSetup("OM0RX");saved.pluginID="cq_ww_ssb";saved.preferences.bands=["40m"];
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1",JSON.stringify(saved));
  let current:any={...projection(1,{callsign:"",other_2:""}),pluginID:"cq_ww_ssb",mode:"SSB",band:7,frequencyHz:7_175_000,run:false};
  let releaseLookup:(()=>void)|undefined;
  const base=operationalRequest(()=>current),request=vi.fn(async(method:string,params:Record<string,any>={})=>{
    if(method!=="contest_draft_apply")return base(method,params);
    const values=params.observedVFOChange?{...params.fields,callsign:params.observedSpotCallsign,other_2:"14"}:params.fields;
    current={...current,revision:current.revision+1,frequencyHz:params.frequencyHz,
      fields:current.fields.map((field:any)=>({...field,value:values[field.id]??field.value})),countryResolved:true,
      callContext:{callsign:"MX0KBS",country:"England",cqZone:14,ituZone:27}};
    return{id:crypto.randomUUID(),ok:true,result:{projection:current,actions:[],messages:[]}};
  }),serviceRequest=vi.fn(async(method:string,params:Record<string,any>={})=>{
    if(method==="lookup_call"&&params.call==="MX0KBS")return new Promise(resolve=>{
      releaseLookup=()=>resolve({call:"MX0KBS",country:"England",cqZone:14,ituZone:27});
    });
    return request(method,params);
  });
  const props={request,serviceRequest,...workspaceProps,spots:[{id:"mx0kbs",callsign:"MX0KBS",frequencyKHz:7181.4,band:"40m",mode:"SSB"}] as any};
  const view=render(<Not1MMContestWorkspace {...props} radioFrequencyHz={7_175_000}/>);
  await createContestThroughSetup();
  view.rerender(<Not1MMContestWorkspace {...props} radioFrequencyHz={7_181_400}/>);
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].draft).toMatchObject({callsign:"MX0KBS",
    receivedFields:expect.arrayContaining([expect.objectContaining({id:"other_2",value:"14"})])}));
  expect(request.mock.calls.find(([method])=>method==="contest_draft_apply")?.[1]).toMatchObject({
    fields:{callsign:""},observedVFOChange:true,observedSpotCallsign:"MX0KBS"});
  await waitFor(()=>expect(releaseLookup).toBeTypeOf("function"));
  await act(async()=>surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,
    action:"entry_set_exchange",params:{draftID:current.draftID,expectedDraftRevision:current.revision,fieldID:"other_2",value:"9"}}));
  await act(async()=>releaseLookup?.());
  expect(surfaceOwner.current.projections["active-qso"]).toMatchObject({manual:{country:"England",cqZone:14},draft:{
    receivedFields:expect.arrayContaining([expect.objectContaining({id:"other_2",value:"9"})])}});
  expect(request.mock.calls.filter(([method])=>method==="contest_draft_apply")).toHaveLength(2);
});

it("keeps an SSB entry across small VFO steps but clears and captures beyond the fixed configured tolerance anchor",async()=>{
  const saved=newContestSetup("OM0RX");saved.pluginID="cq_ww_ssb";saved.preferences.bands=["40m"];saved.preferences.ssbTuningToleranceHz=1200;
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1",JSON.stringify(saved));
  let current:any={...projection(1,{callsign:"OLD1",other_2:"9"}),pluginID:"cq_ww_ssb",mode:"SSB",band:7,frequencyHz:7_175_000,run:false};
  const base=operationalRequest(()=>current),request=vi.fn(async(method:string,params:Record<string,any>={})=>{
    if(method!=="contest_draft_apply")return base(method,params);
    const values=params.observedVFOChange?{...params.fields,callsign:params.observedSpotCallsign,other_2:"14"}:params.fields;
    current={...current,revision:current.revision+1,frequencyHz:params.frequencyHz,
      fields:current.fields.map((field:any)=>({...field,value:values[field.id]??field.value}))};
    return{id:crypto.randomUUID(),ok:true,result:{projection:current,actions:[],messages:[]}};
  });
  const props={request,serviceRequest:request,...workspaceProps,spots:[{id:"new",callsign:"NEW1",frequencyKHz:7176.2,band:"40m",mode:"SSB"}] as any};
  const view=render(<Not1MMContestWorkspace {...props} radioFrequencyHz={7_175_000}/>);await createContestThroughSetup();
  for(const frequencyHz of [7_175_600,7_176_200]){
    view.rerender(<Not1MMContestWorkspace {...props} radioFrequencyHz={frequencyHz}/>);
    await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].draft.frequencyHz).toBe(frequencyHz));
    await waitFor(()=>expect(current.frequencyHz).toBe(frequencyHz));
    expect(surfaceOwner.current.projections["active-qso"].draft.callsign).toBe("OLD1");
    expect(request.mock.calls.filter(([method])=>method==="contest_draft_apply").at(-1)?.[1]).not.toHaveProperty("observedVFOChange");
  }
  view.rerender(<Not1MMContestWorkspace {...props} radioFrequencyHz={7_176_201}/>);
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].draft.callsign).toBe("NEW1"));
  expect(request.mock.calls.filter(([method])=>method==="contest_draft_apply").at(-1)?.[1]).toMatchObject({
    frequencyHz:7_176_201,observedVFOChange:true,observedSpotCallsign:"NEW1",fields:{callsign:""}});
  expect(props.stationTune).not.toHaveBeenCalled();
});

it("retains a manually typed callsign at its entry frequency when the operator tunes away",async()=>{
  const saved=newContestSetup("OM0RX");saved.pluginID="cq_ww_ssb";saved.preferences.bands=["40m"];
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1",JSON.stringify(saved));
  let current:any={...projection(1,{callsign:"",other_2:""}),pluginID:"cq_ww_ssb",mode:"SSB",band:7,frequencyHz:7_150_000,run:false};
  const base=operationalRequest(()=>current),request=vi.fn(async(method:string,params:Record<string,any>={})=>{
    if(method!=="contest_draft_apply")return base(method,params);
    current={...current,revision:current.revision+1,frequencyHz:params.frequencyHz,
      fields:current.fields.map((field:any)=>({...field,value:params.fields[field.id]??field.value}))};
    return{id:crypto.randomUUID(),ok:true,result:{projection:current,actions:[],messages:[]}};
  });
  const props={request,serviceRequest:request,...workspaceProps};
  const view=render(<Not1MMContestWorkspace {...props} radioFrequencyHz={7_150_000}/>);await createContestThroughSetup();
  const draft=surfaceOwner.current.projections["active-qso"].draft;
  await act(async()=>surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,
    action:"entry_set_text",params:{draftID:draft.draftID,expectedDraftRevision:draft.revision,field:"callsign",value:"SX5P"}}));
  view.rerender(<Not1MMContestWorkspace {...props} radioFrequencyHz={7_150_100}/>);
  await waitFor(()=>expect(current.frequencyHz).toBe(7_150_100));
  view.rerender(<Not1MMContestWorkspace {...props} radioFrequencyHz={7_160_000}/>);
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].draft.callsign).toBe(""));
  await waitFor(()=>expect(surfaceOwner.current.projections["dx-cluster"].spots).toEqual(expect.arrayContaining([
    expect.objectContaining({callsign:"SX5P",frequencyKHz:7150,comment:"Heard while tuning"})])));
  expect(surfaceOwner.current.projections["dx-cluster"].spots.filter((spot:any)=>spot.id.startsWith("contest-heard:"))).toHaveLength(1);
});

it("does not create heard spots when refocus and host revisions change at an unchanged authoritative VFO",async()=>{
  const saved=newContestSetup("OM0RX");saved.pluginID="cq_ww_ssb";saved.preferences.bands=["40m"];
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1",JSON.stringify(saved));
  let current:any={...projection(1,{callsign:"SX5P",other_2:"20"}),pluginID:"cq_ww_ssb",mode:"SSB",band:7,frequencyHz:7_150_000,run:false};
  const base=operationalRequest(()=>current),request=vi.fn(async(method:string,params:Record<string,any>={})=>{
    if(method!=="contest_focus")return base(method,params);
    expect(params.expectedRevision).toBe(current.revision);
    current={...current,revision:current.revision+1,focus:params.field,
      callContext:{callsign:"SX5P",country:"Dodecanese",cqZone:20,ituZone:28}};
    return{id:crypto.randomUUID(),ok:true,result:{projection:current,actions:[],messages:[]}};
  });
  const props={request,serviceRequest:request,...workspaceProps,radioFrequencyHz:7_150_000};
  const view=render(<Not1MMContestWorkspace {...props}/>);await createContestThroughSetup();
  for(const fieldID of ["other_2","callsign","sent","callsign"]){
    const draft=surfaceOwner.current.projections["active-qso"].draft;
    await act(async()=>surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,
      action:"entry_focus",params:{draftID:draft.draftID,expectedDraftRevision:draft.revision,fieldID}}));
    fireEvent(window,new Event("focus"));fireEvent(document,new Event("visibilitychange"));
    view.rerender(<Not1MMContestWorkspace {...props} spots={[]}/>);
    await act(async()=>{await Promise.resolve();});
    expect(surfaceOwner.current.projections["active-qso"].draft).toMatchObject({callsign:"SX5P",frequencyHz:7_150_000,
      receivedFields:expect.arrayContaining([expect.objectContaining({id:"other_2",value:"20"})])});
    expect(surfaceOwner.current.projections["dx-cluster"].spots.filter((spot:any)=>spot.id.startsWith("contest-heard:"))).toHaveLength(0);
  }
  expect(request.mock.calls.filter(([method])=>method==="contest_focus")).toHaveLength(4);
  expect(request.mock.calls.filter(([method])=>method==="contest_draft_apply")).toHaveLength(0);
});

it("keeps a clicked SX5P draft at 7150 while old and intermediate radio telemetry wait for the owned tune readback",async()=>{
  const saved=newContestSetup("OM0RX");saved.pluginID="cq_ww_ssb";saved.preferences.bands=["40m"];
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1",JSON.stringify(saved));
  let current:any={...projection(1,{callsign:"",other_2:""}),pluginID:"cq_ww_ssb",mode:"SSB",supportedModes:["SSB"],band:7,frequencyHz:7_129_000,run:false};
  let confirmTune!:()=>void;
  const tune=vi.fn(()=>new Promise<{accepted:boolean;confirmed:boolean}>(resolve=>{confirmTune=()=>resolve({accepted:true,confirmed:true});}));
  const base=operationalRequest(()=>current),request=vi.fn(async(method:string,params:Record<string,any>={})=>{
    if(method!=="contest_draft_apply")return base(method,params);
    const values={...params.fields,other_2:"20"};
    current={...current,revision:current.revision+1,frequencyHz:params.frequencyHz,
      fields:current.fields.map((field:any)=>({...field,value:values[field.id]??field.value})),
      callContext:{callsign:"SX5P",country:"Dodecanese",cqZone:20,ituZone:28}};
    return{id:crypto.randomUUID(),ok:true,result:{projection:current,actions:[],messages:[]}};
  });
  const spots=[{id:"sx5p",callsign:"SX5P",frequencyKHz:7150,band:"40m",mode:"SSB",country:"Dodecanese",cqZone:20}],
    props={request,serviceRequest:request,...workspaceProps,stationTune:tune,spots:spots as any};
  const view=render(<Not1MMContestWorkspace {...props} radioFrequencyHz={7_129_000}/>);await createContestThroughSetup();
  const draft=surfaceOwner.current.projections["active-qso"].draft;let selecting!:Promise<void>;
  await act(async()=>{selecting=surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,panelID:"band-maps",
    action:"spot_select",params:{draftID:draft.draftID,expectedDraftRevision:draft.revision,spotID:"sx5p"}});});
  await waitFor(()=>expect(tune).toHaveBeenCalledWith(7_150_000,"SSB"));
  for(const frequencyHz of [7_129_000,7_135_000]){
    view.rerender(<Not1MMContestWorkspace {...props} spots={[...spots]} radioFrequencyHz={frequencyHz}/>);
    await act(async()=>{await Promise.resolve();});
    expect(current.frequencyHz).toBe(7_150_000);
    expect(surfaceOwner.current.projections["active-qso"].draft).toMatchObject({callsign:"SX5P",
      receivedFields:expect.arrayContaining([expect.objectContaining({id:"other_2",value:"20"})])});
  }
  view.rerender(<Not1MMContestWorkspace {...props} radioFrequencyHz={7_150_000}/>);
  await act(async()=>{confirmTune();await selecting;});
  const applies=request.mock.calls.filter(([method])=>method==="contest_draft_apply");
  expect(applies).toHaveLength(1);expect(applies[0][1]).not.toHaveProperty("observedVFOChange");
  expect(surfaceOwner.current.projections["active-qso"].draft).toMatchObject({callsign:"SX5P",frequencyHz:7_150_000});
  expect(surfaceOwner.current.projections["dx-cluster"].spots).not.toEqual(expect.arrayContaining([
    expect.objectContaining({callsign:"SX5P",frequencyKHz:7129}),expect.objectContaining({callsign:"SX5P",frequencyKHz:7135}),
  ]));
  expect(surfaceOwner.current.projections["dx-cluster"].spots.filter((spot:any)=>spot.id.startsWith("contest-heard:"))).toHaveLength(0);
});

it("follows a manual third frequency after a confirmed tune whose target React never rendered and navigates from the live VFO",async()=>{
  const saved=newContestSetup("OM0RX");saved.pluginID="cq_ww_ssb";saved.preferences.bands=["40m"];
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1",JSON.stringify(saved));
  let current:any={...projection(1,{callsign:"",other_2:""}),pluginID:"cq_ww_ssb",mode:"SSB",supportedModes:["SSB"],band:7,frequencyHz:7_129_000,run:false};
  let confirmTune!:()=>void;
  const tune=vi.fn((_frequencyHz:number,_mode:string)=>new Promise<{accepted:boolean;confirmed:boolean}>(resolve=>{
    confirmTune=()=>resolve({accepted:true,confirmed:true});
  }));
  const base=operationalRequest(()=>current),request=vi.fn(async(method:string,params:Record<string,any>={})=>{
    if(method!=="contest_draft_apply")return base(method,params);
    current={...current,revision:current.revision+1,frequencyHz:params.frequencyHz,
      fields:current.fields.map((field:any)=>({...field,value:params.fields[field.id]??field.value}))};
    return{id:crypto.randomUUID(),ok:true,result:{projection:current,actions:[],messages:[]}};
  });
  const spots=[{id:"sx5p",callsign:"SX5P",frequencyKHz:7150,band:"40m",mode:"SSB"},
    {id:"behind",callsign:"DL1AA",frequencyKHz:7160,band:"40m",mode:"SSB"},
    {id:"ahead",callsign:"DL2BB",frequencyKHz:7175,band:"40m",mode:"SSB"}];
  const props={request,serviceRequest:request,...workspaceProps,stationTune:tune,spots:spots as any};
  const view=render(<Not1MMContestWorkspace {...props} radioFrequencyHz={7_129_000}/>);await createContestThroughSetup();
  const action=(action:string,params:Record<string,unknown>)=>{
    const draft=surfaceOwner.current.projections["active-qso"].draft;
    return surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,panelID:"active-qso",action,
      params:{draftID:draft.draftID,expectedDraftRevision:draft.revision,...params}});
  };
  let selecting!:Promise<void>;
  await act(async()=>{selecting=action("spot_select",{spotID:"sx5p"});});
  await waitFor(()=>expect(tune).toHaveBeenCalledWith(7_150_000,"SSB"));
  await act(async()=>{confirmTune();await selecting;});
  // Native owner confirmed target readback, but React receives only the later manual turn.
  view.rerender(<Not1MMContestWorkspace {...props} radioFrequencyHz={7_170_000}/>);
  await waitFor(()=>expect(current.frequencyHz).toBe(7_170_000));
  expect(request.mock.calls.filter(([method])=>method==="contest_draft_apply").at(-1)?.[1]).toMatchObject({
    frequencyHz:7_170_000,observedVFOChange:true,fields:{callsign:""}});
  expect(surfaceOwner.current.projections["dx-cluster"].spots).not.toEqual(expect.arrayContaining([
    expect.objectContaining({callsign:"SX5P",frequencyKHz:7129})]));
  expect(surfaceOwner.current.projections["dx-cluster"].spots.filter((spot:any)=>spot.id.startsWith("contest-heard:"))).toHaveLength(0);
  let stepping!:Promise<void>;
  await act(async()=>{stepping=action("entry_step_spot",{direction:"next"});});
  await waitFor(()=>expect(tune).toHaveBeenLastCalledWith(7_175_000,"SSB"));
  await act(async()=>{confirmTune();await stepping;});
});

it("keeps Run state and entry intact when CAT reconnects at a frequency", async () => {
  const saved = newContestSetup("OM0RX");
  saved.pluginID = "cq_ww_ssb"; saved.name = "CQ WW SSB"; saved.settings.ModeCategory = "SSB";
  saved.preferences.clearOnVFOChange = false; saved.preferences.bands = ["40m"];
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1", JSON.stringify(saved));
  let current:any = {...projection(1,{callsign:"CQ9A",other_2:"33"}),pluginID:"cq_ww_ssb",mode:"SSB",band:7,
    frequencyHz:7_158_000,run:true};
  const request=vi.fn(async(method:string,params:Record<string,any>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    let result:any=method==="contest_catalog"?{plugins:[{id:"cq_ww_ssb",name:"CQ WW SSB"}]}:
      method==="contest_sessions"?{sessions:[]}:method==="contest_create"?{projection:current}:
      method==="contest_log_page"?{rows:[],total:0}:method==="contest_score"?{score:current.score}:null;
    if(method==="contest_draft_apply"){
      current={...current,revision:current.revision+1,frequencyHz:Number(params.frequencyHz)};
      result={projection:current,actions:[],messages:[]};
    }
    if(method==="contest_run_state"){
      current={...current,revision:current.revision+1,run:Boolean(params.run)};
      result={projection:current,actions:[],messages:[]};
    }
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  const view=render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}
    radioFrequencyHz={7_158_000}/>);
  await createContestThroughSetup();
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].status).toBe("ready"));
  view.rerender(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}
    radioFrequencyHz={undefined}/>);
  await act(async()=>{await Promise.resolve();});
  view.rerender(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}
    radioFrequencyHz={7_181_400}/>);
  await waitFor(()=>expect(request).toHaveBeenCalledWith("contest_draft_apply",expect.objectContaining({frequencyHz:7_181_400})));
  expect(request.mock.calls.filter(([method])=>method==="contest_run_state")).toHaveLength(0);
  const reconnectApply=request.mock.calls.filter(([method])=>method==="contest_draft_apply").at(-1)?.[1];
  expect(reconnectApply).not.toHaveProperty("observedVFOChange");
  expect(surfaceOwner.current.projections["active-qso"].operator.style).toBe("run");
  expect(surfaceOwner.current.projections["active-qso"].draft.callsign).toBe("CQ9A");
});

it("wipes the entry with one mutation while keeping committed auxiliary panels mounted",async()=>{
  let current=projection(1,{callsign:"RG6G",other_2:"16"});
  const request=vi.fn(async(method:string,params:Record<string,any>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    let result:any=method==="contest_catalog"?{plugins:[]}:method==="contest_sessions"?{sessions:[]}:
      method==="contest_create"?{projection:current}:method==="contest_log_page"?{rows:[],total:0}:
      method==="contest_score"?{sessionID:current.sessionID,revision:current.revision,score:current.score,matrices:{}}:
      method==="contest_rates"?{sessionID:current.sessionID,revision:current.revision,rows:[]}:null;
    if(method==="contest_draft_apply"){
      current={...current,revision:current.revision+1,fields:current.fields.map(field=>({
        ...field,value:params.fields?.[String(field.id)]??field.value}))};
      result={projection:current,actions:[],messages:[]};
    }
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();
  await waitFor(()=>expect(surfaceOwner.current.projections.propagation.status).toBe("ready"));
  const entry=surfaceOwner.current.projections["active-qso"],before=request.mock.calls.filter(([method])=>method==="contest_draft_apply").length;
  await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"active-qso",projectionRevision:entry.draft.revision,requestID:crypto.randomUUID(),action:"entry_clear",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision}}));
  expect(request.mock.calls.filter(([method])=>method==="contest_draft_apply")).toHaveLength(before+1);
  expect(surfaceOwner.current.projections["active-qso"].draft.callsign).toBe("");
  expect(surfaceOwner.current.projections.propagation.status).toBe("ready");
});

it("imports bounded CQ WW SSB ADIF batches through the normal commit path and restores the live draft",async()=>{
  let current={...projection(1,{callsign:"LIVE",sent:"59",receive:"59",other_1:"15",other_2:"15"}),
    pluginID:"cq_ww_ssb",mode:"SSB",band:14,frequencyHz:14_250_000,
    ruleIdentity:{id:"cq-ww-ssb",version:"26.10.11",edition:"not1mm-python",sourceRevision:"test"}};
  const committed:Record<string,any>[]=[];
  const request=vi.fn(async(method:string,params:Record<string,any>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    let result:any=method==="contest_catalog"?{plugins:[]}:method==="contest_sessions"?{sessions:[]}:
      method==="contest_create"?{projection:current}:method==="contest_log_page"?{rows:[],total:0}:
      method==="contest_score"?{sessionID:current.sessionID,revision:current.revision,score:current.score,matrices:{}}:
      method==="contest_rates"?{sessionID:current.sessionID,revision:current.revision,rows:[]}:null;
    if(method==="contest_qso_commit"){
      committed.push(params);current={...current,revision:current.revision+1};result={projection:current,actions:[],messages:[]};
    }else if(method==="contest_draft_apply"){
      current={...current,revision:current.revision+1,frequencyHz:params.frequencyHz,
        fields:current.fields.map(field=>({...field,value:params.fields?.[String(field.id)]??field.value}))};
      result={projection:current,actions:[],messages:[]};
    }
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();await waitFor(()=>expect(surfaceOwner.current.projections.logbook.status).toBe("ready"));
  const log=surfaceOwner.current.projections.logbook,originalFrequency=current.frequencyHz;
  await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"logbook",projectionRevision:log.sessionRevision,requestID:crypto.randomUUID(),action:"log_import_adif",params:{sourceName:"n1mm.adi",records:[
      {qsoID:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",timestamp:"2026-10-24 01:02:03",frequencyHz:14_250_000,mode:"SSB",
        fields:{callsign:"LZ9W",sent:"59",receive:"59",other_1:"15",other_2:"20"}},
      {qsoID:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",timestamp:"2026-10-24 01:03:04",frequencyHz:14_251_000,mode:"SSB",
        fields:{callsign:"ED5D",sent:"59",receive:"59",other_1:"15",other_2:"14"}},
    ]}}));
  expect(committed.map(item=>item.qsoID)).toEqual(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]);
  expect(committed[0]).toMatchObject({timestamp:"2026-10-24 01:02:03",frequencyHz:14_250_000,fields:{callsign:"LZ9W",other_2:"20"}});
  expect(Object.fromEntries(current.fields.map(field=>[field.id,field.value]))).toMatchObject({callsign:"LIVE",sent:"59",receive:"59",other_1:"15",other_2:"15"});
  expect(current.frequencyHz).toBe(originalFrequency);
});

it.each([
  { manual:"50.125", frequencyHz:50_125_000, band:50 },
  { manual:"144.200", frequencyHz:144_200_000, band:144 },
])("uses manual $manual MHz when the observed radio frequency is stale and outside the selected VHF contest", async ({manual,frequencyHz,band}) => {
  const saved = newContestSetup("OM0RX");
  saved.pluginID = "cq_ww_vhf";
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1", JSON.stringify(saved));
  let current: any = { ...projection(), pluginID:"cq_ww_vhf", pluginName:"CQ WW VHF",
    supportedBands:["6m","2m"], frequencyHz, band };
  const request = vi.fn(async (method:string, params:Record<string,unknown>={}) => {
    const support = workspaceSupport(method, params, current); if (support) return support;
    const result = method === "contest_catalog" ? {plugins:[{id:"cq_ww_vhf",name:"CQ WW VHF",supportedBands:["6m","2m"]}]} :
      method === "contest_sessions" ? {sessions:[]} : method === "contest_create"
        ? (current={...current,frequencyHz:Number(params.frequencyHz)},{projection:current}) :
      method === "contest_log_page" ? {rows:[],total:0} : method === "contest_score" ? {score:current.score} : null;
    if (!result) throw new Error(method);
    return {id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}
    radioFrequencyHz={14_348_000}/>);
  fireEvent.change(await screen.findByRole("textbox", {name:"Manual frequency MHz"}), {target:{value:manual}});
  await createContestThroughSetup();
  await waitFor(() => expect(request.mock.calls.some(([method]) => method === "contest_create")).toBe(true));
  expect(request.mock.calls.find(([method]) => method === "contest_create")?.[1]).toMatchObject({frequencyHz});
});

it("uses the manual VHF frequency when creating CQ WW VHF from an active HF session with stale HF CAT", async () => {
  let current: any = { ...projection(), pluginID:"cq_wpx_cw", pluginName:"CQ WPX CW",
    supportedBands:["10m"], frequencyHz:28_400_500, band:28 };
  const activeSession = { sessionID:current.sessionID, name:"Active HF", pluginID:"cq_wpx_cw",
    workspaceGeneration:current.workspaceGeneration, revision:current.revision };
  const request = vi.fn(async (method:string, params:Record<string,unknown>={}) => {
    const support = workspaceSupport(method, params, current); if (support) return support;
    let result: any;
    if (method === "contest_catalog") result = {plugins:[
      {id:"cq_wpx_cw",name:"CQ WPX CW",supportedBands:["10m"]},
      {id:"cq_ww_vhf",name:"CQ WW VHF",supportedBands:["6m","2m"]},
    ]};
    else if (method === "contest_sessions") result = {sessions:[activeSession],activeSessionID:activeSession.sessionID};
    else if (method === "contest_open") result = {projection:current};
    else if (method === "contest_draft_apply") {
      current = {...current,revision:current.revision+1,frequencyHz:Number(params.frequencyHz)};
      result = {projection:current,actions:[],messages:[]};
    } else if (method === "contest_create") {
      current = {...projection(),sessionID:String(params.sessionID),pluginID:"cq_ww_vhf",pluginName:"CQ WW VHF",
        supportedBands:["6m","2m"],frequencyHz:Number(params.frequencyHz),band:50};
      result = {projection:current};
    } else if (method === "contest_log_page") result = {rows:[],total:0};
    else if (method === "contest_score") result = {score:current.score};
    else throw new Error(method);
    return {id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}
    radioFrequencyHz={14_025_000}/>);
  await waitFor(() => expect(request.mock.calls.some(([method]) => method === "contest_open")).toBe(true));
  await waitFor(() => expect(surfaceOwner.current.projections["active-qso"].status).toBe("ready"));
  const activeEntry = surfaceOwner.current.projections["active-qso"];
  await act(async () => surfaceOwner.current.handle({operatingContext,sessionID:current.sessionID,workspaceGeneration,
    panelID:"active-qso",projectionRevision:activeEntry.draft.revision,requestID:crypto.randomUUID(),action:"entry_set_text",
    params:{draftID:current.draftID,expectedDraftRevision:activeEntry.draft.revision,field:"callsign",value:"K1ABC"}}));
  await userEvent.click(await screen.findByRole("button", {name:"New Contest"}));
  fireEvent.change(screen.getByLabelText("Log Type"), {target:{value:"cq_ww_vhf"}});
  const manualFrequency=await screen.findByRole("textbox", {name:"Manual frequency MHz"});
  fireEvent.change(manualFrequency, {target:{value:"50.125"}});
  await userEvent.click(screen.getByRole("button", {name:"OK"}));
  await waitFor(() => expect(request.mock.calls.some(([method]) => method === "contest_create")).toBe(true));
  const createCallIndex = request.mock.calls.findIndex(([method]) => method === "contest_create");
  const priorDraftApplies = request.mock.calls.slice(0, createCallIndex).filter(([method]) => method === "contest_draft_apply");
  expect(priorDraftApplies).toHaveLength(1);
  expect(priorDraftApplies[0]?.[1]).toMatchObject({frequencyHz:28_400_500,fields:{callsign:"K1ABC"}});
  expect(request.mock.calls[createCallIndex]?.[1]).toMatchObject({
    pluginID:"cq_ww_vhf",frequencyHz:50_125_000,
  });
});

it.each([
  { frequencyHz:50_125_000, band:50, supportedBands:["6m","2m"], created:true },
  { frequencyHz:144_200_000, band:144, supportedBands:["6m","2m"], created:true },
  { frequencyHz:222_100_000, band:222, supportedBands:["1.25m"], created:true },
  { frequencyHz:2_300_100_000, band:2300, supportedBands:["13cm"], created:true },
  { frequencyHz:134_100_000_000, band:134000, supportedBands:["2mm"], created:true },
  { frequencyHz:50_125_000, band:50, supportedBands:["160m","80m","40m","20m","15m","10m"], created:false },
])("admits $frequencyHz outside HF only when the plugin supports its band ($created)", async ({frequencyHz,band,supportedBands,created}) => {
  let current:any={...projection(),frequencyHz,band,supportedBands};
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    const result=method==="contest_catalog"?{plugins:[{id:"cq_ww_cw",name:"VHF Test",supportedBands}]}:
      method==="contest_sessions"?{sessions:[]}:method==="contest_create"?(current={...current,frequencyHz:params.frequencyHz},{projection:current}):
      method==="contest_log_page"?{rows:[],total:0}:method==="contest_score"?{score:current.score}:null;
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps} radioFrequencyHz={frequencyHz}/>);
  await createContestThroughSetup();
  if(created) {
    expect(request.mock.calls.find(([method])=>method==="contest_create")?.[1]).toMatchObject({frequencyHz});
    await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].descriptor.bands).toEqual(supportedBands));
  }
  else {
    expect(request.mock.calls.some(([method])=>method==="contest_create")).toBe(false);
    expect(await screen.findByText(/frequency on a band supported by this contest before creating/)).toBeTruthy();
  }
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

it("hides prior-session log rows while independently refreshing a newly opened session",async()=>{
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
  await waitFor(()=>expect(surfaceOwner.current.projections.logbook.pluginRows).toMatchObject([
    {qsoID:"old-qso",values:[oldRow.TS,oldRow.Call,"14025","599","599","1","14","3"]},
  ]));
  expect(surfaceOwner.current.projections.propagation.schemaVersion).toBe(3);
  await userEvent.click(screen.getByRole("button",{name:"Select contest"}));
  await userEvent.click(screen.getByRole("button",{name:"Choose a Contest"}));
  await userEvent.click(screen.getByRole("radio",{name:"Second contest"}));
  await userEvent.click(screen.getByRole("button",{name:"OK"}));
  await waitFor(()=>expect(surfaceOwner.current.projections.messages.messages).toContainEqual({
    kind:"error",text:"Second contest log is temporarily unavailable.",
  }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(surfaceOwner.current.context.sessionID).toBe(second.sessionID);
  expect(surfaceOwner.current.projections.logbook).toMatchObject({
    schemaVersion:1,status:"ready",sessionRevision:second.revision,busy:true,
    page:{rows:[]},pluginRows:[],pluginPartialRows:[],
  });
  expect(surfaceOwner.current.projections.logbook.pluginRows).not.toContainEqual(expect.objectContaining({qsoID:"old-qso"}));
  expect(surfaceOwner.current.projections.propagation.schemaVersion).toBe(3);
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
  await expect(route!("contest-dialog-keys")).resolves.toBe(false);
  expect(surfaceWindow.open).not.toHaveBeenCalled();
  expect(surfaceWindow.openDialog).not.toHaveBeenCalled();
  await act(async () => finishOpen?.({id:crypto.randomUUID(),ok:true,result:{projection:current}}));
  await waitFor(() => expect(surfaceOwner.current.context).toMatchObject({sessionID:current.sessionID}));
  await expect(route!("contest-window-active-qso")).resolves.toBe(false);
  expect(surfaceWindow.open).not.toHaveBeenCalled();
  await act(async () => finishLog?.({id:crypto.randomUUID(),ok:true,result:{rows:[],offset:0,limit:20,total:0}}));
  await waitFor(async () => expect(await route!("contest-window-active-qso")).toBe(true));
  expect(surfaceWindow.open).toHaveBeenCalledTimes(1);
  expect(surfaceWindow.open).toHaveBeenCalledWith(expect.objectContaining({sessionID:current.sessionID}), "active-qso");
  await expect(route!("contest-dialog-keys")).resolves.toBe(true);
  expect(surfaceWindow.openDialog).toHaveBeenLastCalledWith("keys");
  await expect(route!("contest-window-call-history")).resolves.toBe(true);
  expect(surfaceWindow.openHistory).toHaveBeenCalledWith(expect.objectContaining({sessionID:current.sessionID}));
  await expect(route!("contest-window-group-chat")).resolves.toBe(true);
  expect(groupChat.open).toHaveBeenCalledWith(expect.objectContaining({sessionID:current.sessionID}));
  await waitFor(() => expect(groupChat.configure).toHaveBeenCalledWith(expect.objectContaining({sessionID:current.sessionID}),
    expect.objectContaining({enabled:false,multicastGroup:"239.1.1.1",multicastPort:2239,interface:"0.0.0.0"})));
  await expect(route!("contest-window-qrz-details")).resolves.toBe(true);
  expect(surfaceWindow.open).toHaveBeenCalledWith(expect.objectContaining({sessionID:current.sessionID}),"qrz-details");
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
  await waitFor(() => expect(surfaceOwner.waitForPublication).toHaveBeenCalledOnce());
  expect(surfaceWindow.open).not.toHaveBeenCalled();
  expect(completed).toBe(false);
  releasePublication();
  await expect(opening).resolves.toBe(true);
  expect(surfaceWindow.open).toHaveBeenCalledWith(expect.objectContaining({sessionID:current.sessionID}), "active-qso");
  await expect(route!("contest-window-score-reporting")).resolves.toBe(true);
  await expect(route!("contest-window-messages")).resolves.toBe(true);
  await expect(route!("contest-window-rotor")).resolves.toBe(true);
  expect(surfaceWindow.open).toHaveBeenCalledWith(expect.objectContaining({sessionID:current.sessionID}), "score-reporting");
  expect(surfaceWindow.open).toHaveBeenCalledWith(expect.objectContaining({sessionID:current.sessionID}), "messages");
  expect(surfaceWindow.open).toHaveBeenCalledWith(expect.objectContaining({sessionID:current.sessionID}), "rotor");
  expect(request.mock.calls.some(([method]) => method === "contest_draft_apply")).toBe(false);
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
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText("Open a contest session before opening its windows.")).toBeNull();
  expect(surfaceWindow.open).not.toHaveBeenCalled();
});

it("owns detached Not1MM frequency and mode commands through confirmed station tune and Python draft apply",async()=>{
  let current:any={...projection(4,{callsign:"USB",other_2:"14"}),supportedModes:["CW","SSB","RTTY","AM","FM"]};
  current.fields=current.fields.map((field:any)=>field.id==="sent"?{...field,label:"Sent serial",value:"001",readOnly:true}:
    field.id==="other_1"?{...field,label:"Configured sent exchange",value:"NT",readOnly:true}:field);
  const tune=vi.fn(async()=>({accepted:true,confirmed:true}));
  const request=vi.fn(async(method:string,params:Record<string,any>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    let result:any=method==="contest_catalog"?{plugins:[]}:method==="contest_sessions"?{sessions:[]}:
      method==="contest_create"?{projection:current}:method==="contest_log_page"?{rows:[],total:0}:
      method==="contest_score"?{score:current.score}:method==="contest_check_partial"?{query:params.query,rows:[],total:0}:null;
    if(method==="contest_draft_apply"){
      const values=params.fields??Object.fromEntries(current.fields.map((field:any)=>[field.id,field.value]));
      current={...current,revision:current.revision+1,frequencyHz:Number(params.frequencyHz),mode:params.mode??current.mode,
        fields:current.fields.map((field:any)=>({...field,value:values[field.id]??field.value}))};
      result={projection:current,actions:[],messages:[]};
    }
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps} stationTune={tune}/>);
  await createContestThroughSetup();await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].status).toBe("ready"));
  let entry=surfaceOwner.current.projections["active-qso"],envelope={operatingContext,scope:"contesting",sessionID:current.sessionID,
    workspaceGeneration,panelID:"active-qso",projectionRevision:entry.draft.revision,requestID:crypto.randomUUID()} as const;
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"entry_set_mode",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,value:"USB",callsignCommand:true}}));
  expect(tune).toHaveBeenLastCalledWith(14_025_000,"USB");
  expect(request.mock.calls.filter(([method])=>method==="contest_draft_apply").at(-1)?.[1])
    .toMatchObject({frequencyHz:14_025_000,mode:"SSB",fields:{callsign:"",sent:"001",receive:"59",other_1:"NT",other_2:""}});
  entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"entry_set_frequency_text",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,value:"7025500",callsignCommand:true}}));
  expect(tune).toHaveBeenLastCalledWith(7_025_500,"SSB");
  expect(request.mock.calls.filter(([method])=>method==="contest_draft_apply").at(-1)?.[1])
    .toMatchObject({frequencyHz:7_025_500,fields:{callsign:"",sent:"001",receive:"59",other_1:"NT",other_2:""}});
  expect(surfaceOwner.current.projections["active-qso"].draft).toMatchObject({callsign:"",mode:"SSB"});
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
  const esmSetup=newContestSetup("OM0RX");esmSetup.preferences.useESM=true;
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1",JSON.stringify(esmSetup));
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

it("authorizes detached free-form CW through the native contest lease and never calls a raw output service",async()=>{
  const current=projection();
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();
    if(method==="contest_history_status")return unavailableHistory();
    const result=method==="contest_catalog"?{plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]}:
      method==="contest_sessions"?{sessions:[]}:
      method==="contest_create"?{sessionID:current.sessionID,projection:current}:
      method==="contest_log_page"?{rows:[],total:0}:
      method==="contest_score"?{score:current.score,matrices:{countries:[],zones:[]}}:null;
    if(result===null)throw new Error(`Unexpected renderer request ${method}`);
    return{id:crypto.randomUUID(),ok:true,result};
  });
  nativeCW.execute.mockImplementation(async params=>({contestResult:{accepted:true,operationID:params.operationID}}));
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);await createContestThroughSetup();
  const entry=surfaceOwner.current.projections["active-qso"],requestID=crypto.randomUUID();
  await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"active-qso",projectionRevision:1,requestID,action:"entry_send_cw_text",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,value:"CQ TEST DE OM0RX"}}));
  expect(nativeCW.execute).toHaveBeenCalledWith(expect.objectContaining({operation:"text",sessionID:current.sessionID,draftID:current.draftID,
    expectedContestRevision:current.revision,frequencyHz:14025000,text:"CQ TEST DE OM0RX",contestSurfaceRequestID:requestID}));
  expect(request.mock.calls.some(([method])=>method.includes("cw")||method.includes("radio_control"))).toBe(false);
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
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"log_page",params:{offset:100,limit:20}}));
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

it("uses the replicated contact revision for a client correction and closes only after native sync",async()=>{
  let current={...projection(),replicaCursor:{revision:8,sequence:1}},release!:()=>void;
  const row:any={ID:"11111111-1111-4111-8111-111111111111",change_revision:8,TS:"2026-10-19 08:00:00",Call:"DL1ABC",Freq:14025,
    Band:14,Mode:"CW",SNT:"599",RCV:"599",Operator:"OM0RX",raw_fields:{callsign:"DL1ABC",sent:"599",receive:"599",other_1:"KEEP",other_2:"14"}};
  groupChat.configure.mockResolvedValue(clientGroupSnapshot());
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    if(method==="contest_catalog")return{id:crypto.randomUUID(),ok:true,result:{plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]}};
    if(method==="contest_sessions")return{id:crypto.randomUUID(),ok:true,result:{sessions:[]}};
    if(method==="contest_create")return{id:crypto.randomUUID(),ok:true,result:{projection:current}};
    if(method==="contest_log_page")return{id:crypto.randomUUID(),ok:true,result:{rows:[row],offset:0,limit:20,total:1}};
    if(method==="contest_score")return{id:crypto.randomUUID(),ok:true,result:{score:current.score,matrices:{countries:[],zones:[]}}};throw new Error(method);});
  groupChat.authority.mockResolvedValue({});
  groupChat.sync.mockImplementation(()=>new Promise(resolve=>{release=()=>{current={...current,revision:current.revision+1,
    replicaCursor:{revision:(current.replicaCursor?.revision??8)+1,sequence:0}};
    resolve({apply:{id:"ignored",ok:true,result:{projection:current,replicaCursor:current.replicaCursor}},hasMore:false,authoredApplied:true});};}));
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}/>);await createContestThroughSetup();
  const envelope={operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,panelID:"logbook",projectionRevision:1,requestID:crypto.randomUUID()} as const;
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"log_edit_begin",params:{qsoID:row.ID}}));
  const saving=surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"log_edit_save",params:{qsoID:row.ID,expectedSessionRevision:current.revision}});
  await waitFor(()=>expect(groupChat.authority).toHaveBeenCalled());
  expect(groupChat.authority.mock.calls.at(-1)?.[2]).toMatchObject({action:"correct",qsoID:row.ID,baseRevision:8,
    fields:expect.objectContaining({other_1:"KEEP",other_2:"14"})});
  expect(surfaceOwner.current.projections.logbook.editing?.qsoID).toBe(row.ID);release();await act(async()=>{await saving;});
  expect(surfaceOwner.current.projections.logbook.editing).toBeNull();row.change_revision=9;
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"log_edit_begin",params:{qsoID:row.ID}}));
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"log_edit_set_text",params:{qsoID:row.ID,field:"deletionReason",value:"Duplicate"}}));
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"log_edit_confirm_delete",params:{qsoID:row.ID,confirmed:true}}));
  groupChat.authority.mockRejectedValueOnce(new Error("timeout")).mockRejectedValueOnce(new Error("timeout"));
  const firstDelete=surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"log_edit_delete",params:{qsoID:row.ID,expectedSessionRevision:current.revision}});
  await act(async()=>{await expect(firstDelete).rejects.toThrow("timeout");});
  const timedOutCalls=groupChat.authority.mock.calls.slice(-2);expect(timedOutCalls[0][3]).toBe(timedOutCalls[1][3]);expect(timedOutCalls[0][2]).toEqual(timedOutCalls[1][2]);
  expect(Object.keys(localStorage).some(key=>key.startsWith("xlog.contest.pending-client-mutation.v1/"))).toBe(true);
  groupChat.authority.mockResolvedValue({changeRevision:10});
  const deleting=surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"log_edit_delete",params:{qsoID:row.ID,expectedSessionRevision:current.revision}});
  await waitFor(()=>expect(groupChat.authority.mock.calls.length).toBeGreaterThanOrEqual(4));
  expect(groupChat.authority.mock.calls.at(-1)?.[3]).toBe(timedOutCalls[0][3]);expect(groupChat.authority.mock.calls.at(-1)?.[2]).toEqual(timedOutCalls[0][2]);
  release();await act(async()=>{await deleting;});expect(surfaceOwner.current.projections.logbook.editing).toBeNull();
  expect(Object.keys(localStorage).some(key=>key.startsWith("xlog.contest.pending-client-mutation.v1/"))).toBe(false);
});

it.each(["discovering","lease_lost"] as const)("never falls back to local logging while a configured client is %s",async status=>{
  const document=newContestSetup("OM0RX");document.network={...document.network,multiEnabled:true,multiMaster:false};
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1",JSON.stringify(document));
  const current=projection();
  groupChat.configure.mockResolvedValue({...clientGroupSnapshot(),authority:{role:"client",status,masterStation:null,
    sessionID:null,workspaceGeneration:null,leaseExpiresAtMs:null,reconnectCursor:0}});
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    const result=method==="contest_catalog"?{plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]}:method==="contest_sessions"?{sessions:[]}:
      method==="contest_create"?{projection:current}:method==="contest_log_page"?{rows:[],total:0}:method==="contest_score"?{score:current.score}:null;
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};});
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}/>);await createContestThroughSetup();
  const entry=surfaceOwner.current.projections["active-qso"],base={operatingContext,scope:"contesting",sessionID:current.sessionID,
    workspaceGeneration,panelID:"active-qso",projectionRevision:1,requestID:crypto.randomUUID()} as const;
  await expect(surfaceOwner.current.handle({...base,action:"entry_commit",params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision}}))
    .rejects.toThrow(/waiting for its master authority/);
  await expect(surfaceOwner.current.handle({...base,requestID:crypto.randomUUID(),action:"entry_operator_key",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"Enter",focusedField:"callsign"}}))
    .rejects.toThrow(/waiting for its master authority/);
  expect(request.mock.calls.some(([method])=>method==="contest_qso_commit"||method==="contest_esm")).toBe(false);
  expect(groupChat.authority).not.toHaveBeenCalled();
});

it.each(["discovering","leasing","connected"] as const)("keeps the latent direct Log Now path fenced through shared client commit while %s",async status=>{
  const document=newContestSetup("OM0RX");document.network={...document.network,multiEnabled:true,multiMaster:false};
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1",JSON.stringify(document));
  let current={...projection(),replicaCursor:{revision:1,sequence:0},authoritySerialRequestID:crypto.randomUUID()};
  const snapshot=status!=="discovering"?{...clientGroupSnapshot(),authority:{...clientGroupSnapshot().authority,status}}:
    {...clientGroupSnapshot(),authority:{role:"client",status:"discovering",masterStation:null,
      sessionID:null,workspaceGeneration:null,leaseExpiresAtMs:null,reconnectCursor:0}};
  groupChat.configure.mockResolvedValue(snapshot);
  if(status==="leasing")groupChat.read.mockResolvedValueOnce(snapshot).mockResolvedValue({...snapshot,authority:{...snapshot.authority,status:"connected"}});
  else groupChat.read.mockResolvedValue(snapshot);
  groupChat.authority.mockResolvedValue({changeRevision:2});
  groupChat.sync.mockImplementation(async(_context:any,syncRequest:any)=>{current={...current,revision:current.revision+1,
    replicaCursor:{revision:current.replicaCursor.revision+1,sequence:0}};return{apply:{id:"ignored",ok:true,
      result:{projection:current,replicaCursor:current.replicaCursor}},hasMore:false,authoredApplied:Boolean(syncRequest.authoredQSOID)};});
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    const result=method==="contest_catalog"?{plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]}:method==="contest_sessions"?{sessions:[]}:
      method==="contest_create"?{projection:current}:method==="contest_log_page"?{rows:[],total:0}:method==="contest_score"?{score:current.score}:null;
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};});
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}/>);await createContestThroughSetup();
  await waitFor(()=>expect(groupChat.read).toHaveBeenCalled());
  // Current-workspace contests render detached Main Logging, not the legacy direct form. The form's
  // retained onSubmit and the detached action nevertheless share commitEntry, so exercise that one owner.
  expect(screen.queryByRole("button",{name:"Log Now"})).toBeNull();const entry=surfaceOwner.current.projections["active-qso"];
  const commit=surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"active-qso",projectionRevision:1,requestID:crypto.randomUUID(),action:"entry_commit",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision}});
  if(status!=="discovering"){
    await act(async()=>{await commit;});
    await waitFor(()=>expect(groupChat.authority).toHaveBeenCalledWith(expect.anything(),"contactApply",expect.objectContaining({action:"commit"}),expect.any(String)));
    expect(groupChat.sync.mock.calls.some(call=>Boolean(call[1].authoredQSOID))).toBe(true);
    if(status==="leasing")await waitFor(()=>expect(groupChat.read.mock.calls.length).toBeGreaterThanOrEqual(2),{timeout:3000});
  }else{
    await expect(commit).rejects.toThrow(/waiting for its master authority/);
    expect(groupChat.authority).not.toHaveBeenCalled();
  }
  expect(request.mock.calls.some(([method])=>method==="contest_qso_commit")).toBe(false);
});

it("does not overwrite operator input when a background client replica page returns",async()=>{
  const document=newContestSetup("OM0RX");document.network={...document.network,multiEnabled:true,multiMaster:false};
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1",JSON.stringify(document));
  let current={...projection(),replicaCursor:{revision:1,sequence:0},authoritySerialRequestID:crypto.randomUUID()};let release!:()=>void;
  groupChat.configure.mockResolvedValue(clientGroupSnapshot());groupChat.read.mockResolvedValue(clientGroupSnapshot());
  groupChat.sync.mockImplementation(()=>{const remote={...current,replicaCursor:{revision:1,sequence:1}};return new Promise(resolve=>{
    release=()=>resolve({apply:{id:"ignored",ok:true,result:{projection:remote,replicaCursor:remote.replicaCursor}},hasMore:false,authoredApplied:false});});});
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    if(method==="contest_draft_apply"){current={...current,revision:current.revision+1,fields:current.fields.map(field=>({...field,value:(params.fields as any)[String(field.id)]??field.value}))};
      return{id:crypto.randomUUID(),ok:true,result:{projection:current,actions:[],messages:[]}};}
    const result=method==="contest_catalog"?{plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]}:method==="contest_sessions"?{sessions:[]}:
      method==="contest_create"?{projection:current}:method==="contest_log_page"?{rows:[],total:0}:method==="contest_score"?{score:current.score}:null;
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};});
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}/>);await createContestThroughSetup();
  await waitFor(()=>expect(groupChat.sync).toHaveBeenCalled());
  const entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"active-qso",projectionRevision:1,requestID:crypto.randomUUID(),action:"entry_set_text",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,field:"callsign",value:"VK6ABC"}}));
  release();await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].draft.callsign).toBe("VK6ABC"));
  expect(groupChat.sync.mock.calls[0][1]).not.toHaveProperty("serialReservation");
});

it("retains one authored identity across a paged client commit and clears it only after the matching page",async()=>{
  const document=newContestSetup("OM0RX");document.network={...document.network,multiEnabled:true,multiMaster:false};
  localStorage.setItem("xlog.contesting.not1mm.setup-draft.v1",JSON.stringify(document));
  let current={...projection(),replicaCursor:{revision:1,sequence:0},authoritySerialRequestID:crypto.randomUUID()},authoredPage=0;
  groupChat.configure.mockResolvedValue(clientGroupSnapshot());groupChat.read.mockResolvedValue(clientGroupSnapshot());
  groupChat.authority.mockResolvedValue({changeRevision:3});
  groupChat.sync.mockImplementation(async(_context:any,syncRequest:any)=>{if(!syncRequest.authoredQSOID)
    return{apply:{id:"ignored",ok:true,result:{projection:current,replicaCursor:current.replicaCursor}},hasMore:false,authoredApplied:false};
    authoredPage+=1;current={...current,revision:current.revision+1,replicaCursor:authoredPage===1?{revision:2,sequence:25}:{revision:3,sequence:0}};
    return{apply:{id:"ignored",ok:true,result:{projection:current,replicaCursor:current.replicaCursor}},hasMore:authoredPage===1,authoredApplied:authoredPage===2};});
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    const result=method==="contest_catalog"?{plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]}:method==="contest_sessions"?{sessions:[]}:
      method==="contest_create"?{projection:current}:method==="contest_log_page"?{rows:[],total:0}:method==="contest_score"?{score:current.score}:null;
    if(!result)throw new Error(method);return{id:crypto.randomUUID(),ok:true,result};});
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}/>);await createContestThroughSetup();
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].status).toBe("ready"));const entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"active-qso",projectionRevision:1,requestID:crypto.randomUUID(),action:"entry_commit",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision}}));
  const authored=groupChat.sync.mock.calls.map(call=>call[1]).filter(request=>request.authoredQSOID);expect(authored).toHaveLength(2);
  expect(authored[0].authoredQSOID).toBe(authored[1].authoredQSOID);expect(authored[0].draftID).toBe(authored[1].draftID);
  expect(Object.keys(localStorage).some(key=>key.startsWith("xlog.contest.pending-client-mutation.v1/"))).toBe(false);
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
  await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,
    workspaceGeneration,panelID:"callsign-intelligence",projectionRevision:1,requestID:crypto.randomUUID(),action:"assistance_query",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision-1,inputCallsign:"STALE"}}));
  expect(request.mock.calls.some(([method])=>method==="contest_draft_apply")).toBe(true);
  await waitFor(()=>expect(surfaceOwner.current.projections["active-qso"].draft.callsign).toBe("STALE"));
  entry = surfaceOwner.current.projections["active-qso"];
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
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,key:"Enter",focusedField:"other_2"}}))
    .rejects.toThrow("The save reply was not confirmed");
});

it.each([
  { label:"unchanged", callsign:undefined, metadata:undefined },
  { label:"callsign-only", callsign:"DL1XYZ", metadata:undefined },
  { label:"metadata", callsign:undefined, metadata:{Name:"Alice",QTH:"Darwin",Comment:"Checked against paper log"} },
])("preserves original raw plugin fields on a $label contact correction", async ({callsign,metadata}) => {
  let current:any={...projection(),columns:["YYYY-MM-DD HH:MM:SS","Call","Freq","Snt","Rcv","ZN","PTS"]}, corrected:Record<string,any>|null=null;
  const raw_fields={callsign:"DL1ABC",sent:"579",receive:"589",other_1:"ORIGINAL-SENT",other_2:"ORIGINAL-RCVD",
    Name:"Original name",QTH:"Original QTH",Comment:"Original comment",plugin_owned:"retain exactly"};
  const row={ID:"qso-raw",TS:"2026-10-19 08:00:00",Call:"DL1ABC",Freq:14025,Band:14,Mode:"CW",
    SNT:"599",RCV:"599",SentNr:999,ZN:99,Operator:"OM0RX",Points:1,
    Name:raw_fields.Name,QTH:raw_fields.QTH,Comment:raw_fields.Comment,raw_fields};
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    if(method==="contest_scp_status")return unavailableSCP();if(method==="contest_history_status")return unavailableHistory();
    let result:any;
    if(method==="contest_catalog")result={plugins:[{id:"cq_ww_cw",name:"CQ WW CW",supportedBands:["160m","80m","40m","20m","15m","10m"]}]};
    else if(method==="contest_sessions")result={sessions:[]};
    else if(method==="contest_create")result={projection:current};
    else if(method==="contest_log_page")result={rows:[row],offset:0,limit:20,total:1};
    else if(method==="contest_score")result={score:current.score,matrices:{countries:[],zones:[]}};
    else if(method==="contest_qso_correct"){corrected=params;current={...current,revision:current.revision+1};result={projection:current,actions:[],messages:[]};}
    else throw new Error(method);
    return{id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);await createContestThroughSetup();
  const log=surfaceOwner.current.projections.logbook;
  const callIndex=log.pluginColumns.indexOf("Call"),pointsIndex=log.pluginColumns.indexOf("PTS"),zoneIndex=log.pluginColumns.indexOf("ZN");
  expect(log.pluginRows[0].inlineEdits[callIndex]).toMatchObject({kind:"text",field:"callsign",value:"DL1ABC"});
  expect(log.pluginRows[0].inlineEdits[zoneIndex]).toBeNull();
  expect(log.pluginRows[0].inlineEdits[pointsIndex]).toBeNull();
  const envelope={operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,panelID:"logbook",
    projectionRevision:log.sessionRevision,requestID:crypto.randomUUID()} as const;
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"log_edit_begin",params:{qsoID:"qso-raw"}}));
  await waitFor(()=>expect(surfaceOwner.current.projections.logbook.editing).toMatchObject({
    callsign:"DL1ABC",sentReport:"579",receivedReport:"589",receivedFields:[
      expect.objectContaining({id:"other_1",value:"ORIGINAL-SENT"}),expect.objectContaining({id:"other_2",value:"ORIGINAL-RCVD"})]}));
  if(callsign) await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"log_edit_set_text",
    params:{qsoID:"qso-raw",field:"callsign",value:callsign}}));
  if(metadata) for(const [field,value] of Object.entries(metadata)) await act(async()=>surfaceOwner.current.handle({
    ...envelope,requestID:crypto.randomUUID(),action:"log_edit_set_text",
    params:{qsoID:"qso-raw",field:field.toLowerCase(),value}}));
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"log_edit_save",
    params:{qsoID:"qso-raw",expectedSessionRevision:current.revision}}));
  const expected={...raw_fields,callsign:callsign??raw_fields.callsign} as Record<string,unknown>;
  delete expected.Name;delete expected.QTH;delete expected.Comment;if(metadata)Object.assign(expected,metadata);
  expect((corrected as Record<string,any>|null)?.fields).toEqual(expected);
});

it("pages, edits, and deletes through the detached Log owner actions", async () => {
  let current = projection(), deleted: Record<string, unknown> | null = null;
  const row = {ID:"qso-021",TS:"2026-10-19 08:00:00",Call:"DL1ABC",Freq:14025,Band:14,Mode:"CW",
    SNT:"599",RCV:"599",SentNr:15,ZN:14,Operator:"OM0RX",Points:1,CountryPrefix:"DL"};
  const newest = {...row,ID:"qso-001",TS:"2026-10-19 08:21:00",Call:"K1NEW",CountryPrefix:"K"};
  const request = vi.fn(async (method:string,params:Record<string,unknown>={})=>{
    const support = workspaceSupport(method, params, current); if (support) return support;
    if(method==="contest_scp_status")return unavailableSCP();
    if(method==="contest_history_status")return unavailableHistory();
    let result:any;
    if(method==="contest_catalog")result={plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]};
    else if(method==="contest_sessions")result={sessions:[]};
    else if(method==="contest_create")result={projection:current};
    else if(method==="contest_log_page"){const offset=Number(params.offset??0);result={rows:offset===20?[row]:[newest],offset,limit:Number(params.limit??20),total:21};}
    else if(method==="contest_score")result={score:current.score,matrices:{countries:[],zones:[]}};
    else if(method==="contest_qso_delete"){deleted=params;current=projection(current.revision+1);result={projection:current,actions:[],messages:[]};}
    else throw new Error(`Unexpected ${method}`);
    return {id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} {...workspaceProps}/>);
  await createContestThroughSetup();
  const envelope={operatingContext,scope:"contesting",sessionID:current.sessionID,workspaceGeneration,
    panelID:"logbook",projectionRevision:1,requestID:crypto.randomUUID()};
  await act(async()=>surfaceOwner.current.handle({...envelope,action:"log_page",params:{offset:20,limit:20}}));
  await waitFor(()=>expect(surfaceOwner.current.projections.logbook.page.rows[0]?.qsoID).toBe("qso-021"));
  const entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({...envelope,panelID:"active-qso",requestID:crypto.randomUUID(),action:"entry_edit_last",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision}}));
  await waitFor(()=>expect(surfaceOwner.current.projections.logbook.editing?.qsoID).toBe("qso-001"));
  expect(request.mock.calls).toContainEqual(["contest_log_page",expect.objectContaining({offset:0,limit:1})]);
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"log_edit_begin",params:{qsoID:"qso-021"}}));
  await waitFor(()=>expect(surfaceOwner.current.projections.logbook.editing?.qsoID).toBe("qso-021"));
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"log_edit_set_text",
    params:{qsoID:"qso-021",field:"deletionReason",value:"Duplicate import"}}));
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"log_edit_confirm_delete",
    params:{qsoID:"qso-021",confirmed:true}}));
  await waitFor(()=>expect(surfaceOwner.current.projections.logbook.editing?.confirmDelete).toBe(true));
  const scoreReadsBeforeDelete=request.mock.calls.filter(([method])=>method==="contest_score").length,
    logReadsBeforeDelete=request.mock.calls.filter(([method])=>method==="contest_log_page").length;
  await act(async()=>surfaceOwner.current.handle({...envelope,requestID:crypto.randomUUID(),action:"log_edit_delete",
    params:{qsoID:"qso-021",expectedSessionRevision:current.revision}}));
  expect(deleted).toMatchObject({qsoID:"qso-021",reason:"Duplicate import"});
  expect(request.mock.calls.filter(([method])=>method==="contest_score").length).toBeGreaterThan(scoreReadsBeforeDelete);
  expect(request.mock.calls.filter(([method])=>method==="contest_log_page").length).toBeGreaterThan(logReadsBeforeDelete);
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

it("refreshes detached Check Partial after Main Logging changes the callsign", async () => {
  let current=projection();
  const digest="a".repeat(64), matchID=`${digest}:0`;
  const dataset={sourceID:"local-private-file",version:"MASTER.SCP",retrievedAtUTC:null,sha256:digest,
    byteCount:12,recordCount:1,duplicateCount:0,digestVerification:"computedOnly"};
  const request=vi.fn(async(method:string,params:Record<string,unknown>={})=>{
    const support=workspaceSupport(method,params,current);if(support)return support;
    let result:any;
    if(method==="contest_history_status")result={dataset:null,pendingPreview:null,unavailableReason:"not_imported",activation:{state:"not_imported",generation:null,digest:null,rowCount:null,message:null}};
    else if(method==="contest_scp_status")result={dataset,unavailableReason:null};
    else if(method==="contest_scp_query")result={sessionID:params.sessionID,workspaceGeneration:params.workspaceGeneration,
      requestID:params.requestID,normalizedQuery:String(params.query).toUpperCase(),
      matches:[{matchID,callsign:"K1ABC",score:100,isPrefixMatch:true}],dataset,evaluatedRecordCount:1,isPartial:false};
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
  const entry=surfaceOwner.current.projections["active-qso"];
  await act(async()=>surfaceOwner.current.handle({operatingContext,scope:"contesting",sessionID:current.sessionID,
    workspaceGeneration,panelID:"active-qso",projectionRevision:1,requestID:crypto.randomUUID(),action:"entry_set_text",
    params:{draftID:current.draftID,expectedDraftRevision:entry.draft.revision,field:"callsign",value:"K1"}}));
  await waitFor(()=>expect(surfaceOwner.current.projections["callsign-intelligence"]).toMatchObject({inputCallsign:"K1",
    scp:{candidates:[{candidateID:matchID,callsign:"K1ABC"}]}}));
  expect(request.mock.calls.some(([method,params])=>method==="contest_scp_query"&&params?.query==="K1")).toBe(true);
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

it("prefers the Python host active contest when renderer storage is stale and multiple contests exist", async () => {
  const current = projection();
  const other = {...projection(), sessionID:crypto.randomUUID(), workspaceGeneration:crypto.randomUUID()};
  localStorage.setItem("xlog.contesting.not1mm.active-session.v1", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  const sessions = [
    {sessionID:other.sessionID,workspaceGeneration:other.workspaceGeneration,name:"Other contest",pluginID:other.pluginID,
      sourceRevision:other.sourceRevision,revision:other.revision},
    {sessionID:current.sessionID,workspaceGeneration:current.workspaceGeneration,name:"Host active contest",pluginID:current.pluginID,
      sourceRevision:current.sourceRevision,revision:current.revision},
  ];
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const support = workspaceSupport(method, params, current); if (support) return support;
    if (method === "contest_scp_status") return unavailableSCP();
    if (method === "contest_history_status") return unavailableHistory();
    const result = method === "contest_catalog" ? {plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}]}
      : method === "contest_sessions" ? {sessions,activeSessionID:current.sessionID}
      : method === "contest_open" ? {projection:current}
      : method === "contest_log_page" ? {rows:[],offset:0,limit:20,total:0}
      : method === "contest_score" ? {score:current.score,matrices:{countries:[],zones:[]}} : null;
    if (!result) throw new Error(`Unexpected ${method}`);
    return {id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}/>);
  await waitFor(() => expect(localStorage.getItem("xlog.contesting.not1mm.active-session.v1")).toBe(current.sessionID));
  expect(request.mock.calls.find(([method]) => method === "contest_open")?.[1]).toMatchObject({
    sessionID:current.sessionID,workspaceGeneration:current.workspaceGeneration,
  });
  expect(screen.queryByRole("alert")).toBeNull();
});

it("strict native cold start opens only the supplied host-active contest without consulting renderer authority", async () => {
  const current = projection();
  localStorage.setItem("xlog.contesting.not1mm.active-session.v1", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const support = workspaceSupport(method, params, current); if (support) return support;
    if (method === "contest_scp_status") return unavailableSCP();
    if (method === "contest_history_status") return unavailableHistory();
    const result = method === "contest_catalog" ? {plugins:[{id:current.pluginID,name:"CQ WW CW"}]}
      : method === "contest_open" ? {projection:current}
      : method === "contest_log_page" ? {rows:[],offset:0,limit:20,total:0}
      : method === "contest_score" ? {sessionID:current.sessionID,revision:current.revision,score:current.score,matrices:{countries:[],zones:[]}}
      : null;
    if (!result) throw new Error(`Unexpected ${method}`);
    return {id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}
    strictHostActive={{sessionID:current.sessionID,workspaceGeneration:current.workspaceGeneration}}/>);
  await waitFor(() => expect(request.mock.calls.some(([method]) => method === "contest_open")).toBe(true));
  expect(request.mock.calls.some(([method]) => method === "contest_sessions")).toBe(false);
  expect(request.mock.calls.filter(([method]) => method === "contest_open")).toHaveLength(1);
  expect(request.mock.calls.find(([method]) => method === "contest_open")?.[1]).toEqual({
    sessionID:current.sessionID,workspaceGeneration:current.workspaceGeneration,
  });
  expect(localStorage.getItem("xlog.contesting.not1mm.active-session.v1")).toBe(current.sessionID);
});

it("shows a failed cold-start open and retries the same preserved contest", async () => {
  const current = projection();
  let opens = 0;
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const support = workspaceSupport(method, params, current); if (support) return support;
    if (method === "contest_scp_status") return unavailableSCP();
    if (method === "contest_history_status") return unavailableHistory();
    if (method === "contest_open" && ++opens === 1) throw new Error("Contest could not open during startup");
    const result = method === "contest_catalog" ? {plugins:[{id:current.pluginID,name:"CQ WW CW"}]}
      : method === "contest_open" ? {projection:current}
      : method === "contest_log_page" ? {rows:[],offset:0,limit:20,total:187}
      : method === "contest_score" ? {sessionID:current.sessionID,revision:current.revision,score:current.score,matrices:{countries:[],zones:[]}}
      : null;
    if (!result) throw new Error(`Unexpected ${method}`);
    return {id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}
    strictHostActive={{sessionID:current.sessionID,workspaceGeneration:current.workspaceGeneration}}/>);
  expect((await screen.findByRole("alert")).textContent).toContain("Contest could not open during startup");
  fireEvent.click(screen.getByRole("button", {name:"Retry opening contest"}));
  await waitFor(() => expect(localStorage.getItem("xlog.contesting.not1mm.active-session.v1")).toBe(current.sessionID));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(request.mock.calls.filter(([method]) => method === "contest_open").map(([,params]) => params))
    .toEqual([1,2].map(() => ({sessionID:current.sessionID,workspaceGeneration:current.workspaceGeneration})));
});

it("strict native cold start resumes the supplied contest even when the catalog is unavailable", async () => {
  const current = projection();
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const support = workspaceSupport(method, params, current); if (support) return support;
    if (method === "contest_catalog") throw new Error("catalog unavailable");
    if (method === "contest_scp_status") return unavailableSCP();
    if (method === "contest_history_status") return unavailableHistory();
    const result = method === "contest_open" ? {projection:current}
      : method === "contest_log_page" ? {rows:[],offset:0,limit:20,total:0}
      : method === "contest_score" ? {sessionID:current.sessionID,revision:current.revision,score:current.score,matrices:{countries:[],zones:[]}}
      : null;
    if (!result) throw new Error(`Unexpected ${method}`);
    return {id:crypto.randomUUID(),ok:true,result};
  });
  render(<Not1MMContestWorkspace setupOnly request={request} serviceRequest={request} {...workspaceProps}
    strictHostActive={{sessionID:current.sessionID,workspaceGeneration:current.workspaceGeneration}}/>);
  await waitFor(() => expect(localStorage.getItem("xlog.contesting.not1mm.active-session.v1")).toBe(current.sessionID));
  expect(request.mock.calls.filter(([method]) => method === "contest_open")).toHaveLength(1);
  expect(request.mock.calls.some(([method]) => method === "contest_sessions")).toBe(false);
});

// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {DetachedAlertsSurface} from "./DetachedAlertsSurface";
const native=vi.hoisted(()=>({invoke:vi.fn(),listen:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke:native.invoke,isTauri:()=>true}));
vi.mock("@tauri-apps/api/event",()=>({listen:native.listen}));
const id="00000000-0000-4000-8000-000000000001",epoch="00000000-0000-4000-8000-000000000002",version="00000000-0000-4000-8000-000000000003";
const entry={id,test:false,source:"cluster",callsign:"ZL1ABC",frequencyKHz:14025,band:"20m",mode:"CW",comment:"CQ",callStatus:"New Call",dxccStatus:"ATNO",specialTags:[],ruleNames:["Wanted"],count:1,firstSeenMs:100,lastSeenMs:100,observation:{id:"source-report",activation:{sourceEpoch:epoch,spotVersion:version}}};
const frame=()=>({epoch,revision:1,configuration:{generation:id,revision:0,enabled:true,dedupSeconds:300,retentionMinutes:120,nativePopup:false,notificationSound:false,rules:[{id:"wanted",name:"Wanted",enabled:true,callsignGlob:"*",commentContains:"",bands:[],modes:[],callStatuses:[],dxccStatuses:[],specials:[]}]},storageError:null,source:{available:true,baselined:true,revision:1,receivedAtMs:100},entries:[entry],delivery:{error:null,suppressed:0,maximumPerWindow:3,windowSeconds:10},limits:{maximumRules:32,maximumEntries:200}});
beforeEach(()=>{vi.resetAllMocks();localStorage.clear();native.listen.mockResolvedValue(()=>{});native.invoke.mockImplementation(async(command,params)=>{
 if(command==="alerts_snapshot")return {epoch,revision:1,radio_report:false,rotor_report:false,items:[]};
 if(command==="dx_alerts_snapshot")return frame();
 if(command==="dx_alerts_review")return {entry,observation:entry.observation,admissible:true,reason:null};
 if(command==="spot_activation_snapshot")return {operationId:null,phase:"idle",barrier:null};
 if(command==="activate_spot")return {operationId:params.operationId,phase:"confirmed",reservationActive:false,tuneConfirmed:true,rotor:"not_requested"};
 return undefined;
});});
afterEach(cleanup);
it("reviews passively then passes only the exact retained identity once to the existing activation owner",async()=>{
 render(<DetachedAlertsSurface/>);
 fireEvent.click((await screen.findAllByRole("button",{name:"Review spot"}))[0]);
 const tune=await screen.findByRole("button",{name:"Tune & load"});
 expect(native.invoke.mock.calls.some(([command])=>command==="activate_spot")).toBe(false);
 await waitFor(()=>expect((tune as HTMLButtonElement).disabled).toBe(false));
 fireEvent.click(tune);fireEvent.click(tune);await act(async()=>{});
 const calls=native.invoke.mock.calls.filter(([command])=>command==="activate_spot");
 expect(calls).toEqual([["activate_spot",{operationId:expect.any(String),sourceEpoch:epoch,spotId:"source-report",spotVersion:version}]]);
 expect((tune as HTMLButtonElement).disabled).toBe(true);
 expect(native.invoke.mock.calls.some(([command])=>command==="worker_request"||command==="station_tune"||command==="rotor_goto")).toBe(false);
});
it("keeps historical or expired evidence reviewable without tune authority",async()=>{
 const original=native.invoke.getMockImplementation()!;
 native.invoke.mockImplementation(async(command,params)=>command==="dx_alerts_review"?{entry:{...entry,test:true},observation:null,admissible:false,reason:"Historical test entry has no cluster tune authority."}:original(command,params));
 render(<DetachedAlertsSurface/>);
 fireEvent.click((await screen.findAllByRole("button",{name:"Review spot"}))[0]);
 expect(await screen.findByText(/Historical test entry/)).toBeTruthy();
 expect((await screen.findByRole("button",{name:"Tune & load"}) as HTMLButtonElement).disabled).toBe(true);
 expect(native.invoke.mock.calls.some(([command])=>command==="activate_spot")).toBe(false);
});

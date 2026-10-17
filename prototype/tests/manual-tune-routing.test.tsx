// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import StationPanel from "../src/live/StationPanel";
import DirectFlexPanel from "../src/live/DirectFlexPanel";
import HamlibPanel from "../src/live/HamlibPanel";
import { DetachedStationControlSurface } from "../src/live/DetachedStationControlSurface";
const native=vi.hoisted(()=>({tune:vi.fn(),state:{pending:null,busy:false,message:""},context:null as any}));
vi.mock("@tauri-apps/api/core", async original=>({...await original<typeof import("@tauri-apps/api/core")>(),invoke:vi.fn(async(command:string,{params}:any)=>{
  if(command==="station_session_request"&&params.action==="snapshot")return {radio_id:params.radio_id,active_radio:"radio1",tx_owner:null,generation:"fixture",revision:1,base_url:"",last_receipt:null,selection:{provider:"direct_flex_lan",generation:2,selection_id:"s"}};
  return {};
})}));
vi.mock("@tauri-apps/api/event",()=>({listen:vi.fn(async()=>()=>{})}));
vi.mock("../src/live/manualTune",()=>({manualTuneSession:()=>({tune:native.tune,getSnapshot:()=>native.state,subscribe:()=>()=>{}})}));
vi.mock("../src/live/stationSelection",()=>({nativeStationSelection:()=>true}));
vi.mock("../src/live/AgentConnectionSetup",()=>({AgentConnectionSetup:()=>null}));
vi.mock("../src/live/monitorContext",async original=>({...await original<typeof import("../src/live/monitorContext")>(),connectMonitorContext:(changed:(v:any)=>void)=>{
  changed(native.context);return {refresh:vi.fn(),dispose:vi.fn()};
}}));
beforeEach(()=>{native.tune.mockReset();native.tune.mockResolvedValue({confirmed:true,accepted:true});localStorage.clear();});
afterEach(cleanup);
function snapshot(provider:string) { return {source:provider,available:true,generation:1,generated_at:Date.now()/1000,radio:{connected:true,observed:true,frequency_hz:14074000,mode:"USB",observed_at:Date.now()/1000},station:{radio_stale:false,supported_commands:[],allowed_actions:[]},capabilities:{supported_commands:["station_tune"]}}; }
it.each(["direct_agent","direct_flex_lan"] as const)("routes the existing main %s button through the shared manual owner",async provider=>{
  const request=vi.fn(async()=>snapshot(provider));
  render(provider==="direct_agent"?<StationPanel radioId="radio1" snapshot={snapshot(provider)} onRequest={request} onSnapshot={()=>{}} />:<DirectFlexPanel radioId="radio1" snapshot={snapshot(provider)} request={request} />);
  expect(native.tune).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(provider==="direct_agent"?"Tune frequency MHz":"FLEX frequency MHz"),{target:{value:"14.074000"}});
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Tune simplex"})));
  expect(native.tune).toHaveBeenCalledExactlyOnceWith(provider,14074000,provider==="direct_agent"?"SSB":"USB");
  expect(request.mock.calls.some(call=>(call as unknown[])[0]==="station_tune")).toBe(false);
});
it("routes the main native Hamlib simplex control through the shared owner",async()=>{
  const request=vi.fn(async()=>({}));render(<HamlibPanel radioId="radio1" request={request} snapshot={null} />);expect(native.tune).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Simplex frequency MHz"),{target:{value:"7.100000"}});
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Tune simplex"})));
  expect(native.tune).toHaveBeenCalledExactlyOnceWith("hamlib",7100000,"USB",undefined);
  expect(request).not.toHaveBeenCalled();
});
it("detached Station Control tunes from retained native context with no mounted main controller",async()=>{
  const now=Date.now();native.context={epoch:"e",revision:1,selection:{provider:"direct_flex_lan",generation:2,selection_id:"s",control_revision:3},
    radio:{available:true,provider:"direct_flex_lan",selection_id:"s",selection_generation:2,received_at_ms:now,snapshot:snapshot("direct_flex_lan")},rotor:{available:false,snapshot:null}};
  render(<DetachedStationControlSurface />);await screen.findByRole("main",{name:"Detached Station Control"});expect(native.tune).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Simplex frequency MHz"),{target:{value:"14.074000"}});
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Tune simplex"})));
  expect(native.tune).toHaveBeenCalledExactlyOnceWith("direct_flex_lan",14074000,"USB",native.context);
});

// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import StationPanel from "./StationPanel";
import Monitor from "./Monitor";
const shared=vi.hoisted(()=>({native:false,transition:vi.fn(async()=>({accepted:true,confirmed:false}))}));
vi.mock("./stationSelection",()=>({nativeStationSelection:()=>shared.native}));
vi.mock("./amplifierTransition",()=>({amplifierTransitionSession:()=>({transition:shared.transition})}));
vi.mock("./AmplifierTransitionStatus",()=>({AmplifierTransitionStatus:()=>null}));
vi.mock("./CarrierTuneStatus",()=>({CarrierTuneStatus:()=>null}));
vi.mock("./RadioReleaseStatus",()=>({RadioReleaseStatus:()=>null}));
vi.mock("./AgentConnectionSetup",()=>({AgentConnectionSetup:()=>null}));
afterEach(()=>{cleanup();shared.transition.mockClear();});
for(const native of [true,false])for(const action of ["operate","standby"] as const)it(`${action} uses ${native?"shared native":"browser fixture"} route`,async()=>{
  shared.native=native;const snapshot={source:"direct_agent",available:true,allow_transmit:false,radio:{connected:true,observed:true,transmitting:false},station:{radio_known:true,radio_stale:false,inhibitors:[],allowed_actions:["operate","standby"],supported_commands:["station_operate","station_standby"]}};
  const request=vi.fn(async()=>snapshot);render(<StationPanel snapshot={snapshot} onRequest={request} onSnapshot={()=>{}}/>);fireEvent.click(screen.getByRole("button",{name:action==="operate"?"Operate":"Standby"}));
  if(native){await waitFor(()=>expect(shared.transition).toHaveBeenCalledExactlyOnceWith(action));expect(request.mock.calls.some(args=>(args as any[])[0]==="station_action")).toBe(false);}else{await waitFor(()=>expect(request).toHaveBeenCalledWith("station_action",{provider:"direct_agent",action}));expect(shared.transition).not.toHaveBeenCalled();}
});
it("Monitor keeps explicit Standby reachable offline/busy and delegates lost ACK without hiding later errors",async()=>{
  const request=vi.fn(async(_method:string,p:Record<string,any>={})=>{throw new Error(p.action==="standby"?"Lost Standby ACK":"Later Tune error");});
  const view=render(<Monitor snapshot={{source:"direct_agent",radio:{connected:false},station:{allowed_actions:[],kpa_operate:false}}} map={null} onRequest={request} externalAmplifierFeedback/>);
  expect(screen.getByRole("button",{name:"Standby"}).hasAttribute("disabled")).toBe(false);fireEvent.click(screen.getByRole("button",{name:"Standby"}));await waitFor(()=>expect(request).toHaveBeenCalledWith("station_action",{action:"standby"}));expect(screen.queryByText("Lost Standby ACK")).toBeNull();
  view.rerender(<Monitor snapshot={{source:"direct_agent",allow_transmit:true,radio:{connected:true,observed:true},station:{allowed_actions:["tune"],kpa_operate:false}}} map={null} onRequest={request} externalAmplifierFeedback/>);fireEvent.click(screen.getByRole("button",{name:"Tune"}));expect(await screen.findByText("Later Tune error")).toBeTruthy();
});

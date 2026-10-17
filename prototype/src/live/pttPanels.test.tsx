// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import StationPanel from "./StationPanel";
import DirectFlexPanel from "./DirectFlexPanel";
const shared=vi.hoisted(()=>({native:false,set:vi.fn(async()=>({accepted:true,confirmed:false}))}));
vi.mock("./stationSelection",()=>({nativeStationSelection:()=>shared.native}));
vi.mock("./pttSession",()=>({pttSession:()=>({set:shared.set})}));
vi.mock("./PTTStatus",()=>({PTTStatus:()=>null}));
vi.mock("./AmplifierTransitionStatus",()=>({AmplifierTransitionStatus:()=>null}));
vi.mock("./CarrierTuneStatus",()=>({CarrierTuneStatus:()=>null}));
vi.mock("./RadioReleaseStatus",()=>({RadioReleaseStatus:()=>null}));
vi.mock("./AgentConnectionSetup",()=>({AgentConnectionSetup:()=>null}));
afterEach(()=>{cleanup();shared.set.mockClear();});
for(const native of [true,false])for(const provider of ["direct_agent","direct_flex_lan"] as const)for(const on of [true,false])it(`${provider} PTT ${on?"on":"off"} uses ${native?"durable native":"browser fixture"} path`,async()=>{
 shared.native=native;const snapshot={source:provider,available:true,allow_transmit:true,radio:{connected:true,observed:true,transmitting:false},station:{commissioned:true,radio_known:true,radio_stale:false,inhibitors:[],allowed_actions:[],supported_commands:["set_ptt"]},capabilities:{supported_commands:["ptt"]}};const request=vi.fn(async()=>snapshot);
 if(provider==="direct_agent")render(<StationPanel radioId="radio1" snapshot={snapshot} onRequest={request} onSnapshot={()=>{}}/>);else render(<DirectFlexPanel radioId="radio1" snapshot={snapshot} request={request}/>);
 fireEvent.click(screen.getByRole("button",{name:`PTT ${on?"on":"off"}`}));
 if(native){await waitFor(()=>expect(shared.set).toHaveBeenCalledExactlyOnceWith(on,provider));expect(request.mock.calls.some(args=>(args as any[])[0]==="station_radio_control")).toBe(false);}else{await waitFor(()=>expect(request).toHaveBeenCalledWith("station_radio_control",{provider,control:"ptt",enabled:on}));expect(shared.set).not.toHaveBeenCalled();}
});

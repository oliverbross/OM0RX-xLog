// @vitest-environment jsdom
import { afterEach,expect,it,vi } from "vitest";
import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import StationPanel from "./StationPanel";
import DirectFlexPanel from "./DirectFlexPanel";
const shared=vi.hoisted(()=>({native:false,tune:vi.fn(async()=>({accepted:true,confirmed:false}))}));
vi.mock("./stationSelection",()=>({nativeStationSelection:()=>shared.native}));
vi.mock("./carrierTune",()=>({carrierTuneSession:()=>({tune:shared.tune})}));
vi.mock("./CarrierTuneStatus",()=>({CarrierTuneStatus:()=>null}));
vi.mock("./RadioReleaseStatus",()=>({RadioReleaseStatus:()=>null}));
vi.mock("./AgentConnectionSetup",()=>({AgentConnectionSetup:()=>null}));
afterEach(()=>{cleanup();shared.tune.mockClear();});
for(const native of [true,false])for(const provider of ["direct_agent","direct_flex_lan"] as const){
  it(`${provider} uses ${native?"native durable":"browser fixture"} carrier acquisition`,async()=>{
    shared.native=native;const snapshot={source:provider,available:true,allow_transmit:true,radio:{connected:true,observed:true,transmitting:false},station:{commissioned:true,radio_known:true,radio_stale:false,inhibitors:[],allowed_actions:["tune"],supported_commands:["station_tune"]},capabilities:{supported_commands:["tune"]}};
    const request=vi.fn(async()=>snapshot);
    if(provider==="direct_agent")render(<StationPanel snapshot={snapshot} onRequest={request} onSnapshot={()=>{}}/>);else render(<DirectFlexPanel snapshot={snapshot} request={request}/>);
    fireEvent.click(screen.getByRole("button",{name:provider==="direct_agent"?"Tune":"Tune carrier"}));
    if(native){await waitFor(()=>expect(shared.tune).toHaveBeenCalledExactlyOnceWith(provider));expect(request.mock.calls.some(args=>(args as unknown[])[0]==="station_action")).toBe(false);}
    else{await waitFor(()=>expect(request).toHaveBeenCalledWith("station_action",{provider,action:"tune"}));expect(shared.tune).not.toHaveBeenCalled();}
  });
}

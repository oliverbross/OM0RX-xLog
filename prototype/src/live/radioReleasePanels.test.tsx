// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import StationPanel from "./StationPanel";
import DirectFlexPanel from "./DirectFlexPanel";
const shared = vi.hoisted(() => ({ native: false, cancel: vi.fn(async () => ({accepted:true,confirmed:false})) }));
vi.mock("./stationSelection", () => ({ nativeStationSelection: () => shared.native }));
vi.mock("./radioRelease", () => ({ radioReleaseSession: () => ({cancel:shared.cancel}) }));
vi.mock("./RadioReleaseStatus", () => ({ RadioReleaseStatus: () => <p>Native Cancel receipts</p> }));
vi.mock("./AgentConnectionSetup", () => ({ AgentConnectionSetup: () => null }));
afterEach(() => { cleanup(); shared.cancel.mockClear(); });
for (const native of [false, true]) {
  for (const provider of ["direct_agent", "direct_flex_lan"] as const) {
    it(`${provider} routes Cancel through ${native ? "durable native ownership" : "the explicit browser fixture request"}`, async () => {
      shared.native=native;
      const snapshot={source:provider,available:false,
        radio:provider==="direct_flex_lan"?{observed:true,connected:true,transmitting:false}:null,
        station:provider==="direct_agent"?{allowed_actions:["cancel"]}:null,rotor:null,
        capabilities:provider==="direct_flex_lan"?{supported_commands:["cancel"]}:undefined};
      const request=vi.fn(async () => snapshot);
      if(provider==="direct_agent") render(<StationPanel radioId="radio1" snapshot={snapshot} onRequest={request} onSnapshot={()=>{}}/>);
      else render(<DirectFlexPanel radioId="radio1" snapshot={snapshot} request={request}/>);
      fireEvent.click(screen.getByRole("button",{name:provider==="direct_agent"?"Cancel":"Cancel / release"}));
      if(native) {
        await waitFor(()=>expect(shared.cancel).toHaveBeenCalledExactlyOnceWith(provider));
        expect(request.mock.calls.some(args=>(args as unknown[])[0]==="station_action")).toBe(false);
      } else {
        await waitFor(()=>expect(request).toHaveBeenCalledWith("station_action",{provider,action:"cancel"}));
        expect(shared.cancel).not.toHaveBeenCalled();
      }
    });
  }
}

// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {NearbyCallsigns} from "./NearbyCallsigns";
const native=vi.hoisted(()=>({invoke:vi.fn(),listen:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke:native.invoke,isTauri:()=>true}));
vi.mock("@tauri-apps/api/event",()=>({listen:native.listen}));
const candidate=(callsign="ZL1ABC",id="spot-1")=>({callsign,spotId:id,spotVersion:"00000000-0000-4000-8000-000000000001",frequencyHz:14025120,offsetHz:120,ageSeconds:120,draftRevision:3});
let candidates=[candidate()];
beforeEach(()=>{vi.resetAllMocks();candidates=[candidate()];native.listen.mockResolvedValue(()=>{});native.invoke.mockImplementation(async(command,params)=>command==="nearby_callsign_snapshot"?{enabled:true,candidates}:command==="nearby_callsign_accept"?{operationId:params.operationId,phase:"confirmed",barrier:null,admitted:true,reservationActive:false,draftOnly:true,intent:"nearby-callsign",tuneConfirmed:false,rotor:"not-requested"}:undefined);});
afterEach(cleanup);
it("applies one exact candidate after flushing and reconciles without tune, rotor, save or follow changes",async()=>{
 const order:string[]=[],before=vi.fn(async()=>{order.push("flush");}),applied=vi.fn(async()=>{order.push("reconcile");});
 render(<NearbyCallsigns beforeApply={before} onApplied={applied}/>);
 fireEvent.click(await screen.findByRole("button",{name:"Use callsign"}));
 await act(async()=>{});
 expect(order).toEqual(["flush","reconcile"]);expect(applied).toHaveBeenCalledTimes(1);
 expect(native.invoke.mock.calls.filter(([command])=>command!=="nearby_callsign_snapshot")).toEqual([["nearby_callsign_accept",{operationId:expect.any(String),candidate:candidate()}]]);
});
it("preserves late typing or invalid buffered input when the preparation barrier refuses",async()=>{
 render(<NearbyCallsigns beforeApply={async()=>{throw new Error("Your typed callsign wins");}} onApplied={vi.fn()}/>);
 fireEvent.click(await screen.findByRole("button",{name:"Use callsign"}));
 expect(await screen.findByRole("alert")).toHaveProperty("textContent","Your typed callsign wins");
 expect(native.invoke.mock.calls.every(([command])=>command==="nearby_callsign_snapshot")).toBe(true);
});
it("offers several callsigns as a choice and the optional command cannot choose automatically",async()=>{
 candidates=[candidate(),candidate("VK8RX","spot-2")];
 render(<NearbyCallsigns beforeApply={vi.fn()} onApplied={vi.fn()}/>);
 await screen.findAllByRole("button",{name:"Use callsign"});
 act(()=>window.dispatchEvent(new Event("xlog:accept-nearby-callsign")));
 expect(await screen.findByRole("alert")).toHaveProperty("textContent","Choose a nearby spotted callsign explicitly from the list.");
 expect(native.invoke.mock.calls.every(([command])=>command==="nearby_callsign_snapshot")).toBe(true);
});
it("leaves disabled entry controls inert",async()=>{
 const before=vi.fn();
 render(<NearbyCallsigns disabled beforeApply={before} onApplied={vi.fn()}/>);
 const button=await screen.findByRole("button",{name:"Use callsign"});
 expect((button as HTMLButtonElement).disabled).toBe(true);fireEvent.click(button);expect(before).not.toHaveBeenCalled();
});

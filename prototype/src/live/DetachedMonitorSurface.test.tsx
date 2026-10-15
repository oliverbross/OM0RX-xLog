// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MonitorSurface } from "./DetachedMonitorSurface";
import { syntheticMonitorContext } from "./monitorContextFixtures";
import type { MonitorContext } from "./monitorContext";
import { syntheticMapContext } from "./mapContextFixtures";
import { ManualRotorGotoSession } from "./manualRotorGoto";
const automatic = vi.hoisted(() => ({ state: null as any, error: "", set: vi.fn(), changed: undefined as undefined | (() => void) }));
vi.mock("./useAutoRotor", async () => {
  const { useEffect, useState } = await import("react");
  return { useAutoRotor: () => {
    const [, render] = useState(0);
    useEffect(() => { automatic.changed = () => render(value => value + 1); return () => { automatic.changed = undefined; }; }, []);
    return { state: automatic.state, error: automatic.error, set: automatic.set, refresh: vi.fn() };
  } };
});
vi.mock("../Map", () => ({ default: () => <div>Optional map component</div> }));
let changed!: (value: MonitorContext) => void, failed!: (message: string) => void;
const noTarget = () => ({ refresh: vi.fn(), dispose: vi.fn() });
const map = (_changed: any, fail: (value: string) => void) => { fail("Synthetic metadata unavailable"); return { refresh: vi.fn(), dispose: vi.fn() }; };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-14T00:00:00Z"));
  automatic.state = { armed: false, epoch: 0, owner: null, generation: null, target: null, activation_pending: false, canonical_pending: false, error: "" };
  automatic.error = ""; automatic.set.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
function setup(value = syntheticMonitorContext()) {
  const refresh = vi.fn(), dispose = vi.fn(), radioAction = vi.fn().mockResolvedValue({ accepted: true }), rotorAction = vi.fn().mockResolvedValue({ accepted: true });
  const core = (accept: typeof changed, reject: typeof failed) => { changed = accept; failed = reject; accept(value); return { refresh, dispose }; };
  const view = render(<MonitorSurface connectCore={core} connectMap={map} connectTarget={noTarget} radioAction={radioAction} rotorAction={rotorAction}
    renderMap={(_value, stale) => <div>Optional map {stale ? "unavailable" : "available"}</div>} />);
  return { ...view, refresh, dispose, radioAction, rotorAction };
}
it("renders native radio/rotor without main or optional metadata and keeps existing actions", async () => {
  const view = setup();
  expect(screen.getByRole("main", { name: "Detached Station Monitor" })).toBeTruthy();
  expect(screen.queryByText("Station Monitor", { exact: true })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Refresh$/ })).toBeNull();
  expect(screen.queryByText(/independent of Desk/)).toBeNull();
  expect(screen.getByText("A: 14.074000")).toBeTruthy(); expect(screen.getByText("053°")).toBeTruthy();
  expect(screen.getByText("Optional map unavailable")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Standby" })); await act(async () => {});
  expect(view.radioAction).toHaveBeenCalledWith(expect.objectContaining({ selection: expect.objectContaining({ generation: 2 }) }), "standby");
  fireEvent.click(screen.getByRole("button", { name: "Stop" })); await act(async () => {});
  expect(view.rotorAction).toHaveBeenCalledWith(expect.anything(), "rotor_stop", {}); expect(view.refresh).toHaveBeenCalledTimes(2);
});
it("stale or failed observations disable TX and turn but retain explicit native Standby, Cancel and Stop", async () => {
  const view = setup();
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(screen.getByRole("button", { name: "Tune" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "Standby" }).hasAttribute("disabled")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Standby" })); await act(async()=>{});
  expect(view.radioAction).toHaveBeenCalledWith(expect.anything(),"standby");
  expect(screen.getByRole("button", { name: "Turn" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" })); fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  await act(async () => {});
  expect(view.radioAction).toHaveBeenCalledWith(expect.anything(), "cancel"); expect(view.rotorAction).toHaveBeenCalledWith(expect.anything(), "rotor_stop", {});
  act(() => failed("Retained context unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Standby" })); await act(async()=>{});
  expect(view.radioAction.mock.calls.filter((call:unknown[])=>call[1]==="standby")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Retry observations" }));
  expect(view.refresh).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Stop" })); await act(async () => {});
  expect(view.rotorAction).toHaveBeenCalledTimes(2); expect(screen.queryByText("LIVE")).toBeNull();
});
it("uses the latest selection context, clears unavailable radio independently and keeps rotor Stop", async () => {
  const view = setup(); const next = syntheticMonitorContext(); next.revision = 2;
  next.selection = { provider: "hamlib", generation: 3, selection_id: crypto.randomUUID() }; next.radio = { available: false, snapshot: null };
  act(() => changed(next));
  expect(screen.getByText(/LOCAL HAMLIB/)).toBeTruthy(); expect(screen.queryByRole("button", { name: "Tune" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Stop" })); await act(async () => {});
  expect(view.rotorAction).toHaveBeenCalledWith(next, "rotor_stop", {});
});
it("shows unset selection explicitly without defaulting or offering radio controls", () => {
  const value = syntheticMonitorContext(); value.selection = { provider: null, generation: 0, selection_id: null }; value.radio = { available: false, snapshot: null };
  setup(value); expect(screen.getByText(/No radio selected\. Choose/)).toBeTruthy();
  expect(screen.getByText(/NO RADIO SELECTED/)).toBeTruthy(); expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
});
it("routes the default Monitor Turn through its injected durable manual rotor session", async () => {
  const value = syntheticMonitorContext(), observed = value.rotor.snapshot!;
  const snapshot = vi.fn(async () => ({ generation:"station",revision:4,last_receipt:null,worker_generation:9,
    rotor:{available:true,revision:value.rotor.revision,received_at_ms:Date.now(),snapshot:structuredClone(observed)} }));
  const request = vi.fn(async (params:Record<string,unknown>) => ({ operation_id:String(params.operation_id),status:"acknowledged" as const,
    request:{action:"manual_rotor_goto"} }));
  let pending:string|null=null;
  const rotorSession = new ManualRotorGotoSession({snapshot,request},{read:()=>pending,write:value=>{pending=value;}});
  const core = (accept:(next:MonitorContext)=>void) => {accept(value);return{refresh:vi.fn(),dispose:vi.fn()};};
  render(<MonitorSurface connectCore={core} connectMap={map} connectTarget={noTarget} rotorSession={rotorSession} renderMap={()=>null}/>);
  fireEvent.change(screen.getByLabelText("Monitor rotor bearing"),{target:{value:"135"}});
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Turn"}));});
  expect(snapshot).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledWith(expect.objectContaining({action:"manual_rotor_goto",rotor_owner:observed.owner,
    rotor_generation:observed.generation,bearing:135,label:"Monitor bearing"}));
  expect(screen.getByText("Request accepted · watch observed state")).toBeTruthy();
  expect(pending).toBeNull();
});
it("recovers a lost rotor acknowledgement after remount even when the rotor owner disappeared", async () => {
  let pending: string | null = null;
  const snapshot = { generation:"station",revision:4,last_receipt:null,worker_generation:9,rotor:{available:true,revision:12,received_at_ms:Date.now(),
    snapshot:{owner:"native_dcu1" as const,generation:7,state:"active" as const,backend_available:true,backend:{connected:true,azimuth:42}}} };
  const request = vi.fn().mockRejectedValueOnce(new Error("lost reply"));
  const journal = { read:() => pending, write:(value:string|null) => { pending=value; } };
  const first = new ManualRotorGotoSession({ snapshot:async()=>structuredClone(snapshot), request }, journal);
  await expect(first.goto("native_dcu1",7,90)).rejects.toThrow("lost reply"); const operation=pending!;
  const value = syntheticMonitorContext(); value.rotor={available:false,revision:13,received_at_ms:Date.now(),snapshot:null};
  const core = (accept:(value:MonitorContext)=>void) => { accept(value); return {refresh:vi.fn(),dispose:vi.fn()}; };
  const restored = new ManualRotorGotoSession({snapshot:async()=>structuredClone(snapshot),request},journal);
  const view = render(<MonitorSurface connectCore={core} connectMap={map} connectTarget={noTarget} rotorSession={restored} renderMap={()=>null} />);
  expect(screen.getByRole("button",{name:"Check rotor receipt"})).toBeTruthy(); view.unmount();
  request.mockResolvedValue({operation_id:operation,status:"acknowledged",request:{action:"manual_rotor_goto"}});
  render(<MonitorSurface connectCore={core} connectMap={map} connectTarget={noTarget} rotorSession={new ManualRotorGotoSession({snapshot:async()=>structuredClone(snapshot),request},journal)} renderMap={()=>null} />);
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Check rotor receipt"}));});
  expect(request.mock.calls[1]).toEqual([{action:"receipt",operation_id:operation}]);
  expect(screen.queryByRole("button",{name:"Check rotor receipt"})).toBeNull();
});
it("clears Monitor's originating lost-reply command message after terminal receipt recovery", async () => {
  const value = syntheticMonitorContext(), observed = value.rotor.snapshot!; let pending: string | null = null;
  const snapshot = { generation:"station",revision:4,last_receipt:null,worker_generation:9,
    rotor:{available:true,revision:value.rotor.revision,received_at_ms:Date.now(),snapshot:structuredClone(observed)} };
  const request = vi.fn().mockRejectedValueOnce(new Error("monitor turn reply lost"));
  const journal = { read:()=>pending,write:(next:string|null)=>{pending=next;} };
  const rotorSession = new ManualRotorGotoSession({snapshot:async()=>structuredClone(snapshot),request},journal);
  const rotorAction = vi.fn(async (_context:MonitorContext|null,method:string,params:Record<string,unknown>={}) => {
    if(method!=="rotor_goto") throw new Error("Unexpected rotor operation");
    return rotorSession.goto(observed.owner!,observed.generation,params.bearing as number,"Monitor bearing");
  });
  const core = (accept:(next:MonitorContext)=>void) => {accept(value);return{refresh:vi.fn(),dispose:vi.fn()};};
  render(<MonitorSurface connectCore={core} connectMap={map} connectTarget={noTarget} rotorAction={rotorAction}
    rotorSession={rotorSession} renderMap={()=>null}/>);
  fireEvent.change(screen.getByLabelText("Monitor rotor bearing"),{target:{value:"135"}});
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Turn"}));});
  expect(screen.getByText("monitor turn reply lost")).toBeTruthy();const operation=pending!;
  request.mockResolvedValueOnce({operation_id:operation,status:"acknowledged",request:{action:"manual_rotor_goto"}});
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Check rotor receipt"}));});
  expect(screen.queryByText("monitor turn reply lost")).toBeNull();
  expect(rotorAction).toHaveBeenCalledTimes(1);expect(request).toHaveBeenCalledTimes(2);
});
it("keeps Monitor's newer Stop failure when an older lost Goto receipt resolves", async () => {
  const value = syntheticMonitorContext(), observed = value.rotor.snapshot!; let pending: string | null = null;
  const snapshot = { generation:"station",revision:4,last_receipt:null,worker_generation:9,
    rotor:{available:true,revision:value.rotor.revision,received_at_ms:Date.now(),snapshot:structuredClone(observed)} };
  const request = vi.fn().mockRejectedValueOnce(new Error("old monitor Goto reply lost"));
  const journal = { read:()=>pending,write:(next:string|null)=>{pending=next;} };
  const rotorSession = new ManualRotorGotoSession({snapshot:async()=>structuredClone(snapshot),request},journal);
  const rotorAction = vi.fn(async (_context:MonitorContext|null,method:string,params:Record<string,unknown>={}) => {
    if(method==="rotor_stop") throw new Error("newer monitor Stop failed");
    return rotorSession.goto(observed.owner!,observed.generation,params.bearing as number,"Monitor bearing");
  });
  const core = (accept:(next:MonitorContext)=>void) => {accept(value);return{refresh:vi.fn(),dispose:vi.fn()};};
  render(<MonitorSurface connectCore={core} connectMap={map} connectTarget={noTarget} rotorAction={rotorAction}
    rotorSession={rotorSession} renderMap={()=>null}/>);
  fireEvent.change(screen.getByLabelText("Monitor rotor bearing"),{target:{value:"135"}});
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Turn"}));});
  expect(screen.getByText("old monitor Goto reply lost")).toBeTruthy();
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Stop"}));});
  expect(screen.getByText("newer monitor Stop failed")).toBeTruthy();const operation=pending!;
  request.mockResolvedValueOnce({operation_id:operation,status:"acknowledged",request:{action:"manual_rotor_goto"}});
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Check rotor receipt"}));});
  expect(screen.getByText("newer monitor Stop failed")).toBeTruthy();
  expect(rotorAction.mock.calls.map(([,method])=>method)).toEqual(["rotor_goto","rotor_stop"]);
});
it("isolated synthetic context remains read-only even if supplied connected observations advertise actions", () => {
  const value = syntheticMonitorContext(); value.acceptance = { synthetic: true, source: "synthetic_memory", externalOwners: false, readOnly: true };
  setup(value); expect(screen.getByText("Synthetic isolated observation · read only")).toBeTruthy();
  for (const name of ["Standby", "Tune", "Cancel", "Turn", "Stop"]) expect(screen.queryByRole("button", { name })).toBeNull();
  expect(screen.queryByRole("checkbox", { name: "Auto rotor" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Turn automatic rotor off" })).toBeNull();
  expect(automatic.set).not.toHaveBeenCalled();
});

it("arms through native authority using the retained exact owner/generation without a Desk", async () => {
  setup();
  const checkbox = screen.getByRole("checkbox", { name: "Auto rotor" }) as HTMLInputElement;
  expect(checkbox.disabled).toBe(false);
  fireEvent.click(checkbox); await act(async () => {});
  expect(automatic.set).toHaveBeenCalledExactlyOnceWith(true, expect.objectContaining({ owner: "native_dcu1", generation: 4 }));
  expect(checkbox.checked).toBe(false); // A request is not an armed acknowledgement.
  act(() => { automatic.state = { ...automatic.state, armed: true, epoch: 1, owner: "native_dcu1", generation: 4 }; automatic.changed?.(); });
  expect(checkbox.checked).toBe(true);
});
it.each(["stale", "failed", "disconnected", "uncertain"])("keeps Off and Stop while %s rotor context prevents Arm", async kind => {
  const value = syntheticMonitorContext();
  if (kind === "stale") value.rotor.received_at_ms -= 6000;
  if (kind === "disconnected") value.rotor.snapshot.backend.connected = false;
  if (kind === "uncertain") value.rotor.snapshot.state = "uncertain";
  const view = setup(value);
  if (kind === "failed") act(() => failed("Native observations unavailable"));
  expect((screen.getByRole("checkbox", { name: "Auto rotor" }) as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Turn automatic rotor off" }));
  fireEvent.click(screen.getByRole("button", { name: "Stop" })); await act(async () => {});
  expect(automatic.set).toHaveBeenCalledExactlyOnceWith(false, undefined);
  expect(view.rotorAction).toHaveBeenCalledWith(expect.anything(), "rotor_stop", {});
});
it("keeps Off available before status arrives and during a pending Arm, without retrying either", async () => {
  let resolve!: () => void;
  automatic.set.mockImplementation((armed: boolean) => armed ? new Promise<void>(done => { resolve = done; }) : Promise.resolve());
  setup(); const checkbox = screen.getByRole("checkbox", { name: "Auto rotor" }) as HTMLInputElement;
  fireEvent.click(checkbox); expect(checkbox.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Turn automatic rotor off" }));
  expect(automatic.set.mock.calls.map(([armed]) => armed)).toEqual([true, false]);
  await act(async () => { resolve(); }); expect(checkbox.checked).toBe(false);
  act(() => { automatic.state = null; automatic.changed?.(); });
  expect(checkbox.disabled).toBe(true); expect(screen.getByText("Auto rotor unavailable")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Turn automatic rotor off" })); await act(async () => {});
  expect(automatic.set.mock.calls.map(([armed]) => armed)).toEqual([true, false, false]);
});
it("keeps an acknowledged armed state disarmable after observations become stale", async () => {
  automatic.state = { ...automatic.state, armed: true, epoch: 1, owner: "native_dcu1", generation: 4 };
  setup(); await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  const checkbox = screen.getByRole("checkbox", { name: "Auto rotor" }) as HTMLInputElement;
  expect(checkbox.checked).toBe(true); expect(checkbox.disabled).toBe(false);
  fireEvent.click(checkbox); await act(async () => {});
  expect(automatic.set).toHaveBeenCalledExactlyOnceWith(false, undefined);
  expect(checkbox.checked).toBe(true); // Only native acknowledgement changes it.
});
it("rechecks freshness at click admission even before a new render commits", async () => {
  setup(); const checkbox = screen.getByRole("checkbox", { name: "Auto rotor" });
  const stale = syntheticMonitorContext(); stale.rotor.received_at_ms -= 6000;
  act(() => { changed(stale); fireEvent.click(checkbox); });
  expect(automatic.set).not.toHaveBeenCalled();
});
it("does not redirect a rejected Arm after native ownership changes and displays the error", async () => {
  automatic.set.mockRejectedValue(new Error("Rotor owner changed. Refresh before arming."));
  setup(); fireEvent.click(screen.getByRole("checkbox", { name: "Auto rotor" })); await act(async () => {});
  expect(screen.getByRole("alert").textContent).toContain("Rotor owner changed");
  const next = syntheticMonitorContext(); next.rotor.snapshot = { owner: "hamlib", generation: 8, state: "active", backend_available: true,
    backend: { fields: { position: { Azimuth: "53" } } } };
  act(() => changed(next));
  expect(automatic.set).toHaveBeenCalledTimes(1);
  expect((screen.getByRole("checkbox", { name: "Auto rotor" }) as HTMLInputElement).checked).toBe(false);
  automatic.set.mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole("checkbox", { name: "Auto rotor" })); await act(async () => {});
  expect(automatic.set).toHaveBeenLastCalledWith(true, expect.objectContaining({ owner: "hamlib", generation: 8 }));
});
it("keeps metadata/target errors separate and cleans up each independent stream", () => {
  const value = syntheticMonitorContext(), stopCore = vi.fn(), stopMap = vi.fn(), stopTarget = vi.fn();
  const view = render(<MonitorSurface connectCore={accept => { accept(value); return { refresh: vi.fn(), dispose: stopCore }; }}
    connectMap={(accept, fail) => { accept(syntheticMapContext()); fail("map failed"); return { refresh: vi.fn(), dispose: stopMap }; }}
    connectTarget={(_accept, fail) => { fail("target failed"); return { refresh: vi.fn(), dispose: stopTarget }; }} renderMap={() => <div>Map</div>} />);
  expect(screen.getByRole("button", { name: "Tune" }).hasAttribute("disabled")).toBe(false);
  view.unmount(); [stopCore, stopMap, stopTarget].forEach(stop => expect(stop).toHaveBeenCalledOnce());
});

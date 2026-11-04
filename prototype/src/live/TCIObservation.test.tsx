// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TCIObservation } from "./TCIObservation";
const native=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke:native.invoke,isTauri:()=>false}));
beforeEach(()=>vi.clearAllMocks());
afterEach(() => { cleanup(); vi.useRealTimers(); });
const snapshot = { source: "direct_tci", available: true, generated_at: 1000, radio: { connected: true, observed: true, observed_at: 1000, frequency_hz: 14025000, mode: "CW" }, station: { radio_stale: false } };
it("observes split independently and never infers TX frequency from receive or split", () => {
  const split = { ...snapshot, radio: { ...snapshot.radio, split: true }, tci: { trx: 0, channel: 1, split_observed_at: 1000 } };
  const view = render(<TCIObservation radioId="radio1" snapshot={split} now={1000000} />);
  expect(screen.getByText("Observed split: On")).toBeTruthy();
  expect(screen.getByText(/Saved TRX 0 · receive channel 1/)).toBeTruthy();
  expect(screen.getByText(/TX VFO and transmit frequency: Unavailable/)).toBeTruthy();
  view.rerender(<TCIObservation radioId="radio1" snapshot={{ ...split, generated_at: 1010, radio: { ...split.radio, observed_at: 1010 } }} now={1010000} />);
  expect(screen.getByText("Retained split: On · stale or unverified")).toBeTruthy();
  expect(screen.queryByText(/Observed split:/)).toBeNull();
  view.rerender(<TCIObservation radioId="radio1" snapshot={{ ...split, tci: { ...split.tci, split_observed_at: null } }} now={1000000} />);
  expect(screen.getByText("Retained split: On · stale or unverified")).toBeTruthy();
});
it("labels absent split unknown and stale false split retained", () => {
  const view = render(<TCIObservation radioId="radio1" snapshot={snapshot} now={1000000} />);
  expect(screen.getByText("Split: Unknown · no authoritative report")).toBeTruthy();
  view.rerender(<TCIObservation radioId="radio1" snapshot={{ ...snapshot, available: false, radio: { ...snapshot.radio, split: false }, tci: { split_observed_at: 1000 } }} now={1000000} />);
  expect(screen.getByText("Retained split: Off · stale or unverified")).toBeTruthy();
});
it("labels current versus retained data and ages without new native messages", () => {
  vi.useFakeTimers(); vi.setSystemTime(1000000);
  render(<TCIObservation radioId="radio1" snapshot={snapshot} />);
  expect(screen.getByText(/Observed receive: 14.025000 MHz/)).toBeTruthy();
  act(() => { vi.advanceTimersByTime(6000); });
  expect(screen.getByRole("status").textContent).toContain("unavailable or stale");
  expect(screen.getByText(/Retained receive: 14.025000 MHz/)).toBeTruthy();
  expect(screen.queryByText(/Observed receive:/)).toBeNull();
});
it.each([null, { ...snapshot, available: false }, { ...snapshot, station: { radio_stale: true } }, { ...snapshot, generated_at: null }])("never labels unavailable or unverified TCI values current", value => {
  render(<TCIObservation radioId="radio1" snapshot={value} now={1000000} />);
  expect(screen.getByRole("status").textContent).toContain("unavailable or stale");
  expect(screen.queryByText(/Observed receive:/)).toBeNull();
  expect((screen.getByRole("button", { name: "Apply receive filter" }) as HTMLButtonElement).disabled).toBe(true);
});
it("immediate disable uses one dedicated native coordinator after exact current connection lookup",async()=>{
  const value={...snapshot,generation:7};
  native.invoke.mockImplementation(async(method:string)=>method==="station_session_request"?{radio_id:"radio1",generation:"setup-generation",revision:4,selection:{provider:"direct_tci"},radio:{snapshot:{generation:7}}}:{message:"TCI permission disabled and saved."});
  render(<TCIObservation radioId="radio1" snapshot={value} now={1000000}/>);
  expect(native.invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Disable TCI transmit now"}));await act(async()=>{});
  expect(native.invoke.mock.calls).toEqual([
    ["station_session_request",{params:{action:"snapshot",radio_id:"radio1"}}],
    ["tci_transmit_disable",{radio_id:"radio1",connection_generation:7,generation:"setup-generation",revision:4,operation_id:expect.any(String)}],
  ]);
  expect(screen.getByRole("alert").textContent).toBe("TCI permission disabled and saved.");
});
it("immediate disable rejects a replacement connection before calling the native coordinator",async()=>{
  native.invoke.mockResolvedValue({radio_id:"radio1",generation:"setup-generation",revision:4,selection:{provider:"direct_tci"},radio:{snapshot:{generation:8}}});
  render(<TCIObservation radioId="radio1" snapshot={{...snapshot,generation:7}} now={1000000}/>);
  fireEvent.click(screen.getByRole("button",{name:"Disable TCI transmit now"}));await act(async()=>{});
  expect(native.invoke).toHaveBeenCalledTimes(1);expect(screen.getByRole("alert").textContent).toContain("connection changed");
});

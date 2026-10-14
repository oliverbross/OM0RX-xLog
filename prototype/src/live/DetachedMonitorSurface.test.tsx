// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MonitorSurface } from "./DetachedMonitorSurface";
import { syntheticMonitorContext } from "./monitorContextFixtures";
import type { MonitorContext } from "./monitorContext";
import { syntheticMapContext } from "./mapContextFixtures";
vi.mock("../Map", () => ({ default: () => <div>Optional map component</div> }));
let changed!: (value: MonitorContext) => void, failed!: (message: string) => void;
const noTarget = () => ({ refresh: vi.fn(), dispose: vi.fn() });
const map = (_changed: any, fail: (value: string) => void) => { fail("Synthetic metadata unavailable"); return { refresh: vi.fn(), dispose: vi.fn() }; };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-14T00:00:00Z")); });
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
  expect(screen.getByText("A: 14.074000")).toBeTruthy(); expect(screen.getByText("053°")).toBeTruthy();
  expect(screen.getByText("Optional map unavailable")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Standby" })); await act(async () => {});
  expect(view.radioAction).toHaveBeenCalledWith(expect.objectContaining({ selection: expect.objectContaining({ generation: 2 }) }), "standby");
  fireEvent.click(screen.getByRole("button", { name: "Stop" })); await act(async () => {});
  expect(view.rotorAction).toHaveBeenCalledWith(expect.anything(), "rotor_stop", {}); expect(view.refresh).toHaveBeenCalledTimes(2);
});
it("stale or failed observations disable TX and turn but retain explicit native Cancel and Stop", async () => {
  const view = setup();
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(screen.getByRole("button", { name: "Tune" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "Standby" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "Turn" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" })); fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  await act(async () => {});
  expect(view.radioAction).toHaveBeenCalledWith(expect.anything(), "cancel"); expect(view.rotorAction).toHaveBeenCalledWith(expect.anything(), "rotor_stop", {});
  act(() => failed("Retained context unavailable"));
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
it("isolated synthetic context remains read-only even if supplied connected observations advertise actions", () => {
  const value = syntheticMonitorContext(); value.acceptance = { synthetic: true, source: "synthetic_memory", externalOwners: false, readOnly: true };
  setup(value); expect(screen.getByText("Synthetic isolated observation · read only")).toBeTruthy();
  for (const name of ["Standby", "Tune", "Cancel", "Turn", "Stop"]) expect(screen.queryByRole("button", { name })).toBeNull();
});
it("keeps metadata/target errors separate and cleans up each independent stream", () => {
  const value = syntheticMonitorContext(), stopCore = vi.fn(), stopMap = vi.fn(), stopTarget = vi.fn();
  const view = render(<MonitorSurface connectCore={accept => { accept(value); return { refresh: vi.fn(), dispose: stopCore }; }}
    connectMap={(accept, fail) => { accept(syntheticMapContext()); fail("map failed"); return { refresh: vi.fn(), dispose: stopMap }; }}
    connectTarget={(_accept, fail) => { fail("target failed"); return { refresh: vi.fn(), dispose: stopTarget }; }} renderMap={() => <div>Map</div>} />);
  expect(screen.getByRole("button", { name: "Tune" }).hasAttribute("disabled")).toBe(false);
  view.unmount(); [stopCore, stopMap, stopTarget].forEach(stop => expect(stop).toHaveBeenCalledOnce());
});

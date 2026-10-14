// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StationControlSurface } from "./DetachedStationControlSurface";
import { syntheticMonitorContext } from "./monitorContextFixtures";
import type { MonitorContext } from "./monitorContext";
const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), worker: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
vi.mock("../worker", () => ({ workerRequest: native.worker }));

let changed: (value: MonitorContext) => void, failed: (message: string) => void;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-14T00:00:00Z")); vi.clearAllMocks();
  native.invoke.mockImplementation(async command => { if (command === "dock_detached_window") return; if (command !== "monitor_context_snapshot") throw new Error(`Unexpected native command: ${command}`); return syntheticMonitorContext(); });
  native.listen.mockResolvedValue(vi.fn());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
function setup(value = syntheticMonitorContext()) {
  const refresh = vi.fn(), dispose = vi.fn();
  const connect = (accept: typeof changed, reject: typeof failed) => { changed = accept; failed = reject; accept(value); return { refresh, dispose }; };
  return { ...render(<StationControlSurface connect={connect} />), refresh, dispose };
}
it("mounts and refreshes through retained native context only, without a worker request", async () => {
  const view = render(<StationControlSurface />);
  await act(async () => {});
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("monitor_context_snapshot");
  expect(screen.getByText("Observed live")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Refresh observations" }));
  await act(async () => {});
  expect(native.invoke.mock.calls.every(([command]) => command === "monitor_context_snapshot")).toBe(true);
  expect(native.invoke).toHaveBeenCalledTimes(2); expect(native.worker).not.toHaveBeenCalled();
  view.unmount();
});
it("renders retained station state with refresh and docking but no device controls", () => {
  const view = setup();
  expect(screen.getByRole("main", { name: "Detached Station Control" })).toBeTruthy();
  expect(screen.getByText("14.074000 MHz")).toBeTruthy();
  expect(screen.getByText("Observed live")).toBeTruthy();
  expect(screen.getAllByRole("button")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Refresh observations" }));
  expect(view.refresh).toHaveBeenCalledOnce();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  view.unmount(); expect(view.dispose).toHaveBeenCalledOnce();
});
it("expires observations and marks failures without claiming live PTT or SWR", () => {
  setup();
  act(() => { vi.advanceTimersByTime(6000); });
  expect(screen.queryByText("Observed live")).toBeNull();
  expect(screen.getByText(/Observation unavailable or stale/)).toBeTruthy();
  expect(screen.getByText("14.074000 MHz")).toBeTruthy();
  act(() => failed("Native observations unavailable"));
  expect(screen.getByRole("alert").textContent).toContain("Native observations unavailable");
  act(() => changed(syntheticMonitorContext()));
  expect(screen.queryByRole("alert")).toBeNull(); expect(screen.getByText("Observed live")).toBeTruthy();
});
it.each(["direct_flex_lan", "hamlib"] as const)("follows native %s ownership without defaulting to Agent", provider => {
  setup();
  const next = syntheticMonitorContext();
  next.selection = { provider, generation: 3, selection_id: crypto.randomUUID() };
  next.radio = { available: false, snapshot: null };
  act(() => changed(next));
  expect(screen.getByText(provider === "hamlib" ? /Local Hamlib/ : /Direct FLEX LAN/)).toBeTruthy();
  expect(screen.queryByText(/Remote Station Agent/)).toBeNull();
  expect(screen.queryByText("14.074000 MHz")).toBeNull();
  expect(screen.queryByText("Retained station safety")).toBeNull();
});
it("explains absent native selection and never initializes or connects it", () => {
  const value = syntheticMonitorContext(); value.selection = null; value.radio = { available: false, snapshot: null };
  setup(value);
  expect(screen.getByText(/No radio selected/)).toBeTruthy();
  expect(screen.getByText(/Connection setup, radio selection and station actions/)).toBeTruthy();
  expect(screen.getAllByRole("button")).toHaveLength(2);
});
it("labels isolated observations and remains passive even when actions are advertised", () => {
  const value = syntheticMonitorContext(); value.acceptance = { synthetic: true, source: "synthetic_memory", externalOwners: false, readOnly: true };
  setup(value);
  expect(screen.getByText("Synthetic isolated observation · read only")).toBeTruthy();
  expect(screen.getAllByRole("button")).toHaveLength(2);
});
it("docks through the existing native helper and prevents duplicate pending requests", async () => {
  let finish!: () => void;
  native.invoke.mockImplementation(async command => {
    if (command !== "dock_detached_window") throw new Error("Unexpected device request");
    return new Promise<void>(resolve => { finish = resolve; });
  });
  setup();
  const button = screen.getByRole("button", { name: "Dock back" });
  fireEvent.click(button); fireEvent.click(button);
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("dock_detached_window");
  expect(screen.getByRole("button", { name: "Docking…" }).hasAttribute("disabled")).toBe(true);
  await act(async () => finish());
  expect(screen.getByRole("button", { name: "Dock back" }).hasAttribute("disabled")).toBe(false);
  expect(native.worker).not.toHaveBeenCalled();
});
it("keeps dock failures visible across observation refresh and allows retry", async () => {
  native.invoke.mockRejectedValueOnce(new Error("Native docking failed")).mockResolvedValueOnce(undefined);
  const view = setup();
  fireEvent.click(screen.getByRole("button", { name: "Dock back" })); await act(async () => {});
  expect(screen.getByRole("alert").textContent).toContain("Could not dock Station Control");
  fireEvent.click(screen.getByRole("button", { name: "Refresh observations" }));
  act(() => changed(syntheticMonitorContext()));
  expect(view.refresh).toHaveBeenCalledOnce();
  expect(screen.getByRole("alert").textContent).toContain("This window remains open");
  fireEvent.click(screen.getByRole("button", { name: "Dock back" })); await act(async () => {});
  expect(native.invoke).toHaveBeenCalledTimes(2); expect(screen.queryByRole("alert")).toBeNull();
});

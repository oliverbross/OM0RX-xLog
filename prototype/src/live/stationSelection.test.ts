// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connectStationSelection, nativeStationSelection } from "./stationSelection";
const api = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), desktop: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke, isTauri: () => api.desktop }));
vi.mock("@tauri-apps/api/event", () => ({ listen: api.listen }));
let event: () => void;
const stop = vi.fn(), settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => {
  api.desktop = true; api.invoke.mockReset(); api.listen.mockReset(); stop.mockReset();
  api.invoke.mockResolvedValue({ provider: "hamlib", generation: 4 });
  api.listen.mockImplementation(async (_name, handler) => { event = handler; return stop; });
});
afterEach(() => vi.restoreAllMocks());
it("hydrates authoritative native choice, ignores stale generations and recovers on focus", async () => {
  const changed = vi.fn(), failed = vi.fn();
  const dispose = connectStationSelection("direct_agent", changed, failed)!; await settle();
  expect(changed).toHaveBeenCalledWith({ provider: "hamlib", generation: 4 });
  expect(api.invoke).toHaveBeenCalledWith("station_selection_snapshot", { legacy: "direct_agent" });
  api.invoke.mockResolvedValue({ provider: "direct_agent", generation: 3 }); event(); await settle();
  expect(changed).toHaveBeenCalledOnce();
  api.invoke.mockResolvedValue({ provider: "direct_flex_lan", generation: 5 }); window.dispatchEvent(new Event("focus")); await settle();
  expect(changed).toHaveBeenCalledTimes(2); expect(failed).not.toHaveBeenCalled(); dispose(); expect(stop).toHaveBeenCalledOnce();
});
it("does not fall back to browser state on native failure or malformed readback", async () => {
  const changed = vi.fn(), failed = vi.fn(); api.invoke.mockRejectedValue(new Error("Saved radio selection is invalid"));
  const dispose = connectStationSelection("direct_agent", changed, failed)!; await settle();
  expect(failed).toHaveBeenCalledWith("Saved radio selection is invalid"); expect(changed).not.toHaveBeenCalled();
  api.invoke.mockResolvedValue({ provider: "unknown", generation: 4 }); event(); await settle();
  expect(failed).toHaveBeenCalledTimes(2); expect(changed).not.toHaveBeenCalled(); dispose();
});
it("coalesces notifications and ignores replies after cleanup", async () => {
  let resolve!: (value: unknown) => void; api.invoke.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const changed = vi.fn(); const dispose = connectStationSelection(null, changed, vi.fn())!; await settle();
  for (let i = 0; i < 20; i++) event(); expect(api.invoke).toHaveBeenCalledOnce();
  dispose(); resolve({ provider: "hamlib", generation: 4 }); await settle(); expect(changed).not.toHaveBeenCalled();
});
it("late registration cannot hydrate and browser fixtures cannot invoke native handover", async () => {
  let resolve!: (value: () => void) => void; api.listen.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const dispose = connectStationSelection(null, vi.fn(), vi.fn())!; dispose(); resolve(stop); await settle();
  expect(stop).toHaveBeenCalledOnce(); expect(api.invoke).not.toHaveBeenCalled();
  api.desktop = false; expect(nativeStationSelection()).toBe(false); expect(connectStationSelection(null, vi.fn(), vi.fn())).toBeNull();
  expect(api.invoke).not.toHaveBeenCalled();
});

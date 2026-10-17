// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connectStationTelemetry } from "./stationTelemetry";
const api = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), desktop: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke, isTauri: () => api.desktop }));
vi.mock("@tauri-apps/api/event", () => ({ listen: api.listen }));
const projection = (revision: number) => ({ radio_id: "radio1", revision, available: true, provider: "direct_agent", received_at_ms: Date.now(), snapshot: { source: "direct_agent", radio: { observed: true, connected: true, frequency_hz: 14074000, mode: "FT8" } } });
let event: (event: { payload: unknown }) => void;
const stop = vi.fn();
beforeEach(() => {
  vi.useFakeTimers(); api.desktop = true; stop.mockReset(); api.invoke.mockReset(); api.listen.mockReset();
  api.invoke.mockResolvedValue(projection(1));
  api.listen.mockImplementation(async (_name, handler) => { event = handler; return stop; });
});
afterEach(() => vi.useRealTimers());
it("subscribes before reading and startup does not request a provider switch", async () => {
  const changed = vi.fn();
  api.invoke.mockResolvedValue(projection(3));
  const dispose = connectStationTelemetry("radio1", "direct_agent", changed, vi.fn())!; await vi.advanceTimersByTimeAsync(0);
  expect(api.invoke).toHaveBeenCalledWith("station_telemetry_snapshot", { radioId: "radio1", provider: "direct_agent" });
  expect(changed).toHaveBeenCalledOnce(); api.invoke.mockResolvedValue(projection(2)); event({ payload: projection(99) });
  await vi.advanceTimersByTimeAsync(0); expect(changed).toHaveBeenCalledOnce(); dispose();
});
it("fails closed on another provider, malformed source, unavailable and stale data", async () => {
  const changed = vi.fn(), failed = vi.fn(); const dispose = connectStationTelemetry("radio1", "direct_agent", changed, failed)!;
  await vi.advanceTimersByTimeAsync(0);
  for (const value of [{ ...projection(2), provider: "hamlib" },
    { ...projection(3), snapshot: { source: "direct_flex_lan" } }, { ...projection(4), available: false },
    { ...projection(5), received_at_ms: Date.now() - 6000 }]) {
    api.invoke.mockResolvedValue(value); event({ payload: null }); await vi.advanceTimersByTimeAsync(0);
  }
  expect(failed).toHaveBeenCalledTimes(4); expect(changed).toHaveBeenCalledOnce(); dispose();
});
it("projects Hamlib radio fields without reading the rotor", async () => {
  api.invoke.mockResolvedValue({ ...projection(1), provider: "hamlib", snapshot: { observed_at_ms: Date.now(), fields: { frequency: { Frequency: "7100000" }, mode: { Mode: "LSB" } } } });
  const changed = vi.fn(); const dispose = connectStationTelemetry("radio1", "hamlib", changed, vi.fn())!; await vi.advanceTimersByTimeAsync(0);
  expect(changed.mock.calls[0][0]).toMatchObject({ source: "hamlib", radio: { observed: true, frequency_hz: 7100000, mode: "LSB" }, station: { band: "40m" } });
  expect(api.invoke).toHaveBeenCalledOnce(); dispose();
});
it("times out a stalled stream, recovers on focus and cleans up", async () => {
  const failed = vi.fn(), changed = vi.fn(); const dispose = connectStationTelemetry("radio1", "direct_agent", changed, failed)!;
  await vi.advanceTimersByTimeAsync(7000); expect(failed).toHaveBeenCalledTimes(2); expect(api.invoke).toHaveBeenCalledOnce();
  api.invoke.mockResolvedValue(projection(2)); window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0);
  expect(changed).toHaveBeenCalledTimes(2); dispose(); event({ payload: projection(3) });
  await vi.advanceTimersByTimeAsync(10000); expect(changed).toHaveBeenCalledTimes(2); expect(stop).toHaveBeenCalledOnce();
});
it("late registration after unmount cannot start a service", async () => {
  let resolve!: (value: () => void) => void;
  api.listen.mockReturnValue(new Promise(done => { resolve = done; }));
  const dispose = connectStationTelemetry("radio1", "direct_agent", vi.fn(), vi.fn())!; dispose(); resolve(stop); await vi.advanceTimersByTimeAsync(0);
  expect(stop).toHaveBeenCalledOnce(); expect(api.invoke).not.toHaveBeenCalled();
});
it("native failure has no renderer fallback and browser fixtures do not invoke IPC", async () => {
  api.invoke.mockRejectedValue(new Error("isolated")); const failed = vi.fn();
  const dispose = connectStationTelemetry("radio1", "direct_agent", vi.fn(), failed)!; await vi.advanceTimersByTimeAsync(0); expect(failed).toHaveBeenCalledOnce(); dispose();
  api.desktop = false; expect(connectStationTelemetry("radio1", "hamlib", vi.fn(), vi.fn())).toBeNull(); expect(api.invoke).toHaveBeenCalledOnce();
});
it("coalesces wake-ups and discards a cached read crossing a local selection change", async () => {
  let resolve!: (value: unknown) => void, selection = 0;
  api.invoke.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const changed = vi.fn(); const dispose = connectStationTelemetry("radio1", "direct_agent", changed, vi.fn(), () => selection)!;
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 30; i++) event({ payload: null });
  expect(api.invoke).toHaveBeenCalledOnce(); selection++;
  resolve(projection(1)); await vi.advanceTimersByTimeAsync(0);
  expect(api.invoke).toHaveBeenCalledTimes(2); expect(changed).toHaveBeenCalledOnce(); dispose();
});

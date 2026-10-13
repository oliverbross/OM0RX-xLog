// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { connectRotorTelemetry } from "./rotorTelemetry";
const api = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), desktop: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke, isTauri: () => api.desktop }));
vi.mock("@tauri-apps/api/event", () => ({ listen: api.listen }));
const snapshot = { owner: "hamlib", generation: 1, state: "active", backend_available: true };
const projection = (revision: number) => ({ revision, available: true, snapshot, received_at_ms: Date.now() });
let event: (event: { payload: unknown }) => void;
const stop = vi.fn();
beforeEach(() => {
  vi.useFakeTimers(); api.desktop = true; stop.mockReset(); api.invoke.mockReset(); api.listen.mockReset();
  api.invoke.mockResolvedValue(projection(1));
  api.listen.mockImplementation(async (_name, handler) => { event = handler; return stop; });
});
afterEach(() => vi.useRealTimers());
it("subscribes before snapshot and ignores old or duplicate events", async () => {
  const changed = vi.fn(), failed = vi.fn();
  api.invoke.mockImplementation(async () => { event({ payload: projection(3) }); return projection(2); });
  const dispose = connectRotorTelemetry(changed, failed)!; await vi.advanceTimersByTimeAsync(0);
  expect(api.listen).toHaveBeenCalledWith("xlog:rotor-telemetry", expect.any(Function));
  expect(changed).toHaveBeenCalledOnce(); event({ payload: projection(3) }); event({ payload: projection(1) });
  expect(changed).toHaveBeenCalledOnce(); expect(failed).not.toHaveBeenCalled(); dispose();
});
it("marks unavailable without treating retained data as a fresh observation", async () => {
  const changed = vi.fn(), failed = vi.fn(); const dispose = connectRotorTelemetry(changed, failed)!;
  await vi.advanceTimersByTimeAsync(0);
  event({ payload: { ...projection(2), available: false } }); expect(failed).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledOnce();
  event({ payload: projection(3) }); expect(changed).toHaveBeenCalledTimes(2); dispose();
});
it("times out a stalled native stream without starting renderer polling", async () => {
  const failed = vi.fn(); const dispose = connectRotorTelemetry(vi.fn(), failed)!;
  await vi.advanceTimersByTimeAsync(7000); expect(failed).toHaveBeenCalledTimes(2); expect(api.invoke).toHaveBeenCalledOnce();
  event({ payload: projection(2) }); await vi.advanceTimersByTimeAsync(6000); expect(failed).toHaveBeenCalledTimes(3); dispose();
});
it("reads on focus, rejects malformed snapshots, and cleans up", async () => {
  const changed = vi.fn(), failed = vi.fn(); const dispose = connectRotorTelemetry(changed, failed)!;
  await vi.advanceTimersByTimeAsync(0); window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0);
  expect(api.invoke).toHaveBeenCalledTimes(2);
  event({ payload: { ...projection(4), snapshot: { ...snapshot, owner: "other" } } }); expect(failed).toHaveBeenCalledOnce();
  dispose(); event({ payload: projection(5) }); window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(10000);
  expect(stop).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledOnce(); expect(api.invoke).toHaveBeenCalledTimes(2);
});
it("cleans up late registration without starting the native owner", async () => {
  let resolve!: (value: () => void) => void;
  api.listen.mockReturnValue(new Promise(done => { resolve = done; }));
  const dispose = connectRotorTelemetry(vi.fn(), vi.fn())!; dispose(); resolve(stop); await vi.advanceTimersByTimeAsync(0);
  expect(stop).toHaveBeenCalledOnce(); expect(api.invoke).not.toHaveBeenCalled();
});
it("fails closed on native errors and leaves browser fixtures to their adapter", async () => {
  api.invoke.mockRejectedValue(new Error("isolated acceptance")); const failed = vi.fn();
  const dispose = connectRotorTelemetry(vi.fn(), failed)!; await vi.advanceTimersByTimeAsync(0); expect(failed).toHaveBeenCalledOnce(); dispose();
  api.desktop = false; expect(connectRotorTelemetry(vi.fn(), vi.fn())).toBeNull();
});
it("does not revive stale retained telemetry when a new window opens", async () => {
  api.invoke.mockResolvedValue({ ...projection(3), received_at_ms: Date.now() - 6000 });
  const changed = vi.fn(), failed = vi.fn(); const dispose = connectRotorTelemetry(changed, failed)!;
  await vi.advanceTimersByTimeAsync(0); expect(changed).not.toHaveBeenCalled(); expect(failed).toHaveBeenCalledOnce();
  event({ payload: projection(4) }); expect(changed).toHaveBeenCalledOnce(); dispose();
});

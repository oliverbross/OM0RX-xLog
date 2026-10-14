// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connectStationStatus } from "./stationStatus";
import type { MonitorContext } from "./monitorContext";
const context = (revision = 1): MonitorContext => ({ epoch: "00000000-0000-4000-8000-000000000001", revision, selection: null,
  radio: { available: false, snapshot: null }, rotor: { available: false, snapshot: null } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());

it("subscribes before reading once and never creates a timer poller", async () => {
  const reads = vi.fn(async () => context()), stops = [vi.fn(), vi.fn()];
  let index = 0;
  const listen = vi.fn(async (_name: string, _wake: () => void) => { expect(reads).not.toHaveBeenCalled(); return stops[index++]; });
  const changed = vi.fn(), dispose = connectStationStatus(changed, vi.fn(), vi.fn(), { read: reads, listen });
  await vi.advanceTimersByTimeAsync(0); expect(reads).toHaveBeenCalledOnce();
  expect(listen.mock.calls.map(call => call[0])).toEqual(["xlog:station-selection", "xlog:station-telemetry"]);
  await vi.advanceTimersByTimeAsync(20_000); expect(reads).toHaveBeenCalledOnce();
  dispose(); stops.forEach(stop => expect(stop).toHaveBeenCalledOnce());
});

it("immediately invalidates on a wake, coalesces notifications and drops reads crossing selection changes", async () => {
  const pending = deferred<MonitorContext>(), changed = vi.fn(), invalidated = vi.fn();
  const reads = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(context(2));
  let wake!: () => void;
  const dispose = connectStationStatus(changed, vi.fn(), invalidated, { read: reads,
    listen: async (_name, callback) => { wake = callback; return () => {}; } });
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 20; i++) wake();
  expect(reads).toHaveBeenCalledOnce(); expect(invalidated).toHaveBeenCalledTimes(20);
  pending.resolve(context(1)); await vi.advanceTimersByTimeAsync(0);
  expect(reads).toHaveBeenCalledTimes(2); expect(changed).toHaveBeenCalledExactlyOnceWith(context(2));
  dispose();
});

it("rejects malformed/synthetic observations and preserves failed-subscription warnings across reads", async () => {
  const changed = vi.fn(), failed = vi.fn(), read = vi.fn().mockResolvedValueOnce({ bad: true }).mockResolvedValueOnce(context(2));
  const dispose = connectStationStatus(changed, failed, vi.fn(), { read, listen: async () => { throw new Error("offline"); } });
  await vi.advanceTimersByTimeAsync(0); expect(changed).not.toHaveBeenCalled(); expect(failed).toHaveBeenCalled();
  window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0);
  expect(changed).toHaveBeenCalledOnce(); expect(failed.mock.calls.at(-1)?.[0]).toContain("notifications are unavailable");
  read.mockResolvedValue({ ...context(3), acceptance: { synthetic: true, source: "synthetic_memory", externalOwners: false, readOnly: true } });
  window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0); expect(changed).toHaveBeenCalledOnce();
  dispose();
});

it("late subscriptions after unmount cannot read or retain a listener", async () => {
  const first = deferred<() => void>(), second = deferred<() => void>(), read = vi.fn(), stop = vi.fn();
  const listen = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const dispose = connectStationStatus(vi.fn(), vi.fn(), vi.fn(), { read, listen }); dispose();
  first.resolve(stop); second.resolve(stop); await vi.advanceTimersByTimeAsync(0);
  expect(stop).toHaveBeenCalledTimes(2); expect(read).not.toHaveBeenCalled();
});

// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connectSyncChanges } from "./syncChanges";
beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());
it("subscribes to native, logbook and settings wakes before one initial refresh without a timer", async () => {
  const refresh = vi.fn(), stop = vi.fn(), wakes = new Map<string, () => void>();
  const dispose = connectSyncChanges(refresh, vi.fn(), { listen: async (name, wake) => { expect(refresh).not.toHaveBeenCalled(); wakes.set(name, wake); return stop; } });
  await vi.advanceTimersByTimeAsync(60_000); expect(refresh).toHaveBeenCalledOnce();
  expect([...wakes.keys()]).toEqual(["xlog:sync-changed", "xlog:logbook-changed", "xlog:settings-changed"]);
  wakes.get("xlog:sync-changed")!(); window.dispatchEvent(new Event("focus")); expect(refresh).toHaveBeenCalledTimes(3);
  dispose(); wakes.get("xlog:sync-changed")!(); expect(refresh).toHaveBeenCalledTimes(3); expect(stop).toHaveBeenCalledTimes(3);
});
it("reports partial notification failure honestly and retains focus recovery without polling", async () => {
  const refresh = vi.fn(), failed = vi.fn(), stop = vi.fn();
  const dispose = connectSyncChanges(refresh, failed, { listen: async name => { if (name === "xlog:sync-changed") throw Error("unavailable"); return stop; } });
  await vi.advanceTimersByTimeAsync(60_000); expect(refresh).toHaveBeenCalledOnce();
  expect(failed).toHaveBeenCalledWith(expect.stringContaining("no renderer polling fallback"));
  window.dispatchEvent(new Event("focus")); expect(refresh).toHaveBeenCalledTimes(2); dispose(); expect(stop).toHaveBeenCalledTimes(2);
});
it("disposes late subscriptions without a refresh after unmount", async () => {
  const pending: ((value: () => void) => void)[] = [], refresh = vi.fn(), stop = vi.fn();
  const dispose = connectSyncChanges(refresh, vi.fn(), { listen: () => new Promise(done => { pending.push(done); }) });
  dispose(); pending.forEach(done => done(stop)); await vi.advanceTimersByTimeAsync(0);
  expect(refresh).not.toHaveBeenCalled(); expect(stop).toHaveBeenCalledTimes(3);
});

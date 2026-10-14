// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connectPropagation } from "./propagationSession";
const frame = (revision = 0) => ({ epoch: "00000000-0000-4000-8000-000000000001", revision, pending: false, snapshot: null, error: "" });
beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());

it("subscribes before retained mount, never fetches on a timer and cleans up", async () => {
  const read = vi.fn(async (_action: "snapshot" | "refresh") => frame()), stop = vi.fn();
  const listen = vi.fn(async (_wake: () => void) => { expect(read).not.toHaveBeenCalled(); return stop; });
  const session = connectPropagation(vi.fn(), vi.fn(), { read, listen });
  await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(read.mock.calls).toEqual([["snapshot"]]); session.dispose(); expect(stop).toHaveBeenCalledOnce();
});
it("lost refresh replies only recover retained state and never retry a fetch", async () => {
  const read = vi.fn(async (action: "snapshot" | "refresh") => { if (action === "refresh") throw new Error("Reply lost"); return frame(); });
  const failed = vi.fn(), session = connectPropagation(vi.fn(), failed, { read, listen: async () => () => {} });
  await vi.advanceTimersByTimeAsync(0); await session.refresh(); await vi.advanceTimersByTimeAsync(0);
  expect(read.mock.calls.map(call => call[0])).toEqual(["snapshot", "refresh", "snapshot"]);
  expect(failed).toHaveBeenCalledWith("Reply lost"); session.dispose();
});
it("late old reads cannot replace a newer explicit refresh and notification storms coalesce", async () => {
  let complete!: (value: unknown) => void, wake!: () => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise(done => { complete = done; }))
    .mockImplementation(async () => frame(3));
  const changed = vi.fn(), session = connectPropagation(changed, vi.fn(), { read, listen: async callback => { wake = callback; return () => {}; } });
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 20; i++) wake();
  await session.refresh(); complete(frame(1)); await vi.advanceTimersByTimeAsync(0);
  expect(changed.mock.calls.every(call => call[0].revision === 3)).toBe(true);
  expect(read.mock.calls.filter(call => call[0] === "refresh")).toHaveLength(1);
  expect(read.mock.calls.filter(call => call[0] === "snapshot")).toHaveLength(2); session.dispose();
});
it("rejects unverified frames and disposes late subscriptions without reading", async () => {
  const failed = vi.fn();
  const first = connectPropagation(vi.fn(), failed, { read: async () => ({ ...frame(), revision: -1 }), listen: async () => () => {} });
  await vi.advanceTimersByTimeAsync(0); expect(failed).toHaveBeenCalled(); first.dispose();
  let registered!: (stop: () => void) => void; const stop = vi.fn(), read = vi.fn();
  const late = connectPropagation(vi.fn(), vi.fn(), { read, listen: () => new Promise(done => { registered = done; }) });
  late.dispose(); registered(stop); await vi.advanceTimersByTimeAsync(0);
  expect(read).not.toHaveBeenCalled(); expect(stop).toHaveBeenCalledOnce();
});

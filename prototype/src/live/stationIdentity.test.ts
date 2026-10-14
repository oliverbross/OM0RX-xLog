// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connectStationIdentity } from "./stationIdentity";
const frame = (revision = 0) => ({ epoch: "00000000-0000-4000-8000-000000000001", revision, available: false, snapshot: null });
beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());
it("subscribes before a retained read, never polls, and recovers the same revision on focus", async () => {
  const read = vi.fn(async () => frame()), stop = vi.fn(), changed = vi.fn();
  const dispose = connectStationIdentity(changed, vi.fn(), vi.fn(), { read, listen: async () => { expect(read).not.toHaveBeenCalled(); return stop; } });
  await vi.advanceTimersByTimeAsync(60_000); expect(read).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0);
  expect(changed).toHaveBeenCalledTimes(2); dispose(); expect(stop).toHaveBeenCalledOnce();
});
it("coalesces wakes and rejects reads crossing settings or worker changes", async () => {
  let finish!: (value: unknown) => void, wake!: () => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise(done => { finish = done; })).mockResolvedValue(frame(2));
  const changed = vi.fn(), invalidated = vi.fn();
  const dispose = connectStationIdentity(changed, vi.fn(), invalidated, { read, listen: async callback => { wake = callback; return () => {}; } });
  await vi.advanceTimersByTimeAsync(0); for (let i = 0; i < 20; i++) wake();
  expect(read).toHaveBeenCalledOnce(); finish(frame(1)); await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(2); expect(changed).toHaveBeenCalledExactlyOnceWith(frame(2));
  dispose(); wake(); expect(invalidated).toHaveBeenCalledTimes(20);
});
it("rejects private/unknown payloads and retains subscription warnings", async () => {
  const failed = vi.fn(), changed = vi.fn(), read = vi.fn(async () => ({ ...frame(), available: true, snapshot: { token: "not a public projection" } }));
  const dispose = connectStationIdentity(changed, failed, vi.fn(), { read, listen: async () => { throw new Error("offline"); } });
  await vi.advanceTimersByTimeAsync(0); expect(changed).not.toHaveBeenCalled(); expect(failed).toHaveBeenCalled(); dispose();
});
it("late listener registration after disposal cannot read or retain a listener", async () => {
  let registered!: (stop: () => void) => void; const read = vi.fn(), stop = vi.fn();
  const dispose = connectStationIdentity(vi.fn(), vi.fn(), vi.fn(), { read, listen: () => new Promise(done => { registered = done; }) });
  dispose(); registered(stop); await vi.advanceTimersByTimeAsync(0); expect(read).not.toHaveBeenCalled(); expect(stop).toHaveBeenCalledOnce();
});

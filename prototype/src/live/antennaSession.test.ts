// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connectAntenna } from "./antennaSession";
const frame = (revision = 0) => ({ epoch: "00000000-0000-4000-8000-000000000001", revision, available: false, snapshot: null });
beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());
it("subscribes before a passive read, never polls and recovers the same revision on focus", async () => {
  const read = vi.fn(async () => frame()), stop = vi.fn(), changed = vi.fn();
  const dispose = connectAntenna(changed, vi.fn(), vi.fn(), { read, listen: async () => { expect(read).not.toHaveBeenCalled(); return stop; } });
  await vi.advanceTimersByTimeAsync(60_000); expect(read).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(0);
  expect(changed).toHaveBeenCalledTimes(2); dispose(); expect(stop).toHaveBeenCalledOnce();
});
it("coalesces wakes and rejects reads crossing native changes or disposal", async () => {
  let finish!: (value: unknown) => void, wake!: () => void;
  const read = vi.fn().mockImplementationOnce(() => new Promise(done => { finish = done; })).mockResolvedValue(frame(2));
  const changed = vi.fn(), invalidated = vi.fn();
  const dispose = connectAntenna(changed, vi.fn(), invalidated, { read, listen: async callback => { wake = callback; return () => {}; } });
  await vi.advanceTimersByTimeAsync(0); for (let i = 0; i < 20; i++) wake();
  expect(read).toHaveBeenCalledOnce(); finish(frame(1)); await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(2); expect(changed).toHaveBeenCalledExactlyOnceWith(frame(2));
  dispose(); wake(); expect(invalidated).toHaveBeenCalledTimes(20);
});
it("rejects raw/private settings and incomplete profiles without defaulting", async () => {
  for (const payload of [{ ...frame(), settings: {} }, { ...frame(), available: true, snapshot: { antenna: "vertical" } }]) {
    const changed = vi.fn(), failed = vi.fn();
    const dispose = connectAntenna(changed, failed, vi.fn(), { read: async () => payload, listen: async () => () => {} });
    await vi.advanceTimersByTimeAsync(0); expect(changed).not.toHaveBeenCalled(); expect(failed).toHaveBeenCalled(); dispose();
  }
});
it("keeps notification failure honest and disposes late listener registration without reading", async () => {
  const failed = vi.fn(); const dispose = connectAntenna(vi.fn(), failed, vi.fn(), { read: async () => frame(), listen: async () => { throw Error("offline"); } });
  await vi.advanceTimersByTimeAsync(0); expect(failed).toHaveBeenCalledWith(expect.stringContaining("notifications unavailable")); dispose();
  let registered!: (stop: () => void) => void; const read = vi.fn(), stop = vi.fn();
  const late = connectAntenna(vi.fn(), vi.fn(), vi.fn(), { read, listen: () => new Promise(done => { registered = done; }) });
  late(); registered(stop); await vi.advanceTimersByTimeAsync(0); expect(read).not.toHaveBeenCalled(); expect(stop).toHaveBeenCalledOnce();
});

// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { connectMonitorContext, freshMonitorProjection, monitorRadioAction, monitorRadioFresh, monitorRotorAction, monitorStation, validMonitorContext } from "./monitorContext";
import { syntheticMonitorContext } from "./monitorContextFixtures";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-14T00:00:00Z")); });
afterEach(() => vi.useRealTimers());
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

it("validates context, permits an unset radio, and never freshens original receipt times", () => {
  const context = syntheticMonitorContext(); expect(validMonitorContext(context)).toBe(true); expect(monitorRadioFresh(context)).toBe(true);
  const before = JSON.stringify(context); vi.setSystemTime(Date.now() + 6000);
  expect(monitorRadioFresh(context)).toBe(false); expect(monitorStation(context).station.swr_is_live).toBe(false);
  expect(JSON.stringify(context)).toBe(before);
  context.selection = { provider: null, generation: 0, selection_id: null }; context.radio = { available: false, snapshot: null };
  expect(validMonitorContext(context)).toBe(true); expect(monitorStation(context).source).toBe("unselected");
  for (const invalid of [{ ...context, revision: true }, { ...context, epoch: "bad" }, { ...context, selection: { provider: "direct_agent", generation: 0, selection_id: null } }])
    expect(validMonitorContext(invalid)).toBe(false);
});
it("rejects old/future/provider/selection-identity observations independently of rotor freshness", () => {
  for (const alter of [(value: any) => value.radio.received_at_ms -= 6000, (value: any) => value.radio.received_at_ms += 2000,
    (value: any) => value.radio.provider = "hamlib", (value: any) => value.radio.selection_id = crypto.randomUUID(),
    (value: any) => value.selection.generation++, (value: any) => value.radio.snapshot.generated_at -= 10]) {
    const context = syntheticMonitorContext(); alter(context); expect(monitorRadioFresh(context)).toBe(false);
    expect(freshMonitorProjection(context.rotor)).toBe(true); expect(monitorStation(context).rotor.connected).toBe(true);
  }
});
it("sends only the four scoped radio intents with captured native identity", async () => {
  const context = syntheticMonitorContext(), call = vi.fn().mockResolvedValue({ ok: true, result: { accepted: true } });
  await monitorRadioAction(context, "tune", call);
  expect(call).toHaveBeenCalledExactlyOnceWith("monitor_station_action", { provider: "direct_agent", expected: 2, selectionId: context.selection!.selection_id, action: "tune" });
  for (const action of ["connect", "ptt", "rotor_goto", "", undefined]) await expect(monitorRadioAction(context, action, call)).rejects.toThrow();
  context.radio.snapshot.allow_transmit = false; await expect(monitorRadioAction(context, "tune", call)).rejects.toThrow();
  expect(call).toHaveBeenCalledOnce();
});
it("allows only cancellation when the selection remains known but observations are stale or absent", async () => {
  const context = syntheticMonitorContext(), call = vi.fn().mockResolvedValue({ ok: true, result: { accepted: true } });
  context.radio = { available: false, snapshot: null };
  await expect(monitorRadioAction(context, "operate", call)).rejects.toThrow();
  await monitorRadioAction(context, "cancel", call); expect(call).toHaveBeenCalledOnce();
  context.acceptance = { synthetic: true, source: "synthetic_memory", externalOwners: false, readOnly: true };
  await expect(monitorRadioAction(context, "cancel", call)).rejects.toThrow(); expect(call).toHaveBeenCalledOnce();
});
it("does not retry an uncertain radio action", async () => {
  const call = vi.fn().mockRejectedValue(new Error("Lost acknowledgement"));
  await expect(monitorRadioAction(syntheticMonitorContext(), "tune", call)).rejects.toThrow("Lost acknowledgement"); expect(call).toHaveBeenCalledOnce();
});
it("fences rotor motion by owner/generation and observes but never replays a lost motion reply", async () => {
  const context = syntheticMonitorContext(), snapshot = context.rotor.snapshot;
  const request = vi.fn(async (method: string) => { if (method === "rotor_goto") throw new Error("lost reply"); return snapshot; });
  await expect(monitorRotorAction(context, "rotor_goto", { bearing: 90 }, request)).rejects.toThrow("lost reply");
  expect(request.mock.calls.map(([method]) => method)).toEqual(["rotor_snapshot", "rotor_goto", "rotor_snapshot"]);
  request.mockResolvedValue({ ...snapshot, owner: "hamlib" });
  await expect(monitorRotorAction(context, "rotor_goto", { bearing: 90 }, request)).rejects.toThrow("ownership changed");
});
it("sends stale-owner Stop only through native current-owner admission without a preceding read or retry", async () => {
  const context = syntheticMonitorContext(); context.rotor.available = false; context.rotor.received_at_ms -= 60000;
  const request = vi.fn(), stop = vi.fn().mockRejectedValue(new Error("lost Stop acknowledgement"));
  await expect(monitorRotorAction(context, "rotor_stop", {}, request, stop)).rejects.toThrow("lost Stop acknowledgement");
  expect(stop).toHaveBeenCalledExactlyOnceWith("native_dcu1"); expect(request).not.toHaveBeenCalled();
  await expect(monitorRotorAction(context, "rotor_goto", { bearing: 90 }, request, stop)).rejects.toThrow();
});
it("coalesces wake reads, rejects replies crossing a wake and discards disposed reads", async () => {
  const held = deferred<unknown>(), events: Record<string, () => void> = {}, stops = [vi.fn(), vi.fn(), vi.fn()];
  const first = syntheticMonitorContext(), next = { ...first, revision: 2 };
  const read = vi.fn().mockReturnValueOnce(held.promise).mockResolvedValue(next), changed = vi.fn(), failed = vi.fn();
  const connection = connectMonitorContext(changed, failed, { read, listen: async (name, wake) => { events[name] = wake; return stops[Object.keys(events).length - 1]; } });
  await vi.advanceTimersByTimeAsync(0); expect(read).toHaveBeenCalledOnce();
  for (let index = 0; index < 20; index++) events["xlog:station-selection"]();
  held.resolve(first); await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(2); expect(changed).toHaveBeenCalledExactlyOnceWith(next);
  connection.dispose(); events["xlog:rotor-telemetry"](); window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(3000); expect(read).toHaveBeenCalledTimes(2); stops.forEach(stop => expect(stop).toHaveBeenCalledOnce());
});
it("continues retained reads after subscription failure and never resurrects a late unmounted result", async () => {
  const held = deferred<unknown>(), changed = vi.fn(), failed = vi.fn(), dispose = vi.fn();
  const read = vi.fn().mockReturnValue(held.promise);
  const connection = connectMonitorContext(changed, failed, { read, listen: async name => { if (name.includes("selection")) throw new Error("listener failed"); return dispose; } });
  await vi.advanceTimersByTimeAsync(0); expect(failed).toHaveBeenCalled(); expect(read).toHaveBeenCalledOnce();
  connection.dispose(); held.resolve(syntheticMonitorContext()); await vi.advanceTimersByTimeAsync(0);
  expect(changed).not.toHaveBeenCalled(); expect(dispose).toHaveBeenCalledTimes(2);
});
it("cleans late listener registrations without starting an obsolete reader", async () => {
  const held = deferred<() => void>(), stop = vi.fn(), read = vi.fn();
  const connection = connectMonitorContext(vi.fn(), vi.fn(), { read, listen: () => held.promise });
  connection.dispose(); held.resolve(stop); await vi.advanceTimersByTimeAsync(0);
  expect(read).not.toHaveBeenCalled(); expect(stop).toHaveBeenCalledTimes(3);
});

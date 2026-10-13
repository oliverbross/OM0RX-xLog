// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const bridge = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), events: new Map<string, () => void>(), stops: [] as ReturnType<typeof vi.fn>[] }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: bridge.listen }));
import { connectMapContext, mapClusterFresh, mapRadioFrequency, validMapContext } from "./mapContext";
import { syntheticMapContext } from "./mapContextFixtures";
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
beforeEach(() => {
  vi.useFakeTimers(); bridge.invoke.mockReset(); bridge.listen.mockReset(); bridge.events.clear(); bridge.stops.length = 0;
  bridge.listen.mockImplementation(async (event, callback) => { bridge.events.set(event, callback); const stop = vi.fn(); bridge.stops.push(stop); return stop; });
});
afterEach(() => { vi.useRealTimers(); });
describe("native map context", () => {
  it("validates metadata and only displays positive fresh matching observed RX frequency", () => {
    const current = syntheticMapContext(); expect(validMapContext(current)).toBe(true);
    expect(mapRadioFrequency(current)).toBe(14025000);
    for (const value of [NaN, -1, Infinity, 0]) { const bad = structuredClone(current); bad.radio.snapshot.radio.frequency_hz = value; expect(mapRadioFrequency(bad)).toBeUndefined(); }
    for (const age of [6000, -2000]) { const bad = structuredClone(current); bad.radio.received_at_ms = Date.now() - age; expect(mapRadioFrequency(bad)).toBeUndefined(); }
    const wrong = structuredClone(current); wrong.selection.provider = "hamlib"; expect(mapRadioFrequency(wrong)).toBeUndefined();
    const unavailable = structuredClone(current); unavailable.radio.available = false; expect(mapRadioFrequency(unavailable)).toBeUndefined();
    expect(validMapContext({ ...current, metadata: { ...current.metadata, home: { lat: 91, lon: 0 } } })).toBe(false);
    expect(validMapContext({ ...current, revision: -1 })).toBe(false);
  });
  it("does not refresh source freshness merely because aggregate reads or local selection advance", () => {
    const old = syntheticMapContext(Date.now() - 6000);
    old.revision = 100; old.cluster.revision = 100;
    expect(validMapContext(old)).toBe(true); expect(mapClusterFresh(old)).toBe(false);
    old.cluster.received_at_ms = Date.now(); expect(mapClusterFresh(old)).toBe(true);
    old.cluster.received_at_ms = Date.now() + 2000; expect(mapClusterFresh(old)).toBe(false);
  });
  it("serializes wake/poll reads and ignores an older response superseded by a wake", async () => {
    const old = syntheticMapContext(), fresh = { ...old, revision: 2 };
    let finish: ((value: unknown) => void) | undefined;
    bridge.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(fresh);
    const changed = vi.fn(), failed = vi.fn(), connection = connectMapContext(changed, failed);
    await flush(); expect(bridge.invoke).toHaveBeenCalledTimes(1);
    bridge.events.get("xlog:map-context")?.(); bridge.events.get("xlog:station-telemetry")?.();
    expect(bridge.invoke).toHaveBeenCalledTimes(1);
    finish?.(old); await flush();
    expect(changed).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledWith(fresh);
    expect(bridge.invoke).toHaveBeenCalledTimes(2); expect(failed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500); expect(bridge.invoke).toHaveBeenCalledTimes(3);
    connection.dispose(); expect(bridge.stops.every(stop => stop.mock.calls.length === 1)).toBe(true);
  });
  it("surfaces malformed/error replies, recovers, and never publishes after disposal", async () => {
    bridge.invoke.mockResolvedValueOnce({}).mockResolvedValueOnce(syntheticMapContext());
    const changed = vi.fn(), failed = vi.fn(), connection = connectMapContext(changed, failed);
    await flush(); expect(failed).toHaveBeenCalledOnce(); expect(changed).not.toHaveBeenCalled();
    connection.refresh(); await flush(); expect(changed).toHaveBeenCalledOnce();
    connection.dispose(); await vi.advanceTimersByTimeAsync(5000); expect(bridge.invoke).toHaveBeenCalledTimes(2);
    expect(bridge.invoke.mock.calls.every(([method]) => method === "map_context_snapshot")).toBe(true);
  });
});

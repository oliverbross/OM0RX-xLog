// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
const transport = vi.hoisted(() => ({ invoke: vi.fn(), emitTo: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: transport.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ emitTo: transport.emitTo, listen: transport.listen }));
import { announceDetachedReady, findDetachedSpot, onDetachedProjection, onDetachedReady,
  onDetachedSpot, openDetachedMap, publishDetachedProjection, requestDetachedSpot,
  announceMonitorReady, onMonitorProjection, onMonitorReady, publishMonitorProjection,
  validMonitorProjection } from "../src/worker";

beforeEach(() => {
  transport.invoke.mockReset().mockResolvedValue(undefined);
  transport.emitTo.mockReset().mockResolvedValue(undefined);
  transport.listen.mockReset().mockResolvedValue(vi.fn());
});

describe("main-owned monitor projection", () => {
  it("accepts a matched station provider and rejects malformed or mismatched state", async () => {
    const valid = { spots: [{ id: "real-spot" }], station: { source: "hamlib", radio: { connected: true } },
      provider: "hamlib" as const, controlsEnabled: true, selected: "real-spot",
      home: { lat: -12.4, lon: 130.8 }, target: { call: "EA7EU", lat: 37, lon: -6 } };
    expect(validMonitorProjection(valid)).toBe(true);
    expect(validMonitorProjection({ ...valid, provider: "direct_agent" })).toBe(false);
    expect(validMonitorProjection({ ...valid, spots: "not a spot list" })).toBe(false);
    expect(validMonitorProjection({ ...valid, controlsEnabled: "yes" })).toBe(false);
    const receiver = vi.fn(); await onMonitorProjection(receiver);
    const callback = transport.listen.mock.calls[0][1];
    callback({ payload: { ...valid, provider: "direct_agent" } });
    expect(receiver).not.toHaveBeenCalled();
    callback({ payload: valid });
    expect(receiver).toHaveBeenCalledWith(valid);
    await publishMonitorProjection(valid);
    expect(transport.emitTo).toHaveBeenCalledWith("monitor", "xlog:monitor-projection", valid);
    await announceMonitorReady();
    expect(transport.emitTo).toHaveBeenCalledWith("main", "xlog:monitor-ready", null);
    await onMonitorReady(vi.fn());
    expect(transport.listen).toHaveBeenCalledWith("xlog:monitor-ready", expect.any(Function));
  });
});

describe("detached map boundary", () => {
  it("opens only fixed native map labels", async () => {
    await openDetachedMap("world-map");
    await openDetachedMap("band-maps");
    expect(transport.invoke.mock.calls).toEqual([["open_detached_map", { kind: "world-map" }], ["open_detached_map", { kind: "band-maps" }]]);
    await expect(openDetachedMap("monitor" as never)).rejects.toThrow("Unknown map window");
    expect(transport.invoke).toHaveBeenCalledTimes(2);
  });

  it("sends only a spot ID to main, then resolves only a current real spot", async () => {
    await requestDetachedSpot("world-map", "spot-2");
    expect(transport.emitTo).toHaveBeenCalledWith("main", "xlog:detached-spot", { kind: "world-map", spotId: "spot-2" });
    const current = [{ id: "spot-1", callsign: "OM0RX" }, { id: "spot-2", callsign: "EA7EU" }];
    expect(findDetachedSpot({ kind: "world-map", spotId: "spot-2" }, current)).toBe(current[1]);
    expect(findDetachedSpot({ kind: "world-map", spotId: "stale" }, current)).toBeNull();
    expect(findDetachedSpot({ kind: "monitor", spotId: "spot-2" }, current)).toBeNull();
    expect(findDetachedSpot({ kind: "band-maps", spotId: 2 }, current)).toBeNull();
    expect(findDetachedSpot({ kind: "band-maps", spotId: "spot-2" }, [] )).toBeNull();
  });

  it("subscribes to projections and releases listeners on cleanup", async () => {
    const stop = vi.fn(); transport.listen.mockResolvedValue(stop);
    const projection = vi.fn(); const unlisten = await onDetachedProjection(projection);
    expect(transport.listen).toHaveBeenCalledWith("xlog:detached-projection", expect.any(Function));
    const handler = transport.listen.mock.calls[0][1];
    handler({ payload: { spots: [{ id: "spot-1" }] } });
    expect(projection).toHaveBeenCalledWith({ spots: [{ id: "spot-1" }] });
    unlisten(); expect(stop).toHaveBeenCalledOnce();
    await announceDetachedReady("band-maps");
    expect(transport.emitTo).toHaveBeenCalledWith("main", "xlog:detached-ready", "band-maps");
    await publishDetachedProjection("band-maps", { spots: [] });
    expect(transport.emitTo).toHaveBeenCalledWith("band-maps", "xlog:detached-projection", { spots: [] });
  });

  it("ignores unknown ready messages and exposes selection listener cleanup", async () => {
    const stop = vi.fn(); transport.listen.mockResolvedValue(stop);
    const ready = vi.fn(); const selection = vi.fn();
    const unready = await onDetachedReady(ready); const unselect = await onDetachedSpot(selection);
    transport.listen.mock.calls[0][1]({ payload: "untrusted" });
    transport.listen.mock.calls[0][1]({ payload: "world-map" });
    transport.listen.mock.calls[1][1]({ payload: { kind: "world-map", spotId: "spot-1" } });
    expect(ready).toHaveBeenCalledOnce();
    expect(selection).toHaveBeenCalledWith({ kind: "world-map", spotId: "spot-1" });
    unready(); unselect(); expect(stop).toHaveBeenCalledTimes(2);
  });
});

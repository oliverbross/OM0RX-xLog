// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeferredPanelReads, useDeferredPanelReads } from "./deferredPanelReads";
import AwardsPanel from "./AwardsPanel";
import OpportunitiesPanel from "./OpportunitiesPanel";

const params = { offset: 0, limit: 5, search: "", delivery_state: "" };
const snapshot = { generated_at: "2026-10-17T00:00:00Z", items: [], sources: [], total_available: 0, history_state: "ready" };
const catalogue = { total_programmes: 0, catalogue_total: 192, programmes: [], items: [] };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function scheduledFrames() {
  let next = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { callbacks.set(++next, callback); return next; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => callbacks.delete(id)));
  return () => { const batch = [...callbacks.values()]; callbacks.clear(); batch.forEach(callback => callback(0)); };
}

describe("deferred local panel reads", () => {
  it("moves a 500ms local read before navigation and avoids all three calls on a second visit", async () => {
    vi.useFakeTimers();
    const request = vi.fn((method: string) => new Promise(resolve => window.setTimeout(() => resolve({
      ...snapshot, generated_at: new Date(Date.now()).toISOString(),
    }), method === "opportunities_snapshot" ? 500 : 100)));
    const reads = createDeferredPanelReads(request);
    reads.warm();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    const first = render(<OpportunitiesPanel request={reads.request} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("0 matching · 0 available")).toBeTruthy();
    expect(request.mock.calls.filter(([method]) => method === "opportunities_snapshot")).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    first.unmount();
    const calls = request.mock.calls.length;
    render(<OpportunitiesPanel request={reads.request} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("0 matching · 0 available")).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(calls);
    expect(request.mock.calls.filter(([method]) => method === "opportunities_refresh")).toHaveLength(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(request.mock.calls.filter(([method]) => method === "opportunities_refresh")).toHaveLength(4);
  });

  it("shares pending feed work across navigation and retains the newest projection", async () => {
    const finishes = new Map<string, (value: unknown) => void>();
    const request = vi.fn((method: string, params?: Record<string, unknown>) =>
      new Promise(resolve => { finishes.set(String(params?.source ?? method), resolve); }));
    const reads = createDeferredPanelReads(request);
    const priority = reads.request("opportunities_refresh", { source: "pota", automatic: true });
    expect(reads.request("opportunities_refresh", { source: "pota", automatic: true })).toBe(priority);
    const all = reads.request("opportunities_refresh", { source: "all", automatic: true });
    const newest = { ...snapshot, generated_at: "2026-10-17T00:00:02Z" };
    finishes.get("all")!(newest); await all;
    finishes.get("pota")!(snapshot); await priority;
    expect(await reads.request("opportunities_snapshot")).toBe(newest);
    expect(await reads.request("opportunities_refresh", { source: "pota", automatic: true })).toBe(newest);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not grant slow reads another freshness interval and retries rejected automatic refreshes", async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockImplementationOnce(() => new Promise(resolve => window.setTimeout(() => resolve(snapshot), 20_000)))
      .mockResolvedValueOnce(snapshot).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(snapshot);
    const reads = createDeferredPanelReads(request);
    const first = reads.request("opportunities_snapshot");
    await vi.advanceTimersByTimeAsync(20_000); await first;
    await reads.request("opportunities_snapshot");
    expect(request).toHaveBeenCalledTimes(2);
    await expect(reads.request("opportunities_refresh", { source: "all", automatic: true })).rejects.toThrow("offline");
    await reads.request("opportunities_refresh", { source: "all", automatic: true });
    expect(request).toHaveBeenCalledTimes(4);
    await reads.request("opportunities_refresh", { source: "all", automatic: false });
    expect(request).toHaveBeenCalledTimes(5);
    await reads.request("opportunities_snapshot");
    expect(request).toHaveBeenCalledTimes(5);
  });

  it("waits for desk paint and idle time, without mounting either panel or refreshing feeds", async () => {
    const frame = scheduledFrames();
    let idle!: IdleRequestCallback;
    vi.stubGlobal("requestIdleCallback", vi.fn((callback: IdleRequestCallback) => { idle = callback; return 1; }));
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    const request = vi.fn(async (method: string) => method === "opportunities_snapshot" ? snapshot : catalogue);
    function Desk() { useDeferredPanelReads(request, 0, true); return <main>Operator Desk</main>; }
    render(<Desk />);
    expect(request).not.toHaveBeenCalled();
    act(frame); expect(request).not.toHaveBeenCalled();
    act(frame); expect(request).not.toHaveBeenCalled();
    await act(async () => { idle({ didTimeout: false, timeRemaining: () => 50 }); });
    expect(request.mock.calls.map(([method]) => method)).toEqual(["opportunities_snapshot", "logbook_catalog"]);
    expect(screen.queryByRole("region", { name: "Chaser and DX calendar" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Station intelligence" })).toBeNull();
  });

  it("cancels idle work on navigation and invalidates retained data after a mutation", async () => {
    const frame = scheduledFrames();
    const idles = new Map<number, IdleRequestCallback>();
    let next = 0, panelRequest!: ReturnType<typeof createDeferredPanelReads>["request"];
    vi.stubGlobal("requestIdleCallback", vi.fn((callback: IdleRequestCallback) => { idles.set(++next, callback); return next; }));
    vi.stubGlobal("cancelIdleCallback", vi.fn((id: number) => idles.delete(id)));
    const request = vi.fn(async () => catalogue);
    function Desk({ enabled, revision }: { enabled: boolean; revision: number }) {
      panelRequest = useDeferredPanelReads(request, revision, enabled); return null;
    }
    const view = render(<Desk enabled revision={0} />);
    act(frame); act(frame);
    view.rerender(<Desk enabled={false} revision={0} />);
    expect(idles.size).toBe(0); expect(request).not.toHaveBeenCalled();
    view.rerender(<Desk enabled revision={0} />);
    act(frame); act(frame);
    await act(async () => { idles.get(next)!({ didTimeout: false, timeRemaining: () => 50 }); });
    expect(request).toHaveBeenCalledTimes(2);
    view.rerender(<Desk enabled={false} revision={1} />);
    await panelRequest("logbook_catalog", params);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("coalesces pending warm reads, retains local results and leaves filtered reads fresh", async () => {
    let finish!: (value: unknown) => void;
    const request = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const reads = createDeferredPanelReads(request);
    const first = reads.request("opportunities_snapshot");
    expect(reads.request("opportunities_snapshot")).toBe(first);
    finish(snapshot); await first; await Promise.resolve();
    expect(reads.request("opportunities_snapshot")).toBe(first);
    const local = vi.fn(async () => catalogue), warmed = createDeferredPanelReads(local);
    warmed.warm(); await Promise.resolve();
    await warmed.request("logbook_catalog", params);
    expect(local).toHaveBeenCalledTimes(2);
    await warmed.request("logbook_catalog", params);
    await warmed.request("logbook_catalog", { ...params, search: "CW" });
    expect(local).toHaveBeenCalledTimes(3);
  });

  it("joins an unfinished warmup and expires old retained Chaser activity", async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    const request = vi.fn((method: string) => method === "opportunities_snapshot"
      ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(catalogue));
    const reads = createDeferredPanelReads(request);
    reads.warm();
    const first = reads.request("opportunities_snapshot"), second = reads.request("opportunities_snapshot");
    expect(first).toBe(second); expect(request).toHaveBeenCalledTimes(2);
    finish(snapshot); await first;
    const fresh = vi.fn(async () => snapshot), old = createDeferredPanelReads(fresh);
    old.warm(); await Promise.resolve();
    vi.advanceTimersByTime(15_000);
    await old.request("opportunities_snapshot");
    expect(fresh).toHaveBeenCalledTimes(3);
  });

  it("retries failed warmup and preserves visible panel refresh behavior", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "opportunities_snapshot") return snapshot;
      if (method === "opportunities_refresh") return snapshot;
      if (method === "logbook_stats") return { awards: { qso_count: 0 } };
      return catalogue;
    });
    const reads = createDeferredPanelReads(request);
    reads.warm(); await Promise.resolve();
    const view = render(<><OpportunitiesPanel request={reads.request} /><AwardsPanel request={reads.request} refresh={0} /></>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("192")).toBeTruthy();
    expect(request.mock.calls.filter(([method]) => method === "opportunities_snapshot")).toHaveLength(1);
    expect(request.mock.calls.filter(([method]) => method === "logbook_catalog")).toHaveLength(1);
    expect(request.mock.calls.filter(([method]) => method === "opportunities_refresh")).toHaveLength(2);
    view.unmount();
    const fail = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(catalogue);
    const retry = createDeferredPanelReads(fail);
    retry.warm(); await Promise.resolve();
    await retry.request("opportunities_snapshot");
    expect(fail).toHaveBeenCalledTimes(3);
  });
});

// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Conditions from "./Conditions";
import OpportunitiesPanel from "./OpportunitiesPanel";
import { SpotHistoryPanel } from "./SpotHistoryPanel";
import { createDeferredPanelReads, useDeferredPanelReads } from "./deferredPanelReads";
import { LogbookPanel } from "./LogbookPanel";
import { LogbookMutationSession } from "./logbookMutationSession";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear(); });
const opportunities = { generated_at: "2026-11-01T00:00:00Z", items: [], sources: [], total_available: 0, history_state: "ready" };
const weather = { temperature_c: 21, condition: "Clear", wind_kmh: 4, source: "Open-Meteo" };
function visibility() {
  let visible = true;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visible ? "visible" : "hidden");
  return async (next: boolean) => { visible = next; await act(async () => document.dispatchEvent(new Event("visibilitychange"))); };
}

it("spends no Chaser/feed refresh budget while hidden and rereads on return", async () => {
  vi.useFakeTimers(); const visible = visibility();
  const request = vi.fn(async () => opportunities);
  render(<OpportunitiesPanel request={request} />);
  await act(async () => {}); expect(request).toHaveBeenCalledTimes(3);
  await visible(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(180_000); });
  expect(request).toHaveBeenCalledTimes(3);
  expect(screen.getByText("0 matching · 0 available")).toBeTruthy();
  await visible(true); expect(request).toHaveBeenCalledTimes(6);
});

it("retains weather through hiding, rejects a retired reply, and refreshes on return", async () => {
  vi.useFakeTimers(); const visible = visibility();
  let finish!: (value: unknown) => void;
  const request = vi.fn().mockResolvedValueOnce(weather)
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue(weather);
  render(<Conditions request={request} propagation={null} weatherKey="JN88TQ" />);
  await act(async () => {});
  await act(async () => { await vi.advanceTimersByTimeAsync(900_000); });
  expect(request).toHaveBeenCalledTimes(2);
  await visible(false);
  await act(async () => { finish({ ...weather, temperature_c: -15 }); await vi.advanceTimersByTimeAsync(1_800_000); });
  expect(request).toHaveBeenCalledTimes(2);
  expect(screen.getByText("21°C · Clear · 4 km/h")).toBeTruthy();
  await visible(true); expect(request).toHaveBeenCalledTimes(3);
});

it("pauses Spot History status polling without clearing its retained archive page", async () => {
  vi.useFakeTimers(); const visible = visibility();
  const request = vi.fn(async (method: string) => {
    if (method === "spot_history_status") return { recording: { state: "idle", queued: 0, unrecorded: 0, startedAt: "2026-11-01T00:00:00Z", connections: [] }, status: null };
    if (method === "spot_history_query") return { page: { rows: [], nextCursor: null, watermark: 0, revision: 0 } };
    return { stats: { total: 0, distinctCalls: 0, distinctSpotters: 0, bands: [], modes: [], countries: [], sources: [], spotters: [], hourly: [], watermark: 0, revision: 0 } };
  });
  render(<SpotHistoryPanel request={request} />); await act(async () => {});
  await visible(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(request.mock.calls.filter(([method]) => method === "spot_history_status")).toHaveLength(1);
  await visible(true);
  expect(request.mock.calls.filter(([method]) => method === "spot_history_status")).toHaveLength(2);
});

it("warms only twenty rows, shares the pending read and invalidates around uncertain imports", async () => {
  const firstPage = { search: "", offset: 0, limit: 20 };
  const request = vi.fn(async (method: string) => {
    if (method === "logbook_import_adif") throw new Error("unconfirmed");
    return method === "opportunities_snapshot" ? opportunities : { qsos: [], total: 69_527, offset: 0, limit: 20 };
  });
  const reads = createDeferredPanelReads(request, true);
  reads.warm(); await reads.request("logbook_list", firstPage);
  expect(request.mock.calls.filter(([method]) => method === "logbook_list")).toHaveLength(1);
  await reads.request("logbook_list", { ...firstPage, offset: 20 });
  await reads.request("logbook_list", { ...firstPage, search: "OM0RX" });
  await expect(reads.request("logbook_import_adif", { text: "fixture" })).rejects.toThrow("unconfirmed");
  await reads.request("logbook_list", firstPage);
  expect(request.mock.calls.filter(([method]) => method === "logbook_list")).toHaveLength(4);
  await reads.request("station_snapshot"); await reads.request("station_snapshot");
  expect(request.mock.calls.filter(([method]) => method === "station_snapshot")).toHaveLength(2);
});

it("paints the warmed first twenty contacts before further page frames settle", async () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({ id: `qso-${index}`, call: `OM${index}RX`, start: "2026-11-01T00:00:00Z", band: "20m", mode: "CW" }));
  const request = vi.fn((method: string, params?: Record<string, unknown>) => {
    if (method === "logbook_list") return Number(params?.offset) === 0
      ? Promise.resolve({ qsos: rows, total: 69_527, offset: 0, limit: 20 }) : new Promise(() => {});
    return Promise.resolve(opportunities);
  });
  const reads = createDeferredPanelReads(request, true); reads.warm();
  await reads.request("logbook_list", { search: "", offset: 0, limit: 20 });
  render(<LogbookPanel onRequest={reads.request} mutations={new LogbookMutationSession(request, () => {})} onEdit={vi.fn()} refreshKey={0} />);
  await act(async () => {});
  expect(screen.getByText("OM0RX")).toBeTruthy();
  expect(request.mock.calls.filter(([method, params]) => method === "logbook_list" && params?.offset === 0)).toHaveLength(1);
  expect(request.mock.calls.filter(([method]) => method === "logbook_list")).toHaveLength(5);
});

it("retires retained and unfinished pages across log, settings and workspace revisions", async () => {
  let finish!: (value: unknown) => void;
  const old = { qsos: [{ id: "old-workspace" }], total: 1 };
  const current = { qsos: [{ id: "current-workspace" }], total: 1 };
  const request = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(current);
  let read!: ReturnType<typeof createDeferredPanelReads>["request"];
  function Scope({ scope }: { scope: string }) { read = useDeferredPanelReads(request, scope, false); return null; }
  const view = render(<Scope scope="workspace-a:settings-1:contacts-1" />);
  const params = { search: "", offset: 0, limit: 20 };
  const pending = read("logbook_list", params);
  view.rerender(<Scope scope="workspace-b:settings-1:contacts-1" />);
  expect(await read("logbook_list", params)).toBe(current);
  finish(old); await pending;
  expect(await read("logbook_list", params)).toBe(current);
  for (const scope of ["workspace-b:settings-2:contacts-1", "workspace-b:settings-2:contacts-2"]) {
    view.rerender(<Scope scope={scope} />);
    await read("logbook_list", params);
  }
  expect(request).toHaveBeenCalledTimes(4);
});

it("joins repeated page-frame demand and retains only five unfiltered twenty-row frames", async () => {
  const request = vi.fn(async (_method: string, params?: Record<string, unknown>) => ({ qsos: [], total: 69_527, ...params }));
  const reads = createDeferredPanelReads(request, true);
  const page = (offset: number, search = "") => reads.request("logbook_list", { search, offset, limit: 20 });
  for (const offset of [0, 20, 40, 60, 80]) await Promise.all([page(offset), page(offset)]);
  expect(request).toHaveBeenCalledTimes(5);
  for (const offset of [0, 20, 40, 60, 80]) await page(offset);
  expect(request).toHaveBeenCalledTimes(5);
  await reads.request("logbook_list", { search: "", offset: 20, limit: 7 });
  expect(request).toHaveBeenCalledTimes(5);
  await page(100); await page(100); await page(0, "TEST"); await page(0, "TEST");
  expect(request).toHaveBeenCalledTimes(9);
});

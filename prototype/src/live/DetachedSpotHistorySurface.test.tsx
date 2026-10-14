// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DetachedSpotHistorySurface, detachedSpotHistoryMethods, requestDetachedSpotHistory } from "./DetachedSpotHistorySurface";

const api = vi.hoisted(() => ({ worker: vi.fn(), dock: vi.fn() }));
vi.mock("../worker", () => ({ workerRequest: api.worker }));
vi.mock("./DetachedClusterBridge", () => ({ dockDetachedWorkspace: api.dock }));

function archive() {
  let call = "TEST0/P", watermark = 42;
  const report = () => ({ id: "00000000-0000-4000-8000-000000000001", callsign: call,
    sessionID: "fixture-session", sequence: 1, clusterID: "fixture", clusterName: "Synthetic cluster",
    clusterHost: "fixture.invalid", arrivedAt: "2026-10-14T00:00:00Z", reportedAt: null,
    timeBasis: "arrival", recordKind: "live", spotter: "TEST1", frequencyKHz: 14025,
    frequencyText: "14025.0", band: "20m", mode: "CW", source: "cluster", country: "Synthetic country",
    adif: 1, comment: "Synthetic retained report", specialTags: [], callStatus: "New Call", dxccStatus: "ATNO" });
  const request = async (method: string, params: Record<string, any> = {}) => {
    if (method === "spot_history_status") return { result: {
      status: { revision: watermark, total: 1, earliest: null, latest: null, lastCommit: null, schemaVersion: 1, fileBytes: 4096 },
      recording: { state: "idle", queued: 0, unrecorded: 0, errorCode: null, startedAt: "2026-10-14T00:00:00Z", connections: [] },
    } };
    if (method === "spot_history_query") return { result: { page: { rows: [report()], nextCursor: null, watermark, revision: watermark } } };
    if (method === "spot_history_stats") return { result: { stats: {
      total: 1, distinctCalls: 1, distinctSpotters: 1, bands: [], modes: [], countries: [], sources: [], spotters: [], hourly: [],
      earliest: null, latest: null, watermark: params.watermark, revision: watermark, bucketsTruncated: false,
    } } };
    if (method === "spot_history_detail") return { result: { observation: { ...report(), rawLine: "DX de TEST1: 14025 TEST0/P", classificationJSON: "{}" } } };
    throw new Error(`Unexpected archive authority: ${method}`);
  };
  return { request, update() { call = "TEST2/P"; watermark++; } };
}
beforeEach(() => { localStorage.clear(); api.worker.mockReset(); api.dock.mockReset().mockResolvedValue(undefined); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("reads and refreshes the real archive panel directly without a main projection or new service owner", async () => {
  const fixture = archive(); api.worker.mockImplementation(fixture.request);
  render(<DetachedSpotHistorySurface />);
  await screen.findByText("TEST0/P");
  expect(screen.getByRole("main", { name: "Detached Spot History" })).toBeTruthy();
  expect(screen.queryByText("Retained local reports · read only")).toBeNull();
  expect(screen.queryByRole("button", { name: "Dock back" })).toBeNull();
  expect(screen.getByRole("main").firstElementChild?.getAttribute("aria-label")).toBe("Spot history archive");
  expect(screen.queryByText(/waiting for the main/i)).toBeNull();
  fixture.update();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByText("TEST2/P");
  expect(api.worker.mock.calls.filter(([method]) => method === "spot_history_query")).toHaveLength(2);
  expect(api.worker.mock.calls.every(([method]) => detachedSpotHistoryMethods.includes(method))).toBe(true);
});

it("inspects an original stored report through only the read-only detail handler", async () => {
  api.worker.mockImplementation(archive().request); render(<DetachedSpotHistorySurface />);
  fireEvent.click(await screen.findByText("TEST0/P"));
  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  await screen.findByText("DX de TEST1: 14025 TEST0/P");
  expect(api.worker).toHaveBeenCalledWith("spot_history_detail", { id: "00000000-0000-4000-8000-000000000001" });
  expect([...new Set(api.worker.mock.calls.map(([method]) => method))].sort()).toEqual([...detachedSpotHistoryMethods].sort());
});

it("keeps archive failures visible and retries a read without starting connections or changing data", async () => {
  api.worker.mockRejectedValue(new Error("archive unavailable")); render(<DetachedSpotHistorySurface />);
  await screen.findByText("Spot history could not be read. Check archive status and retry.");
  api.worker.mockImplementation(archive().request);
  fireEvent.click(screen.getByRole("button", { name: "Retry history" }));
  await screen.findByText("TEST0/P");
  expect(api.worker.mock.calls.every(([method]) => detachedSpotHistoryMethods.includes(method))).toBe(true);
});

it("rejects mutations, station/session operations and malformed responses at its own bridge", async () => {
  for (const method of ["cluster_connect", "cluster_resume_initialize", "station_tune", "logbook_operator_draft_apply",
    "spot_history_delete", "spot_history_purge", "spot_history_export", "settings_load", "sync_run"])
    await expect(requestDetachedSpotHistory(method)).rejects.toThrow("only read");
  expect(api.worker).not.toHaveBeenCalled();
  api.worker.mockResolvedValue({ result: [] });
  await expect(requestDetachedSpotHistory("spot_history_status")).rejects.toThrow("could not be verified");
});

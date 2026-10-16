// Actual child, memory-only IPC, no persisted storage, external services or images.
import React from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import "../../src/surfaceStyles";
import "../../src/live/live.css";
import "../../src/style.css";
import "../../src/live/DetachedSpotHistorySurface.css";
import "./spot-history-preview.css";

const requests: string[] = [], commands: string[] = [], forbidden: string[] = [];
let watermark = 120, failedQuery = false, dockFailure = false;
const mode = new URLSearchParams(location.search).get("state");
const rows = Array.from({ length: 45 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  sessionID: "synthetic-session", sequence: index + 1, clusterID: "synthetic-cluster",
  clusterName: "Synthetic cluster", clusterHost: "fixture.invalid",
  arrivedAt: new Date(Date.UTC(2026, 9, 14, 8, 15, 59 - index)).toISOString(), reportedAt: null,
  timeBasis: "arrival", recordKind: "live", callsign: index % 2 ? `TEST${index}/P` : "EA8/TEST0/P",
  spotter: "TEST1", frequencyKHz: 14025 + index, frequencyText: String(14025 + index), band: "20m", mode: "CW",
  source: "cluster", country: "Synthetic country", adif: 1,
  comment: "Synthetic portable report; retained original comment. No live archive or station access.",
  specialTags: [], callStatus: "New Callsign", dxccStatus: "New DXCC",
  rawLine: "DX de TEST1: 14025 EA8/TEST0/P SYNTHETIC ONLY", classificationJSON: '{"source":"synthetic fixture"}',
}));

function archive(method: string, params: Record<string, any>) {
  requests.push(method);
  const matching = mode === "empty" ? [] : rows.filter(row => !params.call ||
    (params.match === "prefix" ? row.callsign.startsWith(String(params.call)) : row.callsign === params.call));
  if (method === "spot_history_status") return {
    status: { revision: watermark, total: rows.length, earliest: rows.at(-1)!.arrivedAt, latest: rows[0].arrivedAt,
      lastCommit: rows[0].arrivedAt, schemaVersion: 1, fileBytes: 8192 },
    recording: { state: "idle", queued: 0, unrecorded: 0, errorCode: null,
      startedAt: "2026-10-14T08:00:00Z", connections: [], events: [] },
  };
  if (method === "spot_history_query") {
    if (mode === "error" || failedQuery) { failedQuery = false; throw new Error("Synthetic archive read failure"); }
    if (params.watermark == null) watermark++;
    return { page: { rows: matching.slice(0, Number(params.limit ?? 100)), nextCursor: null, watermark, revision: watermark } };
  }
  if (method === "spot_history_stats") return { stats: {
    total: matching.length, distinctCalls: new Set(matching.map(row => row.callsign)).size,
    distinctSpotters: matching.length ? 1 : 0,
    bands: [{ key: "20m", count: matching.length }], modes: [{ key: "CW", count: matching.length }],
    countries: [{ key: "Synthetic country", count: matching.length }], sources: [{ key: "cluster", count: matching.length }],
    spotters: [{ key: "TEST1", count: matching.length }], hourly: [], earliest: matching.at(-1)?.arrivedAt ?? null,
    latest: matching[0]?.arrivedAt ?? null, watermark: params.watermark, revision: watermark, bucketsTruncated: false,
  } };
  if (method === "spot_history_detail") return { observation: rows.find(row => row.id === params.id) ?? null };
  forbidden.push(method); throw new Error(`Fixture forbids archive method ${method}`);
}

mockWindows("spot-history");
Object.assign(globalThis, { isTauri: true });
mockIPC((command, args) => {
  commands.push(command);
  if (command === "worker_request") {
    const request = (args as Record<string, any>).request;
    return { id: request.id, ok: true, result: archive(request.method, request.params) };
  }
  if (command === "dock_detached_window") {
    if (dockFailure) { dockFailure = false; throw new Error("Synthetic main recovery failure"); }
    return null;
  }
  forbidden.push(command); throw new Error(`Fixture forbids native command ${command}`);
}, { shouldMockEvents: true });
globalThis.fetch = async () => { forbidden.push("fetch"); throw new Error("Fixture forbids application network access"); };
for (const method of ["getItem", "setItem", "removeItem"] as const)
  Storage.prototype[method] = () => { forbidden.push(`storage:${method}`); throw new Error("Fixture forbids persisted storage access"); };
Object.assign(window, { spotHistoryVisualFixture: {
  snapshot: () => structuredClone({ requests, commands, forbidden }),
  failQuery: () => { failedQuery = true; }, failDock: () => { dockFailure = true; },
} });
const { DetachedSpotHistorySurface } = await import("../../src/live/DetachedSpotHistorySurface");
createRoot(document.getElementById("root")!).render(<div className="spot-history-fixture"><p className="synthetic-label">Synthetic fixture · all archive and native replies are mocked · no live data</p><DetachedSpotHistorySurface /></div>);

// @vitest-environment jsdom
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { normalWindowReads, contestWindowReads, contestDialogViews } from "./window-read-inventory";
import { loadWindowSurface } from "../src/windowSurface";
import { createDeferredPanelReads } from "../src/live/deferredPanelReads";

it("covers every registered normal and contest window with an explicit data policy", () => {
  const source = readFileSync(resolve(import.meta.dirname, "../src-tauri/src/workspace_windows.rs"), "utf8");
  const ids = (name: string) => [...source.match(new RegExp(`pub const ${name}:.*?= \\[([\\s\\S]*?)\\n\\];`))![1]
    .matchAll(/WindowSpec\s*\{\s*id:\s*"([^"]+)"/g)].map(match => match[1]);
  expect(normalWindowReads.map(window => window.id)).toEqual(ids("SUPPORTED_WINDOWS"));
  expect([...contestWindowReads]).toEqual(ids("CONTEST_WINDOWS"));
  expect(existsSync(resolve(import.meta.dirname, "../hm-control/index.html"))).toBe(true);
});

it("loads every actual window module independently and records first/repeat import timings", async () => {
  const routes = [
    ...normalWindowReads.filter(window => window.id !== "hm-control").map(window => ({ scope: "normal_logging", view: window.id, query: `?view=${window.id}` })),
    ...contestWindowReads.map(view => ({ scope: "contesting", view, query: `?scope=contesting&view=${view}` })),
    ...contestDialogViews.map(view => ({ scope: "contesting-dialog", view, query: `?scope=contesting&view=${view}` })),
  ];
  const measurements = [];
  for (const route of routes) {
    const began = performance.now(), first = await loadWindowSurface(route.query), firstImportMs = performance.now() - began;
    const repeated = performance.now(), second = await loadWindowSurface(route.query), repeatImportMs = performance.now() - repeated;
    expect(typeof first).toBe("function"); expect(second).toBe(first);
    measurements.push({ ...route, firstImportMs: +firstImportMs.toFixed(3), repeatImportMs: +repeatImportMs.toFixed(3),
      dataReadyMs: null, dataReadCount: 0 });
  }
  const cacheMeasurements = [];
  for (const method of ["opportunities_snapshot", "logbook_catalog", "logbook_list"]) {
    let count = 0;
    const request = async () => { count++; await new Promise(resolve => setTimeout(resolve, 25)); return { generated_at: new Date().toISOString(), items: [], qsos: [], total: 69_527 }; };
    const params = method === "logbook_list" ? { search: "", offset: 0, limit: 20 }
      : method === "logbook_catalog" ? { offset: 0, limit: 5, search: "", delivery_state: "" } : undefined;
    const reads = createDeferredPanelReads(request, true);
    const start = performance.now(); await reads.request(method, params); const coldMs = performance.now() - start;
    const before = count, again = performance.now(); await reads.request(method, params);
    cacheMeasurements.push({ method, syntheticRequestDelayMs: 25, coldMs: +coldMs.toFixed(3), warmMs: +(performance.now() - again).toFixed(3),
      coldReadCount: before, warmAdditionalReadCount: count - before });
    expect(count).toBe(1);
  }
  const report = process.env.XLOG_WINDOW_READ_REPORT;
  if (report) {
    mkdirSync(dirname(resolve(report)), { recursive: true });
    writeFileSync(resolve(report), JSON.stringify({ schema: 1, recordedAt: new Date().toISOString(),
      method: "Actual dynamic modules in jsdom, first/repeat imports in one sequential process; shared dependencies may already be loaded. No component mounted and no native/worker/data/hardware call occurred. Cache timings use an explicit synthetic 25ms read, not a production query.",
      normalWindowCount: normalWindowReads.length, contestWindowCount: contestWindowReads.length, contestDialogCount: contestDialogViews.length,
      normalWindowReads, measurements, cacheMeasurements,
      pending: ["Native time to first valid data for every window", "Separate cold WebView launch and warm native show measurements", "HM Control uses its separate native HTML entry"] }, null, 2));
  }
}, 30_000);

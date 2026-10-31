// Actual product components with memory-only 200ms reads and fail-closed native
// IPC. No app worker, account, logbook file, station, network feed or device.
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { LogbookPanel } from "../../src/live/LogbookPanel";
import { LogbookMutationSession } from "../../src/live/logbookMutationSession";
import AwardsPanel from "../../src/live/AwardsPanel";
import OpportunitiesPanel from "../../src/live/OpportunitiesPanel";
import FirstRunSetup from "../../src/live/FirstRunSetup";
import { AboutSurface } from "../../src/live/AboutSurface";
import { createDeferredPanelReads } from "../../src/live/deferredPanelReads";
import "../../src/surfaceStyles";
import "../../src/live/live.css";
import "../../src/style.css";

type View = "wizard" | "about" | "logbook" | "awards" | "chaser";
const requests: { method: string; params: Record<string, unknown>; at: number }[] = [];
const nativeAttempts: string[] = [];
mockWindows("synthetic-window-read-preview");
mockIPC(command => { nativeAttempts.push(command); throw new Error(`Synthetic fixture forbids native command ${command}`); }, { shouldMockEvents: true });
const allRows = Array.from({ length: 100 }, (_, index) => ({ id: `fixture-${index}`, call: index === 0 ? "TEST0/P" : `TEST${index}A`,
  start: "2026-11-01T00:00:00Z", band: "20m", mode: "CW", frequencyHz: 14_025_000, rstSent: "599", rstReceived: "599", country: "Synthetic country" }));
const snapshot = () => ({ generated_at: new Date().toISOString(), items: [{ id: "pota:TEST0/P:TEST-0001", kind: "pota", callsign: "TEST0/P", reference: "TEST-0001", name: "Synthetic park",
  frequency_hz: 14_025_000, mode: "CW", observed_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3600_000).toISOString(), source: "Synthetic public report", source_url: "", comment: "Memory fixture only", reference_status: "verified", worked_count: 0, confirmed_count: 0, band_modes: [] }],
  sources: [], total_available: 1, history_state: "ready" });
async function request(method: string, params: Record<string, unknown> = {}) {
  requests.push({ method, params, at: performance.now() });
  await new Promise(resolve => setTimeout(resolve, 200));
  if (method === "logbook_list") return { qsos: allRows.slice(Number(params.offset), Number(params.offset) + Number(params.limit)), total: 69_527, offset: params.offset, limit: params.limit };
  if (method === "logbook_catalog") return { total_programmes: 1, catalogue_total: 192, reference_date: "2026-11-01", programmes: [{ id: "synthetic", name: "Synthetic awards programme", sponsor: "Fixture sponsor", delivery_state: "trackingOnly", delivery_detail: "Synthetic evidence only" }], items: [] };
  if (method === "logbook_stats") return { awards: { qso_count: 69_527, dxcc_worked: 100, dxcc_confirmed: 95, cq_zones_worked: 30, cq_zones_confirmed: 28, states_worked: 40, states_confirmed: 39, grids_worked: 90, grids_confirmed: 80, band_counts: { "20m": 500 }, mode_counts: { CW: 500 }, continent_counts: { EU: 500 } } };
  if (method === "opportunities_snapshot" || method === "opportunities_refresh") return snapshot();
  throw new Error(`Synthetic fixture forbids ${method}`);
}
const reads = createDeferredPanelReads(request, true), mutations = new LogbookMutationSession(request, () => {});
const root = createRoot(document.getElementById("root")!);
let serial = 0;
function renderView(view: View) {
  const content = view === "logbook" ? <LogbookPanel onRequest={reads.request} mutations={mutations} onEdit={() => {}} refreshKey={0} />
    : view === "awards" ? <AwardsPanel request={reads.request} refresh={0} />
    : view === "chaser" ? <OpportunitiesPanel request={reads.request} />
    : view === "about" ? <AboutSurface />
    : <FirstRunSetup onFinish={async () => {}} loadModels={async () => []} />;
  flushSync(() => root.render(<React.StrictMode><div key={++serial} style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
    <p style={{ margin: 0, padding: "4px 10px", color: "#ffc269", background: "#07111f" }}>Synthetic preview · memory-only 200ms reads · no services or hardware</p>
    <div className="app live monitor-app" style={{ minHeight: 0, height: "auto", flex: 1 }}><main>{content}</main></div>
  </div></React.StrictMode>));
}
const ready = (view: View) => view === "logbook" ? !!document.querySelector("tbody tr")
  : view === "awards" ? document.body.textContent?.includes("Synthetic awards programme")
  : view === "chaser" ? document.body.textContent?.includes("Synthetic park")
  : view === "about" ? !!document.querySelector('[aria-label="About OM0RX-xLog"] img')
  : !!document.querySelector('[aria-label="Operator call"]');
Object.assign(window, { windowReadFixture: {
  requests, nativeAttempts,
  reset() { reads.invalidate(); requests.length = 0; nativeAttempts.length = 0; },
  async warm() {
    reads.warm();
    await Promise.all([reads.request("logbook_list", { search: "", offset: 0, limit: 20 }),
      reads.request("logbook_catalog", { offset: 0, limit: 5, search: "", delivery_state: "" }), reads.request("opportunities_snapshot")]);
  },
  render: renderView,
  async measure(view: View) {
    const count = requests.length, start = performance.now();
    renderView(view);
    let firstDataMs = 0;
    await new Promise<void>((resolve, reject) => {
      const complete = () => { if (!ready(view)) return; firstDataMs = performance.now() - start; observer.disconnect(); clearTimeout(timeout); resolve(); };
      const observer = new MutationObserver(complete), timeout = setTimeout(() => { observer.disconnect(); reject(new Error(`Timed out ${view}`)); }, 5000);
      observer.observe(document.getElementById("root")!, { subtree: true, childList: true }); complete();
    });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { view, firstDataMs: +firstDataMs.toFixed(2), observedFrameMs: +(performance.now() - start).toFixed(2),
      newReadsAtObservedFrame: requests.slice(count).map(value => value.method), nativeAttempts: [...nativeAttempts],
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
  },
} });
renderView((new URLSearchParams(location.search).get("view") || "wizard") as View);

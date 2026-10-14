// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { beginSpotHistoryAbsence, resumeSpotHistoryAbsence, serveSpotHistoryAbsence, verifyArchiveReads } from "./spotHistoryWindowAcceptance";
const api = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
vi.mock("./acceptance", () => ({ waitForAcceptance: async (_name: string, condition: () => boolean) => {
  if (!condition()) throw new Error("Synthetic DOM condition failed");
} }));
beforeEach(() => { api.invoke.mockReset(); });
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });
const draft = { id: "private-draft", call: "", band: "20m" };
function fixture() {
  return vi.fn(async (method: string, params: Record<string, any> = {}): Promise<Record<string, any>> => {
    if (method === "logbook_operator_draft") return { result: { draft: { qso: draft } } };
    if (method === "spot_history_status") return { result: { status: { total: 137 } } };
    if (method === "spot_history_query") return { result: { page: { rows: Array.from({ length: params.cursor ? 37 : 100 }, (_, i) =>
      ({ id: String(i + (params.cursor ? 100 : 0)), clusterHost: "fixture.invalid", source: "fixture" })), watermark: 137, nextCursor: "cursor" } } };
    if (method === "spot_history_stats") return { result: { stats: { total: 137, distinctCalls: 2, distinctSpotters: 1 } } };
    if (method === "spot_history_detail") return { result: { observation: { id: params.id, rawLine: "Synthetic acceptance <not-markup> Ω" } } };
    throw new Error(`Unexpected fixture authority: ${method}`);
  });
}
it("verifies every archive read against the closed/reopened private fixture without writes", async () => {
  const worker = fixture();
  await expect(verifyArchiveReads(worker)).resolves.toMatchObject({ reports: 137, uniqueIDs: 137, originalSource: true });
  expect(worker.mock.calls.map(([method]) => method)).toEqual(["spot_history_status", "spot_history_query", "spot_history_query", "spot_history_stats", "spot_history_detail"]);
});
it("rejects incomplete retained archive evidence", async () => {
  const worker = fixture(), original = worker.getMockImplementation()!;
  worker.mockImplementation(async (method, params) => method === "spot_history_stats" ? { result: { stats: { total: 136 } } } : original(method, params));
  await expect(verifyArchiveReads(worker)).rejects.toThrow("complete generated SQLite fixture");
});
it("arms destruction only after the native window reports its verified read and retains the main report", async () => {
  api.invoke.mockImplementation(async method => method === "acceptance_window_state" ? {
    open: true, report: { status: "passed", checks: { archive_read: true }, details: { instanceID: "private-child" } },
  } : undefined);
  const report = { checks: {}, details: {} };
  await beginSpotHistoryAbsence(report, fixture());
  expect(api.invoke.mock.calls.map(([method]) => method)).toEqual(["acceptance_open_window", "acceptance_window_state", "acceptance_spot_history_begin"]);
  expect(report.details).toMatchObject({ spotHistoryWindow: { beforeDraft: draft, instanceID: "private-child" } });
});
it("leaves normal initial main acceptance unchanged when no native absence phase exists", async () => {
  api.invoke.mockResolvedValue({ active: false });
  const worker = fixture(), navigate = vi.fn(), map = vi.fn();
  await expect(resumeSpotHistoryAbsence({ details: {} }, worker, navigate, map)).resolves.toBe(false);
  expect(worker).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled(); expect(map).not.toHaveBeenCalled();
});
it("resumes native retained evidence in a new main rather than rerunning empty-workspace setup", async () => {
  const main = document.createElement("main"); main.setAttribute("aria-label", "Spot History"); document.body.append(main);
  const retained = { checks: { detached_spot_history: true }, details: { mainInstanceID: "old-main", spotHistoryWindow: { beforeDraft: draft } } };
  api.invoke.mockResolvedValue({ active: true, ready: true, read_proved: true, main_open: true, child_open: false, report: retained, child_report: { status: "passed" } });
  const report = { checks: {}, details: { mainInstanceID: "new-main" } }, worker = fixture(), navigate = vi.fn(), map = vi.fn(async () => ({ capturedAt: 1 }));
  await expect(resumeSpotHistoryAbsence(report, worker, navigate, map)).resolves.toBe(true);
  expect(report.checks).toMatchObject({ spot_history_main_absent: true, spot_history_dock_recovery: true });
  expect(report.details).toMatchObject({ spotHistoryWindow: { recoveredMainInstanceID: "new-main", draftUnchanged: true }, finalMap: { capturedAt: 1 } });
  expect(worker.mock.calls.map(([method]) => method)).toEqual(["logbook_operator_draft"]);
  expect(navigate).toHaveBeenCalledWith("Operator Desk");
});
it("rejects a purported recovery in the same renderer", async () => {
  api.invoke.mockResolvedValue({ active: true, report: { details: { mainInstanceID: "same" } } });
  await expect(resumeSpotHistoryAbsence({ details: { mainInstanceID: "same" } }, fixture(), vi.fn(), vi.fn())).rejects.toThrow("replace the destroyed renderer");
});
it("reads and exercises the child table while main is absent, then uses native recovery", async () => {
  const wrap = document.createElement("div"); wrap.className = "spot-history-table-wrap"; wrap.setAttribute("aria-busy", "false");
  const summary = document.createElement("div"); summary.className = "spot-history-summary"; summary.innerHTML = "<strong>137</strong>";
  const table = document.createElement("table"); table.className = "spot-history-table"; table.innerHTML = "<tbody><tr><td>Synthetic</td></tr></tbody>";
  document.body.append(wrap, summary, table);
  api.invoke.mockImplementation(async method => method === "acceptance_window_step" ? { action: "main_absent", revision: 4 }
    : method === "acceptance_spot_history_state" ? { active: true, main_open: false, revision: 4 } : undefined);
  const click = vi.fn(async (name: string) => {
    if (name === "Details") { const detail = document.createElement("div"); detail.className = "spot-history-detail";
      detail.textContent = "Synthetic acceptance <not-markup> Ω"; document.body.append(detail); }
    if (name === "Close details") document.querySelector(".spot-history-detail")?.remove();
  });
  const report = { checks: {}, details: {}, status: "failed", worker: false };
  await serveSpotHistoryAbsence(report, fixture(), click);
  expect(report.checks).toMatchObject({ archive_read: true, main_absent: true });
  expect(click.mock.calls.map(([name]) => name)).toEqual(["Refresh", "Details", "Close details"]);
  expect(api.invoke.mock.calls.some(([method]) => method === "dock_detached_window")).toBe(true);
  expect(api.invoke.mock.calls.filter(([method]) => method === "acceptance_monitor")).toHaveLength(2);
});

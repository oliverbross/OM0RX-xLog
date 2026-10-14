// Acceptance-only coordinator client. Production windows never import/run this.
import { invoke } from "@tauri-apps/api/core";
import { waitForAcceptance } from "./acceptance";
import { validHistoryFixture } from "./spotHistoryAcceptance";
type Json = Record<string, any>;
type Worker = (method: string, params?: Json) => Promise<Json>;
type Click = (name: string, selector?: string) => Promise<void>;
const pause = () => new Promise(resolve => setTimeout(resolve, 50));

export async function verifyArchiveReads(worker: Worker) {
  const status = (await worker("spot_history_status")).result;
  const first = (await worker("spot_history_query", { limit: 100 })).result.page;
  const second = (await worker("spot_history_query", { limit: 100, cursor: first.nextCursor, watermark: first.watermark })).result.page;
  const stats = (await worker("spot_history_stats", { watermark: first.watermark })).result.stats;
  const detail = (await worker("spot_history_detail", { id: first.rows[0].id })).result.observation;
  if (status.status?.total !== 137 || !validHistoryFixture(first, second, stats) ||
      detail?.id !== first.rows[0].id || !String(detail.rawLine).includes("Synthetic acceptance <not-markup> Ω"))
    throw new Error("Detached archive did not read the complete generated SQLite fixture.");
  return { reports: 137, uniqueIDs: 137, watermark: first.watermark, originalSource: true };
}

async function stateUntil(accepts: (state: Json) => boolean) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const state = await invoke<Json>("acceptance_spot_history_state");
    if (state.child_report?.status === "failed") throw new Error(state.child_report.error || "Detached archive failed");
    if (accepts(state)) return state;
    await pause();
  }
  throw new Error("Detached archive main-absent lifecycle timed out.");
}

export async function serveSpotHistoryAbsence(report: Json, worker: Worker, click: Click) {
  report.details.instanceID = crypto.randomUUID();
  await waitForAcceptance("detached archive table", () => document.querySelector('.spot-history-table-wrap[aria-busy="false"]') !== null &&
    document.querySelector(".spot-history-summary strong")?.textContent === "137");
  report.details.before = await verifyArchiveReads(worker);
  report.checks.archive_read = true; report.worker = true; report.status = "passed";
  await invoke("acceptance_monitor", { report });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const step = await invoke<Json | null>("acceptance_window_step", {});
    if (step?.action === "main_absent" && Number.isSafeInteger(step.revision) && step.revision > 0) {
      await stateUntil(state => state.active === true && state.main_open === false && state.revision === step.revision);
      report.details.after = await verifyArchiveReads(worker);
      await click("Refresh", ".spot-history-filters button");
      await waitForAcceptance("main-absent archive refresh", () => document.querySelector('.spot-history-table-wrap[aria-busy="false"]') !== null &&
        document.querySelector(".spot-history-summary strong")?.textContent === "137");
      const row = document.querySelector<HTMLTableRowElement>(".spot-history-table tbody tr");
      if (!row) throw new Error("Main-absent archive has no visible report.");
      row.click(); await click("Details", ".spot-history-footer button");
      await waitForAcceptance("main-absent original source", () => document.querySelector(".spot-history-detail")?.textContent?.includes("Synthetic acceptance <not-markup> Ω") === true);
      if (document.querySelector(".spot-history-detail not-markup")) throw new Error("Archive source became markup.");
      await click("Close details", ".spot-history-detail button");
      await stateUntil(state => state.main_open === false && state.revision === step.revision);
      report.checks.main_absent = true; report.details.phaseRevision = step.revision;
      await invoke("acceptance_monitor", { report });
      // Detached task windows intentionally omit redundant workspace chrome.
      // Exercise the shipped child-only recovery command without reintroducing
      // the removed Dock back button solely for acceptance.
      await invoke("dock_detached_window");
      return;
    }
    await pause();
  }
  throw new Error("Detached archive did not receive its native lifecycle step.");
}

export async function beginSpotHistoryAbsence(report: Json, worker: Worker) {
  report.details.spotHistoryWindow = { beforeDraft: (await worker("logbook_operator_draft")).result.draft.qso };
  await invoke("acceptance_open_window", { kind: "spot-history" });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const state = await invoke<Json>("acceptance_window_state", { kind: "spot-history" });
    if (state.report?.status === "failed") throw new Error(state.report.error || "Detached archive failed");
    if (state.open === true && state.report?.status === "passed" && state.report.checks?.archive_read === true) {
      report.details.spotHistoryWindow.instanceID = state.report.details.instanceID;
      report.checks.detached_spot_history = true;
      await invoke("acceptance_spot_history_begin", { report });
      return;
    }
    await pause();
  }
  throw new Error("Detached archive did not become ready before main destruction.");
}

export async function resumeSpotHistoryAbsence(report: Json, worker: Worker, navigate: (name: string) => Promise<void>, freshMap: () => Promise<Json>) {
  const initial = await invoke<Json>("acceptance_spot_history_state");
  if (initial.active !== true) return false;
  const instanceID = report.details.mainInstanceID;
  if (!initial.report || typeof instanceID !== "string" || typeof initial.report.details?.mainInstanceID !== "string" ||
      initial.report.details.mainInstanceID === instanceID) throw new Error("Main recovery did not replace the destroyed renderer.");
  Object.assign(report, initial.report);
  const state = await stateUntil(value => value.ready === true);
  await waitForAcceptance("Dock back retained archive route", () => document.querySelector("main")?.getAttribute("aria-label") === "Spot History");
  const unchanged = JSON.stringify(report.details.spotHistoryWindow.beforeDraft) === JSON.stringify((await worker("logbook_operator_draft")).result.draft.qso);
  report.checks.spot_history_main_absent = state.read_proved === true && unchanged;
  report.checks.spot_history_dock_recovery = state.main_open === true && state.child_open === false;
  report.details.spotHistoryWindow = { ...report.details.spotHistoryWindow, recoveredMainInstanceID: instanceID,
    child: state.child_report, draftUnchanged: unchanged };
  if (!report.checks.spot_history_main_absent || !report.checks.spot_history_dock_recovery) throw new Error("Archive main-absent read/Dock proof was incomplete.");
  await invoke("acceptance_prepare_final");
  await navigate("Operator Desk");
  report.details.finalMap = await freshMap();
  return true;
}

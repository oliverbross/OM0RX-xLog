import { invoke } from "@tauri-apps/api/core";
import { awaitMap, mapDetails, validWorkerResult, waitForAcceptance } from "./acceptance";
import { LARGE_LOG_RECORDS, largeLogADIFBatch } from "./acceptanceFixture";
import workspaceScreens from "./live/workspaceScreens.json";
import { verifyDetachedLifecycle } from "./detachedAcceptance";
import { verifyWorkspaceLayoutRoundtrip } from "./workspaceLayoutAcceptance";
import { verifySpotHistory } from "./spotHistoryAcceptance";
import { verifyWorkspaceSettings } from "./workspaceSettingsAcceptance";
import { verifyDeskMapLogbook } from "./deskMapLogbookAcceptance";
import { verifyWorkspaceWindows } from "./workspaceWindowsAcceptance";
import { beginSpotHistoryAbsence, resumeSpotHistoryAbsence, serveSpotHistoryAbsence } from "./spotHistoryWindowAcceptance";
import { verifyBandMapContext } from "./bandMapWindowAcceptance";
import { validMonitorContext } from "./live/monitorContext";
import { verifyEditorFocus } from "./editorFocusAcceptance";
import { verifyWorkspaceMenuRoutes } from "./workspaceMenuAcceptance";
import { verifyADIFTransferRoundtrip } from "./adifTransferAcceptance";

type Json = Record<string, any>;
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing rendered control: ${selector}`);
  return found;
}
function button(name: string, selector = "button") {
  const found = [...document.querySelectorAll<HTMLButtonElement>(selector)]
    .find(control => control.textContent?.trim() === name && control.getClientRects().length > 0);
  if (!found || found.disabled) throw new Error(`Unavailable rendered button: ${name}`);
  return found;
}
async function click(name: string, selector = "button") {
  await waitForAcceptance(`enabled rendered button: ${name}`, () => [...document.querySelectorAll<HTMLButtonElement>(selector)]
    .some(control => control.textContent?.trim() === name && control.getClientRects().length > 0 && !control.disabled));
  button(name, selector).click(); await frame();
}
async function navigate(name: string, expected = name) {
  const screen = workspaceScreens.find(screen => screen.title === name);
  if (!screen) throw new Error(`Unknown workspace route: ${name}`);
  await invoke("acceptance_screen", { screen: screen.id });
  await waitForAcceptance(`native menu route ${name}`, () => document.querySelector("main")?.getAttribute("aria-label") === expected);
  await frame();
}
async function fill(selector: string, value: string) {
  const control = element<HTMLInputElement | HTMLSelectElement>(selector);
  const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(control, value);
  control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  await frame();
}
async function worker(method: string, params: Json = {}): Promise<Json> {
  const response = await invoke<Json>("worker_request", { request: { id: crypto.randomUUID(), method, params } });
  if (!response.ok) throw new Error(`Local acceptance request failed: ${method}`);
  return response;
}
export function validIsolatedHealth(result: Json) {
  return result.mode === "isolated_local_acceptance" && result.isolated_workspace === true &&
    result.local_logbook === true && result.platform_services === false && result.station_io === false &&
    result.credentials_accessed === false && result.network_contact === false;
}
export function validSavedContact(result: Json) {
  const rows = result.qsos;
  return result.total === 1 && Array.isArray(rows) && rows.length === 1 && rows[0].call === "W1AW" &&
    rows[0].frequencyHz === 14_240_000 && rows[0].band === "20m" && rows[0].mode === "SSB" &&
    rows[0].comment === "Isolated native UI acceptance";
}

async function main(report: Json) {
  const largeLog = await invoke<boolean>("acceptance_large_log");
  const check = (name: string, condition: boolean) => {
    report.checks[name] = condition;
    if (!condition) throw new Error(`Acceptance failed: ${name}`);
  };
  check("isolated_worker", validIsolatedHealth((await worker("health")).result));
  report.worker = true;
  const before = (await worker("workspace_status")).result;
  check("empty_workspace", before.workspace_exists === false && before.native_log_exists === false);
  await waitForAcceptance("create empty logbook", () => [...document.querySelectorAll("button")].some(item => item.textContent === "Create empty logbook"));
  await click("Create empty logbook");
  await waitForAcceptance("real operator draft", () => !!document.querySelector('[aria-label="Desk Callsign"]'));
  if (largeLog) report.details.performance.operatorReadyMs = Math.round(performance.now());
  check("workspace_created", (await worker("workspace_status")).result.workspace_exists === true);
  report.details.workspaceLayout = await verifyWorkspaceLayoutRoundtrip();
  check("workspace_layout_roundtrip", report.details.workspaceLayout.staleWriteRejected);
  // Exercise the actual controls, not just the layout service. The temporary
  // workspace has no equipment and this sequence never activates a spot.
  await waitForAcceptance("layout selector ready", () => {
    const control = document.querySelector<HTMLSelectElement>('[aria-label="Desk layout"]');
    return !!control && !control.disabled && control.value === "traditional";
  });
  const draftBeforeLayout = (await worker("logbook_operator_draft")).result.draft.qso;
  await fill('[aria-label="Desk layout"]', "custom");
  // The preceding roundtrip changes the authoritative revision through another
  // session. Native invalidation is asynchronous; the rendered desk can still
  // have the original Traditional revision when this control is selected.
  // Exercise explicit recovery rather than retrying a stale mutation silently
  // or assuming a fixed animation/timer delay proves the UI is up to date.
  const layoutConflict = () => document.querySelector('.canvas-recovery[role="alert"]')?.textContent?.includes("Another window changed the layout.") === true;
  await waitForAcceptance("custom canvas or reviewed layout conflict", () => {
    const control = element<HTMLSelectElement>('[aria-label="Desk layout"]');
    return control.value === "custom" && !control.disabled || layoutConflict();
  });
  const layoutConflictRecovered = layoutConflict();
  if (layoutConflictRecovered) {
    await click("Use saved layout");
    await waitForAcceptance("fresh saved layout adopted", () => !layoutConflict() && !element<HTMLSelectElement>('[aria-label="Desk layout"]').disabled);
    await fill('[aria-label="Desk layout"]', "custom");
  }
  await waitForAcceptance("custom canvas acknowledged", () => element<HTMLSelectElement>('[aria-label="Desk layout"]').value === "custom" && !element<HTMLSelectElement>('[aria-label="Desk layout"]').disabled);
  await click("Panels");
  const mapToggle = [...document.querySelectorAll<HTMLInputElement>('.canvas-panel-picker input')].find(input => input.parentElement?.textContent?.trim() === "World map");
  if (!mapToggle) throw new Error("Missing canvas map visibility control");
  mapToggle.click();
  await waitForAcceptance("map hidden and saved", () => !mapToggle.checked && !element<HTMLSelectElement>('[aria-label="Desk layout"]').disabled);
  const hiddenLayout = (await worker("workspace_layout_load")).result.layout;
  const mapPlacement = hiddenLayout.document.presets.find((preset: Json) => preset.id === "custom").panels.find((panel: Json) => panel.id === "world-map").placement;
  if (mapPlacement !== "hidden") throw new Error("Canvas visibility did not persist");
  mapToggle.click();
  await waitForAcceptance("map restored and saved", () => mapToggle.checked && !element<HTMLSelectElement>('[aria-label="Desk layout"]').disabled);
  await click("Lock layout");
  await waitForAcceptance("canvas locked", () => [...document.querySelectorAll("button")].some(item => item.textContent === "Arrange panels"));
  await waitForAcceptance("locked layout saved", () => !element<HTMLSelectElement>('[aria-label="Desk layout"]').disabled);
  await fill('[aria-label="Desk layout"]', "traditional");
  await waitForAcceptance("traditional desk restored", () => element<HTMLSelectElement>('[aria-label="Desk layout"]').value === "traditional" && !element<HTMLSelectElement>('[aria-label="Desk layout"]').disabled && !!document.querySelector(".operator-workspace"));
  const layoutAfterControls = (await worker("workspace_layout_load")).result.layout;
  const draftAfterLayout = (await worker("logbook_operator_draft")).result.draft.qso;
  report.details.workspaceCanvas = { activePreset: layoutAfterControls.document.activePresetID, layoutConflictRecovered, mapHidePersisted: mapPlacement === "hidden",
    locked: layoutAfterControls.document.presets.find((preset: Json) => preset.id === "custom").locked, sameDraft: draftBeforeLayout.id === draftAfterLayout.id && draftBeforeLayout.call === draftAfterLayout.call };
  check("workspace_canvas_controls", report.details.workspaceCanvas.activePreset === "traditional" && report.details.workspaceCanvas.mapHidePersisted && report.details.workspaceCanvas.locked && report.details.workspaceCanvas.sameDraft);
  report.details.workspaceSettings = await verifyWorkspaceSettings({ worker, navigate, fill, click });
  check("workspace_settings_presets", report.details.workspaceSettings.savedInactive && report.details.workspaceSettings.activated && report.details.workspaceSettings.renamed && report.details.workspaceSettings.remount && report.details.workspaceSettings.sameDraft);
  for (const method of ["self_test", "integration_self_test"]) {
    check(`worker_${method}`, validWorkerResult(method, await worker(method)));
  }
  const parsed = await worker("parse_adif", { text: "<CALL:4>W1AW<QSO_DATE:8>20260101<TIME_ON:6>120000<BAND:3>20m<MODE:3>SSB<FREQ:5>14.24<COMMENT:17>Synthetic fixture<APP_XLOG_TEST:7>fixture<EOR>" });
  check("worker_parse_adif", validWorkerResult("parse_adif", parsed));

  await fill('[aria-label="Desk Callsign"]', "W1AW");
  await fill('[aria-label="Desk Frequency MHz"]', "14.240000");
  await fill('[aria-label="Desk Mode"]', "SSB");
  await fill('[aria-label="Desk Comment"]', "Isolated native UI acceptance");
  const call = element<HTMLInputElement>('[aria-label="Desk Callsign"]');
  call.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
  await waitForAcceptance("keyboard save and cleared draft", () => element<HTMLInputElement>('[aria-label="Desk Callsign"]').value === "" &&
    document.querySelector<HTMLElement>('.qso-logged-toast[role="status"]')?.textContent === "QSO logged");
  check("keyboard_log", validSavedContact((await worker("logbook_list")).result));
  report.details.adifTransfer = await verifyADIFTransferRoundtrip(worker);
  check("adif_transfer_roundtrip", report.details.adifTransfer.finalContacts === 1);
  await navigate("Logbook");
  await waitForAcceptance("saved QSO row", () => document.querySelector(".live-logbook-table tbody")?.textContent?.includes("W1AW") === true);
  check("logbook_readback", document.querySelectorAll(".live-logbook-table tbody tr").length === 1);
  // keyboard_editor proves focus inside the full editor, not an OS shortcut.
  // Cmd/Ctrl+L now belongs to the native detached Log QSO window; the main
  // Log QSO route is independently available from the native menu (Cmd/Ctrl+2).
  report.details.editorFocus = await verifyEditorFocus({ navigate, worker });
  check("keyboard_editor", true);
  await navigate("Operator Desk");
  await fill('[aria-label="Desk Callsign"]', "TEST2");
  const comment = element<HTMLInputElement>('[aria-label="Desk Comment"]');
  comment.focus();
  comment.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  check("keyboard_focus", document.activeElement?.matches('[aria-label="Desk Callsign"]') === true);
  await click("Clear QSO", ".desk-active button");
  await waitForAcceptance("clear unsaved draft", () => element<HTMLInputElement>('[aria-label="Desk Callsign"]').value === "");
  check("keyboard_clear", validSavedContact((await worker("logbook_list")).result));

  try {
    report.details.deskMapLogbookSize = await invoke("acceptance_desk_size", { action: "expand" });
    await waitForAcceptance("expanded native Desk viewport", () => window.innerHeight >= 1200);
    await frame();
    report.details.deskMapLogbook = await verifyDeskMapLogbook({ worker, navigate, fill, click });
  } finally {
    await invoke("acceptance_desk_size", { action: "restore" });
    await frame();
  }
  check("desk_map_logbook", true);

  await navigate("Logbook");
  await waitForAcceptance("contact row before edit", () => !!document.querySelector(".live-logbook-table tbody tr"));
  // A rendered row can precede refresh completion. The production interaction
  // opens the editor directly from a single row click once loading gates clear.
  element<HTMLElement>(".live-logbook-table tbody tr").click();
  await waitForAcceptance("existing contact editor", () => [...document.querySelectorAll("button")].some(item => item.textContent?.trim() === "Update QSO"));
  await fill('[aria-label="Comment"]', "Revision-safe native edit"); await click("Update QSO");
  await waitForAcceptance("contact editor released", () => ![...document.querySelectorAll("button")].some(item => item.textContent?.trim() === "Update QSO"));
  check("contact_edit", (await worker("logbook_list")).result.qsos[0]?.comment === "Revision-safe native edit");
  // Restore the fixture's exact content through the same user-facing editor.
  await navigate("Logbook");
  await waitForAcceptance("edited contact row", () => document.querySelector(".live-logbook-table tbody")?.textContent?.includes("Revision-safe native edit") === true);
  element<HTMLElement>(".live-logbook-table tbody tr").click();
  await waitForAcceptance("second contact editor", () => [...document.querySelectorAll("button")].some(item => item.textContent?.trim() === "Update QSO"));
  await fill('[aria-label="Comment"]', "Isolated native UI acceptance"); await click("Update QSO");
  await waitForAcceptance("restored contact editor released", () => ![...document.querySelectorAll("button")].some(item => item.textContent?.trim() === "Update QSO"));
  await navigate("Logbook");
  await waitForAcceptance("contact row before delete", () => !!document.querySelector(".live-logbook-table tbody tr"));
  element<HTMLElement>(".live-logbook-table tbody tr").click(); await frame(); await click("Delete QSO");
  await waitForAcceptance("revision-checked delete confirmation", () => [...document.querySelectorAll("button")].some(item => item.textContent?.trim() === "Confirm delete"));
  await click("Confirm delete");
  await waitForAcceptance("contact deleted", () => !document.querySelector(".live-logbook-table tbody tr") && [...document.querySelectorAll<HTMLButtonElement>("button")].some(item => item.textContent?.trim() === "Undo delete" && !item.disabled));
  check("contact_delete_undo", (await worker("logbook_list")).result.total === 0);
  await click("Undo delete");
  await waitForAcceptance("contact restored", () => document.querySelector(".live-logbook-table tbody")?.textContent?.includes("W1AW") === true);
  check("contact_delete_undo", validSavedContact((await worker("logbook_list")).result));

  await click("Undock");
  let logbookWindow: Json | null = null;
  const logbookDeadline = Date.now() + 20_000;
  while (Date.now() < logbookDeadline) {
    const candidate = await invoke<Json | null>("acceptance_logbook_result");
    if (candidate?.status === "passed" || candidate?.status === "failed") {
      logbookWindow = candidate;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!logbookWindow) {
    const nativeState = await invoke<Json>("acceptance_window_state", { kind: "logbook" });
    const visibleError = document.querySelector(".live-error")?.textContent?.trim() || null;
    report.details.detachedLogbookDiagnostic = { nativeState, visibleError };
    throw new Error(`Detached Logbook did not report acceptance: ${JSON.stringify(report.details.detachedLogbookDiagnostic)}`);
  }
  report.details.detachedLogbook = logbookWindow;
  check("detached_logbook", logbookWindow?.status === "passed" && logbookWindow?.details?.surface === "logbook" &&
    logbookWindow?.checks?.contact_edit === true && logbookWindow?.checks?.no_radio_controls === true &&
    validSavedContact((await worker("logbook_list")).result));
  report.details.workspaceWindows = await verifyWorkspaceWindows({ worker, navigate, fill, click }, logbookWindow!, invoke, false);
  check("workspace_native_windows", report.details.workspaceWindows.manualWindowRetained && report.details.workspaceWindows.hiddenWithoutClosing
    && report.details.workspaceWindows.sameRenderer && report.details.workspaceWindows.rendererUnitCoverage
    && report.details.workspaceWindows.restoredVisible && report.details.workspaceWindows.cancelledWithoutSave
    && report.details.workspaceWindows.contactUnchanged && report.details.workspaceWindows.operatorDraftUnchanged);
  report.details.logbookLifecycle = await verifyDetachedLifecycle("logbook", logbookWindow!, () => navigate("Operator Desk"));
  check("detached_logbook_lifecycle", report.details.logbookLifecycle.closed === true);

  await navigate("Settings");
  await waitForAcceptance("station settings", () => !!document.querySelector(".service-fields input"));
  const labels = [...document.querySelectorAll<HTMLLabelElement>(".service-fields label")];
  const stationCall = labels.find(label => label.textContent?.trim() === "Station call")?.querySelector("input");
  if (!stationCall) throw new Error("Station call setting is missing");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(stationCall, "TEST1");
  stationCall.dispatchEvent(new Event("input", { bubbles: true })); await frame();
  await click("Save settings");
  await waitForAcceptance("settings saved", () => document.querySelector(".sidebar-foot")?.textContent?.includes("TEST1") === true);
  check("settings_save_readback", (await worker("settings_load")).result.settings.stationCall === "TEST1");
  if (largeLog) await prepareLargeLog(report, check);
  const awardsStarted = performance.now();
  await navigate("Awards");
  await waitForAcceptance("bundled awards library", () => document.querySelector(".awards-summary b")?.textContent === "192");
  report.details.awardsReadyMs = Math.round(performance.now() - awardsStarted);
  check("awards_loaded", !document.querySelector(".awards-error"));
  await click("Undock", ".awards-window-actions button");
  let awardsWindow: Json | null = null;
  const awardsDeadline = Date.now() + 20_000;
  while (Date.now() < awardsDeadline) {
    awardsWindow = await invoke<Json | null>("acceptance_awards_result");
    if (awardsWindow) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  report.details.detachedAwards = awardsWindow;
  check("detached_awards", awardsWindow?.status === "passed" &&
    awardsWindow?.checks?.catalogue === true && awardsWindow?.checks?.task_only === true);
  report.details.awardsLifecycle = await verifyDetachedLifecycle("awards", awardsWindow!, () => navigate("Operator Desk"));
  check("detached_awards_lifecycle", report.details.awardsLifecycle.closed === true);
  if (largeLog) {
    report.details.performance.awardsFirstOpenMs = report.details.awardsReadyMs;
    await navigate("Operator Desk");
    const repeatStarted = performance.now();
    await navigate("Awards");
    await waitForAcceptance("repeat awards paint", () => !!document.querySelector(".awards-summary b")?.getClientRects().length);
    report.details.performance.awardsRepeatOpenMs = Math.round(performance.now() - repeatStarted);
    check("large_awards_ready", !document.querySelector(".awards-error"));
  }

  await navigate("Band Maps");
  await waitForAcceptance("band maps", () => !!document.querySelector(".band-maps-scale output"));
  const increase = element<HTMLButtonElement>('[aria-label="Increase band map text size"]');
  increase.click(); await frame();
  const scale = element(".band-maps-scale output").textContent;
  report.details.bandMapContext = await verifyBandMapContext(scale);
  await click("Undock");
  let detached: Json | null = null;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    detached = await invoke<Json | null>("acceptance_monitor_result");
    if (detached) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  check("detached_projection", detached?.status === "passed" && detached?.scope === "integrated-local-ui" && detached?.details?.surface === "band-maps" && detached.details.focusedBand === "20m" &&
    detached.details.nativeContext?.synthetic === true && detached.details.nativeContext?.externalOwners === false &&
    detached.details.nativeContext?.generation === report.details.bandMapContext.generation);
  report.details.detached = detached;
  report.details.spotHistory = await verifySpotHistory({ worker, navigate, fill, click });
  check("spot_history_archive", report.details.spotHistory.nativeTable && report.details.spotHistory.draftUnchanged);
  report.details.nativeMenuRoutes = await verifyWorkspaceMenuRoutes({ worker, navigate, click });
  check("native_menu_routes", report.details.nativeMenuRoutes.settingsSync
    && report.details.nativeMenuRoutes.settingsUnchanged && report.details.nativeMenuRoutes.draftUnchanged);
  await invoke("acceptance_prepare_final");
  await navigate("Operator Desk");
  await waitForAcceptance("final operator desk", () => !!document.querySelector('[aria-label="Desk Callsign"]'));
  report.details.finalMap = await awaitMap();
  check("map_loaded", true);
  check("final_desk", element<HTMLInputElement>('[aria-label="Desk Callsign"]').value === "" && validSavedContact((await worker("logbook_list", { search: "W1AW" })).result));
  if (largeLog) {
    await measureLargeHistory(report, check);
    await measureLargeNavigation(report, check);
    report.details.finalMap = await awaitMap();
    check("large_final_desk", element<HTMLInputElement>('[aria-label="Desk Callsign"]').value === "" &&
      (await worker("logbook_list", { limit: 1 })).result.total === LARGE_LOG_RECORDS + 2);
  }
}

async function prepareLargeLog(report: Json, check: (name: string, condition: boolean) => void) {
  const metrics: Json = { ...report.details.performance, fixture_records: LARGE_LOG_RECORDS };
  report.details.performance = metrics;
  const importStarted = performance.now();
  for (let offset = 0; offset < LARGE_LOG_RECORDS; offset += 64) {
    const count = Math.min(64, LARGE_LOG_RECORDS - offset);
    const result = (await worker("logbook_import_adif", { text: largeLogADIFBatch(offset, count) })).result;
    if (result.imported !== count || result.skipped_duplicates !== 0) throw new Error(`Large fixture import incomplete at ${offset}`);
  }
  metrics.importMs = Math.round(performance.now() - importStarted);
  // A normal rendered save publishes the log mutation to the real UI refresh
  // path. Do not time a retained awards panel with pre-import cached state.
  await navigate("Operator Desk");
  await fill('[aria-label="Desk Callsign"]', "PERFTEST");
  await fill('[aria-label="Desk Frequency MHz"]', "14.240000");
  await fill('[aria-label="Desk Mode"]', "SSB");
  element('[aria-label="Desk Callsign"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
  await waitForAcceptance("large-workspace UI save", () => element<HTMLInputElement>('[aria-label="Desk Callsign"]').value === "" && document.body.textContent?.includes("PERFTEST saved") === true);
  metrics.total_records = (await worker("logbook_list", { limit: 1 })).result.total;
  check("large_log_records", metrics.total_records === LARGE_LOG_RECORDS + 2);
  const started = performance.now();
  await navigate("Logbook");
  await waitForAcceptance("large logbook rendered rows", () => document.querySelector(".live-logbook")?.textContent?.includes((LARGE_LOG_RECORDS + 2).toLocaleString()) === true &&
    !!document.querySelector(".live-logbook-table tbody tr"));
  metrics.logbookReadyMs = Math.round(performance.now() - started);
  check("large_logbook_ready", true);
}

async function measureLargeHistory(report: Json, check: (name: string, condition: boolean) => void) {
  const metrics = report.details.performance;
  for (const key of ["historyFirstMs", "historyRepeatMs"]) {
    const started = performance.now();
    const history = (await worker("cluster_history", { call: "DL1T0", adif: 230 })).result.history;
    metrics[key] = Math.round(performance.now() - started);
    if (history.previous_count !== 50 || history.dxcc_contact_count !== 12_500) throw new Error("Large fixture history totals do not match");
  }
  const started = performance.now();
  await fill('[aria-label="Desk Callsign"]', "DL1T0");
  await waitForAcceptance("rendered large-log callsign intelligence", () => document.querySelector(".desk-matrices h3 small")?.textContent?.includes("50 worked") === true);
  metrics.historyRenderedMs = Math.round(performance.now() - started);
  check("large_history_ready", true);
  await click("Clear QSO", ".desk-active button");
  await waitForAcceptance("large-test draft cleared", () => element<HTMLInputElement>('[aria-label="Desk Callsign"]').value === "");
}

async function measureLargeNavigation(report: Json, check: (name: string, condition: boolean) => void) {
  const routes = ["Logbook", "DX Cluster", "Band Maps", "Awards", "Settings", "Operator Desk"];
  const samples = Object.fromEntries(routes.map(route => [route, [] as number[]])) as Record<string, number[]>;
  for (let cycle = 0; cycle < 5; cycle++) {
    for (const route of routes) {
      const started = performance.now();
      await navigate(route);
      samples[route].push(Math.round(performance.now() - started));
    }
  }
  report.details.performance.navigationMs = samples;
  check("large_navigation_ready", Object.values(samples).every(values => values.length === 5 && values.every(value => Number.isFinite(value) && value >= 0)));
}

export async function startIntegratedAcceptance() {
  const root = document.documentElement;
  if (root.dataset.integratedAcceptance) return;
  root.dataset.integratedAcceptance = "checking";
  if (!await invoke<boolean>("acceptance_enabled")) {
    delete root.dataset.integratedAcceptance;
    return;
  }
  root.dataset.integratedAcceptance = "active";
  const surface = new URLSearchParams(location.search).get("view");
  const report: Json = { schema: 1, scope: "integrated-local-ui", status: "failed", embeddedUi: false, worker: false, checks: {}, details: { surface: surface || "main" } };
  if (!surface) report.details.mainInstanceID = crypto.randomUUID();
  try {
    await waitForAcceptance("integrated UI mount", () => !!document.querySelector(".app.live"));
    report.embeddedUi = true;
    if (surface) {
      report.status = "running";
      report.details.stage = "mounted";
      await invoke("acceptance_monitor", { report });
    }
    if (!surface) report.details.performance = { appUiMountMs: Math.round(performance.now()) };
    if (!surface && await resumeSpotHistoryAbsence(report, worker, navigate, awaitMap)) {
      report.status = "passed";
      await invoke("finish_acceptance", { report });
      return;
    }
    if (surface === "spot-history") {
      await serveSpotHistoryAbsence(report, worker, click);
      return;
    }
    if (surface === "monitor") {
      const context = await invoke("monitor_context_snapshot");
      if (!validMonitorContext(context) || !context.acceptance) throw new Error("Monitor acceptance did not provide isolated synthetic context.");
      await waitForAcceptance("isolated independent monitor", () => !!document.querySelector('[aria-label="Detached Station Monitor"]') &&
        document.querySelector(".monitor-vfos")?.textContent?.includes("14.074000") === true);
      report.checks.synthetic_read_only = !document.querySelector(".monitor-actions button") &&
        document.body.textContent?.includes("Synthetic isolated observation · read only") === true;
      report.details.nativeContext = context.acceptance;
      report.details.boundary = "Memory-only read/render proof; no hardware actions or native window lifecycle acceptance.";
      report.status = report.checks.synthetic_read_only ? "passed" : "failed";
      await invoke("acceptance_monitor", { report });
      return;
    }
    if (surface === "band-maps") {
      await waitForAcceptance("detached native band map", () => !!document.querySelector('.band-maps-focused [aria-label="20m band map"]') && !document.querySelector(".live-error"));
      report.checks.focused_chrome = document.querySelectorAll(".band-map-panel").length === 1 &&
        !document.querySelector(".band-maps-head, .band-maps-intelligence, .band-maps-scale") &&
        !!document.querySelector('[aria-label="20m mode visibility settings"]');
      if (!report.checks.focused_chrome) throw new Error("Detached band map contains workspace chrome or lacks mode settings");
      report.details.focusedBand = "20m";
      report.details.nativeContext = await verifyBandMapContext(null, true);
      report.status = "passed";
      await invoke("acceptance_monitor", { report });
      return;
    }
    if (surface === "awards") {
      report.details.instanceID = crypto.randomUUID();
      await waitForAcceptance("detached Awards library", () => document.querySelector(".awards-summary b")?.textContent === "192");
      report.checks.catalogue = !document.querySelector(".awards-error") && (await worker("logbook_catalog", { offset: 0, limit: 1 })).result.catalogue_total === 192;
      report.checks.task_only = !!document.querySelector('.detached-awards-app main[aria-label="Detached Awards"]') &&
        !document.querySelector(".qso-read-radio, .detached-window-head") &&
        ![...document.querySelectorAll("button")].some(item => item.textContent?.trim() === "Dock back");
      report.status = report.checks.catalogue && report.checks.task_only ? "passed" : "failed";
      await invoke("acceptance_monitor", { report });
      return;
    }
    if (surface === "logbook") {
      report.details.instanceID = crypto.randomUUID();
      report.details.stage = "waiting-for-rows";
      await invoke("acceptance_monitor", { report });
      await waitForAcceptance("detached logbook rows", () => document.querySelector(".live-logbook-table tbody")?.textContent?.includes("W1AW") === true);
      report.details.stage = "editing-contact";
      await invoke("acceptance_monitor", { report });
      for (const [index, comment] of ["Detached native edit", "Isolated native UI acceptance"].entries()) {
        await waitForAcceptance("detached logbook table ready", () => document.querySelector(".live-logbook-table-wrap")?.getAttribute("aria-busy") === "false");
        report.details.stage = `opening-contact-${index + 1}`;
        await invoke("acceptance_monitor", { report });
        element<HTMLElement>(".live-logbook-table tbody tr").click(); await frame();
        report.details.stage = `waiting-for-editor-${index + 1}`;
        await invoke("acceptance_monitor", { report });
        await waitForAcceptance("detached contact editor", () => !!document.querySelector('[aria-label="Comment"]'));
        report.checks.no_radio_controls = !document.querySelector(".qso-read-radio") && !document.querySelector(".qso-footer-context input");
        await fill('[aria-label="Comment"]', comment); await click("Update QSO");
        report.details.stage = `waiting-for-readback-${index + 1}`;
        await invoke("acceptance_monitor", { report });
        await waitForAcceptance("detached update readback", () => document.querySelector(".live-logbook-table tbody")?.textContent?.includes(comment) === true);
      }
      report.checks.contact_edit = validSavedContact((await worker("logbook_list")).result);
      report.status = report.checks.contact_edit && report.checks.no_radio_controls ? "passed" : "failed";
      await invoke("acceptance_monitor", { report });
      return;
    }
    if (surface) throw new Error("Unexpected local acceptance surface");
    await main(report);
    report.status = "passed";
    await beginSpotHistoryAbsence(report, worker);
    return; // Native coordinator owns progress after destroying this renderer.
  } catch (error) {
    report.status = "failed";
    report.error = error instanceof Error ? error.message : typeof error === "string" ? error : "Integrated UI acceptance failed";
    report.details.failureMap = mapDetails();
  }
  await invoke(surface ? "acceptance_monitor" : "finish_acceptance", { report });
}

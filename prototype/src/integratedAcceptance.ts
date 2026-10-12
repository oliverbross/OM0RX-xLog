import { invoke } from "@tauri-apps/api/core";
import { awaitMap, mapDetails, validWorkerResult, waitForAcceptance } from "./acceptance";

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
async function click(name: string, selector = "button") { button(name, selector).click(); await frame(); }
async function navigate(name: string) { await click(name, ".sidebar nav button"); }
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
  check("workspace_created", (await worker("workspace_status")).result.workspace_exists === true);
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
  await waitForAcceptance("keyboard save and cleared draft", () => element<HTMLInputElement>('[aria-label="Desk Callsign"]').value === "" && document.body.textContent?.includes("W1AW saved") === true);
  check("keyboard_log", validSavedContact((await worker("logbook_list")).result));
  await navigate("Logbook");
  await waitForAcceptance("saved QSO row", () => document.querySelector(".live-logbook-table tbody")?.textContent?.includes("W1AW") === true);
  check("logbook_readback", document.querySelectorAll(".live-logbook-table tbody tr").length === 1);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "l", ctrlKey: true, bubbles: true, cancelable: true }));
  await waitForAcceptance("full editor shortcut", () => document.activeElement?.matches(".qso-call input") === true);
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
  await navigate("Awards");
  const awardsStarted = performance.now();
  await waitForAcceptance("bundled awards library", () => document.querySelector(".awards-summary b")?.textContent === "192");
  report.details.awardsReadyMs = Math.round(performance.now() - awardsStarted);
  check("awards_loaded", !document.querySelector(".awards-error"));

  await navigate("Band Maps");
  await waitForAcceptance("band maps", () => !!document.querySelector(".band-maps-scale output"));
  const increase = element<HTMLButtonElement>('[aria-label="Increase band map text size"]');
  increase.click(); await frame();
  const scale = element(".band-maps-scale output").textContent;
  await click("Undock");
  let detached: Json | null = null;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    detached = await invoke<Json | null>("acceptance_monitor_result");
    if (detached) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  check("detached_projection", detached?.status === "passed" && detached?.scope === "integrated-local-ui" && detached?.details?.surface === "band-maps" && detached.details.scale === scale);
  report.details.detached = detached;
  await invoke("acceptance_prepare_final");
  await navigate("Operator Desk");
  await waitForAcceptance("final operator desk", () => !!document.querySelector('[aria-label="Desk Callsign"]'));
  report.details.finalMap = await awaitMap();
  check("map_loaded", true);
  check("final_desk", element<HTMLInputElement>('[aria-label="Desk Callsign"]').value === "" && validSavedContact((await worker("logbook_list")).result));
}

let started = false;
export async function startIntegratedAcceptance() {
  if (started || !await invoke<boolean>("acceptance_enabled")) return;
  started = true;
  const surface = new URLSearchParams(location.search).get("view");
  const report: Json = { schema: 1, scope: "integrated-local-ui", status: "failed", embeddedUi: false, worker: false, checks: {}, details: { surface: surface || "main" } };
  try {
    await waitForAcceptance("integrated UI mount", () => !!document.querySelector(".app.live"));
    report.embeddedUi = true;
    if (surface === "band-maps") {
      await waitForAcceptance("main-window band map projection", () => !!document.querySelector(".band-maps-scale output") && !document.body.textContent?.includes("Waiting for the main workspace projection"));
      report.details.scale = element(".band-maps-scale output").textContent;
      report.status = "passed";
      await invoke("acceptance_monitor", { report });
      return;
    }
    if (surface) throw new Error("Unexpected local acceptance surface");
    await main(report);
    report.status = "passed";
  } catch (error) {
    report.error = error instanceof Error ? error.message : "Integrated UI acceptance failed";
    report.details.failureMap = mapDetails();
  }
  await invoke(surface ? "acceptance_monitor" : "finish_acceptance", { report });
}

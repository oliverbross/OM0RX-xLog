import { invoke } from "@tauri-apps/api/core";

type Json = Record<string, unknown>;
export type AcceptanceReport = {
  schema: 1;
  status: "passed" | "failed";
  embeddedUi: boolean;
  worker: boolean;
  checks: Record<string, boolean>;
  details: Json;
  error?: string;
};

// The Rust shell alone enables this path, using an explicit acceptance CLI flag.
// One run per webview also avoids StrictMode repeating interactions or windows.
let started = false;
export let acceptanceActive = false;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export async function waitForAcceptance(
  label: string,
  condition: () => boolean,
  timeout = 20_000,
) {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`);
    await pause(50);
  }
}
function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing rendered control: ${selector}`);
  return found;
}
function button(name: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((control) => control.textContent?.trim() === name);
  if (!found || found.disabled) throw new Error(`Unavailable rendered button: ${name}`);
  return found;
}
function key(key: string, ctrlKey = false) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey, bubbles: true, cancelable: true }));
}
const call = () => element<HTMLInputElement>('input[aria-label="Callsign"]').value;
const frequency = () => element<HTMLInputElement>('input[aria-label="Frequency MHz"]').value;
const mode = () => element<HTMLSelectElement>('select[aria-label="Mode"]').value;
const qsoCount = () => Number(element(".rail-end b").textContent?.match(/^(\d+) session QSOs$/)?.[1]);
function selectProfile(value: string) {
  const control = element<HTMLSelectElement>('select[aria-label="Station profile"]');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(control, value);
  control.dispatchEvent(new Event("change", { bubbles: true }));
}
function mapDetails(): Json {
  const map = document.querySelector<HTMLElement>(".map");
  const canvas = map?.querySelector("canvas");
  return {
    loaded: map?.dataset.mapLoaded === "true",
    landFeatures: Number(map?.dataset.landFeatures ?? 0),
    renderedLandFeatures: Number(map?.dataset.renderedLandFeatures ?? 0),
    canvasWidth: canvas?.width ?? 0,
    canvasHeight: canvas?.height ?? 0,
    webgl: map?.dataset.webgl === "true",
    error: map?.dataset.mapError || document.querySelector(".map-error")?.textContent || "",
    visible: Boolean(map && map.getBoundingClientRect().width > 0 && map.getBoundingClientRect().height > 0),
  };
}
export function validMapEvidence(map: Json) {
  return map.loaded === true && Number(map.landFeatures) > 0 && Number(map.renderedLandFeatures) > 0 && Number(map.canvasWidth) > 0 &&
    Number(map.canvasHeight) > 0 && map.webgl === true && map.error === "" && map.visible === true;
}
export function validWorkerResult(method: string, response: Json) {
  if (response.ok !== true || typeof response.id !== "string" || !response.id) return false;
  const result = response.result as Json | undefined;
  if (!result) return false;
  if (method === "health") return result.protocol_version === 1 && result.worker === "xlog-prototype-worker" &&
    result.mode === "synthetic_only" && result.station_io === false;
  if (method === "self_test") return result.passed === true && result.sqlite === "memory_readback_passed" &&
    result.xml === "fixture_parse_passed" && result.adif === "existing_core_roundtrip_passed" &&
    result.foundation_http === "urlsession_protocol_fixture_passed" &&
    result.sha256 === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" &&
    result.station_io === false && result.file_io === false && result.network_contact === false;
  if (method !== "parse_adif") return false;
  const records = result.records as Json[] | undefined;
  const fields = records?.[0]?.fields as Json | undefined;
  const qso = records?.[0]?.qso as Json | undefined;
  return result.record_count === 1 && records?.length === 1 && result.core_source === "Sources/XLogCore" &&
    fields?.CALL === "W1AW" && fields.APP_XLOG_TEST === "fixture" && fields.COMMENT === "Synthetic fixture" &&
    qso?.call === "W1AW" && qso.frequency_hz === 14_240_000 && qso.mode === "SSB" &&
    typeof records[0].semantic_identity_hash === "string" && /^[a-f0-9]{64}$/.test(records[0].semantic_identity_hash);
}
async function awaitMap() {
  await waitForAcceptance("loaded local geography and healthy WebGL canvas", () => {
    const evidence = mapDetails();
    if (evidence.error) throw new Error(`Map failed: ${evidence.error}`);
    return validMapEvidence(evidence);
  }, 25_000);
  return mapDetails();
}
async function checkWorker(method: string, name: string) {
  const previous = element(".check-output").textContent;
  button(name).click();
  await waitForAcceptance(`worker ${method} response`, () =>
    !document.querySelector(".checks [role=status]") && element(".check-output").textContent !== previous);
  const response = JSON.parse(element(".check-output").textContent || "{}") as Json;
  if (!validWorkerResult(method, response)) throw new Error(`Worker ${method} returned invalid evidence`);
  return response;
}
async function loadFixture() {
  button("DX Cluster").click();
  await waitForAcceptance("cluster fixture button", () => Boolean(document.querySelector(".cluster .call-button")));
  button("W1AW").click();
  await waitForAcceptance("cluster draft and simulated radio", () =>
    Boolean(document.querySelector('input[aria-label="Callsign"]')) && call() === "W1AW" &&
    frequency() === "14.240000" && mode() === "SSB" &&
    document.querySelector(".station-rail")?.textContent?.includes("SSB · 14.240000 MHz") === true);
}
async function runMain(report: AcceptanceReport) {
  report.details.initialMap = await awaitMap();
  report.checks.map_loaded = true;
  button("Prototype Checks").click();
  await waitForAcceptance("worker check controls", () => Boolean(document.querySelector(".check-output")));
  for (const [method, name] of [["health", "Check worker health"], ["self_test", "Run worker self-test"], ["parse_adif", "Parse synthetic ADIF"]]) {
    report.details[method] = await checkWorker(method, name);
    report.checks[`worker_${method}`] = true;
  }
  report.worker = ["health", "self_test", "parse_adif"].every((method) => report.checks[`worker_${method}`]);
  await loadFixture();
  report.checks.cluster_selection = true;
  const before = qsoCount();
  if (before !== 0) throw new Error(`Acceptance requires an empty synthetic session, observed ${before} QSOs`);
  key("Enter", true);
  await waitForAcceptance("Ctrl+Enter saved one memory QSO", () => call() === "" && qsoCount() === before + 1);
  report.checks.keyboard_log = true;
  button("Logbook").click();
  await waitForAcceptance("rendered saved QSO", () => {
    const rows = [...document.querySelectorAll(".logbook tbody tr")];
    return rows.length === 1 && rows[0].textContent?.includes("W1AW14.240000SSB") === true;
  });
  report.checks.logbook_readback = true;
  key("F2");
  await waitForAcceptance("F2 callsign focus", () => document.activeElement?.getAttribute("aria-label") === "Callsign");
  report.checks.keyboard_focus = true;
  await loadFixture();
  key("Escape");
  await waitForAcceptance("Escape clears draft", () => call() === "" && document.activeElement?.getAttribute("aria-label") === "Callsign");
  report.checks.keyboard_clear = true;
  await loadFixture();
  selectProfile("manual");
  await waitForAcceptance("manual profile preserves draft and disables simulated read", () =>
    element<HTMLSelectElement>('select[aria-label="Station profile"]').value === "manual" &&
    document.querySelector(".station-rail")?.textContent?.includes("Manual / disconnected") === true &&
    [...document.querySelectorAll<HTMLButtonElement>("button")].some((control) => control.textContent?.includes("Read simulated radio") && control.disabled) && call() === "W1AW");
  report.checks.profile_manual = true;
  selectProfile("simulator");
  await waitForAcceptance("simulator profile readback", () =>
    element<HTMLSelectElement>('select[aria-label="Station profile"]').value === "simulator" &&
    !button("Read simulated radio").disabled && call() === "W1AW");
  report.checks.profile_simulator = true;
  report.details.finalMap = await awaitMap();
  button("Detach monitor").click();
  await waitForAcceptance("native monitor open result", () => document.querySelector(".status-line")?.textContent?.includes("Detached station monitor opened") === true);
  report.checks.monitor_opened = true;
  let monitor: AcceptanceReport | null = null;
  const deadline = Date.now() + 25_000;
  while (!monitor) {
    if (Date.now() >= deadline) throw new Error("Timed out: native monitor rendered snapshot");
    monitor = await invoke<AcceptanceReport | null>("acceptance_monitor_result");
    if (!monitor) await pause(100);
  }
  report.details.monitor = monitor;
  report.checks.monitor_snapshot = monitor.schema === 1 && monitor.status === "passed" && monitor.embeddedUi === true &&
    monitor.checks.monitor_rendered === true && monitor.checks.map_loaded === true &&
    monitor.details.frequency === frequency() && monitor.details.call === call() && monitor.details.mode === mode() &&
    monitor.details.profile === element<HTMLSelectElement>('select[aria-label="Station profile"]').value &&
    monitor.details.qsoCount === qsoCount() && validMapEvidence(monitor.details.map as Json);
  if (!report.checks.monitor_snapshot) throw new Error(`Native monitor acceptance failed: ${monitor.error || "shared snapshot mismatch"}`);
  report.details.qsoCount = qsoCount();
  report.details.frequency = frequency();
  report.details.call = call();
  report.details.mode = mode();
  report.checks.final_desk = document.querySelector(".workspace-heading h1")?.textContent === "Operator Desk" &&
    validMapEvidence(mapDetails()) && qsoCount() === 1;
  if (!report.checks.final_desk) throw new Error("Final operator desk or map is unavailable");
}

async function runMonitor(report: AcceptanceReport) {
  report.details.map = await awaitMap();
  report.checks.map_loaded = true;
  await waitForAcceptance("shared monitor snapshot", () => document.querySelector(".monitor-readback")?.textContent?.includes("W1AW") === true);
  const readback = element(".monitor-readback");
  report.details.frequency = readback.querySelector("strong")?.textContent?.replace("MHz", "").trim();
  const active = [...readback.querySelectorAll("span")].at(-1)?.textContent?.trim().split(" · ");
  report.details.mode = active?.[0];
  report.details.call = active?.[1];
  report.details.profile = readback.textContent?.includes("SIMULATED RADIO") ? "simulator" : "manual";
  report.details.qsoCount = Number(element(".pulse dd:last-of-type").textContent?.match(/^(\d+) session QSOs$/)?.[1]);
  report.checks.monitor_rendered = report.details.frequency === "14.240000" && report.details.mode === "SSB" &&
    report.details.call === "W1AW" && report.details.profile === "simulator" && report.details.qsoCount === 1;
  if (!report.checks.monitor_rendered) throw new Error("Monitor rendered a mismatched shared snapshot");
}
function showFailure(error: string) {
  const diagnostic = document.createElement("pre");
  diagnostic.setAttribute("role", "alert");
  diagnostic.textContent = `Native acceptance failed: ${error}`;
  document.body.append(diagnostic);
}
export function startAcceptance(monitor: boolean) {
  if (started) return;
  started = true;
  void invoke<boolean>("acceptance_enabled").then(async (enabled) => {
    if (!enabled) return;
    acceptanceActive = true;
    document.dispatchEvent(new Event("xlog-native-acceptance"));
    const report: AcceptanceReport = { schema: 1, status: "failed", embeddedUi: false, worker: false, checks: {}, details: {} };
    try {
      await pause(0);
      report.embeddedUi = Boolean(document.querySelector(monitor ? ".monitor-app" : ".app"));
      if (!report.embeddedUi) throw new Error("Native UI did not mount");
      await (monitor ? runMonitor(report) : runMain(report));
      report.status = "passed";
    } catch (error) {
      report.error = error instanceof Error ? error.message : String(error);
      showFailure(report.error);
    }
    await invoke(monitor ? "acceptance_monitor" : "finish_acceptance", { report });
  }).catch((error) => showFailure(String(error)));
}

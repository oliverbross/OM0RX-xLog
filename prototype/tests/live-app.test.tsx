// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LiveApp, { boundedCallsignLookup, syncSettingsDestination } from "../src/LiveApp";
import Conditions from "../src/live/Conditions";
import Monitor from "../src/live/Monitor";
import { operatorDraftFixture, testPreferenceSnapshot, testWorkspaceGeneration } from "./operator-draft-fixture";
import { contactEditFixture } from "./contact-edit-fixture";
import { readContactJournal } from "../src/live/logbookContactSession";
import { defaultRotorConfiguration } from "../src/live/rotorConfigurationSession";
const calls = vi.hoisted(() => ({ request: vi.fn() }));
const nativeMenu = vi.hoisted(() => ({ route: undefined as ((title: string) => void) | undefined }));
const clusterStartup = vi.hoisted(() => ({ native: false, initialize: vi.fn() }));
const activation = vi.hoisted(() => ({ activate: vi.fn(), reconcile: vi.fn() }));
const editor = vi.hoisted(() => ({ reconcile: vi.fn() }));
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
const moduleAuthority = vi.hoisted(() => ({ selected: "normal_logging" as "normal_logging" | "contesting", switch: vi.fn() }));
vi.mock("@tauri-apps/api/core", async importOriginal => ({ ...await importOriginal<typeof import("@tauri-apps/api/core")>(), invoke: native.invoke }));
vi.mock("../src/operatingModule", async importOriginal => ({ ...await importOriginal<typeof import("../src/operatingModule")>(),
  operatingModuleStatus: async () => ({ selected: moduleAuthority.selected, context: "test-module-context", transitioning: false }),
  switchOperatingModule: moduleAuthority.switch }));
vi.mock("../src/live/clusterResume", async importOriginal => ({ ...await importOriginal<typeof import("../src/live/clusterResume")>(),
  nativeClusterSession: () => clusterStartup.native, initializeNativeClusterResume: clusterStartup.initialize }));
vi.mock("../src/live/workspaceNavigation", async importOriginal => ({ ...await importOriginal<typeof import("../src/live/workspaceNavigation")>(),
  connectWorkspaceNavigation: (route: (title: string) => void) => { nativeMenu.route = route; return () => { nativeMenu.route = undefined; }; } }));
vi.mock("../src/worker", async (importOriginal) => ({ ...await importOriginal<typeof import("../src/worker")>(),
  workerRequest: calls.request, framedWorkerRequest: calls.request, openMonitor: vi.fn() }));
vi.mock("../src/live/operatorDraftTransport", () => ({ requestOperatorDraft: async (method: string, params: any = {}) => (await calls.request(method, params)).result }));
vi.mock("../src/live/logbookContactTransport", () => ({ requestLogbookContact: async (method: string, params: any = {}) => (await calls.request(method, params)).result }));
vi.mock("../src/live/useSpotActivation", () => ({ useSpotActivation: () => ({ status: null, error: "", requesting: false, checked: false,
  activate: activation.activate, reconcile: activation.reconcile, retire: vi.fn() }) }));
vi.mock("../src/live/useSpotEditor", () => ({ nativeSpotEditor: () => false, useSpotEditor: () => ({
  status: null, error: "", initializing: false, reconcile: editor.reconcile,
}) }));
vi.mock("../src/Map", () => ({ default: () => <div>Map surface</div> }));
let exists = false, draftBackend: ReturnType<typeof operatorDraftFixture>;
beforeEach(() => {
  exists = false; localStorage.clear(); calls.request.mockReset();
  clusterStartup.native = false; clusterStartup.initialize.mockReset().mockResolvedValue(undefined);
  activation.activate.mockReset(); activation.reconcile.mockReset().mockResolvedValue(true);
  editor.reconcile.mockReset().mockResolvedValue(true); native.invoke.mockReset();
  moduleAuthority.selected = "normal_logging"; moduleAuthority.switch.mockReset().mockResolvedValue(undefined);
  draftBackend = operatorDraftFixture({ id: "draft", start: "2026-10-12T00:00:00Z", call: "", band: "20m", mode: "SSB" });
  calls.request.mockImplementation(async (method: string, params: any = {}) => {
    const shared = draftBackend(method, params);
    if (shared) return { ok: true, result: shared };
    const result = method === "workspace_status" ? { workspace_exists: exists, native_log_exists: true }
      : method === "workspace_create" ? (exists = true, { mode: "copy_native" })
      : method === "cluster_snapshot" ? { snapshot: { spots: [], connectedClusters: 0 } }
      : method === "station_snapshot" ? { source: "xcat_loopback", available: false, radio: null }
      : method === "settings_load" ? { settings: { stationCall: "", gridSquare: "" }, revision: 0, generation: testWorkspaceGeneration }
      : method === "workspace_rotor_configuration_load" ? { revision: 0, generation: testWorkspaceGeneration, configuration: defaultRotorConfiguration() }
      : method === "workspace_preferences_load" ? testPreferenceSnapshot({ bandMapFontScale: 1.2 })
      : method === "logbook_stats" ? { stats: { qso_count: 0 } }
      : method === "logbook_draft" ? { qso: { id: "draft", start: "2026-10-12T00:00:00Z", call: "", band: "20m", mode: "SSB" } }
      : method === "lookup_call" ? { source: "No match" }
      : method === "logbook_previous" ? { qsos: [] } : {};
    return { ok: true, result };
  });
});
afterEach(cleanup);

it("settles a stalled callsign lookup instead of leaving intelligence pending", async () => {
  vi.useFakeTimers();
  try {
    const lookup = boundedCallsignLookup(vi.fn(() => new Promise(() => {})), "K1ABC", 100);
    const rejected = expect(lookup).rejects.toThrow("Callsign lookup timed out");
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
  } finally {
    vi.useRealTimers();
  }
});

it("retries settings-busy profiles until success without settling the sentinel", async () => {
  vi.useFakeTimers();
  try {
    const request = vi.fn()
      .mockResolvedValueOnce({ call: "K1ABC", qrz_status: "settings_busy" })
      .mockResolvedValueOnce({ call: "K1ABC", qrz_status: "settings_busy" })
      .mockResolvedValueOnce({ call: "K1ABC", qrz_status: "matched", source: "QRZ" });
    const lookup = boundedCallsignLookup(request, "K1ABC", 1_000);
    await vi.advanceTimersByTimeAsync(500);
    await expect(lookup).resolves.toMatchObject({ qrz_status: "matched" });
    expect(request).toHaveBeenCalledTimes(3);
  } finally { vi.useRealTimers(); }
});

it("bounds repeated settings-busy profiles with the lookup deadline", async () => {
  vi.useFakeTimers();
  try {
    const request = vi.fn().mockResolvedValue({ call: "K1ABC", qrz_status: "settings_busy" });
    const lookup = boundedCallsignLookup(request, "K1ABC", 600);
    const rejected = expect(lookup).rejects.toThrow("Callsign lookup timed out");
    await vi.advanceTimersByTimeAsync(600); await rejected;
    expect(request.mock.calls.length).toBeGreaterThanOrEqual(3);
  } finally { vi.useRealTimers(); }
});

it("single-flights callsign lookup until timeout, then lets a restarted worker retry", async () => {
  vi.useFakeTimers();
  try {
    let settle!: (value: unknown) => void;
    const request = vi.fn(() => request.mock.calls.length === 1
      ? new Promise(resolve => { settle = resolve; })
      : Promise.resolve({ call: "K1ABC", source: "Recovered lookup" }));
    const first = expect(boundedCallsignLookup(request, "K1ABC", 100)).rejects.toThrow("Callsign lookup timed out");
    const joined = expect(boundedCallsignLookup(request, "k1abc", 100)).rejects.toThrow("Callsign lookup timed out");
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100); await first; await joined;
    const recovered = boundedCallsignLookup(request, "k1abc", 100);
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(2);
    await expect(recovered).resolves.toMatchObject({ source: "Recovered lookup" });
    settle({ call: "K1ABC", source: "Late first lookup" });
    await vi.advanceTimersByTimeAsync(0);
    await expect(boundedCallsignLookup(request, "K1ABC", 100)).resolves.toMatchObject({ source: "Recovered lookup" });
    expect(request).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});

it("recovers a saved Operator Desk callsign after one transient launch lookup failure", async () => {
  exists = true;
  draftBackend = operatorDraftFixture({ id: "draft", start: "2026-10-12T00:00:00Z", call: "K1ABC", band: "20m", mode: "SSB" });
  const backend = calls.request.getMockImplementation()!;
  let attempts = 0;
  calls.request.mockImplementation((method, params) => method === "lookup_call"
    ? ++attempts === 1 ? Promise.reject(new Error("Worker warming up"))
      : Promise.resolve({ ok: true, result: { call: params.call, source: "Recovered lookup", country: "United States", dxcc: 291 } })
    : backend(method, params));
  render(<LiveApp />);
  await waitFor(() => expect(attempts).toBe(2), { timeout: 2_500 });
  expect(await screen.findByText("Recovered lookup")).toBeTruthy();
  expect(screen.getAllByText("USA").length).toBeGreaterThan(0);
  expect(screen.queryByText("Worker warming up")).toBeNull();
});

it("retries a fulfilled settings-loading callsign result once", async () => {
  exists = true;
  draftBackend = operatorDraftFixture({ id: "draft", start: "2026-10-12T00:00:00Z", call: "IQ2MM/P", band: "20m", mode: "SSB" });
  const backend = calls.request.getMockImplementation()!;
  let attempts = 0;
  calls.request.mockImplementation((method, params) => method === "lookup_call"
    ? Promise.resolve({ ok: true, result: ++attempts === 1
      ? { call: params.call, country: "ITALY", qrz_status: "unavailable", lookup_warning: "Workspace settings are still loading. Offline CTY result retained." }
      : { call: params.call, country: "ITALY", qrz_status: "matched", source: "QRZ", name: "Portable operator" } })
    : backend(method, params));
  render(<LiveApp />);
  await waitFor(() => expect(attempts).toBe(2), { timeout: 2_500 });
  expect(await screen.findByText("Portable operator")).toBeTruthy();
});

it.each(["missing", "unavailable", "pending"])("keeps Settings reachable with a %s workspace without creating or editing station data", async state => {
  const backend = calls.request.getMockImplementation()!;
  calls.request.mockImplementation((method, params) => method === "workspace_status" && state !== "missing"
    ? state === "pending" ? new Promise(() => {}) : Promise.reject(new Error("Workspace disk unavailable"))
    : backend(method, params));
  render(<LiveApp />);
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  const recovery = await screen.findByRole("region", { name: "Settings recovery" });
  expect(within(recovery).getByRole("heading", { name: "Settings" })).toBeTruthy();
  expect(within(recovery).getByLabelText("Shared Agent HTTPS URL")).toBeTruthy();
  expect(screen.getByRole("main", { name: "Settings" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Save settings" })).toBeNull();
  await act(async () => nativeMenu.route?.("Operator Desk"));
  await act(async () => nativeMenu.route?.("Settings"));
  expect(screen.getByRole("region", { name: "Settings recovery" })).toBeTruthy();
  expect(calls.request.mock.calls.some(([method]) => ["workspace_create", "settings_save", "station_connect", "station_tune", "logbook_operator_draft_apply"].includes(method))).toBe(false);
  if (state === "missing") expect(await screen.findByRole("button", { name: "Copy my existing xLog logbook" })).toBeTruthy();
  else expect(screen.queryByRole("button", { name: "Create empty logbook" })).toBeNull();
});

it.each([
  ["Copy my existing xLog logbook", "copy_native"],
  ["Create empty logbook", "empty"],
])("retains the explicit %s action while recovering in Settings", async (label, mode) => {
  render(<LiveApp />);
  await screen.findByRole("button", { name: "Copy my existing xLog logbook" });
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("button", { name: label }));
  await screen.findByRole("region", { name: "Station and service settings" });
  expect(calls.request).toHaveBeenCalledWith("workspace_create", { mode });
  expect(screen.queryByRole("region", { name: "Settings recovery" })).toBeNull();
});

it("retries an unavailable workspace from Settings and retains the selected destination", async () => {
  const backend = calls.request.getMockImplementation()!;
  let unavailable = true;
  calls.request.mockImplementation((method, params) => method === "workspace_status" && unavailable
    ? Promise.reject(new Error("Workspace disk unavailable")) : backend(method, params));
  render(<LiveApp />);
  await screen.findByRole("button", { name: "Retry connection" });
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  unavailable = false; exists = true;
  fireEvent.click(screen.getByRole("button", { name: "Retry connection" }));
  await screen.findByRole("region", { name: "Station and service settings" });
  expect(screen.getByRole("main", { name: "Settings" })).toBeTruthy();
  expect(calls.request.mock.calls.some(([method]) => method === "workspace_create")).toBe(false);
});

it("allows read-only Spot History diagnostics while workspace editors remain gated", async () => {
  render(<LiveApp />);
  await screen.findByRole("button", { name: "Copy my existing xLog logbook" });
  fireEvent.click(screen.getByRole("button", { name: "Spot History" }));
  await waitFor(() => expect(calls.request.mock.calls.some(([method]) => method === "spot_history_status")).toBe(true));
  expect(screen.getByRole("main", { name: "Spot History" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Log QSO" }));
  expect(screen.queryByLabelText("Callsign")).toBeNull();
  expect(screen.getByRole("button", { name: "Create empty logbook" })).toBeTruthy();
  expect(calls.request.mock.calls.some(([method]) => ["workspace_create", "logbook_operator_draft_apply", "settings_save"].includes(method))).toBe(false);
});

it("refreshes when sync has already finished before the first summary response", async () => {
  exists = true;
  vi.useFakeTimers();
  let complete!: (value: unknown) => void, reads = 0, count = 0;
  const summary = { result: { running: false, completion_id: "first", status: "Completed" } };
  const backend = calls.request.getMockImplementation()!;
  calls.request.mockImplementation((method, params) => method === "sync_summary"
    ? ++reads === 1 ? new Promise(resolve => { complete = resolve; }) : Promise.resolve(summary)
    : method === "logbook_stats" ? Promise.resolve({ result: { stats: { qso_count: count } } }) : backend(method, params));
  try {
    await act(async () => { render(<LiveApp />); });
    expect(screen.getByText("0 contacts · Integrated logbook")).toBeTruthy();
    const reloads = calls.request.mock.calls.filter(([method]) => method === "workspace_status").length;
    count = 17;
    await act(async () => { complete(summary); });
    expect(screen.getByText("17 contacts · Integrated logbook")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(calls.request.mock.calls.filter(([method]) => method === "workspace_status")).toHaveLength(reloads + 1);
  } finally { cleanup(); vi.useRealTimers(); }
});

it("refreshes header totals once when background sync completes, even with failures", async () => {
  exists = true;
  vi.useFakeTimers();
  let summary = { running: false, completion_id: "old", status: "Completed" };
  let count = 0;
  const backend = calls.request.getMockImplementation()!;
  calls.request.mockImplementation((method, params) => method === "sync_summary"
    ? Promise.resolve({ result: summary }) : method === "logbook_stats"
    ? Promise.resolve({ result: { stats: { qso_count: count } } }) : backend(method, params));
  try {
    await act(async () => { render(<LiveApp />); });
    expect(screen.getByText("0 contacts · Integrated logbook")).toBeTruthy();
    const reloads = calls.request.mock.calls.filter(([method]) => method === "workspace_status").length;
    summary = { running: true, completion_id: "old", status: "Synchronizing" };
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    count = 17;
    summary = { running: false, completion_id: "new", status: "Completed with failures" };
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(screen.getByText("17 contacts · Integrated logbook")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(calls.request.mock.calls.filter(([method]) => method === "workspace_status")).toHaveLength(reloads + 1);
    expect(calls.request.mock.calls.some(([method]) => ["sync_run", "sync_status", "station_tune", "settings_save"].includes(method))).toBe(false);
  } finally { cleanup(); vi.useRealTimers(); }
});

it("opens the draft without waiting for slow logbook aggregates", async () => {
  exists = true;
  const base = calls.request.getMockImplementation()!;
  calls.request.mockImplementation((method: string, params: unknown) => method === "logbook_stats" ? new Promise(() => {}) : base(method, params));
  render(<LiveApp />);
  expect(await screen.findByLabelText("Callsign")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Operator Desk" })).toBeNull();
  expect(calls.request).toHaveBeenCalledWith("logbook_stats", {});
  expect(screen.getByRole("button", { name: "Monitor" }).closest(".sidebar-foot")).not.toBeNull();
  expect(document.querySelector(".main-station-rail")?.textContent).not.toContain("Monitor");
});

it("native menu navigation preserves the draft and never changes equipment or starts sync", async () => {
  exists = true;
  const backend = calls.request.getMockImplementation()!;
  calls.request.mockImplementation((method, params) => method === "logbook_list"
    ? Promise.resolve({ result: { qsos: [], total: 0, offset: 0, limit: 20 } }) : backend(method, params));
  render(<LiveApp />);
  fireEvent.change(await screen.findByLabelText("Callsign"), { target: { value: "K1ABC" } });
  for (const title of ["Settings", "Logbook", "Station Control", "Radio 2 Settings", "Radio 1 Settings", "Log QSO", "Operator Desk"]) {
    await act(async () => nativeMenu.route?.(title));
    const settingsRoute = title === "Station Control" || title === "Radio 1 Settings" || title === "Radio 2 Settings";
    expect(screen.getByRole("main", { name: settingsRoute ? "Settings" : title })).toBeTruthy();
    if (settingsRoute) {
      expect(screen.getByRole("tab", { name: "Radio" }).getAttribute("aria-selected")).toBe("true");
      const requestedRadio = title === "Radio 2 Settings" ? "Radio 2" : "Radio 1";
      expect(screen.getByRole("tab", { name: requestedRadio }).getAttribute("aria-selected")).toBe("true");
    }
  }
  expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("K1ABC");
  expect(calls.request.mock.calls.some(([method]) => ["station_connect", "station_disconnect", "station_tune", "rotor_connect", "rotor_goto", "sync_run", "settings_save"].includes(method))).toBe(false);
}, 10_000);

it("exposes the Contest Manager only for authoritative isolated contest-test health", async () => {
  exists = true;
  const backend = calls.request.getMockImplementation()!;
  calls.request.mockImplementation((method, params) => method === "health"
    ? Promise.resolve({ id: "health", ok: true, result: { mode: "contesting_test", isolated_workspace: true } })
    : method === "contest_catalog"
      ? Promise.resolve({ id: "catalog", ok: true, result: { workspaceGeneration: testWorkspaceGeneration, rules: [] } })
      : method === "contest_sessions"
        ? Promise.resolve({ id: "sessions", ok: true, result: { sessions: [] } })
        : backend(method, params));
  render(<LiveApp />);
  const contest = await screen.findByRole("button", { name: "Contest Manager / Desk" });
  fireEvent.click(contest);
  await waitFor(() => expect(moduleAuthority.switch).toHaveBeenCalledExactlyOnceWith("contesting"));
  expect(screen.getByRole("button", { name: "Contesting" }).closest("header")).toBeTruthy();
  expect(screen.getByRole("main", { name: "Operator Desk" })).toBeTruthy();
});

it("keeps normal-logging sidebar spot transports out of the Contesting module", async () => {
  exists = true;
  moduleAuthority.selected = "contesting";
  const backend = calls.request.getMockImplementation()!;
  calls.request.mockImplementation((method, params) => method === "health"
    ? Promise.resolve({ id: "health", ok: true, result: { mode: "contesting_test", isolated_workspace: true } })
    : method === "settings_load"
      ? Promise.resolve({ ok: true, result: { settings: { stationCall: "OM0RX", gridSquare: "KN08" }, revision: 0, generation: testWorkspaceGeneration } })
      : method === "contest_catalog"
        ? Promise.resolve({ id: "catalog", ok: true, result: { workspaceGeneration: testWorkspaceGeneration, rules: [] } })
        : method === "contest_sessions"
          ? Promise.resolve({ id: "sessions", ok: true, result: { sessions: [] } })
          : backend(method, params));
  render(<LiveApp />);
  expect(await screen.findByRole("main", { name: "Operator Desk" })).toBeTruthy();
  expect(screen.queryByLabelText("RBN and operator spots for this station")).toBeNull();
  expect(screen.queryByRole("button", { name: "Monitor" })).toBeNull();
  expect(calls.request.mock.calls.some(([method]) => method === "spot_history_query")).toBe(false);
  expect(native.invoke.mock.calls.some(([command]) => command === "hf_propagation_fetch")).toBe(false);
});

it("freezes Normal Logging input synchronously while the native module switch is pending", async () => {
  exists = true;
  let release!: () => void;
  const switchGate = new Promise<void>(resolve => { release = resolve; });
  moduleAuthority.switch.mockImplementation(() => switchGate);
  draftBackend = operatorDraftFixture({ id: "draft", start: "2026-10-12T00:00:00Z", call: "K1ABC", band: "20m", mode: "SSB" });
  const backend = calls.request.getMockImplementation()!;
  calls.request.mockImplementation(async (method, params) => {
    if (method === "health") return { id: "health", ok: true, result: { mode: "contesting_test", isolated_workspace: true } };
    return backend(method, params);
  });
  render(<LiveApp />);
  const callsign = await screen.findByLabelText("Callsign") as HTMLInputElement;
  fireEvent.click(await screen.findByRole("button", { name: "Contest Manager / Desk" }));
  fireEvent.change(callsign, { target: { value: "K1ZZZ" } });
  expect(callsign.value).toBe("K1ABC");
  await waitFor(() => expect(moduleAuthority.switch).toHaveBeenCalledExactlyOnceWith("contesting"));
  expect(await screen.findByText("Saving and restarting…")).toBeTruthy();
  expect(callsign.closest("form")?.hasAttribute("inert")).toBe(true);
  fireEvent.change(callsign, { target: { value: "K1ZZZ" } });
  expect(callsign.value).toBe("K1ABC");
  release();
  await screen.findByText("xLog did not restart after changing operating module.");
});

it("restores Normal Logging input after a confirmed pre-retirement refusal and permits retry", async () => {
  exists = true;
  moduleAuthority.switch.mockResolvedValueOnce({ status: "rejected", message: "Close the Log QSO window before changing module.", servicesRetired: false });
  draftBackend = operatorDraftFixture({ id: "draft", start: "2026-10-12T00:00:00Z", call: "K1ABC", band: "20m", mode: "SSB" });
  const backend = calls.request.getMockImplementation()!;
  calls.request.mockImplementation(async (method, params) => method === "health"
    ? { id: "health", ok: true, result: { mode: "contesting_test", isolated_workspace: true } }
    : backend(method, params));
  render(<LiveApp />);
  const callsign = await screen.findByLabelText("Callsign") as HTMLInputElement;
  const contest = await screen.findByRole("button", { name: "Contest Manager / Desk" });
  fireEvent.click(contest);
  await screen.findByText("Close the Log QSO window before changing module.");
  await waitFor(() => expect(callsign.closest("form")?.hasAttribute("inert")).toBe(false));
  fireEvent.change(callsign, { target: { value: "K1ZZZ" } });
  expect(callsign.value).toBe("K1ZZZ");
  let release!: () => void;
  moduleAuthority.switch.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  fireEvent.click(contest);
  await waitFor(() => expect(moduleAuthority.switch).toHaveBeenCalledTimes(2));
  expect(callsign.closest("form")?.hasAttribute("inert")).toBe(true);
  release();
});

it("keeps input frozen after native reports that service retirement started", async () => {
  exists = true;
  moduleAuthority.switch.mockResolvedValueOnce({ status: "failed", message: "Station-service retirement may have started.", servicesRetired: true });
  draftBackend = operatorDraftFixture({ id: "draft", start: "2026-10-12T00:00:00Z", call: "K1ABC", band: "20m", mode: "SSB" });
  const backend = calls.request.getMockImplementation()!;
  calls.request.mockImplementation(async (method, params) => method === "health"
    ? { id: "health", ok: true, result: { mode: "contesting_test", isolated_workspace: true } }
    : backend(method, params));
  render(<LiveApp />);
  const callsign = await screen.findByLabelText("Callsign") as HTMLInputElement;
  fireEvent.click(await screen.findByRole("button", { name: "Contest Manager / Desk" }));
  await screen.findByText("Station-service retirement may have started.");
  expect(callsign.closest("form")?.hasAttribute("inert")).toBe(true);
  expect((screen.getByRole("button", { name: "Contesting" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(callsign, { target: { value: "K1ZZZ" } });
  expect(callsign.value).toBe("K1ABC");
});

it("reconciles a terminal Read radio journal before changing to Contesting", async () => {
  exists = true;
  const operationId = crypto.randomUUID();
  localStorage.setItem("xlog.integration.operatorDraft.main.v1.readRadio", JSON.stringify({ operationId, generation: testWorkspaceGeneration }));
  native.invoke.mockImplementation(async (command, params) => {
    expect(command).toBe("operator_draft_read_radio_recover");
    expect(params).toEqual({ operationId, generation: testWorkspaceGeneration });
    return { operationId, phase: "blocked", reservationActive: false, tuneConfirmed: false, rotor: "not-requested", error: "Old read receipt retired." };
  });
  const backend = calls.request.getMockImplementation()!;
  calls.request.mockImplementation((method, params) => method === "health"
    ? Promise.resolve({ id: "health", ok: true, result: { mode: "contesting_test", isolated_workspace: true } })
    : backend(method, params));
  render(<LiveApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Contest Manager / Desk" }));
  await waitFor(() => expect(moduleAuthority.switch).toHaveBeenCalledExactlyOnceWith("contesting"));
  expect(native.invoke.mock.calls.filter(([command]) => command === "operator_draft_read_radio_recover")).toEqual([
    ["operator_draft_read_radio_recover", { operationId, generation: testWorkspaceGeneration }],
  ]);
  expect(localStorage.getItem("xlog.integration.operatorDraft.main.v1.readRadio")).toBeNull();
});

it("keeps an unresolved Read radio journal as a module-transition fence", async () => {
  exists = true;
  const operationId = crypto.randomUUID();
  localStorage.setItem("xlog.integration.operatorDraft.main.v1.readRadio", JSON.stringify({ operationId, generation: testWorkspaceGeneration }));
  native.invoke.mockRejectedValue(new Error("Native read is still active."));
  const backend = calls.request.getMockImplementation()!;
  calls.request.mockImplementation((method, params) => method === "health"
    ? Promise.resolve({ id: "health", ok: true, result: { mode: "contesting_test", isolated_workspace: true } })
    : backend(method, params));
  render(<LiveApp />);
  fireEvent.click(await screen.findByRole("button", { name: "Contest Manager / Desk" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Native read is still active.");
  expect(moduleAuthority.switch).not.toHaveBeenCalled();
  expect(localStorage.getItem("xlog.integration.operatorDraft.main.v1.readRadio")).not.toBeNull();
});

it("keeps a fresh contest-test profile in onboarding until its isolated workspace is created", async () => {
  const backend = calls.request.getMockImplementation()!;
  calls.request.mockImplementation((method, params) => method === "health"
    ? Promise.resolve({ id: "health", ok: true, result: { mode: "contesting_test", isolated_workspace: true } })
    : method === "contest_catalog"
      ? Promise.resolve({ id: "catalog", ok: true, result: { workspaceGeneration: testWorkspaceGeneration, rules: [] } })
      : method === "contest_sessions"
        ? Promise.resolve({ id: "sessions", ok: true, result: { sessions: [] } })
        : backend(method, params));
  render(<LiveApp />);
  await screen.findByRole("button", { name: "Create empty logbook" });
  expect(screen.queryByRole("button", { name: "Contest Manager / Desk" })).toBeNull();
  await act(async () => nativeMenu.route?.("Contest Manager / Desk"));
  expect(await screen.findByText("Create or reconnect this isolated workspace before opening Contesting.")).toBeTruthy();
  expect(screen.getByRole("main", { name: "Operator Desk" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Create empty logbook" }));
  const contest = await screen.findByRole("button", { name: "Contest Manager / Desk" });
  expect(calls.request.mock.calls.filter(([method]) => method === "health").length).toBeGreaterThanOrEqual(2);
  fireEvent.click(contest);
  await waitFor(() => expect(moduleAuthority.switch).toHaveBeenCalledExactlyOnceWith("contesting"));
});

it("can return an unavailable persisted Contesting choice to Normal without mounting a contest owner", async () => {
  exists = true; moduleAuthority.selected = "contesting";
  render(<LiveApp />);
  const normal = await screen.findByRole("button", { name: "Normal Logging" });
  fireEvent.click(normal);
  await waitFor(() => expect(moduleAuthority.switch).toHaveBeenCalledExactlyOnceWith("normal_logging"));
});

it.each([
  [{ mode: "integrated", isolated_workspace: true }, "production mode"],
  [{ mode: "contesting_test", isolated_workspace: false }, "shared workspace"],
  [{ mode: "contesting_test" }, "malformed health"],
])("keeps Contesting unavailable for %s (%s)", async (health, _label) => {
  const backend = calls.request.getMockImplementation()!;
  calls.request.mockImplementation((method, params) => method === "health"
    ? Promise.resolve({ id: "health", ok: true, result: health }) : backend(method, params));
  render(<LiveApp />);
  await waitFor(() => expect(calls.request.mock.calls.some(([method]) => method === "health")).toBe(true));
  expect(screen.queryByRole("button", { name: "Contest Manager / Desk" })).toBeNull();
  await act(async () => nativeMenu.route?.("Contest Manager / Desk"));
  expect(screen.getByRole("main", { name: "Operator Desk" })).toBeTruthy();
  expect(calls.request.mock.calls.some(([method]) => method.startsWith("contest_"))).toBe(false);
});

it("rejects a malformed truthy health frame instead of exposing Contesting", async () => {
  const backend = calls.request.getMockImplementation()!;
  calls.request.mockImplementation((method, params) => method === "health"
    ? Promise.resolve({ id: "health", ok: "true", result: { mode: "contesting_test", isolated_workspace: true } })
    : backend(method, params));
  render(<LiveApp />);
  await waitFor(() => expect(calls.request.mock.calls.some(([method]) => method === "health")).toBe(true));
  expect(screen.queryByRole("button", { name: "Contest Manager / Desk" })).toBeNull();
  await act(async () => nativeMenu.route?.("Contest Manager / Desk"));
  expect(screen.getByRole("main", { name: "Operator Desk" })).toBeTruthy();
  expect(calls.request.mock.calls.some(([method]) => method.startsWith("contest_"))).toBe(false);
});

it("routes Sync to the Logbook choice in integrated-only mode", () => {
  expect(syncSettingsDestination("local")).toBe("Logbook");
  expect(syncSettingsDestination("wavelog")).toBe("Sync");
  expect(syncSettingsDestination(undefined)).toBe("Sync");
});

it("keeps Sync inside Settings and supports repeat legacy navigation without changing its schedule", async () => {
  exists = true;
  const backend = calls.request.getMockImplementation()!;
  calls.request.mockImplementation((method, params) => method === "sync_status"
    ? Promise.resolve({ result: { running: false, automatic_sync: true, interval_minutes: 1, conflicts: [], pending: [] } }) : backend(method, params));
  render(<LiveApp />); await screen.findByLabelText("Callsign");
  expect(within(document.querySelector(".sidebar nav")!).queryByRole("button", { name: "Sync" })).toBeNull();
  await act(async () => nativeMenu.route?.("Sync"));
  expect(screen.getByRole("main", { name: "Settings" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Sync" }).getAttribute("aria-selected")).toBe("true");
  expect(await screen.findByText("Automatic sync on")).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "General" }));
  await act(async () => nativeMenu.route?.("Sync"));
  expect(screen.getByRole("tab", { name: "Sync" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.click(screen.getByRole("tab", { name: "General" }));
  fireEvent.keyDown(window, { key: "s", ctrlKey: true, shiftKey: true });
  expect(screen.getByRole("tab", { name: "Sync" }).getAttribute("aria-selected")).toBe("true");
  expect(calls.request.mock.calls.some(([method]) => ["sync_run", "sync_configure", "settings_save", "station_tune"].includes(method))).toBe(false);
});

it("logs through the shared draft receipt without exposing the retired Follow radio control", async () => {
  exists = true;
  render(<LiveApp />);
  fireEvent.change(await screen.findByLabelText("Callsign"), { target: { value: "K1ABC" } });
  expect(within(screen.getByLabelText("Callsign").closest("form")!).queryByRole("checkbox", { name: "Follow radio" })).toBeNull();
  fireEvent.submit(screen.getByLabelText("Callsign").closest("form")!);
  await waitFor(() => expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe(""));
  expect(calls.request.mock.calls.filter(([method, params]) => method === "logbook_operator_draft_apply" && params.action === "save")).toHaveLength(1);
  expect(calls.request.mock.calls.some(([method]) => method === "logbook_save")).toBe(false);
  expect(screen.getAllByText("QSO logged")).toHaveLength(1);
  expect(document.querySelector("main.qso-feedback-area > .qso-logged-toast")).toBeTruthy();
  expect(screen.queryByText(/saved to the integrated logbook/)).toBeNull();
});

it("recovers a lost Save acknowledgement without a second Save and leaves non-QSO navigation usable", async () => {
  exists = true;
  const backend = calls.request.getMockImplementation()!; let receiptAvailable = false;
  calls.request.mockImplementation(async (method, params) => {
    if (method === "logbook_operator_draft_receipt" && !receiptAvailable) throw new Error("Receipt transport unavailable");
    const result = await backend(method, params);
    if (method === "logbook_operator_draft_apply" && params.action === "save") throw new Error("Acknowledgement lost");
    return result;
  });
  render(<LiveApp />);
  fireEvent.change(await screen.findByLabelText("Callsign"), { target: { value: "K1ABC" } });
  fireEvent.submit(screen.getByLabelText("Callsign").closest("form")!);
  const recovery = await screen.findByRole("alert", { name: "QSO draft recovery" });
  expect(recovery.textContent).toContain("retained");
  vi.useFakeTimers();
  try {
    act(() => vi.advanceTimersByTime(1500));
    expect(screen.getByRole("alert", { name: "QSO draft recovery" })).toBe(recovery);
    expect(screen.queryByText("QSO logged")).toBeNull();
  } finally { vi.useRealTimers(); }
  expect(screen.getByLabelText("Callsign").closest("form")?.hasAttribute("inert")).toBe(true);
  expect(screen.getByRole("button", { name: "Settings" }).hasAttribute("disabled")).toBe(false);
  receiptAvailable = true;
  fireEvent.click(screen.getByRole("button", { name: "Check saved operation" }));
  await waitFor(() => expect(screen.queryByRole("alert", { name: "QSO draft recovery" })).toBeNull());
  expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("");
  expect(calls.request.mock.calls.filter(([method, params]) => method === "logbook_operator_draft_apply" && params.action === "save")).toHaveLength(1);
});

it("offers legacy local text explicitly as a new draft without logging it automatically", async () => {
  exists = true;
  localStorage.setItem("xlog.integration.draft", JSON.stringify({ id: "legacy-id", wavelogID: 12, start: "2026-10-12T00:00:00Z", call: "OLD1", band: "20m", mode: "SSB" }));
  render(<LiveApp />);
  const input = await screen.findByLabelText("Callsign") as HTMLInputElement;
  expect(input.value).toBe("");
  expect(localStorage.getItem("xlog.integration.draft")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Recover old text as new draft" }));
  await waitFor(() => expect(localStorage.getItem("xlog.integration.draft")).toBeNull());
  expect(input.value).toBe("OLD1");
  const replace = calls.request.mock.calls.find(([method, params]) => method === "logbook_operator_draft_apply" && params.action === "replace")?.[1];
  expect(replace.qso).toMatchObject({ id: "draft", call: "OLD1", wavelogID: null });
  expect(calls.request.mock.calls.some(([method, params]) => method === "logbook_save" || params?.action === "save" || ["station_tune", "rotor_goto"].includes(method))).toBe(false);
});

it("retains conflicting local text and lets the operator explicitly load the shared draft", async () => {
  exists = true;
  const backend = calls.request.getMockImplementation()!;
  let conflict = false;
  calls.request.mockImplementation(async (method, params) => {
    if (method === "logbook_operator_draft_apply" && params.action === "replace") {
      conflict = true;
      return { result: { status: "conflict", draft: { generation: testWorkspaceGeneration, revision: 1, qso: { ...params.qso, call: "OTHER" } } } };
    }
    if (method === "logbook_operator_draft" && conflict)
      return { result: { draft: { generation: testWorkspaceGeneration, revision: 1, qso: { id: "draft", call: "OTHER", start: "2026-10-12T00:00:00Z", band: "20m", mode: "SSB" } } } };
    return backend(method, params);
  });
  render(<LiveApp />);
  fireEvent.change(await screen.findByLabelText("Callsign"), { target: { value: "LOCAL" } });
  await screen.findByRole("alert", { name: "QSO draft recovery" });
  expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("LOCAL");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Use shared draft" })); });
  expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("OTHER");
  expect(calls.request.mock.calls.some(([method, params]) => method === "logbook_save" || params?.action === "save")).toBe(false);
});

it.each(["Update QSO", "Cancel edit"])("keeps an existing contact edit separate from the active draft on %s", async action => {
  exists = true;
  const contact = { id: "logged-contact", call: "W1AW", start: "2026-10-12T00:00:00Z", band: "20m", mode: "SSB" };
  const contactBackend = contactEditFixture(contact);
  const backend = calls.request.getMockImplementation()!;
  calls.request.mockImplementation(async (method, params) => method.startsWith("logbook_contact") ? { result: contactBackend.request(method, params) } : method === "logbook_list"
    ? { result: { qsos: [contact], total: 1, offset: 0, limit: 20 } }
    : method === "logbook_save" ? { result: { qso: params.qso } } : backend(method, params));
  render(<LiveApp />);
  fireEvent.change(await screen.findByLabelText("Callsign"), { target: { value: "LOCAL" } });
  fireEvent.click(screen.getByRole("button", { name: "Logbook" }));
  fireEvent.click(await screen.findByText("W1AW"));
  await waitFor(() => expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("W1AW"));
  fireEvent.change(screen.getByLabelText("Callsign"), { target: { value: "W1AW/P" } });
  fireEvent.click(screen.getByRole("button", { name: action }));
  await waitFor(() => expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("LOCAL"));
  const existing = calls.request.mock.calls.filter(([method]) => method === "logbook_contact_apply");
  expect(existing).toHaveLength(action === "Update QSO" ? 1 : 0);
  if (existing.length) expect(existing[0][1].qso).toMatchObject({ id: "logged-contact", call: "W1AW/P" });
  expect(calls.request.mock.calls.some(([method]) => method === "logbook_save")).toBe(false);
  expect(calls.request.mock.calls.filter(([method, params]) => method === "logbook_operator_draft_apply" && params.action !== "replace")).toHaveLength(0);
});

it("recovers a logged-contact update after renderer restart without replaying it or replacing the new draft", { timeout: 15_000 }, async () => {
  exists = true;
  const contact = { id: "logged-contact", call: "W1AW", start: "2026-10-12T00:00:00Z", band: "20m", mode: "SSB" };
  const contactBackend = contactEditFixture(contact), backend = calls.request.getMockImplementation()!;
  let receiptAvailable = false;
  calls.request.mockImplementation(async (method, params) => {
    if (method === "logbook_list") return { result: { qsos: [contact], total: 1, offset: 0, limit: 20 } };
    if (method === "logbook_contact_receipt" && !receiptAvailable) return { result: { receipt: null } };
    if (method.startsWith("logbook_contact")) {
      const result = contactBackend.request(method, params);
      if (method === "logbook_contact_apply") throw new Error("Update acknowledgement lost");
      return { result };
    }
    return backend(method, params);
  });
  const first = render(<LiveApp />);
  fireEvent.change(await screen.findByLabelText("Callsign"), { target: { value: "LOCAL" } });
  fireEvent.click(screen.getByRole("button", { name: "Logbook" }));
  fireEvent.click(await screen.findByText("W1AW"));
  await waitFor(() => expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("W1AW"));
  fireEvent.change(screen.getByLabelText("Callsign"), { target: { value: "W1AW/P" } });
  fireEvent.click(screen.getByRole("button", { name: "Update QSO" }));
  await screen.findByRole("alert", { name: "Logged contact recovery" });
  expect(screen.getByLabelText("Callsign").closest("form")?.hasAttribute("inert")).toBe(true);
  expect(readContactJournal(localStorage.getItem("xlog.integration.contactEdit.main.v1"))?.pending).toBeTruthy();
  first.unmount(); render(<LiveApp />);
  await screen.findByRole("alert", { name: "Logged contact recovery" });
  expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("W1AW/P");
  expect(screen.getByRole("button", { name: "Settings" }).hasAttribute("disabled")).toBe(false);
  receiptAvailable = true;
  fireEvent.click(screen.getByRole("button", { name: "Check contact update" }));
  await waitFor(() => expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("LOCAL"));
  expect(contactBackend.updates).toBe(1);
  expect(calls.request.mock.calls.filter(([method]) => method === "logbook_contact_apply")).toHaveLength(1);
  expect(localStorage.getItem("xlog.integration.contactEdit.main.v1")).toBeNull();
  expect(calls.request.mock.calls.some(([method]) => ["logbook_save", "station_tune", "rotor_goto"].includes(method))).toBe(false);
});

it("shows restored contact recovery even when its receipt service is unavailable", async () => {
  exists = true;
  const qso = { id: "logged-contact", call: "W1AW", start: "2026-10-12T00:00:00Z", band: "20m", mode: "SSB" };
  localStorage.setItem("xlog.integration.contactEdit.main.v1", JSON.stringify({ base: { generation: testWorkspaceGeneration, revision: 1, qso }, draft: qso,
    pending: { generation: testWorkspaceGeneration, operationID: "unconfirmed", contactID: qso.id, expectedRevision: 1, action: "update", qso } }));
  const backend = calls.request.getMockImplementation()!;
  calls.request.mockImplementation(async (method, params) => {
    if (method === "logbook_contact_receipt") throw new Error("Receipt service unavailable");
    return backend(method, params);
  });
  render(<LiveApp />);
  expect(await screen.findByRole("alert", { name: "Logged contact recovery" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Check contact update" })).toBeTruthy();
  expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("W1AW");
  expect(screen.getByLabelText("Callsign").closest("form")?.hasAttribute("inert")).toBe(true);
  expect(calls.request.mock.calls.some(([method]) => method === "logbook_contact_apply")).toBe(false);
});

it("blocks backup replacement while a contact edit is retained", async () => {
  exists = true;
  const qso = { id: "logged-contact", call: "W1AW", start: "2026-10-12T00:00:00Z", band: "20m", mode: "SSB" };
  localStorage.setItem("xlog.integration.contactEdit.main.v1", JSON.stringify({ base: { generation: testWorkspaceGeneration, revision: 1, qso }, draft: qso, pending: null }));
  const contactBackend = contactEditFixture(qso), backend = calls.request.getMockImplementation()!;
  const manifest = { createdAt: "2026-10-12T10:00:00Z", qsoCount: 42, pendingSyncCount: 0, databaseBytes: 1024, includesReferenceData: false };
  calls.request.mockImplementation(async (method, params) => method.startsWith("logbook_contact") ? { result: contactBackend.request(method, params) }
    : method === "backup_list" ? { result: { backups: [{ name: "Fixture.xlogbackup" }] } }
    : method === "backup_inspect" ? { result: { name: "Fixture.xlogbackup", manifest, includes_settings: false } }
    : backend(method, params));
  render(<LiveApp />);
  await screen.findByLabelText("Callsign");
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(await screen.findByRole("tab", { name: "Backups" }));
  fireEvent.click(await screen.findByText("Fixture.xlogbackup"));
  fireEvent.click(await screen.findByRole("checkbox", { name: /I understand this replaces/ }));
  fireEvent.click(screen.getByRole("button", { name: "Restore integrated copy" }));
  expect(await screen.findByText("Finish or clear the logged contact edit before restoring a backup.")).toBeTruthy();
  expect(calls.request.mock.calls.some(([method]) => method === "backup_restore")).toBe(false);
});

it("retains an uncertain table deletion through navigation and restart, with receipt-based Undo", async () => {
  exists = true;
  const qso = { id: "deleted-contact", call: "W1AW", start: "2026-10-12T00:00:00Z", band: "20m", mode: "CW" };
  const contactBackend = contactEditFixture(qso), backend = calls.request.getMockImplementation()!;
  let loseAck = true;
  calls.request.mockImplementation(async (method, params) => {
    if (method.startsWith("logbook_contact")) {
      const result = contactBackend.request(method, params);
      if (method === "logbook_contact_apply" && loseAck) throw new Error("lost delete acknowledgement");
      return { result };
    }
    if (method === "logbook_list") return { result: { qsos: contactBackend.contact.qso.deletedAt ? [] : [qso],
      total: contactBackend.contact.qso.deletedAt ? 0 : 1, offset: 0, limit: 20 } };
    return backend(method, params);
  });
  const first = render(<LiveApp />); await screen.findByLabelText("Callsign");
  fireEvent.click(screen.getByRole("button", { name: "Logbook" }));
  fireEvent.keyDown((await screen.findByText("W1AW")).closest("tr")!, { key: " " }); fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm delete" }));
  await waitFor(() => expect(screen.getByRole("alert", { name: "Logbook operation recovery" }).textContent).toContain("acknowledgement"));
  fireEvent.click(screen.getByRole("button", { name: "Operator Desk" }));
  expect(screen.getByRole("alert", { name: "Logbook operation recovery" })).toBeTruthy();
  expect(contactBackend.updates).toBe(1); first.unmount(); loseAck = false;
  render(<LiveApp />); await screen.findByLabelText("Callsign");
  fireEvent.click(screen.getByRole("button", { name: "Check logbook operation" }));
  await waitFor(() => expect(screen.queryByRole("alert", { name: "Logbook operation recovery" })).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Logbook" }));
  fireEvent.click(await screen.findByRole("button", { name: "Undo delete" }));
  await screen.findByText("W1AW"); expect(contactBackend.updates).toBe(2);
  expect(calls.request.mock.calls.some(([method]) => ["logbook_delete", "logbook_undo", "station_tune", "rotor_goto"].includes(method))).toBe(false);
});

it("blocks backup replacement during an unresolved table operation", async () => {
  exists = true;
  localStorage.setItem("xlog.integration.logbookMutation.main.v1", JSON.stringify({ undo: null, pending: {
    generation: testWorkspaceGeneration, operationID: "pending-delete", contactID: "contact", expectedRevision: 1, action: "delete" } }));
  const backend = calls.request.getMockImplementation()!;
  const manifest = { createdAt: "2026-10-12T10:00:00Z", qsoCount: 42, pendingSyncCount: 0, databaseBytes: 1024, includesReferenceData: false };
  calls.request.mockImplementation(async (method, params) => method === "backup_list" ? { result: { backups: [{ name: "Fixture.xlogbackup" }] } }
    : method === "backup_inspect" ? { result: { name: "Fixture.xlogbackup", manifest, includes_settings: false } } : backend(method, params));
  render(<LiveApp />); await screen.findByLabelText("Callsign");
  fireEvent.click(screen.getByRole("button", { name: "Settings" })); fireEvent.click(await screen.findByRole("tab", { name: "Backups" }));
  fireEvent.click(await screen.findByText("Fixture.xlogbackup"));
  fireEvent.click(await screen.findByRole("checkbox", { name: /I understand this replaces/ }));
  fireEvent.click(screen.getByRole("button", { name: "Restore integrated copy" }));
  expect(await screen.findByText("Resolve the pending logbook Delete/Undo before restoring a backup.")).toBeTruthy();
  expect(calls.request.mock.calls.some(([method]) => method === "backup_restore")).toBe(false);
});

it.each(["draft", "contact"])("offers explicit recovery for pre-generation %s text without replaying it", async kind => {
  exists = true;
  const qso = { id: "legacy-edit", call: "OLDTEXT", start: "2026-10-12T00:00:00Z", band: "20m", mode: "SSB" };
  localStorage.setItem(kind === "draft" ? "xlog.integration.operatorDraft.main.v1" : "xlog.integration.contactEdit.main.v1",
    JSON.stringify({ base: { revision: 1, qso }, draft: qso, pending: null }));
  render(<LiveApp />);
  const recovery = await screen.findByRole("alert", { name: kind === "draft" ? "QSO draft recovery" : "Logged contact recovery" });
  expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("OLDTEXT");
  expect(screen.getByLabelText("Callsign").closest("form")?.hasAttribute("inert")).toBe(true);
  expect(within(recovery).queryByRole("button", { name: /Retry/ })).toBeNull();
  if (kind === "draft") fireEvent.click(within(recovery).getByRole("button", { name: "Load current workspace draft" }));
  else fireEvent.click(within(recovery).getByRole("button", { name: "Cancel edit" }));
  await waitFor(() => expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe(""));
  expect(calls.request.mock.calls.some(([method]) => ["logbook_contact_apply", "logbook_operator_draft_apply", "station_tune", "rotor_goto"].includes(method))).toBe(false);
});

it.each([false, true])("retains conflicting logged-contact text and offers only safe recovery (removed=%s)", async removed => {
  exists = true;
  const contact = { id: "logged-contact", call: "W1AW", start: "2026-10-12T00:00:00Z", band: "20m", mode: "SSB" };
  const contactBackend = contactEditFixture(contact), backend = calls.request.getMockImplementation()!;
  calls.request.mockImplementation(async (method, params) => method.startsWith("logbook_contact") ? { result: contactBackend.request(method, params) }
    : method === "logbook_list" ? { result: { qsos: [contact], total: 1, offset: 0, limit: 20 } } : backend(method, params));
  render(<LiveApp />);
  await screen.findByLabelText("Callsign");
  fireEvent.click(screen.getByRole("button", { name: "Logbook" }));
  fireEvent.click(await screen.findByText("W1AW"));
  await waitFor(() => expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("W1AW"));
  fireEvent.change(screen.getByLabelText("Callsign"), { target: { value: "MYEDIT" } });
  if (removed) contactBackend.remove();
  else contactBackend.request("logbook_contact_apply", { generation: testWorkspaceGeneration, operationID: "another-window", contactID: contact.id, expectedRevision: 1,
    action: "update", qso: { ...contact, call: "LATEST" } });
  fireEvent.click(screen.getByRole("button", { name: "Update QSO" }));
  const recovery = await screen.findByRole("alert", { name: "Logged contact recovery" });
  expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("MYEDIT");
  expect(screen.getByRole("button", { name: "Update QSO" }).hasAttribute("disabled")).toBe(true);
  expect(within(recovery).getByRole("button", { name: "Copy my edits" })).toBeTruthy();
  if (removed) {
    expect(within(recovery).queryByRole("button", { name: "Load latest contact" })).toBeNull();
    fireEvent.click(within(recovery).getByRole("button", { name: "Cancel edit" }));
    await waitFor(() => expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe(""));
  } else {
    fireEvent.click(within(recovery).getByRole("button", { name: "Load latest contact" }));
    await waitFor(() => expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("LATEST"));
  }
  expect(contactBackend.updates).toBe(removed ? 0 : 1);
});

it.each([{ kind: "pota", reference_kind: "pota", reference: "US-0001", field: "POTA", draftKey: "potaReference" },
  { kind: "dxpedition", reference_kind: "iota", reference: "EU-001", field: "IOTA", draftKey: "iota" }])("loads $kind reference into a draft without tuning or moving a rotor", async (programme) => {
  exists = true;
  const base = calls.request.getMockImplementation()!;
  activation.activate.mockImplementation(async item => {
    const qso = { id: "draft", start: "2026-10-12T00:00:00Z", call: item.callsign, frequencyHz: item.frequency_hz,
      band: "20m", mode: item.mode, [programme.draftKey]: programme.reference };
    draftBackend("logbook_operator_draft_apply", { operationID: "00000000-0000-4000-8000-000000000099", generation: testWorkspaceGeneration,
      draftID: "draft", expectedRevision: 0, action: "replace", qso });
    return { operationId: "00000000-0000-4000-8000-000000000098", phase: "confirmed", reservationActive: false,
      draftOnly: true, tuneConfirmed: false, rotor: "not_requested" };
  });
  calls.request.mockImplementation((method: string, params: unknown) => method === "opportunities_snapshot" ? Promise.resolve({ result: {
    generated_at: "2026-10-12T00:00:00.000Z",
    items: [{ id: "pota:test", ...programme, callsign: "K1ABC", name: "Park", frequency_hz: 14025000, mode: "CW", comment: "", source: "pota", source_url: "", observed_at: "2026-10-12T00:00:00Z", expires_at: "2026-10-12T01:00:00Z", worked_count: 0, confirmed_count: 0,
      activation: { sourceEpoch: "00000000-0000-4000-8000-000000000096", spotVersion: "00000000-0000-4000-8000-000000000097" } }], sources: [], total_available: 1, history_state: "ready",
  } }) : base(method, params));
  render(<LiveApp />);
  await screen.findByLabelText("Callsign");
  fireEvent.click(screen.getByRole("button", { name: "Chaser & DX" }));
  fireEvent.click(await screen.findByRole("button", { name: "Load K1ABC into QSO draft" }));
  expect((await screen.findByLabelText("Callsign") as HTMLInputElement).value).toBe("K1ABC");
  expect((screen.getByLabelText(programme.field) as HTMLInputElement).value).toBe(programme.reference);
  expect(screen.queryByRole("checkbox", { name: "Follow radio" })).toBeNull();
  expect(calls.request.mock.calls.some(([method]) => ["station_tune", "rotor_goto", "logbook_save", "sync_run"].includes(method))).toBe(false);
});

it("resumes a saved reconnect cluster while radio is offline, once only", async () => {
  const base = calls.request.getMockImplementation()!;
  calls.request.mockImplementation((method: string, params: unknown) => method === "cluster_snapshot" ? Promise.resolve({ ok: true, result: {
    configuration: { connectOnStartup: true, reconnect: true, servers: [{ enabled: true }] }, snapshot: { spots: [], connections: [], connectedClusters: 0 },
  } }) : base(method, params));
  render(<LiveApp />);
  await waitFor(() => expect(calls.request).toHaveBeenCalledWith("cluster_connect", {}));
  expect(calls.request.mock.calls.filter(([method]) => method === "cluster_connect")).toHaveLength(1);
  expect(calls.request.mock.calls.some(([method]) => ["station_connect", "station_tune", "rotor_connect", "rotor_goto"].includes(method))).toBe(false);
});

it("honors the saved startup preference independently of a prior session disconnect", async () => {
  localStorage.setItem("xlog.integration.clusterSessionIntent", "disconnected");
  const base = calls.request.getMockImplementation()!;
  calls.request.mockImplementation((method: string, params: unknown) => method === "cluster_snapshot" ? Promise.resolve({ ok: true, result: {
    configuration: { connectOnStartup: true, reconnect: true, servers: [{ enabled: true }] }, snapshot: { spots: [], connections: [], connectedClusters: 0 },
  } }) : base(method, params));
  render(<LiveApp />);
  await screen.findByRole("button", { name: "Copy my existing xLog logbook" });
  await waitFor(() => expect(calls.request.mock.calls.filter(([method]) => method === "cluster_connect")).toHaveLength(1));
});

it("native views migrate once and leave reconnect to the shared owner", async () => {
  clusterStartup.native = true;
  const base = calls.request.getMockImplementation()!;
  calls.request.mockImplementation((method: string, params: unknown) => method === "cluster_snapshot" ? Promise.resolve({ ok: true, result: {
    configuration: { connectOnStartup: true, reconnect: true, servers: [{ enabled: true }] }, snapshot: { spots: [], connections: [], connectedClusters: 0 },
  } }) : base(method, params));
  render(<LiveApp />);
  await waitFor(() => expect(calls.request).toHaveBeenCalledWith("cluster_snapshot", {}));
  expect(clusterStartup.initialize).toHaveBeenCalledOnce();
  expect(calls.request.mock.calls.some(([method]) => ["cluster_connect", "station_connect", "rotor_connect"].includes(method))).toBe(false);
});

it("native migration failure is visible and never falls back to automatic Connect", async () => {
  clusterStartup.native = true;
  clusterStartup.initialize.mockRejectedValue(new Error("Cluster restart preference could not be read."));
  render(<LiveApp />);
  expect(await screen.findByText("Cluster restart preference could not be read.")).toBeTruthy();
  expect(calls.request.mock.calls.some(([method]) => method === "cluster_connect")).toBe(false);
});

it("clears only its own migration warning after a confirmed retry", async () => {
  vi.useFakeTimers(); clusterStartup.native = true;
  clusterStartup.initialize.mockRejectedValueOnce(new Error("Fixture migration warning")).mockResolvedValue(undefined);
  try {
    render(<LiveApp />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("Fixture migration warning")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.queryByText("Fixture migration warning")).toBeNull();
    expect(clusterStartup.initialize).toHaveBeenCalledTimes(2);
    expect(calls.request.mock.calls.some(([method]) => method === "cluster_connect")).toBe(false);
  } finally { vi.useRealTimers(); }
});

it("confirmed migration recovery does not clear a newer unrelated workspace error", async () => {
  vi.useFakeTimers(); clusterStartup.native = true;
  clusterStartup.initialize.mockRejectedValueOnce(new Error("Fixture migration warning")).mockResolvedValue(undefined);
  const base = calls.request.getMockImplementation()!;
  calls.request.mockImplementation((method: string, params: unknown) => method === "workspace_create"
    ? Promise.reject(new Error("Newer workspace failure")) : base(method, params));
  try {
    render(<LiveApp />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("Fixture migration warning")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy my existing xLog logbook" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("Newer workspace failure")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByText("Newer workspace failure")).toBeTruthy();
    expect(clusterStartup.initialize).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});

it("starts with real-data onboarding and only reads; never creates a log or commands hardware implicitly", async () => {
  render(<LiveApp />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Copy my existing xLog logbook" }).hasAttribute("disabled")).toBe(false));
  expect(calls.request.mock.calls.every(([method]) => ["health", "workspace_status", "cluster_snapshot", "station_snapshot", "rotor_snapshot"].includes(method))).toBe(true);
  expect(screen.getByText("No sample contacts, spots or station readings are loaded.")).toBeTruthy();
});

it("embedded propagation reads the shared owner without a renderer fetch timer", async () => {
  exists = true; vi.useFakeTimers();
  try {
    render(<LiveApp />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.queryByRole("button", { name: "Refresh propagation" })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(calls.request.mock.calls.filter(([method]) => String(method).startsWith("propagation_"))).toHaveLength(0);
  } finally { cleanup(); vi.useRealTimers(); }
});

it("copies only on explicit action and retains the operator callsign through readback refresh", async () => {
  render(<LiveApp />);
  const copy = await screen.findByRole("button", { name: "Copy my existing xLog logbook" });
  await waitFor(() => expect(copy.hasAttribute("disabled")).toBe(false));
  await userEvent.click(copy);
  const input = await screen.findByLabelText("Callsign");
  await userEvent.type(input, "EA7EU");
  expect(calls.request).toHaveBeenCalledWith("workspace_create", { mode: "copy_native" });
  expect((input as HTMLInputElement).value).toBe("EA7EU");
  expect(calls.request.mock.calls.some(([method]) => ["logbook_save", "station_tune", "station_action", "sync_run"].includes(method))).toBe(false);
});

it("keeps graphical propagation and last-known bars when refresh temporarily has no data", () => {
  const request = vi.fn();
  const { rerender } = render(<Conditions request={request} propagation={{ solar_flux: 140, bands: [{ name: "20m", day: "Good", night: "Fair" }], updated_at: 1 }} />);
  expect(screen.getByLabelText("Day: Good")).toBeTruthy();
  rerender(<Conditions request={request} propagation={null} />);
  expect(screen.getByLabelText("Day: Good")).toBeTruthy();
  expect(screen.getByText(/last known/)).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
});

it("renders both observed VFOs and rotor bearing without exposing write controls", () => {
  render(<Monitor map={<div>Map</div>} snapshot={{ source: "direct_agent", radio: { connected: true, observed: true,
    mode: "CW", receive_vfo: "A", receive_frequency_hz: 14025000, transmit_vfo: "B", transmit_frequency_hz: 14026000 },
    station: { kpa_operate: false, tx_power_watts: 0, swr: 1.2, rf_drive_watts: 25 }, rotor: { connected: true, azimuth: 184 } }} />);
  expect(screen.getByText("A: 14.025000")).toBeTruthy();
  expect(screen.getByText("B: 14.026000")).toBeTruthy();
  expect(screen.getByText("184°")).toBeTruthy();
  expect(screen.queryAllByRole("button")).toHaveLength(0);
});

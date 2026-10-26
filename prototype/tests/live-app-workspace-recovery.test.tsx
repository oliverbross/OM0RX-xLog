// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import LiveApp from "../src/LiveApp";
import { operatorDraftFixture, testPreferenceSnapshot, testWorkspaceGeneration } from "./operator-draft-fixture";
import { defaultRotorConfiguration } from "../src/live/rotorConfigurationSession";

const api = vi.hoisted(() => ({ request: vi.fn(), present: vi.fn(), layout: null as any, normalActive: true }));
vi.mock("../src/live/normalLoggingAccess", () => ({ useNormalLoggingAccess: () => ({ active: api.normalActive, error: "" }) }));
vi.mock("../src/worker", async original => ({ ...await original<typeof import("../src/worker")>(), workerRequest: api.request, openMonitor: vi.fn() }));
vi.mock("../src/live/operatorDraftTransport", () => ({ requestOperatorDraft: async (method: string, params: any = {}) => (await api.request(method, params)).result }));
vi.mock("../src/live/useWorkspaceLayout", () => ({ useWorkspaceLayout: () => api.layout }));
vi.mock("../src/live/workspaceMode", async original => ({ ...await original<typeof import("../src/live/workspaceMode")>(), presentWorkspaceMode: api.present }));
vi.mock("../src/Map", () => ({ default: () => <div>Map fixture</div> }));
let draft: ReturnType<typeof operatorDraftFixture>, radioFrequency: number;
beforeEach(() => {
  localStorage.clear(); vi.useFakeTimers(); api.request.mockReset(); api.present.mockReset().mockResolvedValue(undefined);
  api.normalActive = true;
  radioFrequency = 14_025_000;
  draft = operatorDraftFixture({ id: "draft", call: "K1ABC", start: "2026-10-12T00:00:00Z", band: "20m", mode: "CW", frequencyHz: radioFrequency });
  api.layout = { state: { snapshot: { revision: 1, generation: testWorkspaceGeneration,
    document: { version: 2, activePresetID: "windowed", presets: [{ id: "windowed", name: "Separate Windows", panels: [] }] } },
    pending: null, saving: false, conflict: null, workspaceChanged: false, error: "" },
    session: { subscribe: () => () => {}, getSnapshot: () => api.layout.state }, subscriptionError: "" };
  api.request.mockImplementation(async (method: string, params: any = {}) => {
    const shared = draft(method, params);
    if (shared) return { result: shared };
    const result = method === "workspace_status" ? { workspace_exists: true, native_log_exists: false }
      : method === "settings_load" ? { settings: { stationCall: "", gridSquare: "" }, revision: 0, generation: testWorkspaceGeneration }
      : method === "workspace_rotor_configuration_load" ? { revision: 0, generation: testWorkspaceGeneration, configuration: defaultRotorConfiguration() }
      : method === "workspace_preferences_load" ? testPreferenceSnapshot()
      : method === "station_snapshot" ? { source: "direct_agent", available: true,
        radio: { observed: true, connected: true, frequency_hz: radioFrequency, mode: "CW" } }
      : method === "cluster_snapshot" ? { snapshot: { spots: [], connectedClusters: 0 } }
      : method === "logbook_stats" ? { stats: { qso_count: 0 } }
      : method === "lookup_call" ? { source: "No match" }
      : method === "logbook_previous" ? { qsos: [] } : {};
    return { result };
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });

it("keeps the normal blank draft passive while Contesting owns mutations, then seeds only after normal admission", async () => {
  api.normalActive = false;
  draft = operatorDraftFixture({ id: "draft", call: "", start: "2026-10-12T00:00:00Z", band: "20m", mode: "SSB" });
  const before = structuredClone(draft("logbook_operator_draft")!.draft!);
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<LiveApp />); await vi.advanceTimersByTimeAsync(1_200); });
  expect(api.request.mock.calls.some(([method]) => method === "station_snapshot")).toBe(true);
  expect(api.request.mock.calls.some(([method]) => method === "logbook_operator_draft_apply")).toBe(false);
  expect(draft("logbook_operator_draft")!.draft!).toEqual(before);
  const retained = JSON.parse(localStorage.getItem("xlog.integration.operatorDraft.main.v1")!);
  expect(retained.pending).toBeNull();
  expect(retained.draft.call).toBe("");
  api.normalActive = true;
  await act(async () => { view.rerender(<LiveApp />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
  expect(api.request.mock.calls.some(([method]) => method === "logbook_operator_draft_apply")).toBe(true);
  expect(draft("logbook_operator_draft")!.draft!.qso.frequencyHz).toBe(radioFrequency);
});

it("reconciles the original completed Clear receipt while inactive without queuing a replacement or clearing again", async () => {
  api.normalActive = false;
  const base = structuredClone(draft("logbook_operator_draft")!.draft!);
  const pending = { operationID: "01234567-89ab-4cde-8123-456789abcdef", generation: base.generation,
    draftID: base.qso.id, expectedRevision: base.revision, action: "clear" };
  draft("logbook_operator_draft_apply", pending);
  localStorage.setItem("xlog.integration.operatorDraft.main.v1", JSON.stringify({ base, draft: base.qso, pending }));
  await act(async () => { render(<LiveApp />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1_200); });
  expect(api.request.mock.calls.some(([method]) => method === "logbook_operator_draft_receipt")).toBe(true);
  expect(api.request.mock.calls.some(([method]) => method === "logbook_operator_draft_apply")).toBe(false);
  const retained = JSON.parse(localStorage.getItem("xlog.integration.operatorDraft.main.v1")!);
  expect(retained.pending).toBeNull();
  expect(retained.draft.call).toBe("");
  expect(retained.base.revision).toBe(base.revision + 1);
});

it("keeps Separate Windows hidden through radio-follow draft edits and their autosave", async () => {
  await act(async () => { render(<LiveApp />); });
  radioFrequency = 14_026_000;
  await act(async () => { await vi.advanceTimersByTimeAsync(900); });
  expect(api.request.mock.calls.some(([method]) => method === "logbook_operator_draft_apply")).toBe(true);
  expect(api.present.mock.calls.length).toBeGreaterThan(0);
  expect(api.present.mock.calls.every(([, hide]) => hide === true)).toBe(true);
  expect(screen.getByRole("main", { name: "Separate Windows" })).toBeTruthy();
  expect(screen.queryByRole("alert", { name: "QSO draft recovery" })).toBeNull();
});

it("recovers a busy background draft autosave without showing operator alerts", async () => {
  const backend = api.request.getMockImplementation()!;
  let replaceAttempts = 0;
  api.request.mockImplementation((method, params) => {
    if (method === "logbook_operator_draft_apply" && params?.action === "replace" && ++replaceAttempts === 1)
      return Promise.reject(new Error("Prototype worker is busy; try again"));
    return backend(method, params);
  });
  await act(async () => { render(<LiveApp />); });
  radioFrequency = 14_026_000;
  await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
  expect(replaceAttempts).toBe(2);
  expect(screen.queryByText("Prototype worker is busy; try again")).toBeNull();
  expect(screen.queryByText(/No receipt is available yet/)).toBeNull();
  expect(screen.queryByRole("alert", { name: "QSO draft recovery" })).toBeNull();
});

it("keeps the workspace pending while a cold-start worker admission failure recovers", async () => {
  const backend = api.request.getMockImplementation()!;
  let statusAttempts = 0;
  api.request.mockImplementation((method, params) => method === "workspace_status" && ++statusAttempts === 1
    ? Promise.reject(new Error("Prototype worker is busy; try again")) : backend(method, params));
  render(<LiveApp />);
  expect(screen.getByRole("heading", { name: "Opening your integrated logbook" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Retry connection" })).toBeNull();
  expect(api.request.mock.calls.some(([method]) => method === "workspace_create")).toBe(false);
  expect(statusAttempts).toBe(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(statusAttempts).toBe(2);
  expect(screen.getByRole("main", { name: "Separate Windows" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Logbook connection unavailable" })).toBeNull();
  expect(api.request.mock.calls.some(([method]) => method === "workspace_create")).toBe(false);
});

it("retries bundled-worker saturation during cold-start workspace reads", async () => {
  const backend = api.request.getMockImplementation()!;
  let preferenceAttempts = 0;
  api.request.mockImplementation((method, params) => method === "workspace_preferences_load" && ++preferenceAttempts === 1
    ? Promise.reject(new Error("Station service is busy; try again.")) : backend(method, params));
  render(<LiveApp />);
  expect(screen.getByRole("heading", { name: "Opening your integrated logbook" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Retry connection" })).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(preferenceAttempts).toBe(2);
  expect(screen.getByRole("main", { name: "Separate Windows" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Logbook connection unavailable" })).toBeNull();
  expect(api.request.mock.calls.some(([method]) => method === "workspace_create")).toBe(false);
});

it("keeps bundled-worker startup retries bounded when saturation persists", async () => {
  const backend = api.request.getMockImplementation()!;
  let statusAttempts = 0;
  api.request.mockImplementation((method, params) => method === "workspace_status"
    ? (++statusAttempts, Promise.reject(new Error("Station service is busy; try again."))) : backend(method, params));
  render(<LiveApp />);
  await act(async () => { await vi.advanceTimersByTimeAsync(7_850); });
  expect(statusAttempts).toBe(7);
  expect(screen.getByRole("heading", { name: "Logbook connection unavailable" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Retry connection" })).toBeTruthy();
  expect(api.request.mock.calls.some(([method]) => method === "workspace_create")).toBe(false);
});

it("keeps conflicting main-draft recovery visible across layout reloads until explicitly resolved", async () => {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<LiveApp />); });
  const base = draft("logbook_operator_draft")!.draft!;
  draft("logbook_operator_draft_apply", { operationID: "detached-edit", draftID: base.qso.id,
    expectedRevision: base.revision, generation: base.generation, action: "replace", qso: { ...base.qso, notes: "Detached operator text" } });
  radioFrequency = 14_026_000;
  await act(async () => { await vi.advanceTimersByTimeAsync(900); });
  expect(screen.getByRole("alert", { name: "QSO draft recovery" })).toBeTruthy();
  expect(api.present.mock.calls.at(-1)![1]).toBe(false);
  api.present.mockClear();
  // A focus-triggered layout read returns a new object at the same revision.
  api.layout = { ...api.layout, state: { ...api.layout.state, snapshot: structuredClone(api.layout.state.snapshot) } };
  await act(async () => { fireEvent.focus(window); view.rerender(<LiveApp />); });
  expect(api.present.mock.calls.length).toBeGreaterThan(0);
  expect(api.present.mock.calls.every(([, hide]) => hide === false)).toBe(true);
  radioFrequency = base.qso.frequencyHz;
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Use shared draft" })); });
  expect(screen.queryByRole("alert", { name: "QSO draft recovery" })).toBeNull();
  expect(api.present.mock.calls.at(-1)![1]).toBe(true);
  expect(draft("logbook_operator_draft")!.draft!.qso.notes).toBe("Detached operator text");
});

it("explains why workspace recovery has reopened main and exposes the Settings route", async () => {
  api.layout.state.error = "The layout acknowledgement is unavailable. Review the saved layout.";
  await act(async () => { render(<LiveApp />); });
  expect(api.present.mock.calls.at(-1)![1]).toBe(false);
  expect(screen.getByRole("alert", { name: "Workspace recovery" }).textContent).toContain("layout acknowledgement");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Review Settings" })); });
  expect(screen.getByRole("main", { name: "Settings" })).toBeTruthy();
});

it("clears a transient workspace presentation failure after a successful layout refresh", async () => {
  api.present.mockRejectedValueOnce("Separate windows did not finish opening").mockResolvedValue(undefined);
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<LiveApp />); await Promise.resolve(); });
  expect(screen.getByText("Separate windows did not finish opening")).toBeTruthy();
  api.layout = { ...api.layout, state: { ...api.layout.state,
    snapshot: { ...api.layout.state.snapshot, revision: 2 } } };
  await act(async () => { view.rerender(<LiveApp />); await Promise.resolve(); });
  expect(screen.queryByText("Separate windows did not finish opening")).toBeNull();
});

it("keeps recovery navigation visible when a Separate Windows layout outlives its workspace", async () => {
  const backend = api.request.getMockImplementation()!;
  api.request.mockImplementation((method, params) => method === "workspace_status"
    ? Promise.resolve({ result: { workspace_exists: false, native_log_exists: true } }) : backend(method, params));
  await act(async () => { render(<LiveApp />); });
  expect(screen.queryByRole("main", { name: "Separate Windows" })).toBeNull();
  expect(api.present.mock.calls.every(([, hide]) => hide === false)).toBe(true);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Settings" })); });
  expect(screen.getByRole("region", { name: "Settings recovery" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Retry connection" })).toBeTruthy();
  expect(api.request.mock.calls.some(([method]) => method === "workspace_create")).toBe(false);
});

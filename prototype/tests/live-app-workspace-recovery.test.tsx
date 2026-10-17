// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import LiveApp from "../src/LiveApp";
import { operatorDraftFixture, testPreferenceSnapshot, testWorkspaceGeneration } from "./operator-draft-fixture";
import { defaultRotorConfiguration } from "../src/live/rotorConfigurationSession";

const api = vi.hoisted(() => ({ request: vi.fn(), present: vi.fn(), layout: null as any }));
vi.mock("../src/worker", async original => ({ ...await original<typeof import("../src/worker")>(), workerRequest: api.request, openMonitor: vi.fn() }));
vi.mock("../src/live/operatorDraftTransport", () => ({ requestOperatorDraft: async (method: string, params: any = {}) => (await api.request(method, params)).result }));
vi.mock("../src/live/useWorkspaceLayout", () => ({ useWorkspaceLayout: () => api.layout }));
vi.mock("../src/live/workspaceMode", async original => ({ ...await original<typeof import("../src/live/workspaceMode")>(), presentWorkspaceMode: api.present }));
vi.mock("../src/Map", () => ({ default: () => <div>Map fixture</div> }));
let draft: ReturnType<typeof operatorDraftFixture>, radioFrequency: number;
beforeEach(() => {
  localStorage.clear(); vi.useFakeTimers(); api.request.mockReset(); api.present.mockReset().mockResolvedValue(undefined);
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

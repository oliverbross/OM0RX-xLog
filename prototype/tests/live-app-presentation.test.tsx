// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import LiveApp from "../src/LiveApp";
import { operatorDraftFixture, testPreferenceSnapshot, testWorkspaceGeneration } from "./operator-draft-fixture";
import { defaultRotorConfiguration } from "../src/live/rotorConfigurationSession";
import { panelMinimum, workspacePanelIDs, type LayoutSnapshot, type LayoutState } from "../src/live/workspaceLayoutSession";

const transport = vi.hoisted(() => ({ request: vi.fn(), invoke: vi.fn(), present: vi.fn() }));
const signals = vi.hoisted(() => ({
  changed: undefined as (() => void) | undefined,
  navigate: undefined as ((title: string) => void) | undefined,
  settingsChanged: undefined as (() => void) | undefined,
}));
const layout = vi.hoisted(() => {
  let current: LayoutState, rendered: LayoutState;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  return {
    session: { getSnapshot: () => current },
    subscribe, getRendered: () => rendered,
    set(value: LayoutState, publish = true) {
      current = value;
      if (publish) { rendered = value; listeners.forEach(listener => listener()); }
    },
    render(value: LayoutState) { rendered = value; listeners.forEach(listener => listener()); },
  };
});
vi.mock("@tauri-apps/api/core", async original => ({
  ...await original<typeof import("@tauri-apps/api/core")>(), invoke: transport.invoke, isTauri: () => false,
}));
vi.mock("../src/worker", async original => ({
  ...await original<typeof import("../src/worker")>(), workerRequest: transport.request, framedWorkerRequest: transport.request,
}));
vi.mock("../src/live/workspaceMode", async original => ({
  ...await original<typeof import("../src/live/workspaceMode")>(), presentWorkspaceMode: transport.present,
}));
vi.mock("../src/live/useWorkspaceLayout", async original => ({
  ...await original<typeof import("../src/live/useWorkspaceLayout")>(),
  useWorkspaceLayout: () => ({ session: layout.session,
    state: React.useSyncExternalStore(layout.subscribe, layout.getRendered), subscriptionError: "" }),
}));
vi.mock("../src/live/logbookWindows", async original => ({
  ...await original<typeof import("../src/live/logbookWindows")>(),
  connectLogbookChanges: (changed: () => void) => { signals.changed = changed; return () => { signals.changed = undefined; }; },
}));
vi.mock("../src/live/workspaceNavigation", async original => ({
  ...await original<typeof import("../src/live/workspaceNavigation")>(),
  connectWorkspaceNavigation: (navigate: (title: string) => void) => {
    signals.navigate = navigate; return () => { signals.navigate = undefined; };
  },
}));
vi.mock("../src/live/ServiceSettings", async original => ({
  ...await original<typeof import("../src/live/ServiceSettings")>(),
  default: ({ onDataChanged }: { onDataChanged: () => void }) => {
    signals.settingsChanged = onDataChanged;
    return <p>Settings presentation fixture</p>;
  },
}));
vi.mock("../src/live/operatorDraftTransport", () => ({
  requestOperatorDraft: async (method: string, params: any = {}) => (await transport.request(method, params)).result,
}));
vi.mock("../src/live/logbookContactTransport", () => ({
  requestLogbookContact: async (method: string, params: any = {}) => (await transport.request(method, params)).result,
}));
vi.mock("../src/live/useSpotActivation", () => ({ useSpotActivation: () => ({
  status: null, error: "", requesting: false, checked: false, activate: vi.fn(), canActivate: () => true,
  supersedeRotor: async () => {}, reconcile: async () => true, retire: vi.fn(),
}) }));
vi.mock("../src/live/useSpotEditor", () => ({ nativeSpotEditor: () => false,
  useSpotEditor: () => ({ status: null, error: "", initializing: false, reconcile: async () => true }),
}));
vi.mock("../src/Map", () => ({ default: () => <div>Map fixture</div> }));

let workspaceGeneration = testWorkspaceGeneration;
function snapshot(mode = "traditional"): LayoutSnapshot {
  return { generation: workspaceGeneration, revision: 1, document: { version: 2, activePresetID: mode,
    presets: ["traditional", "windowed"].map(id => ({ id, name: id, width: 1920, height: 1080, locked: true, snap: true,
      panels: workspacePanelIDs.map((id, z) => { const [width, height] = panelMinimum(id);
        return { id, z, placement: "hidden" as const, rect: { x: 0, y: 0, width, height } }; }),
    })),
  } };
}
function state(mode = "traditional"): LayoutState {
  return { snapshot: snapshot(mode), pending: null, conflict: null, saving: false, error: "", workspaceChanged: false };
}
const count = (method: string) => transport.request.mock.calls.filter(([name]) => name === method).length;
const held = () => {
  let resolve!: () => void, reject!: (cause: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
beforeEach(() => {
  localStorage.clear(); workspaceGeneration = testWorkspaceGeneration;
  signals.changed = undefined; signals.navigate = undefined; signals.settingsChanged = undefined;
  transport.request.mockReset(); transport.invoke.mockReset(); transport.present.mockReset().mockResolvedValue(undefined);
  layout.set(state());
  const draft = operatorDraftFixture({ id: "presentation-draft", start: "2026-10-12T00:00:00Z", call: "", band: "20m", mode: "SSB" });
  transport.request.mockImplementation(async (method: string, params: any = {}) => {
    const shared = draft(method, params);
    if (shared) return { ok: true, result: { ...shared, generation: workspaceGeneration } };
    const result = method === "workspace_status" ? { workspace_exists: true, native_log_exists: true, generation: workspaceGeneration }
      : method === "settings_load" ? { settings: { stationCall: "K1FIX", operatorCall: "K1FIX", gridSquare: "FN31PR", onboardingCompleted: true }, revision: 0, generation: workspaceGeneration }
      : method === "workspace_rotor_configuration_load" ? { revision: 0, generation: workspaceGeneration, configuration: defaultRotorConfiguration() }
      : method === "workspace_preferences_load" ? { ...testPreferenceSnapshot({}), generation: workspaceGeneration }
      : method === "cluster_snapshot" ? { snapshot: { spots: [], connectedClusters: 0 } }
      : method === "station_snapshot" ? { source: "none", available: false, radio: null }
      : method === "logbook_stats" ? { workspace_generation: workspaceGeneration, stats: { qso_count: 0 } }
      : method === "logbook_list" ? { qsos: [], total: 0, offset: 0, limit: 20 }
      : method === "lookup_call" ? { source: "No match" }
      : method === "logbook_previous" ? { qsos: [] } : {};
    return { ok: true, result };
  });
});
afterEach(cleanup);

it("does not re-present for contact data refresh, settings readback or equal layout objects", async () => {
  render(<LiveApp />);
  await waitFor(() => expect(transport.present).toHaveBeenCalledTimes(1));
  await act(async () => { signals.changed!(); layout.set(structuredClone(layout.session.getSnapshot())); });
  expect(count("workspace_status")).toBe(2);
  expect(transport.present).toHaveBeenCalledTimes(1);
  await act(async () => { signals.navigate!("Settings"); });
  expect(screen.getByText("Settings presentation fixture")).toBeTruthy();
  await act(async () => { signals.settingsChanged!(); });
  expect(count("settings_load")).toBe(2);
  expect(count("workspace_status")).toBe(3);
  expect(transport.present).toHaveBeenCalledTimes(1);
  expect(transport.present.mock.calls[0]).toHaveLength(2);
});

it("admits the latest layout after a workspace replacement and still presents committed revisions", async () => {
  render(<LiveApp />);
  await waitFor(() => expect(transport.present).toHaveBeenCalledTimes(1));
  workspaceGeneration = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const replacement = state();
  layout.set(replacement, false); // Native session has advanced before the rendered subscription catches up.
  await act(async () => { signals.changed!(); });
  expect(count("workspace_status")).toBe(2);
  expect(transport.present).toHaveBeenCalledTimes(1);
  await act(async () => { layout.set(replacement); });
  expect(transport.present).toHaveBeenCalledTimes(2);
  expect(transport.present.mock.calls[1][0]).toMatchObject({ generation: workspaceGeneration, revision: 1 });
  await act(async () => { layout.set({ ...replacement, snapshot: { ...replacement.snapshot!, revision: 2 } }); });
  expect(transport.present).toHaveBeenCalledTimes(3);
  expect(transport.present.mock.calls[2][0].revision).toBe(2);
});

it("defers presentation while saving and preserves pending recovery and settled layout transitions", async () => {
  layout.set(state("windowed"));
  render(<LiveApp />);
  await waitFor(() => expect(transport.present).toHaveBeenCalledTimes(1));
  expect(transport.present.mock.calls[0][1]).toBe(true);
  const initial = layout.session.getSnapshot();
  const pending = { base: initial.snapshot!, change: { action: "activatePreset" as const, presetID: "windowed" } };
  await act(async () => { layout.set({ ...initial, pending, saving: true }); });
  expect(transport.present).toHaveBeenCalledTimes(1);
  await act(async () => { layout.set({ ...initial, pending, saving: false }); });
  expect(transport.present).toHaveBeenCalledTimes(2);
  expect(transport.present.mock.calls[1][1]).toBe(false);
  await act(async () => { layout.set(structuredClone(layout.session.getSnapshot())); });
  expect(transport.present).toHaveBeenCalledTimes(2);
  await act(async () => { layout.set({ ...initial, snapshot: { ...initial.snapshot!, revision: 2 } }); });
  expect(transport.present).toHaveBeenCalledTimes(3);
  expect(transport.present.mock.calls[2][1]).toBe(true);
  expect(transport.present.mock.calls.every(call => call.length === 2)).toBe(true);
});

it("does not admit an older hide when pending recovery arrived after its render", async () => {
  layout.set(state("windowed"));
  render(<LiveApp />);
  await waitFor(() => expect(transport.present).toHaveBeenCalledTimes(1));
  const initial = layout.session.getSnapshot();
  const rendered = { ...initial, snapshot: { ...initial.snapshot!, revision: 2 } };
  const latest = { ...rendered, pending: { base: initial.snapshot!,
    change: { action: "activatePreset" as const, presetID: "windowed" } } };
  layout.set(latest, false);
  await act(async () => { layout.render(rendered); });
  expect(transport.present).toHaveBeenCalledTimes(1);
  await act(async () => { layout.set(latest); });
  expect(transport.present).toHaveBeenCalledTimes(2);
  expect(transport.present.mock.calls[1][1]).toBe(false);
});

it.each(["resolve", "reject"] as const)("ignores an obsolete presentation's %s feedback", async outcome => {
  const obsolete = held(), recovery = held();
  transport.present.mockImplementationOnce(() => obsolete.promise)
    .mockRejectedValueOnce(new Error("Current layout presentation failed."))
    .mockImplementation(() => recovery.promise);
  render(<LiveApp />);
  await waitFor(() => expect(transport.present).toHaveBeenCalledTimes(1));
  const current = layout.session.getSnapshot();
  await act(async () => { layout.set({ ...current, snapshot: { ...current.snapshot!, revision: 2 } }); });
  expect(await screen.findByText("Current layout presentation failed.")).toBeTruthy();
  await act(async () => { outcome === "resolve" ? obsolete.resolve() : obsolete.reject(new Error("Obsolete presentation failed.")); });
  expect(screen.getByText("Current layout presentation failed.")).toBeTruthy();
  expect(screen.queryByText("Obsolete presentation failed.")).toBeNull();
});

it("ignores presentation feedback after unmount", async () => {
  const pending = held(); transport.present.mockImplementation(() => pending.promise);
  const view = render(<LiveApp />);
  await waitFor(() => expect(transport.present).toHaveBeenCalledTimes(1));
  view.unmount();
  await act(async () => { pending.reject(new Error("Presentation finished after unmount.")); });
  expect(transport.present).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Presentation finished after unmount.")).toBeNull();
});

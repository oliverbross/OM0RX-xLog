// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import LiveApp from "../src/LiveApp";
import { operatorDraftFixture, testPreferenceSnapshot, testWorkspaceGeneration, testWorkspacePreferences } from "./operator-draft-fixture";
import { contactEditFixture } from "./contact-edit-fixture";
import { defaultRotorConfiguration } from "../src/live/rotorConfigurationSession";

const bridge = vi.hoisted(() => ({ request: vi.fn(), native: vi.fn(), tune: null as null | ((value: any) => void), rejectActivation: null as null | ((cause: Error) => void), rotorGeneration: 4,
  autoState: null as any, autoChanged: null as null | ((value: any) => void),
  nativeSelection: false, selection: vi.fn(), applySelection: vi.fn(),
  nativeStop: false, canvasStop: false,
  rotorConfiguration: null as any,
  preferenceView: null as any, preferenceChange: null as null | ((value: any) => void),
  telemetry: vi.fn(), stationTelemetry: vi.fn(), selectTelemetry: vi.fn(), intentId: null as string | null, activeRadio: "radio1" as "radio1" | "radio2" }));
vi.mock("@tauri-apps/api/core", async original => ({ ...await original<typeof import("@tauri-apps/api/core")>(),
  invoke: (command: string, params: any) => command === "monitor_rotor_stop" ? bridge.native(command, params)
    : command === "station_session_request" && params?.params?.action === "serial_ports" ? Promise.resolve({ ports: [] })
    : command === "station_session_request" && params?.params?.action === "hamlib_catalogue" ? Promise.resolve({ models: [] })
    : command === "station_session_request" && params?.params?.action === "snapshot" ? Promise.resolve({ radio_id: params.params.radio_id, active_radio: bridge.activeRadio, tx_owner: null,
      generation: `${params.params.radio_id}-fixture`, revision: 1, base_url: "", last_receipt: null, selection: { provider: "direct_agent", generation: 1, selection_id: "fixture" } }) : Promise.resolve({}) }));
vi.mock("@tauri-apps/api/event", async original => {
  const actual = await original<typeof import("@tauri-apps/api/event")>();
  return { ...actual, listen: (event: string, handler: any, options?: any) => event === "xlog:station-session"
    ? Promise.resolve(() => {}) : actual.listen(event, handler, options) };
});
vi.mock("../src/live/useSpotEditor", async () => {
  const { useEffect } = await import("react");
  return { nativeSpotEditor: () => bridge.nativeStop, useSpotEditor: (participants: any[]) => {
    useEffect(() => { if (bridge.nativeStop) participants.forEach(item => item.setSpotEditorRegistered(true)); }, []);
    return { status: null, error: "", reconcile: async () => true };
  } };
});
vi.mock("../src/live/OperatorCanvas", async original => {
  const { default: Canvas } = await original<typeof import("../src/live/OperatorCanvas")>();
  return { default: (props: any) => bridge.canvasStop
    ? <section aria-label="Synthetic canvas rotor">{props.panels.rotor?.content}{props.panels.rotor?.safetyAction}</section>
    : <Canvas {...props} /> };
});
vi.mock("../src/live/useAutoRotor", async () => {
  const { useEffect, useState } = await import("react");
  return { useAutoRotor: () => {
    const [state, update] = useState(bridge.autoState);
    useEffect(() => { bridge.autoChanged = value => { bridge.autoState = value; update(value); }; return () => { bridge.autoChanged = null; }; }, []);
    return { state, error: "", refresh: async () => {}, set: async (armed: boolean, rotor?: any) => {
      const value = await bridge.native("auto_rotor_set", armed ? { armed, owner: rotor.owner, generation: rotor.generation } : { armed });
      bridge.autoChanged?.(value);
    } };
  } };
});
vi.mock("../src/live/useFollowRadio", () => ({ useFollowRadio: () => ({
  state: { enabled: false, epoch: 0, error: "", settlementPending: false, operation: null },
  error: "", refresh: async () => {}, set: async () => ({ enabled: false, epoch: 0, error: "", settlementPending: false, operation: null }),
}) }));
vi.mock("../src/live/useSpotActivation", async () => {
  const { useEffect, useRef, useState } = await import("react");
  const { SpotActivationClient } = await import("../src/live/spotActivationClient");
  return { useSpotActivation: () => {
    const client = useRef<InstanceType<typeof SpotActivationClient> | null>(null);
    client.current ??= new SpotActivationClient(bridge.native);
    const current = client.current, [state, update] = useState(current.getSnapshot());
    useEffect(() => { const stop = current.subscribe(() => update(current.getSnapshot())); return () => { stop(); current.dispose(); }; }, [current]);
    return { ...state, activate: (spot: any) => current.activate(spot), canActivate: () => current.canActivate(),
      supersedeRotor: () => current.supersedeRotor(), reconcile: () => current.reconcile(), retire: () => current.retire() };
  } };
});
vi.mock("../src/live/rotorTelemetry", () => ({ connectRotorTelemetry: bridge.telemetry }));
vi.mock("../src/live/stationTelemetry", () => ({ connectStationTelemetry: bridge.stationTelemetry }));
vi.mock("../src/live/stationSelection", () => ({ nativeStationSelection: () => bridge.nativeSelection, connectStationSelection: bridge.selection, applyStationSelection: bridge.applySelection }));
vi.mock("../src/worker", async original => ({ ...await original<typeof import("../src/worker")>(), workerRequest: bridge.request }));
vi.mock("../src/live/operatorDraftTransport", () => ({ requestOperatorDraft: async (method: string, params: any = {}) => (await bridge.request(method, params)).result }));
vi.mock("../src/live/logbookContactTransport", () => ({ requestLogbookContact: async (method: string, params: any = {}) => (await bridge.request(method, params)).result }));
vi.mock("../src/Map", () => ({ default: () => <div>Map</div> }));
vi.mock("../src/live/Conditions", () => ({ default: () => <div>Conditions</div> }));
vi.mock("../src/live/BandMaps", async original => ({ ...await original<typeof import("../src/live/BandMaps")>(),
  default: ({ preferences: view, onPreferencesChange }: any) => {
    bridge.preferenceView = view; bridge.preferenceChange = onPreferencesChange;
    return <div><output data-testid="map-font">{view?.fontScale}</output><output data-testid="map-bands">{view?.bands.join(",")}</output><button disabled={!view} onClick={() => onPreferencesChange?.({ ...view, fontScale: Number((view.fontScale + 0.1).toFixed(1)) })}>Increase map font</button></div>;
  } }));
vi.mock("../src/live/ClusterPanel", () => ({ ClusterPanel: ({ onSelect }: any) => <button onClick={() => onSelect({ id: "spot", callsign: "K1ABC", frequencyKHz: 14074, mode: "FT8", band: "20m",
  activation: { sourceEpoch: "10000000-0000-4000-8000-000000000001", spotVersion: "20000000-0000-4000-8000-000000000001" } })}>Select test spot</button> }));
const preferences = testWorkspacePreferences({ deskBandMapBands: ["20m"], detachedBandMapBands: ["20m"], detachedBandMapLayout: "Single row", intelligenceBands: ["20m"] });
const preferenceGeneration = "12345678-1234-4234-8234-123456789abc";
function controlOneSecondPolls() {
  // Control only the app's 1000ms snapshot intervals. Keep Testing Library's
  // 50ms waits, lookup debounces and all other timers real; no wall-clock sleeps
  // or shortened application poll periods are needed to prove poll/reply order.
  const callbacks = new Map<number, () => void>(); let nextId = -1000;
  const interval = globalThis.setInterval, clear = globalThis.clearInterval;
  vi.spyOn(globalThis, "setInterval").mockImplementation(((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (delay === 1000 && typeof callback === "function") {
      const id = nextId--; callbacks.set(id, () => callback(...args)); return id;
    }
    return interval(callback, delay, ...args);
  }) as typeof setInterval);
  vi.spyOn(globalThis, "clearInterval").mockImplementation(((id: ReturnType<typeof setInterval>) => {
    if (!callbacks.delete(id as unknown as number)) clear(id);
  }) as typeof clearInterval);
  return async () => {
    const before = bridge.request.mock.calls.filter(([method]) => method === "rotor_snapshot").length;
    await act(async () => { for (const callback of [...callbacks.values()]) callback(); });
    expect(bridge.request.mock.calls.filter(([method]) => method === "rotor_snapshot").length).toBeGreaterThan(before);
  };
}
async function openRotorSettings() {
  const sidebar = document.querySelector<HTMLElement>(".sidebar");
  if (!sidebar) throw new Error("Sidebar unavailable");
  fireEvent.click(within(sidebar).getByRole("button", { name: "Settings" }));
  fireEvent.click(await screen.findByRole("tab", { name: "Rotator" }));
  return screen.findByRole("region", { name: "Independent rotor" });
}
async function openRadioSettings() {
  const sidebar = document.querySelector<HTMLElement>(".sidebar");
  if (!sidebar) throw new Error("Sidebar unavailable");
  fireEvent.click(within(sidebar).getByRole("button", { name: "Settings" }));
  fireEvent.click(await screen.findByRole("tab", { name: "Radio" }));
  await screen.findByRole("tab", { name: /^Radio 1/ });
}
async function waitForDesk() {
  return screen.findByLabelText("Desk Frequency MHz");
}
async function armAutoRotor() {
  await waitFor(() => expect(bridge.autoChanged).not.toBeNull());
  await act(async () => { await bridge.native("auto_rotor_set", { armed: true, owner: "native_dcu1", generation: 4 }); });
}
beforeEach(() => {
  localStorage.clear(); bridge.request.mockReset(); bridge.native.mockReset(); bridge.tune = null; bridge.rejectActivation = null; bridge.rotorGeneration = 4; bridge.intentId = null;
  bridge.autoState = { armed: false, epoch: 0, owner: "native_dcu1", generation: 4, target: null, activation_pending: false, canonical_pending: false, error: "" }; bridge.activeRadio = "radio1";
  bridge.rotorConfiguration = { revision: 0, generation: testWorkspaceGeneration, configuration: {
    ...defaultRotorConfiguration(), native_dcu1: { host: "rotor.example.invalid", port: 4001, name: "Rotor" },
  } };
  bridge.autoChanged = null;
  bridge.nativeStop = false; bridge.canvasStop = false;
  bridge.preferenceView = null; bridge.preferenceChange = null;
  bridge.telemetry.mockReset(); bridge.telemetry.mockReturnValue(null);
  bridge.nativeSelection = false; bridge.selection.mockReset(); bridge.selection.mockReturnValue(null); bridge.applySelection.mockReset();
  bridge.stationTelemetry.mockReset(); bridge.stationTelemetry.mockReturnValue(null); bridge.selectTelemetry.mockReset(); bridge.selectTelemetry.mockResolvedValue(undefined);
  const sharedDraft = operatorDraftFixture({ id: "draft", call: "", start: "2026-10-12T00:00:00Z", frequencyHz: 14074000, mode: "FT8", band: "20m" });
  const loggedContact = { id: "logged-contact", call: "7P8GE", start: "2026-10-21T12:27:17Z", frequencyHz: 28030000, mode: "CW", band: "10m" };
  const contactBackend = contactEditFixture(loggedContact);
  bridge.native.mockImplementation(async (command: string, params: any = {}) => {
    if (command === "auto_rotor_set") {
      const state = { ...bridge.autoState, armed: params.armed, epoch: bridge.autoState.epoch + 1, generation: bridge.rotorGeneration };
      bridge.autoChanged?.(state); return state;
    }
    if (command === "supersede_spot_rotor") {
      bridge.rotorGeneration++; bridge.intentId = null;
      return { operationId: params.operationId, superseded: true, stopAcknowledged: true };
    }
    if (command === "activate_spot") {
      // Synthetic native backend resolves this retained identity. The renderer
      // submits no tuning/contact fields, and never performs this canonical write.
      expect(params).toEqual({ operationId: expect.any(String), sourceEpoch: "10000000-0000-4000-8000-000000000001",
        spotId: "spot", spotVersion: "20000000-0000-4000-8000-000000000001" });
      const base = (sharedDraft("logbook_operator_draft") as any).draft;
      sharedDraft("logbook_operator_draft_apply", { operationID: params.operationId, generation: base.generation, draftID: base.qso.id,
        expectedRevision: base.revision, action: "replace", qso: { ...base.qso, call: "K1ABC", frequencyHz: 14074000, mode: "FT8", band: "20m",
          comment: "POTA US-0001 SOTA FL/VO-209 IOTA EU-002", potaReference: "US-0001", sotaReference: "FL/VO-209", iota: "EU-002" } });
      window.dispatchEvent(new Event("focus"));
      return new Promise((resolve, reject) => {
        bridge.rejectActivation = reject;
        bridge.tune = value => resolve({ operationId: params.operationId, phase: value.confirmed ? "confirmed" : "failed",
          tuneConfirmed: value.confirmed === true, rotor: "not_requested", reservationActive: false });
      });
    }
    if (command === "spot_activation_snapshot") return { operationId: null, phase: "idle", barrier: null };
    throw new Error(`Unexpected native command ${command}`);
  });
  bridge.request.mockImplementation(async (method: string, params: any = {}) => {
    const shared = sharedDraft(method, params);
    if (shared) return { result: shared };
    if (method.startsWith("logbook_contact")) return { result: contactBackend.request(method, params) };
    if (method === "rotor_stop") {
      bridge.rotorGeneration++; bridge.intentId = null;
      bridge.autoChanged?.({ ...bridge.autoState, armed: false, epoch: bridge.autoState.epoch + 1 });
    }
    if (method === "rotor_goto") {
      bridge.rotorGeneration++; bridge.intentId = params.intent_id ?? null;
    }
    const result = method === "workspace_status" ? { workspace_exists: true, native_log_exists: true }
      : method === "workspace_preferences_load" ? { ...testPreferenceSnapshot(preferences), generation: preferenceGeneration }
      : method === "settings_load" ? { settings: { stationCall: "OM0RX", gridSquare: "JN88" }, revision: 0, generation: testWorkspaceGeneration }
      : method === "workspace_rotor_configuration_load" ? structuredClone(bridge.rotorConfiguration)
      : method === "workspace_rotor_configuration_save" ? (() => {
        const next = { revision: bridge.rotorConfiguration.revision + 1, generation: testWorkspaceGeneration,
          configuration: structuredClone(params.configuration) };
        bridge.rotorConfiguration = next;
        return { status: "applied", ...next, receipt: { mutation: structuredClone(params), snapshot: structuredClone(next) } };
      })()
      : method === "workspace_rotor_configuration_receipt" ? { receipt: null }
      : method === "logbook_stats" ? { stats: { qso_count: 1 } }
      : method === "logbook_list" ? { qsos: [loggedContact], total: 1, offset: 0, limit: 20 }
      : method === "logbook_draft" ? { qso: { id: "draft", call: "", start: "2026-10-12T00:00:00Z", frequencyHz: 14074000, mode: "FT8", band: "20m" } }
      : method === "station_snapshot" ? { source: params.provider, generated_at: Date.now() / 1000, radio: { connected: true, observed: true, frequency_hz: 14074000, mode: "DIGU" } }
      : ["rotor_snapshot", "rotor_stop", "rotor_goto"].includes(method) ? { owner: "native_dcu1", generation: bridge.rotorGeneration, intent_id: bridge.intentId, state: "active", backend_available: true, backend: { connected: true, name: "Antenna", azimuth: 53 } }
      : method === "cluster_snapshot" ? { snapshot: { spots: [], connectedClusters: 0 } }
      : method === "lookup_call" ? { call: params.call, bearing: 90, country: "United States" }
      : method === "logbook_previous" ? { qsos: [] } : {};
    return { result };
  });
});

it("follows native radio telemetry without polling but Read radio still uses explicit readback", async () => {
  let update!: (value: any) => void, unavailable!: () => void;
  const stop = vi.fn();
  bridge.stationTelemetry.mockImplementation((_radioId, _provider, changed, failed) => { update = changed; unavailable = failed; return stop; });
  const view = render(<LiveApp />);
  await screen.findByLabelText("Desk Frequency MHz");
  await act(async () => update({ source: "direct_agent", radio: { connected: true, observed: true, frequency_hz: 7050000, mode: "CW" } }));
  expect((screen.getByLabelText("Desk Frequency MHz") as HTMLInputElement).value).toBe("7.050000");
  expect(bridge.request.mock.calls.filter(([method]) => method === "station_snapshot")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Read radio" }));
  await waitFor(() => expect((screen.getByLabelText("Desk Frequency MHz") as HTMLInputElement).value).toBe("14.074000"));
  expect(bridge.request.mock.calls.filter(([method]) => method === "station_snapshot")).toHaveLength(1);
  await act(async () => unavailable());
  expect((screen.getByLabelText("Desk Frequency MHz") as HTMLInputElement).value).toBe("14.074000");
  expect(bridge.request.mock.calls.filter(([method]) => method === "station_tune")).toHaveLength(0);
  view.unmount(); expect(stop).toHaveBeenCalledOnce();
});

it("opens a logged contact without disarming automatic rotor", async () => {
  bridge.nativeStop = true;
  render(<LiveApp />);
  await waitForDesk();
  await armAutoRotor();
  const commandsBeforeEdit = bridge.native.mock.calls.filter(([command]) => command === "auto_rotor_set").length;
  fireEvent.click(screen.getByRole("button", { name: "Logbook" }));
  await screen.findByText("7P8GE");
  await waitFor(() => expect(screen.getByRole("region", { name: "Logbook contacts, scroll for more columns" }).getAttribute("aria-busy")).toBe("false"));
  fireEvent.click(screen.getByText("7P8GE"));
  await waitFor(() => expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("7P8GE"));
  expect(bridge.native.mock.calls.filter(([command]) => command === "auto_rotor_set")).toHaveLength(commandsBeforeEdit);
  expect(bridge.autoState.armed).toBe(true);
});

it("uses native rotor telemetry without a renderer poller and keeps Auto Rotor out of the desk", async () => {
  let update!: (value: any) => void, unavailable!: () => void;
  const stop = vi.fn();
  bridge.telemetry.mockImplementation((changed, failed) => { update = changed; unavailable = failed; return stop; });
  const view = render(<LiveApp />);
  await act(async () => update({ owner: "native_dcu1", generation: 4, state: "active", backend_available: true,
    backend: { connected: true, name: "Antenna", azimuth: 53 } }));
  await waitForDesk();
  expect(screen.queryByRole("checkbox", { name: "Auto rotor" })).toBeNull();
  await armAutoRotor();
  expect(bridge.native).toHaveBeenCalledWith("auto_rotor_set", { armed: true, owner: "native_dcu1", generation: 4 });
  await act(async () => unavailable());
  // Loss of a renderer projection is not itself new command authority.
  expect(bridge.autoState.armed).toBe(true);
  await act(async () => bridge.autoChanged?.({ ...bridge.autoState, armed: false, epoch: 2 }));
  expect(bridge.autoState.armed).toBe(false);
  expect(bridge.request.mock.calls.filter(([method]) => method === "rotor_snapshot")).toHaveLength(0);
  expect(bridge.request.mock.calls.filter(([method]) => method === "rotor_goto")).toHaveLength(0);
  view.unmount(); expect(stop).toHaveBeenCalledOnce();
});

it("Canvas native Stop sends one owner-only command with zero pre/post device snapshots", async () => {
  bridge.nativeStop = true; bridge.canvasStop = true;
  let observe!: (snapshot: any) => void;
  bridge.telemetry.mockImplementation(changed => { observe = changed; return vi.fn(); });
  const original = bridge.native.getMockImplementation()!;
  bridge.native.mockImplementation(async (command, params) => command === "monitor_rotor_stop"
    ? { ok: true, result: { owner: "native_dcu1", generation: 5, state: "active" } }
    : original(command, params));
  render(<LiveApp />);
  await act(async () => observe({ owner: "native_dcu1", generation: 4, state: "active", backend_available: true,
    backend: { connected: true, name: "Retained rotor", azimuth: 53 } }));
  fireEvent.click(await screen.findByRole("button", { name: "■ Stop rotor" }));
  await screen.findByText("Stop accepted; watch the observed rotor state.");
  expect(bridge.native.mock.calls.filter(([command]) => command === "monitor_rotor_stop")).toEqual([["monitor_rotor_stop", { owner: "native_dcu1" }]]);
  expect(bridge.request.mock.calls.filter(([method]) => ["rotor_snapshot", "rotor_stop"].includes(method))).toEqual([]);
});

it("Canvas native Stop retains uncertainty after a lost reply without a snapshot fallback or retry", async () => {
  bridge.nativeStop = true; bridge.canvasStop = true;
  let observe!: (snapshot: any) => void;
  bridge.telemetry.mockImplementation(changed => { observe = changed; return vi.fn(); });
  const original = bridge.native.getMockImplementation()!;
  bridge.native.mockImplementation(async (command, params) => {
    if (command === "monitor_rotor_stop") throw new Error("Stop acknowledgement lost");
    return original(command, params);
  });
  render(<LiveApp />);
  await act(async () => observe({ owner: "native_dcu1", generation: 4, state: "active", backend_available: true,
    backend: { connected: true, name: "Retained rotor", azimuth: 53 } }));
  fireEvent.click(await screen.findByRole("button", { name: "■ Stop rotor" }));
  await screen.findByText("Stop acknowledgement lost");
  expect(screen.queryByText("Stop accepted; watch the observed rotor state.")).toBeNull();
  // Recovery wakes may refresh retained projections, but must never replay Stop
  // or introduce a direct worker snapshot as an acknowledgement substitute.
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(screen.getByText("Stop acknowledgement lost")).toBeTruthy();
  expect(bridge.native.mock.calls.filter(([command]) => command === "monitor_rotor_stop")).toEqual([["monitor_rotor_stop", { owner: "native_dcu1" }]]);
  expect(bridge.request.mock.calls.filter(([method]) => ["rotor_snapshot", "rotor_stop"].includes(method))).toEqual([]);
});

it.each(["before", "after"])("retains native automatic authority when rotor telemetry is polled %s activation acknowledgement", async order => {
  const poll = controlOneSecondPolls();
  render(<LiveApp />);
  await waitForDesk();
  await armAutoRotor();
  fireEvent.click(screen.getByRole("button", { name: "DX Cluster" }));
  fireEvent.click(await screen.findByRole("button", { name: "Select test spot" }));
  await waitFor(() => expect(bridge.tune).not.toBeNull());
  bridge.rotorGeneration = 5; bridge.intentId = "native-owned-motion";
  if (order === "before") await poll();
  await act(async () => { bridge.tune?.({ accepted: true, confirmed: true }); });
  if (order === "after") await poll();
  fireEvent.click(screen.getByRole("button", { name: "Operator Desk" }));
  expect(bridge.autoState.armed).toBe(true);
  expect(bridge.native.mock.calls.filter(([command]) => command === "activate_spot")).toHaveLength(1);
  expect(bridge.request.mock.calls.some(([method]) => ["station_tune", "rotor_goto"].includes(method))).toBe(false);
});

it.each(["rejected", "late success"])("manual monitor motion disarms pending auto and cannot rearm from %s", async outcome => {
  const poll = controlOneSecondPolls();
  render(<LiveApp />);
  await waitForDesk();
  await armAutoRotor();
  fireEvent.click(screen.getByRole("button", { name: "DX Cluster" }));
  fireEvent.click(await screen.findByRole("button", { name: "Select test spot" }));
  await waitFor(() => expect(bridge.tune).not.toBeNull());
  // Same expected generation belongs to a competing manual intent, or a second
  // generation after this auto turn. Neither observation is ours.
  bridge.intentId = null;
  if (outcome === "late success") bridge.rotorGeneration++;
  await act(async () => bridge.autoChanged?.({ ...bridge.autoState, armed: false, epoch: 2 }));
  await poll();
  await act(async () => {
    if (outcome === "rejected") bridge.rejectActivation?.(new Error("Rotor generation changed"));
    else bridge.tune?.({ accepted: true, confirmed: true });
  });
  fireEvent.click(screen.getByRole("button", { name: "Operator Desk" }));
  expect(bridge.autoState.armed).toBe(false);
  expect(bridge.request.mock.calls.filter(([method]) => method === "rotor_goto")).toHaveLength(0);
  expect(bridge.native.mock.calls.filter(([command]) => command === "auto_rotor_set")).toHaveLength(1);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("never turns from a late lookup after an unconfirmed spot tune", async () => {
  const base = bridge.request.getMockImplementation()!;
  let lookupReply: ((value: any) => void) | undefined;
  bridge.request.mockImplementation(async (method: string, params: any = {}) => method === "lookup_call"
    ? new Promise(resolve => { lookupReply = result => resolve({ result }); }) : base(method, params));
  render(<LiveApp />);
  await waitForDesk();
  await armAutoRotor();
  fireEvent.click(screen.getByRole("button", { name: "DX Cluster" }));
  fireEvent.click(await screen.findByRole("button", { name: "Select test spot" }));
  await waitFor(() => expect(bridge.tune).not.toBeNull());
  await waitFor(() => expect(lookupReply).toBeDefined());
  await act(async () => bridge.tune?.({ accepted: true, confirmed: false }));
  await act(async () => lookupReply?.({ call: "K1ABC", bearing: 90 }));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  expect(bridge.request.mock.calls.some(([method]) => method === "rotor_goto")).toBe(false);
});

it("retains native-applied spot references without replacing newer input during display-only validation", async () => {
  const base = bridge.request.getMockImplementation()!;
  let resolveReferences: ((value: any) => void) | undefined;
  bridge.request.mockImplementation(async (method: string, params: any = {}) => {
    if (method === "reference_resolve") return new Promise(resolve => { resolveReferences = result => resolve({ result }); });
    return base(method, params);
  });
  render(<LiveApp />);
  await waitForDesk();
  fireEvent.click(screen.getByRole("button", { name: "DX Cluster" }));
  fireEvent.click(await screen.findByRole("button", { name: "Select test spot" }));
  await waitFor(() => expect(resolveReferences).toBeDefined());
  const oldValidation = resolveReferences!;
  fireEvent.click(screen.getByRole("button", { name: "Operator Desk" }));
  fireEvent.change(screen.getByLabelText("Desk POTA"), { target: { value: "US-9999" } });
  fireEvent.change(screen.getByLabelText("Desk IOTA"), { target: { value: "EU-001" } });
  fireEvent.change(screen.getByLabelText("Desk IOTA"), { target: { value: "" } });
  await act(async () => oldValidation({ fields: { sotaReference: "OLD/AA-001" },
    references: [{ kind: "sota", reference: "OLD/AA-001", status: "verified", name: "Stale validation" }] }));
  expect(screen.queryByText(/Stale validation/)).toBeNull();
  await waitFor(() => expect(resolveReferences).not.toBe(oldValidation));
  await act(async () => resolveReferences?.({ fields: { sotaReference: "WRONG/AA-002", potaReference: "US-0001", iota: "EU-002" },
    references: [{ kind: "sota", reference: "FL/VO-209", status: "verified", name: "Summit" }] }));
  expect((screen.getByLabelText("Desk SOTA") as HTMLInputElement).value).toBe("FL/VO-209");
  expect((screen.getByLabelText("Desk POTA") as HTMLInputElement).value).toBe("US-9999");
  expect((screen.getByLabelText("Desk IOTA") as HTMLInputElement).value).toBe("");
  expect(await screen.findByText(/SOTA FL\/VO-209 · Verified: Summit/)).toBeTruthy();
});

it("discards reference results when the operator has changed the callsign", async () => {
  const base = bridge.request.getMockImplementation()!;
  let resolveReferences: ((value: any) => void) | undefined;
  bridge.request.mockImplementation(async (method: string, params: any = {}) => method === "reference_resolve"
    ? new Promise(resolve => { resolveReferences = result => resolve({ result }); }) : base(method, params));
  render(<LiveApp />);
  await waitForDesk();
  fireEvent.click(screen.getByRole("button", { name: "DX Cluster" }));
  fireEvent.click(await screen.findByRole("button", { name: "Select test spot" }));
  await waitFor(() => expect(resolveReferences).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: "Operator Desk" }));
  fireEvent.change(screen.getByLabelText("Desk Callsign"), { target: { value: "EA7EU" } });
  await act(async () => resolveReferences?.({ fields: { sotaReference: "FL/VO-209" }, references: [] }));
  expect((screen.getByLabelText("Desk SOTA") as HTMLInputElement).value).toBe("");
});

it("arms native automatic following for typed calls without renderer-owned turns or polling replays", async () => {
  const poll = controlOneSecondPolls();
  render(<LiveApp />);
  await waitForDesk();
  fireEvent.change(screen.getByLabelText("Desk Callsign"), { target: { value: "EA7EU" } });
  await waitFor(() => expect(bridge.request).toHaveBeenCalledWith("lookup_call", { call: "EA7EU" }));
  expect(bridge.request.mock.calls.some(([method]) => method === "rotor_goto")).toBe(false);
  await armAutoRotor();
  await waitFor(() => expect(bridge.native).toHaveBeenCalledWith("auto_rotor_set", { armed: true, owner: "native_dcu1", generation: 4 }));
  await poll();
  expect(bridge.request.mock.calls.filter(([method]) => method === "rotor_goto")).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Desk Callsign"), { target: { value: "OM0AAO" } });
  await waitFor(() => expect(bridge.request).toHaveBeenCalledWith("lookup_call", { call: "OM0AAO" }));
  expect(bridge.request.mock.calls.filter(([method]) => method === "rotor_goto")).toHaveLength(0);
  expect(bridge.native.mock.calls.filter(([command]) => command === "auto_rotor_set")).toHaveLength(1);
});

it.each(["Operator Desk", "Log QSO"])("saves exactly once on Command-Enter in %s without a global shortcut duplicate", async view => {
  const base = bridge.request.getMockImplementation()!;
  bridge.request.mockImplementation(async (method: string, params: any = {}) => method === "logbook_save" ? { result: { qso: params.qso } } : base(method, params));
  render(<LiveApp />);
  await waitForDesk();
  if (view === "Log QSO") fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: view }));
  const input = await screen.findByLabelText(view === "Log QSO" ? "Callsign" : "Desk Callsign");
  fireEvent.change(input, { target: { value: "K1ABC" } });
  fireEvent.keyDown(input, { key: "Enter", metaKey: true });
  await waitFor(() => expect(bridge.request.mock.calls.filter(([method, params]) => method === "logbook_operator_draft_apply" && params.action === "save")).toHaveLength(1));
  expect(bridge.request.mock.calls.some(([method]) => method === "logbook_save")).toBe(false);
});

it("passes authentic observed radio and configured station provenance to the full editor", async () => {
  render(<LiveApp />);
  await waitForDesk();
  fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: "Log QSO" }));
  await screen.findByText("Station context");
  expect(screen.getAllByText("configured")).toHaveLength(2);
  expect(screen.getAllByText("observed")).toHaveLength(2);
  expect(screen.getByText("14.074000 MHz")).toBeTruthy();
});

it("does not write an old explicit radio readback into a newly cleared QSO draft", async () => {
  render(<LiveApp />);
  await waitForDesk();
  const base = bridge.request.getMockImplementation()!;
  let read: null | ((value: any) => void) = null;
  bridge.request.mockImplementation(async (method: string, params: any = {}) => {
    if (method === "station_snapshot") return new Promise(resolve => { read = result => resolve({ result }); });
    if (method === "logbook_draft") return { result: { qso: { id: "new-draft", call: "", start: "2026-10-12T00:00:00Z", frequencyHz: 14074000, band: "20m", mode: "FT8" } } };
    return base(method, params);
  });
  fireEvent.change(screen.getByLabelText("Desk Callsign"), { target: { value: "K1ABC" } });
  fireEvent.click(screen.getByRole("button", { name: "Read radio" }));
  await waitFor(() => expect(read).not.toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Clear QSO" }));
  await waitFor(() => expect((screen.getByLabelText("Desk Callsign") as HTMLInputElement).value).toBe(""));
  fireEvent.change(screen.getByLabelText("Desk Frequency MHz"), { target: { value: "21.100000" } });
  await act(async () => { (read as unknown as (value: any) => void)({ radio: { connected: true, observed: true, frequency_hz: 7025000, mode: "CW" } }); });
  expect((screen.getByLabelText("Desk Frequency MHz") as HTMLInputElement).value).toBe("21.100000");
  expect((screen.getByLabelText("Desk Band") as HTMLSelectElement).value).toBe("15m");
});

it("does not overwrite a newer preference save with a late failed-save recovery load", async () => {
  const base = bridge.request.getMockImplementation()!;
  let loads = 0, saves = 0;
  let recovery: null | ((value: any) => void) = null;
  bridge.request.mockImplementation(async (method: string, params: any = {}) => {
    if (method === "workspace_preferences_load" && ++loads > 1) return new Promise(resolve => { recovery = value => resolve({ result: value }); });
    if (method === "workspace_band_map_apply") {
      // A lost acknowledgement does not establish whether the first field
      // patch persisted. The later explicit edit has its own verified reply;
      // this held old recovery read must still never replace that newer value.
      if (++saves === 1) throw new Error("Save unavailable");
      return { result: { status: "applied", preferences: { ...preferences, bandMapFontScale: params.patch.fontScale },
        generation: preferenceGeneration, revision: saves, stored: true } };
    }
    return base(method, params);
  });
  render(<LiveApp />);
  await waitFor(() => expect(screen.getByTestId("map-font").textContent).toBe("1"));
  fireEvent.click(screen.getByRole("button", { name: "Increase map font" }));
  await waitFor(() => expect(recovery).not.toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Increase map font" }));
  await waitFor(() => expect(saves).toBe(2));
  await act(async () => { (recovery as unknown as (value: any) => void)({ preferences, stored: true, generation: preferenceGeneration, revision: 0 }); });
  expect(screen.getByTestId("map-font").textContent).toBe("1.2");
});

it("preserves two different preference controls emitted from the same rendered frame", async () => {
  const base = bridge.request.getMockImplementation()!;
  const replies: ((value: any) => void)[] = [];
  bridge.request.mockImplementation(async (method, params = {}) => method === "workspace_band_map_apply"
    ? new Promise(resolve => { replies.push(value => resolve({ result: value })); }) : base(method, params));
  render(<LiveApp />);
  await waitFor(() => expect(screen.getByTestId("map-font").textContent).toBe("1"));
  const rendered = bridge.preferenceView, change = bridge.preferenceChange!;
  act(() => { change({ ...rendered, fontScale: 1.1 }); change({ ...rendered, bands: ["40m"] }); });
  await waitFor(() => expect(replies).toHaveLength(1));
  expect(screen.getByTestId("map-font").textContent).toBe("1.1");
  expect(screen.getByTestId("map-bands").textContent).toBe("40m");
  await act(async () => replies[0]({ generation: preferenceGeneration, revision: 1, stored: true, status: "applied",
    preferences: { ...preferences, bandMapFontScale: 1.1 } }));
  await waitFor(() => expect(replies).toHaveLength(2));
  const writes = bridge.request.mock.calls.filter(([method]) => method === "workspace_band_map_apply");
  expect(writes[0][1].patch).toEqual({ fontScale: 1.1 });
  expect(writes[1][1].patch).toEqual({ bands: ["40m"] });
  expect(writes[1][1].expected).toEqual({ bands: ["20m"] });
  await act(async () => replies[1]({ generation: preferenceGeneration, revision: 2, stored: true, status: "applied",
    preferences: { ...preferences, bandMapFontScale: 1.1, deskBandMapBands: ["40m"] } }));
  expect(screen.getByTestId("map-font").textContent).toBe("1.1");
  expect(screen.getByTestId("map-bands").textContent).toBe("40m");
});

it("cancels pending automatic motion on independent stop and never replays it", async () => {
  const poll = controlOneSecondPolls();
  render(<LiveApp />);
  await waitForDesk();
  const navigation = within(screen.getByRole("navigation"));
  expect(bridge.request.mock.calls.some(([method]) => ["rotor_connect", "rotor_goto"].includes(method))).toBe(false);
  await armAutoRotor();
  fireEvent.click(navigation.getByRole("button", { name: "DX Cluster" }));
  fireEvent.click(await within(screen.getByRole("main")).findByRole("button", { name: "Select test spot" }));
  await waitFor(() => expect(bridge.tune).not.toBeNull());
  const rotor = within(await openRotorSettings());
  fireEvent.click(await rotor.findByRole("button", { name: "Stop rotor" }));
  await waitFor(() => expect(bridge.request).toHaveBeenCalledWith("rotor_stop", { owner: "native_dcu1", generation: 4 }));
  await poll();
  expect(bridge.autoState.armed).toBe(false);
  expect(bridge.request.mock.calls.some(([method]) => method === "rotor_goto")).toBe(false);
  await act(async () => { bridge.tune?.({ accepted: true, confirmed: true }); });
  await poll();
  expect(bridge.request.mock.calls.some(([method]) => method === "rotor_goto")).toBe(false);
  expect(bridge.autoState.armed).toBe(false);
  fireEvent.click(navigation.getByRole("button", { name: "Operator Desk" }));
  await poll();
  expect(bridge.autoState.armed).toBe(false);
  expect(bridge.request.mock.calls.some(([method]) => method === "rotor_goto")).toBe(false);
});

it("controls the existing native Auto rotor owner from Settings", async () => {
  render(<LiveApp />);
  await waitForDesk();
  await openRotorSettings();
  const toggle = await screen.findByRole("checkbox", { name: "Auto rotor" }) as HTMLInputElement;
  await waitFor(() => expect(toggle.disabled).toBe(false));
  fireEvent.click(toggle);
  await waitFor(() => expect(bridge.native).toHaveBeenCalledWith("auto_rotor_set", {
    armed: true, owner: "native_dcu1", generation: 4,
  }));
  await waitFor(() => expect(toggle.checked).toBe(true));
  fireEvent.click(toggle);
  await waitFor(() => expect(bridge.native).toHaveBeenCalledWith("auto_rotor_set", { armed: false }));
});

it("does not offer Auto rotor for an uncertain retained connection and shows the reconnect path", async () => {
  const base = bridge.request.getMockImplementation()!;
  bridge.request.mockImplementation(async (method: string, params: any = {}) => method === "rotor_snapshot"
    ? { result: { owner: "native_dcu1", generation: 4, state: "uncertain", backend_available: false, backend: null } }
    : base(method, params));
  render(<LiveApp />);
  await waitForDesk();
  await openRotorSettings();
  const toggle = await screen.findByRole("checkbox", { name: "Auto rotor" }) as HTMLInputElement;
  expect(toggle.disabled).toBe(true);
  expect(screen.getByText("The rotor connection needs attention. Stop or disconnect it, then reconnect before enabling Auto rotor.")).toBeTruthy();
  fireEvent.click(toggle);
  expect(bridge.native.mock.calls.some(([command]) => command === "auto_rotor_set")).toBe(false);
});

it("stops the fresh same-owner generation while native activation is in flight and never rearms from its reply", async () => {
  render(<LiveApp />);
  await waitForDesk();
  await armAutoRotor();
  fireEvent.click(screen.getByRole("button", { name: "DX Cluster" }));
  fireEvent.click(await screen.findByRole("button", { name: "Select test spot" }));
  await waitFor(() => expect(bridge.tune).not.toBeNull());
  bridge.rotorGeneration = 5; bridge.intentId = "native-owned-motion";
  await openRotorSettings();
  fireEvent.click(await screen.findByRole("button", { name: "Stop rotor" }));
  await waitFor(() => expect(bridge.request).toHaveBeenCalledWith("rotor_stop", { owner: "native_dcu1", generation: 5 }));
  await act(async () => { bridge.tune?.({ accepted: true, confirmed: true }); });
  fireEvent.click(screen.getByRole("button", { name: "Operator Desk" }));
  expect(bridge.autoState.armed).toBe(false);
  expect(bridge.request.mock.calls.filter(([method]) => method === "rotor_stop")).toHaveLength(1);
});

it("does not retry or redirect an explicit Stop across an owner switch", async () => {
  render(<LiveApp />);
  await waitForDesk();
  await openRotorSettings();
  const stop = await screen.findByRole("button", { name: "Stop rotor" });
  const base = bridge.request.getMockImplementation()!;
  bridge.request.mockImplementation(async (method: string, params: any = {}) => method === "rotor_snapshot"
    ? { result: { owner: "hamlib", generation: 5, state: "active", backend: { fields: { position: { Azimuth: "80" } } } } }
    : base(method, params));
  // Capture the rendered old owner, then switch the preflight response and
  // click in one turn. Awaiting a selector after switching lets a background
  // poll legitimately update the button to the new owner on slower runners.
  fireEvent.click(stop);
  await waitFor(() => expect(screen.getAllByText(/Rotor owner changed/).length).toBeGreaterThan(0));
  expect(bridge.request.mock.calls.some(([method]) => method === "rotor_stop")).toBe(false);
});

it("preserves rotor ownership while browsing radio settings", async () => {
  render(<LiveApp />);
  await waitForDesk();
  await openRadioSettings();
  expect(bridge.request.mock.calls.some(([method]) => method === "station_disconnect")).toBe(false);
  expect(bridge.request.mock.calls.some(([method]) => method === "rotor_disconnect")).toBe(false);
  expect(screen.queryByRole("region", { name: "Independent rotor" })).toBeNull();
  await openRotorSettings();
  expect(screen.getByRole("region", { name: "Independent rotor" })).toBeTruthy();
  expect(screen.getByText("053°")).toBeTruthy();
});

it("hydrates the native radio choice before polling and leaves handover with the shared station session", async () => {
  bridge.nativeSelection = true;
  let selected!: (value: any) => void;
  const dispose = vi.fn(); bridge.selection.mockImplementation((_radioId, _legacy, changed) => { selected = changed; return dispose; });
  localStorage.setItem("xlog.integration.provider", "direct_agent");
  const rendered = render(<LiveApp />);
  await waitForDesk();
  expect(bridge.request.mock.calls.some(([method]) => method === "station_snapshot")).toBe(false);
  await waitFor(() => expect(selected).toBeTypeOf("function"));
  await act(async () => selected({ provider: "direct_flex_lan", generation: 7 }));
  await waitFor(() => expect(bridge.request.mock.calls.some(([method, params]) => method === "station_snapshot" && params.provider === "direct_flex_lan")).toBe(true));
  await openRadioSettings();
  const radioOne = screen.getByRole("tabpanel", { name: /^Radio 1/ });
  fireEvent.change(within(radioOne).getByLabelText("Interface"), { target: { value: "hamlib" } });
  expect(bridge.applySelection).not.toHaveBeenCalled();
  expect(within(radioOne).getByLabelText("Serial port")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Use Local Hamlib" })).toBeNull();
  expect(bridge.applySelection).not.toHaveBeenCalled();
  expect(bridge.request.mock.calls.some(([method]) => ["station_disconnect", "hamlib_disconnect", "rotor_disconnect", "station_connect", "hamlib_connect"].includes(method))).toBe(false);
  expect(localStorage.getItem("xlog.integration.provider")).toBe("direct_agent");
  rendered.unmount(); expect(dispose).toHaveBeenCalledOnce();
});

it("routes selection, telemetry and explicit radio reads through persisted Radio 2", async () => {
  bridge.nativeSelection = true; bridge.activeRadio = "radio2";
  bridge.selection.mockImplementation((_radioId, _legacy, changed) => {
    changed({ provider: "direct_agent", generation: 9 }); return vi.fn();
  });
  render(<LiveApp />);
  await waitFor(() => expect(bridge.selection).toHaveBeenCalledWith("radio2", null, expect.any(Function), expect.any(Function)));
  await waitFor(() => expect(bridge.stationTelemetry).toHaveBeenCalledWith("radio2", "direct_agent", expect.any(Function), expect.any(Function), expect.any(Function)));
  fireEvent.click(await screen.findByRole("button", { name: "Read radio" }));
  await waitFor(() => expect(bridge.request.mock.calls.some(([method, params]) => method === "station_snapshot" && params.radio_id === "radio2" && params.provider === "direct_agent")).toBe(true));
});

it("browses the standby radio without disconnecting or changing the active poll provider", async () => {
  render(<LiveApp />);
  await waitForDesk();
  await openRadioSettings();
  fireEvent.click(screen.getByRole("tab", { name: /^Radio 2/ }));
  expect(bridge.request.mock.calls.some(([method]) => method === "hamlib_status")).toBe(false);
  expect(bridge.request.mock.calls.some(([method]) => method === "station_disconnect" || method === "hamlib_disconnect")).toBe(false);
  expect(localStorage.getItem("xlog.integration.provider")).toBeNull();
  await waitFor(() => expect(bridge.request.mock.calls.some(([method, params]) => method === "station_snapshot" && params.provider === "direct_agent")).toBe(true));
  expect(bridge.request.mock.calls.some(([method, params]) => method === "station_snapshot" && params.provider === "direct_flex_lan")).toBe(false);

  expect(bridge.request.mock.calls.some(([method]) => method === "station_connect")).toBe(false);
});

it("keeps provider browsing as a radio-settings draft until explicitly applied", async () => {
  render(<LiveApp />);
  await waitForDesk();
  await openRadioSettings();
  const radioOne = screen.getByRole("tabpanel", { name: /^Radio 1/ });
  fireEvent.change(within(radioOne).getByLabelText("Manufacturer"), { target: { value: "FlexRadio" } });
  fireEvent.change(within(radioOne).getByLabelText("Radio 1 model"), { target: { value: "-107" } });
  expect(within(radioOne).getByLabelText("Radio address")).toBeTruthy();
  expect(within(radioOne).getByRole("button", { name: "Save & Connect" })).toBeTruthy();
  expect(localStorage.getItem("xlog.integration.provider")).toBeNull();
  expect(bridge.request.mock.calls.filter(([method]) => method === "station_disconnect")).toHaveLength(0);
  expect(bridge.request.mock.calls.some(([method, params]) => method === "station_snapshot" && params.provider === "direct_flex_lan")).toBe(false);
});

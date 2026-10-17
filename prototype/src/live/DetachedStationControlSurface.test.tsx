// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetachedStationControlSurface, StationControlSurface } from "./DetachedStationControlSurface";
import { AgentConnectionSetup } from "./AgentConnectionSetup";
import type { StationSession } from "./stationSession";
import { ManualRotorGotoSession } from "./manualRotorGoto";
import { syntheticMonitorContext } from "./monitorContextFixtures";
import type { MonitorContext } from "./monitorContext";
import { readFileSync } from "node:fs";
const detachedStyles = readFileSync("src/live/DetachedStationControlSurface.css", "utf8");
const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), worker: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
vi.mock("../worker", () => ({ workerRequest: native.worker }));

let changed: (value: MonitorContext) => void, failed: (message: string) => void;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-14T00:00:00Z")); vi.clearAllMocks();
  sessionStorage.clear();
  native.invoke.mockImplementation(async command => { if (command === "dock_detached_window") return; if (command !== "monitor_context_snapshot") throw new Error(`Unexpected native command: ${command}`); return syntheticMonitorContext(); });
  native.listen.mockResolvedValue(vi.fn());
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
function setup(value = syntheticMonitorContext()) {
  const refresh = vi.fn(), dispose = vi.fn();
  const connect = (accept: typeof changed, reject: typeof failed) => { changed = accept; failed = reject; accept(value); return { refresh, dispose }; };
  return { ...render(<StationControlSurface connect={connect} />), refresh, dispose };
}
it("mounts through retained native context only, without wrapper actions or a worker request", async () => {
  const view = render(<StationControlSurface />);
  await act(async () => {});
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("monitor_context_snapshot");
  expect(screen.getByText("Observed live")).toBeTruthy();
  expect(native.invoke.mock.calls.every(([command]) => command === "monitor_context_snapshot")).toBe(true);
  expect(screen.queryByRole("button")).toBeNull();
  expect(native.invoke).toHaveBeenCalledOnce(); expect(native.worker).not.toHaveBeenCalled();
  view.unmount();
});
it("renders retained station state in a full-width task shell without wrapper chrome", () => {
  const view = setup();
  expect(screen.getByRole("main", { name: "Detached Station Control" })).toBeTruthy();
  expect(screen.getByText("14.074000 MHz")).toBeTruthy();
  expect(screen.getByText("Observed live")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Station Control" })).toBeNull();
  expect(view.container.firstElementChild?.classList.contains("detached-station-control-app")).toBe(true);
  expect(detachedStyles).toMatch(/\.app\.live\.detached-station-control-app\s*\{[^}]*display: flex/);
  expect(detachedStyles).toContain("grid-template-columns: minmax(0, 1fr)");
  expect(detachedStyles).toContain("grid-template-columns: minmax(0, 3fr) minmax(0, 2fr)");
  expect(detachedStyles).toContain("min-width: 0");
  expect(detachedStyles).not.toMatch(/190px|200px/);
  expect(detachedStyles.match(/\.detached-station-setup, \.detached-station-observations\s*\{[^}]*\}/)?.[0]).not.toContain("max-width");
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  view.unmount(); expect(view.dispose).toHaveBeenCalledOnce();
});
it("expires observations and marks failures without claiming live PTT or SWR", () => {
  setup();
  act(() => { vi.advanceTimersByTime(6000); });
  expect(screen.queryByText("Observed live")).toBeNull();
  expect(screen.getByText(/Observation unavailable or stale/)).toBeTruthy();
  expect(screen.getByText("14.074000 MHz")).toBeTruthy();
  act(() => failed("Native observations unavailable"));
  expect(screen.getByRole("alert").textContent).toContain("Native observations unavailable");
  act(() => changed(syntheticMonitorContext()));
  expect(screen.queryByRole("alert")).toBeNull(); expect(screen.getByText("Observed live")).toBeTruthy();
});
it.each(["direct_flex_lan", "hamlib"] as const)("follows native %s ownership without defaulting to Agent", provider => {
  setup();
  const next = syntheticMonitorContext();
  next.selection = { provider, generation: 3, selection_id: crypto.randomUUID() };
  next.radio = { available: false, snapshot: null };
  act(() => changed(next));
  expect(screen.getByText(provider === "hamlib" ? /Local Hamlib/ : /Direct FLEX LAN/)).toBeTruthy();
  expect(screen.queryByText(/Remote Station Agent/)).toBeNull();
  expect(screen.queryByText("14.074000 MHz")).toBeNull();
  expect(screen.queryByText("Retained station safety")).toBeNull();
});
it("explains absent native selection and never initializes or connects it", () => {
  const value = syntheticMonitorContext(); value.selection = null; value.radio = { available: false, snapshot: null };
  setup(value);
  expect(screen.getByText(/No radio selected/)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
it("shows passive TCI split evidence in the child, expires it independently, and fences selection changes", () => {
  const context = syntheticMonitorContext();
  context.selection!.provider = "direct_tci"; context.radio.provider = "direct_tci";
  context.radio.snapshot = { ...context.radio.snapshot, source: "direct_tci",
    radio: { ...context.radio.snapshot.radio, split: true },
    tci: { trx: 0, channel: 1, split_observed_at: Date.now() / 1000 } };
  setup(context);
  expect(screen.getByText("Observed split: On")).toBeTruthy();
  expect(screen.getByText(/TX VFO and transmit frequency: Unavailable/)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
  act(() => { vi.advanceTimersByTime(6000); });
  const refreshed = structuredClone(context);
  refreshed.radio.received_at_ms = Date.now(); refreshed.radio.snapshot.generated_at = Date.now() / 1000;
  refreshed.radio.snapshot.radio.observed_at = Date.now() / 1000;
  act(() => changed(refreshed));
  expect(screen.getByText("Retained split: On · stale or unverified")).toBeTruthy();
  refreshed.radio.snapshot.tci.split_observed_at = Date.now() / 1000;
  refreshed.selection!.generation += 1;
  act(() => changed(structuredClone(refreshed)));
  expect(screen.queryByText("Observed split: On")).toBeNull();
  expect(native.invoke).not.toHaveBeenCalled(); expect(native.worker).not.toHaveBeenCalled();
});
it("TCI child follows saved selection and exposes only explicit receive tuning", async () => {
  const context = syntheticMonitorContext();
  context.selection!.provider = "direct_tci"; context.radio.provider = "direct_tci"; context.radio.snapshot.source = "direct_tci";
  const state: StationSession = { radio_id: "radio1", active_radio: "radio1", tx_owner: null, generation: "tci-setup", revision: 4, base_url: "", last_receipt: null,
    tci: { endpoint: "ws://127.0.0.1:50001", trx: 0, channel: 0 }, selection: { provider: "direct_tci", generation: context.selection!.generation, selection_id: context.selection!.selection_id } };
  native.invoke.mockImplementation(async (command, args) => {
    if (command === "monitor_context_snapshot") return context;
    if (command === "station_session_request" && args.params.action === "snapshot") return state;
    throw new Error(`Unexpected authority: ${command}`);
  });
  render(<DetachedStationControlSurface />); await act(async () => {});
  expect(screen.getByLabelText("Shared TCI endpoint")).toBeTruthy();
  expect(screen.getByText("TCI permits explicit receive-frequency and mode tuning only. Transmit controls remain unavailable.")).toBeTruthy();
  expect(screen.getByLabelText("Simplex frequency MHz")).toBeTruthy();
  expect(screen.getByLabelText("Simplex mode")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Tune simplex" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Reconnect|PTT|CW|Operate|Standby/i })).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
  expect(native.invoke.mock.calls.every(([command, args]) => command === "monitor_context_snapshot" || args.params.action === "snapshot")).toBe(true);
  expect(native.worker).not.toHaveBeenCalled();
});
it("labels isolated observations and remains passive even when actions are advertised", () => {
  const value = syntheticMonitorContext(); value.acceptance = { synthetic: true, source: "synthetic_memory", externalOwners: false, readOnly: true };
  setup(value);
  expect(screen.getByText("Synthetic isolated observation · read only")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
it("keeps rotor receipt recovery visible across owner loss and remount without duplicating controls", () => {
  const operation = crypto.randomUUID(); let pending: string | null = operation;
  const transport = { snapshot: vi.fn(), request: vi.fn(async () => ({ operation_id:operation,status:"acknowledged" as const,request:{action:"manual_rotor_goto"} })) };
  const journal = { read:() => pending, write:(value:string|null) => { pending=value; } };
  const value = syntheticMonitorContext(); value.rotor = { available:false, revision:2, received_at_ms:Date.now(), snapshot:null };
  const connect = (accept: (value:MonitorContext)=>void) => { accept(value); return { refresh:vi.fn(), dispose:vi.fn() }; };
  const first = render(<StationControlSurface connect={connect} rotorControls rotorSession={new ManualRotorGotoSession(transport, journal)} />);
  expect(screen.getByRole("button", { name:"Check rotor receipt" })).toBeTruthy();
  expect(screen.queryByLabelText("Manual rotor bearing degrees")).toBeNull();
  first.unmount();
  render(<StationControlSurface connect={connect} rotorControls rotorSession={new ManualRotorGotoSession(transport, journal)} />);
  expect(screen.getAllByRole("button", { name:"Check rotor receipt" })).toHaveLength(1);
});
it("keeps exact Stop available through stale telemetry and Goto recovery without replay or clearing its newer failure", async () => {
  const operation = crypto.randomUUID(); let pending: string | null = operation;
  const transport = { snapshot: vi.fn(), request: vi.fn(async () => ({ operation_id:operation,status:"acknowledged" as const,request:{action:"manual_rotor_goto"} })) };
  const journal = { read:() => pending, write:(value:string|null) => { pending=value; } };
  const value = syntheticMonitorContext(); value.rotor.available = false; value.rotor.received_at_ms -= 60_000;
  const connect = (accept: (value:MonitorContext)=>void) => { accept(value); return { refresh:vi.fn(), dispose:vi.fn() }; };
  native.invoke.mockImplementation(async (command, args) => {
    if (command === "monitor_rotor_stop") {
      expect(args).toEqual({ owner:"native_dcu1" });
      throw new Error("Stop acknowledgement lost");
    }
    throw new Error(`Unexpected native command: ${command}`);
  });
  render(<StationControlSurface connect={connect} rotorControls rotorSession={new ManualRotorGotoSession(transport, journal)} />);
  expect(screen.getByRole("button", { name:"Turn rotor" }).hasAttribute("disabled")).toBe(true);
  const stop = screen.getByRole("button", { name:"Stop rotor" });
  expect(stop.hasAttribute("disabled")).toBe(false);
  fireEvent.click(stop); await act(async () => {});
  expect(screen.getByRole("alert").textContent).toContain("Stop acknowledgement lost");
  expect(native.invoke.mock.calls.filter(([command]) => command === "monitor_rotor_stop")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name:"Check rotor receipt" })); await act(async () => {});
  expect(transport.request).toHaveBeenCalledExactlyOnceWith({ action:"receipt", operation_id:operation });
  expect(screen.getByRole("alert").textContent).toContain("Stop acknowledgement lost");
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(native.invoke.mock.calls.filter(([command]) => command === "monitor_rotor_stop")).toHaveLength(1);
});

function sharedAgent(loseConnect = false, loseSelection = false, provider = "direct_agent") {
  let observation = syntheticMonitorContext();
  let state: StationSession = { radio_id: "radio1", active_radio: "radio1", tx_owner: null, generation: "shared-setup", revision: 4, base_url: "https://station.example", last_receipt: null,
    hamlib: { mode: "managed", model: 1, path: "", baud: 9600 },
    flex: { host: "192.168.1.50", port: 4992, station_name: "xLog" },
    selection: { provider, generation: 8, selection_id: "selected-radio" } };
  const actions: Record<string, unknown>[] = [], subscribers = new Map<string, Set<() => void>>();
  native.listen.mockImplementation(async (name: string, handler: () => void) => {
    const listeners = subscribers.get(name) ?? new Set<() => void>(); subscribers.set(name, listeners); listeners.add(handler);
    return () => listeners.delete(handler);
  });
  native.invoke.mockImplementation(async (command, args) => {
    if (command === "monitor_context_snapshot") return structuredClone(observation);
    if (command !== "station_session_request") throw new Error(`Unexpected authority: ${command}`);
    const params = args.params;
    if (params.action === "snapshot") return structuredClone(state);
    if (params.action === "hamlib_catalogue") return { models: [{ id: 1, manufacturer: "Hamlib", model: "Dummy", maturity: "Stable" }, { id: 3073, manufacturer: "Icom", model: "IC-7300", maturity: "Stable" }] };
    if (params.action === "receipt") return state.last_receipt;
    actions.push(params);
    const lost = loseConnect && ["connect", "connect_flex", "reconnect_flex", "receive_frequency", "receive_mode"].includes(params.action) || loseSelection && params.action === "select";
    state = { ...state, revision: state.revision + 1,
      ...(params.action === "save_hamlib" ? { hamlib: params.configuration } : {}),
      ...(params.action === "save_flex" ? { flex: params.configuration } : {}),
      ...(params.action === "select" ? { selection: { provider: params.provider, generation: state.selection.generation + 1, selection_id: crypto.randomUUID() } } : {}),
      last_receipt: { operation_id: params.operation_id, request: { action: params.action }, status: lost ? "unknown" : ["save_hamlib", "save_flex"].includes(params.action) ? "saved" : "acknowledged" } };
    if (lost) throw new Error("Lost child acknowledgement");
    return structuredClone(state.last_receipt);
  });
  return { actions, wake: () => subscribers.get("xlog:station-session")?.forEach(handler => handler()), observeWake: () => subscribers.get("xlog:station-telemetry")?.forEach(handler => handler()), state: () => state, observe: (next: MonitorContext) => { observation = next; } };
}
it("independent child mounts passively and sends exact Agent lifecycle actions through the shared owner", async () => {
  const owner = sharedAgent(); render(<DetachedStationControlSurface />); await act(async () => {});
  expect(owner.actions).toHaveLength(0); expect(native.worker).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /Refresh observations|Dock back/ })).toBeNull();
  expect(screen.queryByText(/independent of Desk|Saved Agent endpoint is shared|Saved Agent setup and connection tests/)).toBeNull();
  expect(screen.getByLabelText("Shared radio provider")).toBeTruthy();
  expect(screen.getByLabelText("Shared Agent token")).toBeTruthy();
  expect(native.invoke.mock.calls.every(([command]) => ["monitor_context_snapshot", "station_session_request"].includes(command))).toBe(true);
  const connect = screen.getByRole("button", { name: "Connect saved Agent" });
  fireEvent.click(connect); fireEvent.click(connect); await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Disconnect Agent" })); await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Forget saved Agent token" })); await act(async () => {});
  expect(owner.actions.map(action => action.action)).toEqual(["connect", "disconnect", "forget"]);
  expect(owner.actions.map(action => action.revision)).toEqual([4, 5, 6]);
  expect(owner.actions.every(action => action.selection_generation === 8 && action.selection_id === "selected-radio")).toBe(true);
  expect(owner.actions.map(action => action.allow_transmit)).toEqual([true, false, false]);
  expect(native.worker).not.toHaveBeenCalled();
});
it("child lost replies survive remount and receipt inspection never resends the operation", async () => {
  const owner = sharedAgent(true); const view = render(<DetachedStationControlSurface />); await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Connect saved Agent" })); await act(async () => {});
  const id = owner.actions[0].operation_id;
  view.unmount(); render(<DetachedStationControlSurface />); await act(async () => {});
  expect(screen.getByRole("button", { name: "Connect saved Agent" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Check connection setup receipt" })); await act(async () => {});
  expect(native.invoke).toHaveBeenLastCalledWith("station_session_request", { params: { action: "receipt", operation_id: id, radio_id: "radio1" } });
  expect(owner.actions).toHaveLength(1); expect(screen.getByText(/Connection outcome is unknown/)).toBeTruthy();
  expect(native.worker).not.toHaveBeenCalled();
});
it("Desk and child converge on shared revisions and a matching completed receipt clears local pending state", async () => {
  const owner = sharedAgent();
  render(<><section aria-label="Desk setup"><AgentConnectionSetup radioId="radio1" connections /></section><DetachedStationControlSurface /></>);
  await act(async () => {});
  const desk = within(screen.getByRole("region", { name: "Desk setup" }));
  const child = within(screen.getByRole("main", { name: "Detached Station Control" }));
  fireEvent.click(desk.getByRole("button", { name: "Connect saved Agent" })); await act(async () => {});
  const receipt = owner.state().last_receipt!;
  // Another webview can retain an operation observed pending before completion.
  sessionStorage.setItem("xlog.station-session.radio1.pending", receipt.operation_id);
  await act(async () => owner.wake());
  expect(sessionStorage.getItem("xlog.station-session.radio1.pending")).toBeNull();
  expect(child.getByRole("button", { name: "Disconnect Agent" }).hasAttribute("disabled")).toBe(false);
  fireEvent.click(child.getByRole("button", { name: "Disconnect Agent" })); await act(async () => {});
  await act(async () => owner.wake());
  expect(owner.actions.map(action => [action.action, action.revision])).toEqual([["connect", 4], ["disconnect", 5]]);
  expect(desk.getByText(/Last shared operation: disconnect/)).toBeTruthy();
  expect(child.getByText(/Last shared operation: disconnect/)).toBeTruthy();
  expect(native.worker).not.toHaveBeenCalled();
});
it("child selection uses exact current identities across Agent to Hamlib to Agent without connection effects", async () => {
  const owner = sharedAgent(); render(<DetachedStationControlSurface />); await act(async () => {});
  expect(owner.actions).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Shared radio provider"), { target: { value: "hamlib" } });
  const apply = screen.getByRole("button", { name: "Apply shared radio selection" });
  fireEvent.click(apply); fireEvent.click(apply); await act(async () => {});
  const intermediate = owner.state().selection.selection_id;
  fireEvent.change(screen.getByLabelText("Shared radio provider"), { target: { value: "direct_agent" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply shared radio selection" })); await act(async () => {});
  expect(owner.actions.map(action => [action.action, action.provider, action.revision, action.selection_generation, action.selection_id]))
    .toEqual([["select", "hamlib", 4, 8, "selected-radio"], ["select", "direct_agent", 5, 9, intermediate]]);
  expect(owner.state().selection.selection_id).not.toBe("selected-radio");
  expect(owner.actions.every(action => !("allow_transmit" in action) && !("base_url" in action))).toBe(true);
  expect(native.worker).not.toHaveBeenCalled();
});
it("Desk provider-only apply uses the same journaled selector without exposing connection controls", async () => {
  const owner = sharedAgent(); render(<AgentConnectionSetup radioId="radio1" providers onlySelection selectionTarget="direct_flex_lan" />); await act(async () => {});
  expect(owner.actions).toHaveLength(0); expect(screen.queryByRole("button", { name: "Connect saved Agent" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Apply shared radio selection" })); await act(async () => {});
  expect(owner.actions).toHaveLength(1); expect(owner.actions[0]).toMatchObject({ action: "select", provider: "direct_flex_lan", selection_generation: 8, selection_id: "selected-radio" });
  expect(screen.getByText("Active · Direct FLEX LAN")).toBeTruthy(); expect(screen.queryByText(/Radio selection acknowledged/)).toBeNull();
  expect(native.worker).not.toHaveBeenCalled();
});
it("lost provider-selection replies recover on child remount and never replay retirement", async () => {
  const owner = sharedAgent(false, true); const view = render(<DetachedStationControlSurface />); await act(async () => {});
  fireEvent.change(screen.getByLabelText("Shared radio provider"), { target: { value: "hamlib" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply shared radio selection" })); await act(async () => {});
  const operation = owner.actions[0].operation_id;
  view.unmount(); render(<DetachedStationControlSurface />); await act(async () => {});
  expect((screen.getByLabelText("Shared radio provider") as HTMLSelectElement).value).toBe("hamlib");
  expect(screen.getByRole("button", { name: "Apply shared radio selection" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Check connection setup receipt" })); await act(async () => {});
  expect(native.invoke).toHaveBeenLastCalledWith("station_session_request", { params: { action: "receipt", operation_id: operation, radio_id: "radio1" } });
  expect(owner.actions).toHaveLength(1); expect(screen.getByText(/Radio selection outcome is unknown/)).toBeTruthy();
  expect(native.worker).not.toHaveBeenCalled();
});
it("Desk and independent child share Hamlib setup and explicitly connect with the current exact selection", async () => {
  const owner = sharedAgent(false, false, "hamlib");
  render(<><section aria-label="Desk Hamlib setup"><AgentConnectionSetup radioId="radio1" hamlib /></section><DetachedStationControlSurface /></>); await act(async () => {});
  const desk = within(screen.getByRole("region", { name: "Desk Hamlib setup" }));
  const child = within(screen.getByRole("main", { name: "Detached Station Control" }));
  expect(owner.actions).toHaveLength(0); expect(native.worker).not.toHaveBeenCalled();
  fireEvent.change(desk.getByLabelText("Shared Hamlib baud"), { target: { value: "19200" } });
  fireEvent.click(desk.getByRole("button", { name: "Save Hamlib configuration" })); await act(async () => {});
  await act(async () => owner.wake());
  expect((child.getByLabelText("Shared Hamlib baud") as HTMLInputElement).value).toBe("19200");
  fireEvent.click(child.getByRole("button", { name: "Connect saved Hamlib radio" })); await act(async () => {});
  await act(async () => owner.wake());
  fireEvent.click(desk.getByRole("button", { name: "Disconnect Hamlib radio" })); await act(async () => {});
  expect(owner.actions.map(action => [action.action, action.revision])).toEqual([["save_hamlib", 4], ["connect_hamlib", 5], ["disconnect_hamlib", 6]]);
  expect(owner.actions[1]).toMatchObject({ selection_generation: 8, selection_id: "selected-radio", allow_transmit: true });
  expect(native.invoke.mock.calls.every(([command]) => ["monitor_context_snapshot", "station_session_request"].includes(command))).toBe(true);
  expect(native.worker).not.toHaveBeenCalled();
});
it("child exposes shared FLEX setup and hides Agent and Hamlib setup and lifecycle controls", async () => {
  const owner = sharedAgent(false, false, "direct_flex_lan");
  render(<DetachedStationControlSurface />); await act(async () => {});
  expect(screen.getByLabelText("Shared FLEX private IP")).toBeTruthy();
  expect((screen.getByLabelText("Shared radio provider") as HTMLSelectElement).value).toBe("direct_flex_lan");
  expect(screen.getByRole("button", { name: "Apply shared radio selection" })).toBeTruthy();
  expect(screen.queryByLabelText("Shared Agent HTTPS URL")).toBeNull();
  expect(screen.queryByLabelText("Shared Agent token")).toBeNull();
  expect(screen.queryByLabelText("Shared Hamlib connection")).toBeNull();
  expect(screen.queryByRole("button", { name: /Connect saved Agent|Connect saved Hamlib|Disconnect Agent|Disconnect Hamlib|Save Agent|Save Hamlib|Forget saved/ })).toBeNull();
  expect(owner.actions).toHaveLength(0); expect(native.worker).not.toHaveBeenCalled();
});
it("Desk and child share FLEX configuration, then explicitly connect, replace and disconnect through one owner", async () => {
  const owner = sharedAgent(false, false, "direct_flex_lan");
  render(<><section aria-label="Desk FLEX setup"><AgentConnectionSetup radioId="radio1" flex /></section><DetachedStationControlSurface /></>); await act(async () => {});
  const desk = within(screen.getByRole("region", { name: "Desk FLEX setup" }));
  const child = within(screen.getByRole("main", { name: "Detached Station Control" }));
  expect(owner.actions).toHaveLength(0);
  fireEvent.change(desk.getByLabelText("Shared FLEX private IP"), { target: { value: "100.64.0.5" } });
  fireEvent.click(desk.getByRole("button", { name: "Save FLEX configuration" })); await act(async () => {});
  await act(async () => owner.wake());
  expect((child.getByLabelText("Shared FLEX private IP") as HTMLInputElement).value).toBe("100.64.0.5");
  fireEvent.click(child.getByRole("checkbox", { name: "Enable FLEX transmit commands for this connection" }));
  fireEvent.click(child.getByRole("button", { name: "Connect saved FLEX radio" })); await act(async () => {});
  await act(async () => owner.wake());
  fireEvent.click(desk.getByRole("button", { name: "Reconnect saved FLEX radio" })); await act(async () => {});
  await act(async () => owner.wake());
  fireEvent.click(child.getByRole("button", { name: "Disconnect FLEX radio" })); await act(async () => {});
  expect(owner.actions.map(action => [action.action, action.revision])).toEqual([["save_flex", 4], ["connect_flex", 5], ["reconnect_flex", 6], ["disconnect_flex", 7]]);
  expect(owner.actions[1]).toMatchObject({ selection_generation: 8, selection_id: "selected-radio", allow_transmit: false });
  expect(owner.actions[2]).toMatchObject({ selection_generation: 8, selection_id: "selected-radio", allow_transmit: true });
  expect(owner.actions[0]).not.toHaveProperty("allow_transmit");
  expect(native.invoke.mock.calls.every(([command]) => ["monitor_context_snapshot", "station_session_request"].includes(command))).toBe(true);
  expect(native.worker).not.toHaveBeenCalled();
});
it("lost FLEX reconnect acknowledgement survives child remount without replay", async () => {
  const owner = sharedAgent(true, false, "direct_flex_lan"); const view = render(<DetachedStationControlSurface />); await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Reconnect saved FLEX radio" })); await act(async () => {});
  const operation = owner.actions[0].operation_id;
  view.unmount(); render(<DetachedStationControlSurface />); await act(async () => {});
  expect(screen.getByRole("button", { name: "Reconnect saved FLEX radio" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Check connection setup receipt" })); await act(async () => {});
  expect(native.invoke).toHaveBeenLastCalledWith("station_session_request", { params: { action: "receipt", operation_id: operation, radio_id: "radio1" } });
  expect(owner.actions).toHaveLength(1); expect(screen.getByText(/Connection outcome is unknown/)).toBeTruthy();
});
it("independent child explicitly browses radio models and selection edits only the shared setup draft", async () => {
  const owner = sharedAgent(false, false, "hamlib"); render(<DetachedStationControlSurface />); await act(async () => {});
  expect(native.invoke.mock.calls.every(([command, args]) => command === "monitor_context_snapshot" || args?.params.action === "snapshot")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Load radio model catalogue" })); await act(async () => {});
  expect(native.invoke).toHaveBeenLastCalledWith("station_session_request", { params: { action: "hamlib_catalogue", radio_id: "radio1" } });
  fireEvent.change(screen.getByLabelText("Shared Hamlib catalogue model"), { target: { value: "3073" } });
  expect(owner.actions).toHaveLength(0); expect(owner.state().hamlib?.model).toBe(1);
  expect((screen.getByLabelText("Shared Hamlib model ID") as HTMLInputElement).value).toBe("3073");
  fireEvent.click(screen.getByRole("button", { name: "Save Hamlib configuration" })); await act(async () => {});
  expect(owner.actions).toHaveLength(1); expect(owner.actions[0]).toMatchObject({ action: "save_hamlib", configuration: { model: 3073 } });
  expect(native.worker).not.toHaveBeenCalled();
});
function flexReceiveContext(): MonitorContext {
  const context = syntheticMonitorContext(), identity = crypto.randomUUID();
  context.selection = { provider: "direct_flex_lan", generation: 8, selection_id: identity, control_revision: 9 };
  context.radio = { revision: 1, available: true, provider: "direct_flex_lan", selection_id: identity, selection_generation: 8, received_at_ms: Date.now(),
    snapshot: { source: "direct_flex_lan", generation: 13, generated_at: Date.now() / 1000,
      radio: { observed: true, observed_at: Date.now() / 1000, connected: true, transmitting: false, receive_vfo: "A", frequency_hz: 14074000, mode: "USB", vfos: [{ letter: "A", receive: true }] },
      capabilities: { supported_commands: ["set_frequency_a", "set_mode_a"] } } };
  return context;
}
function agentReceiveContext(): MonitorContext {
  const context = flexReceiveContext();
  context.selection!.provider = "direct_agent";
  context.radio.provider = "direct_agent";
  context.radio.snapshot.source = "direct_agent";
  delete context.radio.snapshot.capabilities;
  context.radio.snapshot.station = { radio_known: true, radio_stale: false, supported_commands: ["set_frequency_hz", "set_mode"] };
  return context;
}
function hamlibReceiveContext(): MonitorContext {
  const context = agentReceiveContext();
  context.selection!.provider = "hamlib";
  context.radio.provider = "hamlib";
  context.radio.snapshot = { device: "radio", generation: 13, observed_at_ms: Date.now(),
    field_observed_at_ms: { frequency: Date.now(), mode: Date.now(), vfo: Date.now(), ptt: Date.now() }, tx_enabled: true, errors: {},
    fields: { frequency: { Frequency: "14074000" }, mode: { Mode: "USB" }, vfo: { VFO: "VFOA" }, ptt: { PTT: "0" } } };
  return context;
}
it("child exposes exact Agent receive controls from Agent capabilities and preserves the provider fence", async () => {
  const owner = sharedAgent(), context = agentReceiveContext();
  owner.state().selection.selection_id = context.selection!.selection_id; owner.observe(context);
  render(<DetachedStationControlSurface />); await act(async () => {});
  fireEvent.change(screen.getByLabelText("Child receive frequency MHz"), { target: { value: "14.0762" } });
  fireEvent.click(screen.getByRole("button", { name: "Set receive VFO A frequency" })); await act(async () => {});
  expect(owner.actions[0]).toMatchObject({ action: "receive_frequency", provider: "direct_agent", frequency_hz: 14076200,
    selection_generation: 8, selection_id: context.selection!.selection_id, control_revision: 9, connection_generation: 13 });
  expect(owner.actions[0]).not.toHaveProperty("allow_transmit");
  context.revision++; context.selection!.control_revision = 10; context.radio.received_at_ms++;
  owner.observe(context); await act(async () => { owner.observeWake(); });
  fireEvent.change(screen.getByLabelText("Child receive mode"), { target: { value: "DIGU" } });
  fireEvent.click(screen.getByRole("button", { name: "Set receive VFO A mode" })); await act(async () => {});
  expect(owner.actions[1]).toMatchObject({ action: "receive_mode", provider: "direct_agent", mode: "DIGU", control_revision: 10 });
  expect(native.worker).not.toHaveBeenCalled();
});
it("child disables only the Agent receive control not advertised by the current observation", async () => {
  const owner = sharedAgent(), context = agentReceiveContext();
  owner.state().selection.selection_id = context.selection!.selection_id;
  context.radio.snapshot.station.supported_commands = ["set_frequency_hz"];
  owner.observe(context); render(<DetachedStationControlSurface />); await act(async () => {});
  fireEvent.change(screen.getByLabelText("Child receive frequency MHz"), { target: { value: "14.075" } });
  expect(screen.getByRole("button", { name: "Set receive VFO A frequency" }).hasAttribute("disabled")).toBe(false);
  expect(screen.getByRole("button", { name: "Set receive VFO A mode" }).hasAttribute("disabled")).toBe(true);
});
it("child journals exact Hamlib VFO-A receive controls without exposing general radio authority", async () => {
  const owner = sharedAgent(false, false, "hamlib"), context = hamlibReceiveContext();
  owner.state().selection.selection_id = context.selection!.selection_id; owner.observe(context);
  render(<DetachedStationControlSurface />); await act(async () => {});
  fireEvent.change(screen.getByLabelText("Child receive frequency MHz"), { target: { value: "14.077" } });
  fireEvent.click(screen.getByRole("button", { name: "Set receive VFO A frequency" })); await act(async () => {});
  expect(owner.actions[0]).toMatchObject({ action: "receive_frequency", provider: "hamlib", frequency_hz: 14077000,
    control_revision: 9, connection_generation: 13 });
  context.revision++; context.selection!.control_revision = 10; context.radio.received_at_ms++;
  owner.observe(context); await act(async () => { owner.observeWake(); });
  fireEvent.change(screen.getByLabelText("Child receive mode"), { target: { value: "DIGU" } });
  fireEvent.click(screen.getByRole("button", { name: "Set receive VFO A mode" })); await act(async () => {});
  expect(owner.actions[1]).toMatchObject({ action: "receive_mode", provider: "hamlib", mode: "DIGU", control_revision: 10 });
  expect(screen.queryByRole("button", { name: /PTT|Send CW|Tune carrier/ })).toBeNull();
  expect(native.worker).not.toHaveBeenCalled();
});
it("child sends only explicit exact VFO-A receive controls and waits for a new observation", async () => {
  const owner = sharedAgent(false, false, "direct_flex_lan"), context = flexReceiveContext();
  owner.state().selection.selection_id = context.selection!.selection_id; owner.observe(context);
  render(<DetachedStationControlSurface />); await act(async () => {});
  expect(owner.actions).toHaveLength(0);
  expect(screen.queryByRole("button", { name: /PTT|Send CW|Tune carrier/ })).toBeNull();
  const frequency = screen.getByRole("button", { name: "Set receive VFO A frequency" });
  expect(frequency.hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByLabelText("Child receive frequency MHz"), { target: { value: "14.0751" } });
  fireEvent.click(frequency); fireEvent.click(frequency); await act(async () => {});
  expect(owner.actions).toHaveLength(1); expect(owner.actions[0]).toMatchObject({ action: "receive_frequency", revision: 4, provider: "direct_flex_lan",
    selection_generation: 8, selection_id: context.selection!.selection_id, control_revision: 9, connection_generation: 13, frequency_hz: 14075100 });
  expect(owner.actions[0]).not.toHaveProperty("allow_transmit");
  expect(frequency.hasAttribute("disabled")).toBe(true);
  context.revision++; context.selection!.control_revision = 10; context.radio.received_at_ms++;
  owner.observe(context); await act(async () => { owner.observeWake(); });
  fireEvent.change(screen.getByLabelText("Child receive mode"), { target: { value: "DIGU" } });
  fireEvent.click(screen.getByRole("button", { name: "Set receive VFO A mode" })); await act(async () => {});
  expect(owner.actions).toHaveLength(2); expect(owner.actions[1]).toMatchObject({ action: "receive_mode", revision: 5,
    control_revision: 10, connection_generation: 13, mode: "DIGU" });
  expect(owner.actions[1]).not.toHaveProperty("frequency_hz");
  context.revision++; context.selection!.control_revision = 11; context.radio.received_at_ms++;
  owner.observe(context); await act(async () => { owner.observeWake(); });
  fireEvent.change(screen.getByLabelText("Child receive frequency MHz"), { target: { value: "7.1" } });
  fireEvent.click(frequency); await act(async () => {});
  expect(owner.actions).toHaveLength(3); expect(owner.actions[2]).toMatchObject({ action: "receive_frequency", revision: 6, control_revision: 11, connection_generation: 13, frequency_hz: 7100000 });
  expect(native.worker).not.toHaveBeenCalled();
});
it("unknown receive reply survives child remount and checks the original receipt without replay", async () => {
  const owner = sharedAgent(true, false, "direct_flex_lan"), context = flexReceiveContext();
  owner.state().selection.selection_id = context.selection!.selection_id; owner.observe(context);
  const view = render(<DetachedStationControlSurface />); await act(async () => {});
  fireEvent.change(screen.getByLabelText("Child receive frequency MHz"), { target: { value: "14.075" } });
  fireEvent.click(screen.getByRole("button", { name: "Set receive VFO A frequency" })); await act(async () => {});
  const operation = owner.actions[0].operation_id;
  view.unmount(); render(<DetachedStationControlSurface />); await act(async () => {});
  expect(screen.getByRole("button", { name: "Set receive VFO A frequency" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Check connection setup receipt" })); await act(async () => {});
  expect(native.invoke).toHaveBeenLastCalledWith("station_session_request", { params: { action: "receipt", operation_id: operation, radio_id: "radio1" } });
  expect(owner.actions).toHaveLength(1); expect(screen.getByText(/Receive control outcome is unknown/)).toBeTruthy();
  expect(native.worker).not.toHaveBeenCalled();
});
it.each(["stale", "old radio observation", "transmitting", "unknown PTT", "VFO B", "unsupported", "generation unknown"])("child receive actions fail closed for %s observations", async reason => {
  const owner = sharedAgent(false, false, "direct_flex_lan"), context = flexReceiveContext();
  owner.state().selection.selection_id = context.selection!.selection_id;
  if (reason === "stale") context.radio.received_at_ms -= 6000;
  if (reason === "old radio observation") context.radio.snapshot.radio.observed_at -= 6;
  if (reason === "transmitting") context.radio.snapshot.radio.transmitting = true;
  if (reason === "unknown PTT") context.radio.snapshot.radio.transmitting = null;
  if (reason === "VFO B") context.radio.snapshot.radio.receive_vfo = "B";
  if (reason === "unsupported") context.radio.snapshot.capabilities.supported_commands = [];
  if (reason === "generation unknown") delete context.radio.snapshot.generation;
  owner.observe(context); render(<DetachedStationControlSurface />); await act(async () => {});
  if (reason === "stale") {
    expect(screen.queryByLabelText("Child receive frequency MHz")).toBeNull();
    expect(owner.actions).toHaveLength(0); expect(native.worker).not.toHaveBeenCalled();
    return;
  }
  fireEvent.change(screen.getByLabelText("Child receive frequency MHz"), { target: { value: "14.075" } });
  for (const name of ["Set receive VFO A frequency", "Set receive VFO A mode"]) {
    const button = screen.getByRole("button", { name }); expect(button.hasAttribute("disabled")).toBe(true); fireEvent.click(button);
  }
  expect(owner.actions).toHaveLength(0); expect(native.worker).not.toHaveBeenCalled();
});

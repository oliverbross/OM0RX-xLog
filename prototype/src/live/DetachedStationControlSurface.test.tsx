// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetachedStationControlSurface, StationControlSurface } from "./DetachedStationControlSurface";
import { AgentConnectionSetup } from "./AgentConnectionSetup";
import type { StationSession } from "./stationSession";
import { syntheticMonitorContext } from "./monitorContextFixtures";
import type { MonitorContext } from "./monitorContext";
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
it("mounts and refreshes through retained native context only, without a worker request", async () => {
  const view = render(<StationControlSurface />);
  await act(async () => {});
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("monitor_context_snapshot");
  expect(screen.getByText("Observed live")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Refresh observations" }));
  await act(async () => {});
  expect(native.invoke.mock.calls.every(([command]) => command === "monitor_context_snapshot")).toBe(true);
  expect(native.invoke).toHaveBeenCalledTimes(2); expect(native.worker).not.toHaveBeenCalled();
  view.unmount();
});
it("renders retained station state with refresh and docking but no device controls", () => {
  const view = setup();
  expect(screen.getByRole("main", { name: "Detached Station Control" })).toBeTruthy();
  expect(screen.getByText("14.074000 MHz")).toBeTruthy();
  expect(screen.getByText("Observed live")).toBeTruthy();
  expect(screen.getAllByRole("button")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Refresh observations" }));
  expect(view.refresh).toHaveBeenCalledOnce();
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
  expect(screen.getByText(/Connection setup, radio selection and station actions/)).toBeTruthy();
  expect(screen.getAllByRole("button")).toHaveLength(2);
});
it("labels isolated observations and remains passive even when actions are advertised", () => {
  const value = syntheticMonitorContext(); value.acceptance = { synthetic: true, source: "synthetic_memory", externalOwners: false, readOnly: true };
  setup(value);
  expect(screen.getByText("Synthetic isolated observation · read only")).toBeTruthy();
  expect(screen.getAllByRole("button")).toHaveLength(2);
});
it("docks through the existing native helper and prevents duplicate pending requests", async () => {
  let finish!: () => void;
  native.invoke.mockImplementation(async command => {
    if (command !== "dock_detached_window") throw new Error("Unexpected device request");
    return new Promise<void>(resolve => { finish = resolve; });
  });
  setup();
  const button = screen.getByRole("button", { name: "Dock back" });
  fireEvent.click(button); fireEvent.click(button);
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("dock_detached_window");
  expect(screen.getByRole("button", { name: "Docking…" }).hasAttribute("disabled")).toBe(true);
  await act(async () => finish());
  expect(screen.getByRole("button", { name: "Dock back" }).hasAttribute("disabled")).toBe(false);
  expect(native.worker).not.toHaveBeenCalled();
});
it("keeps dock failures visible across observation refresh and allows retry", async () => {
  native.invoke.mockRejectedValueOnce(new Error("Native docking failed")).mockResolvedValueOnce(undefined);
  const view = setup();
  fireEvent.click(screen.getByRole("button", { name: "Dock back" })); await act(async () => {});
  expect(screen.getByRole("alert").textContent).toContain("Could not dock Station Control");
  fireEvent.click(screen.getByRole("button", { name: "Refresh observations" }));
  act(() => changed(syntheticMonitorContext()));
  expect(view.refresh).toHaveBeenCalledOnce();
  expect(screen.getByRole("alert").textContent).toContain("This window remains open");
  fireEvent.click(screen.getByRole("button", { name: "Dock back" })); await act(async () => {});
  expect(native.invoke).toHaveBeenCalledTimes(2); expect(screen.queryByRole("alert")).toBeNull();
});

function sharedAgent(loseConnect = false, loseSelection = false, provider = "direct_agent") {
  let observation = syntheticMonitorContext();
  let state: StationSession = { generation: "shared-setup", revision: 4, base_url: "https://station.example", last_receipt: null,
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
    const lost = loseConnect && ["connect", "connect_flex", "reconnect_flex", "receive_frequency"].includes(params.action) || loseSelection && params.action === "select";
    state = { ...state, revision: state.revision + 1,
      ...(params.action === "save_hamlib" ? { hamlib: params.configuration } : {}),
      ...(params.action === "save_flex" ? { flex: params.configuration } : {}),
      ...(params.action === "select" ? { selection: { provider: params.provider, generation: state.selection.generation + 1, selection_id: crypto.randomUUID() } } : {}),
      last_receipt: { operation_id: params.operation_id, request: { action: params.action }, status: lost ? "unknown" : ["save_hamlib", "save_flex"].includes(params.action) ? "saved" : "acknowledged" } };
    if (lost) throw new Error("Lost child acknowledgement");
    return structuredClone(state.last_receipt);
  });
  return { actions, wake: () => subscribers.get("xlog:station-session")?.forEach(handler => handler()), state: () => state, observe: (next: MonitorContext) => { observation = next; } };
}
it("independent child mounts passively and sends exact Agent lifecycle actions through the shared owner", async () => {
  const owner = sharedAgent(); render(<DetachedStationControlSurface />); await act(async () => {});
  expect(owner.actions).toHaveLength(0); expect(native.worker).not.toHaveBeenCalled();
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
  expect(native.invoke).toHaveBeenLastCalledWith("station_session_request", { params: { action: "receipt", operation_id: id } });
  expect(owner.actions).toHaveLength(1); expect(screen.getByText(/Connection outcome is unknown/)).toBeTruthy();
  expect(native.worker).not.toHaveBeenCalled();
});
it("Desk and child converge on shared revisions and a matching completed receipt clears local pending state", async () => {
  const owner = sharedAgent();
  render(<><section aria-label="Desk setup"><AgentConnectionSetup connections /></section><DetachedStationControlSurface /></>);
  await act(async () => {});
  const desk = within(screen.getByRole("region", { name: "Desk setup" }));
  const child = within(screen.getByRole("main", { name: "Detached Station Control" }));
  fireEvent.click(desk.getByRole("button", { name: "Connect saved Agent" })); await act(async () => {});
  const receipt = owner.state().last_receipt!;
  // Another webview can retain an operation observed pending before completion.
  sessionStorage.setItem("xlog.station-session.pending", receipt.operation_id);
  await act(async () => owner.wake());
  expect(sessionStorage.getItem("xlog.station-session.pending")).toBeNull();
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
  const owner = sharedAgent(); render(<AgentConnectionSetup providers onlySelection selectionTarget="direct_flex_lan" />); await act(async () => {});
  expect(owner.actions).toHaveLength(0); expect(screen.queryByRole("button", { name: "Connect saved Agent" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Apply shared radio selection" })); await act(async () => {});
  expect(owner.actions).toHaveLength(1); expect(owner.actions[0]).toMatchObject({ action: "select", provider: "direct_flex_lan", selection_generation: 8, selection_id: "selected-radio" });
  expect(screen.getByText(/Radio selection acknowledged/)).toBeTruthy(); expect(native.worker).not.toHaveBeenCalled();
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
  expect(native.invoke).toHaveBeenLastCalledWith("station_session_request", { params: { action: "receipt", operation_id: operation } });
  expect(owner.actions).toHaveLength(1); expect(screen.getByText(/Radio selection outcome is unknown/)).toBeTruthy();
  expect(native.worker).not.toHaveBeenCalled();
});
it("Desk and independent child share Hamlib setup and explicitly connect with the current exact selection", async () => {
  const owner = sharedAgent(false, false, "hamlib");
  render(<><section aria-label="Desk Hamlib setup"><AgentConnectionSetup hamlib /></section><DetachedStationControlSurface /></>); await act(async () => {});
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
  expect(owner.actions[1]).toMatchObject({ selection_generation: 8, selection_id: "selected-radio", allow_transmit: false });
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
  render(<><section aria-label="Desk FLEX setup"><AgentConnectionSetup flex /></section><DetachedStationControlSurface /></>); await act(async () => {});
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
  expect(owner.actions[1]).toMatchObject({ selection_generation: 8, selection_id: "selected-radio", allow_transmit: true });
  expect(owner.actions[2]).toMatchObject({ selection_generation: 8, selection_id: "selected-radio", allow_transmit: false });
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
  expect(native.invoke).toHaveBeenLastCalledWith("station_session_request", { params: { action: "receipt", operation_id: operation } });
  expect(owner.actions).toHaveLength(1); expect(screen.getByText(/Connection outcome is unknown/)).toBeTruthy();
});
it("independent child explicitly browses radio models and selection edits only the shared setup draft", async () => {
  const owner = sharedAgent(false, false, "hamlib"); render(<DetachedStationControlSurface />); await act(async () => {});
  expect(native.invoke.mock.calls.every(([command, args]) => command === "monitor_context_snapshot" || args?.params.action === "snapshot")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Load radio model catalogue" })); await act(async () => {});
  expect(native.invoke).toHaveBeenLastCalledWith("station_session_request", { params: { action: "hamlib_catalogue" } });
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
      capabilities: { supported_commands: ["set_frequency_a", "set_mode"] } } };
  return context;
}
it("child sends only explicit exact receive frequency requests and waits for a new observation", async () => {
  const owner = sharedAgent(false, false, "direct_flex_lan"), context = flexReceiveContext();
  owner.state().selection.selection_id = context.selection!.selection_id; owner.observe(context);
  render(<DetachedStationControlSurface />); await act(async () => {});
  expect(owner.actions).toHaveLength(0);
  expect(screen.queryByRole("button", { name: /PTT|Send CW|Tune carrier|Set receive mode/ })).toBeNull();
  const frequency = screen.getByRole("button", { name: "Set receive VFO A frequency" });
  expect(frequency.hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByLabelText("Child receive frequency MHz"), { target: { value: "14.0751" } });
  fireEvent.click(frequency); fireEvent.click(frequency); await act(async () => {});
  expect(owner.actions).toHaveLength(1); expect(owner.actions[0]).toMatchObject({ action: "receive_frequency", revision: 4, provider: "direct_flex_lan",
    selection_generation: 8, selection_id: context.selection!.selection_id, control_revision: 9, connection_generation: 13, frequency_hz: 14075100 });
  expect(owner.actions[0]).not.toHaveProperty("allow_transmit");
  expect(frequency.hasAttribute("disabled")).toBe(true);
  context.revision++; context.selection!.control_revision = 10; context.radio.received_at_ms++;
  owner.observe(context); fireEvent.click(screen.getByRole("button", { name: "Refresh observations" })); await act(async () => {});
  fireEvent.change(screen.getByLabelText("Child receive frequency MHz"), { target: { value: "7.1" } });
  fireEvent.click(frequency); await act(async () => {});
  expect(owner.actions).toHaveLength(2); expect(owner.actions[1]).toMatchObject({ action: "receive_frequency", revision: 5, control_revision: 10, connection_generation: 13, frequency_hz: 7100000 });
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
  expect(native.invoke).toHaveBeenLastCalledWith("station_session_request", { params: { action: "receipt", operation_id: operation } });
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
  fireEvent.change(screen.getByLabelText("Child receive frequency MHz"), { target: { value: "14.075" } });
  for (const name of ["Set receive VFO A frequency"]) {
    const button = screen.getByRole("button", { name }); expect(button.hasAttribute("disabled")).toBe(true); fireEvent.click(button);
  }
  expect(owner.actions).toHaveLength(0); expect(native.worker).not.toHaveBeenCalled();
});

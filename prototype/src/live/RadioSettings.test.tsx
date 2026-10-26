// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import RadioSettings from "./RadioSettings";
import { RadioOperatingSelector } from "./RadioOperatingSelector";
import type { RadioID, StationSession } from "./stationSession";

const native = vi.hoisted(() => ({ invoke: vi.fn(), changed: [] as (() => void)[], events: [] as string[] }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (event, changed) => { native.events.push(event); native.changed.push(changed); return vi.fn(); }) }));
let states: Record<RadioID, StationSession>;
let unknown: string | null;
const snapshot = (id: RadioID): StationSession => ({ radio_id: id, active_radio: "radio1", tx_owner: null, generation: `${id}-setup`, revision: 0, base_url: "", last_receipt: null,
  selection: { provider: "direct_agent", generation: 0, selection_id: `${id}-selection` } });
const form = () => within(screen.getByRole("tabpanel", { name: /^Radio [12]/ }));
const change = (label: string, value: string) => fireEvent.change(form().getByLabelText(label), { target: { value } });
const flush = async () => { await act(async () => {}); };
const actions = () => native.invoke.mock.calls.map(([, { params }]) => params).filter(p => !["snapshot", "serial_ports", "hamlib_catalogue"].includes(p.action));
beforeEach(() => {
  sessionStorage.clear(); native.invoke.mockReset(); native.changed = []; native.events = []; unknown = null;
  states = { radio1: snapshot("radio1"), radio2: snapshot("radio2") };
  vi.spyOn(window, "confirm").mockReturnValue(true);
  native.invoke.mockImplementation(async (_command, { params: p }) => {
    const state = states[p.radio_id as RadioID];
    if (p.action === "snapshot") return structuredClone(state);
    if (p.action === "hamlib_catalogue") return { models: [{ id: 3073, manufacturer: "Icom", model: "IC-7300", maturity: "Stable" }, { id: 2045, manufacturer: "Elecraft", model: "KX3", maturity: "Stable" }] };
    if (p.action === "serial_ports") return { ports: [{ path: "/dev/cu.usbserial-A", label: "USB CAT" }] };
    if (p.action === "set_active_radio") { for (const state of Object.values(states)) state.active_radio = p.radio_id; return { active_radio: p.radio_id }; }
    if (p.action === "receipt") return state.last_receipt;
    const status = unknown === p.action ? "unknown" : p.action.startsWith("save") ? "saved" : "acknowledged";
    state.last_receipt = { operation_id: p.operation_id, status, request: { action: p.action } };
    state.revision++;
    if (status === "unknown") return structuredClone(state.last_receipt);
    if (p.profile) state.profile = p.profile;
    if (p.action === "save_flex") state.flex = p.configuration;
    if (p.action === "save_tci") state.tci = { ...p.configuration, endpoint: new URL(p.configuration.endpoint).href };
    if (p.action === "save_hamlib") state.hamlib = p.configuration;
    if (p.action === "save") state.base_url = p.base_url;
    if (p.action === "select") state.selection = { provider: p.provider, generation: state.selection.generation + 1, selection_id: `${p.radio_id}-${p.provider}` };
    if (p.action.startsWith("disconnect")) { state.radio = undefined; state.tx_owner = null; }
    if (p.action.startsWith("connect")) state.radio = { provider: state.selection.provider!, selection_id: state.selection.selection_id!, selection_generation: state.selection.generation,
      snapshot: { radio: { connected: true, observed: true, transmitting: false, frequency_hz: 14025000, mode: "CW" }, station: { radio_stale: false } } };
    return structuredClone(state.last_receipt);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("loads catalogue/ports automatically; model, interface and tab changes are independent drafts", async () => {
  render(<RadioSettings />); await flush();
  change("Manufacturer", "FlexRadio"); change("Radio 1 model", "-107"); change("Radio address", "192.168.1.50"); change("Radio nickname", "Home Flex");
  fireEvent.click(screen.getByRole("tab", { name: /^Radio 2/ }));
  change("Manufacturer", "Expert Electronics"); change("Radio 2 model", "-200"); change("TCI host", "192.168.1.60");
  expect(form().queryByLabelText("Serial port")).toBeNull(); expect(form().queryByLabelText("Station token")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: /^Radio 1/ }));
  expect((form().getByLabelText("Radio address") as HTMLInputElement).value).toBe("192.168.1.50");
  expect((form().getByLabelText("Radio nickname") as HTMLInputElement).value).toBe("Home Flex");
  expect(actions()).toEqual([]); expect(states.radio1.active_radio).toBe("radio1");
  expect(screen.queryByRole("button", { name: "Apply shared radio selection" })).toBeNull();
});

it("Save & Connect coordinates exact-slot save, handover and receive-only connect for both radios", async () => {
  render(<RadioSettings />); await flush();
  change("Manufacturer", "FlexRadio"); change("Radio 1 model", "-107"); change("Radio address", "192.168.1.50");
  fireEvent.click(form().getByRole("button", { name: "Save & Connect" })); await flush();
  expect(actions().map(p => p.action)).toEqual(["save_flex", "select", "connect_flex"]);
  expect(actions().every(p => p.radio_id === "radio1")).toBe(true);
  expect(actions().at(-1).allow_transmit).toBe(false);
  fireEvent.click(screen.getByRole("tab", { name: /^Radio 2/ }));
  change("Manufacturer", "Expert Electronics"); change("Radio 2 model", "-200"); change("TCI host", "192.168.1.60"); change("TCI port", "50002");
  fireEvent.click(form().getByRole("button", { name: "Save & Connect" })); await flush();
  expect(actions().slice(3).map(p => p.action)).toEqual(["save_tci", "select", "connect_tci"]);
  expect(actions().slice(3).every(p => p.radio_id === "radio2")).toBe(true);
  expect(actions().at(-1)).not.toHaveProperty("allow_transmit");
  expect(states.radio1.radio?.snapshot.radio.connected).toBe(true); expect(states.radio2.radio?.snapshot.radio.connected).toBe(true);
  expect(states.radio1.active_radio).toBe("radio1");
});

it("updates delayed native connection observations without focus, lifecycle writes or losing typed text", async () => {
  render(<RadioSettings />); await flush();
  change("Radio nickname", "Still typing");
  states.radio1.radio = { provider: "direct_agent", selection_id: states.radio1.selection.selection_id!, selection_generation: 0,
    snapshot: { radio: { connected: true, observed: true, frequency_hz: 14025000 }, station: { radio_stale: false } } };
  expect(native.events).toContain("xlog:station-telemetry");
  await act(async () => { native.events.forEach((name, index) => { if (name === "xlog:station-telemetry") native.changed[index](); }); });
  expect(form().getByText("Connected", { selector: "span" })).toBeTruthy();
  expect((form().getByLabelText("Radio nickname") as HTMLInputElement).value).toBe("Still typing");
  states.radio1.radio.snapshot.station.radio_stale = true;
  await act(async () => { native.events.forEach((name, index) => { if (name === "xlog:station-telemetry") native.changed[index](); }); });
  expect(form().getByText("Connection needs attention")).toBeTruthy(); expect(actions()).toEqual([]);
});

it("Save stores the desired profile without selecting or disconnecting the live radio", async () => {
  states.radio1.flex = { host: "192.168.1.50", port: 4992, station_name: "xLog" };
  states.radio1.selection.provider = "direct_flex_lan";
  render(<RadioSettings />); await flush();
  change("Manufacturer", "Expert Electronics"); change("Radio 1 model", "-200"); change("TCI host", "wss://example.test:50002/tci");
  fireEvent.click(form().getByRole("button", { name: "Save" })); await flush();
  expect(actions().map(p => p.action)).toEqual(["save_tci"]);
  expect(states.radio1.selection.provider).toBe("direct_flex_lan"); expect(states.radio1.tci?.endpoint).toBe("wss://example.test:50002/tci");
  expect(states.radio1.flex?.host).toBe("192.168.1.50");
});

it("stops a coordinated connection on uncertainty and retains its operation across remount", async () => {
  unknown = "select";
  let view = render(<RadioSettings />); await flush();
  change("Manufacturer", "FlexRadio"); change("Radio 1 model", "-107"); change("Radio address", "192.168.1.50");
  fireEvent.click(form().getByRole("button", { name: "Save & Connect" })); await flush();
  expect(actions().map(p => p.action)).toEqual(["save_flex", "select"]);
  const pending = sessionStorage.getItem("xlog.station-session.radio1.pending"); expect(pending).toBeTruthy();
  view.unmount(); view = render(<RadioSettings />); await flush();
  expect(sessionStorage.getItem("xlog.station-session.radio1.pending")).toBe(pending);
  expect(form().getByRole("button", { name: "Check operation" })).toBeTruthy();
  expect(actions()).toHaveLength(2);
});

it("releases the live provider before replacing it and cancellation leaves everything unchanged", async () => {
  states.radio1.profile = { manufacturer: "FlexRadio", model: "FLEX-8400", nickname: "Home", provider: "direct_flex_lan", enabled: true };
  states.radio1.flex = { host: "192.168.1.50", port: 4992, station_name: "xLog" };
  states.radio1.selection.provider = "direct_flex_lan";
  states.radio1.radio = { provider: "direct_flex_lan", selection_id: states.radio1.selection.selection_id!, selection_generation: 0,
    snapshot: { radio: { connected: true, observed: true }, station: { radio_stale: false } } };
  render(<RadioSettings />); await flush();
  change("Manufacturer", "Expert Electronics"); change("Radio 1 model", "-200"); change("TCI host", "localhost");
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  fireEvent.click(form().getByRole("button", { name: "Save & Connect" })); await flush(); expect(actions()).toEqual([]);
  fireEvent.click(form().getByRole("button", { name: "Save & Connect" })); await flush();
  expect(actions().map(p => p.action)).toEqual(["save_tci", "disconnect_flex", "select", "connect_tci"]);
  expect(states.radio2.revision).toBe(0);
});

it("requires a fresh review when another writer changes setup between save and connect", async () => {
  const original = native.invoke.getMockImplementation()!;
  native.invoke.mockImplementation(async (command, args) => {
    const result = await original(command, args);
    if (args.params.action === "save_flex") states.radio1.flex!.host = "192.168.1.99";
    return result;
  });
  render(<RadioSettings />); await flush();
  change("Manufacturer", "FlexRadio"); change("Radio 1 model", "-107"); change("Radio address", "192.168.1.50");
  fireEvent.click(form().getByRole("button", { name: "Save & Connect" })); await flush();
  expect(actions().map(p => p.action)).toEqual(["save_flex"]);
  expect(form().getByRole("alert").textContent).toMatch(/saved setup changed/);
});

it("retains missing serial ports, exact legacy IDs and edited text on external invalidation", async () => {
  states.radio1.selection.provider = "hamlib"; states.radio1.hamlib = { mode: "managed", model: 3073, path: "/dev/cu.missing", baud: 19200, serial: { stop_bits: 2 } };
  render(<RadioSettings />); await flush();
  expect((form().getByLabelText("Radio 1 model") as HTMLSelectElement).value).toBe("3073");
  expect((form().getByLabelText("Serial port") as HTMLSelectElement).value).toBe("/dev/cu.missing");
  change("Radio nickname", "Typed name"); states.radio1.revision++;
  await act(async () => { native.changed.forEach(changed => changed()); });
  expect((form().getByLabelText("Radio nickname") as HTMLInputElement).value).toBe("Typed name");
  expect(form().getByText(/saved setup changed in another window/)).toBeTruthy(); expect(actions()).toEqual([]);
});

it("routes operating selection explicitly and refuses switching while another radio holds TX control", async () => {
  states.radio1.tx_owner = "radio1"; states.radio2.tx_owner = "radio1";
  render(<RadioOperatingSelector />); await flush();
  fireEvent.click(screen.getByRole("button", { name: /^R2/ })); await flush();
  expect(screen.getByRole("alert").textContent).toMatch(/Radio 1 currently has transmit control/); expect(actions()).toEqual([]);
  states.radio1.tx_owner = states.radio2.tx_owner = null;
  fireEvent.click(screen.getByRole("button", { name: /^R2/ })); await flush();
  expect(actions()).toEqual([{ action: "set_active_radio", radio_id: "radio2" }]);
  expect(screen.getByRole("button", { name: /^R2/ }).getAttribute("aria-pressed")).toBe("true");
});

it("follows a requested settings slot passively and exposes local refresh under diagnostics", async () => {
  const refresh = vi.fn(async () => "Local state refreshed.");
  const view = render(<RadioSettings requestedRadioId="radio2" requestedRadioRevision={1} onRefreshLocalState={refresh} />); await flush();
  expect(screen.getByRole("tab", { name: /^Radio 2/ }).getAttribute("aria-selected")).toBe("true");
  view.rerender(<RadioSettings requestedRadioId="radio1" requestedRadioRevision={2} onRefreshLocalState={refresh} />);
  expect(screen.getByRole("tab", { name: /^Radio 1/ }).getAttribute("aria-selected")).toBe("true");
  fireEvent.click(screen.getByText("Local app diagnostics")); fireEvent.click(screen.getByRole("button", { name: "Refresh local radio state" })); await flush();
  expect(refresh).toHaveBeenCalledOnce(); expect(actions()).toEqual([]);
});

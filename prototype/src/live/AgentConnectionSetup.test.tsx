// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentConnectionSetup } from "./AgentConnectionSetup";
import type { StationSession } from "./stationSession";
const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), changed: undefined as undefined | (() => void) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
const initial = () => ({ generation: "setup-generation", revision: 4, base_url: "https://station.example", last_receipt: null,
  selection: { provider: "direct_agent", generation: 7, selection_id: "radio-selection" } });
let state: StationSession;
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); state = initial();
  native.listen.mockImplementation(async (_name, changed) => { native.changed = changed; return vi.fn(); });
  native.invoke.mockImplementation(async (_command, { params }) => {
    if (params.action === "snapshot") return structuredClone(state);
    if (params.action === "hamlib_catalogue") return { models: [
      { id: 1, manufacturer: "Hamlib", model: "Dummy", maturity: "Stable" },
      { id: 3073, manufacturer: "Icom", model: "IC-7300", maturity: "Stable" },
      { id: 2045, manufacturer: "Elecraft", model: "KX3", maturity: "Stable" },
    ] };
    if (params.action === "save") { state = { ...state, revision: 5, base_url: params.base_url }; return { operation_id: params.operation_id, status: "saved", request: { action: "save" } }; }
    if (params.action === "save_hamlib") { state = { ...state, revision: state.revision + 1, hamlib: params.configuration }; return { operation_id: params.operation_id, status: "saved", request: { action: "save_hamlib" } }; }
    if (params.action === "save_flex") { state = { ...state, revision: state.revision + 1, flex: params.configuration }; return { operation_id: params.operation_id, status: "saved", request: { action: "save_flex" } }; }
    if (params.action === "save_tci") { state = { ...state, revision: state.revision + 1, tci: params.configuration }; return { operation_id: params.operation_id, status: "saved", request: { action: "save_tci" } }; }
    return { operation_id: params.operation_id, status: "acknowledged", request: { action: params.action } };
  });
});
afterEach(cleanup);
it("TCI follows shared selection, saves passively and connects only explicitly without control authority", async () => {
  state = { ...state, tci: { endpoint: "ws://127.0.0.1:50001", trx: 0, channel: 0 }, selection: { provider: "direct_tci", generation: 12, selection_id: "tci-selection" } };
  render(<AgentConnectionSetup connections providers followSelection />); await act(async () => {});
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("station_session_request", { params: { action: "snapshot" } });
  expect(screen.queryByRole("checkbox")).toBeNull(); expect(screen.queryByLabelText("Shared Agent token")).toBeNull();
  expect(screen.queryByRole("button", { name: /Reconnect|receive|PTT|CW|Tune|Operate|Standby/i })).toBeNull();
  fireEvent.change(screen.getByLabelText("Shared TCI endpoint"), { target: { value: " wss://radio.example/tci " } });
  fireEvent.change(screen.getByLabelText("Shared TCI TRX"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Shared TCI channel"), { target: { value: "15" } });
  expect(screen.getByRole("button", { name: "Connect saved TCI radio" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save TCI configuration" })); await act(async () => {});
  expect(native.invoke.mock.calls[1]).toEqual(["station_session_request", { params: { action: "save_tci", operation_id: expect.any(String), generation: "setup-generation", revision: 4, configuration: { endpoint: "wss://radio.example/tci", trx: 2, channel: 15 } } }]);
  expect(screen.getByText("TCI configuration saved. No connection was started.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Connect saved TCI radio" })); await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Disconnect TCI radio" })); await act(async () => {});
  const lifecycle = native.invoke.mock.calls.filter(([, { params }]) => ["connect_tci", "disconnect_tci"].includes(params.action));
  expect(lifecycle.map(([, { params }]) => params)).toEqual(["connect_tci", "disconnect_tci"].map(action => ({ action, operation_id: expect.any(String), generation: "setup-generation", revision: 5, selection_generation: 12, selection_id: "tci-selection" })));
  expect(native.invoke.mock.calls.every(([, { params }]) => ["snapshot", "save_tci", "connect_tci", "disconnect_tci"].includes(params.action))).toBe(true);
});
it.each(["https://radio.example", "ws://radio.example:0", "ws://user:secret@radio.example", "wss://radio.example/?token=secret", "ws://radio.example/#secret", "ws://radio.example/" + "é".repeat(500)])("TCI refuses credential-bearing or unsupported endpoint %s", async endpoint => {
  state = { ...state, selection: { provider: "direct_tci", generation: 12, selection_id: "tci-selection" } };
  render(<AgentConnectionSetup followSelection />); await act(async () => {});
  fireEvent.change(screen.getByLabelText("Shared TCI endpoint"), { target: { value: endpoint } });
  const save = screen.getByRole("button", { name: "Save TCI configuration" });
  expect(save.hasAttribute("disabled")).toBe(true); fireEvent.click(save);
  expect(native.invoke.mock.calls).toHaveLength(1);
});
it.each(["-1", "16", "1.5", ""])("TCI refuses invalid receiver index %s", async index => {
  state = { ...state, tci: { endpoint: "ws://127.0.0.1:50001", trx: 0, channel: 0 }, selection: { provider: "direct_tci", generation: 12, selection_id: "tci-selection" } };
  render(<AgentConnectionSetup followSelection />); await act(async () => {});
  fireEvent.change(screen.getByLabelText("Shared TCI channel"), { target: { value: index } });
  expect(screen.getByRole("button", { name: "Save TCI configuration" }).hasAttribute("disabled")).toBe(true);
  expect(native.invoke.mock.calls).toHaveLength(1);
});
async function mount(connections = false) { const view = render(<AgentConnectionSetup connections={connections} />); await act(async () => {}); return view; }
it("child setup mounts passively, saves with native revision and exposes no device authority", async () => {
  await mount();
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("station_session_request", { params: { action: "snapshot" } });
  expect(screen.queryByRole("button", { name: "Connect saved Agent" })).toBeNull();
  expect(screen.queryByLabelText("Shared Agent token")).toBeNull();
  fireEvent.change(screen.getByLabelText("Shared Agent HTTPS URL"), { target: { value: "https://other.example" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Agent endpoint" })); await act(async () => {});
  expect(native.invoke.mock.calls[1]).toEqual(["station_session_request", { params: expect.objectContaining({ action: "save", generation: "setup-generation", revision: 4, base_url: "https://other.example", operation_id: expect.any(String) }) }]);
  expect(screen.getByText("Agent endpoint saved. No connection was started.")).toBeTruthy();
  expect(native.invoke.mock.calls.every(([, { params }]) => ["snapshot", "save"].includes(params.action))).toBe(true);
});
it("retains dirty edits across another window's save and requires adopting the new revision", async () => {
  await mount(); fireEvent.change(screen.getByLabelText("Shared Agent HTTPS URL"), { target: { value: "https://unsaved.example" } });
  state = { ...state, revision: 5, base_url: "https://remote-change.example" };
  await act(async () => native.changed?.());
  expect((screen.getByLabelText("Shared Agent HTTPS URL") as HTMLInputElement).value).toBe("https://unsaved.example");
  expect(screen.getByRole("button", { name: "Save Agent endpoint" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Reload saved endpoint" })); await act(async () => {});
  expect((screen.getByLabelText("Shared Agent HTTPS URL") as HTMLInputElement).value).toBe("https://remote-change.example");
});
it("Desk connection pins saved configuration and selection while keeping tokens out of storage", async () => {
  await mount(true);
  fireEvent.change(screen.getByLabelText("Shared Agent token"), { target: { value: "private-token" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect saved Agent" })); await act(async () => {});
  expect(native.invoke.mock.calls[1][1].params).toMatchObject({ action: "connect", revision: 4, selection_generation: 7, selection_id: "radio-selection", token: "private-token", allow_transmit: true });
  expect(JSON.stringify(sessionStorage)).not.toContain("private-token");
  expect((screen.getByLabelText("Shared Agent token") as HTMLInputElement).value).toBe("");
  expect(screen.getByText(/Connection request acknowledged/)).toBeTruthy();
});
it("Agent controls default enabled after connection and remount, with an explicit receive-only opt-out", async () => {
  const view = await mount(true);
  const permission = () => screen.getByRole("checkbox", { name: "Allow CAT transmit controls for this connection" }) as HTMLInputElement;
  expect(permission().checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Connect saved Agent" })); await act(async () => {});
  expect(permission().checked).toBe(true);
  fireEvent.click(permission());
  fireEvent.click(screen.getByRole("button", { name: "Connect saved Agent" })); await act(async () => {});
  expect(native.invoke.mock.calls.filter(([, { params }]) => params.action === "connect").map(([, { params }]) => params.allow_transmit)).toEqual([true, false]);
  expect(permission().checked).toBe(false);
  view.unmount(); await mount(true);
  expect(permission().checked).toBe(true);
  expect(native.invoke.mock.calls.every(([, { params }]) => ["snapshot", "connect"].includes(params.action))).toBe(true);
});
it("lost acknowledgement survives remount and checks the same receipt without resending", async () => {
  const view = await mount(true);
  native.invoke.mockRejectedValueOnce(new Error("lost ack"));
  fireEvent.click(screen.getByRole("button", { name: "Connect saved Agent" })); await act(async () => {});
  const id = native.invoke.mock.calls[1][1].params.operation_id;
  view.unmount(); await mount(true);
  expect(screen.getByRole("button", { name: "Connect saved Agent" }).hasAttribute("disabled")).toBe(true);
  native.invoke.mockImplementationOnce(async (_command, { params }) => ({ operation_id: params.operation_id, status: "unknown", request: { action: "connect" } }));
  fireEvent.click(screen.getByRole("button", { name: "Check connection setup receipt" })); await act(async () => {});
  expect(native.invoke).toHaveBeenLastCalledWith("station_session_request", { params: { action: "receipt", operation_id: id } });
  expect(screen.getByText(/Connection outcome is unknown/)).toBeTruthy();
  expect(native.invoke.mock.calls.filter(([, { params }]) => params.action === "connect")).toHaveLength(1);
});
it("recovers a durable unknown operation when browser journal state was lost at restart", async () => {
  state.last_receipt = { operation_id: "persisted-operation", status: "unknown", request: { action: "connect" } };
  await mount(true);
  expect(screen.getByRole("button", { name: "Connect saved Agent" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "Check connection setup receipt" })).toBeTruthy();
  expect(sessionStorage.getItem("xlog.station-session.pending")).toBe("persisted-operation");
  fireEvent.click(screen.getByRole("button", { name: "I have reviewed observed state" })); await act(async () => {});
  expect(screen.getByRole("button", { name: "Connect saved Agent" }).hasAttribute("disabled")).toBe(false);
  expect(native.invoke.mock.calls.every(([, { params }]) => params.action === "snapshot")).toBe(true);
});
it("imports the previous Desk endpoint once with native revision fencing and no connection on mount", async () => {
  state = { ...state, revision: 0, base_url: "" };
  const view = render(<AgentConnectionSetup connections legacyEndpoint="https://previous.example" />); await act(async () => {});
  expect((screen.getByLabelText("Shared Agent HTTPS URL") as HTMLInputElement).value).toBe("https://previous.example");
  expect(native.invoke.mock.calls.every(([, { params }]) => params.action === "snapshot")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Import previous Agent endpoint" })); await act(async () => {});
  expect(native.invoke.mock.calls[1][1].params).toMatchObject({ action: "save", revision: 0, base_url: "https://previous.example" });
  view.unmount();
  // An intentionally cleared native endpoint must not revive browser-local setup.
  state = { ...state, revision: 6, base_url: "" };
  render(<AgentConnectionSetup connections legacyEndpoint="https://previous.example" />); await act(async () => {});
  expect((screen.getByLabelText("Shared Agent HTTPS URL") as HTMLInputElement).value).toBe("");
  expect(screen.queryByRole("button", { name: "Import previous Agent endpoint" })).toBeNull();
});
it("receipt recovery does not overwrite edits made after a lost save acknowledgement", async () => {
  await mount();
  fireEvent.change(screen.getByLabelText("Shared Agent HTTPS URL"), { target: { value: "https://submitted.example" } });
  native.invoke.mockRejectedValueOnce(new Error("lost save acknowledgement"));
  fireEvent.click(screen.getByRole("button", { name: "Save Agent endpoint" })); await act(async () => {});
  fireEvent.change(screen.getByLabelText("Shared Agent HTTPS URL"), { target: { value: "https://new-edit.example" } });
  state = { ...state, revision: 5, base_url: "https://submitted.example" };
  native.invoke.mockResolvedValueOnce({ operation_id: sessionStorage.getItem("xlog.station-session.pending"), status: "saved", request: { action: "save" } });
  fireEvent.click(screen.getByRole("button", { name: "Check connection setup receipt" })); await act(async () => {});
  expect((screen.getByLabelText("Shared Agent HTTPS URL") as HTMLInputElement).value).toBe("https://new-edit.example");
  expect(screen.getByText(/Agent setup changed in another window/)).toBeTruthy();
});
it("shared Hamlib mount is passive and pins saved configuration and exact selection for explicit connection", async () => {
  state = { ...state, hamlib: { mode: "managed", model: 1, path: "", baud: 9600 }, selection: { provider: "hamlib", generation: 12, selection_id: "hamlib-selection" } };
  render(<AgentConnectionSetup hamlib />); await act(async () => {});
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("station_session_request", { params: { action: "snapshot" } });
  expect(screen.queryByLabelText("Shared Agent token")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Connect saved Hamlib radio" })); await act(async () => {});
  expect(native.invoke.mock.calls[1][1].params).toMatchObject({ action: "connect_hamlib", revision: 4, selection_generation: 12, selection_id: "hamlib-selection", allow_transmit: true });
  expect(native.invoke.mock.calls[1][1].params).not.toHaveProperty("configuration");
  expect(native.invoke.mock.calls.every(([command]) => command === "station_session_request")).toBe(true);
});
it("Hamlib drafts survive another window's revision and saved framing is shared without transmit permission", async () => {
  state = { ...state, hamlib: { mode: "managed", model: 1, path: "", baud: 9600 }, selection: { provider: "hamlib", generation: 12, selection_id: "hamlib-selection" } };
  render(<AgentConnectionSetup hamlib />); await act(async () => {});
  fireEvent.change(screen.getByLabelText("Shared Hamlib model ID"), { target: { value: "3073" } });
  fireEvent.change(screen.getByLabelText("Shared Hamlib Parity"), { target: { value: "Even" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Enable Hamlib transmit commands for this connection" }));
  expect(screen.getByRole("button", { name: "Connect saved Hamlib radio" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Save Hamlib configuration" })); await act(async () => {});
  const request = native.invoke.mock.calls[1][1].params;
  expect(request).toMatchObject({ action: "save_hamlib", configuration: { mode: "managed", model: 3073, serial: { parity: "Even" } } });
  expect(request).not.toHaveProperty("allow_transmit"); expect(request.configuration).not.toHaveProperty("tx_enabled");
  fireEvent.change(screen.getByLabelText("Shared Hamlib model ID"), { target: { value: "123" } });
  state = { ...state, revision: 6, hamlib: { mode: "external", host: "127.0.0.1", port: 4534 } };
  await act(async () => native.changed?.());
  expect((screen.getByLabelText("Shared Hamlib model ID") as HTMLInputElement).value).toBe("123");
  expect(screen.getByRole("button", { name: "Save Hamlib configuration" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Reload saved Hamlib configuration" })); await act(async () => {});
  expect((screen.getByLabelText("Shared Hamlib port") as HTMLInputElement).value).toBe("4534");
});
it("unknown Hamlib reconnect survives remount and checks its original receipt without replay", async () => {
  state = { ...state, hamlib: { mode: "external", host: "127.0.0.1", port: 4532 }, selection: { provider: "hamlib", generation: 12, selection_id: "hamlib-selection" } };
  const view = render(<AgentConnectionSetup hamlib />); await act(async () => {});
  native.invoke.mockRejectedValueOnce(new Error("lost reply"));
  fireEvent.click(screen.getByRole("button", { name: "Reconnect saved Hamlib radio" })); await act(async () => {});
  const id = native.invoke.mock.calls[1][1].params.operation_id; view.unmount();
  render(<AgentConnectionSetup hamlib />); await act(async () => {});
  expect(screen.getByRole("button", { name: "Reconnect saved Hamlib radio" }).hasAttribute("disabled")).toBe(true);
  native.invoke.mockResolvedValueOnce({ operation_id: id, status: "unknown", request: { action: "reconnect_hamlib" } });
  fireEvent.click(screen.getByRole("button", { name: "Check connection setup receipt" })); await act(async () => {});
  expect(native.invoke).toHaveBeenLastCalledWith("station_session_request", { params: { action: "receipt", operation_id: id } });
  expect(native.invoke.mock.calls.filter(([, { params }]) => params.action === "reconnect_hamlib")).toHaveLength(1);
});
it("another window's selection change restores the full-control default for a new Hamlib connection", async () => {
  state = { ...state, hamlib: { mode: "external", host: "127.0.0.1", port: 4532 }, selection: { provider: "hamlib", generation: 12, selection_id: "first-selection" } };
  render(<AgentConnectionSetup hamlib />); await act(async () => {});
  const permission = screen.getByRole("checkbox", { name: "Enable Hamlib transmit commands for this connection" }) as HTMLInputElement;
  expect(permission.checked).toBe(true); fireEvent.click(permission); expect(permission.checked).toBe(false);
  state = { ...state, revision: 5, selection: { provider: "hamlib", generation: 14, selection_id: "new-selection" } };
  await act(async () => native.changed?.()); expect(permission.checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Connect saved Hamlib radio" })); await act(async () => {});
  expect(native.invoke.mock.calls.at(-2)?.[1].params).toMatchObject({ action: "connect_hamlib", revision: 5, selection_generation: 14, selection_id: "new-selection", allow_transmit: true });
});
it("FLEX retains dirty setup, restores full controls at a new revision and never stores permission in configuration", async () => {
  state = { ...state, flex: { host: "192.168.1.50", port: 4992, station_name: "xLog" }, selection: { provider: "direct_flex_lan", generation: 12, selection_id: "flex-selection" } };
  render(<AgentConnectionSetup flex />); await act(async () => {});
  fireEvent.change(screen.getByLabelText("Shared FLEX private IP"), { target: { value: "10.0.0.2" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Enable FLEX transmit commands for this connection" }));
  expect(screen.getByRole("button", { name: "Connect saved FLEX radio" }).hasAttribute("disabled")).toBe(true);
  state = { ...state, revision: 5, flex: { host: "100.64.0.3", port: 4993, station_name: "other-window" } };
  await act(async () => native.changed?.());
  expect((screen.getByLabelText("Shared FLEX private IP") as HTMLInputElement).value).toBe("10.0.0.2");
  expect(screen.getByRole("button", { name: "Save FLEX configuration" }).hasAttribute("disabled")).toBe(true);
  expect((screen.getByRole("checkbox", { name: "Enable FLEX transmit commands for this connection" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Reload saved FLEX configuration" })); await act(async () => {});
  expect((screen.getByLabelText("Shared FLEX private IP") as HTMLInputElement).value).toBe("100.64.0.3");
  fireEvent.change(screen.getByLabelText("Shared FLEX station name"), { target: { value: " edited-name " } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Enable FLEX transmit commands for this connection" }));
  fireEvent.click(screen.getByRole("button", { name: "Save FLEX configuration" })); await act(async () => {});
  const request = native.invoke.mock.calls.find(([, { params }]) => params.action === "save_flex")![1].params;
  expect(request).toMatchObject({ revision: 5, configuration: { host: "100.64.0.3", port: 4993, station_name: "edited-name" } });
  expect(request).not.toHaveProperty("allow_transmit"); expect(request.configuration).not.toHaveProperty("allow_transmit");
  expect((screen.getByRole("checkbox", { name: "Enable FLEX transmit commands for this connection" }) as HTMLInputElement).checked).toBe(true);
  expect(native.invoke.mock.calls.every(([command]) => command === "station_session_request")).toBe(true);
});
it("Hamlib catalogue loads only on request, filters without selection changes and chooses a draft without saving or connecting", async () => {
  state = { ...state, hamlib: { mode: "managed", model: 2045, path: "/dev/test", baud: 9600 }, selection: { provider: "hamlib", generation: 12, selection_id: "hamlib-selection" } };
  render(<AgentConnectionSetup hamlib />); await act(async () => {});
  expect(native.invoke.mock.calls.map(([, { params }]) => params.action)).toEqual(["snapshot"]);
  expect(screen.queryByLabelText("Shared Hamlib catalogue model")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Load radio model catalogue" })); await act(async () => {});
  expect(native.invoke).toHaveBeenLastCalledWith("station_session_request", { params: { action: "hamlib_catalogue" } });
  fireEvent.change(screen.getByLabelText("Shared Hamlib catalogue manufacturer"), { target: { value: "icom" } });
  expect((screen.getByLabelText("Shared Hamlib catalogue model") as HTMLSelectElement).value).toBe("2045");
  expect(screen.getByRole("option", { name: /Elecraft KX3.*selected; outside filter/ })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Shared Hamlib catalogue search"), { target: { value: "7300" } });
  fireEvent.change(screen.getByLabelText("Shared Hamlib catalogue model"), { target: { value: "3073" } });
  expect((screen.getByLabelText("Shared Hamlib model ID") as HTMLInputElement).value).toBe("3073");
  expect(screen.getByRole("button", { name: "Connect saved Hamlib radio" }).hasAttribute("disabled")).toBe(true);
  expect(native.invoke.mock.calls.map(([, { params }]) => params.action)).toEqual(["snapshot", "hamlib_catalogue"]);
  expect(state.hamlib?.model).toBe(2045);
});
it("unavailable model catalogue hides selection controls and offers an honest manual fallback and explicit retry", async () => {
  state = { ...state, selection: { provider: "hamlib", generation: 12, selection_id: "hamlib-selection" } };
  render(<AgentConnectionSetup hamlib />); await act(async () => {});
  native.invoke.mockRejectedValueOnce(new Error("helper unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Load radio model catalogue" })); await act(async () => {});
  expect(screen.queryByLabelText("Shared Hamlib catalogue model")).toBeNull();
  expect(screen.getByText(/manual entry does not verify backend support/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Shared Hamlib model ID"), { target: { value: "2045" } });
  expect(native.invoke.mock.calls).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Reload radio model catalogue" })); await act(async () => {});
  expect((screen.getByLabelText("Shared Hamlib catalogue model") as HTMLSelectElement).value).toBe("2045");
  expect(native.invoke.mock.calls.map(([, { params }]) => params.action)).toEqual(["snapshot", "hamlib_catalogue", "hamlib_catalogue"]);
});

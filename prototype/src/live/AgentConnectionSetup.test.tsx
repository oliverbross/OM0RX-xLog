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
    if (params.action === "save") { state = { ...state, revision: 5, base_url: params.base_url }; return { operation_id: params.operation_id, status: "saved", request: { action: "save" } }; }
    return { operation_id: params.operation_id, status: "acknowledged", request: { action: params.action } };
  });
});
afterEach(cleanup);
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
  expect(native.invoke.mock.calls[1][1].params).toMatchObject({ action: "connect", revision: 4, selection_generation: 7, selection_id: "radio-selection", token: "private-token", allow_transmit: false });
  expect(JSON.stringify(sessionStorage)).not.toContain("private-token");
  expect((screen.getByLabelText("Shared Agent token") as HTMLInputElement).value).toBe("");
  expect(screen.getByText(/Connection request acknowledged/)).toBeTruthy();
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

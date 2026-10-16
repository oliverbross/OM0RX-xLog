// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { DetachedSettingsSurface, requestDetachedSettings } from "./DetachedSettingsSurface";
import { loadWindowSurface } from "../windowSurface";

const api = vi.hoisted(() => ({ request: vi.fn(), dock: vi.fn(), changed: undefined as undefined | (() => void),
  rotorChanged: undefined as undefined | (() => void), layoutRefresh: vi.fn(async () => {}) }));
vi.mock("./settingsTransport", () => ({
  requestSettings: api.request,
  connectSettingsChanges: (changed: () => void) => { api.changed = changed; return () => { api.changed = undefined; }; },
}));
vi.mock("./rotorConfigurationTransport", () => ({
  connectRotorConfigurationChanges: (changed: () => void) => { api.rotorChanged = changed; return () => { api.rotorChanged = undefined; }; },
}));
vi.mock("./DetachedClusterBridge", () => ({ dockDetachedWorkspace: api.dock }));
vi.mock("./SyncPanel", () => ({ default: () => <p>Scoped synchronization</p> }));
vi.mock("./WorkspaceSettings", () => ({ default: () => <p>Scoped workspace layouts</p> }));
vi.mock("./useWorkspaceLayout", () => ({ useWorkspaceLayout: () => ({
  state: { snapshot: null, pending: null, conflict: null, saving: false, error: "", workspaceChanged: false },
  session: { refresh: api.layoutRefresh }, subscriptionError: "",
}) }));

const generation = "12345678-1234-1234-1234-123456789abc";
const serviceStyles = readFileSync("src/live/ServiceSettings.css", "utf8");
const values = { logbookMode: "wavelog", operatorCall: "OM0RX", stationCall: "OM0RX", gridSquare: "JN88",
  wavelogStationID: 1, automaticSync: false };
const snapshot = (revision: number, settings = values) => ({ generation, revision, settings });
const rotorSnapshot = { generation, revision: 0, configuration: { owner: "native_dcu1",
  native_dcu1: { host: "", port: 4001, name: "Rotor" },
  hamlib: { mode: "managed", path: "", baud: 9600, host: "127.0.0.1", port: 4533, serial: {} } } };

beforeEach(() => {
  localStorage.clear(); api.changed = undefined; api.rotorChanged = undefined; api.dock.mockReset(); api.layoutRefresh.mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

it("opens at the settings form and retains dirty text across invalidation and remount until explicit discard", async () => {
  let current = snapshot(0);
  api.request.mockImplementation(async (method: string) => {
    if (method === "settings_load") return structuredClone(current);
    if (method === "workspace_rotor_configuration_load") return structuredClone(rotorSnapshot);
    if (method === "hamlib_models") return { models: [] };
    throw new Error(`Unexpected Settings request ${method}`);
  });
  api.dock.mockResolvedValue(undefined);
  const Surface = await loadWindowSurface("?view=settings");
  const first = render(<Surface />);
  const operator = await screen.findByRole("textbox", { name: "Operator call" }) as HTMLInputElement;
  fireEvent.change(operator, { target: { value: "VK8DIRTY" } });
  expect(operator.value).toBe("VK8DIRTY");
  expect(screen.getByRole("tab", { name: "Logbook" })).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Logbook" }));
  expect((screen.getByLabelText("Logbook mode") as HTMLSelectElement).value).toBe("wavelog");
  fireEvent.click(screen.getByRole("tab", { name: "Station" }));
  expect(screen.getByRole("tab", { name: "Rotator" })).toBeTruthy();
  expect(screen.queryByRole("tab", { name: "CW" })).toBeNull();
  expect(screen.queryByText("Settings", { selector: "strong" })).toBeNull();
  expect(screen.queryByText("Shared, revision-checked configuration")).toBeNull();
  expect(screen.queryByRole("button", { name: "Dock back" })).toBeNull();
  expect(document.querySelector("main > .live-actions")).toBeNull();
  expect(localStorage.getItem("xlog.integration.settings.detached.v1")).not.toBeNull();
  expect(api.dock).not.toHaveBeenCalled();

  current = snapshot(1, { ...values, operatorCall: "VK8SAVED" });
  await act(async () => { api.changed?.(); });
  await screen.findByText(/changed in another window/);
  expect((screen.getByRole("textbox", { name: "Operator call" }) as HTMLInputElement).value).toBe("VK8DIRTY");
  first.unmount();

  render(<DetachedSettingsSurface />);
  await screen.findByText(/changed in another window/);
  expect((screen.getByRole("textbox", { name: "Operator call" }) as HTMLInputElement).value).toBe("VK8DIRTY");
  fireEvent.click(screen.getByRole("button", { name: "Use saved Settings" }));
  await waitFor(() => expect((screen.getByRole("textbox", { name: "Operator call" }) as HTMLInputElement).value).toBe("VK8SAVED"));
  expect(api.dock).not.toHaveBeenCalled();
  expect(localStorage.getItem("xlog.integration.settings.detached.v1")).toBeNull();
});

it("enforces the detached non-hardware method list before IPC", async () => {
  api.request.mockResolvedValue({});
  await requestDetachedSettings("secret_status");
  expect(api.request).toHaveBeenCalledWith("secret_status", {});
  await expect(requestDetachedSettings("station_tune", { frequency_hz: 14_025_000 })).rejects.toThrow("unavailable");
  await expect(requestDetachedSettings("winkeyer_send", { text: "TEST" })).rejects.toThrow("unavailable");
  expect(api.request).toHaveBeenCalledOnce();
});

it("lets every detached settings section fill the available window width", () => {
  const override = serviceStyles.match(/\.detached-settings-app \.service-settings \.service-fields,[\s\S]*?\{ max-width:none; \}/)?.[0] ?? "";
  expect(override).toContain(".service-account-row");
  expect(override).toContain(".service-online-log");
});

it("confirms a native UUID Settings receipt and clears recovery without discard", async () => {
  api.request.mockClear();
  let current = { ...snapshot(0), generation: generation.toUpperCase() };
  api.request.mockImplementation(async (method: string, params: any) => {
    if (method === "settings_load") return structuredClone(current);
    if (method === "workspace_rotor_configuration_load") return structuredClone(rotorSnapshot);
    if (method === "settings_save") {
      current = { ...current, revision: 1, settings: structuredClone(params.settings) };
      return { status: "applied", ...structuredClone(current), receipt: { mutation: { ...structuredClone(params),
        operationID: params.operationID.toUpperCase(), generation: params.generation.toUpperCase() }, snapshot: structuredClone(current) } };
    }
    throw new Error(`Unexpected Settings request ${method}`);
  });
  api.dock.mockResolvedValue(undefined);
  render(<DetachedSettingsSurface />);
  const operator = await screen.findByRole("textbox", { name: "Operator call" });
  fireEvent.change(operator, { target: { value: "VK8Case" } });
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await screen.findByText("Settings saved.");
  expect(screen.queryByRole("button", { name: "Check saved Settings" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry same save" })).toBeNull();
  expect(localStorage.getItem("xlog.integration.settings.detached.v1")).toBeNull();
  expect(current.settings.operatorCall).toBe("VK8Case");
  expect(api.dock).not.toHaveBeenCalled();
  expect(api.request.mock.calls.filter(([method]) => method === "settings_save")).toHaveLength(1);
  expect(api.request.mock.calls.filter(([method]) => ["settings_receipt", "sync_run", "rotor_connect", "rotor_goto", "station_connect"].includes(method))).toEqual([]);
});

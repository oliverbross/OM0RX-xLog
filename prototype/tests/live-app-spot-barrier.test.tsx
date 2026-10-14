// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import LiveApp from "../src/LiveApp";
import { operatorDraftFixture, testWorkspaceGeneration } from "./operator-draft-fixture";
import { contactEditFixture } from "./contact-edit-fixture";

const host = vi.hoisted(() => ({ request: vi.fn(), activate: vi.fn(), customCanvas: false,
  navigate: undefined as undefined | ((title: string) => void),
  dock: undefined as undefined | ((kind: string) => void),
  telemetry: undefined as undefined | ((value: any) => void),
  close: undefined as undefined | { blocked: () => boolean; explain: () => void; closing: (value: boolean) => void; command: string },
}));
vi.mock("../src/worker", async original => ({ ...await original<typeof import("../src/worker")>(), workerRequest: host.request }));
vi.mock("../src/live/operatorDraftTransport", () => ({ requestOperatorDraft: async (method: string, params: any = {}) => (await host.request(method, params)).result }));
vi.mock("../src/live/logbookContactTransport", () => ({ requestLogbookContact: async (method: string, params: any = {}) => (await host.request(method, params)).result }));
vi.mock("../src/live/workspaceNavigation", async original => ({ ...await original<typeof import("../src/live/workspaceNavigation")>(),
  connectWorkspaceNavigation: (navigate: (title: string) => void) => { host.navigate = navigate; return () => { host.navigate = undefined; }; } }));
vi.mock("../src/live/DetachedClusterBridge", async original => ({ ...await original<typeof import("../src/live/DetachedClusterBridge")>(),
  onDetachedDock: async (dock: (kind: string) => void) => { host.dock = dock; return () => { host.dock = undefined; }; } }));
vi.mock("../src/live/operatorDraftWindows", async original => ({ ...await original<typeof import("../src/live/operatorDraftWindows")>(),
  protectOperatorDraftClose: (blocked: () => boolean, explain: () => void, _failed: (message: string) => void, closing: (value: boolean) => void, command: string) => {
    host.close = { blocked, explain, closing, command }; return () => { host.close = undefined; };
  } }));
vi.mock("../src/live/useAutoRotor", () => ({ useAutoRotor: () => ({ state: null, error: "", set: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../src/live/stationTelemetry", () => ({ connectStationTelemetry: (_provider: string, changed: (value: any) => void) => {
  host.telemetry = changed; return () => { host.telemetry = undefined; };
} }));
vi.mock("../src/live/useSpotActivation", () => ({ useSpotActivation: () => ({ status: null, error: "", requesting: false, activate: host.activate, reconcile: vi.fn() }) }));
vi.mock("../src/Map", () => ({ default: () => <div>Synthetic map</div> }));
vi.mock("../src/live/Conditions", () => ({ default: () => <div>Synthetic conditions</div> }));
vi.mock("../src/live/ClusterPanel", () => ({ ClusterPanel: ({ onSelect }: any) => <button onClick={() => onSelect({ id: "retained-native-report" })}>Select synthetic report</button> }));
vi.mock("../src/live/OperatorWorkspace", () => ({ OperatorWorkspace: ({ onSelect, map }: any) => <>{map}<button onClick={() => onSelect({ id: "retained-native-report" })}>Select synthetic report</button></> }));
vi.mock("../src/live/LogbookPanel", () => ({ LogbookPanel: ({ onEdit, onWorkingChange }: any) => <><button onClick={() => onEdit({ id: "historical" })}>Edit synthetic contact</button>
  <button onClick={() => onWorkingChange?.(true)}>Begin synthetic logbook work</button><button onClick={() => onWorkingChange?.(false)}>Finish synthetic logbook work</button></> }));
vi.mock("../src/live/OperatorCanvas", () => ({ default: ({ panels, traditional }: any) => host.customCanvas
  ? <>{panels["active-qso"].content}{panels.logbook.content}</> : traditional }));

beforeEach(() => {
  localStorage.clear(); host.request.mockReset(); host.activate.mockReset(); host.customCanvas = false;
  host.navigate = undefined; host.dock = undefined; host.close = undefined; host.telemetry = undefined;
  const initial = { id: "draft", call: "", start: "2026-10-12T00:00:00Z", frequencyHz: 14074000, mode: "FT8", band: "20m" };
  const draft = operatorDraftFixture(initial);
  const contact = contactEditFixture({ ...initial, id: "historical", call: "K1ABC" });
  host.request.mockImplementation(async (method: string, params: any = {}) => {
    const scoped = draft(method, params) ?? contact.request(method, params);
    if (scoped) return { result: scoped };
    return { result: method === "workspace_status" ? { workspace_exists: true, native_log_exists: true }
      : method === "settings_load" ? { settings: { stationCall: "OM0RX", gridSquare: "JN88" }, revision: 0, generation: testWorkspaceGeneration }
      : method === "workspace_rotor_configuration_load" ? { revision: 0, generation: testWorkspaceGeneration, configuration: {
        owner: "native_dcu1", native_dcu1: { host: "", port: 4001, name: "Rotor" },
        hamlib: { mode: "managed", path: "", baud: 9600, host: "127.0.0.1", port: 4533, serial: {} },
      } }
      : method === "logbook_stats" ? { stats: { qso_count: 1 } }
      : method === "cluster_snapshot" ? { snapshot: { spots: [], connectedClusters: 0 } }
      : method === "station_snapshot" ? { source: params.provider, available: false, radio: null }
      : method === "lookup_call" ? { call: params.call, source: "Synthetic local lookup" }
      : method === "logbook_previous" ? { qsos: [] } : {} };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function sidebar(title: string) { fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: title })); }
async function openEditor(full: boolean) {
  render(<LiveApp />); await screen.findByLabelText("Desk Frequency MHz");
  if (full) sidebar("Log QSO");
  return screen.findByLabelText(full ? "Frequency MHz" : "Desk Frequency MHz") as Promise<HTMLInputElement>;
}

for (const full of [false, true]) {
  it.each(["sidebar", "native menu", "dock"])(`retains invalid ${full ? "full editor" : "Desk"} text when %s requests another view`, async route => {
    const input = await openEditor(full);
    fireEvent.change(input, { target: { value: "14.." } });
    expect(host.close?.blocked()).toBe(true);
    if (route === "sidebar") sidebar("DX Cluster");
    else await act(async () => { if (route === "native menu") host.navigate?.("Settings"); else host.dock?.("world-map"); });
    expect(screen.getByLabelText(full ? "Frequency MHz" : "Desk Frequency MHz")).toBe(input);
    expect(input.value).toBe("14..");
    expect(screen.getByRole("main", { name: full ? "Log QSO" : "Operator Desk" })).toBeTruthy();
    expect(screen.getByText(/Your text is retained/)).toBeTruthy();
    expect(host.activate).not.toHaveBeenCalled();
    expect(host.request.mock.calls.some(([method]) => ["station_tune", "rotor_goto"].includes(method))).toBe(false);
  });
}

it("does not submit a local report activation while Desk has invalid buffered frequency", async () => {
  const input = await openEditor(false);
  fireEvent.change(input, { target: { value: "14.." } });
  fireEvent.click(screen.getByRole("button", { name: "Select synthetic report" }));
  expect(input.value).toBe("14.."); expect(host.activate).not.toHaveBeenCalled();
  expect(screen.getByText(/Finish the buffered draft fields before selecting/)).toBeTruthy();
});

it("retains invalid historical editor buffers across menu navigation and Close requests", async () => {
  await openEditor(false); sidebar("Logbook");
  fireEvent.click(screen.getByRole("button", { name: "Edit synthetic contact" }));
  const input = await screen.findByLabelText("Frequency MHz") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "14.." } });
  await act(async () => { host.navigate?.("Settings"); });
  expect(screen.getByLabelText("Frequency MHz")).toBe(input); expect(input.value).toBe("14..");
  expect(host.close?.blocked()).toBe(true);
  await act(async () => { host.close?.explain(); });
  expect(screen.getByText(/before closing the Desk/)).toBeTruthy();
  expect(host.activate).not.toHaveBeenCalled();
});

it("does not replace the Desk contact from an embedded Logbook while its buffer is invalid", async () => {
  host.customCanvas = true;
  const input = await openEditor(false);
  fireEvent.change(input, { target: { value: "14.." } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Edit synthetic contact" })); });
  expect(screen.getByLabelText("Desk Frequency MHz")).toBe(input);
  expect(input.value).toBe("14..");
  expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("");
  expect(host.request.mock.calls.filter(([method]) => method === "logbook_contact")).toHaveLength(0);
});

it("freezes Desk input synchronously throughout a held historical-contact read", async () => {
  host.customCanvas = true;
  const base = host.request.getMockImplementation()!;
  let reply: (() => void) | undefined;
  host.request.mockImplementation((method: string, params: any = {}) => method === "logbook_contact"
    ? new Promise(resolve => { reply = () => { void base(method, params).then(resolve); }; }) : base(method, params));
  const input = await openEditor(false);
  fireEvent.click(screen.getByRole("button", { name: "Edit synthetic contact" }));
  await waitFor(() => expect(reply).toBeDefined());
  fireEvent.change(input, { target: { value: "14.." } });
  expect(input.value).toBe("14.074000");
  sidebar("Settings"); expect(screen.getByRole("main", { name: "Operator Desk" })).toBeTruthy();
  await act(async () => { reply?.(); });
  expect((await screen.findByLabelText("Frequency MHz") as HTMLInputElement).value).toBe("14.074000");
  expect((screen.getByLabelText("Callsign") as HTMLInputElement).value).toBe("K1ABC");
  expect(host.activate).not.toHaveBeenCalled();
});

it("registers main-only clean close and freezes synchronous input before native close", async () => {
  const input = await openEditor(false);
  expect(host.close?.command).toBe("close_main_window");
  expect(host.close?.blocked()).toBe(false);
  await act(async () => { host.close?.closing(true); });
  fireEvent.change(input, { target: { value: "14.." } });
  expect(input.value).toBe("14.074000");
  await act(async () => { host.telemetry?.({ source: "direct_agent", radio: { connected: true, observed: true, frequency_hz: 7050000, mode: "CW" } }); });
  expect(input.value).toBe("14.074000");
  sidebar("DX Cluster"); expect(screen.getByRole("main", { name: "Operator Desk" })).toBeTruthy();
  await act(async () => { host.close?.closing(false); });
  fireEvent.change(input, { target: { value: "14.." } });
  expect(input.value).toBe("14.."); expect(host.close?.blocked()).toBe(true);
});

it("keeps the same invalid Desk buffer through every bottom map/logbook presentation", async () => {
  const input = await openEditor(false);
  fireEvent.change(input, { target: { value: "14.." } });
  const writesBefore = host.request.mock.calls.filter(([method]) => /draft_(apply|commit)|station_tune|rotor_goto/.test(method)).length;
  for (const view of ["logbook", "logbook-above", "logbook-below", "map"]) {
    fireEvent.change(screen.getByLabelText("Desk map and logbook view"), { target: { value: view } });
    expect(screen.getByLabelText("Desk Frequency MHz")).toBe(input);
    expect(input.value).toBe("14..");
  }
  expect(host.request.mock.calls.filter(([method]) => /draft_(apply|commit)|station_tune|rotor_goto/.test(method))).toHaveLength(writesBefore);
  expect(host.activate).not.toHaveBeenCalled();
});

it("guards historical Edit from the Traditional Desk logbook without losing invalid input", async () => {
  const input = await openEditor(false);
  fireEvent.change(screen.getByLabelText("Desk map and logbook view"), { target: { value: "logbook" } });
  fireEvent.change(input, { target: { value: "14.." } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Edit synthetic contact" })); });
  expect(screen.getByLabelText("Desk Frequency MHz")).toBe(input); expect(input.value).toBe("14..");
  expect(host.request.mock.calls.filter(([method]) => method === "logbook_contact")).toHaveLength(0);
});

it("retains the Traditional table during local work and blocks close, routes and activation", async () => {
  await openEditor(false);
  const choice = screen.getByLabelText("Desk map and logbook view") as HTMLSelectElement;
  fireEvent.change(choice, { target: { value: "logbook" } });
  const tableControl = screen.getByRole("button", { name: "Edit synthetic contact" });
  fireEvent.click(screen.getByRole("button", { name: "Begin synthetic logbook work" }));
  expect(choice.disabled).toBe(true); expect(host.close?.blocked()).toBe(true);
  sidebar("Settings"); expect(screen.getByRole("main", { name: "Operator Desk" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Select synthetic report" }));
  expect(host.activate).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Edit synthetic contact" })).toBe(tableControl);
  fireEvent.click(screen.getByRole("button", { name: "Finish synthetic logbook work" }));
  expect(choice.disabled).toBe(false); expect(host.close?.blocked()).toBe(false);
  fireEvent.change(choice, { target: { value: "logbook-above" } });
  expect(screen.getByRole("button", { name: "Edit synthetic contact" })).toBe(tableControl);
});

// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import LiveApp from "../src/LiveApp";
import { operatorDraftFixture, testWorkspaceGeneration } from "./operator-draft-fixture";
import { contactEditFixture } from "./contact-edit-fixture";

const host = vi.hoisted(() => ({ request: vi.fn(), activate: vi.fn(), customCanvas: false,
  nativeEditor: false, invoke: vi.fn(), follow: vi.fn(), reconcile: vi.fn(),
  readiness: null as null | ((snapshot: any) => { ready: boolean }),
  navigate: undefined as undefined | ((title: string) => void),
  dock: undefined as undefined | ((kind: string) => void),
  telemetry: undefined as undefined | ((value: any) => void),
  close: undefined as undefined | { blocked: () => boolean; explain: () => void; closing: (value: boolean) => void; command: string },
}));
vi.mock("@tauri-apps/api/core", async original => ({ ...await original<typeof import("@tauri-apps/api/core")>(),
  invoke: (command: string, params: any) => command.startsWith("operator_draft_read_radio") ? host.invoke(command, params) : Promise.resolve({}) }));
vi.mock("../src/live/useFollowRadio", () => ({ useFollowRadio: () => ({ state: { enabled: true }, error: "", set: host.follow }) }));
vi.mock("../src/live/useSharedCW", () => ({ useSharedCW: () => ({ profile: { showOnDesk: false, macros: [] }, context: null, state: {}, controller: {}, provider: null }) }));
vi.mock("../src/live/useSpotEditor", async () => {
  const { useEffect } = await import("react");
  return { nativeSpotEditor: () => host.nativeEditor, useSpotEditor: (participants: any[], readiness: (snapshot: any) => { ready: boolean }) => {
    host.readiness = readiness;
    useEffect(() => { if (host.nativeEditor) participants.forEach(item => item.setSpotEditorRegistered(true)); }, []);
    host.reconcile.mockImplementation(async () => { for (const item of participants) await item.refresh(); return true; });
    return { status: null, error: "", reconcile: host.reconcile };
  } };
});
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
vi.mock("../src/live/useAutoRotor", () => ({ useAutoRotor: () => ({ state: null, error: "", set: vi.fn().mockResolvedValue(undefined), refresh: vi.fn() }) }));
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
  host.nativeEditor = false; host.invoke.mockReset(); host.follow.mockReset(); host.follow.mockResolvedValue(undefined); host.reconcile.mockReset();
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

it.each([false, true])("uses the typed native Read radio transaction in the %s full editor", async full => {
  host.nativeEditor = true;
  host.invoke.mockImplementation(async (command, { operationId }) => {
    expect(command).toBe("operator_draft_read_radio");
    expect(host.follow).toHaveBeenCalledWith(false);
    expect(host.readiness?.({ operationId, phase: "preparing", draftOnly: true, intent: "read-radio" }).ready).toBe(true);
    const snapshot = (await host.request("logbook_operator_draft")).result.draft;
    expect(snapshot.qso.name).toBe("Retained text");
    await host.request("logbook_operator_draft_apply", { operationID: operationId, generation: snapshot.generation,
      draftID: snapshot.qso.id, expectedRevision: snapshot.revision, action: "replace",
      qso: { ...snapshot.qso, frequencyHz: 7_100_000, band: "40m", mode: "SSB" } });
    return { operationId, phase: "confirmed", reservationActive: false, tuneConfirmed: false, rotor: "not-requested" };
  });
  await openEditor(full);
  fireEvent.change(screen.getByLabelText(full ? "Name" : "Desk Name"), { target: { value: "Retained text" } });
  fireEvent.click(screen.getByRole("button", { name: "Read radio" }));
  await screen.findByDisplayValue("7.100000");
  expect(host.invoke).toHaveBeenCalledOnce(); expect(host.reconcile).toHaveBeenCalledOnce();
  expect(localStorage.getItem("xlog.integration.operatorDraft.main.v1.readRadio")).toBeNull();
  expect(host.request.mock.calls.some(([method]) => method === "station_snapshot")).toBe(false);
});

it.each([false, true])("retains incomplete main Read radio buffers in the %s full editor", async full => {
  host.nativeEditor = true;
  const input = await openEditor(full);
  fireEvent.change(input, { target: { value: "14.." } });
  fireEvent.click(screen.getByRole("button", { name: "Read radio" }));
  await screen.findByText(/Finish the draft fields and resolve pending QSO changes before reading/);
  expect(host.invoke).not.toHaveBeenCalled(); expect(input.value).toBe("14..");
});

it.each(["lost", "mismatched", "uncertain"])("retains a %s main Read radio operation across remount without replay", async outcome => {
  host.nativeEditor = true;
  host.invoke.mockImplementation(async (_command, { operationId }) => {
    if (outcome === "lost") throw new Error("Synthetic Read radio reply lost");
    return { operationId: outcome === "mismatched" ? crypto.randomUUID() : operationId,
      phase: outcome === "uncertain" ? "uncertain" : "confirmed", reservationActive: false, tuneConfirmed: false, rotor: "not-requested" };
  });
  await openEditor(false);
  fireEvent.click(screen.getByRole("button", { name: "Read radio" }));
  await waitFor(() => expect(JSON.parse(localStorage.getItem("xlog.integration.operatorDraft.main.v1.readRadio")!).operationId).toMatch(/^[a-f0-9-]{36}$/));
  await screen.findByText(outcome === "lost" ? /Synthetic Read radio reply lost/ : outcome === "mismatched" ? /outcome could not be verified/ : /Read radio was not confirmed/);
  expect(host.close?.blocked()).toBe(true);
  cleanup(); await openEditor(false);
  fireEvent.click(screen.getByRole("button", { name: "Read radio" }));
  await screen.findByText(/Check the existing Read radio activation before reading again/);
  expect(host.invoke).toHaveBeenCalledOnce();
  const journal = JSON.parse(localStorage.getItem("xlog.integration.operatorDraft.main.v1.readRadio")!);
  expect(host.readiness?.({ operationId: crypto.randomUUID(), phase: "preparing" }).ready).toBe(false);
  expect(host.readiness?.({ operationId: journal.operationId, phase: "preparing" }).ready).toBe(true);
});

it("retains the main Read radio journal when registered editor reconciliation fails", async () => {
  host.nativeEditor = true;
  host.invoke.mockImplementation(async (_command, { operationId }) => ({ operationId, phase: "confirmed", reservationActive: false, tuneConfirmed: false, rotor: "not-requested" }));
  await openEditor(false); host.reconcile.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByRole("button", { name: "Read radio" }));
  await screen.findByText(/Read radio editor reconciliation is incomplete/);
  expect(host.close?.blocked()).toBe(true);
  expect(localStorage.getItem("xlog.integration.operatorDraft.main.v1.readRadio")).not.toBeNull();
  expect(screen.queryByText("Observed radio frequency and mode copied into the QSO draft.")).toBeNull();
});

it.each(["confirmed", "blocked"])("recovers a retained main Read radio after remount from a %s receipt check without another read", async phase => {
  host.nativeEditor = true;
  const operationId = crypto.randomUUID();
  localStorage.setItem("xlog.integration.operatorDraft.main.v1.readRadio", JSON.stringify({ operationId, generation: testWorkspaceGeneration }));
  host.invoke.mockImplementation(async (command, params) => {
    expect(command).toBe("operator_draft_read_radio_recover");
    expect(params).toEqual({ operationId, generation: testWorkspaceGeneration });
    return { operationId, phase, reservationActive: false, tuneConfirmed: false, rotor: "not-requested" };
  });
  await openEditor(false);
  fireEvent.click(screen.getByRole("button", { name: "Check Read radio" }));
  await waitFor(() => expect(localStorage.getItem("xlog.integration.operatorDraft.main.v1.readRadio")).toBeNull());
  expect(host.invoke).toHaveBeenCalledOnce(); expect(host.close?.blocked()).toBe(false);
});

it("keeps the main editor and Close frozen while native Read radio prepares", async () => {
  host.nativeEditor = true;
  let finish!: (value: any) => void;
  host.invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const input = await openEditor(false);
  fireEvent.click(screen.getByRole("button", { name: "Read radio" }));
  await waitFor(() => expect(host.invoke).toHaveBeenCalledOnce());
  expect(host.close?.blocked()).toBe(true);
  expect(input.closest("form")?.hasAttribute("inert")).toBe(true);
  fireEvent.change(screen.getByLabelText("Desk Callsign"), { target: { value: "IGNORED" } });
  expect((screen.getByLabelText("Desk Callsign") as HTMLInputElement).value).toBe("");
  const operationId = host.invoke.mock.calls[0][1].operationId;
  await act(async () => finish({ operationId, phase: "blocked", reservationActive: false, tuneConfirmed: false, rotor: "not-requested", error: "Synthetic blocked read" }));
  await screen.findByText("Synthetic blocked read");
  expect(host.close?.blocked()).toBe(false);
});

it("rejects native Read radio for an historical contact including its keyboard shortcut", async () => {
  host.nativeEditor = true;
  await openEditor(false);
  sidebar("Logbook");
  fireEvent.click(screen.getByRole("button", { name: "Edit synthetic contact" }));
  await screen.findByDisplayValue("K1ABC");
  fireEvent.keyDown(window, { key: "r", ctrlKey: true, shiftKey: true });
  await screen.findByText(/Finish the draft fields and resolve pending QSO changes before reading/);
  expect(host.invoke).not.toHaveBeenCalled();
});

it("vetoes native Read radio when a workspace changes during the draft flush", async () => {
  host.nativeEditor = true;
  await openEditor(false);
  const original = host.request.getMockImplementation()!;
  host.request.mockImplementation(async (method, params) => {
    const result = await original(method, params);
    if (method === "logbook_operator_draft_apply") return { result: { ...result.result,
      receipt: { ...result.result.receipt, draft: { ...result.result.receipt.draft, generation: crypto.randomUUID() } } } };
    return result;
  });
  fireEvent.change(screen.getByLabelText("Desk Name"), { target: { value: "Retained text" } });
  fireEvent.click(screen.getByRole("button", { name: "Read radio" }));
  await waitFor(() => expect(host.request.mock.calls.some(([method]) => method === "logbook_operator_draft_apply")).toBe(true));
  await waitFor(() => expect(screen.getByRole("button", { name: "Read radio" }).textContent).toContain("Read radio"));
  expect(host.invoke).not.toHaveBeenCalled();
  expect(localStorage.getItem("xlog.integration.operatorDraft.main.v1.readRadio")).toBeNull();
});

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

it("does not turn a repeated in-flight spot selection into a persistent page error", async () => {
  host.activate.mockRejectedValueOnce(new Error("Check the existing spot activation before selecting another report."));
  await openEditor(false);
  fireEvent.click(screen.getByRole("button", { name: "Select synthetic report" }));
  await waitFor(() => expect(host.activate).toHaveBeenCalledOnce());
  expect(screen.queryByText("Check the existing spot activation before selecting another report.")).toBeNull();
});

it("still presents a genuine spot activation failure", async () => {
  host.activate.mockRejectedValueOnce(new Error("Synthetic station tune failed."));
  await openEditor(false);
  fireEvent.click(screen.getByRole("button", { name: "Select synthetic report" }));
  expect(await screen.findByText("Synthetic station tune failed.")).toBeTruthy();
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

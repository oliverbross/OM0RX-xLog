// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Not1MMContestWorkspace } from "./Not1MMContestWorkspace";
import { callStackStorageKey } from "./contestCallStack";

const owner = vi.hoisted(() => ({ current: null as any }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: async () => { throw Error("Native action prohibited"); } }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onCloseRequested: async () => () => {} }) }));
vi.mock("./ContestRecorderStrip", () => ({ ContestRecorderStrip: () => null }));
vi.mock("./useContestSurfaceOwner", async original => ({ ...await original<typeof import("./useContestSurfaceOwner")>(),
  useContestSurfaceOwner: (value: any) => { owner.current = value; return async () => {}; } }));
vi.mock("./contestSurfaceNative", async original => ({ ...await original<typeof import("./contestSurfaceNative")>(),
  openContestSurfaceWindow: vi.fn(), openContestCallHistoryWindow: vi.fn() }));
vi.mock("./contestSetupDialogs", () => ({ openContestSetupDialog: vi.fn(), useContestSetupDialogs: vi.fn() }));
vi.mock("./contestGroupChat", () => ({ configureContestGroupChat: vi.fn(async () => ({})), readContestGroupNetwork: vi.fn(async () => ({})),
  openContestGroupChatWindow: vi.fn(), requestContestGroupAuthority: vi.fn(), syncContestGroupReplicaPage: vi.fn(),
  publishContestGroupContact: vi.fn(), takeContestGroupUnverifiedAcknowledgements: () => [] }));
vi.mock("../live/useSharedCW", () => ({ useSharedCW: () => ({ controller: { refresh: vi.fn(), arm: vi.fn(), stop: vi.fn(),
  executeContest: vi.fn(() => { throw Error("Output prohibited"); }) }, state: { pending: false, armed: false, message: "Disarmed", error: "" }, profile: { macros: [] } }) }));
vi.mock("../live/mapContext", () => ({ connectMapContext: () => ({ refresh: vi.fn(), dispose: vi.fn() }) }));
vi.mock("../live/BandMaps", () => ({ default: () => null, deduplicateBandMapSpots: (spots: any[]) => spots }));
vi.mock("../live/ClusterPanel", () => ({ default: () => null }));
vi.mock("./contestVoiceOutput", () => ({ ContestVoiceOutput: class { stop = async () => {}; play = async () => { throw Error("Audio prohibited"); }; } }));
const root = resolve(import.meta.dirname, "../../..");
const fixture = JSON.parse(readFileSync(resolve(root, "python/tests/fixtures/all_contests_lifecycle.json"), "utf8")).cq_wpx_cw;
afterEach(() => { cleanup(); localStorage.clear(); owner.current = null; window.history.replaceState({}, "", "/"); });

function pythonHost() {
  const directory = realpathSync(mkdtempSync(resolve(tmpdir(), "xlog-stack-recovery-")));
  const child = spawn(globalThis.process.env.XLOG_CONTEST_PYTHON ?? "/opt/local/bin/python3.12",
    ["-I", "-B", resolve(root, "python/contest_host/launcher.py"), "--data-root", directory], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map<string, { resolve(value: any): void; reject(error: Error): void }>(); let buffer = "", stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.on("data", value => { stderr += String(value); });
  child.stdout.on("data", value => { buffer += value; while (buffer.includes("\n")) {
    const end = buffer.indexOf("\n"), message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    pending.get(message.id)?.resolve(message); pending.delete(message.id);
  } });
  let terminalError: Error | null = null;
  const exited = new Promise<void>(resolve => {
    const finish = (error: Error) => {
      terminalError = error;
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear(); resolve();
    };
    child.once("error", error => finish(error));
    child.once("exit", () => finish(Error(`Python exited: ${stderr}`)));
  });
  const request = async (method: string, params: Record<string, any> = {}): Promise<any> => {
    if (terminalError) throw terminalError;
    const id = crypto.randomUUID();
    if (method === "contest_scp_status") return { id, ok: true, result: { dataset: null, unavailableReason: "not_imported" } };
    if (method === "contest_history_status") return { id, ok: true, result: { status: "inactive", active: null, pending: null } };
    if (method.startsWith("contest_scp_")) return { id, ok: false, error: { code: "unavailable", message: "No SCP fixture" } };
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ id, method, params }) + "\n"); });
  };
  return { request, close: async () => {
    if (!terminalError) child.stdin.end();
    await exited; rmSync(directory, { recursive: true });
  } };
}
async function desk() {
  const host = pythonHost(), sessionID = crypto.randomUUID(), workspaceGeneration = crypto.randomUUID(), operatingContext = crypto.randomUUID();
  const created = await host.request("contest_session_create", { sessionID, workspaceGeneration, operationID: crypto.randomUUID(), expectedRevision: 0,
    pluginID: "cq_wpx_cw", station: fixture.state.station, settings: fixture.state.settings, reference: fixture.state.reference,
    frequencyHz: fixture.state.draft.frequencyHz, mode: fixture.mode });
  expect(created.ok, JSON.stringify(created)).toBe(true);
  const operations: { method: string; params: Record<string, any> }[] = []; let dropCommit = true;
  const request = async (method: string, params: Record<string, any> = {}) => {
    operations.push({ method, params }); const result = await host.request(method, params);
    if (method === "contest_qso_commit" && result.ok && dropCommit) { dropCommit = false; throw Error("Simulated lost durable save reply"); }
    return result;
  };
  const prohibited = vi.fn(async () => { throw Error("Station/provider actions prohibited"); });
  const props = { request, serviceRequest: async (method: string, params: any = {}) => method === "lookup_call"
    ? { call: params.call, ...(fixture.state.reference.countries[params.call] ?? {}) } : {}, contestingTest: true,
    strictHostActive: { sessionID, workspaceGeneration }, operatingContext, workspaceGeneration, stationCall: fixture.state.station.Call,
    stationTune: prohibited, contestSpot: prohibited, radioFrequencyHz: fixture.state.draft.frequencyHz, spots: [], cluster: null };
  const mount = async () => {
    const view = render(<Not1MMContestWorkspace {...props}/>);
    await waitFor(() => expect(owner.current?.projections["active-qso"]?.status).toBe("ready"), { timeout: 10000 });
    fireEvent.click(screen.getByRole("button", { name: "Productivity desk" }));
    return { ...view, input: (id: string) => view.container.querySelector<HTMLInputElement>(`[data-contest-field="${id}"]`)! };
  };
  const beginUncertain = async () => {
    const view = await mount();
    fireEvent.change(screen.getByRole("textbox", { name: "Add heard call to stack" }), { target: { value: "K2ABC" } });
    fireEvent.click(screen.getByRole("button", { name: "Add caller" }));
    for (const field of created.result.projection.fields) if (field.visible && field.enabled && !field.readOnly)
      fireEvent.change(view.input(field.id), { target: { value: fixture.fields[field.id] } });
    fireEvent.click(screen.getByRole("button", { name: "Log and load next" }));
    await screen.findByRole("button", { name: "Check original receipt" });
    await screen.findByText(/save reply was not confirmed/i);
    return view;
  };
  return { host, props, mount, beginUncertain, operations, prohibited, scope: { sessionID, workspaceGeneration }, firstSerial: created.result.projection.reservedSerial };
}

it("real WPX lost save reply cannot log twice, and receipt recovery preserves later operator edits", async () => {
  const d = await desk();
  try {
    const view = await d.beginUncertain();
    fireEvent.change(view.input("callsign"), { target: { value: "W1NEW" } });
    fireEvent.change(view.input("other_2"), { target: { value: "456" } });
    // Let the actual background poll see the advanced authoritative draft after the lost reply.
    await waitFor(() => expect(owner.current?.projections["active-qso"]?.manual?.qsos).toBe(1), { timeout: 4000 });
    fireEvent.click(screen.getByRole("button", { name: "Log Now" }));
    await waitFor(() => expect(screen.getByText(/Resolve the pending Call Stack/i)).toBeTruthy());
    expect((await d.host.request("contest_log_page", { sessionID: d.scope.sessionID })).result.total).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Check original receipt" }));
    await screen.findByRole("button", { name: "Keep queue for manual loading" });
    expect(view.input("callsign").value).toBe("W1NEW"); expect(view.input("other_2").value).toBe("456");
    expect(screen.getByRole("button", { name: "K2ABC" })).toBeTruthy();
    expect(d.operations.filter(value => value.method === "contest_qso_commit")).toHaveLength(1);
    expect(d.operations.filter(value => value.method === "contest_draft_apply" && value.params.manualStackLoad)).toHaveLength(0);
    expect(d.prohibited).not.toHaveBeenCalled();
  } finally { cleanup(); await d.host.close(); }
}, 20000);

it("renderer restart reconciles the original real-host save receipt and loads the queued caller once", async () => {
  const d = await desk();
  try {
    const original = await d.beginUncertain(), journal = JSON.parse(localStorage.getItem(callStackStorageKey(d.scope))!);
    expect(journal.pending.phase).toBe("commit"); original.unmount(); owner.current = null;
    const restarted = await d.mount();
    fireEvent.click(screen.getByRole("button", { name: "Check original receipt" }));
    await waitFor(() => {
      expect(restarted.input("callsign").value).toBe("K2ABC");
      expect(screen.getByText(/Manual order · 0 queued/)).toBeTruthy();
    }, { timeout: 5000 });
    const log = await d.host.request("contest_log_page", { sessionID: d.scope.sessionID });
    expect(log.result.total).toBe(1); expect(log.result.rows[0].Call).toBe("K1ABC");
    expect(Number(log.result.rows[0].SentNr)).toBe(d.firstSerial);
    expect(Number(restarted.input("other_1").value)).toBe(d.firstSerial + 1);
    expect(d.operations.filter(value => value.method === "contest_qso_commit")).toHaveLength(1);
    expect(d.operations.filter(value => value.method === "contest_draft_apply" && value.params.manualStackLoad)).toHaveLength(1);
    expect(d.prohibited).not.toHaveBeenCalled();
  } finally { cleanup(); await d.host.close(); }
}, 20000);

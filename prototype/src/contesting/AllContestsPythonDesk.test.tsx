// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Not1MMContestWorkspace } from "./Not1MMContestWorkspace";
import { DetachedContestSurface } from "./DetachedContestSurface";
import { contestSurfacePanelIDs, validContestSurfaceProjection } from "./contestSurfaceProtocol";

const owner = vi.hoisted(() => ({ current: null as any, revision: 0,
  invoke: null as null | ((command: string, args: any) => Promise<any>), wakes: [] as ((event: any) => void)[] }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true,
  invoke: (command: string, args: any) => owner.invoke!(command, args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async (_name: string, callback: (event: any) => void) => {
  owner.wakes.push(callback); return () => { owner.wakes = owner.wakes.filter(value => value !== callback); };
} }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onCloseRequested: async () => () => {} }) }));
vi.mock("./ContestRecorderStrip", () => ({ ContestRecorderStrip: () => null }));
vi.mock("./useContestSurfaceOwner", async importOriginal => ({ ...await importOriginal<typeof import("./useContestSurfaceOwner")>(), useContestSurfaceOwner: (value: any) => {
  owner.current = value; owner.revision += 1; return async () => {};
} }));
vi.mock("./contestSurfaceNative", async importOriginal => ({ ...await importOriginal<typeof import("./contestSurfaceNative")>(),
  openContestSurfaceWindow: vi.fn(), openContestCallHistoryWindow: vi.fn() }));
vi.mock("./contestSetupDialogs", () => ({ openContestSetupDialog: vi.fn(), useContestSetupDialogs: vi.fn() }));
vi.mock("./contestGroupChat", () => ({ configureContestGroupChat: vi.fn(async () => ({})),
  readContestGroupNetwork: vi.fn(async () => ({})), openContestGroupChatWindow: vi.fn(),
  requestContestGroupAuthority: vi.fn(), syncContestGroupReplicaPage: vi.fn(),
  publishContestGroupContact: vi.fn(), takeContestGroupUnverifiedAcknowledgements: () => [] }));
vi.mock("../live/useSharedCW", () => ({ useSharedCW: () => ({
  controller: { refresh: vi.fn(), arm: vi.fn(), stop: vi.fn(), executeContest: vi.fn(() => { throw Error("Output prohibited"); }) },
  state: { pending: false, armed: false, message: "Disarmed", error: "" }, profile: { macros: [] },
}) }));
vi.mock("../live/mapContext", () => ({ connectMapContext: () => ({ refresh: vi.fn(), dispose: vi.fn() }) }));
vi.mock("../live/BandMaps", () => ({ default: () => null, deduplicateBandMapSpots: (spots: any[]) => spots }));
vi.mock("../live/ClusterPanel", () => ({ default: () => null }));
vi.mock("./contestVoiceOutput", () => ({ ContestVoiceOutput: class {
  stop = async () => {}; play = async () => { throw Error("Audio prohibited"); };
} }));

const root = resolve(import.meta.dirname, "../../..");
const fixtures = JSON.parse(readFileSync(resolve(root, "python/tests/fixtures/all_contests_lifecycle.json"), "utf8"));
afterEach(() => { cleanup(); localStorage.clear(); owner.current = null; owner.wakes = [];
  window.history.replaceState({}, "", "/"); });

function pythonHost() {
  const directory = realpathSync(mkdtempSync(resolve(tmpdir(), "xlog-ui-catalogue-")));
  const process = spawn(globalThis.process.env.XLOG_CONTEST_PYTHON ?? "/opt/local/bin/python3.12",
    ["-I", "-B", resolve(root, "python/contest_host/launcher.py"), "--data-root", directory],
    { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "", stderr = "";
  const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  process.stdout.setEncoding("utf8");
  process.stderr.on("data", value => { stderr += String(value); });
  process.stdout.on("data", value => {
    buffer += value;
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n"), message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      pending.get(message.id)?.resolve(message); pending.delete(message.id);
    }
  });
  process.on("exit", () => {
    for (const request of pending.values()) request.reject(Error(`Python exited: ${stderr}`));
    pending.clear();
  });
  const request = async (method: string, params: Record<string, any> = {}): Promise<any> => {
    const id = crypto.randomUUID();
    if (method === "contest_scp_status") return { id, ok: true, result: { dataset: null, unavailableReason: "not_imported" } };
    if (method === "contest_history_status") return { id, ok: true, result: { status: "inactive", active: null, pending: null } };
    // The Python host is the scoring/mutation authority; unrelated assistance
    // and native output/service owners are unavailable in this isolated test.
    if (method.startsWith("contest_scp_")) return { id, ok: false, error: { code: "unavailable", message: "No SCP fixture" } };
    return await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      process.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  };
  return { request, close: async () => {
    const exited = new Promise<void>(resolve => process.once("exit", () => resolve()));
    process.stdin.end(); await exited; rmSync(directory, { recursive: true });
  } };
}

async function qualifyCurrentDesk(plugin: string, raw: any, partialScore = false) {
  const fixture = raw as any, host = pythonHost();
  const session = crypto.randomUUID(), generation = crypto.randomUUID(), operatingContext = crypto.randomUUID();
  try {
    const created = await host.request("contest_session_create", {
      sessionID: session, workspaceGeneration: generation, operationID: crypto.randomUUID(), expectedRevision: 0,
      pluginID: plugin, station: fixture.state.station, settings: fixture.state.settings,
      reference: fixture.state.reference, frequencyHz: fixture.state.draft.frequencyHz, mode: fixture.mode,
    });
    expect(created.ok, JSON.stringify(created)).toBe(true);
    const projection = created.result.projection;
    const serviceRequest = vi.fn(async (method: string, params: any = {}) => method === "lookup_call"
      ? { call: params.call, ...(fixture.state.reference.countries[params.call] ?? {}) } : {});
    const view = render(<Not1MMContestWorkspace request={host.request} serviceRequest={serviceRequest}
      contestingTest strictHostActive={{ sessionID: session, workspaceGeneration: generation }}
      operatingContext={operatingContext} workspaceGeneration={generation} stationCall={fixture.state.station.Call}
      stationTune={async () => { throw Error("Radio prohibited"); }} contestSpot={async () => { throw Error("Spot upload prohibited"); }}
      radioFrequencyHz={fixture.state.draft.frequencyHz} spots={[]} cluster={null} />);
    await waitFor(() => expect(owner.current?.projections["active-qso"]?.status).toBe("ready"), { timeout: 10000 });
    expect(validContestSurfaceProjection("active-qso", owner.current.projections["active-qso"]),
      JSON.stringify(owner.current.projections["active-qso"])).toBe(true);
    const receipts: any[] = [];
    owner.invoke = async (command, args) => {
      if (command === "contest_surface_snapshot") return { ...owner.current.context, scope: "contesting", panelID: "active-qso",
        projectionRevision: owner.revision, projection: owner.current.projections["active-qso"], receipts: receipts.slice(-64) };
      if (command === "contest_surface_action") {
        const envelope = args.envelope;
        await owner.current.handle(envelope);
        await new Promise(resolve => setTimeout(resolve, 0));
        receipts.push({ requestID: envelope.requestID, status: "applied", message: null, projectionRevision: owner.revision });
        setTimeout(() => owner.wakes.forEach(wake => wake({ payload: null })), 0);
        return { requestID: envelope.requestID, status: "applied" };
      }
      if (command === "monitor_context_snapshot") return null;
      throw Error(`Unavailable native service: ${command}`);
    };
    window.history.replaceState({}, "", `?view=active-qso&scope=contesting&operatingContext=${operatingContext}&sessionID=${session}&workspaceGeneration=${generation}`);
    const detached = render(<DetachedContestSurface />);
    await screen.findByLabelText("Callsign", {}, { timeout: 5000 });
    for (const field of projection.fields) {
      const element = detached.container.querySelector<HTMLInputElement>(`[data-contest-field-id="${field.id}"]`);
      if (!field.visible) { expect(element).toBeNull(); continue; }
      if (field.readOnly && !element) { expect(screen.getByLabelText("Sent exchange")).toBeTruthy(); continue; }
      expect(element, `${plugin}:${field.id}`).not.toBeNull();
      expect(element!.readOnly).toBe(field.readOnly);
      if (!field.readOnly && field.enabled) fireEvent.change(element!, { target: { value: fixture.fields[field.id] } });
    }
    await waitFor(async () => {
      const current = (await host.request("contest_projection", { sessionID: session })).result.projection;
      for (const field of projection.fields.filter((field: any) => field.visible && field.enabled && !field.readOnly)) {
        expect(current.fields.find((item: any) => item.id === field.id).value.toUpperCase()).toBe(fixture.fields[field.id].toUpperCase());
      }
      expect(owner.current.projections["active-qso"].busy).toBe(false);
      expect((screen.getByRole("button", { name: "Log It" }) as HTMLButtonElement).disabled).toBe(false);
    }, { timeout: 5000 });
    fireEvent.click(screen.getByRole("button", { name: "Log It" }));
    await waitFor(() => expect(owner.current?.projections["active-qso"]?.manual?.qsos).toBe(1), { timeout: 5000 });
    const logged = await host.request("contest_log_page", { sessionID: session });
    expect(logged.result.total).toBe(1);
    expect(logged.result.rows[0].Call).toBe(fixture.firstRow.Call);
    expect(logged.result.rows[0].raw_fields.other_2).toBe(fixture.fields.other_2.toUpperCase());
    for (const panel of contestSurfacePanelIDs) {
      expect(validContestSurfaceProjection(panel, owner.current.projections[panel]), `${plugin}:${panel}`).toBe(true);
    }
    if (partialScore) {
      expect(owner.current.projections["active-qso"].manual.scoringComplete).toBe(false);
      expect(owner.current.projections.propagation.score.scoringComplete).toBe(false);
      expect(owner.current.projections["score-reporting"].availability).toBe("unavailable");
      await screen.findByText("Score (partial)", {}, {timeout:5000});
      expect(owner.current.projections["active-qso"].draft.validation.warnings.length).toBeGreaterThan(0);
    }
    view.unmount();
  } finally { cleanup(); await host.close(); }
}

it.each(Object.entries(fixtures))("current React desk commits %s through the real Python host",
  async (plugin, fixture) => qualifyCurrentDesk(plugin, fixture), 15000);

it("current React desk labels an unknown Brazilian UF score as partial", async () => {
  const fixture = structuredClone(fixtures.cqws);
  fixture.fields.callsign = fixture.firstRow.Call = "PY2ABC";
  fixture.state.reference.countries.PY2ABC = { entity:"Brazil",continent:"SA",cq:11,itu:15,primary_pfx:"PY" };
  await qualifyCurrentDesk("cqws", fixture, true);
}, 15000);

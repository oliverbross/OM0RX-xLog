// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Not1MMContestWorkspace } from "./Not1MMContestWorkspace";
const nativeCW = vi.hoisted(() => ({ execute: vi.fn(), stop:vi.fn(async () => {}) }));

vi.mock("./ContestOperatorCanvas", () => ({ ContestOperatorCanvas: ({ traditional }: { traditional: unknown }) => traditional }));
vi.mock("../live/BandMaps", () => ({ default: () => <div>Shared bandmap</div> }));
vi.mock("../live/ClusterPanel", () => ({ default: () => <div>Shared cluster</div> }));
vi.mock("../live/useSharedCW", () => ({ useSharedCW: () => ({
  controller: { refresh: vi.fn(async () => {}), arm: vi.fn(async () => {}), stop: nativeCW.stop, send: vi.fn(async () => {}), executeContest: nativeCW.execute },
  state: { pending: false, armed: false, message: "CW disarmed", error: "" },
  profile: { macros: [{ id: 2, enabled: true, shortcut: "F2", text: "{CALL} {RST} {EXCHANGE}" }] },
}) }));

afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });

const projection = (revision = 1, values: Record<string, string> = {}) => ({
  sessionID: "11111111-1111-4111-8111-111111111111", engine: "not1mm-python", pluginID: "cq_ww_cw",
  workspaceGeneration: "33333333-3333-4333-8333-333333333333",
  sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f", referenceID: "cty-test", revision,
  draftID: "22222222-2222-4222-8222-222222222222", frequencyHz: 14025000, mode: "CW", band: 14,
  focus: "callsign", tabNext: { callsign: "sent", sent: "receive", receive: "other_2", other_2: "callsign" },
  tabPrevious: { callsign: "other_2", sent: "callsign", receive: "sent", other_2: "receive" }, run: false,
  functionKeys: Array.from({ length: 12 }, (_, index) => ({ id: `F${index + 1}`, highlighted: index === 1 })),
  dupe: false, countryResolved: true, history: "K1ABC United States", columns: [],
  score: { qsos: 0, points: 0, countries: 0, zones: 0, total: 0 },
  fields: [
    ["callsign", "Call", true, ""], ["sent", "SNT", true, "599"], ["receive", "RCV", true, "599"],
    ["other_1", "Sent CQ Zone", false, "15"], ["other_2", "CQ Zone", true, ""],
  ].map(([id, label, visible, value]) => ({ id, label, accessibleName: label, visible, value: values[id as string] ?? value, readOnly: false, enabled: true })),
});

it("creates a Python CQ WW session and logs through the actual-host wire", async () => {
  let current = projection(), logged: Record<string, unknown> | null = null;
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    let result: any;
    if (method === "contest_catalog") result = { plugins: [{ id: "cq_ww_cw", name: "CQ WW CW", engine: "not1mm-python" }] };
    else if (method === "contest_sessions") result = { sessions: [] };
    else if (method === "contest_create") result = { sessionID: current.sessionID, revision: 1, projection: current, actions: [], messages: [] };
    else if (method === "contest_log_page") result = { rows: [], total: 0, revision: current.revision };
    else if (method === "contest_score") result = { score: current.score, matrices: { countries: [], zones: [] }, revision: current.revision };
    else if (method === "contest_draft_apply" || method === "contest_focus") {
      const values = method === "contest_draft_apply" ? params.fields as Record<string, string> :
        Object.fromEntries(current.fields.map(field => [field.id, field.value]));
      current = { ...projection(current.revision + 1, values), focus: method === "contest_focus" ? String(params.field) : current.focus };
      result = { projection: current, actions: [], messages: [] };
    }
    else if (method === "contest_qso_commit") { logged = params; current = projection(current.revision + 1); result = { projection: current, actions: [], messages: [] }; }
    else throw new Error(`Unexpected ${method}`);
    return { id: crypto.randomUUID(), ok: true, result };
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} stationCall="OM0RX" radioFrequencyHz={14_025_000} spots={[]} cluster={null}/>);
  await screen.findByRole("heading", { name: "New contest" });
  await userEvent.click(screen.getByRole("button", { name: "Create and open" }));
  const call = await screen.findByLabelText("Call"), zone = screen.getByLabelText("CQ Zone");
  fireEvent.change(call, { target: { value: "k1abc" } }); fireEvent.change(zone, { target: { value: "5" } });
  await userEvent.click(screen.getByRole("button", { name: "Log Now" }));
  await waitFor(() => expect(logged).not.toBeNull());
  expect(logged).toMatchObject({ sessionID: current.sessionID, fields: { callsign: "K1ABC", other_2: "5" }, frequencyHz: 14025000 });
  expect(screen.getByText("Shared bandmap")).toBeTruthy();
  expect(screen.getByText("Shared cluster")).toBeTruthy();
});

it("sends one native ESM operation with buffered fields and accepts its confirmed log even when CW fails", async () => {
  let current = projection();
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    let result: any;
    if (method === "contest_catalog") result = { plugins: [{ id:"cq_ww_cw", name:"CQ WW CW" }] };
    else if (method === "contest_sessions") result = { sessions:[] };
    else if (method === "contest_create") result = { sessionID:current.sessionID, projection:current };
    else if (method === "contest_log_page") result = { rows:[], total:0 };
    else if (method === "contest_score") result = { score:current.score, matrices:{countries:[],zones:[]} };
    else if (method === "contest_draft_apply" || method === "contest_focus") {
      const values = method === "contest_draft_apply" ? params.fields as Record<string, string> :
        Object.fromEntries(current.fields.map(field => [field.id, field.value]));
      current = { ...projection(current.revision + 1, values), focus: method === "contest_focus" ? String(params.field) : current.focus };
      result = { projection:current, actions:[], messages:[] };
    }
    else throw new Error(`Unexpected renderer request ${method}`);
    return { id:crypto.randomUUID(), ok:true, result };
  });
  let settle!:()=>void;
  const gate = new Promise<void>(resolve=>{settle=resolve;});
  nativeCW.execute.mockImplementation(async params => {
    await gate;
    current = projection(2);
    return { error:"CW acknowledgement was lost; use Stop.", contestResult:{ operationID:params.operationID,
      projection:current, actions:[{kind:"function_key",key:"F2",fields:{callsign:"K1ABC"}}] } };
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} stationCall="OM0RX" radioFrequencyHz={14_025_000} spots={[]} cluster={null}/>);
  await userEvent.click(await screen.findByRole("button", {name:"Create and open"}));
  const call = await screen.findByLabelText("Call"), zone = screen.getByLabelText("CQ Zone");
  fireEvent.change(call,{target:{value:"k1abc"}}); fireEvent.focus(zone); fireEvent.change(zone,{target:{value:"5"}});
  await waitFor(()=>expect(request.mock.calls.some(([method])=>method === "contest_focus")).toBe(true));
  fireEvent.keyDown(zone,{key:"Enter"});
  await waitFor(()=>expect(nativeCW.execute).toHaveBeenCalledTimes(1));
  fireEvent.keyDown(screen.getByRole("form",{name:"CQ WW CW entry"}),{key:"Escape"});
  expect(nativeCW.stop).toHaveBeenCalledTimes(1);
  settle();
  await screen.findByText("CW acknowledgement was lost; use Stop.");
  expect(nativeCW.execute).toHaveBeenCalledTimes(1);
  expect(nativeCW.execute.mock.calls[0][0]).toMatchObject({operation:"esm",sessionID:current.sessionID,
    draftID:current.draftID,fields:{callsign:"K1ABC",other_2:"5"},field:"other_2"});
  expect((screen.getByLabelText("Call") as HTMLInputElement).value).toBe("");
  expect(request.mock.calls.some(([method])=>method === "contest_esm")).toBe(false);
});

it("pages past QSO 100 and sends the complete correction contract", async () => {
  let current = projection(), corrected: Record<string, unknown> | null = null;
  const row = { ID:"qso-001", TS:"2026-10-19 08:00:00", Call:"DL1ABC", Freq:14025, Band:14,
    Mode:"CW", SNT:"599", RCV:"599", SentNr:15, ZN:14, Operator:"OM0RX", Points:1, CountryPrefix:"DL" };
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    let result: any;
    if (method === "contest_catalog") result = { plugins:[{id:"cq_ww_cw",name:"CQ WW CW"}] };
    else if (method === "contest_sessions") result = { sessions:[] };
    else if (method === "contest_create") result = { projection:current };
    else if (method === "contest_log_page") {
      const offset = Number(params.offset ?? 0);
      result = { rows:offset === 100 ? [row] : [], offset, limit:100, total:101 };
    } else if (method === "contest_score") result = { score:current.score, matrices:{countries:[],zones:[]} };
    else if (method === "contest_qso_correct") {
      corrected = params; current = projection(current.revision + 1); result = { projection:current, actions:[], messages:[] };
    } else throw new Error(`Unexpected ${method}`);
    return { id:crypto.randomUUID(), ok:true, result };
  });
  render(<Not1MMContestWorkspace request={request} serviceRequest={request} stationCall="OM0RX" radioFrequencyHz={14_025_000} spots={[]} cluster={null}/>);
  await userEvent.click(await screen.findByRole("button", {name:"Create and open"}));
  expect(await screen.findByText("101 contacts in the Python-owned DXLOG store.")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", {name:"Older"}));
  await userEvent.click(await screen.findByRole("button", {name:"Edit DL1ABC"}));
  fireEvent.change(screen.getByLabelText("UTC timestamp"), {target:{value:"2026-10-19 09:15:30"}});
  fireEvent.change(screen.getByLabelText("Frequency MHz"), {target:{value:"7.025"}});
  fireEvent.change(screen.getByLabelText("Operator"), {target:{value:"om0rx/p"}});
  fireEvent.change(screen.getByLabelText("Sent report"), {target:{value:"579"}});
  fireEvent.change(screen.getByLabelText("Received report"), {target:{value:"589"}});
  fireEvent.change(screen.getByLabelText("Sent CQ zone"), {target:{value:"16"}});
  fireEvent.change(screen.getByLabelText("Received CQ zone"), {target:{value:"14"}});
  await userEvent.click(screen.getByRole("button", {name:"Save correction"}));
  await waitFor(()=>expect(corrected).not.toBeNull());
  expect(corrected).toMatchObject({qsoID:"qso-001",timestamp:"2026-10-19 09:15:30",frequencyHz:7_025_000,
    operator:"OM0RX/P",fields:{callsign:"DL1ABC",sent:"579",receive:"589",other_1:"16",other_2:"14"}});
});

import { describe, expect, it } from "vitest";
import { contestSurfacePanelIDs, validContestSurfaceProjection, validateContestSurfaceActionEnvelope } from "./contestSurfaceProtocol";

const base = { operatingContext: "00000000-0000-4000-8000-000000000001", scope: "contesting",
  sessionID: "00000000-0000-4000-8000-000000000002", workspaceGeneration: "00000000-0000-4000-8000-000000000003",
  projectionRevision: 4, requestID: "00000000-0000-4000-8000-000000000004" } as const;
const draft = { draftID: "draft-1", expectedDraftRevision: 5 };
const spot = {id:"spot-1",receivedAt:1,clusterName:"SK6AW",spotter:"K1ABC",spotterContinent:null,frequencyKHz:14025,
  frequencyText:"14025.0",callsign:"DL1ABC",comment:"CQ",band:"20m",mode:"CW",country:"Germany",adif:230,continent:"EU",
  cqZone:14,ituZone:28,callStatus:"New",dxccStatus:"New",workedBefore:null,specialTags:[],score:80,scoreReasons:[],
  aggregateCount:1,aggregateSpotters:["K1ABC"],source:"DX Cluster",statusHex:"",bandHex:"",modeHex:""};

it.each(["band-maps","dx-cluster"] as const)("validates fenced %s spot selection and bounded projections",panelID=>{
  const action={...base,panelID,action:"spot_select",params:{...draft,spotID:spot.id}};
  expect(()=>validateContestSurfaceActionEnvelope(action)).not.toThrow();
  expect(()=>validateContestSurfaceActionEnvelope({...action,params:{...action.params,spotID:"x".repeat(129)}})).toThrow();
  const projection={schemaVersion:1,status:"ready",draftID:"draft-1",draftRevision:5,radioFrequencyHz:14_025_000,
    connectedClusters:1,loadedSpots:1,spots:[spot],busy:false};
  expect(validContestSurfaceProjection(panelID,projection)).toBe(true);
  expect(validContestSurfaceProjection(panelID,{...projection,spots:[spot,{...spot}]})).toBe(false);
});
it.each(["log", "cluster"])("validates bounded %s candidate selection and projections", kind => {
  const action = {...base, panelID:"callsign-intelligence", action:"assistance_select", params:{...draft,kind,candidateID:`${kind}:K1ABC`}};
  expect(() => validateContestSurfaceActionEnvelope(action)).not.toThrow();
  expect(() => validateContestSurfaceActionEnvelope({...action,params:{...action.params,candidateID:"x".repeat(161)}})).toThrow();
  const key = kind === "log" ? "loggedCandidates" : "clusterCandidates";
  const candidates = [{candidateID:`${kind}:K1ABC`,callsign:"K1ABC"}];
  expect(validContestSurfaceProjection("callsign-intelligence",{...checkProjection,[key]:candidates})).toBe(true);
  for (const invalid of [[...candidates,...candidates], [{callsign:"K1ABC"}], [{...candidates[0],callsign:"bad call"}], Array(501).fill(candidates[0])])
    expect(validContestSurfaceProjection("callsign-intelligence",{...checkProjection,[key]:invalid})).toBe(false);
});
const qso = { qsoID: "qso-1" };

it("validates exact plugin-owned log columns and rejects mixed or ragged rows",()=>{
  const columns=["Call","RcvNr","CK","Prec","Sect","PTS"];
  const pageRow={qsoID:"qso-1",workedAt:"2026-10-20T12:00:00.000Z",callsign:"K1ABC",band:"20m",mode:"CW",
    sentExchange:"1",receivedExchange:"123 A K1ABC 67 CT",points:2,multiplierLabels:["CT"]};
  const projection={schemaVersion:1,status:"ready",sessionRevision:1,canExportCabrillo:true,exchangeLayout:"plugin",
    pluginColumns:columns,pluginRows:[{qsoID:"qso-1",values:["K1ABC","123","67","A","CT","2"]}],pluginPartialRows:[],
    page:{offset:0,limit:20,total:1,rows:[pageRow]},editing:null,busy:false};
  expect(validContestSurfaceProjection("logbook",projection)).toBe(true);
  expect(validContestSurfaceProjection("logbook",{...projection,manualRows:[]})).toBe(false);
  expect(validContestSurfaceProjection("logbook",{...projection,pluginRows:[{qsoID:"qso-1",values:["K1ABC"]}]})).toBe(false);
  expect(validContestSurfaceProjection("logbook",{...projection,pluginRows:[{...projection.pluginRows[0],qsoID:"other"}]})).toBe(false);
  for(const pluginColumns of [["RcvNr","PTS"],["Call","Call"],[" Call","PTS"]])
    expect(validContestSurfaceProjection("logbook",{...projection,pluginColumns,pluginRows:[],
      page:{...projection.page,total:0,rows:[]}})).toBe(false);
});

const valid = [
  { panelID: "active-qso", action: "entry_set_text", params: { ...draft, field: "callsign", value: "OM0RX" } },
  { panelID: "active-qso", action: "entry_set_exchange", params: { ...draft, fieldID: "power", value: "KI" } },
  { panelID: "active-qso", action: "entry_set_frequency_text", params: { ...draft, value: "14.025A" } },
  { panelID: "active-qso", action: "entry_set_band", params: { ...draft, value: "20m" } },
  { panelID: "active-qso", action: "entry_set_mode", params: { ...draft, value: "CW" } },
  { panelID: "active-qso", action: "entry_reserve_serial", params: draft },
  { panelID: "active-qso", action: "entry_commit", params: draft },
  { panelID: "active-qso", action: "entry_clear", params: draft },
  { panelID: "active-qso", action: "entry_step_spot", params: { ...draft, direction: "previous" } },
  { panelID: "active-qso", action: "entry_operator_arm", params: { ...draft, armed: true } },
  { panelID: "active-qso", action: "entry_operator_style", params: { ...draft, value: "search-and-pounce" } },
  { panelID: "active-qso", action: "entry_set_cw_speed", params: { ...draft, value: 27 } },
  { panelID: "active-qso", action: "entry_focus", params: { ...draft, fieldID: "receive" } },
  { panelID: "active-qso", action: "entry_operator_key", params: { ...draft, key: "F12", focusedField: null } },
  { panelID: "callsign-intelligence", action: "assistance_query", params: { ...draft, inputCallsign: "OM0" } },
  { panelID: "callsign-intelligence", action: "assistance_select", params: { ...draft, kind: "history", candidateID: "history-1" } },
  { panelID: "logbook", action: "log_page", params: { offset: 20 } },
  { panelID: "logbook", action: "log_export_cabrillo", params: {} },
  { panelID: "logbook", action: "log_edit_begin", params: qso },
  { panelID: "logbook", action: "log_edit_cancel", params: qso },
  { panelID: "logbook", action: "log_edit_set_text", params: { ...qso, field: "correctionReason", value: "Corrected from paper log" } },
  { panelID: "logbook", action: "log_edit_set_exchange", params: { ...qso, fieldID: "zone", value: "15" } },
  { panelID: "logbook", action: "log_edit_set_frequency_text", params: { ...qso, value: "14.025A" } },
  { panelID: "logbook", action: "log_edit_set_band", params: { ...qso, value: "20m" } },
  { panelID: "logbook", action: "log_edit_confirm_delete", params: { ...qso, confirmed: true } },
  { panelID: "logbook", action: "log_edit_save", params: { ...qso, expectedSessionRevision: 6 } },
  { panelID: "logbook", action: "log_edit_delete", params: { ...qso, expectedSessionRevision: 6 } },
] as const;
const validAction = (action: string) => valid.find(item => item.action === action)!;

describe("contest native surface action v1", () => {
  it("admits every bounded typed action with its owning panel", () => {
    for (const action of valid) expect(() => validateContestSurfaceActionEnvelope({ ...base, ...action })).not.toThrow();
  });

  it.each([
    { ...base, ...valid[0], workspaceGeneration: 3 },
    { ...base, ...valid[0], workspaceGeneration: "00000000-0000-4000-8000-00000000000A" },
    { ...base, ...valid[0], projectionRevision: true },
    { ...base, ...valid[0], action: ["entry_set_text"] },
    { ...base, ...valid[0], panelID: ["active-qso"] },
    { ...base, ...valid[0], panelID: "logbook" },
    { ...base, ...valid[0], extra: true },
    { ...base, ...valid[0], params: null },
    { ...base, panelID: "active-qso", action: "entry_unknown", params: draft },
    { ...base, ...valid[0], params: { ...valid[0].params, field: ["callsign"] } },
    { ...base, ...validAction("entry_operator_key"), params: { ...validAction("entry_operator_key").params, key: ["F12"] } },
    { ...base, ...validAction("assistance_select"), params: { ...validAction("assistance_select").params, kind: ["history"] } },
    { ...base, ...validAction("entry_focus"), params: { ...validAction("entry_focus").params, fieldID: "band" } },
    { ...base, ...validAction("entry_set_cw_speed"), params: { ...validAction("entry_set_cw_speed").params, value: 101 } },
    { ...base, ...valid[1], params: { ...valid[1].params, fieldID: "x".repeat(65) } },
    { ...base, ...valid[1], params: { ...valid[1].params, fieldID: "   " } },
    { ...base, ...valid[1], params: { ...valid[1].params, value: "😀".repeat(257) } },
    { ...base, ...valid[2], params: { ...valid[2].params, value: "1".repeat(12) } },
    { ...base, ...validAction("log_edit_set_exchange"), params: { ...validAction("log_edit_set_exchange").params, value: "😀".repeat(257) } },
    { ...base, ...validAction("log_page"), params: { offset: 1_000_001 } },
  ])("rejects malformed, cross-panel or over-bound envelopes %#", envelope => {
    expect(() => validateContestSurfaceActionEnvelope(envelope)).toThrow("could not be verified");
  });
});

const receivedField = { id: "section", label: "Section", value: "DX", required: true, maximumUTF8Bytes: 8 };
const entryProjection = { schemaVersion: 1, status: "ready", session: { name: "ARRL DX", ruleName: "ARRL DX CW", mode: "CW" },
  draft: { draftID: "draft-1", revision: 5, callsign: "OM0RX", sentReport: "599", receivedReport: "599",
    receivedFields: [receivedField], frequencyHz: 14_025_000, frequencyText: "14.025A", frequencyError: "Use digits only",
    band: "20m", mode: "CW", dupe: { state: "clear", reason: "" }, validation: { errors: [], warnings: [] }, reservedSerial: null },
  busy: false, dirty: true, uncertain: false } as const;
const entryProjectionV2 = { ...entryProjection, schemaVersion: 2,
  descriptor: { bands: ["20m", "40m"], modes: ["CW"], advanceOnSpace: ["callsign", "sent", "receive", "other_1", "other_2"],
    sentFields: [{ id: "serial", label: "Serial", value: "001", required: true, maximumUTF8Bytes: 8 }],
    serial: { requirement: "requiredForCommit", allocatedFieldID: "serial", reservedSerial: null } },
  operator: { output: "simulation-only", armed: true, style: "run", status: "armed", pending: null,
    focusedField: "callsign",
    tabNext: { callsign: "sent", sent: "receive", receive: "other_1", other_1: "other_2", other_2: "callsign" },
    tabPrevious: { callsign: "other_2", sent: "callsign", receive: "sent", other_1: "receive", other_2: "other_1" },
    functionKeys: [{ key: "F1", macro: "CQ" }, { key: "F2", macro: "EXCH" }],
    readiness: { canSendCQ: true, canSendCall: true, canSendDuplicate: false, canReserveCall: true,
      canReserveCommit: true, canCommit: false },
    trace: [{ operationID: "simulation-1", mode: "CW", macro: "CQ", text: "CQ OM0RX", status: "confirmed" }] } } as const;
const checkProjection = { schemaVersion: 1, status: "ready", draftID: "draft-1", draftRevision: 5, inputCallsign: "OM0",
  scp: { source: "master.scp", candidates: [{ candidateID: "scp:OM0RX", callsign: "OM0RX" }] },
  history: { source: "session", rows: [{ candidateID: "history:qso-1", callsign: "OM0RX",
    fields: [{ id: "section", label: "Section", value: "DX" }] }] }, busy: false } as const;
const statisticsProjection = { schemaVersion: 1, status: "ready", score: { qsos: 6, points: 21, multipliers: 8, claimedScore: 168,
  multiplierLabels: ["K", "W"], multiplierDisplayLabels: ["United States", "United States"], sourceVerification: "verified" }, busy: false } as const;
const statisticsProjectionV3 = { schemaVersion: 3, status: "ready", score: { qsos: 6, points: 21, multipliers: 8, claimedScore: 168,
  multiplierLabels: ["K", "W"], multiplierDisplayLabels: ["United States", "United States"], sourceVerification: "verified" },
  rows: [{ band: "20m", qsos: 4, calls: 3, cw: 2, phone: 1, digital: 1, wpx: 2, points: 15 },
    { band: "40m", qsos: 2, calls: 2, cw: 2, phone: 0, digital: 0, wpx: 1, points: 6 }],
  total: { band: "TOTAL", qsos: 6, calls: 4, cw: 4, phone: 1, digital: 1, wpx: 3, points: 21 }, busy: false } as const;
const ratesProjection = { schemaVersion: 1, status: "ready", lastHourQsoPerHour: 48, last10QsoPerHour: 72.5,
  last100QsoPerHour: null, sinceHourUTC: 19, sinceHourQso: 2, runQso: 210, searchAndPounceQso: 70, hourRunQso: 30,
  hourSearchAndPounceQso: 18, busy: false } as const;
const matrixProjection = { schemaVersion: 1, status: "ready", title: "DXCC", bands: ["20m", "40m"],
  rows: [{ label: "Slovakia", counts: { "20m": 2, "40m": 0 }, total: 2 }], total: 1, busy: false };
const matrixProjectionV2 = { schemaVersion: 4, status: "ready", title: "CQ Zones", tracker: "zone", zoneSystem: "cq",
  current: { dxcc: "Slovakia", cqZone: 15, ituZone: 28 }, bands: ["20m", "40m"],
  rows: [{ label: "15", counts: { "20m": 2, "40m": 0 }, total: 2 }], total: 1, busy: false };
const logProjection = { schemaVersion: 1, status: "ready", sessionRevision: 7, canExportCabrillo: true, page: { offset: 0, limit: 20, total: 1,
  rows: [{ qsoID: "qso-1", workedAt: "2026-10-18T00:00:00.000Z", callsign: "K1ABC", band: "20m", mode: "CW",
    sentExchange: "599 100", receivedExchange: "599 MA", points: 3, multiplierLabels: ["K"] }] },
  editing: { qsoID: "qso-1", workedAt: "2026-10-19T10:00:00Z", operator: "OM0RX", callsign: "K1ABC", band: "20m", mode: "CW", sentReport: "599", receivedReport: "599",
    receivedFields: [receivedField], frequencyHz: 14_025_000, editFrequencyText: "14.025A", frequencyError: "Use digits only",
    correctionReason: "", confirmDelete: false, deletionReason: "" }, busy: false } as const;

describe("contest native surface projection v1", () => {
  it("admits every ready projection only for its owning panel and exact unavailable projections for all roles", () => {
    expect(validContestSurfaceProjection("active-qso", entryProjection)).toBe(true);
    expect(validContestSurfaceProjection("active-qso", entryProjectionV2)).toBe(true);
    expect(validContestSurfaceProjection("callsign-intelligence", checkProjection)).toBe(true);
    expect(validContestSurfaceProjection("propagation", statisticsProjection)).toBe(true);
    expect(validContestSurfaceProjection("propagation", statisticsProjectionV3)).toBe(true);
    expect(validContestSurfaceProjection("logbook", logProjection)).toBe(true);
    expect(validContestSurfaceProjection("monitor", ratesProjection)).toBe(true);
    expect(validContestSurfaceProjection("awards", matrixProjection)).toBe(true);
    expect(validContestSurfaceProjection("chaser-dx", { ...matrixProjection, title: "Zone" })).toBe(true);
    expect(validContestSurfaceProjection("chaser-dx", matrixProjectionV2)).toBe(true);
    expect(validContestSurfaceProjection("propagation", ratesProjection)).toBe(false);
    expect(validContestSurfaceProjection("monitor", matrixProjection)).toBe(false);
    for (const panelID of contestSurfacePanelIDs)
      expect(validContestSurfaceProjection(panelID, { schemaVersion: 1, status: "unavailable" })).toBe(true);
    expect(validContestSurfaceProjection("logbook", entryProjection)).toBe(false);
  });

  it.each([
    { ...statisticsProjectionV3, extra: true },
    { ...statisticsProjectionV3, rows: [...statisticsProjectionV3.rows, { ...statisticsProjectionV3.rows[0] }] },
    { ...statisticsProjectionV3, rows: [{ ...statisticsProjectionV3.rows[0], calls: 5 }, statisticsProjectionV3.rows[1]] },
    { ...statisticsProjectionV3, total: { ...statisticsProjectionV3.total, qsos: 7 } },
    { ...statisticsProjectionV3, total: { ...statisticsProjectionV3.total, calls: 6 } },
    { ...statisticsProjectionV3, score: { ...statisticsProjectionV3.score, points: 20 } },
    { ...statisticsProjectionV3, rows: Array.from({ length: 65 }, (_, index) => ({
      band: `${index}m`, qsos: 0, calls: 0, cw: 0, phone: 0, digital: 0, wpx: 0, points: 0 })),
      total: { band: "TOTAL", qsos: 0, calls: 0, cw: 0, phone: 0, digital: 0, wpx: 0, points: 0 },
      score: { ...statisticsProjectionV3.score, qsos: 0, points: 0 } },
  ])("rejects malformed Statistics v3 projection %#", value => {
    expect(validContestSurfaceProjection("propagation", value)).toBe(false);
  });

  it.each([
    { panelID: "active-qso", value: { ...entryProjection, extra: true } },
    { panelID: "active-qso", value: { ...entryProjection, draft: { ...entryProjection.draft, frequencyText: "😀😀😀" } } },
    { panelID: "active-qso", value: { ...entryProjection, draft: { ...entryProjection.draft, revision: true } } },
    { panelID: "callsign-intelligence", value: { ...checkProjection, scp: { ...checkProjection.scp,
      candidates: [{ callsign: "OM0RX" }] } } },
    { panelID: "callsign-intelligence", value: { ...checkProjection, history: { ...checkProjection.history,
      rows: [{ ...checkProjection.history.rows[0], candidateID: "   " }] } } },
    { panelID: "propagation", value: { ...statisticsProjection, score: { ...statisticsProjection.score, multiplierDisplayLabels: null } } },
    { panelID: "propagation", value: { ...statisticsProjection, score: { ...statisticsProjection.score,
      multiplierLabels: Array.from({ length: 10_001 }, () => "K") } } },
    { panelID: "logbook", value: { ...logProjection, page: { ...logProjection.page,
      rows: [{ ...logProjection.page.rows[0], workedAt: "2026-10-18" }] } } },
  ] as const)("rejects malformed or over-bound $panelID projections %#", ({ panelID, value }) => {
    expect(validContestSurfaceProjection(panelID, value)).toBe(false);
  });

  it.each([
    { ...ratesProjection, lastHourQsoPerHour: Infinity },
    { ...ratesProjection, last10QsoPerHour: -1 },
    { ...ratesProjection, sinceHourUTC: -1 },
    { ...ratesProjection, sinceHourUTC: 1.5 },
    { ...ratesProjection, sinceHourUTC: 24 },
    { ...ratesProjection, sinceHourQso: -1 },
    { ...ratesProjection, runQso: 1.5 },
    { ...ratesProjection, sinceHourUTC: undefined, sinceMinuteQsoPerHour: 120 },
    { ...ratesProjection, extra: "log-page inference" },
  ])("rejects invalid owner rates %#", value => expect(validContestSurfaceProjection("monitor", value)).toBe(false));

  it.each([
    { ...matrixProjection, bands: ["20m", "20m"] },
    { ...matrixProjection, rows: [{ label: "Slovakia", counts: { "20m": 2 }, total: 2 }] },
    { ...matrixProjection, rows: [{ label: "Slovakia", counts: { "20m": 2, "40m": 0, "80m": 1 }, total: 3 }] },
    { ...matrixProjection, rows: [{ label: "Slovakia", counts: { "20m": -1, "40m": 0 }, total: 0 }] },
    { ...matrixProjection, rows: [matrixProjection.rows[0], matrixProjection.rows[0]] },
  ])("rejects ambiguous or malformed matrix cells %#", value => expect(validContestSurfaceProjection("awards", value)).toBe(false));

  it.each([
    { ...matrixProjectionV2, zoneSystem: null },
    { ...matrixProjectionV2, tracker: "dxcc", zoneSystem: "cq" },
    { ...matrixProjectionV2, current: { ...matrixProjectionV2.current, cqZone: 91 } },
    { ...matrixProjectionV2, current: { ...matrixProjectionV2.current, extra: true } },
  ])("rejects malformed current-target matrices %#", value => expect(validContestSurfaceProjection("chaser-dx", value)).toBe(false));

  it.each([
    { ...entryProjectionV2, descriptor: { ...entryProjectionV2.descriptor, bands: ["20m", "20m"] } },
    { ...entryProjectionV2, descriptor: { ...entryProjectionV2.descriptor,
      serial: { ...entryProjectionV2.descriptor.serial, allocatedFieldID: "missing" } } },
    { ...entryProjectionV2, descriptor: { ...entryProjectionV2.descriptor,
      serial: { ...entryProjectionV2.descriptor.serial, reservedSerial: 1 } } },
    { ...entryProjectionV2, descriptor: { ...entryProjectionV2.descriptor,
      sentFields: [{ ...entryProjectionV2.descriptor.sentFields[0], maximumUTF8Bytes: 2, value: "001" }] } },
    { ...entryProjectionV2, descriptor: { ...entryProjectionV2.descriptor, advanceOnSpace: ["callsign", "callsign"] } },
    { ...entryProjectionV2, descriptor: { ...entryProjectionV2.descriptor, advanceOnSpace: ["band"] } },
    { ...entryProjectionV2, operator: { ...entryProjectionV2.operator,
      functionKeys: [{ key: "F1", macro: "CQ" }, { key: "F1", macro: "EXCH" }] } },
    { ...entryProjectionV2, operator: { ...entryProjectionV2.operator,
      trace: Array.from({ length: 25 }, (_, index) => ({ ...entryProjectionV2.operator.trace[0], operationID: `simulation-${index}` })) } },
    { ...entryProjectionV2, operator: { ...entryProjectionV2.operator, focusedField: undefined } },
    { ...entryProjectionV2, operator: { ...entryProjectionV2.operator, tabNext: { callsign: "band" } } },
    { ...entryProjectionV2, schemaVersion: 1 },
  ])("rejects inconsistent or over-bound Entry v2 projections %#", value => {
    expect(validContestSurfaceProjection("active-qso", value)).toBe(false);
  });
});

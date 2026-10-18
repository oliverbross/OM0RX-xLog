import { describe, expect, it } from "vitest";
import { contestSurfacePanelIDs, validContestSurfaceProjection, validateContestSurfaceActionEnvelope } from "./contestSurfaceProtocol";

const base = { operatingContext: "00000000-0000-4000-8000-000000000001", scope: "contesting",
  sessionID: "00000000-0000-4000-8000-000000000002", workspaceGeneration: "00000000-0000-4000-8000-000000000003",
  projectionRevision: 4, requestID: "00000000-0000-4000-8000-000000000004" } as const;
const draft = { draftID: "draft-1", expectedDraftRevision: 5 };
const qso = { qsoID: "qso-1" };
const valid = [
  { panelID: "active-qso", action: "entry_set_text", params: { ...draft, field: "callsign", value: "OM0RX" } },
  { panelID: "active-qso", action: "entry_set_exchange", params: { ...draft, fieldID: "power", value: "KI" } },
  { panelID: "active-qso", action: "entry_set_frequency_text", params: { ...draft, value: "14.025A" } },
  { panelID: "active-qso", action: "entry_set_band", params: { ...draft, value: "20m" } },
  { panelID: "active-qso", action: "entry_set_mode", params: { ...draft, value: "CW" } },
  { panelID: "active-qso", action: "entry_reserve_serial", params: draft },
  { panelID: "active-qso", action: "entry_commit", params: draft },
  { panelID: "active-qso", action: "entry_operator_arm", params: { ...draft, armed: true } },
  { panelID: "active-qso", action: "entry_operator_style", params: { ...draft, value: "search-and-pounce" } },
  { panelID: "active-qso", action: "entry_operator_key", params: { ...draft, key: "F12", focusedField: null } },
  { panelID: "callsign-intelligence", action: "assistance_query", params: { ...draft, inputCallsign: "OM0" } },
  { panelID: "callsign-intelligence", action: "assistance_select", params: { ...draft, kind: "history", candidateID: "history-1" } },
  { panelID: "logbook", action: "log_page", params: { offset: 20 } },
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
    { ...base, ...valid[9], params: { ...valid[9].params, key: ["F12"] } },
    { ...base, ...valid[11], params: { ...valid[11].params, kind: ["history"] } },
    { ...base, ...valid[1], params: { ...valid[1].params, fieldID: "x".repeat(65) } },
    { ...base, ...valid[1], params: { ...valid[1].params, fieldID: "   " } },
    { ...base, ...valid[1], params: { ...valid[1].params, value: "😀".repeat(257) } },
    { ...base, ...valid[2], params: { ...valid[2].params, value: "1".repeat(12) } },
    { ...base, ...valid[17], params: { ...valid[17].params, value: "😀".repeat(3) } },
    { ...base, ...valid[12], params: { offset: 1_000_001 } },
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
  descriptor: { bands: ["20m", "40m"], modes: ["CW"],
    sentFields: [{ id: "serial", label: "Serial", value: "001", required: true, maximumUTF8Bytes: 8 }],
    serial: { requirement: "requiredForCommit", allocatedFieldID: "serial", reservedSerial: null } },
  operator: { output: "simulation-only", armed: true, style: "run", status: "armed", pending: null,
    focusedField: "callsign",
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
const logProjection = { schemaVersion: 1, status: "ready", sessionRevision: 7, page: { offset: 0, limit: 20, total: 1,
  rows: [{ qsoID: "qso-1", workedAt: "2026-10-18T00:00:00.000Z", callsign: "K1ABC", band: "20m", mode: "CW",
    sentExchange: "599 100", receivedExchange: "599 MA", points: 3, multiplierLabels: ["K"] }] },
  editing: { qsoID: "qso-1", callsign: "K1ABC", band: "20m", mode: "CW", sentReport: "599", receivedReport: "599",
    receivedFields: [receivedField], frequencyHz: 14_025_000, editFrequencyText: "14.025A", frequencyError: "Use digits only",
    correctionReason: "", confirmDelete: false, deletionReason: "" }, busy: false } as const;

describe("contest native surface projection v1", () => {
  it("admits every ready projection only for its owning panel and exact unavailable projections for all roles", () => {
    expect(validContestSurfaceProjection("active-qso", entryProjection)).toBe(true);
    expect(validContestSurfaceProjection("active-qso", entryProjectionV2)).toBe(true);
    expect(validContestSurfaceProjection("callsign-intelligence", checkProjection)).toBe(true);
    expect(validContestSurfaceProjection("propagation", statisticsProjection)).toBe(true);
    expect(validContestSurfaceProjection("logbook", logProjection)).toBe(true);
    for (const panelID of contestSurfacePanelIDs)
      expect(validContestSurfaceProjection(panelID, { schemaVersion: 1, status: "unavailable" })).toBe(true);
    expect(validContestSurfaceProjection("logbook", entryProjection)).toBe(false);
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
    { ...entryProjectionV2, descriptor: { ...entryProjectionV2.descriptor, bands: ["20m", "20m"] } },
    { ...entryProjectionV2, descriptor: { ...entryProjectionV2.descriptor,
      serial: { ...entryProjectionV2.descriptor.serial, allocatedFieldID: "missing" } } },
    { ...entryProjectionV2, descriptor: { ...entryProjectionV2.descriptor,
      serial: { ...entryProjectionV2.descriptor.serial, reservedSerial: 1 } } },
    { ...entryProjectionV2, descriptor: { ...entryProjectionV2.descriptor,
      sentFields: [{ ...entryProjectionV2.descriptor.sentFields[0], maximumUTF8Bytes: 2, value: "001" }] } },
    { ...entryProjectionV2, operator: { ...entryProjectionV2.operator,
      functionKeys: [{ key: "F1", macro: "CQ" }, { key: "F1", macro: "EXCH" }] } },
    { ...entryProjectionV2, operator: { ...entryProjectionV2.operator,
      trace: Array.from({ length: 25 }, (_, index) => ({ ...entryProjectionV2.operator.trace[0], operationID: `simulation-${index}` })) } },
    { ...entryProjectionV2, operator: { ...entryProjectionV2.operator, focusedField: undefined } },
    { ...entryProjectionV2, schemaVersion: 1 },
  ])("rejects inconsistent or over-bound Entry v2 projections %#", value => {
    expect(validContestSurfaceProjection("active-qso", value)).toBe(false);
  });
});

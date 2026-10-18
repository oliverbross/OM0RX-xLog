import { describe, expect, it } from "vitest";
import { validateContestSurfaceActionEnvelope } from "./contestSurfaceProtocol";

const base = { operatingContext: "00000000-0000-4000-8000-000000000001", scope: "contesting",
  sessionID: "00000000-0000-4000-8000-000000000002", workspaceGeneration: "00000000-0000-4000-8000-000000000003",
  projectionRevision: 4, requestID: "00000000-0000-4000-8000-000000000004" } as const;
const draft = { draftID: "draft-1", expectedDraftRevision: 5 };
const qso = { qsoID: "qso-1" };
const valid = [
  { panelID: "active-qso", action: "entry_set_text", params: { ...draft, field: "callsign", value: "OM0RX" } },
  { panelID: "active-qso", action: "entry_set_exchange", params: { ...draft, fieldID: "power", value: "KI" } },
  { panelID: "active-qso", action: "entry_set_frequency", params: { ...draft, value: 14_025_000 } },
  { panelID: "active-qso", action: "entry_set_band", params: { ...draft, value: "20m" } },
  { panelID: "active-qso", action: "entry_set_mode", params: { ...draft, value: "CW" } },
  { panelID: "active-qso", action: "entry_reserve_serial", params: draft },
  { panelID: "active-qso", action: "entry_commit", params: draft },
  { panelID: "active-qso", action: "entry_operator_key", params: { ...draft, key: "F12" } },
  { panelID: "callsign-intelligence", action: "assistance_query", params: { ...draft, inputCallsign: "OM0" } },
  { panelID: "callsign-intelligence", action: "assistance_select", params: { ...draft, kind: "history", candidateID: "history-1" } },
  { panelID: "logbook", action: "log_page", params: { offset: 20 } },
  { panelID: "logbook", action: "log_edit_begin", params: qso },
  { panelID: "logbook", action: "log_edit_cancel", params: qso },
  { panelID: "logbook", action: "log_edit_set_text", params: { ...qso, field: "correctionReason", value: "Corrected from paper log" } },
  { panelID: "logbook", action: "log_edit_set_exchange", params: { ...qso, fieldID: "zone", value: "15" } },
  { panelID: "logbook", action: "log_edit_set_frequency", params: { ...qso, value: 14_025_000 } },
  { panelID: "logbook", action: "log_edit_set_band", params: { ...qso, value: "20m" } },
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
    { ...base, ...valid[7], params: { ...valid[7].params, key: ["F12"] } },
    { ...base, ...valid[9], params: { ...valid[9].params, kind: ["history"] } },
    { ...base, ...valid[1], params: { ...valid[1].params, fieldID: "x".repeat(65) } },
    { ...base, ...valid[1], params: { ...valid[1].params, fieldID: "   " } },
    { ...base, ...valid[1], params: { ...valid[1].params, value: "😀".repeat(257) } },
    { ...base, ...valid[2], params: { ...valid[2].params, value: Number.NaN } },
    { ...base, ...valid[10], params: { offset: 1_000_001 } },
  ])("rejects malformed, cross-panel or over-bound envelopes %#", envelope => {
    expect(() => validateContestSurfaceActionEnvelope(envelope)).toThrow("could not be verified");
  });
});

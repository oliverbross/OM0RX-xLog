import React from "react";
import { createRoot } from "react-dom/client";
import { ContestWorkspace } from "./ContestWorkspace";
import type { ContestDraftSnapshot, ContestFullQSO, ContestRequest, ContestRuleMetadata, ContestSessionSummary } from "./types";

const rule: ContestRuleMetadata = { identity: { id: "cq-ww-cw", version: "2026.1", edition: "2026", sourceRevision: "synthetic-preview" }, displayName: "CQ WW CW", mode: "CW", entryDescriptorVersion: 1, entry: { mode: "CW", adifMode: "CW", cabrilloQSOType: "CW", cabrilloFormatterVersion: "pilot-1", cabrilloProjectionFormatterVersion: "pilot-2", report: { format: "cwRST", defaultSent: "599", defaultReceived: "599", maximumUTF8Bytes: 3 }, exchange: { sent: "cqZone", received: "cqZone", sentDefault: "stationSnapshot", adifFields: "none" }, serial: { requirement: "none", allowedScopes: [] } }, referenceDataVersion: "synthetic-cty", sourceVerification: "provisional", sourceNote: "Local visual fixture" };
const session: ContestSessionSummary = { sessionID: "preview-session", workspaceGeneration: "preview-generation", revision: 3, name: "Visual verification", rule, referenceDataVersion: rule.referenceDataVersion, station: { callsign: "OM0RX", cqZone: "15", dxccEntity: "Slovak Republic" }, operator: { callsign: "OM0RX", category: "Single Operator" }, qsoCount: 1, updatedAt: "2026-10-17T02:00:00Z" };
const draft: ContestDraftSnapshot = { draftID: "preview-draft", sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, revision: session.revision, fields: { callsign: "K1ABC", sentReport: "599", sentExchange: "15", receivedReport: "599", receivedExchange: "05", frequencyHz: 14025000, band: "20m", mode: "CW" }, reservedSerial: null, validation: { errors: [], warnings: [] }, dupe: { state: "clear", reason: "Not worked on 20m." }, updatedAt: session.updatedAt };
const qso = { qsoID: "preview-qso", sessionID: session.sessionID, workedAt: "2026-10-17T01:55:00Z", callsign: "W1AW", band: "20m", mode: "CW" as const, sentExchange: "15", receivedExchange: "05", points: 3, multiplier: "K", isDupe: false };
const fullQSO: ContestFullQSO = {
  qsoID: qso.qsoID, sessionID: session.sessionID, originalUTC: qso.workedAt,
  callsign: qso.callsign, sentReport: "599", sentExchange: "15", normalizedSentExchange: "15",
  receivedReport: "599", receivedExchange: "05", normalizedReceivedExchange: "05",
  frequencyHz: 14_025_000, band: "20m", mode: "CW", allocatedSerial: "15",
  entity: { adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5 },
  operatorCallsign: "OM0RX", stationLocation: "JN98",
  provenance: { source: "operatorEntry", sourceIdentity: rule.referenceDataVersion, importedClaimedScore: null },
  ruleIdentity: rule.identity, referenceDataVersion: rule.referenceDataVersion,
};
let frame = 0;
const request = (async (method, params = {}) => {
  const ok = <T,>(result: T) => ({ id: `preview-${++frame}`, ok: true as const, result });
  if (method === "contest_catalog") return ok({ workspaceGeneration: session.workspaceGeneration, rules: [rule] });
  if (method === "contest_sessions") return ok({ sessions: [session] });
  if (method === "contest_open" || method === "contest_draft_get") return ok({ session, draft });
  if (method === "contest_log_page") return ok({ sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, revision: params.expectedRevision, qsos: [qso], total: 1, offset: params.offset, limit: params.limit });
  if (method === "contest_qso_get") return ok({ sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, revision: params.expectedRevision, qso: fullQSO });
  if (method === "contest_score") return ok({ sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, revision: params.expectedRevision, qsos: 1, points: 3, multipliers: 1, claimedScore: 3, multiplierLabels: ["K"], sourceVerification: "provisional" as const });
  return { id: `preview-${++frame}`, ok: false as const, error: { code: "preview_read_only", message: "The isolated visual fixture is read only.", outcome: "confirmed" as const } };
}) as ContestRequest;

createRoot(document.getElementById("root")!).render(<React.StrictMode><ContestWorkspace request={request} createRequestID={() => "preview-request"} digestPayload={async () => "preview-digest"}/></React.StrictMode>);

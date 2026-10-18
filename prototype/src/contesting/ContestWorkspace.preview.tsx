import React from "react";
import { createRoot } from "react-dom/client";
import "../style.css";
import "../live/live.css";
import { ContestWorkspace } from "./ContestWorkspace";
import type { ContestDraftSnapshot, ContestFullQSO, ContestRequest, ContestRuleMetadata, ContestSessionSummary } from "./types";
import { panelMinimum, workspacePanelIDs, type LayoutSnapshot } from "../live/workspaceLayoutSession";

const SOURCE = "7c8b499225a73f7f8f792246881bd7aefc05452f";
const CAPABILITY_DIGEST = "f068c4cf73ab0b9ec9f77a43c75e6deaca9a11da946fd9c8216b41c925f6cc4e";
const rule: ContestRuleMetadata = { identity: { id: "cq-ww-cw", version: "1.0.0-source-spike", edition: "source-26.10.11", sourceRevision: SOURCE }, displayName: "CQ WW CW", mode: "CW", entryDescriptorVersion: 1, entry: { mode: "CW", adifMode: "CW", cabrilloQSOType: "CW", cabrilloFormatterVersion: "pilot-1", cabrilloProjectionFormatterVersion: "pilot-2", report: { format: "cwRST", defaultSent: "599", defaultReceived: "599", maximumUTF8Bytes: 3 }, exchange: { sent: "cqZone", received: "cqZone", sentDefault: "stationSnapshot", adifFields: "none" }, serial: { requirement: "none", allowedScopes: [] } }, referenceDataVersion: "cty-20261018", sourceVerification: "provisional", sourceNote: "Local visual fixture", operatorCapability: { version: 1, auditDigest: CAPABILITY_DIGEST, policy: "simulated-run-sp-v1", output: "simulation-only", styles: ["run", "search-and-pounce"], macros: ["CQ", "EXCH", "QRZ", "AGN", "HISCALL", "MYCALL", "QSOB4"] } };
const session: ContestSessionSummary = { sessionID: "11111111-1111-4111-8111-111111111111", workspaceGeneration: "22222222-2222-4222-8222-222222222222", revision: 3, name: "Visual verification", rule, referenceDataVersion: rule.referenceDataVersion, station: { callsign: "OM0RX", cqZone: "15", dxccEntity: "Slovak Republic" }, operator: { callsign: "OM0RX", category: "Single Operator" }, qsoCount: 1, updatedAt: "2026-10-17T02:00:00Z" };
const draft: ContestDraftSnapshot = { draftID: "33333333-3333-4333-8333-333333333333", sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, revision: session.revision, fields: { callsign: "K1ABC", sentReport: "599", sentExchange: "15", receivedReport: "599", receivedExchange: "05", frequencyHz: 14025000, band: "20m", mode: "CW" }, reservedSerial: null, validation: { errors: [], warnings: [] }, dupe: { state: "clear", reason: "Not worked on 20m." }, operatorReadiness: { capabilityDigest: CAPABILITY_DIGEST, callsign: "ready", exchange: "ready", canSendCQ: false, canSendCall: true, canSendDuplicate: false, canReserveCall: false, canReserveCommit: false, canCommit: true }, updatedAt: session.updatedAt };
const qso = { qsoID: "44444444-4444-4444-8444-444444444444", sessionID: session.sessionID, workedAt: "2026-10-17T01:55:00.000Z", callsign: "W1AW", band: "20m", mode: "CW" as const, sentExchange: "15", receivedExchange: "05", points: 3, multiplier: "K", isDupe: false };
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
const visible = new Set(["active-qso", "callsign-intelligence", "propagation", "logbook"]);
const layout: LayoutSnapshot = { scope: "contesting", generation: session.workspaceGeneration, revision: 0, document: { version: 2,
  activePresetID: "traditional", presets: [{ id: "traditional", name: "Contest desk", width: 1920, height: 1080, locked: false, snap: true,
    panels: workspacePanelIDs.map((id, z) => { const [width, height] = panelMinimum(id); return { id, z,
      placement: visible.has(id) ? "canvas" as const : "hidden" as const,
      rect: { x: id === "active-qso" ? 0 : id === "propagation" ? 1440 : id === "logbook" ? 720 : 0,
        y: id === "active-qso" ? 540 : 0, width: Math.min(width, 720), height: Math.min(height, 540) } }; }) }] } };
let frame = 0;
const request = (async (method, params = {}) => {
  const ok = <T,>(result: T) => ({ id: `00000000-0000-4000-8000-${String(++frame).padStart(12, "0")}`, ok: true as const, result });
  if ((method as string) === "workspace_layout_load") return ok({ layout });
  if (method === "contest_catalog") return ok({ workspaceGeneration: session.workspaceGeneration, rules: [rule] });
  if (method === "contest_sessions") return ok({ sessions: [session] });
  if (method === "contest_open" || method === "contest_draft_get") return ok({ session, draft });
  if (method === "contest_log_page") return ok({ sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, revision: params.expectedRevision, qsos: [qso], total: 1, offset: params.offset, limit: params.limit });
  if (method === "contest_qso_get") return ok({ sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, revision: params.expectedRevision, qso: fullQSO });
  if (method === "contest_score") return ok({ sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, revision: params.expectedRevision, qsos: 1, points: 3, multipliers: 1, claimedScore: 3, multiplierLabels: ["K"], sourceVerification: "provisional" as const });
  return { id: `00000000-0000-4000-8000-${String(++frame).padStart(12, "0")}`, ok: false as const, error: { code: "preview_read_only", message: "The isolated visual fixture is read only.", outcome: "confirmed" as const } };
}) as ContestRequest;

createRoot(document.getElementById("root")!).render(<React.StrictMode><div className="app live"><header className="station-rail">Station</header>
  <aside className="sidebar">Contesting</aside><ContestWorkspace request={request}
    createRequestID={() => crypto.randomUUID()} digestPayload={async () => "a".repeat(64)}/></div></React.StrictMode>);

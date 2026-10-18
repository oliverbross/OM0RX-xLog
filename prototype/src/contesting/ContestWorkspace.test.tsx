// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import activationFixtureJSON from "../../../docs/contesting/fixtures/declarative-activation-worker-wire.json";
import { ContestWorkspace, projectSCPCallsign, type ContestTransitionController } from "./ContestWorkspace";
import { MemoryContestRecoveryStorage } from "./sessionOwner";
import { isStructuredEntry, type ContestDraftSnapshot, type ContestEntryDescriptorV2, type ContestFullQSO, type ContestQSOChangeResult, type ContestRequest, type ContestRuleMetadata, type ContestSessionSummary } from "./types";
import { reviewedOperatorCapabilityDigest } from "./operatorCapabilities.generated";

const entry = (mode: "CW" | "SSB", serial: boolean, adifFields: "none" | "stxSrx" | "exchangeStrings" = serial ? "stxSrx" : "none"): ContestRuleMetadata["entry"] => ({
  mode, adifMode: mode, cabrilloQSOType: mode === "CW" ? "CW" : "PH",
  cabrilloFormatterVersion: mode === "CW" ? "pilot-1" : "ssb-pilot-1",
  cabrilloProjectionFormatterVersion: mode === "CW" ? "pilot-2" : "ssb-pilot-2",
  report: { format: mode === "CW" ? "cwRST" : "phoneRS", defaultSent: mode === "CW" ? "599" : "59", defaultReceived: mode === "CW" ? "599" : "59", maximumUTF8Bytes: mode === "CW" ? 3 : 2 },
  exchange: { sent: serial ? "serialNumber" : "cqZone", received: serial ? "serialNumber" : "cqZone", sentDefault: serial ? "reservedSerial" : "stationSnapshot", adifFields },
  serial: { requirement: serial ? "requiredForCommit" : "none", allowedScopes: serial ? ["session", "band", "transmitter"] : [] },
});

it("projects an SCP choice onto current fields only and rejects a reset draft",()=>{
  const session=sessions[0], draft=draftFor(session,"K1");
  draft.fields.receivedExchange="99";draft.reservedSerial=42;
  const scope={ownerLeaseID:7,sessionID:session.sessionID,workspaceGeneration:session.workspaceGeneration,draftID:draft.draftID,inputCallsign:"K1"};
  expect(projectSCPCallsign(session,draft,scope,"K1ABC")).toEqual({...draft.fields,callsign:"K1ABC"});
  expect(draft.reservedSerial).toBe(42);
  expect(projectSCPCallsign(session,{...draft,draftID:"next-draft"},scope,"K1ABC")).toBeNull();
});
const rawRules: ContestRuleMetadata[] = [
  { identity: { id: "cq-ww-cw", version: "1.0.0-source-spike", edition: "source-26.10.11", sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f" }, displayName: "CQ WW CW", mode: "CW", entryDescriptorVersion: 1, entry: entry("CW", false), referenceDataVersion: "cty-2026.10", sourceVerification: "provisional", sourceNote: "Pilot comparison pending" },
  { identity: { id: "cq-wpx-cw", version: "1.0.0-source-spike", edition: "source-26.10.11", sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f" }, displayName: "CQ WPX CW", mode: "CW", entryDescriptorVersion: 1, entry: entry("CW", true), referenceDataVersion: "cty-2026.10", sourceVerification: "verified", sourceNote: "Fixture checked" },
  { identity: { id: "cq-ww-ssb", version: "1.0.0-source-spike", edition: "source-26.10.11", sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f" }, displayName: "CQ WW SSB", mode: "SSB", entryDescriptorVersion: 1, entry: entry("SSB", false), referenceDataVersion: "cty-2026.10", sourceVerification: "provisional", sourceNote: "Fixture checked" },
  { identity: { id: "cq-wpx-ssb", version: "1.0.0-source-spike", edition: "source-26.10.11", sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f" }, displayName: "CQ WPX SSB", mode: "SSB", entryDescriptorVersion: 1, entry: entry("SSB", true), referenceDataVersion: "cty-2026.10", sourceVerification: "provisional", sourceNote: "Fixture checked" },
  { identity: { id: "oceania-dx-cw", version: "1.0.0-source-spike", edition: "source-26.10.11", sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f" }, displayName: "Oceania DX CW", mode: "CW", entryDescriptorVersion: 1, entry: entry("CW", true, "exchangeStrings"), referenceDataVersion: "cty-2026.10", sourceVerification: "provisional", sourceNote: "Fixture checked" },
  { identity: { id: "oceania-dx-ssb", version: "1.0.0-source-spike", edition: "source-26.10.11", sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f" }, displayName: "Oceania DX SSB", mode: "SSB", entryDescriptorVersion: 1, entry: entry("SSB", true, "exchangeStrings"), referenceDataVersion: "cty-2026.10", sourceVerification: "provisional", sourceNote: "Fixture checked" },
  { identity: { id: "sac-cw", version: "1.0.0-2026-rules-preview", edition: "2026-rules-preview", sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f" }, displayName: "Scandinavian Activity Contest CW", mode: "CW", entryDescriptorVersion: 1, entry: entry("CW", true, "exchangeStrings"), referenceDataVersion: "cty-2026.10", sourceVerification: "provisional", sourceNote: "Practice scoring preview; submission categories and dates are not fully enforced." },
  { identity: { id: "sac-ssb", version: "1.0.0-2026-rules-preview", edition: "2026-rules-preview", sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f" }, displayName: "Scandinavian Activity Contest SSB", mode: "SSB", entryDescriptorVersion: 1, entry: entry("SSB", true, "exchangeStrings"), referenceDataVersion: "cty-2026.10", sourceVerification: "provisional", sourceNote: "Practice scoring preview; submission categories and dates are not fully enforced." },
  { identity: { id: "naqp-rtty", version: "1.0.0-2026-rules-preview", edition: "2026-rules-preview", sourceRevision: "0c98451d9dc4111dbb371c0a7d806a5ccd88624e21b1553672e9066c417064e8" }, displayName: "North American QSO Party RTTY", mode: "RTTY", entryDescriptorVersion: 2,
    entry: { version: 2, mode: "RTTY", adifMode: "RTTY", cabrilloQSOType: "RY", cabrilloFormatterVersion: "naqp-preview-1", cabrilloProjectionFormatterVersion: "naqp-preview-1", report: { format: "none", defaultSent: "", defaultReceived: "", maximumUTF8Bytes: 0 },
      exchange: { sent: "structured", received: "structured", sentDefault: "stationFields", adifFields: "exchangeStrings", sentFields: [{ id: "name", label: "Name", acceptedKinds: ["operatorName"], required: true, maximumUTF8Bytes: 32, adifField: "MY_NAME" }, { id: "location", label: "Location", acceptedKinds: ["subdivision", "dxccPrefix"], required: false, maximumUTF8Bytes: 8, adifField: "MY_STATE" }], receivedFields: [{ id: "name", label: "Name", acceptedKinds: ["operatorName"], required: true, maximumUTF8Bytes: 32, adifField: "NAME" }, { id: "location", label: "Location", acceptedKinds: ["subdivision", "dxccPrefix"], required: true, maximumUTF8Bytes: 8, adifField: "STATE" }] },
      serial: { requirement: "none", allowedScopes: [] }, modeProfiles: [{ mode: "RTTY", adifMode: "RTTY", adifSubmode: null, cabrilloQSOType: "RY", report: { format: "none", defaultSent: "", defaultReceived: "", maximumUTF8Bytes: 0 } }], scorePolicy: "pointsTimesMultipliers" }, referenceDataVersion: "cty-2026.10", sourceVerification: "provisional", sourceNote: "NAQP rules preview" },
];
const rules: ContestRuleMetadata[] = rawRules.map(rule => {
  const auditDigest = reviewedOperatorCapabilityDigest(rule.identity);
  return auditDigest ? { ...rule, operatorCapability: { version: 1, auditDigest, policy: "simulated-run-sp-v1",
    output: "simulation-only", styles: ["run", "search-and-pounce"], macros: ["CQ", "EXCH", "QRZ", "AGN", "HISCALL", "MYCALL", "QSOB4"] } } : rule;
});
const sessions: ContestSessionSummary[] = rules.slice(0, 2).map((rule, index) => ({ sessionID: `session-${index + 1}`, workspaceGeneration: "generation-1", revision: 1, name: index ? "WPX May" : "WW November", rule, referenceDataVersion: rule.referenceDataVersion, station: { callsign: "OM0RX", cqZone: "15", dxccEntity: "Slovak Republic" }, operator: { callsign: "OM0RX", category: "Single Operator" }, qsoCount: 0, updatedAt: "2026-10-17T01:00:00Z" }));
function mixedModeSession(): ContestSessionSummary {
  const profile = (mode: "CW" | "SSB") => ({ mode, adifMode: mode, adifSubmode: null, cabrilloQSOType: mode === "CW" ? "CW" as const : "PH" as const,
    report: { format: mode === "CW" ? "cwRST" as const : "phoneRS" as const, defaultSent: mode === "CW" ? "599" : "59",
      defaultReceived: mode === "CW" ? "599" : "59", maximumUTF8Bytes: mode === "CW" ? 3 : 2 } });
  const fixtureSession = (activationFixtureJSON as any).cases[0].session as ContestSessionSummary, base = fixtureSession.rule;
  if (!isStructuredEntry(base.entry)) throw new Error("The mixed-mode test requires a structured declarative entry.");
  const mixedEntry: ContestEntryDescriptorV2 = { ...base.entry,
    mode: "SSB", adifMode: "SSB", cabrilloQSOType: "PH", report: profile("SSB").report, modeProfiles: [profile("CW"), profile("SSB")] };
  const rule: ContestRuleMetadata = { ...base, identity: { id: "operator-authored-mixed", version: "1", edition: "test", sourceRevision: "d".repeat(64) },
    displayName: "Operator-authored mixed mode", mode: "SSB", supportedModes: ["CW", "SSB"], entry: mixedEntry,
    operatorCapability: { ...base.operatorCapability!, auditDigest: "d".repeat(64), signalProfiles: [
      { mode: "CW", signal: "cw" }, { mode: "SSB", signal: "phone" },
    ] },
    declarativeDefinition: { definitionDigest: "d".repeat(64), immutablePerSession: true, exportPurpose: "operatorArchive", submissionReady: false } };
  return { ...fixtureSession, sessionID: "session-mixed", workspaceGeneration: "generation-1", name: "Mixed mode", rule,
    referenceDataVersion: rule.referenceDataVersion };
}
const scpDataset={sourceID:"operator-managed-local",version:"tiny.scp",retrievedAtUTC:"2026-10-18T00:00:00.000Z",sha256:"a".repeat(64),byteCount:16,recordCount:1,duplicateCount:0,digestVerification:"computedOnly"};
function withReadiness(session: ContestSessionSummary, draft: ContestDraftSnapshot): ContestDraftSnapshot {
  const capability = session.rule.operatorCapability;
  if (!capability) return draft;
  const callReady = !!draft.fields.callsign && draft.dupe.state !== "unchecked", duplicate = draft.dupe.state === "duplicate";
  const exchangeReady = !!draft.fields.receivedExchange, serial = session.rule.entry.serial.requirement === "requiredForCommit";
  return { ...draft, operatorReadiness: { capabilityDigest: capability.auditDigest,
    callsign: draft.fields.callsign ? callReady ? "ready" : "blocked" : "empty", exchange: exchangeReady ? "ready" : "empty",
    canSendCQ: !draft.fields.callsign, canSendCall: callReady && !duplicate, canSendDuplicate: callReady && duplicate,
    canReserveCall: serial && callReady && !duplicate && draft.reservedSerial === null,
    canReserveCommit: serial && callReady && exchangeReady && !duplicate && draft.reservedSerial === null,
    canCommit: callReady && exchangeReady && !duplicate && (!serial || draft.reservedSerial !== null) } };
}
function draftFor(session: ContestSessionSummary, callsign = "") : ContestDraftSnapshot { const report = session.rule.entry.report.defaultSent, entry = session.rule.entry, structured = isStructuredEntry(entry);
  const sentFields = structured ? Object.fromEntries(entry.exchange.sentFields.map(field => [field.id, session.station.exchangeFields?.[field.id] ?? ""])) : undefined;
  const receivedValue = (id: string) => !callsign ? "" : id === "name" ? "SAM" : id === "location" ? "ON" : id === "number" ? "14" : id === "member-or-location" ? "5678" : "1";
  const receivedFields = structured ? Object.fromEntries(entry.exchange.receivedFields.map(field => [field.id, receivedValue(field.id)])) : undefined;
  const sentExchange = structured ? Object.values(sentFields!).filter(Boolean).join(" ") : session.rule.entry.exchange.sentDefault === "stationSnapshot" ? "15" : "001";
  const receivedExchange = callsign ? structured ? Object.values(receivedFields!).filter(Boolean).join(" ") : "05" : "";
  const draft: ContestDraftSnapshot = { draftID: `draft-${session.sessionID}`, sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, revision: session.revision, reservedSerial: null, updatedAt: "2026-10-17T01:00:00Z", fields: { callsign, sentReport: report, sentExchange, receivedReport: report, receivedExchange, frequencyHz: 14025000, band: "20m", mode: session.rule.mode, ...(structured ? { sentExchangeFields: sentFields, receivedExchangeFields: receivedFields } : {}) }, validation: { errors: [], warnings: [] }, dupe: { state: "clear", reason: "Not worked on 20m." } }; return withReadiness(session, draft); }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

function fullQSO(session: ContestSessionSummary): ContestFullQSO { const report = session.rule.entry.report.defaultSent; return { qsoID: `qso-${session.sessionID}`, sessionID: session.sessionID, originalUTC: "2026-10-17T02:00:00.000Z", callsign: "K1ABC", band: "20m", mode: session.rule.mode, frequencyHz: 14025000, sentReport: report, receivedReport: report, sentExchange: "001", normalizedSentExchange: "001", allocatedSerial: "001", receivedExchange: "1", normalizedReceivedExchange: "1", entity: { adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5 }, operatorCallsign: "OM0RX", stationLocation: "Home", provenance: { source: "operatorEntry", sourceIdentity: "cty-1", importedClaimedScore: null }, ruleIdentity: session.rule.identity, referenceDataVersion: session.referenceDataVersion }; }
function fixture(options: { firstApply?: Promise<void>; firstApplyReject?: boolean; commit?: Promise<void>; loseCreate?: boolean; staleApply?: boolean; openDelay?: Record<string, Promise<void>>; openGenerationMismatch?: string; qsoSession?: "session-1" | "session-2"; change?: Promise<void>; loseChange?: boolean; rejectChange?: boolean; malformedChange?: boolean; receiptCommitted?: boolean; scp?: boolean; emptyMultiplierDisplay?: boolean; extraSession?: ContestSessionSummary } = {}) {
  const configuredSessions = options.extraSession ? [...sessions, options.extraSession] : sessions;
  const fixtureSessions = options.scp ? configuredSessions.map((item,index) => ({...item,sessionID:`00000000-0000-0000-0000-00000000000${index+1}`,workspaceGeneration:"10000000-0000-0000-0000-000000000001"})) : configuredSessions;
  const fixtureRules = options.extraSession ? [...rules, options.extraSession.rule] : rules;
  const state = new Map(fixtureSessions.map(item => { const session = { ...item, qsoCount: options.qsoSession === item.sessionID ? 1 : item.qsoCount }; const draft = draftFor(session); if (options.qsoSession === "session-2") draft.reservedSerial = 7; return [item.sessionID, { session, draft }]; }));
  const contacts = new Map<string, ContestFullQSO>(); if (options.qsoSession) contacts.set(options.qsoSession, fullQSO(state.get(options.qsoSession)!.session));
  const calls: [string, Record<string, unknown>][] = []; let sequence = 0, applyCount = 0, createLost = false, changeLost = false;
  const changeResults = new Map<string, ContestQSOChangeResult>();
  const receipt = (params: Record<string, unknown>, revision: number) => ({ requestID: params.requestID as string, payloadDigest: params.payloadDigest as string, committedRevision: revision, committedAt: "2026-10-17T02:00:00Z" });
  const request: ContestRequest = vi.fn(async (method, params = {}) => {
    calls.push([method, params]); const ok = (result: unknown) => ({ id: `frame-${++sequence}`, ok: true as const, result });
    if(options.scp&&method==="contest_scp_status")return ok({dataset:scpDataset,unavailableReason:null});
    if(options.scp&&method==="contest_scp_query")return ok({sessionID:params.sessionID,workspaceGeneration:params.workspaceGeneration,
      requestID:params.requestID,normalizedQuery:String(params.query).toUpperCase(),matches:[{matchID:`${scpDataset.sha256}:0`,callsign:"K1ABC",score:100,isPrefixMatch:true}],
      dataset:scpDataset,evaluatedRecordCount:1,isPartial:false});
    if(options.scp&&method==="contest_scp_select")return ok({callsign:"K1ABC"});
    if(options.scp&&method==="contest_scp_cancel")return ok({cancelled:true});
    if (method === "contest_catalog") return ok({ workspaceGeneration: fixtureSessions[0].workspaceGeneration, rules: fixtureRules });
    if (method === "contest_sessions") return ok({ sessions: [...state.values()].map(x => x.session) });
    if (method === "contest_open" || method === "contest_draft_get") {
      const id = params.sessionID as string; await options.openDelay?.[id]; const value = state.get(id)!;
      if (method === "contest_open" && options.openGenerationMismatch === id) return ok({ session: { ...value.session, workspaceGeneration: "generation-B" }, draft: { ...value.draft, workspaceGeneration: "generation-B" } });
      return ok(value);
    }
    if (method === "contest_create") {
      if (options.loseCreate && !createLost) { createLost = true; throw new Error("reply lost"); }
      const payload = params.payload as Record<string, unknown>, identity = payload.ruleIdentity as ContestRuleMetadata["identity"];
      const rule = fixtureRules.find(x => x.identity.id === identity.id)!; const sessionID = params.sessionID as string;
      const session: ContestSessionSummary = { ...sessions[0], sessionID, name: payload.name as string, rule, referenceDataVersion: payload.referenceDataVersion as string, station: payload.station as ContestSessionSummary["station"], operator: payload.operator as ContestSessionSummary["operator"], revision: 1 };
      const value = { session, draft: draftFor(session), receipt: receipt(params, 1) }; state.set(sessionID, { session, draft: value.draft }); return ok(value);
    }
    const current = state.get(params.sessionID as string)!;
    if (method === "contest_qso_get") return ok({ sessionID: current.session.sessionID, workspaceGeneration: current.session.workspaceGeneration, revision: current.session.revision, qso: contacts.get(current.session.sessionID) });
    if (method === "contest_draft_apply") {
      if (applyCount++ === 0) { await options.firstApply; if (options.firstApplyReject) throw new Error("draft reply lost"); }
      if (options.staleApply) return { id: "frame", ok: false as const, error: { code: "stale_revision", message: "Draft changed elsewhere.", outcome: "confirmed" as const } };
      const fields = (params.payload as { fields: ContestDraftSnapshot["fields"] }).fields, revision = current.session.revision + 1;
      current.session = { ...current.session, revision }; current.draft = withReadiness(current.session, { ...current.draft, revision, fields });
      return ok({ ...current, receipt: receipt(params, revision) });
    }
    if (method === "contest_serial_reserve") { const revision = current.session.revision + 1; current.session = { ...current.session, revision }; current.draft = withReadiness(current.session, { ...current.draft, revision, reservedSerial: 1 }); return ok({ ...current, receipt: receipt(params, revision) }); }
    if (method === "contest_qso_commit") {
      await options.commit; const old = current.draft, revision = current.session.revision + 1; current.session = { ...current.session, revision, qsoCount: current.session.qsoCount + 1 }; current.draft = draftFor(current.session);
      const { multiplierLabels: _multiplierLabels, multiplierDisplayLabels: _multiplierDisplayLabels, ...scoreSummary } = score(current.session);
      return ok({ ...current, qso: { qsoID: `qso-${revision}`, sessionID: current.session.sessionID, workedAt: "2026-10-17T02:00:00Z", callsign: old.fields.callsign, band: old.fields.band, mode: old.fields.mode, sentExchange: old.fields.sentExchange, receivedExchange: old.fields.receivedExchange, points: 3, multiplier: "K", isDupe: false }, score: scoreSummary, receipt: receipt(params, revision) });
    }
    if (method === "contest_qso_correct" || method === "contest_qso_delete") {
      const replay = changeResults.get(params.requestID as string); if (replay) return ok(replay);
      if (options.rejectChange) return { id: "frame", ok: false as const, error: { code: "stale_revision", message: "Contact changed elsewhere.", outcome: "confirmed" as const } };
      await options.change; const payload = params.payload as Record<string, unknown>, before = contacts.get(current.session.sessionID)!, revision = current.session.revision + 1;
      const target = method === "contest_qso_correct" ? { ...before, ...(payload.qso as Omit<ContestFullQSO, "entity">), entity: { adif: 230, name: "FEDERAL REPUBLIC OF GERMANY", countryPrefix: "DL", continent: "EU", cqZone: 14 } } : null;
      current.session = { ...current.session, revision, qsoCount: target ? 1 : 0, updatedAt: "2026-10-17T02:10:00.000Z" };
      const duplicate = !!target && current.draft.fields.callsign === target.callsign && current.draft.fields.band === target.band;
      current.draft = withReadiness(current.session, { ...current.draft, revision, dupe: duplicate
        ? { state: "duplicate", reason: `${target!.callsign} is already worked on ${target!.band}.` }
        : { state: "clear", reason: "Not worked on this band." } });
      if (target) contacts.set(current.session.sessionID, target); else contacts.delete(current.session.sessionID);
      const { multiplierLabels: _labels, multiplierDisplayLabels: _displayLabels, ...summary } = score(current.session); const changeSession = { sessionID: current.session.sessionID, workspaceGeneration: current.session.workspaceGeneration, revision, name: current.session.name, ruleIdentity: current.session.rule.identity, referenceDataVersion: current.session.referenceDataVersion, qsoCount: current.session.qsoCount, updatedAt: current.session.updatedAt };
      const value: ContestQSOChangeResult = { session: changeSession, operation: method === "contest_qso_correct" ? "correction" : "deletion", qsoID: before.qsoID, qsoCount: current.session.qsoCount, score: summary, currentTarget: target, auditReference: { sessionID: current.session.sessionID, qsoID: before.qsoID, requestID: params.requestID as string, revision }, receipt: receipt(params, revision) };
      changeResults.set(params.requestID as string, value);
      if (options.loseChange && !changeLost) { changeLost = true; throw new Error("change reply lost"); }
      if (options.malformedChange) return ok({ ...value, qsoCount: 99 });
      return ok(value);
    }
    if (method === "contest_operation_receipt") { const result = changeResults.get(params.requestID as string); return ok(options.receiptCommitted && result ? { status: "committed", receipt: result.receipt } : { status: "not_found" }); }
    if (method === "contest_log_page") { const contact = contacts.get(current.session.sessionID); const qsos = contact ? [{ qsoID: contact.qsoID, sessionID: contact.sessionID, workedAt: contact.originalUTC, callsign: contact.callsign, band: contact.band, mode: contact.mode, sentExchange: contact.sentExchange, receivedExchange: contact.receivedExchange, points: 3, multiplier: "wpx-prefix:DL1:contest", multiplierDisplayLabels: options.emptyMultiplierDisplay ? [] : ["DL1 prefix"], isDupe: false }] : []; return ok({ sessionID: current.session.sessionID, workspaceGeneration: current.session.workspaceGeneration, revision: params.expectedRevision, qsos, total: qsos.length, offset: params.offset, limit: params.limit }); }
    if (method === "contest_score") return ok({ ...score(current.session), revision: params.expectedRevision });
    throw new Error(`Unexpected ${method}`);
  }) as ContestRequest;
  return { request, calls, state, contacts };
}
function score(session: ContestSessionSummary) { return { sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, revision: session.revision, qsos: session.qsoCount, points: session.qsoCount * 3, multipliers: session.qsoCount, claimedScore: session.qsoCount * 3, multiplierLabels: session.qsoCount ? ["wpx-prefix:K1:contest"] : [], multiplierDisplayLabels: session.qsoCount ? ["K1 prefix"] : [], sourceVerification: "provisional" as const }; }
function ids() { let value = 0; return () => `id-${++value}`; }
const digest = async (payload: unknown) => String(JSON.stringify(payload).length).padStart(64, "0");
afterEach(cleanup);

async function open(request: ContestRequest, storage = new MemoryContestRecoveryStorage()) {
  const view = render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={storage}/>);
  await screen.findByText("WW November"); fireEvent.click(screen.getByRole("button", { name: /WW November/ })); await screen.findByRole("form", { name: "CW contest entry" }); return view;
}
async function openWPX(request: ContestRequest, storage = new MemoryContestRecoveryStorage()) {
  const view = render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={storage}/>);
  await screen.findByText("WPX May"); fireEvent.click(screen.getByRole("button", { name: /WPX May/ })); await screen.findByRole("form", { name: "CW contest entry" }); return view;
}

it("uses the active structured mode profile for report controls in an operator-authored mixed-mode session", async () => {
  const mixed = mixedModeSession(), { request } = fixture({ extraSession: mixed });
  render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={new MemoryContestRecoveryStorage()}/>);
  fireEvent.click(await screen.findByRole("button", { name: /Mixed mode/ }));
  await screen.findByRole("form", { name: "SSB contest entry" });
  const sent = screen.getByLabelText("Sent report") as HTMLInputElement, received = screen.getByLabelText("Received report") as HTMLInputElement;
  expect(sent.maxLength).toBe(2); expect(received.maxLength).toBe(2); expect(sent.value).toBe("59");
  fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "CW" } });
  await waitFor(() => expect((screen.getByLabelText("Sent report") as HTMLInputElement).value).toBe("599"));
  expect((screen.getByLabelText("Sent report") as HTMLInputElement).maxLength).toBe(3);
  expect((screen.getByLabelText("Received report") as HTMLInputElement).maxLength).toBe(3);
});

it("registers an awaited contest retirement controller and removes it on unmount", async () => {
  const { request } = fixture();
  let transition: { prepare: () => Promise<void> } | null = null;
  const view = render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest}
    recoveryStorage={new MemoryContestRecoveryStorage()} registerTransition={value => { transition = value; }}/>);
  await screen.findByText("WW November");
  expect(transition).not.toBeNull();
  await act(async () => { await transition!.prepare(); });
  view.unmount();
  expect(transition).toBeNull();
});

it("freezes contest entry synchronously before retirement awaits and restores it after a safe failure", async () => {
  const { request } = fixture();
  let transition: ContestTransitionController | null = null;
  render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest}
    recoveryStorage={new MemoryContestRecoveryStorage()} registerTransition={value => { transition = value; }}/>);
  await screen.findByText("WW November"); fireEvent.click(screen.getByRole("button", { name: /WW November/ }));
  const callsign = await screen.findByRole("textbox", { name: "Contest callsign" }) as HTMLInputElement;
  const before = callsign.value;
  act(() => transition!.freeze());
  expect(callsign.disabled).toBe(true);
  fireEvent.change(callsign, { target: { value: "K1ZZZ" } });
  expect(callsign.value).toBe(before);
  act(() => transition!.resume());
  expect(callsign.disabled).toBe(false);
});

it("renders repeated authoritative validation messages without duplicate React keys", async () => {
  const { request, state } = fixture();
  const current = state.get("session-1")!;
  current.draft.validation = { errors: ["A required exchange field is missing.", "A required exchange field is missing."], warnings: ["A required exchange field is missing."] };
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={new MemoryContestRecoveryStorage()}/>);
  fireEvent.click(await screen.findByRole("button", { name: /WW November/ }));
  expect(await screen.findAllByText("A required exchange field is missing.")).toHaveLength(3);
  expect(consoleError.mock.calls.some(call => call.some(value => String(value).includes("same key")))).toBe(false);
  consoleError.mockRestore();
});

it("shows actionable duplicate guidance for an authoritative blank next draft", async () => {
  const { request, state } = fixture();
  const current = state.get("session-1")!;
  current.draft = { ...current.draft, fields: { ...current.draft.fields, callsign: "" },
    dupe: { state: "unchecked", reason: "Reload the contest session to check duplicate state." } };
  render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest}
    recoveryStorage={new MemoryContestRecoveryStorage()}/>);
  fireEvent.click(await screen.findByRole("button", { name: /WW November/ }));

  expect(await screen.findByText("Enter a callsign to check duplicate status.")).toBeTruthy();
  expect(screen.queryByText("Reload the contest session to check duplicate state.")).toBeNull();
});

it("offers serial reservation only for WPX and keeps partial calls editable after reserving", async () => {
  const { request, calls } = fixture();
  const view = render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={new MemoryContestRecoveryStorage()}/>);
  await screen.findByText("WW November");
  fireEvent.click(screen.getByRole("button", { name: /WW November/ }));
  await screen.findByRole("form", { name: "CW contest entry" });
  expect(screen.queryByRole("button", { name: "Reserve serial" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Contest Manager" }));
  fireEvent.click(screen.getByRole("button", { name: /WPX May/ }));
  const reserve = await screen.findByRole("button", { name: "Reserve serial" });
  fireEvent.click(reserve);
  await screen.findByRole("button", { name: "Serial 1" });
  const call = screen.getByRole("textbox", { name: "Contest callsign" }) as HTMLInputElement;
  fireEvent.change(call, { target: { value: "K" } });
  await waitFor(() => expect(calls.some(([method, params]) => method === "contest_draft_apply" &&
    ((params.payload as { fields?: ContestDraftSnapshot["fields"] }).fields?.callsign === "K"))).toBe(true));
  expect(call.value).toBe("K");
  fireEvent.change(call, { target: { value: "K1" } });
  await waitFor(() => expect(calls.some(([method, params]) => method === "contest_draft_apply" &&
    ((params.payload as { fields?: ContestDraftSnapshot["fields"] }).fields?.callsign === "K1"))).toBe(true));
  expect(call.value).toBe("K1");
  view.unmount();
});

it("creates an SSB pilot from catalog metadata and uses phone reports with WPX serial capability", async () => {
  const { request, calls } = fixture();
  render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={new MemoryContestRecoveryStorage()}/>);
  await screen.findByText("WW November");
  expect(screen.getByRole("option", { name: /Oceania DX CW/ })).toBeTruthy();
  expect(screen.getByRole("option", { name: /Oceania DX SSB/ })).toBeTruthy();
  expect(screen.getByRole("option", { name: /Scandinavian Activity Contest CW/ })).toBeTruthy();
  expect(screen.getByRole("option", { name: /Scandinavian Activity Contest SSB/ })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Session name"), { target: { value: "WPX SSB Saturday" } });
  fireEvent.change(screen.getByLabelText("Contest"), { target: { value: "cq-wpx-ssb" } });
  fireEvent.change(screen.getByLabelText("Station callsign"), { target: { value: "OM0RX" } });
  fireEvent.change(screen.getByLabelText("Operator callsign"), { target: { value: "OM0RX" } });
  fireEvent.change(screen.getByLabelText("CQ zone"), { target: { value: "15" } });
  fireEvent.change(screen.getByLabelText("DXCC entity"), { target: { value: "Slovak Republic" } });
  await waitFor(() => expect((screen.getByRole("button", { name: "Create and open" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Create and open" }));
  await screen.findByRole("form", { name: "SSB contest entry" });
  expect(screen.getByText("SSB", { selector: ".contest-entry-context strong" })).toBeTruthy();
  expect((screen.getByLabelText("Sent report") as HTMLInputElement).value).toBe("59");
  expect((screen.getByLabelText("Received report") as HTMLInputElement).value).toBe("59");
  expect(screen.getByRole("button", { name: "Reserve serial" })).toBeTruthy();
  const createCall = calls.find(([method]) => method === "contest_create");
  expect((createCall?.[1].payload as Record<string, unknown>).ruleIdentity).toEqual(rules[3].identity);
});

it("labels SAC as a practice scoring preview without claiming submission readiness", async () => {
  const { request } = fixture();
  render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={new MemoryContestRecoveryStorage()}/>);
  await screen.findByText("WW November");
  fireEvent.change(screen.getByLabelText("Session name"), { target: { value: "SAC practice" } });
  fireEvent.change(screen.getByLabelText("Contest"), { target: { value: "sac-ssb" } });
  fireEvent.change(screen.getByLabelText("Station callsign"), { target: { value: "OM0RX" } });
  fireEvent.change(screen.getByLabelText("Operator callsign"), { target: { value: "OM0RX" } });
  fireEvent.change(screen.getByLabelText("CQ zone"), { target: { value: "15" } });
  fireEvent.change(screen.getByLabelText("DXCC entity"), { target: { value: "Slovak Republic" } });
  fireEvent.click(screen.getByRole("button", { name: "Create and open" }));
  await screen.findByRole("form", { name: "SSB contest entry" });
  expect(screen.getByText(/SAC scoring practice preview/)).toBeTruthy();
  const exportButton = screen.getByRole("button", { name: "Export…" }) as HTMLButtonElement;
  await waitFor(() => expect(exportButton.disabled).toBe(false));
  fireEvent.click(exportButton);
  const exportDialog = await screen.findByRole("dialog", { name: "Export contest log" });
  expect(within(exportDialog).getByText(/not sponsor-submission ready/)).toBeTruthy();
  expect(within(exportDialog).getByRole("heading", { name: "Prepare a practice export" })).toBeTruthy();
});

it("drains edits made during a delayed save before an immediate Log", async () => {
  const gate = deferred(), { request, calls, state } = fixture({ firstApply: gate.promise }); await open(request);
  const call = screen.getByRole("textbox", { name: "Contest callsign" }); fireEvent.change(call, { target: { value: "K1A" } });
  await waitFor(() => expect(calls.filter(([m]) => m === "contest_draft_apply")).toHaveLength(1));
  fireEvent.change(call, { target: { value: "K1ABC" } }); fireEvent.submit(screen.getByRole("form", { name: "CW contest entry" }));
  await act(async () => gate.resolve());
  await waitFor(() => expect(calls.filter(([m]) => m === "contest_qso_commit")).toHaveLength(1));
  expect(calls.filter(([m]) => m === "contest_draft_apply").map(([,p]) => ((p.payload as {fields: ContestDraftSnapshot["fields"]}).fields.callsign))).toEqual(["K1A", "K1ABC"]);
  expect(state.get("session-1")!.session.qsoCount).toBe(1);
});

it("blocks session context changes until a delayed commit settles", async () => {
  const gate = deferred(), { request, calls } = fixture({ commit: gate.promise }); await open(request);
  fireEvent.change(screen.getByRole("textbox", { name: "Contest callsign" }), { target: { value: "K1ABC" } }); await waitFor(() => expect(calls.some(([m]) => m === "contest_draft_apply")).toBe(true));
  fireEvent.submit(screen.getByRole("form", { name: "CW contest entry" })); await waitFor(() => expect(calls.some(([m]) => m === "contest_qso_commit")).toBe(true));
  const manager = screen.getByRole("button", { name: "Contest Manager" }) as HTMLButtonElement; expect(manager.disabled).toBe(true); fireEvent.click(manager);
  expect(calls.some(([m,p]) => m === "contest_open" && p.sessionID === "session-2")).toBe(false);
  await act(async () => gate.resolve()); await screen.findByText(/Logged K1ABC/); expect(screen.getByRole("heading", { name: /CQ WW CW/ })).toBeTruthy();
});

it("loads full multiplier labels from the score projection after a scalar commit summary", async () => {
  const { request, calls } = fixture({ qsoSession: "session-1" }); await open(request);
  fireEvent.change(screen.getByRole("textbox", { name: "Contest callsign" }), { target: { value: "K1ABC" } });
  await waitFor(() => expect(calls.some(([method]) => method === "contest_draft_apply")).toBe(true));
  fireEvent.submit(screen.getByRole("form", { name: "CW contest entry" }));
  await screen.findByText("K1 prefix", { selector: ".contest-multipliers span" });
  await screen.findByText("DL1 prefix", { selector: "td" });
  expect(calls.filter(([method]) => method === "contest_score").length).toBeGreaterThanOrEqual(2);
});

it("rejects an old mount's delayed open after a remount opens another session", async () => {
  const gate = deferred(), { request, calls } = fixture({ openDelay: { "session-1": gate.promise } });
  const first = render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={new MemoryContestRecoveryStorage()}/>);
  await screen.findByText("WW November"); fireEvent.click(screen.getByRole("button", { name: /WW November/ }));
  await waitFor(() => expect(calls.some(([method, params]) => method === "contest_open" && params.sessionID === "session-1")).toBe(true)); first.unmount();
  render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={new MemoryContestRecoveryStorage()}/>);
  await screen.findByText("WPX May"); fireEvent.click(screen.getByRole("button", { name: /WPX May/ })); await screen.findByRole("heading", { name: /CQ WPX CW · WPX May/ });
  await act(async () => gate.resolve());
  await waitFor(() => expect(screen.getByRole("heading", { name: /CQ WPX CW · WPX May/ })).toBeTruthy());
  expect(screen.queryByRole("heading", { name: /CQ WW CW · WW November/ })).toBeNull();
});

it("rejects an open response from another workspace generation without activation or journaling", async () => {
  const storage = new MemoryContestRecoveryStorage(), { request, calls } = fixture({ openGenerationMismatch: "session-1" });
  render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={storage}/>);
  await screen.findByText("WW November"); fireEvent.click(screen.getByRole("button", { name: /WW November/ }));
  await screen.findByText("Malformed or stale contest_open response.");
  expect(screen.queryByRole("form", { name: "CW contest entry" })).toBeNull();
  expect(calls.some(([method]) => method === "contest_draft_apply")).toBe(false);
  expect(storage.getItem("xlog.contesting.local-test-workspace.v2:generation-B")).toBeNull();
});

it("pins lost create across double submit and remount recovery", async () => {
  const storage = new MemoryContestRecoveryStorage(), { request, calls } = fixture({ loseCreate: true });
  const view = render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={storage}/>); await screen.findByRole("option", { name: "CQ WW CW · source-26.10.11" });
  for (const [label, value] of [["Session name","WW Test"],["Station callsign","OM0RX"],["Operator callsign","OM0RX"],["CQ zone","15"],["DXCC entity","Slovak Republic"]]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const button = screen.getByRole("button", { name: "Create and open" }); fireEvent.click(button); fireEvent.click(button); await screen.findByText("Save status unknown");
  expect(calls.filter(([m]) => m === "contest_create")).toHaveLength(1); const original = calls.find(([m]) => m === "contest_create")![1];
  view.unmount(); render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={storage}/>); await screen.findByText("Save status unknown"); fireEvent.click(screen.getByRole("button", { name: "Retry same save" }));
  await waitFor(() => expect(calls.filter(([m]) => m === "contest_create")).toHaveLength(2)); expect(calls.filter(([m]) => m === "contest_create")[1][1]).toEqual(original);
});

it("recovers an unflushed edit after remount and pumps it to the backend", async () => {
  const storage = new MemoryContestRecoveryStorage(), { request, state, calls } = fixture();
  const view = await open(request, storage);
  fireEvent.change(screen.getByRole("textbox", { name: "Contest callsign" }), { target: { value: "K1ABC" } });
  view.unmount();
  render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={storage}/>);
  await screen.findByText("WW November"); fireEvent.click(screen.getByRole("button", { name: /WW November/ }));
  await waitFor(() => expect(state.get("session-1")!.draft.fields.callsign).toBe("K1ABC"));
  expect(calls.filter(([method]) => method === "contest_draft_apply")).toHaveLength(1);
});

it("keeps one shared in-flight draft operation across unmount and remount", async () => {
  const gate = deferred(), storage = new MemoryContestRecoveryStorage(), { request, calls } = fixture({ firstApply: gate.promise });
  const view = await open(request, storage); fireEvent.change(screen.getByRole("textbox", { name: "Contest callsign" }), { target: { value: "K1ABC" } });
  await waitFor(() => expect(calls.filter(([method]) => method === "contest_draft_apply")).toHaveLength(1)); view.unmount();
  render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={storage}/>);
  await screen.findByText("Saving…"); expect(calls.filter(([method]) => method === "contest_draft_apply")).toHaveLength(1);
  await act(async () => gate.resolve()); await waitFor(() => expect(screen.queryByText("Saving…")).toBeNull());
  expect(calls.filter(([method]) => method === "contest_draft_apply")).toHaveLength(1);
});

it("does not mint a second draft operation when the first reply is lost before the next timer", async () => {
  const gate = deferred(), { request, calls } = fixture({ firstApply: gate.promise, firstApplyReject: true }); await open(request);
  const call = screen.getByRole("textbox", { name: "Contest callsign" }); fireEvent.change(call, { target: { value: "K1A" } });
  await waitFor(() => expect(calls.filter(([method]) => method === "contest_draft_apply")).toHaveLength(1));
  fireEvent.change(call, { target: { value: "K1ABC" } }); await act(async () => gate.resolve()); await screen.findByText("Save status unknown");
  await new Promise(resolve => setTimeout(resolve, 240)); expect(calls.filter(([method]) => method === "contest_draft_apply")).toHaveLength(1);
});

it("preserves a recovered draft for session A while opening B after a restart", async () => {
  const storage = new MemoryContestRecoveryStorage(), first = fixture(); const view = await open(first.request, storage);
  fireEvent.change(screen.getByRole("textbox", { name: "Contest callsign" }), { target: { value: "K1ABC" } }); view.unmount();
  const restarted = fixture(); render(<ContestWorkspace request={restarted.request} createRequestID={ids()} digestPayload={digest} recoveryStorage={storage}/>);
  await screen.findByText("WPX May"); fireEvent.click(screen.getByRole("button", { name: /WPX May/ })); await screen.findByRole("form", { name: "CW contest entry" });
  fireEvent.click(screen.getByRole("button", { name: "Contest Manager" })); fireEvent.click(screen.getByRole("button", { name: /WW November/ }));
  await waitFor(() => expect(restarted.state.get("session-1")!.draft.fields.callsign).toBe("K1ABC"));
});

it("preserves invalid frequency text through an unrelated delayed draft revision and resets it on context switch", async () => {
  const gate = deferred(), { request, calls } = fixture({ firstApply: gate.promise }); await open(request);
  const frequency = screen.getByLabelText("Frequency Hz") as HTMLInputElement; fireEvent.change(frequency, { target: { value: "abc" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Contest callsign" }), { target: { value: "K1ABC" } });
  await waitFor(() => expect(calls.filter(([method]) => method === "contest_draft_apply")).toHaveLength(1)); await act(async () => gate.resolve());
  await waitFor(() => expect((screen.getByLabelText("Frequency Hz") as HTMLInputElement).value).toBe("abc"));
  fireEvent.click(screen.getByRole("button", { name: "Contest Manager" })); fireEvent.click(screen.getByRole("button", { name: /WPX May/ }));
  await waitFor(() => expect((screen.getByLabelText("Frequency Hz") as HTMLInputElement).value).toBe("14025000"));
  expect(screen.queryByText("Frequency must contain digits only.")).toBeNull();
});

it("keeps confirmed stale edits visible and offers refresh instead of uncertainty", async () => {
  const { request } = fixture({ staleApply: true }); await open(request); const call = screen.getByRole("textbox", { name: "Contest callsign" }); fireEvent.change(call, { target: { value: "K1ABC" } });
  await screen.findByText("Draft changed elsewhere."); expect(screen.queryByText("Save status unknown")).toBeNull(); expect((call as HTMLInputElement).value).toBe("K1ABC"); expect(screen.getByRole("button", { name: "Refresh draft" })).toBeTruthy();
});

it("keeps invalid frequency text editable without sending a transformed value", async () => {
  const { request, calls } = fixture(); await open(request); const before = calls.filter(([m]) => m === "contest_draft_apply").length;
  const frequency = screen.getByLabelText("Frequency Hz") as HTMLInputElement; fireEvent.change(frequency, { target: { value: "abc" } }); expect(frequency.value).toBe("abc"); await screen.findByText("Frequency must contain digits only.");
  await new Promise(resolve => setTimeout(resolve, 220)); expect(calls.filter(([m]) => m === "contest_draft_apply")).toHaveLength(before);
});

it("renders the responsive contest regions without transmit or ESM controls", async () => {
  const { request, calls } = fixture(); await open(request);
  expect(screen.getByRole("form", { name: "CW contest entry" })).toBeTruthy(); expect(screen.getByRole("region", { name: "Contest log" })).toBeTruthy(); expect(screen.getByRole("complementary", { name: "Score and multipliers" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /ESM|Transmit|Send CW|PTT/i })).toBeNull(); expect(calls.every(([method]) => method.startsWith("contest_"))).toBe(true);
});

it("routes an armed simulated operator sequence through the existing draft and commit owner only", async () => {
  const output: string[] = [], { request, calls } = fixture();
  render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={new MemoryContestRecoveryStorage()}
    simulateContestOutput={async entry => { output.push(`${entry.mode}:${entry.macro}:${entry.text}`); }}/>);
  await screen.findByText("WW November"); fireEvent.click(screen.getByRole("button", { name: /WW November/ }));
  const call = await screen.findByRole("textbox", { name: "Contest callsign" }); const exchange = screen.getByLabelText("Received exchange");
  fireEvent.change(call, { target: { value: "K1ABC" } }); fireEvent.change(exchange, { target: { value: "05" } });
  await waitFor(() => expect(calls.filter(([method]) => method === "contest_draft_apply").length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(exchange, { key: "Enter" });
  await waitFor(() => expect(calls.filter(([method]) => method === "contest_qso_commit")).toHaveLength(1));
  expect(output.map(item => item.split(":")[1])).toEqual(["QRZ"]);
  expect(calls.every(([method]) => method.startsWith("contest_"))).toBe(true);
  expect(screen.getByText(/no CW, voice, PTT, audio, or radio output/i)).toBeTruthy();
});

it("revokes an armed operator sequence when SCP patches the current callsign", async () => {
  const output: string[] = [], { request, calls } = fixture({ scp: true });
  render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={new MemoryContestRecoveryStorage()}
    simulateContestOutput={async entry => { output.push(`${entry.mode}:${entry.macro}:${entry.text}`); }}/>);
  await screen.findByText("WW November"); fireEvent.click(screen.getByRole("button", { name: /WW November/ }));
  const call = await screen.findByRole("textbox", { name: "Contest callsign" });
  const exchange = screen.getByLabelText("Received exchange");
  fireEvent.change(call, { target: { value: "K1" } }); fireEvent.change(exchange, { target: { value: "05" } });
  await waitFor(() => expect(calls.some(([method]) => method === "contest_draft_apply")).toBe(true));
  const candidate = await screen.findByRole("button", { name: /K1ABC/ });
  const arm = screen.getByRole("button", { name: "Arm simulation" }); fireEvent.click(arm);
  expect(arm.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(candidate);
  await waitFor(() => expect((call as HTMLInputElement).value).toBe("K1ABC"));
  expect((exchange as HTMLInputElement).value).toBe("05");
  await waitFor(() => expect(screen.getByRole("button", { name: "Arm simulation" }).getAttribute("aria-pressed")).toBe("false"));
  expect(output).toEqual([]);
  expect(calls.filter(([method]) => method === "contest_qso_commit")).toHaveLength(0);
});

it("consumes repeated owned Enter and guards implicit form submit while a sequence is pending", async () => {
  const gate = deferred(), { request, calls } = fixture();
  render(<ContestWorkspace request={request} createRequestID={ids()} digestPayload={digest} recoveryStorage={new MemoryContestRecoveryStorage()}
    simulateContestOutput={async () => { await gate.promise; }}/>);
  await screen.findByText("WW November"); fireEvent.click(screen.getByRole("button", { name: /WW November/ }));
  const call = await screen.findByRole("textbox", { name: "Contest callsign" }); const exchange = screen.getByLabelText("Received exchange");
  fireEvent.change(call, { target: { value: "K1ABC" } }); fireEvent.change(exchange, { target: { value: "05" } });
  await waitFor(() => expect(calls.some(([method]) => method === "contest_draft_apply")).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); (exchange as HTMLElement).focus();
  await userEvent.keyboard("{Enter}{Enter}"); fireEvent.submit(screen.getByRole("form", { name: "CW contest entry" }));
  expect(calls.filter(([method]) => method === "contest_qso_commit")).toHaveLength(0);
  await act(async () => gate.resolve());
  await waitFor(() => expect(calls.filter(([method]) => method === "contest_qso_commit")).toHaveLength(1));
});

it("keeps ordinary Enter submission available while the simulation is disarmed", async () => {
  const { request, calls } = fixture(); await open(request);
  fireEvent.change(screen.getByRole("textbox", { name: "Contest callsign" }), { target: { value: "K1ABC" } });
  const exchange = screen.getByLabelText("Received exchange"); fireEvent.change(exchange, { target: { value: "05" } });
  await waitFor(() => expect(calls.some(([method]) => method === "contest_draft_apply")).toBe(true));
  (exchange as HTMLElement).focus(); await userEvent.keyboard("{Enter}");
  await waitFor(() => expect(calls.filter(([method]) => method === "contest_qso_commit")).toHaveLength(1));
});

it("loads the full contact before editing, autosaves the entry draft, and preserves its serial", async () => {
  const { request, calls } = fixture({ qsoSession: "session-2" }); await openWPX(request);
  const entryCall = screen.getByRole("textbox", { name: "Contest callsign" }); fireEvent.change(entryCall, { target: { value: "N0CALL" } });
  fireEvent.click(await screen.findByRole("button", { name: "Edit K1ABC" }));
  const editor = await screen.findByRole("form", { name: "Edit K1ABC" });
  expect(calls.findIndex(([method]) => method === "contest_draft_apply")).toBeLessThan(calls.findIndex(([method]) => method === "contest_qso_get"));
  expect(screen.getByText("2026-10-17 02:00:00 Z")).toBeTruthy(); expect(screen.getByText("Home")).toBeTruthy(); expect(screen.getByText("001", { selector: ".contest-qso-readonly strong" })).toBeTruthy();
  const correctedCall = screen.getByLabelText("Callsign", { selector: ".contest-qso-editor input" }); fireEvent.change(correctedCall, { target: { value: "DL1AAA" } });
  expect(screen.getByText("Original entity")).toBeTruthy(); expect(screen.getByText(/checked against the pinned reference/)).toBeTruthy();
  fireEvent.submit(editor); await screen.findByText("Saved DL1AAA · FEDERAL REPUBLIC OF GERMANY.");
  const correction = calls.find(([method]) => method === "contest_qso_correct")![1];
  expect((correction.payload as { qso: Record<string, unknown> }).qso).not.toHaveProperty("entity");
  expect((entryCall as HTMLInputElement).value).toBe("N0CALL"); expect(screen.getByRole("button", { name: "Serial 7" })).toBeTruthy();
});

it("uppercases the normalized NAQP correction aggregate while preserving mixed-case raw input", async () => {
  const rule = rules[rules.length - 1];
  let session: ContestSessionSummary = { sessionID: "naqp-session", workspaceGeneration: "generation-1", revision: 3,
    name: "NAQP correction", rule, referenceDataVersion: rule.referenceDataVersion,
    station: { callsign: "K1AAA", cqZone: "5", dxccEntity: "UNITED STATES", exchangeFields: { name: "AL", location: "CA" } },
    operator: { callsign: "K1AAA", category: "Single Operator" }, qsoCount: 1, updatedAt: "2026-10-18T23:00:00Z" };
  const draft: ContestDraftSnapshot = { ...draftFor(session), revision: 3,
    fields: { ...draftFor(session).fields, sentExchange: "AL CA", sentExchangeFields: { name: "AL", location: "CA" } } };
  let qso: ContestFullQSO = { qsoID: "naqp-qso", sessionID: session.sessionID, originalUTC: "2026-10-18T22:59:00Z",
    callsign: "K1ABC", band: "20m", mode: "RTTY", frequencyHz: 14_080_000, sentReport: "", receivedReport: "",
    sentExchange: "AL CA", normalizedSentExchange: "AL CA", allocatedSerial: "AL CA",
    receivedExchange: "BOB CT", normalizedReceivedExchange: "BOB CT",
    sentExchangeFields: { name: "AL", location: "CA" }, receivedExchangeFields: { name: "BOB", location: "CT" },
    entity: { adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5 },
    operatorCallsign: "K1AAA", stationLocation: "CA", provenance: { source: "operatorEntry", sourceIdentity: "cty-2026.10", importedClaimedScore: null },
    ruleIdentity: rule.identity, referenceDataVersion: rule.referenceDataVersion };
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const ok = (result: unknown) => ({ id: method, ok: true as const, result });
    if (method === "contest_catalog") return ok({ workspaceGeneration: session.workspaceGeneration, rules });
    if (method === "contest_sessions") return ok({ sessions: [session] });
    if (method === "contest_open") return ok({ session, draft });
    if (method === "contest_log_page") return ok({ sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration,
      revision: session.revision, qsos: [{ qsoID: qso.qsoID, sessionID: qso.sessionID, workedAt: qso.originalUTC,
        callsign: qso.callsign, band: qso.band, mode: qso.mode, sentExchange: qso.sentExchange,
        receivedExchange: qso.receivedExchange, points: 1, multiplier: "naqp-location:CT:contest",
        multiplierDisplayLabels: ["CT"], isDupe: false }], total: 1, offset: params.offset, limit: params.limit });
    if (method === "contest_score") return ok({ sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration,
      revision: session.revision, qsos: 1, points: 1, multipliers: 1, claimedScore: 1,
      multiplierLabels: ["naqp-location:CT:contest"], multiplierDisplayLabels: ["CT"], sourceVerification: "provisional" });
    if (method === "contest_qso_get") return ok({ sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration,
      revision: session.revision, qso });
    if (method === "contest_qso_correct") {
      qso = { ...qso, ...((params.payload as any).qso), entity: qso.entity };
      session = { ...session, revision: 4, updatedAt: "2026-10-18T23:01:00Z" };
      const changeSession = { sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration,
        revision: session.revision, name: session.name, ruleIdentity: session.rule.identity,
        referenceDataVersion: session.referenceDataVersion, qsoCount: session.qsoCount, updatedAt: session.updatedAt };
      return ok({ session: changeSession, operation: "correction", qsoID: qso.qsoID, qsoCount: 1,
        score: { sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, revision: 4,
          qsos: 1, points: 1, multipliers: 1, claimedScore: 1, sourceVerification: "provisional" },
        currentTarget: qso, auditReference: { sessionID: session.sessionID, qsoID: qso.qsoID,
          requestID: params.requestID, revision: 4 }, receipt: { requestID: params.requestID,
          payloadDigest: params.payloadDigest, committedRevision: 4, committedAt: "2026-10-18T23:01:00Z" } });
    }
    if (method === "contest_draft_get") return ok({ session, draft: { ...draft, revision: session.revision } });
    if (method === "contest_scp_status") return ok({ available: false, reason: "No data" });
    throw new Error(`Unexpected ${method}`);
  });
  render(<ContestWorkspace request={request as ContestRequest} createRequestID={() => "naqp-correction-request"}
    digestPayload={async () => "a".repeat(64)} recoveryStorage={new MemoryContestRecoveryStorage()}/>);
  fireEvent.click(await screen.findByRole("button", { name: /NAQP correction/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit K1ABC" }));
  const editor = await screen.findByRole("form", { name: "Edit K1ABC" });
  fireEvent.change(within(editor).getByLabelText("Received Name"), { target: { value: "Sam" } });
  fireEvent.click(within(editor).getByRole("button", { name: "Save correction" }));
  await screen.findByText(/Saved K1ABC/);
  const correction = request.mock.calls.find(([method]) => method === "contest_qso_correct")![1] as any;
  expect(correction.payload.qso).toMatchObject({ receivedExchange: "Sam CT", normalizedReceivedExchange: "SAM CT",
    receivedExchangeFields: { name: "Sam", location: "CT" } });
  expect(qso).toMatchObject({ receivedExchange: "Sam CT", normalizedReceivedExchange: "SAM CT" });
});

it("renders an explicit empty multiplier display list as no credited multiplier", async () => {
  const { request } = fixture({ qsoSession: "session-1", emptyMultiplierDisplay: true });
  await open(request);
  const row = await screen.findByRole("row", { name: /K1ABC/ });
  expect(row.textContent).toContain("—");
  expect(row.textContent).not.toContain("wpx-prefix");
});

it("uses one synchronous correction action and keeps the editor on confirmed rejection", async () => {
  const gate = deferred(), delayed = fixture({ qsoSession: "session-1", change: gate.promise }); await open(delayed.request);
  fireEvent.click(await screen.findByRole("button", { name: "Edit K1ABC" })); await screen.findByRole("form", { name: "Edit K1ABC" });
  fireEvent.change(screen.getByLabelText("Callsign", { selector: ".contest-qso-editor input" }), { target: { value: "DL1AAA" } });
  const save = screen.getByRole("button", { name: "Save correction" }); fireEvent.click(save); fireEvent.click(save);
  await waitFor(() => expect(delayed.calls.filter(([method]) => method === "contest_qso_correct")).toHaveLength(1)); await act(async () => gate.resolve()); await screen.findByText(/Saved DL1AAA/);

  cleanup(); const rejected = fixture({ qsoSession: "session-1", rejectChange: true }); await open(rejected.request);
  fireEvent.click(await screen.findByRole("button", { name: "Edit K1ABC" })); const call = await screen.findByLabelText("Callsign", { selector: ".contest-qso-editor input" }); fireEvent.change(call, { target: { value: "DL1AAA" } }); fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await screen.findByText("Contact changed elsewhere."); expect((call as HTMLInputElement).value).toBe("DL1AAA"); expect(screen.queryByText("Save status unknown")).toBeNull();
});

it("requires one named deletion confirmation and refreshes the recalculated log", async () => {
  const { request, calls } = fixture({ qsoSession: "session-1" }); await open(request); fireEvent.click(await screen.findByRole("button", { name: "Edit K1ABC" })); await screen.findByRole("form", { name: "Edit K1ABC" });
  fireEvent.click(screen.getByRole("button", { name: "Delete contact" }));
  expect(screen.getByText("Delete K1ABC?")).toBeTruthy(); expect(screen.getByText(/recalculates score, multiplier, and duplicate credit/)).toBeTruthy(); expect(calls.some(([method]) => method === "contest_qso_delete")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" })); await screen.findByText("Deleted K1ABC. Score recalculated."); await screen.findByText("No QSOs in this contest.");
});

it("refreshes duplicate validation after correction and deletion while preserving the operating draft and serial", async () => {
  const deleting = fixture({ qsoSession: "session-2" });
  const deletingDraft = deleting.state.get("session-2")!.draft;
  deletingDraft.fields = { ...deletingDraft.fields, callsign: "K1ABC" };
  deletingDraft.dupe = { state: "duplicate", reason: "K1ABC is already worked on 20m." };
  await openWPX(deleting.request);
  expect((screen.getByRole("button", { name: "Log QSO" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(await screen.findByRole("button", { name: "Edit K1ABC" }));
  fireEvent.click(await screen.findByRole("button", { name: "Delete contact" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
  await screen.findByText("Not worked on this band.");
  expect((screen.getByRole("textbox", { name: "Contest callsign" }) as HTMLInputElement).value).toBe("K1ABC");
  expect(screen.getByRole("button", { name: "Serial 7" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "Log QSO" }) as HTMLButtonElement).disabled).toBe(false);

  cleanup();
  const correcting = fixture({ qsoSession: "session-2" });
  const correctingDraft = correcting.state.get("session-2")!.draft;
  correctingDraft.fields = { ...correctingDraft.fields, callsign: "DL1AAA" };
  await openWPX(correcting.request);
  fireEvent.click(await screen.findByRole("button", { name: "Edit K1ABC" }));
  fireEvent.change(await screen.findByLabelText("Callsign", { selector: ".contest-qso-editor input" }), { target: { value: "DL1AAA" } });
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await screen.findByText("DL1AAA is already worked on 20m.");
  expect((screen.getByRole("textbox", { name: "Contest callsign" }) as HTMLInputElement).value).toBe("DL1AAA");
  expect(screen.getByRole("button", { name: "Serial 7" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "Log QSO" }) as HTMLButtonElement).disabled).toBe(true);
});

it("keeps operating and editor frequency validation independent and allows deletion", async () => {
  const current = fixture({ qsoSession: "session-1" }); await open(current.request);
  const operatingFrequency = screen.getByLabelText("Frequency Hz") as HTMLInputElement;
  fireEvent.change(operatingFrequency, { target: { value: "abc" } });
  const log = screen.getByRole("button", { name: "Log QSO" }) as HTMLButtonElement;
  expect(log.disabled).toBe(true);
  fireEvent.click(await screen.findByRole("button", { name: "Edit K1ABC" }));
  await screen.findByRole("form", { name: "Edit K1ABC" });
  expect(operatingFrequency.value).toBe("abc"); expect(log.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Cancel contact edit" }));
  expect(screen.getByText("Frequency must contain digits only.")).toBeTruthy(); expect(log.disabled).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "Edit K1ABC" }));
  const editorFrequency = await screen.findByLabelText("Frequency Hz", { selector: ".contest-qso-editor input" }) as HTMLInputElement;
  fireEvent.change(editorFrequency, { target: { value: "bad" } });
  expect((screen.getByRole("button", { name: "Save correction" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Delete contact" }));
  const confirm = screen.getByRole("button", { name: "Confirm deletion" }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(false); fireEvent.click(confirm);
  await waitFor(() => expect(current.calls.some(([method]) => method === "contest_qso_delete")).toBe(true));
  expect((screen.getByLabelText("Frequency Hz") as HTMLInputElement).value).toBe("abc");
  expect(screen.getByText("Frequency must contain digits only.")).toBeTruthy(); expect(log.disabled).toBe(true);
});

it("keeps a malformed correction response uncertain with the edit buffer intact", async () => {
  const { request } = fixture({ qsoSession: "session-1", malformedChange: true }); await open(request); fireEvent.click(await screen.findByRole("button", { name: "Edit K1ABC" })); const call = await screen.findByLabelText("Callsign", { selector: ".contest-qso-editor input" }); fireEvent.change(call, { target: { value: "DL1AAA" } }); fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await screen.findByText("Save status unknown"); expect((call as HTMLInputElement).value).toBe("DL1AAA");
});

it("recovers an uncertain correction after remount by receipt or exact retry", async () => {
  for (const receiptCommitted of [true, false]) {
    const storage = new MemoryContestRecoveryStorage(), current = fixture({ qsoSession: "session-1", loseChange: true, receiptCommitted }); const view = await open(current.request, storage);
    fireEvent.click(await screen.findByRole("button", { name: "Edit K1ABC" })); fireEvent.change(await screen.findByLabelText("Callsign", { selector: ".contest-qso-editor input" }), { target: { value: "DL1AAA" } }); fireEvent.click(screen.getByRole("button", { name: "Save correction" })); await screen.findByText("Save status unknown");
    const original = current.calls.find(([method]) => method === "contest_qso_correct")![1]; view.unmount();
    const restartedRequest = ((method, params) => current.request(method, params)) as ContestRequest;
    render(<ContestWorkspace request={restartedRequest} createRequestID={ids()} digestPayload={digest} recoveryStorage={storage}/>); await screen.findByText("Save status unknown");
    fireEvent.click(screen.getByRole("button", { name: receiptCommitted ? "Check save status" : "Retry same save" }));
    if (receiptCommitted) await screen.findByText("Saved. Contest totals refreshed.");
    else { await screen.findByText("Saved."); expect(current.calls.filter(([method]) => method === "contest_qso_correct")[1][1]).toEqual(original); }
    cleanup();
  }
});

it("logs repeated report-free NAQP RTTY entries and preserves station exchange fields", async () => {
  const current = fixture();
  render(<ContestWorkspace request={current.request} createRequestID={ids()} digestPayload={digest} recoveryStorage={new MemoryContestRecoveryStorage()}/>);
  await screen.findByRole("option", { name: "North American QSO Party RTTY · 2026-rules-preview" });
  fireEvent.change(screen.getByLabelText("Contest"), { target: { value: "naqp-rtty" } });
  fireEvent.change(screen.getByLabelText("Session name"), { target: { value: "NAQP RTTY" } });
  fireEvent.change(screen.getByLabelText("Station callsign"), { target: { value: "K1AAA" } });
  fireEvent.change(screen.getByLabelText("Operator callsign"), { target: { value: "K1AAA" } });
  fireEvent.change(screen.getByLabelText("CQ zone"), { target: { value: "5" } });
  fireEvent.change(screen.getByLabelText("DXCC entity"), { target: { value: "United States" } });
  fireEvent.change(screen.getByLabelText("Station name"), { target: { value: "AL" } });
  fireEvent.change(screen.getByLabelText("Station location"), { target: { value: "ca" } });
  await waitFor(() => expect((screen.getByRole("button", { name: "Create and open" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Create and open" }));
  await screen.findByRole("form", { name: "RTTY contest entry" });
  expect(screen.getByLabelText("Received Name").getAttribute("data-contest-operator-field")).toBe("exchange");
  expect(screen.getByLabelText("Received Location").getAttribute("data-contest-operator-field")).toBe("exchange");
  expect(screen.queryByLabelText("Sent report")).toBeNull();
  expect(screen.queryByLabelText("Received report")).toBeNull();
  expect(screen.queryByRole("button", { name: /Reserve serial/ })).toBeNull();
  const sent = screen.getByLabelText("Sent exchange");
  expect(within(sent).getByText("Sent Name")).toBeTruthy();
  expect(within(sent).getByText("AL")).toBeTruthy();
  expect(within(sent).getByText("Sent Location")).toBeTruthy();
  expect(within(sent).getByText("CA")).toBeTruthy();
  expect(screen.getByText(/plain logging only/i)).toBeTruthy();

  for (const [call, name, location] of [["VE3AAA", "SAM", "ON"], ["K2AAA", "BOB", "NY"]]) {
    fireEvent.change(screen.getByLabelText("Contest callsign"), { target: { value: call } });
    fireEvent.change(screen.getByLabelText("Received Name"), { target: { value: name } });
    fireEvent.change(screen.getByLabelText("Received Location"), { target: { value: location } });
    await waitFor(() => expect(current.calls.some(([method, params]) => method === "contest_draft_apply" &&
      ((params.payload as {fields?:ContestDraftSnapshot["fields"]}).fields?.receivedExchange === `${name} ${location}`))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Log QSO" }));
    await screen.findByText(`Logged ${call}.`);
    expect((screen.getByLabelText("Received Name") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Received Location") as HTMLInputElement).value).toBe("");
  }
  const applies = current.calls.filter(([method]) => method === "contest_draft_apply");
  expect(applies.every(([, params]) => {
    const fields = (params.payload as {fields: ContestDraftSnapshot["fields"]}).fields;
    return fields.sentExchangeFields?.name === "AL" && fields.sentExchangeFields.location === "CA";
  })).toBe(true);
});

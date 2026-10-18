// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import workerFixtureJSON from "../../../docs/contesting/fixtures/contesting-worker-wire.json";
import exportFixtureJSON from "../../../docs/contesting/fixtures/contest-export-worker-wire.json";
import { ContestMutationUncertain } from "./client";
import { reviewedOperatorCapabilityDigest } from "./operatorCapabilities.generated";
import { ContestOperatorPanel, type ContestOperatorRecovery, type ContestSimulationAdapter } from "./ContestOperatorPanel";
import { isStructuredEntry, type ContestCommitResult, type ContestDraftResult, type ContestDraftSnapshot, type ContestOperatorCapability,
  type ContestOperatorReadiness, type ContestSessionSummary } from "./types";

const SOURCE = "7c8b499225a73f7f8f792246881bd7aefc05452f";
const NAQP_SOURCE = "0c98451d9dc4111dbb371c0a7d806a5ccd88624e21b1553672e9066c417064e8";
type WorkerDraftFixture = { responses: Record<string, { result?: { draft?: ContestDraftSnapshot } }> };
const workerFixture = workerFixtureJSON as unknown as WorkerDraftFixture;
const exportFixture = exportFixtureJSON as unknown as WorkerDraftFixture;
const generatedRules = (workerFixtureJSON as any).responses.catalog.result.rules as ContestSessionSummary["rule"][];
const WPX_BLANK_ERRORS = workerFixture.responses.commit.result!.draft!.validation.errors;
const WW_BLANK_ERRORS = exportFixture.responses.openAfterPrepare.result!.draft!.validation.errors;
const capability = (identity: ContestSessionSummary["rule"]["identity"]): ContestOperatorCapability => ({
  version: 1, auditDigest: reviewedOperatorCapabilityDigest(identity)!, policy: "simulated-run-sp-v1",
  output: "simulation-only", styles: ["run", "search-and-pounce"],
  macros: ["CQ", "EXCH", "QRZ", "AGN", "HISCALL", "MYCALL", "QSOB4"] });
const rule = (mode: "CW" | "SSB", serial: boolean): ContestSessionSummary["rule"] => {
  const identity = { id: serial ? mode === "CW" ? "cq-wpx-cw" as const : "cq-wpx-ssb" as const : mode === "CW" ? "cq-ww-cw" as const : "cq-ww-ssb" as const,
    version: "1.0.0-source-spike", edition: "source-26.10.11", sourceRevision: SOURCE };
  return { identity, displayName: serial ? `CQ WPX ${mode}` : `CQ WW ${mode}`, mode,
  entryDescriptorVersion: 1, entry: { mode, adifMode: mode, cabrilloQSOType: mode === "CW" ? "CW" : "PH",
    cabrilloFormatterVersion: mode === "CW" ? "pilot-1" : "ssb-pilot-1",
    cabrilloProjectionFormatterVersion: mode === "CW" ? "pilot-2" : "ssb-pilot-2",
    report: { format: mode === "CW" ? "cwRST" : "phoneRS", defaultSent: mode === "CW" ? "599" : "59",
      defaultReceived: mode === "CW" ? "599" : "59", maximumUTF8Bytes: mode === "CW" ? 3 : 2 },
    exchange: { sent: serial ? "serialNumber" : "cqZone", received: serial ? "serialNumber" : "cqZone",
      sentDefault: serial ? "reservedSerial" : "stationSnapshot", adifFields: serial ? "stxSrx" : "none" },
    serial: { requirement: serial ? "requiredForCommit" : "none", allowedScopes: serial ? ["session", "band", "transmitter"] : [] } },
  referenceDataVersion: "cty-test", sourceVerification: "verified", sourceNote: "Pinned test rule",
    operatorCapability: capability(identity) };
};
function session(mode: "CW" | "SSB", serial = false): ContestSessionSummary {
  const selected = rule(mode, serial);
  return { sessionID: "11111111-1111-4111-8111-111111111111", workspaceGeneration: "22222222-2222-4222-8222-222222222222",
    revision: 1, name: "Operator flow", rule: selected, referenceDataVersion: selected.referenceDataVersion,
    station: { callsign: "OM0RX", cqZone: "15", dxccEntity: "Slovak Republic" }, operator: { callsign: "OM0RX", category: "Single Operator" },
    qsoCount: 0, updatedAt: "2026-10-18T00:00:00.000Z" };
}
function readiness(value: ContestSessionSummary, fields: ContestDraftSnapshot["fields"], duplicate: ContestDraftSnapshot["dupe"]["state"] = "clear",
  reservedSerial: number | null = null, blocked = false): ContestOperatorReadiness {
  const callReady = !!fields.callsign.trim() && !blocked && duplicate !== "unchecked";
  const entry = value.rule.entry, structured = fields.receivedExchangeFields;
  const exchangeReady = isStructuredEntry(entry)
    ? !!structured && entry.exchange.receivedFields.every(field => !field.required || !!structured[field.id]?.trim())
    : !!fields.receivedExchange.trim();
  const serial = value.rule.entry.serial.requirement === "requiredForCommit";
  return { capabilityDigest: value.rule.operatorCapability!.auditDigest, callsign: fields.callsign.trim() ? callReady ? "ready" : "blocked" : "empty",
    exchange: exchangeReady ? blocked ? "blocked" : "ready" : "empty", canSendCQ: !fields.callsign.trim() && !blocked,
    canSendCall: callReady && duplicate === "clear", canSendDuplicate: callReady && duplicate === "duplicate",
    canReserveCall: serial && callReady && duplicate === "clear" && reservedSerial === null,
    canReserveCommit: serial && callReady && exchangeReady && duplicate === "clear" && reservedSerial === null,
    canCommit: callReady && exchangeReady && duplicate === "clear" && (!serial || reservedSerial !== null) };
}
function readyDraft(value: ContestSessionSummary, next: Omit<ContestDraftSnapshot, "operatorReadiness">, blocked = false): ContestDraftSnapshot {
  return { ...next, ...(value.rule.operatorCapability
    ? { operatorReadiness: readiness(value, next.fields, next.dupe.state, next.reservedSerial, blocked) }
    : {}) };
}
function draft(value: ContestSessionSummary, overrides: Partial<ContestDraftSnapshot["fields"]> = {}): ContestDraftSnapshot {
  const report = value.rule.entry.report.defaultSent;
  return readyDraft(value, { draftID: "33333333-3333-4333-8333-333333333333", sessionID: value.sessionID, workspaceGeneration: value.workspaceGeneration,
    revision: value.revision, fields: { callsign: "", sentReport: report, sentExchange: value.rule.entry.serial.requirement === "none" ? "15" : "",
      receivedReport: report, receivedExchange: "", frequencyHz: 14_025_000, band: "20m", mode: value.rule.mode, ...overrides },
    reservedSerial: null, validation: { errors: [], warnings: [] }, dupe: { state: "clear", reason: "Clear" }, updatedAt: value.updatedAt });
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function draftResult(current: ContestSessionSummary, next: ContestDraftSnapshot): ContestDraftResult {
  return { session: { ...current, revision: next.revision }, draft: next,
    receipt: { requestID: "44444444-4444-4444-8444-444444444444",
      payloadDigest: "a".repeat(64), committedRevision: next.revision, committedAt: "2026-10-18T00:00:01.000Z" } };
}
afterEach(cleanup);

function Harness({ mode, serial = false, duplicate = false, invalid = false, unchecked = false, workerBlank = false,
  workerMissingExchange = false, workerMissingSerial = false, invalidCall = "", uncertainCommit = false, reserveReplyGate, simulate }:
  { mode: "CW" | "SSB"; serial?: boolean; duplicate?: boolean; invalid?: boolean; unchecked?: boolean;
    workerBlank?: boolean; workerMissingExchange?: boolean; workerMissingSerial?: boolean; invalidCall?: string;
    uncertainCommit?: boolean; reserveReplyGate?: Promise<void>; simulate?: ContestSimulationAdapter }) {
  const [active, setActive] = useState(() => session(mode, serial));
  const [current, setCurrent] = useState(() => ({ ...draft(active), ...(duplicate ? { fields: { ...draft(active).fields, callsign: "K1ABC" }, dupe: { state: "duplicate" as const, reason: "Worked" } } : {}) }));
  const [editGeneration, setEditGeneration] = useState(0), [reserveCount, setReserveCount] = useState(0), [commitCount, setCommitCount] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [recovery, setRecovery] = useState<ContestOperatorRecovery>(null);
  const uncertainThrown = useRef(false);
  const ownerDirty = useRef(false);
  const admittedDraft = useRef(current);
  admittedDraft.current = current;
  const root = useRef<HTMLFormElement>(null);
  const reserve = async () => {
    setReserveCount(value => value + 1);
    const revision = current.revision + 1, next = { ...current, revision, reservedSerial: 7, fields: { ...current.fields, sentExchange: "007" },
      validation: { errors: current.fields.receivedExchange ? [] : ["Received serial must be a positive integer."], warnings: [] },
      dupe: { state: "clear" as const, reason: "Clear" } };
    admittedDraft.current = next; setActive(value => ({ ...value, revision })); setCurrent(next); await reserveReplyGate;
    return draftResult({ ...active, revision }, next);
  };
  const commit = async () => {
    setCommitCount(value => value + 1);
    if (uncertainCommit && !uncertainThrown.current) {
      uncertainThrown.current = true;
      throw new ContestMutationUncertain({ method: "contest_qso_commit", scope: { sessionID: active.sessionID,
        workspaceGeneration: active.workspaceGeneration, requestID: "77777777-7777-4777-8777-777777777777", expectedRevision: active.revision,
        draftID: current.draftID, payloadDigest: "b".repeat(64), operationTimestamp: "2026-10-18T00:00:01.000Z" }, payload: {} }, new Error("lost reply"));
    }
    const revision = current.revision + 1, next = { ...current, draftID: "55555555-5555-4555-8555-555555555555", revision,
      fields: { ...current.fields, callsign: "", receivedExchange: "", sentExchange: serial ? "" : current.fields.sentExchange }, reservedSerial: null,
      validation: { errors: serial ? WPX_BLANK_ERRORS : WW_BLANK_ERRORS, warnings: [] },
      dupe: { state: "unchecked" as const, reason: "Reload the contest session to check duplicate state." } };
    const result = { ...draftResult({ ...active, revision, qsoCount: active.qsoCount + 1 }, next),
      qso: { qsoID: "66666666-6666-4666-8666-666666666666", sessionID: active.sessionID, workedAt: "2026-10-18T00:00:01.000Z",
        callsign: current.fields.callsign, band: current.fields.band, mode, sentExchange: current.fields.sentExchange,
        receivedExchange: current.fields.receivedExchange, points: 3, multiplier: "K", isDupe: false },
      score: { sessionID: active.sessionID, workspaceGeneration: active.workspaceGeneration, revision, qsos: 1,
        points: 3, multipliers: 1, claimedScore: 3, sourceVerification: "verified" as const } } satisfies ContestCommitResult;
    admittedDraft.current = next; setActive(result.session); setCurrent(next); return result;
  };
  const recover = (exact: boolean) => { const revision = current.revision + 1, next = { ...current, draftID: "88888888-8888-4888-8888-888888888888", revision,
    fields: { ...current.fields, callsign: "", receivedExchange: "" } }; setActive(value => ({ ...value, revision, qsoCount: value.qsoCount + 1 }));
    setCurrent(next); setRecovery({ sequence: exact ? 2 : 1, method: "contest_qso_commit", sessionID: active.sessionID,
      workspaceGeneration: active.workspaceGeneration, requestID: exact ? "77777777-7777-4777-8777-777777777777" : "99999999-9999-4999-8999-999999999999",
      payloadDigest: exact ? "b".repeat(64) : "c".repeat(64) }); };
  useEffect(() => {
    if (!invalid && !unchecked && !workerBlank && !workerMissingExchange && !workerMissingSerial && !invalidCall) return;
    setCurrent(value => ({ ...value, fields: { ...value.fields,
      callsign: workerBlank ? "" : invalidCall || "K1ABC", receivedExchange: workerBlank || workerMissingExchange ? "" : workerMissingSerial ? "123" : "99",
      ...(workerMissingSerial ? { sentExchange: "" } : {}) },
      validation: { errors: workerBlank ? (serial ? WPX_BLANK_ERRORS : WW_BLANK_ERRORS) : invalidCall ? ["A valid callsign is required."] :
        workerMissingExchange ? [serial ? "Received serial must be a positive integer." : "CQ zone must be an integer from 1 through 40."] :
        workerMissingSerial ? ["Sent serial must be a positive integer."] : invalid ? ["CQ zone must be an integer from 1 through 40."] : [], warnings: [] },
      dupe: workerBlank || unchecked || invalidCall ? { state: "unchecked", reason: "Awaiting authoritative dupe check" } : value.dupe }));
  }, [invalid, invalidCall, serial, unchecked, workerBlank, workerMissingExchange, workerMissingSerial]);
  const presented = readyDraft(active, current, invalid || unchecked || !!invalidCall);
  return <><form ref={root}><ContestOperatorPanel session={active} draft={presented} entryRoot={root} editGeneration={editGeneration}
    disabled={blocked} recovery={recovery} reserveSerial={reserve} commitQSO={commit}
    admitIntent={identity => !ownerDirty.current && `${admittedDraft.current.draftID}@${admittedDraft.current.revision}` === identity}
    guardFormSubmit={() => {}}
    focusField={field => document.querySelector<HTMLInputElement>(`[data-contest-operator-field=${field}]`)?.focus()} simulateOutput={simulate}/>
    <input aria-label="Call" data-contest-operator-field="callsign" value={current.fields.callsign} onChange={event => { setEditGeneration(value => value + 1);
      const next = { ...admittedDraft.current, fields: { ...admittedDraft.current.fields, callsign: event.target.value.toUpperCase() } }; admittedDraft.current = next; setCurrent(next); }}/>
    <input aria-label="Exchange" data-contest-operator-field="exchange" value={current.fields.receivedExchange} onChange={event => { setEditGeneration(value => value + 1);
      const next = { ...admittedDraft.current, fields: { ...admittedDraft.current.fields, receivedExchange: event.target.value } }; admittedDraft.current = next; setCurrent(next); }}/>
    <input aria-label="Unrelated note" defaultValue="notes"/>
    </form><button onClick={() => setBlocked(true)}>Block entry</button><button onClick={() => setBlocked(false)}>Unblock entry</button><button onClick={() => { ownerDirty.current = true;
      setEditGeneration(value => value + 1); setCurrent(value => ({ ...value, fields: { ...value.fields, callsign: "K1ABD" } })); }}>Edit before admission</button>
      <output data-testid="owner-draft">{current.revision}/{current.reservedSerial ?? "none"}</output>
      {uncertainCommit && <><button onClick={() => recover(false)}>Recover wrong mutation</button>
      <button onClick={() => recover(true)}>Recover mutation</button></>}<output data-testid="calls">{reserveCount}/{commitCount}</output></>;
}

function naqpSession(mode: "CW" | "SSB" | "RTTY", overrides: Partial<ContestSessionSummary["rule"]> = {}): ContestSessionSummary {
  const field = (id: "name" | "location", sent: boolean) => ({ id, label: id === "name" ? "Name" : "Location",
    acceptedKinds: id === "name" ? ["operatorName" as const] : ["subdivision" as const, "dxccPrefix" as const], required: id === "name" || !sent,
    maximumUTF8Bytes: id === "name" ? 32 : 8, adifField: `${sent ? "MY_" : ""}${id === "name" ? "NAME" : "STATE"}` as "MY_NAME" | "MY_STATE" | "NAME" | "STATE" });
  const rule: ContestSessionSummary["rule"] = { identity: { id: `naqp-${mode.toLowerCase()}` as "naqp-cw" | "naqp-ssb" | "naqp-rtty",
    version: "1.0.0-2026-rules-preview", edition: "2026-rules-preview", sourceRevision: NAQP_SOURCE },
    displayName: `NAQP ${mode}`, mode, entryDescriptorVersion: 2, entry: { version: 2, mode, adifMode: mode,
      cabrilloQSOType: mode === "CW" ? "CW" : mode === "SSB" ? "PH" : "RY", cabrilloFormatterVersion: "naqp-preview-1",
      cabrilloProjectionFormatterVersion: "naqp-preview-1", report: { format: "none", defaultSent: "", defaultReceived: "", maximumUTF8Bytes: 0 },
      exchange: { sent: "structured", received: "structured", sentDefault: "stationFields", adifFields: "exchangeStrings",
        sentFields: [field("name", true), field("location", true)], receivedFields: [field("name", false), field("location", false)] },
      serial: { requirement: "none", allowedScopes: [] }, modeProfiles: [{ mode, adifMode: mode, adifSubmode: null,
        cabrilloQSOType: mode === "CW" ? "CW" : mode === "SSB" ? "PH" : "RY",
        report: { format: "none", defaultSent: "", defaultReceived: "", maximumUTF8Bytes: 0 } }], scorePolicy: "pointsTimesMultipliers" },
    referenceDataVersion: "cty-test", sourceVerification: "verified", sourceNote: "Pinned NAQP test rule",
    ...(mode === "RTTY" ? {} : { operatorCapability: capability({ id: `naqp-${mode.toLowerCase()}` as "naqp-cw" | "naqp-ssb",
      version: "1.0.0-2026-rules-preview", edition: "2026-rules-preview", sourceRevision: NAQP_SOURCE }) }), ...overrides };
  return { sessionID: "a1111111-1111-4111-8111-111111111111", workspaceGeneration: "a2222222-2222-4222-8222-222222222222",
    revision: 1, name: "NAQP operator", rule, referenceDataVersion: rule.referenceDataVersion,
    station: { callsign: "K1AAA", cqZone: "5", dxccEntity: "United States", exchangeFields: { name: "AL", location: "CA" },
      stationFields: { name: "AL", location: "CA" } }, operator: { callsign: "K1AAA", category: "Single Operator" },
    qsoCount: 0, updatedAt: "2026-10-18T00:00:00.000Z" };
}

function StructuredHarness({ mode, ruleOverrides, duplicate = false, invalidPartialLocation = false, simulate = async () => {} }:
  { mode: "CW" | "SSB" | "RTTY"; ruleOverrides?: Partial<ContestSessionSummary["rule"]>; duplicate?: boolean;
    invalidPartialLocation?: boolean; simulate?: ContestSimulationAdapter }) {
  const [active, setActive] = useState(() => naqpSession(mode, ruleOverrides));
  const blank = (value: ContestSessionSummary): ContestDraftSnapshot => ({ draftID: "a3333333-3333-4333-8333-333333333333",
    sessionID: value.sessionID, workspaceGeneration: value.workspaceGeneration, revision: value.revision,
    fields: { callsign: "", sentReport: "", sentExchange: "AL CA", receivedReport: "", receivedExchange: "", frequencyHz: mode === "SSB" ? 14_250_000 : 14_050_000,
      band: "20m", mode, sentExchangeFields: { name: "AL", location: "CA" }, receivedExchangeFields: { name: "", location: "" } },
    reservedSerial: null, validation: { errors: ["A required exchange field is missing.", "A required exchange field is missing.",
      "A valid callsign is required.", "Resolved contest geography is missing or invalid."], warnings: [] },
    dupe: { state: "unchecked", reason: "Awaiting authoritative dupe check" }, updatedAt: value.updatedAt });
  const [current, setCurrent] = useState(() => blank(active));
  const [commits, setCommits] = useState(0), [reserves, setReserves] = useState(0), [editGeneration, setEditGeneration] = useState(0);
  const root = useRef<HTMLFormElement>(null), admitted = useRef(current); admitted.current = current;
  const update = (fields: ContestDraftSnapshot["fields"]) => { const received = fields.receivedExchangeFields ?? {}, call = fields.callsign.trim();
    const missing = [received.name, received.location].filter(value => !value?.trim()).map(() => "A required exchange field is missing.");
    const callShape = /^[A-Z0-9]+(?:\/[A-Z0-9]+)*$/.test(call) && /[A-Z]/.test(call) && /\d/.test(call);
    const next = { ...admitted.current, fields: { ...fields,
      receivedExchange: [received.name, received.location].filter(Boolean).join(" ") },
      validation: { errors: [...missing, ...(!received.name?.trim() ? ["NAQP name is required."] : !received.location?.trim() ?
        ["North American exchange location must match resolved geography.", "Received location does not match the resolved North American entity."] : []),
        ...(callShape ? [] : ["A valid callsign is required."]),
        ...(call ? [] : ["Resolved contest geography is missing or invalid."])], warnings: [] },
      dupe: callShape ? invalidPartialLocation && !received.name?.trim() && received.location === "CA" &&
        (call === "DL1ABC" || call === "K1ABC/MM") ? { state: "unchecked" as const, reason: "Validation must complete before dupe checking" } :
        duplicate && call === "VE3AAA" ? { state: "duplicate" as const, reason: "Worked on this band" } :
        { state: "clear" as const, reason: "Clear" } : { state: "unchecked" as const, reason: "Awaiting authoritative dupe check" } };
    admitted.current = next; setCurrent(next); setEditGeneration(value => value + 1); };
  const commit = async () => { setCommits(value => value + 1); const revision = active.revision + 1, next = { ...blank(active), revision,
    draftID: "a5555555-5555-4555-8555-555555555555" }; setActive(value => ({ ...value, revision, qsoCount: value.qsoCount + 1 })); admitted.current = next; setCurrent(next);
    return { ...draftResult({ ...active, revision, qsoCount: active.qsoCount + 1 }, next), qso: { qsoID: "a6666666-6666-4666-8666-666666666666",
      sessionID: active.sessionID, workedAt: "2026-10-18T00:00:01.000Z", callsign: current.fields.callsign, band: "20m", mode,
      sentExchange: current.fields.sentExchange, receivedExchange: current.fields.receivedExchange, points: 1, multiplier: "CA", isDupe: false },
      score: { sessionID: active.sessionID, workspaceGeneration: active.workspaceGeneration, revision, qsos: 1, points: 1, multipliers: 1,
        claimedScore: 1, sourceVerification: "verified" as const } } satisfies ContestCommitResult; };
  const presented = mode === "RTTY" ? current : readyDraft(active, current, invalidPartialLocation);
  return <><form ref={root}><ContestOperatorPanel session={active} draft={presented} entryRoot={root} editGeneration={editGeneration} disabled={false}
    recovery={null} reserveSerial={async () => { setReserves(value => value + 1); throw new Error("NAQP must not reserve serials"); }} commitQSO={commit}
    admitIntent={identity => `${admitted.current.draftID}@${admitted.current.revision}` === identity} guardFormSubmit={() => {}} focusField={() => {}} simulateOutput={simulate}/>
    <input aria-label="Call" data-contest-operator-field="callsign" value={current.fields.callsign} onChange={event => update({ ...current.fields, callsign: event.target.value.toUpperCase() })}/>
    <input aria-label="Received Name" data-contest-operator-field="exchange" value={current.fields.receivedExchangeFields?.name ?? ""} onChange={event => update({ ...current.fields,
      receivedExchangeFields: { ...current.fields.receivedExchangeFields, name: event.target.value.toUpperCase() } })}/>
    <input aria-label="Received Location" data-contest-operator-field="exchange" value={current.fields.receivedExchangeFields?.location ?? ""} onChange={event => update({ ...current.fields,
      receivedExchangeFields: { ...current.fields.receivedExchangeFields, location: event.target.value.toUpperCase() } })}/></form>
    <output data-testid="structured-calls">{reserves}/{commits}</output></>;
}

function StructuredReportHarness({ ruleID, simulate }: { ruleID: "jidx-cw" | "jidx-ssb" | "arrl-dx-cw" | "arrl-dx-ssb";
  simulate: ContestSimulationAdapter }) {
  const selected = generatedRules.find(item => item.identity.id === ruleID)!;
  const active: ContestSessionSummary = { ...session(selected.mode as "CW" | "SSB"), rule: selected,
    station: { callsign: ruleID.startsWith("arrl-dx-") ? "K1AAA" : "OM0RX", cqZone: "15", dxccEntity: "United States" } };
  const sentExchangeFields: Record<string, string> = ruleID.startsWith("jidx-") ? { number: "15" } : { location: "CT", power: "" };
  const receivedExchangeFields: Record<string, string> = ruleID.startsWith("jidx-") ? { number: "14" } : { location: "DX", power: "100" };
  const current: ContestDraftSnapshot = { ...draft(active), fields: { ...draft(active).fields, callsign: "JA1AAA",
    mode: selected.mode, sentReport: selected.entry.report.defaultSent, receivedReport: selected.entry.report.defaultReceived,
    sentExchange: Object.values(sentExchangeFields).filter(Boolean).join(" "), receivedExchange: Object.values(receivedExchangeFields).filter(Boolean).join(" "),
    sentExchangeFields, receivedExchangeFields }, validation: { errors: [], warnings: [] }, dupe: { state: "clear", reason: "Clear" },
    operatorReadiness: { capabilityDigest: selected.operatorCapability!.auditDigest, callsign: "ready", exchange: "ready",
      canSendCQ: false, canSendCall: true, canSendDuplicate: false, canReserveCall: false, canReserveCommit: false, canCommit: true } };
  const root = useRef<HTMLFormElement>(null);
  return <form ref={root}><ContestOperatorPanel session={active} draft={current} entryRoot={root} editGeneration={0} disabled={false}
    recovery={null} reserveSerial={async () => { throw new Error("No reservation expected"); }}
    commitQSO={() => new Promise<ContestCommitResult>(() => {})} admitIntent={() => true} guardFormSubmit={() => {}}
    focusField={() => {}} simulateOutput={simulate}/><input aria-label="Exchange" data-contest-operator-field="exchange"/></form>;
}

function MixedModeHarness({ firstOutput, simulate, initialCall = false }: { firstOutput: Promise<void>; simulate: ContestSimulationAdapter; initialCall?: boolean }) {
  const base = generatedRules.find(item => item.identity.id === "jidx-ssb")!;
  const selected: ContestSessionSummary["rule"] = { ...base,
    identity: { id: "operator-authored-mixed", version: "1", edition: "test", sourceRevision: "d".repeat(64) },
    supportedModes: ["SSB", "AM"], entry: { ...base.entry, modeProfiles: [
      { mode: "SSB", adifMode: "SSB", adifSubmode: null, cabrilloQSOType: "PH", report: { format: "phoneRS", defaultSent: "59", defaultReceived: "59", maximumUTF8Bytes: 2 } },
      { mode: "AM", adifMode: "AM", adifSubmode: null, cabrilloQSOType: "PH", report: { format: "phoneRS", defaultSent: "59", defaultReceived: "59", maximumUTF8Bytes: 2 } },
    ] }, operatorCapability: { ...base.operatorCapability!, auditDigest: "d".repeat(64), signalProfiles: [
      { mode: "SSB", signal: "phone" }, { mode: "AM", signal: "phone" },
    ] } };
  const [active] = useState<ContestSessionSummary>(() => ({ ...session("SSB"), rule: selected }));
  const makeReadiness = (call: string): ContestOperatorReadiness => ({ capabilityDigest: selected.operatorCapability!.auditDigest,
    callsign: call ? "ready" : "empty", exchange: "empty", canSendCQ: !call, canSendCall: !!call,
    canSendDuplicate: false, canReserveCall: false, canReserveCommit: false, canCommit: false });
  const [current, setCurrent] = useState<ContestDraftSnapshot>(() => ({ ...draft(active),
    fields: { ...draft(active).fields, callsign: initialCall ? "K1ABC" : "", mode: "SSB", sentReport: "59", receivedReport: "59", sentExchange: "15",
      sentExchangeFields: { number: "15" }, receivedExchangeFields: { number: "" } },
    operatorReadiness: makeReadiness(initialCall ? "K1ABC" : "") }));
  const [editGeneration, setEditGeneration] = useState(0), [commits, setCommits] = useState(0), first = useRef(true), root = useRef<HTMLFormElement>(null);
  const [settledMode, setSettledMode] = useState(current.fields.mode);
  useEffect(() => { setSettledMode(current.fields.mode); }, [current.fields.mode]);
  const output: ContestSimulationAdapter = async entry => { await simulate(entry); if (first.current) { first.current = false; await firstOutput; } };
  const apply = (mode: "SSB" | "AM", callsign = current.fields.callsign) => setCurrent(value => ({ ...value,
    fields: { ...value.fields, mode, callsign }, operatorReadiness: makeReadiness(callsign) }));
  return <><form ref={root}><ContestOperatorPanel session={active} draft={current} entryRoot={root} editGeneration={editGeneration} disabled={false}
    recovery={null} reserveSerial={async () => { throw new Error("No reservation expected"); }}
    commitQSO={() => { setCommits(value => value + 1); return new Promise<ContestCommitResult>(() => {}); }} admitIntent={() => true} guardFormSubmit={() => {}}
    focusField={() => {}} simulateOutput={output}/><input aria-label="Call" data-contest-operator-field="callsign"/></form>
    <button onClick={() => setEditGeneration(value => value + 1)}>Request AM</button>
    <button onClick={() => apply("AM")}>Apply AM</button>
    <button onClick={() => { setEditGeneration(value => value + 1); apply("AM", "K1ABC"); }}>Set AM call</button>
    <output data-testid="settled-mode">{settledMode}</output><output data-testid="mixed-commits">{commits}</output></>;
}

describe("ContestOperatorPanel simulated owner integration", () => {
  it.each(["CW", "SSB"] as const)("runs and logs a corrected %s contact only through visible simulation", async mode => {
    const sent: string[] = []; render(<Harness mode={mode} simulate={async entry => { sent.push(`${entry.macro}:${entry.text}`); }}/ >);
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); const call = screen.getByLabelText("Call");
    fireEvent.change(call, { target: { value: "K1ABC" } }); fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(call, { key: "Enter" }); await waitFor(() => expect(sent.map(x => x.split(":")[0])).toEqual(["HISCALL", "EXCH"]));
    fireEvent.change(call, { target: { value: "K1ABD" } }); const exchange = screen.getByLabelText("Exchange"); fireEvent.change(exchange, { target: { value: "05" } });
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(exchange, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("calls").textContent).toBe("0/1"));
    expect(sent.map(x => x.split(":")[0])).toEqual(["HISCALL", "EXCH", "HISCALL", "QRZ"]);
    expect(screen.getByText(/no CW, voice, PTT, audio, or radio output/i)).toBeTruthy();
  });

  it.each(["CW", "SSB"] as const)("waits for a WPX %s serial successor, ignores double Enter, then commits S&P", async mode => {
    const gate = deferred(), sent: string[] = [];
    const view = render(<Harness mode={mode} serial simulate={async entry => { sent.push(entry.macro); if (entry.macro === "EXCH") await gate.promise; }}/ >);
    fireEvent.change(screen.getByLabelText("Call"), { target: { value: "K1ABC" } }); fireEvent.change(screen.getByLabelText("Exchange"), { target: { value: "123" } });
    await act(async () => {});
    fireEvent.change(screen.getByLabelText("Operating style"), { target: { value: "search-and-pounce" } }); fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(screen.getByLabelText("Exchange"), { key: "Enter" }); fireEvent.keyDown(screen.getByLabelText("Exchange"), { key: "Enter" });
    await waitFor(() => expect(screen.getByText(`${mode === "CW" ? "599" : "59"} 007`, { selector: ".contest-operator-trace strong" })).toBeTruthy());
    expect(screen.getByTestId("calls").textContent).toBe("1/0");
    await act(async () => gate.resolve()); await waitFor(() => expect(screen.getByTestId("calls").textContent).toBe("1/1"));
    expect(sent).toEqual(["EXCH"]); view.unmount();
  });

  it("continues from an owner successor that rendered before the reserve reply settles", async () => {
    const reply = deferred(), sent: string[] = [];
    render(<Harness mode="CW" serial reserveReplyGate={reply.promise} simulate={async entry => { sent.push(entry.macro); }}/>);
    fireEvent.change(screen.getByLabelText("Call"), { target: { value: "K1ABC" } });
    fireEvent.change(screen.getByLabelText("Exchange"), { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText("Operating style"), { target: { value: "search-and-pounce" } });
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(screen.getByLabelText("Exchange"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("calls").textContent).toBe("1/0"));
    await waitFor(() => expect(screen.getByTestId("owner-draft").textContent).toBe("2/7"));
    expect(sent).toEqual([]);
    await act(async () => reply.resolve());
    await waitFor(() => expect(screen.getByTestId("calls").textContent).toBe("1/1"));
    expect(sent).toEqual(["EXCH"]);
  });

  it("waits for the owner to become enabled after the reserved successor and reply are both ready", async () => {
    const reply = deferred(), sent: string[] = [];
    render(<Harness mode="CW" serial reserveReplyGate={reply.promise} simulate={async entry => { sent.push(entry.macro); }}/>);
    fireEvent.change(screen.getByLabelText("Call"), { target: { value: "K1ABC" } });
    fireEvent.change(screen.getByLabelText("Exchange"), { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText("Operating style"), { target: { value: "search-and-pounce" } });
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(screen.getByLabelText("Exchange"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("owner-draft").textContent).toBe("2/7"));
    fireEvent.click(screen.getByRole("button", { name: "Block entry" }));
    await act(async () => reply.resolve());
    expect(sent).toEqual([]); expect(screen.getByTestId("calls").textContent).toBe("1/0");
    fireEvent.click(screen.getByRole("button", { name: "Unblock entry" }));
    await waitFor(() => expect(screen.getByTestId("calls").textContent).toBe("1/1"));
    expect(sent).toEqual(["EXCH"]);
  });

  it.each(["edit", "escape"] as const)("revokes the reserved continuation on delayed-reply %s", async action => {
    const reply = deferred(), sent: string[] = [];
    render(<Harness mode="CW" serial reserveReplyGate={reply.promise} simulate={async entry => { sent.push(entry.macro); }}/>);
    fireEvent.change(screen.getByLabelText("Call"), { target: { value: "K1ABC" } });
    fireEvent.change(screen.getByLabelText("Exchange"), { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText("Operating style"), { target: { value: "search-and-pounce" } });
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(screen.getByLabelText("Exchange"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("owner-draft").textContent).toBe("2/7"));
    if (action === "edit") fireEvent.click(screen.getByRole("button", { name: "Edit before admission" }));
    else fireEvent.keyDown(screen.getByLabelText("Exchange"), { key: "Escape" });
    await act(async () => reply.resolve()); await act(async () => {});
    expect(sent).toEqual([]); expect(screen.getByTestId("calls").textContent).toBe("1/0");
    expect(screen.getByRole("button", { name: "Arm simulation" })).toBeTruthy();
  });

  it("sends QSOB4 for a duplicate and never mutates the contest", async () => {
    const sent: string[] = []; render(<Harness mode="CW" duplicate simulate={async entry => { sent.push(entry.macro); }}/ >);
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(screen.getByLabelText("Call"), { key: "Enter" });
    await waitFor(() => expect(sent).toEqual(["QSOB4"])); expect(screen.getByTestId("calls").textContent).toBe("0/0");
  });

  it("stops a delayed sequence on Escape and guards repeat, IME, and unrelated inputs", async () => {
    const gate = deferred(), sent: string[] = []; render(<Harness mode="CW" simulate={async entry => { sent.push(entry.macro); await gate.promise; }}/ >);
    const call = screen.getByLabelText("Call"); fireEvent.keyDown(call, { key: "Enter", repeat: true }); fireEvent.keyDown(call, { key: "Enter", isComposing: true });
    fireEvent.keyDown(screen.getByLabelText("Unrelated note"), { key: "F1" });
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(call, { key: "Enter" }); fireEvent.keyDown(call, { key: "Escape" });
    await act(async () => gate.resolve()); await waitFor(() => expect(sent).toEqual(["CQ"]));
    expect(screen.getByRole("button", { name: "Arm simulation" })).toBeTruthy(); expect(screen.getByText("stopped", { selector: ".contest-operator-trace small" })).toBeTruthy();
    expect(screen.getByTestId("calls").textContent).toBe("0/0");
  });

  it("maps function keys only from guarded contest entry fields", async () => {
    const sent: string[] = []; render(<Harness mode="CW" simulate={async entry => { sent.push(entry.macro); }}/ >);
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(screen.getByLabelText("Unrelated note"), { key: "F1" });
    fireEvent.keyDown(screen.getByLabelText("Call"), { key: "F1" }); await waitFor(() => expect(sent).toEqual(["CQ"]));
    expect(screen.getByTestId("calls").textContent).toBe("0/0");
  });

  it("rejects authoritative validation failures and indeterminate duplicate state", async () => {
    const invalidOutput = vi.fn(); const invalidView = render(<Harness mode="CW" invalid simulate={invalidOutput}/>);
    await waitFor(() => expect((screen.getByLabelText("Exchange") as HTMLInputElement).value).toBe("99"));
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(screen.getByLabelText("Exchange"), { key: "Enter" });
    expect(invalidOutput).not.toHaveBeenCalled(); expect(screen.getByTestId("calls").textContent).toBe("0/0"); invalidView.unmount();
    const uncheckedOutput = vi.fn(); render(<Harness mode="CW" unchecked simulate={uncheckedOutput}/>);
    await waitFor(() => expect((screen.getByLabelText("Call") as HTMLInputElement).value).toBe("K1ABC"));
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(screen.getByLabelText("Call"), { key: "Enter" });
    expect(uncheckedOutput).not.toHaveBeenCalled(); expect(screen.getByTestId("calls").textContent).toBe("0/0");
    cleanup();
    for (const invalidCall of ["ABC", "K1ABC//P"]) {
      const malformedOutput = vi.fn(), view = render(<Harness mode="CW" invalidCall={invalidCall} simulate={malformedOutput}/>); await act(async () => {});
      fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(screen.getByLabelText("Call"), { key: "Enter" });
      expect(malformedOutput).not.toHaveBeenCalled(); view.unmount();
    }
  });

  it("follows the latest simulated output until the operator scrolls away", async () => {
    const simulate = vi.fn(async () => {});
    render(<Harness mode="CW" simulate={simulate}/>);
    const call = screen.getByLabelText("Call"), trace = screen.getByLabelText("Simulated output trace");
    let height = 200;
    Object.defineProperty(trace, "clientHeight", { configurable: true, value: 100 });
    Object.defineProperty(trace, "scrollHeight", { configurable: true, get: () => height });
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));

    fireEvent.keyDown(call, { key: "F1" });
    await waitFor(() => expect(simulate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(trace.scrollTop).toBe(200));

    trace.scrollTop = 20; fireEvent.scroll(trace); height = 300;
    fireEvent.keyDown(call, { key: "F1" });
    await waitFor(() => expect(simulate).toHaveBeenCalledTimes(2));
    expect(trace.scrollTop).toBe(20);

    trace.scrollTop = 200; fireEvent.scroll(trace); height = 400;
    fireEvent.keyDown(call, { key: "F1" });
    await waitFor(() => expect(simulate).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(trace.scrollTop).toBe(400));
  });

  it.each([["CW", false], ["SSB", false], ["CW", true], ["SSB", true]] as const)(
    "admits blank %s CQ from the complete worker fixture validation set (serial=%s)", async (mode, serial) => {
    const cqOutput = vi.fn(); render(<Harness mode={mode} serial={serial} workerBlank simulate={cqOutput}/>); await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(screen.getByLabelText("Call"), { key: "Enter" });
    await waitFor(() => expect(cqOutput).toHaveBeenCalledWith(expect.objectContaining({ macro: "CQ" })));
  });

  it("admits incomplete AGN from a worker-shaped partial draft", async () => {
    const agnOutput = vi.fn(); const agn = render(<Harness mode="CW" workerMissingExchange simulate={agnOutput}/>); await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(screen.getByLabelText("Exchange"), { key: "Enter" });
    await waitFor(() => expect(agnOutput).toHaveBeenCalledWith(expect.objectContaining({ macro: "AGN" }))); agn.unmount();
  });

  it.each([["CW", false], ["SSB", false], ["CW", true], ["SSB", true]] as const)(
    "can call CQ from the actual blank successor after a confirmed %s commit (serial=%s)", async (mode, serial) => {
    const sent: string[] = []; render(<Harness mode={mode} serial={serial} simulate={async entry => { sent.push(entry.macro); }}/>);
    const call = screen.getByLabelText("Call"), exchange = screen.getByLabelText("Exchange");
    fireEvent.change(call, { target: { value: "K1ABC" } }); fireEvent.change(exchange, { target: { value: serial ? "123" : "05" } });
    if (serial) fireEvent.change(screen.getByLabelText("Operating style"), { target: { value: "search-and-pounce" } });
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(exchange, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("calls").textContent).toMatch(/\/1$/));
    await waitFor(() => expect((call as HTMLInputElement).value).toBe(""));
    if (serial) fireEvent.change(screen.getByLabelText("Operating style"), { target: { value: "run" } });
    const arm = screen.queryByRole("button", { name: "Arm simulation" }); if (arm) fireEvent.click(arm);
    fireEvent.keyDown(call, { key: "Enter" });
    await waitFor(() => expect(sent.at(-1)).toBe("CQ"));
  });

  it.each(["CW", "SSB"] as const)("auto-reserves WPX %s in Run before receiving the exchange", async mode => {
    const wpxOutput = vi.fn(); render(<Harness mode={mode} serial workerMissingExchange workerMissingSerial simulate={wpxOutput}/>);
    await act(async () => {});
    const call = screen.getByLabelText("Call"); fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(call, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("calls").textContent).toBe("1/0"));
    await waitFor(() => expect(wpxOutput).toHaveBeenCalledWith(expect.objectContaining({ macro: "HISCALL" })));
    await waitFor(() => expect(wpxOutput).toHaveBeenCalledWith(expect.objectContaining({ macro: "EXCH", text: expect.stringContaining("007") })));
  });

  it("auto-reserves WPX S&P with a completed received exchange", async () => {
    const wpxOutput = vi.fn(); render(<Harness mode="CW" serial workerMissingSerial simulate={wpxOutput}/>);
    await waitFor(() => expect((screen.getByLabelText("Exchange") as HTMLInputElement).value).toBe("123"));
    fireEvent.change(screen.getByLabelText("Operating style"), { target: { value: "search-and-pounce" } });
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(screen.getByLabelText("Exchange"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("calls").textContent).toBe("1/1"));
    expect(wpxOutput).toHaveBeenCalledWith(expect.objectContaining({ macro: "EXCH", text: expect.stringContaining("007") }));
  });

  it("blocks armed keys when the owner becomes busy", () => {
    const simulate = vi.fn(); render(<Harness mode="CW" simulate={simulate}/>);
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.click(screen.getByRole("button", { name: "Block entry" }));
    fireEvent.keyDown(screen.getByLabelText("Call"), { key: "Enter" }); expect(simulate).not.toHaveBeenCalled();
    expect(screen.getByTestId("calls").textContent).toBe("0/0");
  });

  it("does not reserve or commit an edited draft after keyboard intent capture", async () => {
    render(<Harness mode="CW" serial/>); const call = screen.getByLabelText("Call"), exchange = screen.getByLabelText("Exchange");
    fireEvent.change(call, { target: { value: "K1ABC" } }); fireEvent.change(exchange, { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText("Operating style"), { target: { value: "search-and-pounce" } });
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    act(() => { fireEvent.keyDown(exchange, { key: "Enter" }); fireEvent.click(screen.getByRole("button", { name: "Edit before admission" })); });
    await act(async () => {}); expect(screen.getByTestId("calls").textContent).toBe("0/0");
  });

  it("disarms and cancels the remaining sequence when operating style changes", async () => {
    const gate = deferred(), sent: string[] = []; render(<Harness mode="SSB" simulate={async entry => { sent.push(entry.macro); await gate.promise; }}/ >);
    const call = screen.getByLabelText("Call"); fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(call, { key: "Enter" });
    fireEvent.change(screen.getByLabelText("Operating style"), { target: { value: "search-and-pounce" } });
    await act(async () => gate.resolve()); await waitFor(() => expect(sent).toEqual(["CQ"]));
    expect(screen.getByRole("button", { name: "Arm simulation" })).toBeTruthy(); expect(screen.getByLabelText("Operating style")).toHaveProperty("value", "search-and-pounce");
  });

  it("settles a delayed send cancelled by an edit and can be armed again", async () => {
    const gate = deferred(), sent: string[] = []; let first = true;
    render(<Harness mode="CW" simulate={async entry => { sent.push(entry.macro); if (first) { first = false; await gate.promise; } }}/>);
    const call = screen.getByLabelText("Call"); fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(call, { key: "Enter" }); fireEvent.change(call, { target: { value: "K1ABC" } }); await act(async () => gate.resolve());
    await waitFor(() => expect(screen.getByRole("button", { name: "Arm simulation" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(call, { key: "Enter" });
    await waitFor(() => expect(sent).toEqual(["CQ", "HISCALL", "EXCH"]));
  });

  it("keeps an uncertain commit owned until the same mutation is reconciled", async () => {
    render(<Harness mode="CW" uncertainCommit/>); const call = screen.getByLabelText("Call"), exchange = screen.getByLabelText("Exchange");
    fireEvent.change(call, { target: { value: "K1ABC" } }); fireEvent.change(exchange, { target: { value: "05" } }); await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" })); fireEvent.keyDown(exchange, { key: "Enter" });
    await screen.findByText(/Mutation outcome unknown/); expect(screen.getByTestId("calls").textContent).toBe("0/1");
    fireEvent.keyDown(exchange, { key: "Enter" }); expect(screen.getByTestId("calls").textContent).toBe("0/1");
    fireEvent.click(screen.getByRole("button", { name: "Recover wrong mutation" }));
    expect(screen.getByText(/Mutation outcome unknown/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Recover mutation" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Arm simulation" })).toBeTruthy());
    expect((call as HTMLInputElement).value).toBe("");
  });

  it.each(["CW", "SSB"] as const)("runs a report-free NAQP %s contact with the frozen station exchange and no serial allocation", async mode => {
    const sent: { macro: string; text: string }[] = [];
    render(<StructuredHarness mode={mode} simulate={async entry => { sent.push(entry); }}/>);
    const call = screen.getByLabelText("Call");
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(call, { key: mode === "CW" ? "Enter" : "F1" });
    await waitFor(() => expect(sent.map(item => item.macro)).toEqual(["CQ"]));
    fireEvent.keyDown(call, { key: "Escape" });
    fireEvent.change(screen.getByLabelText("Call"), { target: { value: "VE3AAA" } });
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(screen.getByLabelText("Call"), { key: "Enter" });
    await waitFor(() => expect(sent.map(item => item.macro)).toEqual(["CQ", "HISCALL", "EXCH"]));
    expect(sent[2].text).toBe("AL CA");
    expect(sent[2].text).not.toMatch(/\b(?:59|599|\d{3})\b/);
    fireEvent.change(screen.getByLabelText("Received Name"), { target: { value: "SAM" } });
    fireEvent.change(screen.getByLabelText("Received Location"), { target: { value: "ON" } });
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(screen.getByLabelText("Received Location"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("structured-calls").textContent).toBe("0/1"));
    expect(sent.at(-1)?.macro).toBe("QRZ");
  });

  it.each(["CW", "SSB"] as const)("logs a report-free NAQP %s S&P contact without reserve or implicit report output", async mode => {
    const sent: { macro: string; text: string }[] = [];
    render(<StructuredHarness mode={mode} simulate={async entry => { sent.push(entry); }}/>);
    fireEvent.change(screen.getByLabelText("Operating style"), { target: { value: "search-and-pounce" } });
    fireEvent.change(screen.getByLabelText("Call"), { target: { value: "K2AAA" } });
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(screen.getByLabelText("Call"), { key: "Enter" });
    await waitFor(() => expect(sent).toEqual([expect.objectContaining({ macro: "MYCALL" })]));
    fireEvent.keyDown(screen.getByLabelText("Call"), { key: "Escape" });
    fireEvent.change(screen.getByLabelText("Received Name"), { target: { value: "BOB" } });
    fireEvent.change(screen.getByLabelText("Received Location"), { target: { value: "NY" } });
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(screen.getByLabelText("Received Location"), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("structured-calls").textContent).toBe("0/1"));
    expect(sent).toEqual([expect.objectContaining({ macro: "MYCALL" }), expect.objectContaining({ macro: "EXCH", text: "AL CA" })]);
  });

  it.each([
    ["jidx-cw", "599 15"], ["jidx-ssb", "59 15"],
    ["arrl-dx-cw", "599 CT"], ["arrl-dx-ssb", "59 CT"],
  ] as const)("renders the active report and structured exchange for %s", async (ruleID, expected) => {
    const sent: { macro: string; text: string }[] = [];
    render(<StructuredReportHarness ruleID={ruleID} simulate={async entry => { sent.push(entry); }}/>);
    fireEvent.change(screen.getByLabelText("Operating style"), { target: { value: "search-and-pounce" } });
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(screen.getByLabelText("Exchange"), { key: "Enter" });
    await waitFor(() => expect(sent).toContainEqual(expect.objectContaining({ macro: "EXCH", text: expected })));
  });

  it("retires delayed old-mode output and admits AM after the authoritative mixed-mode draft arrives", async () => {
    const gate = deferred(), sent: { macro: string; mode: string }[] = [];
    render(<MixedModeHarness firstOutput={gate.promise} simulate={async entry => { sent.push(entry); }}/>);
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(screen.getByLabelText("Call"), { key: "Enter" });
    await waitFor(() => expect(sent.map(({ macro, mode }) => ({ macro, mode }))).toEqual([{ macro: "CQ", mode: "SSB" }]));
    fireEvent.click(screen.getByRole("button", { name: "Request AM" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply AM" }));
    await waitFor(() => expect(screen.getByTestId("settled-mode").textContent).toBe("AM"));
    await act(async () => gate.resolve());
    await waitFor(() => expect((screen.getByRole("button", { name: "Arm simulation" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(screen.getByLabelText("Call"), { key: "Enter" });
    await waitFor(() => expect(sent.at(-1)).toEqual(expect.objectContaining({ macro: "CQ", mode: "AM" })));
    fireEvent.keyDown(screen.getByLabelText("Call"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Set AM call" }));
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(screen.getByLabelText("Call"), { key: "Enter" });
    await waitFor(() => expect(sent.slice(-2).map(({ macro, mode }) => ({ macro, mode }))).toEqual([
      { macro: "HISCALL", mode: "AM" }, { macro: "EXCH", mode: "AM" },
    ]));
    expect(sent.filter(item => item.mode === "SSB").map(({ macro, mode }) => ({ macro, mode }))).toEqual([{ macro: "CQ", mode: "SSB" }]);
  });

  it("cancels a delayed old-mode call chain before EXCH or commit and starts a fresh AM chain", async () => {
    const gate = deferred(), sent: { macro: string; mode: string }[] = [];
    render(<MixedModeHarness initialCall firstOutput={gate.promise} simulate={async entry => { sent.push(entry); }}/>);
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(screen.getByLabelText("Call"), { key: "Enter" });
    await waitFor(() => expect(sent.map(({ macro, mode }) => ({ macro, mode }))).toEqual([{ macro: "HISCALL", mode: "SSB" }]));
    fireEvent.click(screen.getByRole("button", { name: "Request AM" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply AM" }));
    await act(async () => gate.resolve());
    await waitFor(() => expect((screen.getByRole("button", { name: "Arm simulation" }) as HTMLButtonElement).disabled).toBe(false));
    expect(sent.map(({ macro, mode }) => ({ macro, mode }))).toEqual([{ macro: "HISCALL", mode: "SSB" }]);
    expect(screen.getByTestId("mixed-commits").textContent).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(screen.getByLabelText("Call"), { key: "Enter" });
    await waitFor(() => expect(sent.slice(-2).map(({ macro, mode }) => ({ macro, mode }))).toEqual([
      { macro: "HISCALL", mode: "AM" }, { macro: "EXCH", mode: "AM" },
    ]));
    expect(screen.getByTestId("mixed-commits").textContent).toBe("0");
  });

  it.each(["CW", "SSB"] as const)("sends immediate QSOB4 for an authoritative partial NAQP %s duplicate", async mode => {
    const sent: { macro: string; text: string }[] = [];
    render(<StructuredHarness mode={mode} duplicate simulate={async entry => { sent.push(entry); }}/>);
    fireEvent.change(screen.getByLabelText("Call"), { target: { value: "VE3AAA" } });
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(screen.getByLabelText("Call"), { key: "Enter" });
    await waitFor(() => expect(sent.map(item => item.macro)).toEqual(["QSOB4"]));
    expect(screen.getByTestId("structured-calls").textContent).toBe("0/0");
  });

  it.each(["CW", "SSB"] as const)("rejects a malformed NAQP %s callsign while received fields remain incomplete", async mode => {
    const simulate = vi.fn(); render(<StructuredHarness mode={mode} simulate={simulate}/>);
    fireEvent.change(screen.getByLabelText("Call"), { target: { value: "ABC" } });
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(screen.getByLabelText("Call"), { key: "Enter" });
    await act(async () => {});
    expect(simulate).not.toHaveBeenCalled(); expect(screen.getByTestId("structured-calls").textContent).toBe("0/0");
  });

  it.each(["CW", "SSB"] as const)("blocks NAQP %s DX and mobile invalid locations while the name is blank", async mode => {
    for (const call of ["DL1ABC", "K1ABC/MM"]) {
      const simulate = vi.fn();
      const view = render(<StructuredHarness mode={mode} invalidPartialLocation simulate={simulate}/>);
      fireEvent.change(screen.getByLabelText("Call"), { target: { value: call } });
      fireEvent.change(screen.getByLabelText("Received Location"), { target: { value: "CA" } });
      fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
      fireEvent.keyDown(screen.getByLabelText("Call"), { key: "Enter" });
      await act(async () => {});
      expect(simulate).not.toHaveBeenCalled();
      expect(screen.getByTestId("structured-calls").textContent).toBe("0/0");
      view.unmount();
    }
  });

  it("keeps NAQP RTTY and incoherent capability snapshots on Plain Log without mutation or simulated output", () => {
    const simulate = vi.fn(), reserve = vi.fn(), commit = vi.fn();
    const rtty = naqpSession("RTTY"), rttyDraft = { ...draft(rtty), fields: { ...draft(rtty).fields, sentReport: "", receivedReport: "" } };
    const root = { current: null };
    const first = render(<ContestOperatorPanel session={rtty} draft={rttyDraft} entryRoot={root} editGeneration={0} disabled={false} recovery={null}
      reserveSerial={reserve} commitQSO={commit} admitIntent={() => true} guardFormSubmit={() => {}} focusField={() => {}} simulateOutput={simulate}/>);
    expect(screen.getByText(/no reviewed simulated-output capability/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Arm simulation" })).toBeNull();
    first.unmount();
    const crossed = naqpSession("SSB", { identity: { ...naqpSession("SSB").rule.identity, id: "naqp-cw" } });
    const crossedDraft = draft(crossed);
    crossedDraft.operatorReadiness = { ...crossedDraft.operatorReadiness!, capabilityDigest: "e".repeat(64) };
    render(<ContestOperatorPanel session={crossed} draft={crossedDraft} entryRoot={root} editGeneration={0} disabled={false} recovery={null}
      reserveSerial={reserve} commitQSO={commit} admitIntent={() => true} guardFormSubmit={() => {}} focusField={() => {}} simulateOutput={simulate}/>);
    expect(screen.getByText(/simulation unavailable/i)).toBeTruthy();
    expect(simulate).not.toHaveBeenCalled(); expect(reserve).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
  });

  it("keeps unaudited profiles on Plain Log with an explicit boundary", () => {
    const active = session("CW"); active.rule = { ...active.rule, identity: { ...active.rule.identity, id: "sac-cw" }, operatorCapability: undefined };
    const current = { ...draft(active), operatorReadiness: undefined }; const root = { current: null };
    render(<ContestOperatorPanel session={active} draft={current} entryRoot={root} editGeneration={0} disabled={false} recovery={null}
      reserveSerial={vi.fn()} commitQSO={vi.fn()} admitIntent={() => true} guardFormSubmit={() => {}} focusField={vi.fn()}/>);
    expect(screen.getByText(/no reviewed simulated-output capability/i)).toBeTruthy();
  });

  it("admits exactly the fourteen generated reviewed CW and SSB capabilities", () => {
    const reviewed = generatedRules.filter(candidate => candidate.operatorCapability);
    expect(reviewed).toHaveLength(14);
    for (const selected of reviewed) {
      const active: ContestSessionSummary = { ...session(selected.mode as "CW" | "SSB"), rule: selected,
        referenceDataVersion: selected.referenceDataVersion };
      const current = { ...draft(active), operatorReadiness: { capabilityDigest: selected.operatorCapability!.auditDigest,
        callsign: "empty" as const, exchange: "empty" as const, canSendCQ: true, canSendCall: false,
        canSendDuplicate: false, canReserveCall: false, canReserveCommit: false, canCommit: false } };
      const view = render(<ContestOperatorPanel session={active} draft={current} entryRoot={{ current: null }} editGeneration={0}
        disabled={false} recovery={null} reserveSerial={vi.fn()} commitQSO={vi.fn()} admitIntent={() => true}
        guardFormSubmit={() => {}} focusField={() => {}}/>);
      expect(screen.getByRole("button", { name: "Arm simulation" })).toBeTruthy();
      view.unmount();
    }
  });
});

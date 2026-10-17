import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { expandCWMacro } from "../live/cwMacros";
import { ContestMutationUncertain, type ContestMutation } from "./client";
import { createOperatorFlow, operatorFlowAdmissionShape, operatorFlowStep, type OperatorField, type OperatorFlowContext,
  type OperatorFlowCues, type OperatorFlowEvent, type OperatorFlowIntent, type OperatorFlowState, type OperatorMacroRole,
  type OperatorOperationToken, type OperatorStyle } from "./operatorFlow";
import { isStructuredEntry, type ContestCommitResult, type ContestDraftResult, type ContestDraftSnapshot, type ContestSessionSummary } from "./types";

type AuditedRuleProfile = {
  mode: "CW" | "SSB";
  version: string;
  edition: string;
  source: string;
  structured: boolean;
};
const AUDITED_RULES: ReadonlyMap<string, AuditedRuleProfile> = new Map([
  ["cq-ww-cw", { mode: "CW", version: "1.0.0-source-spike", edition: "source-26.10.11", source: "7c8b499225a73f7f8f792246881bd7aefc05452f", structured: false }],
  ["cq-wpx-cw", { mode: "CW", version: "1.0.0-source-spike", edition: "source-26.10.11", source: "7c8b499225a73f7f8f792246881bd7aefc05452f", structured: false }],
  ["cq-ww-ssb", { mode: "SSB", version: "1.0.0-source-spike", edition: "source-26.10.11", source: "7c8b499225a73f7f8f792246881bd7aefc05452f", structured: false }],
  ["cq-wpx-ssb", { mode: "SSB", version: "1.0.0-source-spike", edition: "source-26.10.11", source: "7c8b499225a73f7f8f792246881bd7aefc05452f", structured: false }],
  ["naqp-cw", { mode: "CW", version: "1.0.0-2026-rules-preview", edition: "2026-rules-preview", source: "0c98451d9dc4111dbb371c0a7d806a5ccd88624e21b1553672e9066c417064e8", structured: true }],
  ["naqp-ssb", { mode: "SSB", version: "1.0.0-2026-rules-preview", edition: "2026-rules-preview", source: "0c98451d9dc4111dbb371c0a7d806a5ccd88624e21b1553672e9066c417064e8", structured: true }],
] as const);
const PINNED_SOURCE = "7c8b499225a73f7f8f792246881bd7aefc05452f";
const MAX_TRACE = 24;

export type ContestSimulationEntry = {
  operationID: string;
  mode: "CW" | "SSB";
  macro: OperatorMacroRole;
  text: string;
};
export type ContestSimulationAdapter = (entry: ContestSimulationEntry) => Promise<void>;
export type ContestOperatorRecovery = { sequence: number; method: "contest_serial_reserve" | "contest_qso_commit";
  sessionID: string; workspaceGeneration: string; requestID: string; payloadDigest: string } | null;
type Trace = ContestSimulationEntry & { status: "pending" | "confirmed" | "failed" | "stopped" };
type ReservationIntent = Extract<OperatorFlowIntent, { kind: "reserve-serial" }>;

type Props = {
  session: ContestSessionSummary;
  draft: ContestDraftSnapshot;
  entryRoot: RefObject<HTMLFormElement | null>;
  editGeneration: number;
  disabled: boolean;
  recovery: ContestOperatorRecovery;
  reserveSerial: () => Promise<ContestDraftResult>;
  commitQSO: () => Promise<ContestCommitResult>;
  admitIntent: (draftIdentity: string, context: OperatorFlowContext) => boolean;
  guardFormSubmit: (guarded: boolean) => void;
  focusField: (field: OperatorField) => void;
  simulateOutput?: ContestSimulationAdapter;
};

const immediateSimulation: ContestSimulationAdapter = async () => {};
const draftIdentity = (draft: ContestDraftSnapshot) => `${draft.draftID}@${draft.revision}`;
function supported(session: ContestSessionSummary) {
  const profile = AUDITED_RULES.get(session.rule.identity.id);
  if (!profile || session.rule.mode !== profile.mode || session.rule.identity.version !== profile.version ||
      session.rule.identity.edition !== profile.edition || session.rule.identity.sourceRevision !== profile.source) return false;
  if (profile.structured) {
    const entry = session.rule.entry;
    if (session.rule.entryDescriptorVersion !== 2 || !isStructuredEntry(entry)) return false;
    const fieldsMatch = (fields: typeof entry.exchange.sentFields, locationRequired: boolean) => fields?.length === 2 && fields[0].id === "name" &&
      fields[0].required && fields[0].acceptedKinds.length === 1 && fields[0].acceptedKinds[0] === "operatorName" &&
      fields[1].id === "location" && fields[1].required === locationRequired && fields[1].acceptedKinds.includes("subdivision") && fields[1].acceptedKinds.includes("dxccPrefix");
    return entry.mode === profile.mode && entry.adifMode === profile.mode &&
      entry.cabrilloQSOType === (profile.mode === "CW" ? "CW" : "PH") && entry.cabrilloFormatterVersion === "naqp-preview-1" &&
      entry.cabrilloProjectionFormatterVersion === "naqp-preview-1" && entry.report.format === "none" && entry.report.defaultSent === "" &&
      entry.report.defaultReceived === "" && entry.report.maximumUTF8Bytes === 0 && entry.exchange.sent === "structured" &&
      entry.exchange.received === "structured" && entry.exchange.sentDefault === "stationFields" && entry.exchange.adifFields === "exchangeStrings" &&
      fieldsMatch(entry.exchange.sentFields, false) && fieldsMatch(entry.exchange.receivedFields, true) && entry.serial.requirement === "none" &&
      entry.serial.allowedScopes.length === 0;
  }
  return !isStructuredEntry(session.rule.entry) && session.rule.identity.sourceRevision === PINNED_SOURCE;
}
function operatorSignalMode(session: ContestSessionSummary): "CW" | "SSB" {
  if (session.rule.mode === "CW" || session.rule.mode === "SSB") return session.rule.mode;
  throw new Error("Operator flow is unavailable for this contest mode.");
}
function valueState(value: string, pattern: RegExp): "empty" | "valid" | "invalid" {
  return value.trim() === "" ? "empty" : pattern.test(value.trim()) ? "valid" : "invalid";
}
const REQUIRED_EXCHANGE_FIELD = "A required exchange field is missing.";
function structuredMissingReceivedErrors(session: ContestSessionSummary, draft: ContestDraftSnapshot) {
  if (!isStructuredEntry(session.rule.entry)) return [];
  const values = draft.fields.receivedExchangeFields ?? {};
  return session.rule.entry.exchange.receivedFields
    .filter(field => field.required && !(values[field.id] ?? "").trim())
    .map(() => REQUIRED_EXCHANGE_FIELD);
}
function exactErrors(actual: readonly string[], expected: readonly string[]) {
  const sortedExpected = [...expected].sort();
  return actual.length === expected.length && [...actual].sort().every((error, index) => error === sortedExpected[index]);
}
function structuredIncompleteReceivedReady(session: ContestSessionSummary, draft: ContestDraftSnapshot) {
  const missing = structuredMissingReceivedErrors(session, draft);
  if (missing.length === 0 || !isStructuredEntry(session.rule.entry)) return false;
  const values = draft.fields.receivedExchangeFields ?? {}, nameMissing = !(values.name ?? "").trim(), locationMissing = !(values.location ?? "").trim();
  const candidates: string[][] = [];
  if (nameMissing && locationMissing) candidates.push([...missing, "NAQP name is required."],
    [...missing, "NAQP name is required.", "Received location does not match the resolved North American entity."]);
  else if (nameMissing) candidates.push([...missing, "NAQP name is required."]);
  else if (locationMissing) candidates.push([...missing, "North American exchange location must match resolved geography.",
    "Received location does not match the resolved North American entity."],
  [...missing, "A non-North-American contact is logged with location DX."]);
  return candidates.some(expected => exactErrors(draft.validation.errors, expected));
}
function structuredCallOnlyReady(session: ContestSessionSummary, draft: ContestDraftSnapshot) {
  return draft.dupe.state === "clear" && structuredIncompleteReceivedReady(session, draft);
}
function cuesFor(session: ContestSessionSummary, draft: ContestDraftSnapshot, focus: OperatorField, correctedCall: boolean): OperatorFlowCues {
  const checked = draft.dupe.state !== "unchecked";
  const reserveFirstUnchecked = session.rule.entry.serial.requirement === "requiredForCommit" && draft.reservedSerial === null &&
    draft.validation.errors.every(error => error === "Sent serial must be a positive integer." || error === "Received serial must be a positive integer.");
  const call = draft.fields.callsign.trim();
  const callShape = /^[A-Z0-9]+(?:\/[A-Z0-9]+)*$/.test(call) && /[A-Z]/.test(call) && /\d/.test(call);
  const callsign = call === "" ? "empty" : (checked || reserveFirstUnchecked || structuredCallOnlyReady(session, draft)) && callShape ? "valid" : "invalid";
  const rawExchange = draft.fields.receivedExchange.trim(), numeric = /^\d+$/.test(rawExchange) ? Number(rawExchange) : NaN;
  const exchange = isStructuredEntry(session.rule.entry) ? (() => {
    const fields = session.rule.entry.exchange.receivedFields, values = draft.fields.receivedExchangeFields ?? {};
    const any = fields.some(field => (values[field.id] ?? "").trim() !== "");
    return !any ? "empty" : fields.every(field => !field.required || (values[field.id] ?? "").trim() !== "") ? "valid" : "invalid";
  })() : rawExchange === "" ? "empty" : Number.isSafeInteger(numeric) && numeric > 0 &&
    (session.rule.entry.exchange.received !== "cqZone" || numeric <= 40) ? "valid" : "invalid";
  return { draftIdentity: draftIdentity(draft), focus, callsign, exchange,
    duplicate: draft.dupe.state === "duplicate" && callsign === "valid", correctedCall: correctedCall && callsign === "valid",
    reservedSerial: draft.reservedSerial };
}
function rendered(macro: OperatorMacroRole, session: ContestSessionSummary, draft: ContestDraftSnapshot) {
  const sentExchange = isStructuredEntry(session.rule.entry) ? session.rule.entry.exchange.sentFields
    .map(field => draft.fields.sentExchangeFields?.[field.id]?.trim() ?? "").filter(Boolean).join(" ") : draft.fields.sentExchange;
  const templates: Record<OperatorMacroRole, string> = {
    CQ: "CQ CQ DE {MYCALL} {MYCALL} K", EXCH: isStructuredEntry(session.rule.entry) ? "{SERIAL}" : "{RST} {SERIAL}", QRZ: "TU {MYCALL} QRZ",
    AGN: "AGN", HISCALL: "{CALL}", MYCALL: "{MYCALL}", QSOB4: "QSO B4",
  };
  return expandCWMacro(templates[macro], { MYCALL: session.station.callsign, CALL: draft.fields.callsign,
    RST: draft.fields.sentReport, SERIAL: sentExchange }, 128);
}

export function ContestOperatorPanel({ session, draft, entryRoot, editGeneration, disabled, recovery, reserveSerial, commitQSO,
  admitIntent, guardFormSubmit, focusField, simulateOutput = immediateSimulation }: Props) {
  const audited = supported(session);
  // Unsupported profiles never execute an operator intent. This inert context
  // lets RTTY render its explicit Plain Log boundary without claiming a
  // digital-output implementation.
  const signalMode = audited ? operatorSignalMode(session) : "CW";
  const contextRef = useRef<OperatorFlowContext>({ sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration,
    contextGeneration: 1, signalMode, serialRequired: session.rule.entry.serial.requirement === "requiredForCommit" });
  const [state, setState] = useState<OperatorFlowState>(() => createOperatorFlow(contextRef.current));
  const stateRef = useRef(state), draftRef = useRef(draft), sessionRef = useRef(session), disabledRef = useRef(disabled);
  const admitIntentRef = useRef(admitIntent);
  const reserveSerialRef = useRef(reserveSerial), commitQSORef = useRef(commitQSO);
  const focusRef = useRef<OperatorField>("callsign"), editRef = useRef(editGeneration);
  const recoveryRef = useRef(0), admissionRef = useRef(0), lastSentCall = useRef("");
  const uncertainOperationRef = useRef<{ token: OperatorOperationToken; operation: ContestMutation } | null>(null);
  const [reservationContinuation, setReservationContinuation] = useState<{ intent: ReservationIntent; result: ContestDraftResult } | null>(null);
  const aliveRef = useRef(true);
  const [trace, setTrace] = useState<Trace[]>([]);
  draftRef.current = draft;
  sessionRef.current = session;
  disabledRef.current = disabled;
  admitIntentRef.current = admitIntent;
  reserveSerialRef.current = reserveSerial;
  commitQSORef.current = commitQSO;
  const setFlow = (next: OperatorFlowState) => { stateRef.current = next; guardFormSubmit(next.armed || !!next.pending); setState(next); };
  const updateTrace = (operationID: string, status: Trace["status"]) => setTrace(items =>
    items.map(item => item.operationID === operationID ? { ...item, status } : item).slice(-MAX_TRACE));

  function step(event: OperatorFlowEvent) {
    const transition = operatorFlowStep(stateRef.current, event);
    if (transition.accepted) setFlow(transition.state);
    for (const intent of transition.intents) void execute(intent);
    return transition;
  }
  function settle(token: OperatorOperationToken, outcome: "confirmed" | "failed" | "unknown") {
    if (outcome !== "unknown" && uncertainOperationRef.current?.token.operationID === token.operationID &&
        uncertainOperationRef.current.token.admission === token.admission) uncertainOperationRef.current = null;
    step({ type: "operation-outcome", context: stateRef.current.context, token, outcome });
  }
  function admits(intent: Extract<OperatorFlowIntent, { token: OperatorOperationToken }>) {
    const current = stateRef.current, pending = current.pending, active = sessionRef.current;
    return aliveRef.current && !disabledRef.current && !!pending && pending.kind === intent.kind &&
      pending.token.operationID === intent.token.operationID && pending.token.admission === intent.token.admission &&
      current.context.sessionID === intent.context.sessionID && current.context.workspaceGeneration === intent.context.workspaceGeneration &&
      current.context.contextGeneration === intent.context.contextGeneration && current.context.signalMode === intent.context.signalMode &&
      current.context.serialRequired === intent.context.serialRequired && active.sessionID === intent.context.sessionID &&
      active.workspaceGeneration === intent.context.workspaceGeneration && active.rule.mode === intent.context.signalMode &&
      (active.rule.entry.serial.requirement === "requiredForCommit") === intent.context.serialRequired &&
      draftIdentity(draftRef.current) === intent.draftIdentity && admitIntentRef.current(intent.draftIdentity, intent.context);
  }
  function commitReady() {
    const current = draftRef.current;
    return current.validation.errors.length === 0 && current.dupe.state === "clear";
  }
  const receivedErrors = () => isStructuredEntry(sessionRef.current.rule.entry) ? ["A required exchange field is missing."] :
    [sessionRef.current.rule.entry.exchange.received === "cqZone" ? "CQ zone must be an integer from 1 through 40." : "Received serial must be a positive integer."];
  const sentSerialError = "Sent serial must be a positive integer.";
  const errorsOnly = (...allowed: string[]) => draftRef.current.validation.errors.every(error => allowed.includes(error));
  function reserveReady(planWillCommit: boolean) {
    const current = draftRef.current, cues = cuesFor(sessionRef.current, current, focusRef.current, false);
    const format = sessionRef.current.rule.entry.report.format, report = format === "cwRST" ? /^\d{3}$/ : /^\d{2}$/;
    const reportsReady = format === "none" ? current.fields.sentReport === "" && current.fields.receivedReport === "" :
      report.test(current.fields.sentReport) && report.test(current.fields.receivedReport);
    return cues.callsign === "valid" && (cues.exchange === "valid" || !planWillCommit && cues.exchange === "empty") && !cues.duplicate && reportsReady && current.fields.mode === sessionRef.current.rule.mode && current.fields.frequencyHz !== null &&
      Number.isSafeInteger(current.fields.frequencyHz) && current.fields.frequencyHz! > 0 &&
      errorsOnly(sentSerialError, ...(planWillCommit ? [] : receivedErrors()));
  }
  function sendReady(macro: OperatorMacroRole) {
    const current = draftRef.current, planWillCommit = !!stateRef.current.plan?.commit;
    if (planWillCommit) return commitReady();
    if (macro === "CQ" && current.fields.callsign.trim() === "") {
      const missing = structuredMissingReceivedErrors(sessionRef.current, current);
      if (isStructuredEntry(sessionRef.current.rule.entry)) return exactErrors(current.validation.errors,
        [...missing, "A valid callsign is required.", "Resolved contest geography is missing or invalid."]);
      return errorsOnly("A valid callsign is required.", "Contest geography could not be resolved.", ...receivedErrors(),
        ...(stateRef.current.context.serialRequired ? [sentSerialError, "A WPX prefix could not be derived."] : []));
    }
    if (macro === "QSOB4") return current.dupe.state === "duplicate" &&
      (current.validation.errors.length === 0 || structuredIncompleteReceivedReady(sessionRef.current, current));
    if (isStructuredEntry(sessionRef.current.rule.entry) && structuredMissingReceivedErrors(sessionRef.current, current).length > 0)
      return structuredCallOnlyReady(sessionRef.current, current);
    return errorsOnly(...receivedErrors(), ...(stateRef.current.context.serialRequired ? [sentSerialError] : []));
  }
  async function execute(intent: OperatorFlowIntent) {
    if (intent.kind === "stop-and-disarm") {
      setTrace(items => items.map(item => item.status === "pending" ? { ...item, status: "stopped" as const } : item).slice(-MAX_TRACE));
      return;
    }
    if (intent.kind === "focus") { focusField(intent.field); return; }
    if (intent.kind === "reconcile-receipt") return;
    if (intent.kind === "send") {
      if (!admits(intent) || !sendReady(intent.macro)) { settle(intent.token, "failed"); return; }
      const admittedSession = sessionRef.current, admittedDraft = draftRef.current;
      const entry: ContestSimulationEntry = { operationID: intent.token.operationID, mode: operatorSignalMode(admittedSession), macro: intent.macro,
        text: rendered(intent.macro, admittedSession, admittedDraft) };
      setTrace(items => [...items, { ...entry, status: "pending" as const }].slice(-MAX_TRACE));
      try {
        await simulateOutput(entry);
        if (!admits(intent)) { updateTrace(intent.token.operationID, "stopped"); settle(intent.token, "failed"); return; }
        const stopped = !stateRef.current.armed;
        if (!stopped && intent.macro === "HISCALL") lastSentCall.current = admittedDraft.fields.callsign;
        updateTrace(intent.token.operationID, stopped ? "stopped" : "confirmed"); settle(intent.token, "confirmed");
      } catch { updateTrace(intent.token.operationID, "failed"); settle(intent.token, "failed"); }
      return;
    }
    try {
      await Promise.resolve();
      if (!admits(intent) || intent.kind === "reserve-serial" && !reserveReady(!!stateRef.current.plan?.commit) ||
          intent.kind === "commit" && !commitReady()) {
        settle(intent.token, "failed"); return;
      }
      if (intent.kind === "reserve-serial") {
        const result = await reserveSerialRef.current(); draftRef.current = result.draft;
        if (!aliveRef.current) return;
        setReservationContinuation({ intent, result });
        return;
      } else {
        const result = await commitQSORef.current(); draftRef.current = result.draft;
        if (!aliveRef.current) return;
        settle(intent.token, "confirmed");
        step({ type: "cues", context: intent.context, cues: cuesFor(sessionRef.current, result.draft, "callsign", false) });
        return;
      }
    } catch (cause) {
      if (!aliveRef.current) return;
      if (cause instanceof ContestMutationUncertain) uncertainOperationRef.current = { token: intent.token, operation: cause.operation };
      settle(intent.token, cause instanceof ContestMutationUncertain ? "unknown" : "failed");
    }
  }
  function token(): OperatorOperationToken { const admission = ++admissionRef.current; return { operationID: `simulation-${admission}`, admission }; }
  function handleKey(event: KeyboardEvent) {
    if (!audited || !entryRoot.current?.contains(event.target as Node)) return;
    const element = event.target instanceof HTMLElement ? event.target : null;
    const field = element?.dataset.contestOperatorField as OperatorField | undefined;
    const wasDefaultPrevented = event.defaultPrevented;
    if ((event.key === "Enter" || /^F(?:[1-9]|1[0-2])$/.test(event.key)) && !field) return;
    if (event.key === "Enter" && (stateRef.current.armed || stateRef.current.pending)) event.preventDefault();
    if (event.key !== "Enter" && event.key !== "Escape" && !/^F(?:[1-9]|1[0-2])$/.test(event.key)) return;
    if (disabledRef.current && event.key !== "Escape") return;
    if (field) {
      focusRef.current = field;
      const cues = cuesFor(sessionRef.current, draftRef.current, field,
        !!lastSentCall.current && draftRef.current.fields.callsign !== lastSentCall.current);
      if (field === "exchange" && /^\d+$/.test(draftRef.current.fields.receivedExchange.trim()) && cues.exchange === "invalid") return;
      const cued = operatorFlowStep(stateRef.current, { type: "cues", context: stateRef.current.context,
        cues });
      if (cued.accepted) setFlow(cued.state);
    }
    const current = stateRef.current, shape = operatorFlowAdmissionShape(current, event.key);
    const reserveToken = shape?.reserveSerial ? token() : undefined;
    const admission = shape ? { send: shape.macros.map(() => token()), ...(reserveToken ? { reserveSerial: reserveToken } : {}),
      ...(shape.commit ? { commit: token() } : {}) } : undefined;
    const transition = step({ type: "key", context: current.context, key: event.key, repeat: event.repeat,
      isComposing: event.isComposing, defaultPrevented: wasDefaultPrevented, altKey: event.altKey, ctrlKey: event.ctrlKey,
      metaKey: event.metaKey, shiftKey: event.shiftKey, admission });
    if (transition.accepted) event.preventDefault();
  }

  useEffect(() => {
    const root = entryRoot.current; if (!root || !audited) return;
    root.addEventListener("keydown", handleKey); return () => root.removeEventListener("keydown", handleKey);
  });
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      guardFormSubmit(false);
      stateRef.current = operatorFlowStep(stateRef.current, { type: "key", context: stateRef.current.context, key: "Escape" }).state;
    };
  }, []);
  useEffect(() => {
    if (stateRef.current.pending) return;
    const corrected = !!lastSentCall.current && draft.fields.callsign !== lastSentCall.current;
    step({ type: "cues", context: stateRef.current.context, cues: cuesFor(session, draft, focusRef.current, corrected) });
  }, [draft.draftID, draft.revision, draft.fields.callsign, draft.fields.receivedExchange, draft.reservedSerial, draft.dupe.state]);
  useLayoutEffect(() => {
    if (editRef.current === editGeneration) return;
    editRef.current = editGeneration;
    const previous = stateRef.current.context, context = { ...previous, contextGeneration: previous.contextGeneration + 1 };
    contextRef.current = context;
    step({ type: "context-changed", previous, context });
  }, [editGeneration]);
  useEffect(() => {
    const continuation = reservationContinuation;
    if (!continuation) return;
    const { intent, result } = continuation, pending = stateRef.current.pending, current = stateRef.current.context;
    const pendingMatches = pending?.kind === "reserve-serial" && pending.token.operationID === intent.token.operationID &&
      pending.token.admission === intent.token.admission;
    const contextMatches = current.sessionID === intent.context.sessionID && current.workspaceGeneration === intent.context.workspaceGeneration &&
      current.contextGeneration === intent.context.contextGeneration && current.signalMode === intent.context.signalMode &&
      current.serialRequired === intent.context.serialRequired;
    if (!pendingMatches || !contextMatches) { setReservationContinuation(null); return; }
    if (disabled || draftIdentity(draft) !== draftIdentity(result.draft)) return;
    if (!admitIntentRef.current(draftIdentity(result.draft), intent.context)) {
      setReservationContinuation(null); settle(intent.token, "failed"); return;
    }
    setReservationContinuation(null); draftRef.current = draft;
    step({ type: "authoritative-reservation", context: intent.context, token: intent.token,
      predecessorDraftIdentity: intent.draftIdentity, cues: cuesFor(sessionRef.current, draft, focusRef.current,
        !!lastSentCall.current && draft.fields.callsign !== lastSentCall.current) });
    settle(intent.token, "confirmed");
  }, [disabled, draft.draftID, draft.revision, reservationContinuation, state.context.contextGeneration]);
  useEffect(() => {
    if (!recovery || recovery.sequence <= recoveryRef.current) return;
    recoveryRef.current = recovery.sequence;
    const pending = stateRef.current.pending;
    if (!pending?.uncertain) return;
    if (recovery.method === "contest_serial_reserve" && pending.kind !== "reserve-serial" ||
        recovery.method === "contest_qso_commit" && pending.kind !== "commit") return;
    const owned = uncertainOperationRef.current;
    if (!owned || owned.token.operationID !== pending.token.operationID || owned.token.admission !== pending.token.admission ||
        owned.operation.method !== recovery.method || owned.operation.scope.sessionID !== recovery.sessionID ||
        owned.operation.scope.workspaceGeneration !== recovery.workspaceGeneration || owned.operation.scope.requestID !== recovery.requestID ||
        owned.operation.scope.payloadDigest !== recovery.payloadDigest) return;
    if (recovery.method === "contest_serial_reserve" && pending.kind === "reserve-serial") {
      step({ type: "authoritative-reservation", context: pending.context, token: pending.token,
        predecessorDraftIdentity: stateRef.current.plan!.draftIdentity, cues: cuesFor(session, draft, focusRef.current,
          !!lastSentCall.current && draft.fields.callsign !== lastSentCall.current) });
    }
    settle(pending.token, "confirmed");
    if (recovery.method === "contest_qso_commit" && pending.kind === "commit")
      step({ type: "cues", context: pending.context, cues: cuesFor(session, draft, "callsign", false) });
  }, [recovery, draft]);

  if (!audited) return <section className="contest-operator is-unsupported" aria-label="Run and S&P simulation">
    <strong>Run / S&amp;P simulation unavailable</strong><p>This guarded operator flow is limited to the audited CQ WW, CQ WPX, and NAQP CW/SSB profiles. RTTY and other profiles remain Plain Log only.</p>
  </section>;
  const pending = state.pending;
  return <section className="contest-operator" aria-label="Run and S&P simulation">
    <header><div><strong>Run / S&amp;P simulation</strong><p>Visible local trace only · no CW, voice, PTT, audio, or radio output</p></div>
      <button type="button" aria-pressed={state.armed} disabled={disabled || !!pending} onClick={() => step({ type: state.armed ? "key" : "arm", context: state.context, ...(state.armed ? { key: "Escape" } : {}) } as OperatorFlowEvent)}>{state.armed ? "Disarm" : "Arm simulation"}</button></header>
    <div className="contest-operator-controls"><label>Operating style<select aria-label="Operating style" disabled={disabled || !!pending} value={state.style}
      onChange={event => step({ type: "style-changed", context: state.context, style: event.target.value as OperatorStyle })}><option value="run">Run</option><option value="search-and-pounce">Search &amp; Pounce</option></select></label>
      <span className={state.armed ? "is-armed" : ""}>{pending?.uncertain ? "Mutation outcome unknown · use the save recovery controls" : pending ? `Waiting for ${pending.kind}` : state.armed ? "Armed for simulated output" : "Disarmed"}</span></div>
    <div className="contest-operator-keys" aria-label="Simulation keyboard map"><kbd>Enter</kbd><span>sequence</span><kbd>F1–F7</kbd><span>messages</span><kbd>Esc</kbd><span>stop</span></div>
    <ol className="contest-operator-trace" aria-label="Simulated output trace">{trace.length ? trace.map(item => <li key={item.operationID}><span>{item.mode} · {item.macro}</span><strong>{item.text}</strong><small>{item.status}</small></li>) : <li className="is-empty">No simulated messages.</li>}</ol>
  </section>;
}

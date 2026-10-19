import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { expandCWMacro } from "../live/cwMacros";
import { ContestMutationUncertain, type ContestMutation } from "./client";
import { createOperatorFlow, operatorFlowAdmissionShape, operatorFlowStep, type OperatorField, type OperatorFlowContext,
  type OperatorFlowCues, type OperatorFlowEvent, type OperatorFlowIntent, type OperatorFlowState, type OperatorMacroRole,
  type OperatorOperationToken, type OperatorStyle } from "./operatorFlow";
import { isStructuredEntry, type ContestCommitResult, type ContestDraftResult, type ContestDraftSnapshot, type ContestMode, type ContestSessionSummary } from "./types";

const MAX_TRACE = 24;

export type ContestSimulationEntry = {
  operationID: string;
  mode: "CW" | "SSB" | "AM" | "FM";
  macro: OperatorMacroRole;
  text: string;
};
export type ContestSimulationAdapter = (entry: ContestSimulationEntry) => Promise<void>;
export type ContestOperatorRecovery = { sequence: number; method: "contest_serial_reserve" | "contest_qso_commit";
  sessionID: string; workspaceGeneration: string; requestID: string; payloadDigest: string } | null;
type Trace = ContestSimulationEntry & { status: "pending" | "confirmed" | "failed" | "stopped" };
export type ContestOperatorSurfaceState = {
  armed: boolean; style: OperatorStyle; status: "disarmed" | "armed" | "waiting" | "uncertain";
  pending: "reserve-serial" | "send" | "commit" | null;
  focusedField: OperatorField | null;
  functionKeys: OperatorFlowState["functionKeys"];
  readiness: NonNullable<ContestDraftSnapshot["operatorReadiness"]> | null;
  trace: readonly Trace[];
};
type OperatorSurfaceKey = "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "F10" | "F11" | "F12" | "Enter" | "Escape";
export type ContestOperatorSurfaceController = { setArmed: (armed: boolean) => void; setStyle: (style: OperatorStyle) => void;
  pressKey: (key: OperatorSurfaceKey, focusedField: OperatorField | null) => void };
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
  onSurfaceChange?: (surface: ContestOperatorSurfaceState | null) => void;
  registerSurfaceController?: (controller: ContestOperatorSurfaceController | null) => void;
};

const immediateSimulation: ContestSimulationAdapter = async () => {};
const draftIdentity = (draft: ContestDraftSnapshot) => `${draft.draftID}@${draft.revision}`;
function supported(session: ContestSessionSummary, draft: ContestDraftSnapshot) {
  const capability = session.rule.operatorCapability, readiness = draft.operatorReadiness;
  const mode = draft.fields.mode, profile = capability?.signalProfiles?.find(item => item.mode === mode);
  const legacy = !capability?.signalProfiles && (mode === "CW" || mode === "SSB") && mode === session.rule.mode;
  return (legacy || profile?.signal === (mode === "CW" ? "cw" : "phone")) && !!capability && !!readiness &&
    capability.version === 1 && capability.policy === "simulated-run-sp-v1" && capability.output === "simulation-only" &&
    readiness.capabilityDigest === capability.auditDigest;
}
function operatorSignalMode(draft: ContestDraftSnapshot): "CW" | "SSB" | "AM" | "FM" {
  const mode: ContestMode = draft.fields.mode;
  if (["CW", "SSB", "AM", "FM"].includes(mode)) return mode as "CW" | "SSB" | "AM" | "FM";
  throw new Error("Operator flow is unavailable for this contest mode.");
}
function cuesFor(session: ContestSessionSummary, draft: ContestDraftSnapshot, focus: OperatorField, correctedCall: boolean): OperatorFlowCues {
  const readiness = draft.operatorReadiness;
  const callsign = readiness?.callsign === "ready" ? "valid" : readiness?.callsign === "empty" ? "empty" : "invalid";
  const exchange = readiness?.exchange === "ready" ? "valid" : readiness?.exchange === "empty" ? "empty" : "invalid";
  return { draftIdentity: draftIdentity(draft), focus, callsign, exchange,
    duplicate: readiness?.canSendDuplicate === true, correctedCall: correctedCall && callsign === "valid",
    reservedSerial: draft.reservedSerial };
}
function rendered(macro: OperatorMacroRole, session: ContestSessionSummary, draft: ContestDraftSnapshot) {
  const entry = session.rule.entry;
  const sentExchange = isStructuredEntry(entry) ? entry.exchange.sentFields
    .map(field => draft.fields.sentExchangeFields?.[field.id]?.trim() ?? "").filter(Boolean).join(" ") : draft.fields.sentExchange;
  const report = isStructuredEntry(entry) ? entry.modeProfiles.find(profile => profile.mode === draft.fields.mode)?.report ?? entry.report : entry.report;
  const includesReport = report.format !== "none";
  const templates: Record<OperatorMacroRole, string> = {
    CQ: "CQ CQ DE {MYCALL} {MYCALL} K", EXCH: includesReport ? "{RST} {SERIAL}" : "{SERIAL}", QRZ: "TU {MYCALL} QRZ",
    AGN: "AGN", HISCALL: "{CALL}", MYCALL: "{MYCALL}", QSOB4: "QSO B4",
  };
  return expandCWMacro(templates[macro], { MYCALL: session.station.callsign, CALL: draft.fields.callsign,
    RST: draft.fields.sentReport, SERIAL: sentExchange }, 128);
}

export function ContestOperatorPanel({ session, draft, entryRoot, editGeneration, disabled, recovery, reserveSerial, commitQSO,
  admitIntent, guardFormSubmit, focusField, simulateOutput = immediateSimulation, onSurfaceChange, registerSurfaceController }: Props) {
  const audited = supported(session, draft);
  // Unsupported profiles never execute an operator intent. This inert context
  // lets RTTY render its explicit Plain Log boundary without claiming a
  // digital-output implementation.
  const signalMode = audited ? operatorSignalMode(draft) : "CW";
  const contextRef = useRef<OperatorFlowContext>({ sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration,
    contextGeneration: 1, signalMode, serialRequired: session.rule.entry.serial.requirement === "requiredForCommit" });
  const [state, setState] = useState<OperatorFlowState>(() => createOperatorFlow(contextRef.current));
  const stateRef = useRef(state), draftRef = useRef(draft), sessionRef = useRef(session), disabledRef = useRef(disabled);
  const admitIntentRef = useRef(admitIntent);
  const reserveSerialRef = useRef(reserveSerial), commitQSORef = useRef(commitQSO);
  const focusRef = useRef<OperatorField>("callsign"), editRef = useRef(editGeneration);
  const [surfaceFocusedField, setSurfaceFocusedField] = useState<OperatorField | null>("callsign");
  const recoveryRef = useRef(0), admissionRef = useRef(0), lastSentCall = useRef("");
  const uncertainOperationRef = useRef<{ token: OperatorOperationToken; operation: ContestMutation } | null>(null);
  const [reservationContinuation, setReservationContinuation] = useState<{ intent: ReservationIntent; result: ContestDraftResult } | null>(null);
  const aliveRef = useRef(true);
  const [trace, setTrace] = useState<Trace[]>([]);
  const traceRef = useRef<HTMLOListElement>(null), followTraceRef = useRef(true);
  draftRef.current = draft;
  sessionRef.current = session;
  disabledRef.current = disabled;
  admitIntentRef.current = admitIntent;
  reserveSerialRef.current = reserveSerial;
  commitQSORef.current = commitQSO;
  const setFlow = (next: OperatorFlowState) => { stateRef.current = next; guardFormSubmit(next.armed || !!next.pending); setState(next); };
  const updateTrace = (operationID: string, status: Trace["status"]) => setTrace(items =>
    items.map(item => item.operationID === operationID ? { ...item, status } : item).slice(-MAX_TRACE));
  useLayoutEffect(() => {
    const element = traceRef.current;
    if (element && followTraceRef.current) element.scrollTop = element.scrollHeight;
  }, [trace]);
  useEffect(() => {
    if (!audited) { onSurfaceChange?.(null); return; }
    const pending = state.pending;
    onSurfaceChange?.({ armed: state.armed, style: state.style, focusedField: surfaceFocusedField,
      status: pending?.uncertain ? "uncertain" : pending ? "waiting" : state.armed ? "armed" : "disarmed",
      pending: pending?.kind ?? null, functionKeys: state.functionKeys, readiness: draft.operatorReadiness ?? null, trace });
  }, [audited, draft.operatorReadiness, onSurfaceChange, state, surfaceFocusedField, trace]);
  useEffect(() => () => onSurfaceChange?.(null), [onSurfaceChange]);
  const traceScrolled = () => {
    const element = traceRef.current;
    if (element) followTraceRef.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 8;
  };

  function step(event: OperatorFlowEvent) {
    const transition = operatorFlowStep(stateRef.current, event);
    if (transition.accepted) setFlow(transition.state);
    for (const intent of transition.intents) void execute(intent);
    return transition;
  }
  useEffect(() => {
    if (!audited) { registerSurfaceController?.(null); return; }
    registerSurfaceController?.({
      setArmed: armed => {
        const current = stateRef.current;
        if (current.armed === armed) return;
        if (disabledRef.current || current.pending) throw new Error("The operator simulation is busy.");
        const result = armed ? step({ type: "arm", context: current.context }) :
          step({ type: "key", context: current.context, key: "Escape" });
        if (!result.accepted) throw new Error("The operator simulation state changed.");
      },
      setStyle: style => {
        const current = stateRef.current;
        if (current.style === style) return;
        if (disabledRef.current || current.pending) throw new Error("The operator simulation is busy.");
        if (!step({ type: "style-changed", context: current.context, style }).accepted)
          throw new Error("The operator simulation state changed.");
      },
      pressKey: (key, focusedField) => {
        if (!applyKey(key, focusedField, {})) throw new Error("The operator key is unavailable in the current flow state.");
      },
    });
    return () => registerSurfaceController?.(null);
  }, [audited, registerSurfaceController]);
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
      active.workspaceGeneration === intent.context.workspaceGeneration && draftRef.current.fields.mode === intent.context.signalMode &&
      (active.rule.entry.serial.requirement === "requiredForCommit") === intent.context.serialRequired &&
      draftIdentity(draftRef.current) === intent.draftIdentity && admitIntentRef.current(intent.draftIdentity, intent.context);
  }
  function reserveReady(planWillCommit: boolean) {
    const readiness = draftRef.current.operatorReadiness;
    return planWillCommit ? readiness?.canReserveCommit === true : readiness?.canReserveCall === true;
  }
  function commitReady() { return draftRef.current.operatorReadiness?.canCommit === true; }
  function sendReady(macro: OperatorMacroRole) {
    const readiness = draftRef.current.operatorReadiness;
    if (!readiness) return false;
    if (stateRef.current.plan?.commit) return readiness.canCommit;
    if (macro === "CQ") return readiness.canSendCQ;
    if (macro === "QSOB4") return readiness.canSendDuplicate;
    return readiness.canSendCall;
  }
  async function execute(intent: OperatorFlowIntent) {
    if (intent.kind === "stop-and-disarm") {
      setTrace(items => items.map(item => item.status === "pending" ? { ...item, status: "stopped" as const } : item).slice(-MAX_TRACE));
      return;
    }
    if (intent.kind === "focus") { focusRef.current = intent.field; setSurfaceFocusedField(intent.field); focusField(intent.field); return; }
    if (intent.kind === "reconcile-receipt") return;
    if (intent.kind === "send") {
      if (!admits(intent) || !sendReady(intent.macro)) { settle(intent.token, "failed"); return; }
      const admittedSession = sessionRef.current, admittedDraft = draftRef.current;
      const entry: ContestSimulationEntry = { operationID: intent.token.operationID, mode: operatorSignalMode(admittedDraft), macro: intent.macro,
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
  function applyKey(key: string, focusedField: OperatorField | null, options: Partial<Pick<KeyboardEvent, "repeat" | "isComposing" |
    "defaultPrevented" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">>) {
    if (!audited || key !== "Enter" && key !== "Escape" && !/^F(?:[1-9]|1[0-2])$/.test(key)) return false;
    if (disabledRef.current && key !== "Escape") return false;
    if (key === "Enter" && !focusedField) return false;
    if (focusedField) {
      const field = focusedField;
      focusRef.current = field;
      setSurfaceFocusedField(field);
      const cues = cuesFor(sessionRef.current, draftRef.current, field,
        !!lastSentCall.current && draftRef.current.fields.callsign !== lastSentCall.current);
      if (field === "exchange" && /^\d+$/.test(draftRef.current.fields.receivedExchange.trim()) && cues.exchange === "invalid") return false;
      const cued = operatorFlowStep(stateRef.current, { type: "cues", context: stateRef.current.context,
        cues });
      if (cued.accepted) setFlow(cued.state);
    }
    const current = stateRef.current, shape = operatorFlowAdmissionShape(current, key);
    const reserveToken = shape?.reserveSerial ? token() : undefined;
    const admission = shape ? { send: shape.macros.map(() => token()), ...(reserveToken ? { reserveSerial: reserveToken } : {}),
      ...(shape.commit ? { commit: token() } : {}) } : undefined;
    const transition = step({ type: "key", context: current.context, key, repeat: options.repeat ?? false,
      isComposing: options.isComposing ?? false, defaultPrevented: options.defaultPrevented ?? false,
      altKey: options.altKey ?? false, ctrlKey: options.ctrlKey ?? false, metaKey: options.metaKey ?? false,
      shiftKey: options.shiftKey ?? false, admission });
    return transition.accepted;
  }
  function handleKey(event: KeyboardEvent) {
    if (!audited || !entryRoot.current?.contains(event.target as Node)) return;
    const element = event.target instanceof HTMLElement ? event.target : null;
    const field = element?.dataset.contestOperatorField as OperatorField | undefined;
    if ((event.key === "Enter" || /^F(?:[1-9]|1[0-2])$/.test(event.key)) && !field) return;
    if (applyKey(event.key, field ?? null, event)) event.preventDefault();
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
    const previous = stateRef.current.deferred?.context ?? stateRef.current.context;
    const nextMode = audited ? operatorSignalMode(draft) : previous.signalMode;
    if (editRef.current === editGeneration && previous.signalMode === nextMode) return;
    editRef.current = editGeneration;
    const context = { ...previous, contextGeneration: previous.contextGeneration + 1, signalMode: nextMode };
    contextRef.current = context;
    step({ type: "context-changed", previous, context });
  }, [audited, draft.fields.mode, editGeneration]);
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
    <strong>Run / S&amp;P simulation unavailable</strong><p>This contest profile has no reviewed simulated-output capability. RTTY and other unsupported profiles remain Plain Log only.</p>
  </section>;
  const pending = state.pending;
  return <section className="contest-operator" aria-label="Run and S&P simulation">
    <header><div><strong>Run / S&amp;P simulation</strong><p>Visible local trace only · no CW, voice, PTT, audio, or radio output</p></div>
      <button type="button" aria-pressed={state.armed} disabled={disabled || !!pending} onClick={() => step({ type: state.armed ? "key" : "arm", context: state.context, ...(state.armed ? { key: "Escape" } : {}) } as OperatorFlowEvent)}>{state.armed ? "Disarm" : "Arm simulation"}</button></header>
    <div className="contest-operator-controls"><label>Operating style<select aria-label="Operating style" disabled={disabled || !!pending} value={state.style}
      onChange={event => step({ type: "style-changed", context: state.context, style: event.target.value as OperatorStyle })}><option value="run">Run</option><option value="search-and-pounce">Search &amp; Pounce</option></select></label>
      <span className={state.armed ? "is-armed" : ""}>{pending?.uncertain ? "Mutation outcome unknown · use the save recovery controls" : pending ? `Waiting for ${pending.kind}` : state.armed ? "Armed for simulated output" : "Disarmed"}</span></div>
    <div className="contest-operator-keys" aria-label="Simulation keyboard map"><kbd>Enter</kbd><span>sequence</span><kbd>F1–F7</kbd><span>messages</span><kbd>Esc</kbd><span>stop</span></div>
    <ol ref={traceRef} onScroll={traceScrolled} className="contest-operator-trace" aria-label="Simulated output trace">{trace.length ? trace.map(item => <li key={item.operationID}><span>{item.mode} · {item.macro}</span><strong>{item.text}</strong><small>{item.status}</small></li>) : <li className="is-empty">No simulated messages.</li>}</ol>
  </section>;
}

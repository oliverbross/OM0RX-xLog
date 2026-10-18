export type OperatorStyle = "run" | "search-and-pounce";
export type OperatorSignalMode = "CW" | "SSB" | "AM" | "FM";
export type OperatorField = "callsign" | "exchange";
export type OperatorValueState = "empty" | "valid" | "invalid";
export type OperatorMacroRole = "CQ" | "EXCH" | "QRZ" | "AGN" | "HISCALL" | "MYCALL" | "QSOB4";
export type OperatorFunctionKey = `F${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12}`;

export type OperatorFlowContext = {
  sessionID: string;
  workspaceGeneration: string;
  contextGeneration: number;
  signalMode: OperatorSignalMode;
  serialRequired: boolean;
};

export type OperatorFlowCues = {
  draftIdentity: string;
  focus: OperatorField;
  callsign: OperatorValueState;
  exchange: OperatorValueState;
  duplicate: boolean;
  correctedCall: boolean;
  reservedSerial: number | null;
};

export type OperatorOperationToken = { operationID: string; admission: number };

export type OperatorKeyboardAdmission = {
  send: readonly OperatorOperationToken[];
  reserveSerial?: OperatorOperationToken;
  commit?: OperatorOperationToken;
};

type OperatorPlan = {
  context: OperatorFlowContext;
  draftIdentity: string;
  macros: readonly OperatorMacroRole[];
  send: readonly OperatorOperationToken[];
  nextSend: number;
  commit: OperatorOperationToken | null;
  cancelled: boolean;
};

export type OperatorPendingOperation = {
  kind: "reserve-serial" | "send" | "commit";
  context: OperatorFlowContext;
  token: OperatorOperationToken;
  uncertain: boolean;
  confirmed: boolean;
  reservationSuccessor: OperatorFlowCues | null;
};

export type OperatorFlowState = {
  context: OperatorFlowContext;
  style: OperatorStyle;
  armed: boolean;
  cues: OperatorFlowCues;
  functionKeys: Partial<Record<OperatorFunctionKey, OperatorMacroRole>>;
  pending: OperatorPendingOperation | null;
  plan: OperatorPlan | null;
  deferred: { context: OperatorFlowContext; style: OperatorStyle } | null;
  lastAdmission: number;
  recentOperationIDs: readonly string[];
  consumedDraftIdentities: readonly string[];
  lastFailure: "reserve-serial" | "send" | "commit" | null;
};

export type OperatorFlowIntent =
  | { kind: "reserve-serial"; context: OperatorFlowContext; draftIdentity: string; token: OperatorOperationToken }
  | { kind: "send"; context: OperatorFlowContext; draftIdentity: string; token: OperatorOperationToken; macro: OperatorMacroRole }
  | { kind: "commit"; context: OperatorFlowContext; draftIdentity: string; token: OperatorOperationToken }
  | { kind: "reconcile-receipt"; context: OperatorFlowContext; draftIdentity: string; token: OperatorOperationToken; operation: "reserve-serial" | "commit" }
  | { kind: "stop-and-disarm"; context: OperatorFlowContext }
  | { kind: "focus"; field: OperatorField };

export type OperatorFlowTransition = {
  state: OperatorFlowState;
  intents: readonly OperatorFlowIntent[];
  accepted: boolean;
  reason?: string;
};

export type OperatorFlowEvent =
  | { type: "arm"; context: OperatorFlowContext }
  | { type: "cues"; context: OperatorFlowContext; cues: OperatorFlowCues }
  | { type: "key"; context: OperatorFlowContext; key: string; repeat?: boolean; isComposing?: boolean;
      defaultPrevented?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean;
      admission?: OperatorKeyboardAdmission }
  | { type: "style-changed"; context: OperatorFlowContext; style: OperatorStyle }
  | { type: "context-changed"; previous: OperatorFlowContext; context: OperatorFlowContext }
  | { type: "operation-outcome"; context: OperatorFlowContext; token: OperatorOperationToken;
      outcome: "confirmed" | "failed" | "unknown" }
  | { type: "authoritative-reservation"; context: OperatorFlowContext; token: OperatorOperationToken;
      predecessorDraftIdentity: string; cues: OperatorFlowCues }
  | { type: "reconcile"; context: OperatorFlowContext; token: OperatorOperationToken }
  | { type: "output-confirmed-idle"; context: OperatorFlowContext; token: OperatorOperationToken };

export const defaultOperatorFunctionKeys: Readonly<Partial<Record<OperatorFunctionKey, OperatorMacroRole>>> = {
  F1: "CQ", F2: "EXCH", F3: "QRZ", F4: "MYCALL", F5: "HISCALL", F6: "QSOB4", F7: "AGN",
};

const emptyCues = (): OperatorFlowCues => ({
  draftIdentity: "", focus: "callsign", callsign: "empty", exchange: "empty", duplicate: false, correctedCall: false, reservedSerial: null,
});

const copyContext = (value: OperatorFlowContext): OperatorFlowContext => ({ ...value });
const copyToken = (value: OperatorOperationToken): OperatorOperationToken => ({ ...value });
const copyCues = (value: OperatorFlowCues): OperatorFlowCues => ({ ...value });

function immutableState(value: OperatorFlowState): OperatorFlowState {
  if (Object.isFrozen(value)) return value;
  const plan = value.plan ? Object.freeze({ ...value.plan, context: Object.freeze(copyContext(value.plan.context)),
    macros: Object.freeze([...value.plan.macros]), send: Object.freeze(value.plan.send.map(item => Object.freeze(copyToken(item)))),
    commit: value.plan.commit ? Object.freeze(copyToken(value.plan.commit)) : null }) : null;
  const pending = value.pending ? Object.freeze({ ...value.pending, context: Object.freeze(copyContext(value.pending.context)),
    token: Object.freeze(copyToken(value.pending.token)), reservationSuccessor: value.pending.reservationSuccessor ?
      Object.freeze(copyCues(value.pending.reservationSuccessor)) : null }) : null;
  const deferred = value.deferred ? Object.freeze({ context: Object.freeze(copyContext(value.deferred.context)), style: value.deferred.style }) : null;
  return Object.freeze({ ...value, context: Object.freeze(copyContext(value.context)), cues: Object.freeze(copyCues(value.cues)),
    functionKeys: Object.freeze({ ...value.functionKeys }), pending, plan, deferred,
    recentOperationIDs: Object.freeze([...value.recentOperationIDs]), consumedDraftIdentities: Object.freeze([...value.consumedDraftIdentities]) });
}

function immutableIntent(value: OperatorFlowIntent): OperatorFlowIntent {
  if (value.kind === "focus") return Object.freeze({ ...value });
  if (value.kind === "stop-and-disarm") return Object.freeze({ ...value, context: Object.freeze(copyContext(value.context)) });
  return Object.freeze({ ...value, context: Object.freeze(copyContext(value.context)), token: Object.freeze(copyToken(value.token)) });
}

const rejected = (state: OperatorFlowState, reason: string): OperatorFlowTransition =>
  Object.freeze({ state: immutableState(state), intents: Object.freeze([]), accepted: false, reason });
const accepted = (state: OperatorFlowState, intents: OperatorFlowIntent[] = []): OperatorFlowTransition =>
  Object.freeze({ state: immutableState(state), intents: Object.freeze(intents.map(immutableIntent)), accepted: true });
const sameToken = (a: OperatorOperationToken, b: OperatorOperationToken) => a.operationID === b.operationID && a.admission === b.admission;
const sameCues = (a: OperatorFlowCues, b: OperatorFlowCues) => a.draftIdentity === b.draftIdentity && a.focus === b.focus &&
  a.callsign === b.callsign && a.exchange === b.exchange && a.duplicate === b.duplicate &&
  a.correctedCall === b.correctedCall && a.reservedSerial === b.reservedSerial;
const sameContext = (a: OperatorFlowContext, b: OperatorFlowContext) =>
  a.sessionID === b.sessionID && a.workspaceGeneration === b.workspaceGeneration && a.contextGeneration === b.contextGeneration &&
  a.signalMode === b.signalMode && a.serialRequired === b.serialRequired;

function validContext(context: OperatorFlowContext) {
  return context && /^[^\x00-\x1f\x7f]{1,128}$/.test(context.sessionID) &&
    /^[^\x00-\x1f\x7f]{1,128}$/.test(context.workspaceGeneration) &&
    Number.isSafeInteger(context.contextGeneration) && context.contextGeneration >= 1 &&
    ["CW", "SSB", "AM", "FM"].includes(context.signalMode) && typeof context.serialRequired === "boolean";
}

function validCues(cues: OperatorFlowCues, context: OperatorFlowContext) {
  return cues && /^[^\x00-\x1f\x7f]{1,160}$/.test(cues.draftIdentity) && (cues.focus === "callsign" || cues.focus === "exchange") &&
    ["empty", "valid", "invalid"].includes(cues.callsign) && ["empty", "valid", "invalid"].includes(cues.exchange) &&
    typeof cues.duplicate === "boolean" && typeof cues.correctedCall === "boolean" &&
    (cues.reservedSerial === null || Number.isSafeInteger(cues.reservedSerial) && cues.reservedSerial > 0) &&
    (!cues.correctedCall || cues.callsign === "valid") && (!cues.duplicate || cues.callsign === "valid") &&
    (context.serialRequired || cues.reservedSerial === null);
}

function validFunctionKeys(value: Partial<Record<OperatorFunctionKey, OperatorMacroRole>>) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.every(key => /^F(?:[1-9]|1[0-2])$/.test(key) &&
    ["CQ", "EXCH", "QRZ", "AGN", "HISCALL", "MYCALL", "QSOB4"].includes(String(value[key as OperatorFunctionKey])));
}

export function createOperatorFlow(context: OperatorFlowContext, style: OperatorStyle = "run",
  functionKeys: Partial<Record<OperatorFunctionKey, OperatorMacroRole>> = defaultOperatorFunctionKeys): OperatorFlowState {
  if (!validContext(context)) throw new Error("Operator flow context is invalid.");
  if (style !== "run" && style !== "search-and-pounce") throw new Error("Operator style is invalid.");
  if (!validFunctionKeys(functionKeys)) throw new Error("Operator function-key map is invalid.");
  return immutableState({ context: copyContext(context), style, armed: false, cues: emptyCues(), functionKeys: { ...functionKeys }, pending: null,
    plan: null, deferred: null, lastAdmission: 0, recentOperationIDs: [], consumedDraftIdentities: [], lastFailure: null });
}

function keyboardPlan(state: OperatorFlowState, key: string): { macros: OperatorMacroRole[]; commit: boolean } | null {
  if (/^F(?:[1-9]|1[0-2])$/.test(key)) {
    const macro = state.functionKeys[key as OperatorFunctionKey];
    return macro ? { macros: [macro], commit: false } : null;
  }
  if (key !== "Enter") return null;
  const cues = state.cues;
  if (cues.focus === "callsign") {
    if (state.style === "run" && cues.callsign === "empty") return { macros: ["CQ"], commit: false };
    if (cues.callsign !== "valid") return null;
    if (cues.duplicate) return { macros: ["QSOB4"], commit: false };
    return state.style === "run" ? { macros: ["HISCALL", "EXCH"], commit: false } : { macros: ["MYCALL"], commit: false };
  }
  if (cues.exchange !== "valid") return { macros: ["AGN"], commit: false };
  if (cues.callsign !== "valid" || cues.duplicate) return null;
  if (state.style === "run") return { macros: [...(cues.correctedCall ? ["HISCALL" as const] : []), "QRZ"], commit: true };
  return { macros: ["EXCH"], commit: true };
}

export function operatorFlowAdmissionShape(state: OperatorFlowState, key: string) {
  const plan = keyboardPlan(state, key);
  if (!plan) return null;
  return Object.freeze({ macros: Object.freeze([...plan.macros]), commit: plan.commit,
    reserveSerial: state.context.serialRequired && state.cues.reservedSerial === null && plan.macros.includes("EXCH") });
}

function tokensFor(plan: { macros: OperatorMacroRole[]; commit: boolean }, state: OperatorFlowState, admission?: OperatorKeyboardAdmission) {
  if (!admission || !Array.isArray(admission.send) || admission.send.length !== plan.macros.length || Boolean(admission.commit) !== plan.commit) return null;
  const needsSerial = state.context.serialRequired && state.cues.reservedSerial === null && plan.macros.includes("EXCH");
  if (Boolean(admission.reserveSerial) !== needsSerial) return null;
  const ordered = [...(admission.reserveSerial ? [admission.reserveSerial] : []), ...admission.send, ...(admission.commit ? [admission.commit] : [])];
  const ids = new Set<string>(); let previous = state.lastAdmission;
  for (const token of ordered) {
    if (!token || !/^[^\x00-\x1f\x7f]{1,128}$/.test(token.operationID) || !Number.isSafeInteger(token.admission) ||
        token.admission <= previous || ids.has(token.operationID) || state.recentOperationIDs.includes(token.operationID)) return null;
    ids.add(token.operationID); previous = token.admission;
  }
  return { ordered, needsSerial };
}

function remember(state: OperatorFlowState, tokens: readonly OperatorOperationToken[]) {
  return { lastAdmission: tokens.at(-1)?.admission ?? state.lastAdmission,
    recentOperationIDs: [...state.recentOperationIDs, ...tokens.map(token => token.operationID)].slice(-128) };
}

function beginSend(state: OperatorFlowState, plan: OperatorPlan): OperatorFlowTransition {
  const token = plan.send[plan.nextSend], macro = plan.macros[plan.nextSend];
  const pending: OperatorPendingOperation = { kind: "send", context: plan.context, token, uncertain: false,
    confirmed: false, reservationSuccessor: null };
  return accepted({ ...state, plan, pending }, [{ kind: "send", context: plan.context, draftIdentity: plan.draftIdentity, token, macro }]);
}

function terminalState(state: OperatorFlowState) {
  if (state.deferred) return { ...state, context: state.deferred.context, style: state.deferred.style, cues: emptyCues(), armed: false,
    pending: null, plan: null, deferred: null, consumedDraftIdentities: [], lastFailure: null };
  return { ...state, pending: null, plan: null };
}

const confirmedReservationWaiting = (state: OperatorFlowState) =>
  state.pending?.kind === "reserve-serial" && state.pending.confirmed && state.pending.reservationSuccessor === null;

function adoptReservation(state: OperatorFlowState): OperatorFlowTransition {
  const pending = state.pending!, plan = state.plan!, successor = pending.reservationSuccessor!;
  if (state.deferred || !state.armed || plan.cancelled) return accepted(terminalState(state));
  const nextPlan = { ...plan, draftIdentity: successor.draftIdentity };
  return beginSend({ ...state, cues: successor, pending: null, plan: nextPlan }, nextPlan);
}

function consumeCommittedDraft(state: OperatorFlowState, plan: OperatorPlan): OperatorFlowTransition {
  const changedContext = state.deferred !== null;
  const consumed = [...state.consumedDraftIdentities, plan.draftIdentity].slice(-128);
  const next = terminalState({ ...state, cues: emptyCues(), pending: null, plan: null,
    consumedDraftIdentities: consumed, lastFailure: null });
  return accepted(next, changedContext ? [] : [{ kind: "focus", field: "callsign" }]);
}

function settleConfirmed(state: OperatorFlowState): OperatorFlowTransition {
  const pending = state.pending!, plan = state.plan!;
  if (pending.kind === "commit") return consumeCommittedDraft(state, plan);
  if (state.deferred || !state.armed || plan.cancelled) return accepted(terminalState(state));
  if (pending.kind === "reserve-serial") {
    if (pending.confirmed) return rejected(state, "operation-replayed");
    const waiting = { ...state, pending: { ...pending, confirmed: true } };
    return pending.reservationSuccessor ? adoptReservation(waiting) : accepted(waiting);
  }
  if (pending.kind === "send") {
    const nextSend = plan.nextSend + 1;
    if (nextSend < plan.macros.length) return beginSend({ ...state, pending: null }, { ...plan, nextSend });
    if (plan.commit) {
      const nextPending: OperatorPendingOperation = { kind: "commit", context: plan.context, token: plan.commit, uncertain: false,
        confirmed: false, reservationSuccessor: null };
      return accepted({ ...state, pending: nextPending, plan: { ...plan, nextSend } },
        [{ kind: "commit", context: plan.context, draftIdentity: plan.draftIdentity, token: plan.commit }]);
    }
    return accepted({ ...state, pending: null, plan: null, lastFailure: null });
  }
  return rejected(state, "operation-mismatch");
}

export function operatorFlowStep(state: OperatorFlowState, event: OperatorFlowEvent): OperatorFlowTransition {
  if (event.type === "context-changed") {
    const desired = state.deferred ?? { context: state.context, style: state.style };
    if (!sameContext(desired.context, event.previous) || !validContext(event.context)) return rejected(state, "context-mismatch");
    const intents: OperatorFlowIntent[] = state.armed || state.pending ? [{ kind: "stop-and-disarm", context: state.context }] : [];
    if (state.pending) {
      const changing = { ...state, armed: false, deferred: { context: copyContext(event.context), style: desired.style } };
      return confirmedReservationWaiting(state) ? accepted(terminalState(changing), intents) : accepted(changing, intents);
    }
    return accepted({ ...state, context: copyContext(event.context), cues: emptyCues(), armed: false, plan: null, pending: null,
      consumedDraftIdentities: [], lastFailure: null }, intents);
  }
  if (event.type === "style-changed") {
    const desired = state.deferred ?? { context: state.context, style: state.style };
    if (!sameContext(desired.context, event.context)) return rejected(state, "context-mismatch");
    if (event.style !== "run" && event.style !== "search-and-pounce") return rejected(state, "style-invalid");
    if (event.style === desired.style) return accepted(state);
    const intents: OperatorFlowIntent[] = state.armed || state.pending ? [{ kind: "stop-and-disarm", context: state.context }] : [];
    if (state.pending) {
      const changing = { ...state, armed: false, deferred: { context: desired.context, style: event.style } };
      return confirmedReservationWaiting(state) ? accepted(terminalState(changing), intents) : accepted(changing, intents);
    }
    return accepted({ ...state, style: event.style, armed: false, cues: emptyCues(), plan: null, lastFailure: null }, intents);
  }
  if (!sameContext(state.context, event.context)) return rejected(state, "context-mismatch");
  if (event.type === "arm") {
    if (state.pending || state.deferred) return rejected(state, "operation-owned");
    return accepted({ ...state, armed: true, lastFailure: null });
  }
  if (event.type === "cues") {
    if (!validCues(event.cues, state.context)) return rejected(state, "cues-invalid");
    if (state.consumedDraftIdentities.includes(event.cues.draftIdentity)) return rejected(state, "draft-consumed");
    if (state.deferred) return rejected(state, "operation-owned");
    if (state.pending) {
      if (sameCues(event.cues, state.cues)) return rejected(state, "operation-owned");
      const changing = { ...state, cues: copyCues(event.cues), armed: false,
        plan: state.plan ? { ...state.plan, cancelled: true } : null };
      return accepted(confirmedReservationWaiting(state) ? terminalState(changing) : changing,
        [{ kind: "stop-and-disarm", context: state.context }]);
    }
    return accepted({ ...state, cues: copyCues(event.cues) });
  }
  if (event.type === "authoritative-reservation") {
    const pending = state.pending, plan = state.plan;
    if (!pending || pending.kind !== "reserve-serial" || !plan || plan.cancelled || !sameToken(pending.token, event.token) ||
        !sameContext(pending.context, event.context)) return rejected(state, "operation-mismatch");
    if (event.predecessorDraftIdentity !== plan.draftIdentity || !validCues(event.cues, pending.context) ||
        event.cues.draftIdentity === plan.draftIdentity || event.cues.reservedSerial === null ||
        state.consumedDraftIdentities.includes(event.cues.draftIdentity)) return rejected(state, "reservation-successor-invalid");
    if (pending.reservationSuccessor) return rejected(state, "operation-replayed");
    const waiting = { ...state, pending: { ...pending, reservationSuccessor: copyCues(event.cues) } };
    return pending.confirmed ? adoptReservation(waiting) : accepted(waiting);
  }
  if (event.type === "key") {
    if (event.repeat || event.isComposing || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return rejected(state, "key-ignored");
    if (event.key === "Escape") {
      const intents: OperatorFlowIntent[] = state.armed || state.pending ? [{ kind: "stop-and-disarm", context: state.context }] : [];
      const stopping = { ...state, armed: false, ...(state.pending ? {} : { plan: null }) };
      return accepted(confirmedReservationWaiting(state) ? terminalState(stopping) : stopping, intents);
    }
    if (state.pending || state.deferred) return rejected(state, "operation-owned");
    if (!state.armed) return rejected(state, "flow-disarmed");
    if (!validCues(state.cues, state.context)) return rejected(state, "cues-unavailable");
    const requested = keyboardPlan(state, event.key);
    if (!requested) return rejected(state, "key-has-no-action");
    const admitted = tokensFor(requested, state, event.admission);
    if (!admitted) return rejected(state, "admission-invalid");
    const plan: OperatorPlan = { context: copyContext(state.context), draftIdentity: state.cues.draftIdentity, macros: [...requested.macros],
      send: event.admission!.send.map(copyToken), nextSend: 0,
      commit: event.admission!.commit ? copyToken(event.admission!.commit) : null, cancelled: false };
    const remembered = remember(state, admitted.ordered);
    if (admitted.needsSerial) {
      const token = event.admission!.reserveSerial!;
      return accepted({ ...state, ...remembered, plan, pending: { kind: "reserve-serial", context: copyContext(state.context),
        token: copyToken(token), uncertain: false, confirmed: false, reservationSuccessor: null }, lastFailure: null },
        [{ kind: "reserve-serial", context: state.context, draftIdentity: plan.draftIdentity, token }]);
    }
    return beginSend({ ...state, ...remembered, lastFailure: null }, plan);
  }
  if (event.type === "reconcile") {
    const pending = state.pending;
    if (!pending || !pending.uncertain || !sameToken(pending.token, event.token) || !sameContext(pending.context, event.context))
      return rejected(state, "operation-mismatch");
    if (pending.kind === "send") return rejected(state, "send-has-no-receipt");
    return accepted(state, [{ kind: "reconcile-receipt", context: pending.context, draftIdentity: state.plan!.draftIdentity,
      token: pending.token, operation: pending.kind }]);
  }
  if (event.type === "output-confirmed-idle") {
    const pending = state.pending;
    if (!pending || pending.kind !== "send" || !pending.uncertain || !sameToken(pending.token, event.token) || !sameContext(pending.context, event.context))
      return rejected(state, "operation-mismatch");
    return accepted(terminalState({ ...state, armed: false, lastFailure: "send" }));
  }
  const pending = state.pending;
  if (!pending || !sameToken(pending.token, event.token) || !sameContext(pending.context, event.context))
    return rejected(state, "operation-mismatch");
  if (pending.confirmed) return rejected(state, "operation-replayed");
  if (event.outcome === "unknown") return accepted({ ...state, armed: false, pending: { ...pending, uncertain: true } });
  if (event.outcome === "failed") return accepted(terminalState({ ...state, pending: null, plan: null, lastFailure: pending.kind }));
  return settleConfirmed(state);
}

import { describe, expect, it } from "vitest";
import { createOperatorFlow, operatorFlowStep, type OperatorFlowContext, type OperatorFlowCues,
  type OperatorFlowState, type OperatorKeyboardAdmission, type OperatorOperationToken } from "./operatorFlow";

const context = (overrides: Partial<OperatorFlowContext> = {}): OperatorFlowContext => ({
  sessionID: "session-A", workspaceGeneration: "workspace-A", contextGeneration: 1, signalMode: "CW", serialRequired: false, ...overrides,
});
const cues = (overrides: Partial<OperatorFlowCues> = {}): OperatorFlowCues => ({
  draftIdentity: "draft-A", focus: "callsign", callsign: "empty", exchange: "empty", duplicate: false, correctedCall: false, reservedSerial: null, ...overrides,
});
const token = (admission: number, operationID = `operation-${admission}`): OperatorOperationToken => ({ operationID, admission });
const arm = (state: OperatorFlowState) => operatorFlowStep(state, { type: "arm", context: state.context }).state;
const cue = (state: OperatorFlowState, value: OperatorFlowCues) => operatorFlowStep(state, { type: "cues", context: state.context, cues: value }).state;
const key = (state: OperatorFlowState, value: string, admission?: OperatorKeyboardAdmission) =>
  operatorFlowStep(state, { type: "key", context: state.context, key: value, admission });
const outcome = (state: OperatorFlowState, value: "confirmed" | "failed" | "unknown") =>
  operatorFlowStep(state, { type: "operation-outcome", context: state.pending!.context, token: state.pending!.token, outcome: value });
const reservation = (state: OperatorFlowState, successor: OperatorFlowCues, predecessorDraftIdentity = "draft-A") =>
  operatorFlowStep(state, { type: "authoritative-reservation", context: state.pending!.context, token: state.pending!.token,
    predecessorDraftIdentity, cues: successor });

describe("operatorFlow source-derived sequences", () => {
  it.each(["CW", "SSB"] as const)("models Run and S&P Enter sequences for %s without dispatching a sink", signalMode => {
    let run = arm(createOperatorFlow(context({ signalMode }), "run"));
    run = cue(run, cues());
    let transition = key(run, "Enter", { send: [token(1)] });
    expect(transition.intents.map(x => x.kind === "send" ? x.macro : x.kind)).toEqual(["CQ"]);
    run = outcome(transition.state, "confirmed").state;
    run = cue(run, cues({ callsign: "valid" }));
    transition = key(run, "Enter", { send: [token(2), token(3)] });
    expect(transition.intents).toMatchObject([{ kind: "send", macro: "HISCALL" }]);
    transition = outcome(transition.state, "confirmed");
    expect(transition.intents).toMatchObject([{ kind: "send", macro: "EXCH" }]);
    run = outcome(transition.state, "confirmed").state;
    run = cue(run, cues({ focus: "exchange", callsign: "valid", exchange: "valid" }));
    transition = key(run, "Enter", { send: [token(4)], commit: token(5) });
    expect(transition.intents).toMatchObject([{ kind: "send", macro: "QRZ" }]);
    transition = outcome(transition.state, "confirmed");
    expect(transition.intents).toMatchObject([{ kind: "commit", draftIdentity: "draft-A", token: token(5) }]);
    transition = outcome(transition.state, "confirmed");
    expect(transition.intents).toEqual([{ kind: "focus", field: "callsign" }]);

    let sp = arm(createOperatorFlow(context({ signalMode }), "search-and-pounce"));
    sp = cue(sp, cues({ callsign: "valid" }));
    transition = key(sp, "Enter", { send: [token(1)] });
    expect(transition.intents).toMatchObject([{ kind: "send", macro: "MYCALL" }]);
    sp = outcome(transition.state, "confirmed").state;
    sp = cue(sp, cues({ focus: "exchange", callsign: "valid", exchange: "valid" }));
    transition = key(sp, "Enter", { send: [token(2)], commit: token(3) });
    expect(transition.intents).toMatchObject([{ kind: "send", macro: "EXCH" }]);
    transition = outcome(transition.state, "confirmed");
    expect(transition.intents).toMatchObject([{ kind: "commit" }]);
  });

  it("uses explicit invalid, duplicate, corrected-call and Again cues", () => {
    let state = arm(createOperatorFlow(context(), "run"));
    state = cue(state, cues({ callsign: "invalid" }));
    expect(key(state, "Enter", { send: [token(1)] }).reason).toBe("key-has-no-action");
    state = cue(state, cues({ callsign: "valid", duplicate: true }));
    let transition = key(state, "Enter", { send: [token(1)] });
    expect(transition.intents).toMatchObject([{ kind: "send", macro: "QSOB4" }]);
    state = outcome(transition.state, "confirmed").state;
    state = cue(state, cues({ focus: "exchange", callsign: "valid", exchange: "invalid" }));
    transition = key(state, "Enter", { send: [token(2)] });
    expect(transition.intents).toMatchObject([{ kind: "send", macro: "AGN" }]);
    state = outcome(transition.state, "confirmed").state;
    state = cue(state, cues({ focus: "exchange", callsign: "valid", exchange: "valid", correctedCall: true }));
    transition = key(state, "Enter", { send: [token(3), token(4)], commit: token(5) });
    expect(transition.intents).toMatchObject([{ kind: "send", macro: "HISCALL" }]);
    transition = outcome(transition.state, "confirmed");
    expect(transition.intents).toMatchObject([{ kind: "send", macro: "QRZ" }]);
  });

  it("routes direct function keys through declarative macro roles", () => {
    const state = cue(arm(createOperatorFlow(context(), "run", { F8: "MYCALL" })), cues());
    expect(key(state, "F8", { send: [token(1)] }).intents).toMatchObject([{ kind: "send", macro: "MYCALL" }]);
    expect(key(state, "F1", { send: [token(1)] }).reason).toBe("key-has-no-action");
  });
});

describe("operatorFlow admission and ownership", () => {
  it("adopts an authoritative WPX reservation successor received before confirmation", () => {
    let state = arm(createOperatorFlow(context({ serialRequired: true }), "search-and-pounce"));
    state = cue(state, cues({ focus: "exchange", callsign: "valid", exchange: "valid" }));
    let transition = key(state, "Enter", { reserveSerial: token(1), send: [token(2)], commit: token(3) });
    expect(transition.intents).toEqual([{ kind: "reserve-serial", context: state.context, draftIdentity: "draft-A", token: token(1) }]);
    expect(transition.state.pending?.kind).toBe("reserve-serial");
    transition = reservation(transition.state,
      cues({ draftIdentity: "draft-B", focus: "exchange", callsign: "valid", exchange: "valid", reservedSerial: 7 }));
    expect(transition.intents).toEqual([]);
    expect(transition.state.pending).toMatchObject({ kind: "reserve-serial", confirmed: false,
      reservationSuccessor: { draftIdentity: "draft-B", reservedSerial: 7 } });
    transition = outcome(transition.state, "confirmed");
    expect(transition.intents).toMatchObject([{ kind: "send", macro: "EXCH", token: token(2), draftIdentity: "draft-B" }]);
    expect(transition.state).toMatchObject({ cues: { draftIdentity: "draft-B", reservedSerial: 7 }, plan: { draftIdentity: "draft-B" } });
    transition = outcome(transition.state, "confirmed");
    expect(transition.intents).toMatchObject([{ kind: "commit", token: token(3), draftIdentity: "draft-B" }]);
  });

  it("waits for an authoritative WPX reservation successor received after confirmation", () => {
    let state = cue(arm(createOperatorFlow(context({ serialRequired: true }), "search-and-pounce")),
      cues({ focus: "exchange", callsign: "valid", exchange: "valid" }));
    let transition = key(state, "Enter", { reserveSerial: token(1), send: [token(2)], commit: token(3) });
    transition = outcome(transition.state, "confirmed");
    expect(transition.intents).toEqual([]);
    expect(transition.state.pending).toMatchObject({ kind: "reserve-serial", confirmed: true });
    expect(key(transition.state, "Enter", { send: [token(4)] }).reason).toBe("operation-owned");
    transition = reservation(transition.state,
      cues({ draftIdentity: "draft-B", focus: "exchange", callsign: "valid", exchange: "valid", reservedSerial: 11 }));
    expect(transition.intents).toMatchObject([{ kind: "send", macro: "EXCH", draftIdentity: "draft-B" }]);
  });

  it("cancels reservation adoption when unrelated cues replace its captured draft", () => {
    let state = cue(arm(createOperatorFlow(context({ serialRequired: true }), "search-and-pounce")),
      cues({ focus: "exchange", callsign: "valid", exchange: "valid" }));
    let transition = key(state, "Enter", { reserveSerial: token(1), send: [token(2)], commit: token(3) });
    transition = operatorFlowStep(transition.state, { type: "cues", context: state.context,
      cues: cues({ draftIdentity: "unrelated", focus: "exchange", callsign: "valid", exchange: "valid" }) });
    expect(transition.state).toMatchObject({ armed: false, plan: { cancelled: true } });
    expect(reservation(transition.state,
      cues({ draftIdentity: "draft-B", focus: "exchange", callsign: "valid", exchange: "valid", reservedSerial: 7 })).reason)
      .toBe("operation-mismatch");
    transition = outcome(transition.state, "confirmed");
    expect(transition.intents).toEqual([]);
    expect(transition.state).toMatchObject({ pending: null, plan: null, cues: { draftIdentity: "unrelated" } });
  });

  it("terminalizes a confirmed reservation wait after an edit and rejects its late successor", () => {
    let state = cue(arm(createOperatorFlow(context({ serialRequired: true }), "search-and-pounce")),
      cues({ focus: "exchange", callsign: "valid", exchange: "valid" }));
    let transition = key(state, "Enter", { reserveSerial: token(1), send: [token(2)], commit: token(3) });
    const reservedContext = transition.state.pending!.context;
    const reservedToken = transition.state.pending!.token;
    state = outcome(transition.state, "confirmed").state;
    transition = operatorFlowStep(state, { type: "cues", context: state.context,
      cues: cues({ draftIdentity: "unrelated", focus: "exchange", callsign: "valid", exchange: "valid" }) });
    expect(transition.intents).toEqual([{ kind: "stop-and-disarm", context: state.context }]);
    expect(transition.state).toMatchObject({ armed: false, pending: null, plan: null, cues: { draftIdentity: "unrelated" } });
    expect(operatorFlowStep(transition.state, { type: "authoritative-reservation", context: reservedContext, token: reservedToken,
      predecessorDraftIdentity: "draft-A",
      cues: cues({ draftIdentity: "draft-B", focus: "exchange", callsign: "valid", exchange: "valid", reservedSerial: 7 }) }).reason)
      .toBe("operation-mismatch");
    state = arm(transition.state);
    expect(key(state, "Enter", { reserveSerial: token(1), send: [token(2)], commit: token(3) }).reason).toBe("admission-invalid");
    expect(key(state, "Enter", { reserveSerial: token(4), send: [token(5)], commit: token(6) }).intents)
      .toMatchObject([{ kind: "reserve-serial", draftIdentity: "unrelated", token: token(4) }]);
  });

  it("terminalizes a confirmed reservation wait on Escape, style, or context change", () => {
    const waiting = () => {
      const state = cue(arm(createOperatorFlow(context({ serialRequired: true }), "search-and-pounce")),
        cues({ focus: "exchange", callsign: "valid", exchange: "valid" }));
      return outcome(key(state, "Enter", { reserveSerial: token(1), send: [token(2)], commit: token(3) }).state, "confirmed").state;
    };

    let state = waiting();
    let transition = operatorFlowStep(state, { type: "key", context: state.context, key: "Escape" });
    expect(transition.intents).toEqual([{ kind: "stop-and-disarm", context: state.context }]);
    expect(transition.state).toMatchObject({ armed: false, pending: null, plan: null });

    state = waiting();
    transition = operatorFlowStep(state, { type: "style-changed", context: state.context, style: "run" });
    expect(transition.intents.map(intent => intent.kind)).toEqual(["stop-and-disarm"]);
    expect(transition.state).toMatchObject({ style: "run", armed: false, pending: null, plan: null });

    state = waiting();
    const next = context({ sessionID: "session-B", contextGeneration: 2 });
    transition = operatorFlowStep(state, { type: "context-changed", previous: state.context, context: next });
    expect(transition.intents.map(intent => intent.kind)).toEqual(["stop-and-disarm"]);
    expect(transition.state).toMatchObject({ context: next, armed: false, pending: null, plan: null });
  });

  it("retains unconfirmed and unknown reservations across Escape", () => {
    const initial = cue(arm(createOperatorFlow(context({ serialRequired: true }), "search-and-pounce")),
      cues({ focus: "exchange", callsign: "valid", exchange: "valid" }));
    let state = key(initial, "Enter", { reserveSerial: token(1), send: [token(2)], commit: token(3) }).state;
    state = operatorFlowStep(state, { type: "key", context: state.context, key: "Escape" }).state;
    expect(state.pending).toMatchObject({ kind: "reserve-serial", confirmed: false, uncertain: false });

    state = key(initial, "Enter", { reserveSerial: token(1), send: [token(2)], commit: token(3) }).state;
    state = outcome(state, "unknown").state;
    state = operatorFlowStep(state, { type: "key", context: state.context, key: "Escape" }).state;
    expect(state.pending).toMatchObject({ kind: "reserve-serial", confirmed: false, uncertain: true });
  });

  it("blocks double Enter and automatic retry while send outcome is pending or unknown", () => {
    let state = arm(createOperatorFlow(context()));
    state = cue(state, cues());
    let transition = key(state, "Enter", { send: [token(1)] });
    expect(key(transition.state, "Enter", { send: [token(2)] }).reason).toBe("operation-owned");
    state = outcome(transition.state, "unknown").state;
    expect(state.pending).toMatchObject({ kind: "send", uncertain: true, token: token(1) });
    expect(key(state, "Enter", { send: [token(2)] }).reason).toBe("operation-owned");
    expect(operatorFlowStep(state, { type: "reconcile", context: state.context, token: token(1) }).reason).toBe("send-has-no-receipt");
    transition = operatorFlowStep(state, { type: "output-confirmed-idle", context: state.context, token: token(1) });
    expect(transition.state.pending).toBeNull();
    expect(transition.state.armed).toBe(false);
  });

  it("allows only an explicit new action after a definite send failure", () => {
    let state = arm(createOperatorFlow(context()));
    state = cue(state, cues());
    state = outcome(key(state, "Enter", { send: [token(1)] }).state, "failed").state;
    expect(state.lastFailure).toBe("send");
    expect(state.pending).toBeNull();
    const retry = key(state, "Enter", { send: [token(2)] });
    expect(retry.intents).toMatchObject([{ kind: "send", token: token(2) }]);
  });

  it("retains commit identity for receipt reconciliation and rejects repeated or reused outcomes", () => {
    let state = arm(createOperatorFlow(context()));
    state = cue(state, cues({ focus: "exchange", callsign: "valid", exchange: "valid" }));
    let transition = key(state, "Enter", { send: [token(1)], commit: token(2) });
    state = outcome(transition.state, "confirmed").state;
    state = outcome(state, "unknown").state;
    expect(state.pending).toMatchObject({ kind: "commit", uncertain: true, token: token(2) });
    transition = operatorFlowStep(state, { type: "reconcile", context: state.context, token: token(2) });
    expect(transition.intents).toMatchObject([{ kind: "reconcile-receipt", operation: "commit", token: token(2) }]);
    state = outcome(transition.state, "confirmed").state;
    expect(state).toMatchObject({ cues: { draftIdentity: "" }, consumedDraftIdentities: ["draft-A"] });
    expect(key(arm(state), "Enter", { send: [token(3)] }).intents).toEqual([]);
    expect(cue(state, cues())).toBe(state);
    expect(operatorFlowStep(state, { type: "cues", context: state.context, cues: cues() }).reason).toBe("draft-consumed");
    expect(operatorFlowStep(state, { type: "operation-outcome", context: state.context, token: token(2), outcome: "confirmed" }).reason).toBe("operation-mismatch");
    state = arm(state);
    state = cue(state, cues({ draftIdentity: "draft-B" }));
    expect(key(state, "F1", { send: [token(3, "operation-2")] }).reason).toBe("admission-invalid");
    expect(key(state, "F1", { send: [token(3)] }).intents).toMatchObject([{ kind: "send", draftIdentity: "draft-B" }]);
  });

  it("requires exact increasing caller admissions", () => {
    const state = cue(arm(createOperatorFlow(context())), cues({ callsign: "valid" }));
    expect(key(state, "Enter", { send: [token(1), token(1)] }).reason).toBe("admission-invalid");
    expect(key(state, "Enter", { send: [token(2), token(1)] }).reason).toBe("admission-invalid");
  });
});

describe("operatorFlow keyboard and context fences", () => {
  it("ignores repeat, IME, prevented and modified keys without arming implicitly", () => {
    const off = createOperatorFlow(context());
    expect(key(off, "Enter", { send: [token(1)] }).reason).toBe("flow-disarmed");
    const state = arm(off);
    for (const flags of [{ repeat: true }, { isComposing: true }, { defaultPrevented: true }, { ctrlKey: true }, { shiftKey: true }]) {
      const transition = operatorFlowStep(state, { type: "key", context: state.context, key: "Enter", admission: { send: [token(1)] }, ...flags });
      expect(transition.reason).toBe("key-ignored");
      expect(transition.state).toBe(state);
    }
  });

  it("disarms on style change and Escape while preserving pending ownership", () => {
    let state = arm(createOperatorFlow(context()));
    let transition = operatorFlowStep(state, { type: "style-changed", context: state.context, style: "search-and-pounce" });
    expect(transition.intents).toEqual([{ kind: "stop-and-disarm", context: state.context }]);
    expect(transition.state).toMatchObject({ style: "search-and-pounce", armed: false });
    state = arm(transition.state);
    state = cue(state, cues());
    state = key(state, "F1", { send: [token(1)] }).state;
    transition = operatorFlowStep(state, { type: "key", context: state.context, key: "Escape" });
    expect(transition.state.pending?.token).toEqual(token(1));
    expect(transition.state.armed).toBe(false);
    expect(transition.intents[0]?.kind).toBe("stop-and-disarm");
  });

  it("lets a late old-context acknowledgement settle ownership without advancing old or new work", () => {
    let state = arm(createOperatorFlow(context()));
    state = cue(state, cues({ callsign: "valid" }));
    state = key(state, "Enter", { send: [token(1), token(2)] }).state;
    const old = state.context, next = context({ sessionID: "session-B", contextGeneration: 2, signalMode: "SSB" });
    let transition = operatorFlowStep(state, { type: "context-changed", previous: old, context: next });
    expect(transition.state.pending?.token).toEqual(token(1));
    expect(transition.state.deferred?.context).toEqual(next);
    expect(operatorFlowStep(transition.state, { type: "arm", context: old }).reason).toBe("operation-owned");
    transition = operatorFlowStep(transition.state, { type: "operation-outcome", context: old, token: token(1), outcome: "confirmed" });
    expect(transition.intents).toEqual([]);
    expect(transition.state).toMatchObject({ context: next, armed: false, pending: null, plan: null });
    expect(operatorFlowStep(transition.state, { type: "operation-outcome", context: old, token: token(1), outcome: "confirmed" }).reason).toBe("context-mismatch");
  });

  it("keeps the latest desired context and style through A to B to C while A remains owned", () => {
    let state = cue(arm(createOperatorFlow(context())), cues({ callsign: "valid" }));
    state = key(state, "Enter", { send: [token(1), token(2)] }).state;
    const a = state.context;
    const b = context({ sessionID: "session-B", contextGeneration: 2, signalMode: "SSB" });
    const c = context({ sessionID: "session-C", contextGeneration: 3, signalMode: "SSB" });
    state = operatorFlowStep(state, { type: "context-changed", previous: a, context: b }).state;
    expect(operatorFlowStep(state, { type: "style-changed", context: a, style: "search-and-pounce" }).reason).toBe("context-mismatch");
    state = operatorFlowStep(state, { type: "style-changed", context: b, style: "search-and-pounce" }).state;
    expect(state.deferred).toEqual({ context: b, style: "search-and-pounce" });
    state = operatorFlowStep(state, { type: "context-changed", previous: b, context: c }).state;
    state = operatorFlowStep(state, { type: "style-changed", context: c, style: "run" }).state;
    expect(state.deferred).toEqual({ context: c, style: "run" });
    const settled = operatorFlowStep(state, { type: "operation-outcome", context: a, token: token(1), outcome: "confirmed" });
    expect(settled.intents).toEqual([]);
    expect(settled.state).toMatchObject({ context: c, style: "run", armed: false, pending: null, plan: null });
  });

  it("keeps an uncertain old-context operation blocking until explicitly reconciled", () => {
    let state = arm(createOperatorFlow(context()));
    state = cue(state, cues());
    state = outcome(key(state, "Enter", { send: [token(1)] }).state, "unknown").state;
    const old = state.context, next = context({ sessionID: "session-B", contextGeneration: 2 });
    state = operatorFlowStep(state, { type: "context-changed", previous: old, context: next }).state;
    expect(operatorFlowStep(state, { type: "arm", context: old }).reason).toBe("operation-owned");
    const settled = operatorFlowStep(state, { type: "output-confirmed-idle", context: old, token: token(1) });
    expect(settled.state).toMatchObject({ context: next, armed: false, pending: null });
  });

  it("cancels a frozen send plan when fields change and never advances it after a late acknowledgement", () => {
    let state = arm(createOperatorFlow(context()));
    state = cue(state, cues({ callsign: "valid" }));
    let transition = key(state, "Enter", { send: [token(1), token(2)] });
    expect(transition.intents).toMatchObject([{ kind: "send", macro: "HISCALL", draftIdentity: "draft-A" }]);
    transition = operatorFlowStep(transition.state, { type: "cues", context: state.context,
      cues: cues({ draftIdentity: "draft-B", callsign: "valid", exchange: "invalid" }) });
    expect(transition.intents).toEqual([{ kind: "stop-and-disarm", context: state.context }]);
    expect(transition.state).toMatchObject({ armed: false, pending: { token: token(1) }, plan: { cancelled: true, draftIdentity: "draft-A" } });
    transition = operatorFlowStep(transition.state, { type: "operation-outcome", context: state.context, token: token(1), outcome: "confirmed" });
    expect(transition.intents).toEqual([]);
    expect(transition.state).toMatchObject({ pending: null, plan: null, cues: { draftIdentity: "draft-B" } });
  });

  it("rejects stale contexts, malformed cues and invalid fixed signal modes", () => {
    const state = createOperatorFlow(context());
    expect(() => createOperatorFlow({ ...context(), signalMode: "DIGI" as "CW" })).toThrow("context is invalid");
    expect(operatorFlowStep(state, { type: "cues", context: state.context,
      cues: cues({ duplicate: true, callsign: "empty" }) }).reason).toBe("cues-invalid");
    expect(operatorFlowStep(state, { type: "arm", context: context({ contextGeneration: 2 }) }).reason).toBe("context-mismatch");
  });

  it("copies and freezes caller inputs and keeps emitted intents separate from reducer state", () => {
    const suppliedContext = context();
    const suppliedCues = cues({ callsign: "valid" });
    const suppliedToken = token(1);
    const admission: OperatorKeyboardAdmission = { send: [suppliedToken, token(2)] };
    let state = createOperatorFlow(suppliedContext);
    state = cue(arm(state), suppliedCues);
    const transition = key(state, "Enter", admission);

    suppliedContext.sessionID = "mutated-session";
    suppliedCues.draftIdentity = "mutated-draft";
    suppliedToken.operationID = "mutated-operation";
    expect(transition.state).toMatchObject({ context: { sessionID: "session-A" }, pending: { token: token(1) },
      plan: { draftIdentity: "draft-A", send: [token(1), token(2)] } });
    expect(transition.intents).toMatchObject([{ kind: "send", context: { sessionID: "session-A" },
      draftIdentity: "draft-A", token: token(1) }]);
    expect((transition.intents[0] as Extract<typeof transition.intents[number], { kind: "send" }>).context)
      .not.toBe(transition.state.pending?.context);
    expect((transition.intents[0] as Extract<typeof transition.intents[number], { kind: "send" }>).token)
      .not.toBe(transition.state.pending?.token);
    expect(Object.isFrozen(transition.state.pending?.token)).toBe(true);
    expect(Object.isFrozen(transition.intents[0])).toBe(true);
    expect(Object.isFrozen(transition.intents[0]?.kind === "send" ? transition.intents[0].token : null)).toBe(true);
    expect(() => { (transition.state.pending!.token as { operationID: string }).operationID = "rewrite-state"; }).toThrow();
    expect(() => { ((transition.intents[0] as Extract<typeof transition.intents[number], { kind: "send" }>).token as
      { operationID: string }).operationID = "rewrite-intent"; }).toThrow();
    expect(transition.state.pending?.token.operationID).toBe("operation-1");
    expect(transition.intents).toMatchObject([{ kind: "send", token: { operationID: "operation-1" } }]);
  });
});

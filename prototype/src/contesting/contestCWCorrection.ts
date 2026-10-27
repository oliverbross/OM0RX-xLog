export type ContestCWCallScope = { sessionID: string; workspaceGeneration: string; laneID: "laneA" | "laneB"; draftID: string; bindingVersion: number;
  operatingContext?: string; workerGeneration?: number };
type CallAttempt = { operationID: string; call: string; serial: string; phase: "dispatched" | "uncertain" };
export type ContestCWCallState = { scope: ContestCWCallScope; unsentCall: string;
  confirmed: { operationID: string; call: string; serial: string } | null; attempt: CallAttempt | null;
  earlySend: false; incrementalCancellation: false };
const equalScope = (a: ContestCWCallScope, b: ContestCWCallScope) =>
  a.sessionID === b.sessionID && a.workspaceGeneration === b.workspaceGeneration && a.laneID === b.laneID && a.draftID === b.draftID && a.bindingVersion === b.bindingVersion && a.operatingContext === b.operatingContext && a.workerGeneration === b.workerGeneration;
function scoped(state: ContestCWCallState, scope: ContestCWCallScope) {
  if (!equalScope(state.scope, scope)) throw Error("CW call evidence belongs to another lane, draft or binding.");
}
function callText(call: string) {
  const value = call.trim().toUpperCase();
  if (value.length > 32 || !/^[A-Z0-9/?]*$/.test(value)) throw Error("Use a bounded heard call or partial call for CW correction.");
  return value;
}
export function newContestCWCallState(scope: ContestCWCallScope): ContestCWCallState {
  return { scope: { ...scope }, unsentCall: "", confirmed: null, attempt: null, earlySend: false, incrementalCancellation: false };
}
export function editContestCWCall(state: ContestCWCallState, scope: ContestCWCallScope, call: string): ContestCWCallState {
  scoped(state, scope);
  return { ...state, unsentCall: callText(call) };
}
/** Record dispatch before awaiting the existing native output owner. No sending happens here. */
export function dispatchContestCWCall(state: ContestCWCallState, scope: ContestCWCallScope, operationID: string, serial: string): ContestCWCallState {
  scoped(state, scope);
  if (state.attempt) throw Error("Resolve the dispatched CW call before another correction; it cannot be replayed.");
  if (!state.unsentCall || state.unsentCall.includes("?") || !/^[0-9a-f-]{36}$/i.test(operationID) || serial.length > 32 || /[\r\n]/.test(serial)) throw Error("A complete call, exact operation and literal serial are required.");
  return { ...state, attempt: { operationID, call: state.unsentCall, serial, phase: "dispatched" } };
}
/** Only a matching confirmed native acceptance changes confirmed call evidence. RF remains unverified. */
export function confirmContestCWCall(state: ContestCWCallState, scope: ContestCWCallScope, operationID: string): ContestCWCallState {
  scoped(state, scope);
  if (!state.attempt || state.attempt.operationID !== operationID) throw Error("CW acceptance does not match the dispatched call.");
  const { call, serial } = state.attempt;
  return { ...state, confirmed: { operationID, call, serial }, attempt: null };
}
export function stopContestCWCall(state: ContestCWCallState, scope: ContestCWCallScope): ContestCWCallState {
  scoped(state, scope);
  return { ...state, attempt: state.attempt ? { ...state.attempt, phase: "uncertain" } : null };
}
export function previewContestCWCorrection(state: ContestCWCallState, scope: ContestCWCallScope, enabled = false) {
  scoped(state, scope);
  const base = { earlySend: false as const, incrementalCancellation: false as const, serial: state.confirmed?.serial ?? "", text: "" };
  if (!enabled) return { ...base, action: "none" as const, reason: "Corrected-call assistance is off." };
  if (state.attempt) return { ...base, action: "blocked" as const, reason: "Dispatched call remains pending or uncertain. Stop does not prove which characters were sent." };
  if (!state.confirmed) return { ...base, action: "none" as const, reason: "No confirmed native call acceptance exists for this draft." };
  if (!state.unsentCall || state.unsentCall.includes("?")) return { ...base, action: "blocked" as const, reason: "Complete the heard call before preparing a correction." };
  if (state.confirmed.call === state.unsentCall) return { ...base, action: "none" as const, reason: "The editable call matches the confirmed accepted call." };
  return { ...base, action: "whole-call" as const, text: state.unsentCall,
    reason: "Whole-string provider: explicitly send the complete corrected call before TU. Character cancellation and early send are unavailable; RF is unverified." };
}

import { useEffect, useRef, useState } from "react";
import { confirmContestCWCall, dispatchContestCWCall, editContestCWCall, newContestCWCallState, previewContestCWCorrection, stopContestCWCall,
  type ContestCWCallScope } from "./contestCWCorrection";
import type { ContestLaneOutputContext } from "./contestStationControl";

export type ContestCWCorrectionPanelProps = {
  context: ContestLaneOutputContext; call: string; serial: string; disabled?: boolean;
  onSend: (text: string, operationID: string) => Promise<{ accepted: boolean; confirmed: boolean }>;
  onStop: () => Promise<{ confirmed: boolean }>;
};
/** Explicit whole-call assistance. Existing native ownership controls all output. */
export function ContestCWCorrectionPanel({ context, call, serial, disabled = false, onSend, onStop }: ContestCWCorrectionPanelProps) {
  const scope: ContestCWCallScope = { sessionID: context.sessionID, workspaceGeneration: context.workspaceGeneration, laneID: context.laneID,
    draftID: context.draftID, bindingVersion: context.bindingVersion, operatingContext: context.operatingContext, workerGeneration: context.workerGeneration };
  const scopeKey = JSON.stringify(scope), scopeEpoch = useRef(0), attemptEpoch = useRef(0);
  const [state, setState] = useState(() => newContestCWCallState(scope)), [enabled, setEnabled] = useState(false);
  const [pending, setPending] = useState(false), [stopping, setStopping] = useState(false), [message, setMessage] = useState("");
  useEffect(() => {
    scopeEpoch.current++; attemptEpoch.current++;
    setState(newContestCWCallState(scope)); setEnabled(false); setPending(false); setStopping(false); setMessage("");
    return () => { scopeEpoch.current++; attemptEpoch.current++; };
    // The explicit identity key includes native worker/operating generations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);
  useEffect(() => {
    if (call.trim().length > 32 || !/^[A-Z0-9/?]*$/i.test(call.trim())) { setMessage("Complete the heard call before preparing a CW correction."); return; }
    setState(current => editContestCWCall(current, scope, call));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, call]);
  const preview = previewContestCWCorrection(state, state.scope, enabled), complete = /^[A-Z0-9/]{1,32}$/.test(call.trim().toUpperCase());
  const send = async () => {
    if (disabled || pending || stopping || !complete) return;
    const contextVersion = scopeEpoch.current, attemptVersion = ++attemptEpoch.current;
    try {
      const operationID = crypto.randomUUID(), edited = editContestCWCall(state, scope, call);
      const proposed = previewContestCWCorrection(edited, scope, enabled);
      if (edited.confirmed && proposed.action !== "whole-call") throw Error(proposed.reason);
      const dispatched = dispatchContestCWCall(edited, scope, operationID, edited.confirmed?.serial ?? serial);
      setState(dispatched); setPending(true); setMessage("Call dispatched; awaiting the exact native acceptance.");
      const result = await onSend(dispatched.attempt!.call, operationID);
      if (contextVersion !== scopeEpoch.current || attemptVersion !== attemptEpoch.current) return;
      if (!result.accepted || !result.confirmed) throw Error("Native call output remains unconfirmed; inspect the original operation without replaying it.");
      setState(current => confirmContestCWCall(current, scope, operationID));
      setMessage("Whole call accepted by the native provider. RF and individual sent characters remain unverified.");
    } catch (error) {
      if (contextVersion !== scopeEpoch.current || attemptVersion !== attemptEpoch.current) return;
      setState(current => stopContestCWCall(current, scope));
      setMessage(error instanceof Error ? error.message : "Call output is uncertain. Inspect the original operation before continuing.");
    } finally { if (contextVersion === scopeEpoch.current) setPending(false); }
  };
  const stop = async () => {
    if (stopping) return;
    const contextVersion = scopeEpoch.current;
    attemptEpoch.current++; setState(current => stopContestCWCall(current, scope)); setStopping(true);
    try {
      const receipt = await onStop();
      if (contextVersion === scopeEpoch.current) setMessage(receipt.confirmed
        ? "Stop confirmed. Prior accepted call is retained; a dispatched call still has unknown sent characters."
        : "Stop remains unconfirmed. The native owner is retained; another lane cannot acquire TX.");
    } catch (error) { if (contextVersion === scopeEpoch.current) setMessage(error instanceof Error ? error.message : "Stop remains uncertain; retain the original owner."); }
    finally { if (contextVersion === scopeEpoch.current) setStopping(false); }
  };
  return <section aria-label={`${context.laneID} corrected call`}>
    <h4>Whole-call correction</h4>
    <label><input type="checkbox" checked={enabled} disabled={pending || stopping} onChange={event => setEnabled(event.target.checked)}/> Enable corrected-call assistance</label>
    <p>Accepted call: <strong>{state.confirmed?.call ?? "No confirmed acceptance"}</strong> · editable unsent call: <strong>{call || "Empty"}</strong></p>
    <p>Early send is off. This provider accepts whole strings; per-character cancellation is unavailable. Manual logging remains independent.</p>
    <p>{preview.reason}</p>
    <button type="button" disabled={disabled || pending || stopping || !complete || Boolean(state.attempt) || Boolean(state.confirmed) && preview.action !== "whole-call"}
      onClick={() => void send()}>{state.confirmed ? "Send whole corrected call" : "Send current call"}</button>
    <button type="button" disabled={stopping} onClick={() => void stop()}>Stop lane CW</button>
    {message && <p role="status">{message}</p>}
  </section>;
}

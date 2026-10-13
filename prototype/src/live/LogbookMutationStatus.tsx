import type { LogbookMutationSession, LogbookMutationState } from "./logbookMutationSession";
export function LogbookMutationStatus({ state, session, run }: { state: LogbookMutationState; session: LogbookMutationSession;
  run: (action: () => Promise<unknown>) => Promise<void> }) {
  if (!state.error && !state.pending) return null;
  return <div className="live-error contact-recovery" role="alert" aria-label="Logbook operation recovery">
    <span>{state.error || (state.pending?.action === "delete" ? "Deleting contact…" : "Restoring contact…")}</span>
    {state.pending && !state.workspaceChanged ? <>
      <button type="button" disabled={state.busy} onClick={() => void run(() => session.reconcile())}>Check logbook operation</button>
      <button type="button" disabled={state.busy} onClick={() => void run(() => session.retry())}>Retry same operation</button>
    </> : <button type="button" disabled={state.busy} onClick={() => void run(async () => session.dismiss())}>
      {state.workspaceChanged ? "Discard earlier operation" : "Dismiss logbook notice"}</button>}
  </div>;
}

import type { DraftSessionState, OperatorDraftSession } from "./operatorDraftSession";

type Props = { state: DraftSessionState; session: OperatorDraftSession;
  run: (action: () => Promise<unknown>) => Promise<void> };
export function OperatorDraftStatus({ state, session, run }: Props) {
  if (!state.error && !state.conflict) return null;
  return <div className="live-error contact-recovery" role="alert" aria-label="QSO draft recovery">
    <span>{state.error || "The shared QSO draft has changed. Your local text is retained."}</span>
    {state.workspaceChanged ? <>
      <button type="button" disabled={state.locked} onClick={() => void run(() => session.useShared())}>Load current workspace draft</button>
      <button type="button" onClick={() => void run(() => navigator.clipboard.writeText(JSON.stringify(state.draft, null, 2)))}>Copy my draft</button>
    </> : state.pending ? <>
      <button type="button" onClick={() => void run(() => session.reconcile())}>Check saved operation</button>
      <button type="button" onClick={() => void run(() => session.retry())}>Retry same operation</button>
    </> : state.conflict ? <>
      <span>Shared draft: {state.conflict.qso.call || "blank QSO"}</span>
      <button type="button" disabled={state.locked} onClick={() => void run(() => session.useShared())}>Use shared draft</button>
      {state.conflict.qso.id === state.draft?.id && <button type="button" disabled={state.locked} onClick={() => void run(async () => { session.keepLocal(); await session.flush(); })}>Keep my text</button>}
      <button type="button" onClick={() => void run(() => navigator.clipboard.writeText(JSON.stringify(state.draft, null, 2)))}>Copy my draft</button>
    </> : !state.locked && <button type="button" onClick={() => void run(() => session.flush())}>Retry draft save</button>}
  </div>;
}

import type { ContactEditState, LogbookContactSession } from "./logbookContactSession";
type Props = { state: ContactEditState; session: LogbookContactSession; run: (action: () => Promise<unknown>) => Promise<void> };
export function ContactEditStatus({ state, session, run }: Props) {
  if (!state.error && !state.conflict) return null;
  return <div className="live-error contact-recovery" role="alert" aria-label="Logged contact recovery">
    <span>{state.error}</span>
    {state.pending ? <>
      <button type="button" onClick={() => void run(() => session.reconcile())}>Check contact update</button>
      <button type="button" onClick={() => void run(() => session.retry())}>Retry same update</button>
    </> : <>
      {state.conflict ? state.current && !state.current.qso.deletedAt && <button type="button" disabled={state.locked} onClick={() => void run(() => session.useCurrent())}>Load latest contact</button>
        : state.draft && <button type="button" disabled={state.locked} onClick={() => void run(() => session.save())}>Retry update</button>}
      {state.draft && <button type="button" disabled={state.locked} onClick={() => void run(async () => session.cancel())}>Cancel edit</button>}
    </>}
    {state.draft && <button type="button" onClick={() => void run(() => navigator.clipboard.writeText(JSON.stringify(state.draft, null, 2)))}>Copy my edits</button>}
  </div>;
}

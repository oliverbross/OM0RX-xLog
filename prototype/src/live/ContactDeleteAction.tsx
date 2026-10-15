import { useEffect, useState, useSyncExternalStore } from "react";
import type { DraftSnapshot } from "./operatorDraftSession";
import type { LogbookMutationSession } from "./logbookMutationSession";

/** Shares the table's receipt-backed Delete/Undo owner and the editor's exact
 * reviewed revision. Never refetch a newer revision to authorize a deletion. */
export function ContactDeleteAction({ snapshot, mutations, disabled, run, onDeleted }: {
  snapshot: DraftSnapshot; mutations: LogbookMutationSession; disabled: boolean;
  run: (action: () => Promise<unknown>) => unknown; onDeleted: () => void;
}) {
  const state = useSyncExternalStore(mutations.subscribe, mutations.getSnapshot);
  const [confirmed, setConfirmed] = useState<DraftSnapshot | null>(null);
  useEffect(() => { setConfirmed(null); }, [snapshot]);
  useEffect(() => {
    const deleted = state.undo;
    if (!state.pending && !state.busy && deleted?.qso.id === snapshot.qso.id &&
      deleted.generation === snapshot.generation && deleted.revision === snapshot.revision + 1) onDeleted();
  }, [state.undo, state.pending, state.busy, snapshot, onDeleted]);
  const blocked = disabled || state.busy || !!state.pending || state.conflict || state.workspaceChanged;
  return <span className="qso-contact-delete">
    {confirmed ? <span role="group" aria-label={`Delete ${snapshot.qso.call}`}>
      <span>Delete {snapshot.qso.call}? Unsaved edits will be discarded. You can undo this deletion.</span>
      <button type="button" disabled={blocked} onClick={() => { if (!blocked) void run(async () => { await mutations.delete(confirmed); }); }}>Confirm delete</button>
      <button type="button" disabled={blocked} onClick={() => setConfirmed(null)}>Keep contact</button>
    </span> : <button type="button" disabled={blocked} onClick={() => { if (!blocked) setConfirmed(snapshot); }}>Delete QSO</button>}
  </span>;
}

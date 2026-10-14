import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { workerRequest } from "../worker";
import { LogbookPanel } from "./LogbookPanel";
import QSOEditor from "./QSOEditor";
import { LogbookContactSession, readContactJournal } from "./logbookContactSession";
import { LogbookMutationSession, readLogbookMutationJournal } from "./logbookMutationSession";
import { requestLogbookContact } from "./logbookContactTransport";
import { ContactEditStatus } from "./ContactEditStatus";
import { LogbookMutationStatus } from "./LogbookMutationStatus";
import { connectLogbookChanges, protectLogbookClose } from "./logbookWindows";
import { changedCallDraft } from "./draftEnrichment";
import type { DraftQSO } from "./operatorDraftSession";
import { nativeSpotEditor, useSpotEditor } from "./useSpotEditor";

export const detachedContactJournalKey = "xlog.integration.contactEdit.logbook.v1";
export const detachedMutationJournalKey = "xlog.integration.logbookMutation.logbook.v1";
function stored(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
async function request(method: string, params: Record<string, unknown> = {}) {
  return (await workerRequest(method, params)).result;
}

export function DetachedLogbookSurface() {
  const [contacts] = useState(() => new LogbookContactSession(requestLogbookContact,
    journal => journal ? localStorage.setItem(detachedContactJournalKey, JSON.stringify(journal)) : localStorage.removeItem(detachedContactJournalKey),
    readContactJournal(stored(detachedContactJournalKey)), undefined, nativeSpotEditor()));
  const [mutations] = useState(() => new LogbookMutationSession(requestLogbookContact,
    journal => localStorage.setItem(detachedMutationJournalKey, JSON.stringify(journal)),
    readLogbookMutationJournal(stored(detachedMutationJournalKey)), undefined, contacts.canAcceptLocalInput));
  const edit = useSyncExternalStore(contacts.subscribe, contacts.getSnapshot);
  const mutation = useSyncExternalStore(mutations.subscribe, mutations.getSnapshot);
  const [refresh, setRefresh] = useState(0), [error, setError] = useState("");
  const [working, setWorking] = useState(false), [tableBusy, setTableBusy] = useState(false);
  const [lookup, setLookup] = useState<Record<string, any> | null>(null);
  const [previous, setPrevious] = useState<Record<string, any>[]>([]);
  const workingRef = useRef(false), tableBusyRef = useRef(false);
  useSpotEditor([contacts], () => workingRef.current || tableBusyRef.current || mutations.getSnapshot().busy || mutations.getSnapshot().pending
    ? { ready: false, reason: "Finish the logbook action or close/Dock operation first." } : { ready: true });
  const acceptsInput = useCallback(() => contacts.canAcceptLocalInput() && !workingRef.current, [contacts]);
  const run = useCallback(async (action: () => Promise<unknown>) => {
    if (workingRef.current) return;
    workingRef.current = true; setWorking(true); setError("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { workingRef.current = false; setWorking(false); }
  }, []);
  const changed = useCallback(() => {
    setRefresh(value => value + 1);
    void contacts.refresh().catch(cause => setError(cause instanceof Error ? cause.message : "Contact refresh failed."));
  }, [contacts]);
  useEffect(() => connectLogbookChanges(changed, setError), [changed]);
  useEffect(() => { void run(async () => { await contacts.refresh(); await mutations.reconcile(); }); }, [contacts, mutations, run]);
  const cannotClose = useCallback(() => (!!contacts.getSnapshot().draft || contacts.getSnapshot().locked ||
    contacts.getSnapshot().activationFrozen || !!mutations.getSnapshot().pending || mutations.getSnapshot().busy || workingRef.current || tableBusyRef.current), [contacts, mutations]);
  const explainClose = useCallback(() => setError("Finish or cancel the contact edit and resolve pending operations before closing or docking this window."), []);
  useEffect(() => protectLogbookClose(cannotClose, explainClose, setError), [cannotClose, explainClose]);
  const tableWorking = useCallback((value: boolean) => { tableBusyRef.current = value; setTableBusy(value); }, []);
  useEffect(() => {
    const call = String(edit.draft?.call ?? "").trim().toUpperCase();
    setLookup(null); setPrevious([]);
    if (!call) return;
    let active = true;
    const timer = setTimeout(() => {
      void request("lookup_call", { call }).then(value => { if (active) setLookup(value as Record<string, any>); }).catch(() => {});
      void request("logbook_previous", { call }).then((value: any) => { if (active) setPrevious(value.qsos ?? []); }).catch(() => {});
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [edit.draft?.call, refresh]);
  return <div className="app live monitor-app detached-logbook-app">
    <main aria-label="Detached Logbook">
      {error && <p className="live-error" role="alert">{error}</p>}
      <ContactEditStatus state={edit} session={contacts} run={run} />
      <LogbookMutationStatus state={mutation} session={mutations} run={run} />
      {edit.draft ? <QSOEditor draft={edit.draft} setDraft={next => {
        if (!acceptsInput() || edit.locked || edit.workspaceChanged) return;
        const current = contacts.getSnapshot().draft;
        const value = changedCallDraft(current, typeof next === "function" ? next(current) : next);
        if (value) contacts.edit(value as DraftQSO);
      }} save={() => run(async () => { await contacts.save(); changed(); })}
        clear={() => void run(async () => { contacts.cancel(); changed(); })}
        busy={working || edit.activationFrozen || edit.locked || edit.conflict || edit.workspaceChanged}
        draftLocked={edit.activationFrozen || edit.locked || edit.workspaceChanged} canAcceptLocalInput={acceptsInput} isEditing radioControls={false} clearLabel="Cancel edit"
        lookup={lookup} previous={previous} follow={false} setFollow={() => {}} request={request} />
        : <LogbookPanel taskToolbar onRequest={request} refreshKey={refresh} mutations={mutations} onChanged={changed}
          onBusyChange={tableWorking} disabled={working || edit.activationFrozen || edit.locked} columnContext="detached"
          onEdit={qso => { if (!tableBusy) void run(() => contacts.open(qso.id)); }} />}
    </main>
  </div>;
}

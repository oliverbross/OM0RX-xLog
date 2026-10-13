import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type SetStateAction } from "react";
import { workerRequest } from "../worker";
import QSOEditor from "./QSOEditor";
import { OperatorDraftSession, readDraftJournal, type DraftQSO } from "./operatorDraftSession";
import { requestOperatorDraft } from "./operatorDraftTransport";
import { OperatorDraftStatus } from "./OperatorDraftStatus";
import { changedCallDraft, normalizedCall } from "./draftEnrichment";
import { connectOperatorDraftChanges, protectOperatorDraftClose } from "./operatorDraftWindows";
import { dockDetachedWorkspace } from "./DetachedClusterBridge";
import "./DetachedQSOSurface.css";

export const detachedQSOJournalKey = "xlog.integration.operatorDraft.log-qso.v1";
const readMethods = new Set(["lookup_call", "logbook_previous", "logbook_matrix", "cluster_history"]);
function storedJournal() { try { return localStorage.getItem(detachedQSOJournalKey); } catch { return null; } }
async function request(method: string, params: Record<string, unknown> = {}) {
  if (!readMethods.has(method)) throw new Error("This control is unavailable in the detached QSO editor.");
  const result = (await workerRequest(method, params)).result;
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("The QSO context response could not be verified.");
  return result as Record<string, any>;
}

/** A view of the canonical draft, never a second station/session controller. */
export function DetachedQSOSurface() {
  const localInput = useRef(false);
  const [session] = useState(() => new OperatorDraftSession(async (method, params) => {
    const result = await requestOperatorDraft(method, params);
    // Also fence a read already in flight when unfinished editor text appears.
    // Such text is not represented by session.dirty or its recovery journal.
    if (method === "logbook_operator_draft" && localInput.current)
      throw new Error("Finish the draft fields before refreshing the shared QSO.");
    return result;
  },
    journal => localStorage.setItem(detachedQSOJournalKey, JSON.stringify(journal)),
    readDraftJournal(storedJournal())));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [working, setWorking] = useState(false), [closing, setClosing] = useState(false);
  const [lookup, setLookup] = useState<Record<string, any> | null>(null);
  const [previous, setPrevious] = useState<Record<string, any>[]>([]);
  const workingRef = useRef(false), closingRef = useRef(false), docking = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const report = useCallback((text: string) => { if (mounted.current) setError(text); }, []);
  const run = useCallback(async (action: () => Promise<unknown>) => {
    if (workingRef.current || closingRef.current) return;
    workingRef.current = true; setWorking(true); setError("");
    try { await action(); }
    catch (cause) { report(cause instanceof Error ? cause.message : "QSO operation failed."); }
    finally { workingRef.current = false; if (mounted.current) setWorking(false); }
  }, [report]);
  const refresh = useCallback(async () => {
    if (localInput.current || closingRef.current) return;
    await session.refresh();
    const current = session.getSnapshot();
    if (!session.dirty && !localInput.current && !current.pending && !current.error && !current.conflict && !current.workspaceChanged) report("");
  }, [session, report]);
  // The shared helper subscribes before reading, coalesces wakes/focus reads,
  // and polls boundedly for worker-owned power updates without a main window.
  useEffect(() => connectOperatorDraftChanges(refresh, report), [refresh, report]);
  useEffect(() => {
    if (closing || !state.base || state.locked || state.workspaceChanged || state.pending || state.conflict || !session.dirty) return;
    const timer = setTimeout(() => {
      void session.flush().then(() => { if (!localInput.current) report(""); })
        .catch(cause => report(cause instanceof Error ? cause.message : "Draft could not be saved."));
    }, 350);
    return () => clearTimeout(timer);
  }, [session, state, report, closing]);
  const cannotClose = useCallback(() => {
    const current = session.getSnapshot();
    return workingRef.current && !docking.current || localInput.current || session.dirty || !!current.pending ||
      current.locked || !!current.conflict || current.workspaceChanged;
  }, [session]);
  const explainClose = useCallback(() => report("Finish the draft fields and resolve unsaved or pending QSO changes before closing or docking this window."), [report]);
  const closeState = useCallback((value: boolean) => {
    closingRef.current = value;
    if (mounted.current) setClosing(value);
  }, []);
  const inputState = useCallback((value: boolean) => {
    localInput.current = value;
    session.setLocalInputPending(value);
  }, [session]);
  useEffect(() => protectOperatorDraftClose(cannotClose, explainClose, report, closeState), [cannotClose, explainClose, report, closeState]);
  const setDraft = useCallback((next: SetStateAction<Record<string, any> | null>) => {
    const current = session.getSnapshot();
    if (workingRef.current || closingRef.current || current.locked || current.workspaceChanged || current.conflict || !current.draft) return;
    const value = changedCallDraft(current.draft, typeof next === "function" ? next(current.draft) : next);
    if (value) session.edit(value as DraftQSO);
    setMessage("");
  }, [session]);
  useEffect(() => {
    const baseline = state.draft, call = normalizedCall(baseline?.call), generation = state.base?.generation;
    setLookup(null); setPrevious([]);
    if (!baseline || !/^[A-Z0-9/-]{3,32}$/.test(call) || state.workspaceChanged) return;
    let active = true;
    const timer = setTimeout(() => {
      void request("lookup_call", { call }).then(info => {
        const current = session.getSnapshot();
        if (!active || current.base?.generation !== generation || current.draft?.id !== baseline.id || normalizedCall(current.draft?.call) !== call) return;
        setLookup(info);
        // Lookup is display-only. The editor's explicit Fill action avoids a
        // late reply creating unsaved text after native Close/Dock consent.
      }).catch(cause => { if (active) setLookup({ call, source: cause instanceof Error ? cause.message : "Lookup unavailable" }); });
      void request("logbook_previous", { call, limit: 10 }).then(value => {
        if (active) setPrevious(Array.isArray(value?.qsos) ? value.qsos : []);
      }).catch(() => { if (active) setPrevious([]); });
    }, 400);
    return () => { active = false; clearTimeout(timer); };
  }, [state.draft?.id, state.draft?.call, state.base?.generation, state.workspaceChanged, session]);
  const dock = () => {
    if (cannotClose()) { explainClose(); return; }
    docking.current = true;
    void run(dockDetachedWorkspace).finally(() => { docking.current = false; });
  };
  const blocked = state.locked || state.workspaceChanged || !!state.conflict || !!state.pending;
  return <div className="app live monitor-app detached-qso-app"><main aria-label="Detached Log QSO">
    <div className="live-actions detached-qso-actions">
      <span className="secondary" role="status">{message || (!state.base ? "Loading shared QSO draft…" : blocked ? "Review QSO draft recovery." : session.dirty ? "Draft changes awaiting local save." : "Draft saved locally.")}</span>
      <button type="button" onClick={dock} disabled={working || closing}>Dock back</button>
    </div>
    {error && <p className="live-error" role="alert">{error}</p>}
    <OperatorDraftStatus state={state} session={session} run={run} />
    <QSOEditor draft={state.draft} setDraft={setDraft} save={() => run(async () => {
      const saved = await session.commit("save");
      if (saved && mounted.current) setMessage(`${saved.call} saved to the local logbook.`);
    })} clear={() => void run(async () => { await session.commit("clear"); if (mounted.current) setMessage(""); })}
      busy={working || closing || blocked} draftLocked={working || closing || blocked}
      lookup={lookup} previous={previous} follow={false} setFollow={() => {}} request={request} radioControls={false}
      onLocalInputState={inputState}
      powerState={state.base?.power} powerIntent={state.powerIntent} automaticPowerEnabled={state.base?.power?.enabled === true}
      onManualPower={value => {
        const current = session.getSnapshot();
        if (workingRef.current || closingRef.current || current.locked || current.pending || current.conflict || current.workspaceChanged) return;
        session.setManualPower(value); setMessage("");
      }}
      onResumeAutomaticPower={state.base?.power ? () => void run(async () => { session.resumeAutomaticPower(); await session.flush(); }) : undefined} />
  </main></div>;
}

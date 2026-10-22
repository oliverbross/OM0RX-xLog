import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type SetStateAction } from "react";
import { workerRequest } from "../worker";
import QSOEditor from "./QSOEditorCore";
import { DeskQSO } from "./OperatorDesk";
import { useQSOLoggedToast } from "./QSOLoggedToast";
import { OperatorDraftSession, readDraftJournal, type DraftQSO } from "./operatorDraftSession";
import { requestOperatorDraft } from "./operatorDraftTransport";
import { OperatorDraftStatus } from "./OperatorDraftStatus";
import { changedCallDraft, fillEmptyLookupFields, normalizedCall } from "./draftEnrichment";
import { connectOperatorDraftChanges, protectOperatorDraftClose } from "./operatorDraftWindows";
import { nativeSpotEditor, useSpotEditor } from "./useSpotEditor";
import { SpotActivationStatus } from "./SpotActivationStatus";
import { StableFeedbackLayer } from "./StableFeedbackLayer";
import { useReferenceEvidence } from "./useReferenceEvidence";
import { invoke } from "@tauri-apps/api/core";
import { validSpotActivationSnapshot } from "./spotActivation";
import { loadReadRadioJournal, type ReadRadioJournal } from "./readRadioJournal";
import "./DetachedQSOSurface.css";

export const detachedQSOJournalKey = "xlog.integration.operatorDraft.log-qso.v1";
const readRadioJournalKey = `${detachedQSOJournalKey}.readRadio`;
const readMethods = new Set(["lookup_call", "logbook_previous", "logbook_duplicate", "logbook_matrix", "cluster_history", "reference_resolve"]);
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
  const [mode, setMode] = useState<"simple" | "full">("full");
  const [session] = useState(() => new OperatorDraftSession(async (method, params) => {
    const result = await requestOperatorDraft(method, params);
    // Also fence a read already in flight when unfinished editor text appears.
    // Such text is not represented by session.dirty or its recovery journal.
    if (method === "logbook_operator_draft" && localInput.current)
      throw new Error("Finish the draft fields before refreshing the shared QSO.");
    return result;
  },
    journal => localStorage.setItem(detachedQSOJournalKey, JSON.stringify(journal)),
    readDraftJournal(storedJournal()), undefined, nativeSpotEditor()));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const referenceEvidence = useReferenceEvidence(state.draft, state.base?.generation, request);
  const [error, setError] = useState("");
  const loggedFeedback = useQSOLoggedToast();
  const [working, setWorking] = useState(false), [closing, setClosing] = useState(false);
  const [lookup, setLookup] = useState<Record<string, any> | null>(null);
  const [previous, setPrevious] = useState<Record<string, any>[]>([]);
  const workingRef = useRef(false), closingRef = useRef(false), mounted = useRef(true);
  const readingRadio = useRef(false), readOperation = useRef<ReadRadioJournal | null>(loadReadRadioJournal(readRadioJournalKey));
  const [radioBusy, setRadioBusy] = useState(false);
  const spotEditor = useSpotEditor([session], snapshot => readOperation.current && snapshot.operationId !== readOperation.current.operationId
    ? { ready: false, reason: "Check the retained Read radio outcome before another activation." }
    : workingRef.current || closingRef.current || localInput.current
      ? { ready: false, reason: "Finish the buffered fields or close/Dock operation first." } : { ready: true });
  const acceptsInput = useCallback(() => session.canAcceptLocalInput() && !workingRef.current && !closingRef.current && !readingRadio.current, [session]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const report = useCallback((text: string) => { if (mounted.current) setError(text); }, []);
  const run = useCallback(async (action: () => Promise<unknown>) => {
    if (workingRef.current || closingRef.current || readingRadio.current) return;
    workingRef.current = true; setWorking(true); setError("");
    try { await action(); }
    catch (cause) {
      const current = session.getSnapshot();
      // A journaled operation with an unknown acknowledgement is already being
      // recovered by its exact operation ID. Keep that routine recovery silent;
      // conflicts and terminal failures remain visible through the session.
      if (!current.pending || current.conflict || current.workspaceChanged)
        report(cause instanceof Error ? cause.message : "QSO operation failed.");
    }
    finally { workingRef.current = false; if (mounted.current) setWorking(false); }
  }, [report, session]);
  const readRadio = async () => {
    if (readOperation.current) throw new Error("Check the existing Read radio activation before reading again. No read was retried.");
    const before = session.getSnapshot();
    if (!acceptsInput() || localInput.current || !before.base || before.locked || before.pending || before.conflict || before.workspaceChanged || before.error)
      throw new Error("Finish the draft fields and resolve pending QSO changes before reading the radio.");
    readingRadio.current = true; setRadioBusy(true);
    try {
      await session.flush();
      const current = session.getSnapshot();
      if (closingRef.current || workingRef.current || localInput.current || !session.canAcceptLocalInput() || session.dirty || current.locked || current.pending || current.conflict || current.workspaceChanged || current.error ||
          current.base?.generation !== before.base.generation || current.base?.qso.id !== before.base.qso.id)
        throw new Error("The shared draft changed while preparing Read radio. Your text is retained.");
      const operationId = crypto.randomUUID();
      // Persist before dispatch: a remounted editor must check this same outcome.
      const journal = { operationId, generation: current.base!.generation! };
      localStorage.setItem(readRadioJournalKey, JSON.stringify(journal)); readOperation.current = journal;
      const result = await invoke("operator_draft_read_radio", { operationId });
      if (!validSpotActivationSnapshot(result) || result.operationId !== operationId || !["confirmed", "blocked", "failed", "uncertain"].includes(result.phase))
        throw new Error("Read radio outcome could not be verified. Check the existing activation before reading again.");
      if (!await spotEditor.reconcile(result)) throw new Error("Read radio editor reconciliation is incomplete. Check the retained outcome before reading again.");
      if (result.reservationActive !== true && result.phase !== "uncertain") {
        localStorage.removeItem(readRadioJournalKey); readOperation.current = null;
      }
      if (result.phase !== "confirmed" || result.reservationActive === true) throw new Error(result.error || "Read radio was not confirmed. Check the existing activation before reading again.");
    } finally { readingRadio.current = false; if (mounted.current) setRadioBusy(false); }
  };
  const refresh = useCallback(async () => {
    if (localInput.current || closingRef.current) return;
    await session.refresh();
    const current = session.getSnapshot();
    if (!session.dirty && !localInput.current && !current.pending && !current.error && !current.conflict && !current.workspaceChanged) report("");
  }, [session, report]);
  const checkReadRadio = async () => {
    const journal = readOperation.current;
    if (!journal || readingRadio.current) return;
    readingRadio.current = true; setRadioBusy(true);
    try {
      const result = await invoke("operator_draft_read_radio_recover", journal);
      if (!validSpotActivationSnapshot(result) || result.operationId !== journal.operationId || !["confirmed", "blocked"].includes(result.phase) || result.reservationActive === true ||
          !await spotEditor.reconcile(result)) throw new Error("Read radio recovery is incomplete. Its operation is retained; no read was replayed.");
      localStorage.removeItem(readRadioJournalKey); readOperation.current = null;
      report(result.phase === "confirmed" ? "Recovered Read radio receipt. The current QSO draft was refreshed." : result.error || "The current QSO draft was checked. No radio read was repeated.");
    } catch (cause) { report(cause instanceof Error ? cause.message : "Read radio recovery unavailable. No read was replayed."); }
    finally { readingRadio.current = false; if (mounted.current) setRadioBusy(false); }
  };
  // The shared helper subscribes before reading, coalesces wakes/focus reads,
  // and polls boundedly for worker-owned power updates without a main window.
  useEffect(() => connectOperatorDraftChanges(refresh, report), [refresh, report]);
  useEffect(() => {
    if (closing || state.activationFrozen || !state.base || state.locked || state.workspaceChanged || state.pending || state.conflict || !session.dirty) return;
    const timer = setTimeout(() => {
      void session.flush().then(() => { if (!localInput.current) report(""); })
        .catch(cause => report(cause instanceof Error ? cause.message : "Draft could not be saved."));
    }, 350);
    return () => clearTimeout(timer);
  }, [session, state, report, closing]);
  const cannotClose = useCallback(() => {
    const current = session.getSnapshot();
    return workingRef.current || readingRadio.current || !!readOperation.current || localInput.current || session.dirty || !!current.pending ||
      current.activationFrozen || current.locked || !!current.conflict || current.workspaceChanged;
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
    if (!acceptsInput() || current.locked || current.workspaceChanged || current.conflict || !current.draft) return;
    const value = changedCallDraft(current.draft, typeof next === "function" ? next(current.draft) : next);
    if (value) session.edit(value as DraftQSO);
  }, [session, acceptsInput]);
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
  const blocked = radioBusy || state.activationFrozen || state.locked || state.workspaceChanged || !!state.conflict || !!state.pending;
  const switchMode = (next: typeof mode) => {
    if (next === mode || workingRef.current || closingRef.current || readingRadio.current || blocked) return;
    if (localInput.current) { report("Finish the buffered fields before changing editor modes."); return; }
    setMode(next); setError("");
  };
  const save = () => run(async () => {
    const saved = await session.commit("save");
    if (saved && mounted.current) loggedFeedback.show();
  });
  const clear = () => void run(async () => { await session.commit("clear"); });
  return <div className="app live monitor-app detached-qso-app"><main className="qso-feedback-area live-feedback-host" aria-label="Detached Log QSO">
    {loggedFeedback.toast}
    <StableFeedbackLayer>
    {error && <p className="live-error" role="alert">{error}</p>}
    {readOperation.current && <button type="button" disabled={radioBusy} onClick={() => void checkReadRadio()}>Check Read radio</button>}
    <SpotActivationStatus status={spotEditor.status} error={spotEditor.error} reconcile={() => void spotEditor.reconcile()} />
    <OperatorDraftStatus state={state} session={session} run={run} />
    </StableFeedbackLayer>
    <div className="detached-qso-modes" role="group" aria-label="QSO editor mode">{(["simple", "full"] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} disabled={working || closing || blocked} onClick={() => switchMode(value)}>{value === "simple" ? "Simple" : "Full"}</button>)}</div>
    {mode === "simple" ? <><DeskQSO referenceEvidence={referenceEvidence} draft={state.draft} setDraft={setDraft} save={() => void save()} clear={clear}
      busy={working || closing || blocked} draftLocked={working || closing || blocked} request={request} refresh={state.base?.revision ?? 0}
      follow={false} setFollow={() => {}} radioControls={false} onReadRadio={readRadio} onLocalInputState={inputState} canAcceptLocalInput={acceptsInput} />
      <button className="detached-qso-fill" type="button" disabled={working || closing || blocked || !normalizedCall(state.draft?.call) || normalizedCall(lookup?.call) !== normalizedCall(state.draft?.call)} onClick={() => setDraft(current => fillEmptyLookupFields(current, lookup))}>Fill empty fields from lookup</button></> :
    <QSOEditor referenceEvidence={referenceEvidence} draft={state.draft} setDraft={setDraft} save={save} clear={clear} inspector={false}
      busy={working || closing || blocked} draftLocked={working || closing || blocked}
      lookup={lookup} previous={previous} follow={false} setFollow={() => {}} request={request} radioControls={false} onReadRadio={readRadio}
      onLocalInputState={inputState}
      canAcceptLocalInput={acceptsInput}
      powerState={state.base?.power} powerIntent={state.powerIntent} automaticPowerEnabled={state.base?.power?.enabled === true}
      onManualPower={value => {
        const current = session.getSnapshot();
        if (!acceptsInput() || current.locked || current.pending || current.conflict || current.workspaceChanged) return;
        session.setManualPower(value);
      }}
      onResumeAutomaticPower={state.base?.power ? () => void run(async () => { session.resumeAutomaticPower(); await session.flush(); }) : undefined} />}
  </main></div>;
}

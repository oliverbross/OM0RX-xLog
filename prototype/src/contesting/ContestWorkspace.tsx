import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, Database, Download, Pencil, Trash2, Trophy, X } from "lucide-react";
import { ContestMutationUncertain, ContestServerError } from "./client";
import { ContestExportPanel } from "./ContestExportPanel";
import { ContestOperatorPanel, type ContestOperatorRecovery, type ContestSimulationAdapter } from "./ContestOperatorPanel";
import { ContestAssistancePanel, type SCPSelectionScope } from "./ContestAssistancePanel";
import type { SCPImport } from "./contestAssistance";
import { isStructuredEntry } from "./types";
import { nativeContestExportSave, sharedContestExportSaveOwner, type ContestExportSaveAdapter } from "./contestExportSave";
import { sharedContestSessionOwner, type ContestOwnerLease, type ContestRecoveryStorage } from "./sessionOwner";
import type { ContestCabrilloHeader, ContestCreateInput, ContestDraftFields, ContestExportFormat, ContestFullQSO, ContestLogPage, ContestPreparedExport, ContestQSOChangeResult, ContestRequest, ContestRuleMetadata, ContestScore, ContestSessionSummary } from "./types";
import "./ContestWorkspace.css";

const PAGE_SIZE = 20;
type Props = { request: ContestRequest; createRequestID?: () => string; digestPayload?: (payload: unknown) => Promise<string>; recoveryStorage?: ContestRecoveryStorage; exportSave?: ContestExportSaveAdapter; simulateContestOutput?: ContestSimulationAdapter; scpImport?: SCPImport };
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }
function defaultStorage(): ContestRecoveryStorage | undefined { try { return globalThis.localStorage; } catch { return undefined; } }
function isQSOChange(result: unknown): result is ContestQSOChangeResult { return !!result && typeof result === "object" && "operation" in result; }
export function projectSCPCallsign(session: ContestSessionSummary, draft: {draftID:string;fields:ContestDraftFields},
  selection: SCPSelectionScope, callsign: string): ContestDraftFields|null {
  if(session.sessionID!==selection.sessionID||session.workspaceGeneration!==selection.workspaceGeneration||draft.draftID!==selection.draftID||
    draft.fields.callsign.trim().toUpperCase()!==selection.inputCallsign)return null;
  return {...draft.fields,callsign};
}

export function ContestWorkspace({ request, createRequestID, digestPayload, recoveryStorage, exportSave = nativeContestExportSave, simulateContestOutput, scpImport }: Props) {
  const storage = recoveryStorage ?? defaultStorage();
  const owner = useMemo(() => sharedContestSessionOwner(request, createRequestID, digestPayload, storage), [request, createRequestID, digestPayload, storage]);
  const exportSaveOwner = useMemo(() => sharedContestExportSaveOwner(exportSave, storage), [exportSave, storage]);
  const client = owner.client;
  const [, redraw] = useState(0);
  const [rules, setRules] = useState<ContestRuleMetadata[]>([]);
  const [workspaceGeneration, setWorkspaceGeneration] = useState("");
  const [sessions, setSessions] = useState<ContestSessionSummary[]>([]);
  const [manager, setManager] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [page, setPage] = useState<ContestLogPage | null>(null);
  const [score, setScore] = useState<ContestScore | null>(null);
  const [offset, setOffset] = useState(0);
  const [frequencyText, setFrequencyText] = useState("");
  const [editing, setEditing] = useState<{ original: ContestFullQSO; qso: ContestFullQSO } | null>(null);
  const [editFrequencyText, setEditFrequencyText] = useState("");
  const [correctionReason, setCorrectionReason] = useState("Operator correction");
  const [deletionReason, setDeletionReason] = useState("Operator deletion");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [operatingFrequencyError, setOperatingFrequencyError] = useState("");
  const [editorFrequencyError, setEditorFrequencyError] = useState("");
  const [operatorEditGeneration, setOperatorEditGeneration] = useState(0);
  const [operatorRecovery, setOperatorRecovery] = useState<ContestOperatorRecovery>(null);
  const operatorRecoverySequence = useRef(0), entryRoot = useRef<HTMLFormElement>(null);
  const operatorSubmitGuard = useRef(false);
  const callsignInput = useRef<HTMLInputElement>(null), exchangeInput = useRef<HTMLInputElement>(null);
  const [create, setCreate] = useState({ name: "", ruleID: "cq-ww-cw", station: "", operator: "", cqZone: "", entity: "", stationName: "", stationLocation: "", category: "Single Operator" });
  const actionLock = useRef(false);
  const contextTicket = useRef(0);
  const exportTicket = useRef(0), exportButton = useRef<HTMLButtonElement>(null);
  const leaseRef = useRef<ContestOwnerLease | null>(null);
  const saveTimer = useRef<number | null>(null);
  const active = owner.session, draft = owner.draft, uncertain = owner.pendingOperation;
  const draftSaveInFlight = owner.pendingPhase === "inflight" && uncertain?.method === "contest_draft_apply";
  const blockingOperation = !!uncertain && !draftSaveInFlight;

  useEffect(() => { const lease = owner.acquireLease(); leaseRef.current = lease; return () => { owner.releaseLease(lease); if (leaseRef.current === lease) leaseRef.current = null; }; }, [owner]);
  useEffect(() => owner.subscribe(() => redraw(value => value + 1)), [owner]);
  useEffect(() => {
    let cancelled = false; const lease = leaseRef.current, admission = owner.beginAdmission(lease);
    Promise.all([client.catalog(), client.sessions()]).then(([catalog, list]) => {
      if (cancelled || !lease || admission === null || !owner.accepts(lease, admission)) return;
      if (!owner.setWorkspaceGeneration(catalog.workspaceGeneration, lease, admission)) return;
      setRules(catalog.rules); setWorkspaceGeneration(catalog.workspaceGeneration); setSessions(list.sessions);
    }).catch(cause => { if (!cancelled && owner.accepts(lease, admission)) setError(message(cause)); });
    return () => { cancelled = true; if (saveTimer.current !== null) window.clearTimeout(saveTimer.current); };
  }, [client, owner]);
  const frequencyContext = active && draft ? `${active.sessionID}/${active.workspaceGeneration}/${draft.draftID}` : "";
  useEffect(() => { setFrequencyText(draft?.fields.frequencyHz?.toString() ?? ""); setOperatingFrequencyError(""); }, [frequencyContext]);
  const exportContext = active ? `${active.sessionID}/${active.workspaceGeneration}` : "";
  useEffect(() => { exportTicket.current += 1; setExportOpen(false); }, [exportContext]);
  useEffect(() => () => { exportTicket.current += 1; }, []);

  function admissionScope() { const lease = leaseRef.current, admission = owner.beginAdmission(lease); return { lease, admission }; }
  function capturedScope() { const lease = leaseRef.current, admission = owner.captureAdmission(lease); return { lease, admission }; }
  function accepts(scope: ReturnType<typeof admissionScope>) { return owner.accepts(scope.lease, scope.admission); }
  async function projections(session: ContestSessionSummary, nextOffset = 0, ticket = contextTicket.current, scope = admissionScope()) {
    const [log, currentScore] = await Promise.all([client.logPage(session, nextOffset, PAGE_SIZE), client.score(session)]);
    if (ticket !== contextTicket.current || !accepts(scope) || owner.session?.sessionID !== session.sessionID || owner.session.workspaceGeneration !== session.workspaceGeneration) return;
    setPage(log); setScore(currentScore); setOffset(nextOffset);
  }
  function beginAction() { if (actionLock.current) return false; actionLock.current = true; setBusy(true); setError(""); setNotice(""); return true; }
  function endAction(ticket: number, scope: ReturnType<typeof admissionScope>) { if (ticket === contextTicket.current && accepts(scope)) setBusy(false); actionLock.current = false; }
  function handleFailure(cause: unknown, ticket: number, scope: ReturnType<typeof admissionScope>) {
    if (ticket !== contextTicket.current || !accepts(scope)) return;
    if (!(cause instanceof ContestMutationUncertain)) { setError(message(cause)); setNeedsRefresh(cause instanceof ContestServerError && cause.code === "stale_revision"); }
  }

  async function openSession(sessionID: string) {
    if (uncertain || !beginAction()) return;
    const ticket = ++contextTicket.current, scope = admissionScope();
    try {
      await owner.flush();
      if (!accepts(scope) || owner.pendingOperation || !workspaceGeneration) return;
      const result = await client.open(sessionID, workspaceGeneration);
      if (ticket !== contextTicket.current || !accepts(scope)) return;
      if (!owner.activate(result.session, result.draft, scope.lease!, scope.admission!)) return;
      setEditing(null); setConfirmDelete(false); setManager(false); setNeedsRefresh(false);
      await owner.flush();
      if (ticket !== contextTicket.current || !accepts(scope) || !owner.session) return;
      await projections(owner.session, 0, ticket, scope);
    } catch (cause) { handleFailure(cause, ticket, scope); } finally { endAction(ticket, scope); }
  }

  function changeField<K extends keyof ContestDraftFields>(key: K, value: ContestDraftFields[K]) {
    if (!draft || busy || blockingOperation) return;
    setOperatorEditGeneration(value => value + 1);
    owner.edit({ ...draft.fields, [key]: value });
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    const ticket = contextTicket.current, scope = capturedScope();
    saveTimer.current = window.setTimeout(() => void owner.flush().catch(cause => handleFailure(cause, ticket, scope)), 180);
  }
  function changeStructuredReceived(id: string, value: string) {
    if (!draft || !active || !isStructuredEntry(active.rule.entry) || busy || blockingOperation) return;
    const receivedExchangeFields = { ...draft.fields.receivedExchangeFields, [id]: value };
    const receivedExchange = active.rule.entry.exchange.receivedFields.map(field => receivedExchangeFields[field.id] ?? "").filter(Boolean).join(" ");
    setOperatorEditGeneration(current => current + 1);
    owner.edit({ ...draft.fields, receivedExchangeFields, receivedExchange });
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    const ticket = contextTicket.current, scope = capturedScope();
    saveTimer.current = window.setTimeout(() => void owner.flush().catch(cause => handleFailure(cause, ticket, scope)), 180);
  }
  function applyAssistanceCallsign(value: string, selection: SCPSelectionScope) {
    const lease=leaseRef.current, admission=owner.captureAdmission(lease), currentSession=owner.session, currentDraft=owner.draft;
    if(busy||blockingOperation||!lease||lease.id!==selection.ownerLeaseID||admission===null||!owner.accepts(lease,admission)||!currentSession||!currentDraft)return;
    const fields=projectSCPCallsign(currentSession,currentDraft,selection,value);if(!fields)return;
    setOperatorEditGeneration(generation=>generation+1);
    owner.edit(fields);
    const ticket=contextTicket.current, scope={lease,admission};
    if(saveTimer.current!==null)window.clearTimeout(saveTimer.current);
    saveTimer.current=window.setTimeout(()=>void owner.flush().catch(cause=>handleFailure(cause,ticket,scope)),180);
  }
  function changeFrequency(raw: string) {
    if (busy || blockingOperation) return;
    setFrequencyText(raw);
    if (!/^[0-9]{0,11}$/.test(raw)) { setOperatingFrequencyError("Frequency must contain digits only."); return; }
    const parsed = raw === "" ? null : Number(raw);
    if (parsed !== null && (!Number.isSafeInteger(parsed) || parsed > 100_000_000_000)) { setOperatingFrequencyError("Frequency is outside the supported range."); return; }
    setOperatingFrequencyError(""); changeField("frequencyHz", parsed);
  }

  async function createSession(event: FormEvent) {
    event.preventDefault(); if (uncertain || !workspaceGeneration || !beginAction()) return;
    const ticket = ++contextTicket.current, scope = admissionScope();
    try {
      await owner.flush();
      if (!accepts(scope) || owner.pendingOperation) return;
      const rule = rules.find(item => item.identity.id === create.ruleID); if (!rule) throw new Error("Select an available contest.");
      const station = { callsign: create.station.trim().toUpperCase(), cqZone: create.cqZone.trim(), dxccEntity: create.entity.trim(),
        ...(isStructuredEntry(rule.entry) ? { exchangeFields: { name: create.stationName.trim(), location: create.stationLocation.trim().toUpperCase() } } : {}) };
      const input: ContestCreateInput = { name: create.name.trim(), ruleIdentity: rule.identity, referenceDataVersion: rule.referenceDataVersion,
        station,
        operator: { callsign: create.operator.trim().toUpperCase(), category: create.category.trim() } };
      const result = await client.create(workspaceGeneration, input);
      if (ticket !== contextTicket.current || !accepts(scope)) return;
      if (!owner.activate(result.session, result.draft, scope.lease!, scope.admission!)) return;
      setEditing(null); setConfirmDelete(false); setSessions(items => [...items.filter(item => item.sessionID !== result.session.sessionID), result.session]); setManager(false);
      await projections(result.session, 0, ticket, scope);
    } catch (cause) { handleFailure(cause, ticket, scope); } finally { endAction(ticket, scope); }
  }

  async function reserveSerial() {
    if (!active || !draft || uncertain || !beginAction()) throw new Error("Contest entry is busy.");
    const ticket = contextTicket.current, sessionID = active.sessionID, generation = active.workspaceGeneration, scope = admissionScope();
    try {
      await owner.flush(); if (!accepts(scope) || owner.pendingOperation) throw new Error("Contest serial admission expired.");
      const current = owner.session!, result = await client.reserveSerial(current, owner.draft!.draftID);
      if (ticket !== contextTicket.current || !accepts(scope) || owner.session?.sessionID !== sessionID || owner.session.workspaceGeneration !== generation ||
          !owner.apply(result, scope.lease!, scope.admission!)) throw new Error("Contest serial response no longer matches the active draft.");
      return result;
    } catch (cause) { handleFailure(cause, ticket, scope); throw cause; } finally { endAction(ticket, scope); }
  }
  async function commitQSO() {
    if (!active || !draft || blockingOperation || operatingFrequencyError || draft.validation.errors.length || draft.dupe.state === "duplicate" || !beginAction()) throw new Error("Contest entry is not ready to log.");
    const ticket = contextTicket.current, sessionID = active.sessionID, generation = active.workspaceGeneration, scope = admissionScope();
    try {
      await owner.flush(); if (!accepts(scope) || owner.pendingOperation) throw new Error("Contest commit admission expired."); const current = owner.session!, result = await client.commitQSO(current, owner.draft!.draftID);
      if (ticket !== contextTicket.current || !accepts(scope) || owner.session?.sessionID !== sessionID || owner.session.workspaceGeneration !== generation)
        throw new Error("Contest commit response no longer matches the active session.");
      if (!owner.apply(result, scope.lease!, scope.admission!)) throw new Error("Contest commit response was not admitted.");
      setScore(null); setNotice(`Logged ${result.qso.callsign}.`); await projections(result.session, 0, ticket, scope);
      return result;
    } catch (cause) { handleFailure(cause, ticket, scope); throw cause; } finally { endAction(ticket, scope); }
  }
  async function logQSO(event: FormEvent) {
    event.preventDefault();
    if (operatorSubmitGuard.current) return;
    try { await commitQSO(); } catch { /* surfaced by the contest owner */ }
  }
  async function editQSO(qsoID: string) {
    if (!active || uncertain || !beginAction()) return;
    const ticket = contextTicket.current, sessionID = active.sessionID, generation = active.workspaceGeneration, scope = admissionScope();
    try {
      await owner.flush();
      if (!accepts(scope) || owner.pendingOperation || owner.session?.sessionID !== sessionID || owner.session.workspaceGeneration !== generation) return;
      const result = await client.qso(owner.session, qsoID);
      if (ticket !== contextTicket.current || !accepts(scope) || owner.session?.sessionID !== sessionID || owner.session.workspaceGeneration !== generation) return;
      setEditing({ original: result.qso, qso: result.qso }); setEditFrequencyText(String(result.qso.frequencyHz));
      setCorrectionReason("Operator correction"); setDeletionReason("Operator deletion"); setConfirmDelete(false); setEditorFrequencyError("");
    } catch (cause) { handleFailure(cause, ticket, scope); } finally { endAction(ticket, scope); }
  }
  function changeQSO<K extends keyof ContestFullQSO>(key: K, value: ContestFullQSO[K]) {
    if (busy || blockingOperation) return;
    setEditing(current => current ? { ...current, qso: { ...current.qso, [key]: value } } : current);
  }
  function changeQSOReceivedField(id: string, value: string) {
    if (busy || blockingOperation || !active || !isStructuredEntry(active.rule.entry)) return;
    const entry = active.rule.entry;
    setEditing(current => {
      if (!current) return current;
      const receivedExchangeFields = { ...current.qso.receivedExchangeFields, [id]: value };
      const receivedExchange = entry.exchange.receivedFields.map(field => receivedExchangeFields[field.id] ?? "").filter(Boolean).join(" ");
      return { ...current, qso: { ...current.qso, receivedExchangeFields, receivedExchange, normalizedReceivedExchange: receivedExchange.toUpperCase() } };
    });
  }
  function changeQSOFrequency(raw: string) {
    if (busy || blockingOperation) return;
    setEditFrequencyText(raw);
    if (!/^[0-9]{1,11}$/.test(raw)) { setEditorFrequencyError("Frequency must contain digits only."); return; }
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed > 100_000_000_000) { setEditorFrequencyError("Frequency is outside the supported range."); return; }
    setEditorFrequencyError(""); changeQSO("frequencyHz", parsed);
  }
  async function refreshAfterChange(session: ContestSessionSummary, ticket: number, scope: ReturnType<typeof admissionScope>) {
    const refreshed = await client.draft(session);
    if (ticket !== contextTicket.current || !accepts(scope) || !owner.rebase(refreshed.session, refreshed.draft, scope.lease!, scope.admission!)) return false;
    const adopted = owner.session!;
    setSessions(items => items.map(item => item.sessionID === adopted.sessionID ? adopted : item));
    await projections(adopted, 0, ticket, scope);
    return true;
  }
  async function applyQSOChange(kind: "correction" | "deletion") {
    if (!active || !editing || uncertain || kind === "correction" && editorFrequencyError || !beginAction()) return;
    const ticket = contextTicket.current, sessionID = active.sessionID, generation = active.workspaceGeneration, target = editing.qso, scope = admissionScope();
    try {
      await owner.flush();
      if (!accepts(scope) || owner.pendingOperation || owner.session?.sessionID !== sessionID || owner.session.workspaceGeneration !== generation) return;
      const result = kind === "correction"
        ? await client.correctQSO(owner.session, target, correctionReason)
        : await client.deleteQSO(owner.session, target.qsoID, deletionReason);
      if (ticket !== contextTicket.current || !accepts(scope) || owner.session?.sessionID !== sessionID || owner.session.workspaceGeneration !== generation) return;
      if (!owner.applyChange(result, scope.lease!, scope.admission!)) return;
      const adopted = owner.session!;
      setEditing(null); setConfirmDelete(false); setScore(null);
      const country = result.currentTarget?.entity?.name;
      setNotice(kind === "correction" ? `Saved ${result.currentTarget!.callsign}${country ? ` · ${country}` : ""}.` : `Deleted ${target.callsign}. Score recalculated.`);
      await refreshAfterChange(adopted, ticket, scope);
    } catch (cause) { handleFailure(cause, ticket, scope); } finally { endAction(ticket, scope); }
  }
  async function checkReceipt(retry = false) {
    if (!uncertain || !beginAction()) return; const ticket = contextTicket.current, operation = uncertain, scope = admissionScope();
    try {
      if (retry) {
        const result = await client.retry(operation);
        if (ticket !== contextTicket.current || !accepts(scope)) return;
        if (isQSOChange(result)) {
          const opened = await client.open(operation.scope.sessionID, operation.scope.workspaceGeneration);
          if (ticket !== contextTicket.current || !accepts(scope) || !owner.rebase(opened.session, opened.draft, scope.lease!, scope.admission!)) return;
          setSessions(items => items.map(item => item.sessionID === opened.session.sessionID ? opened.session : item));
          setEditing(null); setConfirmDelete(false); setManager(false); setNotice(result.operation === "correction" ? "Saved." : "Deleted. Score recalculated.");
          await projections(opened.session, 0, ticket, scope);
        } else {
          if (!owner.activate(result.session, result.draft, scope.lease!, scope.admission!)) return;
          setManager(false); await projections(result.session, 0, ticket, scope);
          if (operation.method === "contest_serial_reserve" || operation.method === "contest_qso_commit")
            setOperatorRecovery({ sequence: ++operatorRecoverySequence.current, method: operation.method,
              sessionID: operation.scope.sessionID, workspaceGeneration: operation.scope.workspaceGeneration,
              requestID: operation.scope.requestID, payloadDigest: operation.scope.payloadDigest });
        }
      } else {
        const result = await client.receipt(operation);
        if (ticket !== contextTicket.current || !accepts(scope)) return;
        if (result.status === "not_found") setNotice("The original operation is still unresolved. Retry the same operation only.");
        else {
          const opened = await client.open(operation.scope.sessionID, operation.scope.workspaceGeneration);
          if (ticket !== contextTicket.current || !accepts(scope) || opened.session.workspaceGeneration !== operation.scope.workspaceGeneration) return;
          const qsoChange = operation.method === "contest_qso_correct" || operation.method === "contest_qso_delete";
          if (!(qsoChange ? owner.rebase(opened.session, opened.draft, scope.lease!, scope.admission!) : owner.activate(opened.session, opened.draft, scope.lease!, scope.admission!))) return;
          if (!owner.confirmPending(operation, scope.lease!, scope.admission!)) return;
          if (qsoChange) { setEditing(null); setConfirmDelete(false); setNotice("Saved. Contest totals refreshed."); }
          setManager(false); await projections(opened.session, 0, ticket, scope);
          if (operation.method === "contest_serial_reserve" || operation.method === "contest_qso_commit")
            setOperatorRecovery({ sequence: ++operatorRecoverySequence.current, method: operation.method,
              sessionID: operation.scope.sessionID, workspaceGeneration: operation.scope.workspaceGeneration,
              requestID: operation.scope.requestID, payloadDigest: operation.scope.payloadDigest });
        }
      }
    } catch (cause) { handleFailure(cause, ticket, scope); } finally { endAction(ticket, scope); }
  }
  async function refreshDraft() {
    if (!active || !beginAction()) return; const ticket = contextTicket.current, scope = admissionScope();
    try {
      const result = await client.draft(active);
      if (ticket === contextTicket.current && accepts(scope) && owner.rebase(result.session, result.draft, scope.lease!, scope.admission!)) { setNeedsRefresh(false); setNotice("Draft refreshed; your local edit remains ready to save."); }
    } catch (cause) { handleFailure(cause, ticket, scope); } finally { endAction(ticket, scope); }
  }
  async function movePage(next: number) {
    if (!active || !beginAction()) return; const ticket = contextTicket.current, scope = admissionScope();
    try { await projections(active, next, ticket, scope); } catch (cause) { handleFailure(cause, ticket, scope); } finally { endAction(ticket, scope); }
  }
  function closeExport() { exportTicket.current += 1; setExportOpen(false); }
  async function prepareExport(format: ContestExportFormat, header: ContestCabrilloHeader): Promise<ContestPreparedExport | null> {
    const token = ++exportTicket.current, sessionID = owner.session?.sessionID, generation = owner.session?.workspaceGeneration;
    if (!sessionID || !generation || owner.pendingOperation) throw new Error("Finish the current contest save before exporting.");
    await owner.flush();
    const current = owner.session;
    if (token !== exportTicket.current || !current || current.sessionID !== sessionID || current.workspaceGeneration !== generation || owner.pendingOperation) return null;
    const prepared = await client.prepareExport({ exportID: crypto.randomUUID(), sessionID, workspaceGeneration: generation,
      expectedRevision: current.revision, generatedAtUTC: new Date().toISOString(), format, header });
    if (token !== exportTicket.current || owner.session?.sessionID !== sessionID || owner.session.workspaceGeneration !== generation) {
      void client.releaseExport(prepared).catch(() => {}); return null;
    }
    return prepared;
  }

  const disabled = busy || !!uncertain;
  const entryDisabled = busy || blockingOperation;
  const sacPreview = active?.rule.identity.id.startsWith("sac-") ?? false;
  const selectedCreateRule = rules.find(rule => rule.identity.id === create.ruleID);
  return <main className="contest-workspace">
    <header className="contest-header"><div><p>CONTESTING PILOT</p><h1>{active ? `${active.rule.displayName} · ${active.name}` : "Contest Workspace"}</h1></div><div className="contest-header-actions">{active && !manager && <button ref={exportButton} type="button" disabled={disabled} aria-haspopup="dialog" onClick={() => setExportOpen(true)}><Download size={15}/>Export…</button>}<button type="button" disabled={disabled} onClick={() => { closeExport(); setManager(value => !value); }}><Database size={15}/>Contest Manager</button></div></header>
    {error && <p className="contest-alert is-error" role="alert"><AlertTriangle size={15}/>{error}{needsRefresh && <button type="button" onClick={() => void refreshDraft()}>Refresh draft</button>}</p>}
    {notice && <p className="contest-alert" role="status"><CheckCircle2 size={15}/>{notice}</p>}
    {uncertain && <section className="contest-alert is-uncertain"><div><strong>{owner.pendingPhase === "inflight" ? "Saving…" : busy ? "Checking save status…" : "Save status unknown"}</strong><p>The original save is preserved for receipt checking or an exact retry.</p></div>{owner.pendingPhase === "uncertain" && <><button disabled={busy} onClick={() => void checkReceipt(false)}>Check save status</button><button disabled={busy} onClick={() => void checkReceipt(true)}>Retry same save</button></>}</section>}
    {manager && <section className="contest-manager"><div className="contest-session-list"><h2>Contest sessions</h2>{sessions.map(session => <button type="button" key={session.sessionID} disabled={disabled} aria-current={active?.sessionID === session.sessionID || undefined} onClick={() => void openSession(session.sessionID)}><span><strong>{session.name}</strong><small>{session.rule.displayName} · {session.qsoCount} QSOs</small></span><time>{session.rule.identity.edition}</time></button>)}</div>
      <form className="contest-create" onSubmit={createSession} aria-label="Create contest session"><h2>New session</h2><label>Session name<input maxLength={128} value={create.name} onChange={e => setCreate({...create,name:e.target.value})}/></label><label>Contest<select value={create.ruleID} onChange={e => setCreate({...create,ruleID:e.target.value})}>{rules.map(rule => <option key={rule.identity.id} value={rule.identity.id}>{rule.displayName} · {rule.identity.edition}</option>)}</select></label><div className="contest-create-fields"><label>Station callsign<input maxLength={32} value={create.station} onChange={e => setCreate({...create,station:e.target.value})}/></label><label>Operator callsign<input maxLength={32} value={create.operator} onChange={e => setCreate({...create,operator:e.target.value})}/></label><label>CQ zone<input maxLength={8} value={create.cqZone} onChange={e => setCreate({...create,cqZone:e.target.value})}/></label><label>DXCC entity<input maxLength={160} value={create.entity} onChange={e => setCreate({...create,entity:e.target.value})}/></label>{selectedCreateRule && isStructuredEntry(selectedCreateRule.entry) && <><label>Station name<input maxLength={32} value={create.stationName} onChange={e => setCreate({...create,stationName:e.target.value})}/></label><label>Station location<input maxLength={8} value={create.stationLocation} onChange={e => setCreate({...create,stationLocation:e.target.value.toUpperCase()})}/></label></>}</div><p className="contest-source">Exact rule and reference versions are pinned at creation.</p><button className="contest-primary" type="submit" disabled={disabled}>Create and open</button></form></section>}
    {active && draft && !manager && <>
      <section className="contest-snapshot" aria-label="Contest identity snapshot"><div><span>Station</span><strong>{active.station.callsign}</strong></div><div><span>Operator</span><strong>{active.operator.callsign}</strong></div><div><span>CQ zone</span><strong>{active.station.cqZone}</strong></div><div><span>Entity</span><strong>{active.station.dxccEntity}</strong></div><div><span>Rules</span><small className={`contest-source is-${active.rule.sourceVerification}`}>{active.rule.sourceVerification} · {active.rule.identity.version} · {active.referenceDataVersion}</small></div></section>
      {sacPreview && <p className="contest-alert" role="status">SAC scoring practice preview. Category and contest-date eligibility are not fully enforced.</p>}
      {active.rule.identity.id.startsWith("naqp-") && <p className="contest-alert" role="status">NAQP rules preview · plain logging only. No radio, audio, or RTTY hardware output is used.</p>}
      <div className="contest-operating-grid"><form ref={entryRoot} className="contest-entry" aria-label={`${active.rule.mode} contest entry`} onSubmit={logQSO}><header><h2>Plain Log · optional simulated operator flow</h2><span>{owner.dirty ? "Saving…" : "Saved"}</span></header>
        {active.rule.entryDescriptorVersion === 1 && <ContestOperatorPanel key={`${active.sessionID}/${active.workspaceGeneration}`} session={active} draft={draft} entryRoot={entryRoot}
          editGeneration={operatorEditGeneration} disabled={entryDisabled || owner.dirty || !!uncertain} recovery={operatorRecovery}
          reserveSerial={reserveSerial} commitQSO={commitQSO} simulateOutput={simulateContestOutput}
          admitIntent={(identity, context) => !owner.dirty && !owner.pendingOperation && owner.session?.sessionID === context.sessionID &&
            owner.session.workspaceGeneration === context.workspaceGeneration && owner.draft?.draftID + "@" + owner.draft?.revision === identity}
          guardFormSubmit={guarded => { operatorSubmitGuard.current = guarded; }}
          focusField={field => (field === "callsign" ? callsignInput.current : exchangeInput.current)?.focus()}/>}
        <div className="contest-entry-fields"><label className="contest-call">Callsign<input ref={callsignInput} data-contest-operator-field="callsign" aria-label="Contest callsign" autoComplete="off" maxLength={32} disabled={entryDisabled} value={draft.fields.callsign} onChange={e => changeField("callsign", e.target.value.toUpperCase())}/></label>{isStructuredEntry(active.rule.entry) ? active.rule.entry.exchange.receivedFields.map((field, index) => <label key={field.id}>Received {field.label}<input ref={index === 0 ? exchangeInput : undefined} maxLength={field.maximumUTF8Bytes} disabled={entryDisabled} required={field.required} value={draft.fields.receivedExchangeFields?.[field.id] ?? ""} onChange={e => changeStructuredReceived(field.id, e.target.value)}/></label>) : <><label>Sent report<input maxLength={active.rule.entry.report.maximumUTF8Bytes} disabled={entryDisabled} value={draft.fields.sentReport} onChange={e => changeField("sentReport", e.target.value)}/></label><label>Sent exchange<input maxLength={32} disabled={entryDisabled} value={draft.fields.sentExchange} onChange={e => changeField("sentExchange", e.target.value)}/></label><label>Received report<input maxLength={active.rule.entry.report.maximumUTF8Bytes} disabled={entryDisabled} value={draft.fields.receivedReport} onChange={e => changeField("receivedReport", e.target.value)}/></label><label>Received exchange<input ref={exchangeInput} data-contest-operator-field="exchange" maxLength={32} disabled={entryDisabled} value={draft.fields.receivedExchange} onChange={e => changeField("receivedExchange", e.target.value)}/></label></>}</div>
        <div className="contest-entry-context"><div><span>Frequency Hz</span><input aria-label="Frequency Hz" inputMode="numeric" maxLength={11} disabled={entryDisabled} value={frequencyText} onChange={e => changeFrequency(e.target.value)}/></div><div><span>Band</span><select aria-label="Band" disabled={entryDisabled} value={draft.fields.band} onChange={e => changeField("band", e.target.value)}>{["160m","80m","40m","20m","15m","10m"].map(x => <option key={x}>{x}</option>)}</select></div><div><span>Mode</span><strong>{active.rule.mode}</strong></div></div>
        {operatingFrequencyError && <p className="contest-validation is-duplicate">{operatingFrequencyError}</p>}<div className={`contest-validation is-${draft.dupe.state}`}><strong>{draft.dupe.state === "duplicate" ? "Duplicate" : "Dupe check"}</strong><span>{draft.dupe.reason}</span>{[...draft.validation.errors,...draft.validation.warnings].map(item => <span key={item}>{item}</span>)}</div>
        <footer>{active.rule.entry.serial.requirement === "requiredForCommit" && <button type="button" disabled={disabled} onClick={() => void reserveSerial().catch(() => {})}>{draft.reservedSerial ? `Serial ${draft.reservedSerial}` : "Reserve serial"}</button>}<button className="contest-primary" type="submit" disabled={entryDisabled || !!operatingFrequencyError || draft.validation.errors.length > 0 || draft.dupe.state === "duplicate"}>Log QSO</button></footer>
      </form><aside className="contest-score" aria-label="Score and multipliers"><h2><Trophy size={15}/> Score & multipliers</h2><dl><div><dt>Claimed score</dt><dd>{score?.claimedScore.toLocaleString() ?? "—"}</dd></div><div><dt>QSOs</dt><dd>{score?.qsos ?? "—"}</dd></div><div><dt>Points</dt><dd>{score?.points ?? "—"}</dd></div><div><dt>Multipliers</dt><dd>{score?.multipliers ?? "—"}</dd></div></dl><div className="contest-multipliers">{score?.multiplierLabels.length ? (score.multiplierDisplayLabels?.length ? score.multiplierDisplayLabels : score.multiplierLabels).map(x => <span key={x}>{x}</span>) : <p>No multipliers recorded.</p>}</div><p className={`contest-source is-${score?.sourceVerification ?? "unverified"}`}>Score source: {score?.sourceVerification ?? "unavailable"}</p></aside></div>
      <ContestAssistancePanel request={request} ownerLeaseID={leaseRef.current?.id??0} sessionID={active.sessionID} workspaceGeneration={active.workspaceGeneration}
        draftID={draft.draftID} callsign={draft.fields.callsign} disabled={entryDisabled} onSelect={applyAssistanceCallsign} importDataset={scpImport}/>
      {editing && <form className="contest-qso-editor" aria-label={`Edit ${editing.original.callsign}`} onSubmit={event => { event.preventDefault(); void applyQSOChange("correction"); }}><header><div><h2><Pencil size={15}/> Edit {editing.original.callsign}</h2><p>Update the contact; score and duplicate credit are recalculated when saved.</p></div><button type="button" aria-label="Cancel contact edit" disabled={disabled} onClick={() => { setEditing(null); setConfirmDelete(false); setEditorFrequencyError(""); }}><X size={14}/>Cancel</button></header>
        <div className="contest-qso-fields"><label>Callsign<input autoComplete="off" maxLength={32} disabled={disabled} value={editing.qso.callsign} onChange={event => changeQSO("callsign", event.target.value.toUpperCase())}/></label>{isStructuredEntry(active.rule.entry) ? active.rule.entry.exchange.receivedFields.map(field => <label key={field.id}>Received {field.label}<input maxLength={field.maximumUTF8Bytes} required={field.required} disabled={disabled} value={editing.qso.receivedExchangeFields?.[field.id] ?? ""} onChange={event => changeQSOReceivedField(field.id, event.target.value)}/></label>) : <><label>Sent report<input maxLength={active.rule.entry.report.maximumUTF8Bytes} disabled={disabled} value={editing.qso.sentReport} onChange={event => changeQSO("sentReport", event.target.value)}/></label><label>Received report<input maxLength={active.rule.entry.report.maximumUTF8Bytes} disabled={disabled} value={editing.qso.receivedReport} onChange={event => changeQSO("receivedReport", event.target.value)}/></label><label>Received exchange<input maxLength={64} disabled={disabled} value={editing.qso.receivedExchange} onChange={event => { changeQSO("receivedExchange", event.target.value); changeQSO("normalizedReceivedExchange", event.target.value); }}/></label></>}<label>Frequency Hz<input inputMode="numeric" maxLength={11} disabled={disabled} value={editFrequencyText} onChange={event => changeQSOFrequency(event.target.value)}/></label><label>Band<select disabled={disabled} value={editing.qso.band} onChange={event => changeQSO("band", event.target.value)}>{["160m","80m","40m","20m","15m","10m"].map(value => <option key={value}>{value}</option>)}</select></label></div>
        <div className="contest-qso-readonly" aria-label="Original contact details"><div><span>Original UTC</span><strong>{new Date(editing.original.originalUTC).toISOString().replace("T", " ").slice(0, 19)} Z</strong></div><div><span>Operator</span><strong>{editing.original.operatorCallsign || "Not recorded"}</strong></div><div><span>Station location</span><strong>{editing.original.stationLocation || "Not recorded"}</strong></div><div><span>Sent allocation</span><strong>{editing.original.sentExchange || "Not allocated"}</strong></div><div><span>{editing.qso.callsign === editing.original.callsign ? "Entity" : "Original entity"}</span><strong>{editing.original.entity?.name ?? "Unavailable"}</strong>{editing.qso.callsign !== editing.original.callsign && <small>New callsign country is checked against the pinned reference when saved.</small>}</div><div><span>Source</span><strong>{editing.original.provenance.source === "operatorEntry" ? "Operator entry" : "Imported contact"}</strong></div></div>
        {editorFrequencyError && <p className="contest-validation is-duplicate">{editorFrequencyError}</p>}<label className="contest-qso-note">Correction note<input maxLength={1024} disabled={disabled} value={correctionReason} onChange={event => setCorrectionReason(event.target.value)}/></label>
        {confirmDelete && <div className="contest-delete-confirm" role="alert"><div><strong>Delete {editing.original.callsign}?</strong><p>This removes the contact and recalculates score, multiplier, and duplicate credit.</p></div><label>Deletion note<input maxLength={1024} disabled={disabled} value={deletionReason} onChange={event => setDeletionReason(event.target.value)}/></label><button type="button" className="contest-danger" disabled={disabled || !deletionReason.trim()} onClick={() => void applyQSOChange("deletion")}><Trash2 size={14}/>Confirm deletion</button></div>}
        <footer><button type="button" className="contest-danger-secondary" disabled={disabled} onClick={() => setConfirmDelete(value => !value)}><Trash2 size={14}/>{confirmDelete ? "Keep contact" : "Delete contact"}</button><button className="contest-primary" type="submit" disabled={disabled || !!editorFrequencyError || !correctionReason.trim()}>Save correction</button></footer></form>}
      <section className="contest-log" aria-label="Contest log"><header><h2><ClipboardList size={15}/> Contest log</h2><p>This session only · {page?.total ?? 0} contacts</p></header><div className="contest-log-scroll"><table><thead><tr><th>UTC</th><th>Call</th><th>Band</th><th>Sent</th><th>Received</th><th>Pts</th><th>Mult</th><th><span className="contest-visually-hidden">Actions</span></th></tr></thead><tbody>{page?.qsos.length ? page.qsos.map(qso => <tr key={qso.qsoID}><td data-label="UTC">{new Date(qso.workedAt).toISOString().slice(0,16).replace("T"," ")}</td><td data-label="Call"><strong>{qso.callsign}</strong></td><td data-label="Band">{qso.band}</td><td data-label="Sent">{qso.sentExchange}</td><td data-label="Received">{qso.receivedExchange}</td><td data-label="Points">{qso.points}</td><td data-label="Multiplier">{qso.multiplierDisplayLabels !== undefined ? (qso.multiplierDisplayLabels.length ? qso.multiplierDisplayLabels.join(", ") : "—") : qso.multiplier ?? "—"}</td><td data-label="Actions"><button type="button" disabled={disabled} aria-label={`Edit ${qso.callsign}`} onClick={() => void editQSO(qso.qsoID)}><Pencil size={13}/>Edit</button></td></tr>) : <tr><td colSpan={8}>No QSOs in this contest.</td></tr>}</tbody></table></div><footer><span>{page ? `${page.offset + (page.qsos.length ? 1 : 0)}–${page.offset + page.qsos.length} of ${page.total}` : "Loading…"}</span><div><button disabled={busy || offset===0} onClick={() => void movePage(Math.max(0,offset-PAGE_SIZE))}>Previous</button><button disabled={busy || !page || offset+page.limit>=page.total} onClick={() => void movePage(offset+PAGE_SIZE)}>Next</button></div></footer></section>
    </>}
    {exportOpen && active && <ContestExportPanel session={active} opener={exportButton} saveOwner={exportSaveOwner}
      prepare={prepareExport} release={prepared => client.releaseExport(prepared)} onClose={closeExport}
      onSaved={filename => { setNotice(`Saved ${filename}.`); closeExport(); }}
    />}
  </main>;
}
export default ContestWorkspace;

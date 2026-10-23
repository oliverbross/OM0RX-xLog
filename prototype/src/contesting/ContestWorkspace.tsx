import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, Database, Download, Pencil, Trash2, Trophy, X } from "lucide-react";
import { ContestMutationUncertain, ContestServerError, normalizedARRLDXPower } from "./client";
import { ContestExportPanel } from "./ContestExportPanel";
import { ContestOperatorPanel, type ContestOperatorRecovery, type ContestOperatorSurfaceController,
  type ContestOperatorSurfaceState, type ContestSimulationAdapter } from "./ContestOperatorPanel";
import { ContestAssistancePanel, type ContestSCPPanelSurface, type SCPSelectionScope } from "./ContestAssistancePanel";
import type { SCPImport } from "./contestAssistance";
import { ContestCallHistoryPanel, type ContestHistoryPanelSurface, type HistoryApplyScope } from "./ContestCallHistoryPanel";
import { ContestOperatorCanvas } from "./ContestOperatorCanvas";
import { historyProjectedFields, type HistoryImport, type HistorySelection } from "./contestCallHistory";
import { isStructuredEntry } from "./types";
import { contestSurfacePanelIDs, type ContestSurfaceActionEnvelope, type ContestSurfacePanelID,
  type ContestSurfaceProjection } from "./contestSurfaceProtocol";
import { defaultContestKeyBindings } from "./contestKeyBindings";
import { useContestSurfaceOwner } from "./useContestSurfaceOwner";
import { nativeContestExportSave, sharedContestExportSaveOwner, type ContestExportSaveAdapter } from "./contestExportSave";
import { sharedContestSessionOwner, type ContestOwnerLease, type ContestRecoveryStorage } from "./sessionOwner";
import type { ContestCabrilloHeader, ContestCommitResult, ContestCreateInput, ContestDraftFields, ContestEntryDescriptor, ContestExportFormat, ContestFullQSO, ContestLogPage, ContestPreparedExport, ContestQSOChangeResult, ContestRequest, ContestResolvedSerial, ContestRuleMetadata, ContestScore, ContestSessionSummary } from "./types";
import { ContestTextField, ContestEntryFields, ContestScoreSummary, ContestLogTable } from "./ContestPresentation";
import "./ContestWorkspace.css";

const PAGE_SIZE = 20;
export type ContestTransitionController = { freeze: () => void; prepare: () => Promise<void>; resume: () => void };
type Props = { request: ContestRequest; operatingContext?: string; createRequestID?: () => string; digestPayload?: (payload: unknown) => Promise<string>; recoveryStorage?: ContestRecoveryStorage; exportSave?: ContestExportSaveAdapter; simulateContestOutput?: ContestSimulationAdapter; scpImport?: SCPImport; historyImport?: HistoryImport; registerTransition?: (controller: ContestTransitionController | null) => void };
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }
function defaultStorage(): ContestRecoveryStorage | undefined { try { return globalThis.localStorage; } catch { return undefined; } }
function isQSOChange(result: unknown): result is ContestQSOChangeResult { return !!result && typeof result === "object" && "operation" in result; }
function allocatedSerialFieldID(entry: ContestEntryDescriptor) {
  if (!isStructuredEntry(entry)) return undefined;
  if (entry.serial.requirement !== "requiredForCommit") return entry.stationResolvedSerial?.allocatedSerialFieldID;
  return entry.stationResolvedSerial?.allocatedSerialFieldID ?? entry.exchange.sentFields.find(field => field.acceptedKinds.includes("serialNumber"))?.id;
}
function creationAllocatedSerialFieldID(entry: ContestEntryDescriptor) {
  return isStructuredEntry(entry) && entry.serial.requirement === "requiredForCommit"
    ? allocatedSerialFieldID(entry) : undefined;
}
function reportForMode(entry: ContestEntryDescriptor, mode: ContestDraftFields["mode"]) {
  return isStructuredEntry(entry) ? entry.modeProfiles.find(profile => profile.mode === mode)?.report ?? entry.report : entry.report;
}
function SentExchangeSummary({ entry, values, resolvedSerial, label }: { entry: ContestEntryDescriptor; values?: Record<string,string>; resolvedSerial?: ContestResolvedSerial; label: string }) {
  if (!isStructuredEntry(entry)) return null;
  const allocatedFieldID = allocatedSerialFieldID(entry);
  const fields = allocatedFieldID ? entry.exchange.sentFields.filter(field => resolvedSerial?.requirement === "requiredForCommit" ? field.id === allocatedFieldID : field.id !== allocatedFieldID) : entry.exchange.sentFields;
  return <div className="contest-sent-exchange" aria-label={label}>{fields.map(field => {
    const value = values?.[field.id]?.trim();
    const awaitingReservation = field.id === allocatedFieldID && resolvedSerial?.requirement === "requiredForCommit";
    return <div key={field.id}><span>Sent {field.label}</span><strong>{value || (awaitingReservation ? "Awaiting reservation" : "—")}</strong></div>;
  })}</div>;
}
export function projectSCPCallsign(session: ContestSessionSummary, draft: {draftID:string;fields:ContestDraftFields},
  selection: SCPSelectionScope, callsign: string): ContestDraftFields|null {
  if(session.sessionID!==selection.sessionID||session.workspaceGeneration!==selection.workspaceGeneration||draft.draftID!==selection.draftID||
    draft.fields.callsign.trim().toUpperCase()!==selection.inputCallsign)return null;
  return {...draft.fields,callsign};
}

export function ContestWorkspace({ request, operatingContext, createRequestID, digestPayload, recoveryStorage, exportSave = nativeContestExportSave, simulateContestOutput, scpImport, historyImport, registerTransition }: Props) {
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
  const [operatorSurfaceSnapshot, setOperatorSurfaceSnapshot] = useState<{ context: string; value: ContestOperatorSurfaceState } | null>(null);
  const [scpSurface, setSCPSurface] = useState<ContestSCPPanelSurface | null>(null);
  const [historySurface, setHistorySurface] = useState<ContestHistoryPanelSurface | null>(null);
  const operatorRecoverySequence = useRef(0), entryRoot = useRef<HTMLFormElement>(null);
  const operatorSubmitGuard = useRef(false);
  const operatorSurfaceController = useRef<{ context: string; value: ContestOperatorSurfaceController } | null>(null);
  const callsignInput = useRef<HTMLInputElement>(null), exchangeInput = useRef<HTMLInputElement>(null);
  const [create, setCreate] = useState({ name: "", ruleID: "cq-ww-cw", station: "", operator: "", cqZone: "", entity: "", stationExchangeFields: {} as Record<string,string>, stationFields: {} as Record<string,string>, category: "Single Operator" });
  const actionLock = useRef(false);
  const retiringRef = useRef(false);
  const [retiring, setRetiring] = useState(false);
  const contextTicket = useRef(0);
  const exportTicket = useRef(0), exportButton = useRef<HTMLButtonElement>(null);
  const leaseRef = useRef<ContestOwnerLease | null>(null);
  const saveTimer = useRef<number | null>(null);
  const active = owner.session, draft = owner.draft, uncertain = owner.pendingOperation;
  const operatorPanelContext = active ? `${active.sessionID}/${active.workspaceGeneration}` : "";
  const operatorSurface = operatorSurfaceSnapshot?.context === operatorPanelContext ? operatorSurfaceSnapshot.value : null;
  const acceptOperatorSurface = useCallback((value: ContestOperatorSurfaceState | null) => {
    setOperatorSurfaceSnapshot(current => value ? { context: operatorPanelContext, value } :
      current?.context === operatorPanelContext ? null : current);
  }, [operatorPanelContext]);
  const acceptOperatorSurfaceController = useCallback((value: ContestOperatorSurfaceController | null) => {
    if (value) operatorSurfaceController.current = { context: operatorPanelContext, value };
    else if (operatorSurfaceController.current?.context === operatorPanelContext) operatorSurfaceController.current = null;
  }, [operatorPanelContext]);
  const draftSaveInFlight = owner.pendingPhase === "inflight" && uncertain?.method === "contest_draft_apply";
  const blockingOperation = !!uncertain && !draftSaveInFlight;

  useEffect(() => {
    if (!registerTransition) return;
    const controller: ContestTransitionController = {
      freeze: () => { retiringRef.current = true; setRetiring(true); },
      resume: () => { retiringRef.current = false; setRetiring(false); },
      prepare: async () => {
      retiringRef.current = true; setRetiring(true);
      if (busy || actionLock.current || editing || exportOpen || operatorRecovery || blockingOperation)
        throw new Error("Finish the current contest edit, export or recovery before changing operating module.");
      if (saveTimer.current !== null) { window.clearTimeout(saveTimer.current); saveTimer.current = null; }
      await owner.flush();
      if (owner.dirty || owner.pendingOperation)
        throw new Error("Resolve the retained contest draft or operation receipt before changing operating module.");
    } };
    registerTransition(controller);
    return () => registerTransition(null);
  }, [registerTransition, owner, busy, editing, exportOpen, operatorRecovery, blockingOperation]);

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
  function beginAction() { if (retiringRef.current || actionLock.current) return false; actionLock.current = true; setBusy(true); setError(""); setNotice(""); return true; }
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
    if (!draft || retiringRef.current || busy || blockingOperation) return;
    setOperatorEditGeneration(value => value + 1);
    owner.edit({ ...draft.fields, [key]: value });
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    const ticket = contextTicket.current, scope = capturedScope();
    saveTimer.current = window.setTimeout(() => void owner.flush().catch(cause => handleFailure(cause, ticket, scope)), 180);
  }
  function changeStructuredReceived(id: string, value: string) {
    if (!draft || !active || !isStructuredEntry(active.rule.entry) || retiringRef.current || busy || blockingOperation) return;
    const arrlDX = active.rule.identity.id.startsWith("arrl-dx-");
    const projected = arrlDX ? value.toUpperCase() : value;
    const receivedExchangeFields = arrlDX
      ? Object.fromEntries(active.rule.entry.exchange.receivedFields.map(field => [field.id, field.id === id ? projected : ""]))
      : { ...draft.fields.receivedExchangeFields, [id]: projected };
    const receivedExchange = active.rule.entry.exchange.receivedFields.map(field => receivedExchangeFields[field.id] ?? "").filter(Boolean).join(" ");
    setOperatorEditGeneration(current => current + 1);
    owner.edit({ ...draft.fields, receivedExchangeFields, receivedExchange });
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    const ticket = contextTicket.current, scope = capturedScope();
    saveTimer.current = window.setTimeout(() => void owner.flush().catch(cause => handleFailure(cause, ticket, scope)), 180);
  }
  function applyAssistanceCallsign(value: string, selection: SCPSelectionScope) {
    const lease=leaseRef.current, admission=owner.captureAdmission(lease), currentSession=owner.session, currentDraft=owner.draft;
    if(retiringRef.current||busy||blockingOperation||!lease||lease.id!==selection.ownerLeaseID||admission===null||!owner.accepts(lease,admission)||!currentSession||!currentDraft)return;
    const fields=projectSCPCallsign(currentSession,currentDraft,selection,value);if(!fields)return;
    setOperatorEditGeneration(generation=>generation+1);
    owner.edit(fields);
    const ticket=contextTicket.current, scope={lease,admission};
    if(saveTimer.current!==null)window.clearTimeout(saveTimer.current);
    saveTimer.current=window.setTimeout(()=>void owner.flush().catch(cause=>handleFailure(cause,ticket,scope)),180);
  }
  async function applyHistory(selection: HistorySelection, projectionIDs: string[], selected: HistoryApplyScope) {
    const currentSession=owner.session,currentDraft=owner.draft,lease=leaseRef.current;
    if(retiringRef.current||busy||blockingOperation||owner.dirty||!lease||lease.id!==selected.ownerLeaseID||!currentSession||!currentDraft||
      currentSession.sessionID!==selected.sessionID||currentSession.workspaceGeneration!==selected.workspaceGeneration||currentSession.revision!==selected.sessionRevision||
      currentDraft.draftID!==selected.draftID||currentDraft.revision!==selected.draftRevision||currentDraft.fields.callsign.trim().toUpperCase()!==selected.callsign||
      selection.dataset.generation!==selected.datasetGeneration||!beginAction())throw new Error("The call-history selection is stale.");
    const ticket=contextTicket.current,scope=admissionScope();
    try{
      if(!accepts(scope)||owner.pendingOperation||owner.dirty)throw new Error("The contest draft changed before call history was applied.");
      const fields=historyProjectedFields(selection,projectionIDs,currentDraft);
      const result=await client.applyHistoryProjection(currentSession,currentDraft.draftID,selection,projectionIDs,fields);
      if(ticket!==contextTicket.current||!accepts(scope)||!owner.apply(result,scope.lease!,scope.admission!))throw new Error("The call-history response no longer matches the active draft.");
      setOperatorEditGeneration(value=>value+1);
    }catch(cause){handleFailure(cause,ticket,scope);throw cause;}finally{endAction(ticket,scope);}
  }
  function changeFrequency(raw: string) {
    if (retiringRef.current || busy || blockingOperation) return;
    setFrequencyText(raw);
    if (!/^[0-9]{0,11}$/.test(raw)) { setOperatingFrequencyError("Frequency must contain digits only."); return; }
    const parsed = raw === "" ? null : Number(raw);
    if (parsed !== null && (!Number.isSafeInteger(parsed) || parsed > 100_000_000_000)) { setOperatingFrequencyError("Frequency is outside the supported range."); return; }
    setOperatingFrequencyError(""); changeField("frequencyHz", parsed);
  }
  function changeMode(mode: ContestDraftFields["mode"]) {
    if (!draft || !active || !isStructuredEntry(active.rule.entry)) return;
    const profile = active.rule.entry.modeProfiles.find(item => item.mode === mode); if (!profile) return;
    changeField("mode", mode);
    owner.edit({ ...draft.fields, mode, sentReport: profile.report.defaultSent, receivedReport: profile.report.defaultReceived });
  }

  async function createSession(event: FormEvent) {
    event.preventDefault(); if (uncertain || !workspaceGeneration || !beginAction()) return;
    const ticket = ++contextTicket.current, scope = admissionScope();
    try {
      await owner.flush();
      if (!accepts(scope) || owner.pendingOperation) return;
      const rule = rules.find(item => item.identity.id === create.ruleID); if (!rule) throw new Error("Select an available contest.");
      const station = { callsign: create.station.trim().toUpperCase(), cqZone: create.cqZone.trim(), dxccEntity: create.entity.trim(),
        ...(isStructuredEntry(rule.entry) ? { exchangeFields: Object.fromEntries(rule.entry.exchange.sentFields.filter(field => field.id !== creationAllocatedSerialFieldID(rule.entry)).map(field => {
          const value = (create.stationExchangeFields[field.id] ?? "").trim();
          return [field.id, field.acceptedKinds.includes("operatorName") ? value : value.toUpperCase()];
        })) } : {}),
        ...(isStructuredEntry(rule.entry) && rule.entry.stationFields?.length ? { stationFields: Object.fromEntries(rule.entry.stationFields.map(field =>
          [field.id, (create.stationFields[field.id] ?? "").trim().toUpperCase()])) } : {}) };
      const input: ContestCreateInput = { name: create.name.trim(), ruleIdentity: rule.identity, referenceDataVersion: rule.referenceDataVersion,
        ...(rule.declarativeDefinition ? { definitionDigest: rule.declarativeDefinition.definitionDigest } : {}),
        station,
        operator: { callsign: create.operator.trim().toUpperCase(), category: create.category.trim() } };
      const result = await client.create(workspaceGeneration, input, rule);
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
    let confirmed: ContestCommitResult | null = null;
    try {
      await owner.flush(); if (!accepts(scope) || owner.pendingOperation) throw new Error("Contest commit admission expired."); const current = owner.session!, result = await client.commitQSO(current, owner.draft!.draftID);
      if (ticket !== contextTicket.current || !accepts(scope) || owner.session?.sessionID !== sessionID || owner.session.workspaceGeneration !== generation)
        throw new Error("Contest commit response no longer matches the active session.");
      if (!owner.apply(result, scope.lease!, scope.admission!)) throw new Error("Contest commit response was not admitted.");
      confirmed = result;
      setSessions(items => items.map(item => item.sessionID === result.session.sessionID ? result.session : item));
      setScore(null); setNotice(`Logged ${result.qso.callsign}.`); await projections(result.session, 0, ticket, scope);
      return result;
    } catch (cause) { handleFailure(cause, ticket, scope); if (confirmed) return confirmed; throw cause; } finally { endAction(ticket, scope); }
  }
  async function logQSO(event: FormEvent) {
    event.preventDefault();
    if (operatorSubmitGuard.current) return;
    try { await commitQSO(); } catch { /* surfaced by the contest owner */ }
  }
  async function editQSO(qsoID: string, propagateFailure = false) {
    if (!active || uncertain || !beginAction()) { if (propagateFailure) throw new Error("The contact editor is unavailable."); return; }
    const ticket = contextTicket.current, sessionID = active.sessionID, generation = active.workspaceGeneration, scope = admissionScope();
    try {
      await owner.flush();
      if (!accepts(scope) || owner.pendingOperation || owner.session?.sessionID !== sessionID || owner.session.workspaceGeneration !== generation) {
        if (propagateFailure) throw new Error("The contact editor request expired."); return;
      }
      const result = await client.qso(owner.session, qsoID);
      if (ticket !== contextTicket.current || !accepts(scope) || owner.session?.sessionID !== sessionID || owner.session.workspaceGeneration !== generation) {
        if (propagateFailure) throw new Error("The contact editor response is stale."); return;
      }
      setEditing({ original: result.qso, qso: result.qso }); setEditFrequencyText(String(result.qso.frequencyHz));
      setCorrectionReason("Operator correction"); setDeletionReason("Operator deletion"); setConfirmDelete(false); setEditorFrequencyError("");
    } catch (cause) { handleFailure(cause, ticket, scope); if (propagateFailure) throw cause; } finally { endAction(ticket, scope); }
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
      const arrlDX = active.rule.identity.id.startsWith("arrl-dx-");
      const projected = arrlDX ? value.toUpperCase() : value;
      const receivedExchangeFields = arrlDX
        ? Object.fromEntries(entry.exchange.receivedFields.map(field => [field.id, field.id === id ? projected : ""]))
        : { ...current.qso.receivedExchangeFields, [id]: projected };
      const receivedExchange = entry.exchange.receivedFields.map(field => receivedExchangeFields[field.id] ?? "").filter(Boolean).join(" ");
      const normalizedReceivedExchange = entry.exchange.receivedFields.map(field => {
        const raw = receivedExchangeFields[field.id] ?? "";
        return field.acceptedKinds.includes("power")
          ? normalizedARRLDXPower(raw) ?? raw.toUpperCase()
          : field.acceptedKinds.some(kind => kind === "cqZone" || kind === "jarlPrefectureNumber") && /^[0-9]{1,2}$/.test(raw)
          ? String(Number(raw)).padStart(2, "0")
          : raw.toUpperCase();
      }).filter(Boolean).join(" ");
      return { ...current, qso: { ...current.qso, receivedExchangeFields, receivedExchange, normalizedReceivedExchange } };
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
  async function applyQSOChange(kind: "correction" | "deletion", propagateFailure = false) {
    if (!active || !editing || uncertain || kind === "correction" && editorFrequencyError || !beginAction()) {
      if (propagateFailure) throw new Error("The contact edit is not ready to save."); return;
    }
    const ticket = contextTicket.current, sessionID = active.sessionID, generation = active.workspaceGeneration, target = editing.qso, scope = admissionScope();
    let confirmed = false;
    try {
      await owner.flush();
      if (!accepts(scope) || owner.pendingOperation || owner.session?.sessionID !== sessionID || owner.session.workspaceGeneration !== generation) {
        if (propagateFailure) throw new Error("The contact edit request expired."); return;
      }
      const result = kind === "correction"
        ? await client.correctQSO(owner.session, target, correctionReason)
        : await client.deleteQSO(owner.session, target.qsoID, deletionReason);
      if (ticket !== contextTicket.current || !accepts(scope) || owner.session?.sessionID !== sessionID || owner.session.workspaceGeneration !== generation) {
        if (propagateFailure) throw new Error("The contact edit response is stale."); return;
      }
      if (!owner.applyChange(result, scope.lease!, scope.admission!)) {
        if (propagateFailure) throw new Error("The contact edit response was not admitted."); return;
      }
      confirmed = true;
      const adopted = owner.session!;
      setEditing(null); setConfirmDelete(false); setScore(null);
      const country = result.currentTarget?.entity?.name;
      setNotice(kind === "correction" ? `Saved ${result.currentTarget!.callsign}${country ? ` · ${country}` : ""}.` : `Deleted ${target.callsign}. Score recalculated.`);
      await refreshAfterChange(adopted, ticket, scope);
    } catch (cause) { handleFailure(cause, ticket, scope); if (propagateFailure && !confirmed) throw cause; } finally { endAction(ticket, scope); }
  }
  async function checkReceipt(retry = false) {
    if (!uncertain || !beginAction()) return; const ticket = contextTicket.current, operation = uncertain, scope = admissionScope();
    try {
      if (retry) {
        const result = await client.retry(operation, active?.rule);
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
  async function movePage(next: number, propagateFailure = false) {
    if (!active || !beginAction()) { if (propagateFailure) throw new Error("The contest log is busy."); return; }
    const ticket = contextTicket.current, scope = admissionScope();
    try { await projections(active, next, ticket, scope); }
    catch (cause) { handleFailure(cause, ticket, scope); if (propagateFailure) throw cause; } finally { endAction(ticket, scope); }
  }
  function closeExport() { exportTicket.current += 1; setExportOpen(false); }
  async function prepareExport(format: ContestExportFormat, header: ContestCabrilloHeader): Promise<ContestPreparedExport | null> {
    const token = ++exportTicket.current, sessionID = owner.session?.sessionID, generation = owner.session?.workspaceGeneration;
    if (!sessionID || !generation || owner.pendingOperation) throw new Error("Finish the current contest save before exporting.");
    await owner.flush();
    const current = owner.session;
    if (token !== exportTicket.current || !current || current.sessionID !== sessionID || current.workspaceGeneration !== generation || owner.pendingOperation) return null;
    const prepared = await client.prepareExport({ exportID: crypto.randomUUID(), sessionID, workspaceGeneration: generation,
      expectedRevision: current.revision, generatedAtUTC: new Date().toISOString(), format, header },
      current.rule.declarativeDefinition?.exportPurpose);
    if (token !== exportTicket.current || owner.session?.sessionID !== sessionID || owner.session.workspaceGeneration !== generation) {
      void client.releaseExport(prepared).catch(() => {}); return null;
    }
    return prepared;
  }

  const surfaceReport = useCallback((value: string) => setError(value), []);
  const surfaceUnavailable = { schemaVersion: 1, status: "unavailable" } as const;
  const receivedSurfaceFields = active && draft ? (isStructuredEntry(active.rule.entry)
    ? active.rule.entry.exchange.receivedFields.map(field => ({ id: field.id, label: field.label,
      value: draft.fields.receivedExchangeFields?.[field.id] ?? "", required: field.required,
      maximumUTF8Bytes: field.maximumUTF8Bytes }))
    : [{ id: "receivedExchange", label: "Exchange", value: draft.fields.receivedExchange,
      required: true, maximumUTF8Bytes: 64 }]) : [];
  const editingSurfaceFields = active && editing ? (isStructuredEntry(active.rule.entry)
    ? active.rule.entry.exchange.receivedFields.map(field => ({ id: field.id, label: field.label,
      value: editing.qso.receivedExchangeFields?.[field.id] ?? "", required: field.required,
      maximumUTF8Bytes: field.maximumUTF8Bytes }))
    : [{ id: "receivedExchange", label: "Exchange", value: editing.qso.receivedExchange,
      required: true, maximumUTF8Bytes: 64 }]) : [];
  const sentSurfaceFields = active && draft ? (isStructuredEntry(active.rule.entry)
    ? active.rule.entry.exchange.sentFields.map(field => ({ id: field.id, label: field.label,
      value: draft.fields.sentExchangeFields?.[field.id] ?? "", required: field.required,
      maximumUTF8Bytes: field.maximumUTF8Bytes }))
    : [{ id: "sentExchange", label: "Exchange", value: draft.fields.sentExchange,
      required: true, maximumUTF8Bytes: 64 }]) : [];
  const liveSurfaceProjections = Object.fromEntries(contestSurfacePanelIDs.map(panelID => [panelID, surfaceUnavailable])) as
    Record<ContestSurfacePanelID, ContestSurfaceProjection>;
  if (active && draft) {
    const serialRequirement = active.rule.entry.serial.requirement;
    const allocatedFieldID = serialRequirement === "none" ? null : isStructuredEntry(active.rule.entry)
      ? draft.resolvedSerial?.allocatedFieldID ?? active.resolvedSerial?.allocatedFieldID ?? allocatedSerialFieldID(active.rule.entry) ?? null
      : "sentExchange";
    const modes = active.rule.supportedModes ?? (isStructuredEntry(active.rule.entry)
      ? active.rule.entry.modeProfiles.map(profile => profile.mode) : [active.rule.entry.mode]);
    liveSurfaceProjections["active-qso"] = { schemaVersion: 2, status: "ready",
      session: { name: active.name, ruleName: active.rule.displayName, mode: draft.fields.mode },
      draft: { draftID: draft.draftID, revision: draft.revision, callsign: draft.fields.callsign,
        sentReport: draft.fields.sentReport, receivedReport: draft.fields.receivedReport, receivedFields: receivedSurfaceFields,
        frequencyHz: draft.fields.frequencyHz, frequencyText, frequencyError: operatingFrequencyError, band: draft.fields.band,
        mode: draft.fields.mode, dupe: draft.dupe, validation: draft.validation, reservedSerial: draft.reservedSerial },
      busy, dirty: owner.dirty, uncertain: !!uncertain,
      descriptor: { bands: active.rule.supportedBands ?? [draft.fields.band], modes, sentFields: sentSurfaceFields,
        keyBindings: defaultContestKeyBindings,
        serial: { requirement: serialRequirement, allocatedFieldID, reservedSerial: draft.reservedSerial } },
      operator: operatorSurface ? { output: "simulation-only", outputAvailable: true, outputUnavailableReason: null,
        armed: operatorSurface.armed, style: operatorSurface.style,
        status: operatorSurface.status, pending: operatorSurface.pending,
        focusedField: operatorSurface.focusedField === "exchange" ? "other_2" : operatorSurface.focusedField,
        tabNext: { callsign:"sent", sent:"receive", receive:"other_1", other_1:"other_2", other_2:"callsign" },
        tabPrevious: { callsign:"other_2", sent:"callsign", receive:"sent", other_1:"receive", other_2:"other_1" },
        functionKeys: Object.entries(operatorSurface.functionKeys).map(([key, macro]) =>
          ({ key: key as "F1", macro: macro!, highlighted: false })),
        readiness: { canSendCQ: operatorSurface.readiness?.canSendCQ ?? false,
          canSendCall: operatorSurface.readiness?.canSendCall ?? false,
          canSendDuplicate: operatorSurface.readiness?.canSendDuplicate ?? false,
          canReserveCall: operatorSurface.readiness?.canReserveCall ?? false,
          canReserveCommit: operatorSurface.readiness?.canReserveCommit ?? false,
          canCommit: operatorSurface.readiness?.canCommit ?? false },
        trace: operatorSurface.trace.map(item => ({ ...item })) } : null };
    liveSurfaceProjections["callsign-intelligence"] = { schemaVersion: 1, status: "ready", draftID: draft.draftID,
      draftRevision: draft.revision, inputCallsign: draft.fields.callsign,
      scp: { source: scpSurface?.source ?? null, candidates: scpSurface?.candidates ?? [],
        availability: scpSurface?.availability ?? "not_imported", notice: scpSurface?.notice ?? null, error: scpSurface?.error ?? null },
      history: { source: historySurface?.source ?? null, rows: historySurface?.rows ?? [] },
      busy: !!scpSurface?.busy || !!historySurface?.busy };
    liveSurfaceProjections.propagation = { schemaVersion: 1, status: "ready", score: score ? {
      qsos: score.qsos, points: score.points, multipliers: score.multipliers, claimedScore: score.claimedScore,
      multiplierLabels: score.multiplierLabels, multiplierDisplayLabels: score.multiplierDisplayLabels ?? score.multiplierLabels,
      sourceVerification: score.sourceVerification } : null, busy };
    liveSurfaceProjections.logbook = { schemaVersion: 1, status: "ready", sessionRevision: active.revision,
      canExportCabrillo: false,
      page: { offset: page?.offset ?? offset, limit: page?.limit ?? PAGE_SIZE, total: page?.total ?? 0,
        rows: page?.qsos.map(qso => ({ qsoID: qso.qsoID, workedAt: qso.workedAt, callsign: qso.callsign, band: qso.band,
          mode: qso.mode, sentExchange: qso.sentExchange, receivedExchange: qso.receivedExchange, points: qso.points,
          multiplierLabels: qso.multiplierDisplayLabels ?? (qso.multiplier ? [qso.multiplier] : []) })) ?? [] },
      editing: editing ? { qsoID: editing.qso.qsoID, workedAt: editing.qso.originalUTC, operator: editing.qso.operatorCallsign,
        callsign: editing.qso.callsign, band: editing.qso.band,
        mode: editing.qso.mode, sentReport: editing.qso.sentReport, receivedReport: editing.qso.receivedReport,
        receivedFields: editingSurfaceFields, frequencyHz: editing.qso.frequencyHz, editFrequencyText,
        frequencyError: editorFrequencyError, correctionReason, confirmDelete, deletionReason } : null, busy };
    liveSurfaceProjections.messages = { schemaVersion: 1, status: "ready", messages: [
      ...(error ? [{ kind:"error" as const, text:error }] : []),
      ...(notice ? [{ kind:"notice" as const, text:notice }] : []),
      ...(operatingFrequencyError ? [{ kind:"error" as const, text:operatingFrequencyError }] : []),
      ...(draft.dupe.state === "duplicate" ? [{ kind:"notice" as const, text:`Duplicate: ${draft.dupe.reason}` }] : []),
      ...draft.validation.errors.map(text => ({ kind:"error" as const, text })),
      ...draft.validation.warnings.map(text => ({ kind:"notice" as const, text })),
    ], busy };
  }
  const surfaceContext = active && operatingContext ? { operatingContext, sessionID: active.sessionID,
    workspaceGeneration: active.workspaceGeneration } : null;
  async function handleSurfaceAction(action: ContestSurfaceActionEnvelope) {
    const currentSession = owner.session, currentDraft = owner.draft;
    if (!currentSession || !currentDraft || !surfaceContext || action.operatingContext !== surfaceContext.operatingContext ||
        action.sessionID !== currentSession.sessionID || action.workspaceGeneration !== currentSession.workspaceGeneration)
      throw new Error("The contest surface context is no longer active.");
    const stoppingOperator = action.action === "entry_operator_key" && action.params.key === "Escape";
    if (retiringRef.current || (busy || blockingOperation) && !stoppingOperator) throw new Error("The contest owner is busy.");
    if (!stoppingOperator && (action.action.startsWith("entry_") || action.action.startsWith("assistance_"))) {
      const params = action.params as { draftID: string; expectedDraftRevision: number };
      if (params.draftID !== currentDraft.draftID || params.expectedDraftRevision !== currentDraft.revision)
        throw new Error("The contest draft changed before this action reached the owner.");
    }
    switch (action.action) {
      case "entry_set_text": changeField(action.params.field, action.params.value); return;
      case "entry_set_exchange":
        if (isStructuredEntry(currentSession.rule.entry)) changeStructuredReceived(action.params.fieldID, action.params.value);
        else if (action.params.fieldID === "receivedExchange") changeField("receivedExchange", action.params.value);
        else throw new Error("The contest exchange field is no longer active."); return;
      case "entry_set_frequency_text": changeFrequency(action.params.value); return;
      case "entry_set_band": changeField("band", action.params.value); return;
      case "entry_set_mode": changeMode(action.params.value as ContestDraftFields["mode"]); return;
      case "entry_reserve_serial": await reserveSerial(); return;
      case "entry_commit": await commitQSO(); return;
      case "entry_operator_arm":
        if (operatorSurfaceController.current?.context !== operatorPanelContext) throw new Error("The operator simulation is unavailable.");
        operatorSurfaceController.current.value.setArmed(action.params.armed); return;
      case "entry_operator_style":
        if (operatorSurfaceController.current?.context !== operatorPanelContext) throw new Error("The operator simulation is unavailable.");
        operatorSurfaceController.current.value.setStyle(action.params.value); return;
      case "entry_focus": return;
      case "entry_operator_key": {
        if (operatorSurfaceController.current?.context !== operatorPanelContext) throw new Error("The operator simulation is unavailable.");
        operatorSurfaceController.current.value.pressKey(action.params.key, action.params.focusedField === "callsign" ? "callsign" :
          action.params.focusedField ? "exchange" : null); return;
      }
      case "assistance_query": changeField("callsign", action.params.inputCallsign.toUpperCase()); return;
      case "assistance_download":
        if (!scpSurface) throw new Error("Super Check Partial is unavailable.");
        await scpSurface.downloadLatest(); return;
      case "assistance_refresh":
        if (!scpSurface) throw new Error("Super Check Partial is unavailable.");
        await scpSurface.refresh(); return;
      case "assistance_select": {
        const surface = action.params.kind === "scp" ? scpSurface : action.params.kind === "history" ? historySurface : null;
        if (!surface) throw new Error("The callsign candidate set is unavailable.");
        await surface.selectCandidate(action.params.candidateID); return;
      }
      case "log_export_cabrillo": throw new Error("Cabrillo export is available from the Python contest host.");
      case "log_page": await movePage(action.params.offset, true); return;
      case "log_edit_begin": await editQSO(action.params.qsoID, true); return;
      case "log_edit_begin_delete": await editQSO(action.params.qsoID, true); setConfirmDelete(true); return;
      case "log_edit_cancel":
        if (editing?.qso.qsoID !== action.params.qsoID) throw new Error("The contact editor changed.");
        setEditing(null); setConfirmDelete(false); setEditorFrequencyError(""); return;
      case "log_edit_set_text":
        if (editing?.qso.qsoID !== action.params.qsoID) throw new Error("The contact editor changed.");
        if (action.params.field === "correctionReason") setCorrectionReason(action.params.value);
        else if (action.params.field === "deletionReason") setDeletionReason(action.params.value);
        else if (action.params.field === "timestamp") changeQSO("originalUTC", action.params.value);
        else if (action.params.field === "operator") changeQSO("operatorCallsign", action.params.value);
        else if (action.params.field === "receiveFrequency" || action.params.field === "power")
          throw new Error("Receive frequency and power corrections require the Python contest host.");
        else if (action.params.field === "name" || action.params.field === "qth" || action.params.field === "comment")
          throw new Error("Contact metadata corrections require the Python contest host.");
        else changeQSO(action.params.field, action.params.value); return;
      case "log_edit_set_exchange":
        if (editing?.qso.qsoID !== action.params.qsoID) throw new Error("The contact editor changed.");
        if (isStructuredEntry(currentSession.rule.entry)) changeQSOReceivedField(action.params.fieldID, action.params.value);
        else if (action.params.fieldID === "receivedExchange") changeQSO("receivedExchange", action.params.value);
        else throw new Error("The contact exchange field changed."); return;
      case "log_edit_set_frequency_text":
        if (editing?.qso.qsoID !== action.params.qsoID) throw new Error("The contact editor changed.");
        changeQSOFrequency(action.params.value); return;
      case "log_edit_set_band":
        if (editing?.qso.qsoID !== action.params.qsoID) throw new Error("The contact editor changed.");
        changeQSO("band", action.params.value); return;
      case "log_edit_confirm_delete":
        if (editing?.qso.qsoID !== action.params.qsoID) throw new Error("The contact editor changed.");
        setConfirmDelete(action.params.confirmed); return;
      case "log_edit_save": case "log_edit_delete":
        if (editing?.qso.qsoID !== action.params.qsoID || action.params.expectedSessionRevision !== currentSession.revision)
          throw new Error("The contest log changed before this edit reached the owner.");
        await applyQSOChange(action.action === "log_edit_save" ? "correction" : "deletion", true); return;
    }
  }
  useContestSurfaceOwner({ context: surfaceContext, projections: liveSurfaceProjections, handle: handleSurfaceAction, report: surfaceReport });

  const disabled = retiring || busy || !!uncertain;
  const entryDisabled = retiring || busy || blockingOperation;
  const sacPreview = active?.rule.identity.id.startsWith("sac-") ?? false;
  const selectedCreateRule = rules.find(rule => rule.identity.id === create.ruleID);
  const selectedCreateEntry = selectedCreateRule && isStructuredEntry(selectedCreateRule.entry) ? selectedCreateRule.entry : undefined;
  const selectedCreateIsARRLDX = selectedCreateRule?.identity.id.startsWith("arrl-dx-") ?? false;
  const selectedAllocatedField = selectedCreateRule ? allocatedSerialFieldID(selectedCreateRule.entry) : undefined;
  const draftReport = active && draft ? reportForMode(active.rule.entry, draft.fields.mode) : undefined;
  const editingReport = active && editing ? reportForMode(active.rule.entry, editing.qso.mode) : undefined;
  return <main className="contest-workspace">
    <header className="contest-header"><div><p>CONTESTING PILOT</p><h1>{active ? `${active.rule.displayName} · ${active.name}` : "Contest Workspace"}</h1></div><div className="contest-header-actions">{active && !manager && <button ref={exportButton} type="button" disabled={disabled} aria-haspopup="dialog" onClick={() => setExportOpen(true)}><Download size={15}/>Export…</button>}<button type="button" disabled={disabled} onClick={() => { closeExport(); setManager(value => !value); }}><Database size={15}/>Contest Manager</button></div></header>
    {error && <p className="contest-alert is-error" role="alert"><AlertTriangle size={15}/>{error}{needsRefresh && <button type="button" onClick={() => void refreshDraft()}>Refresh draft</button>}</p>}
    {notice && <p className="contest-alert" role="status"><CheckCircle2 size={15}/>{notice}</p>}
    {uncertain && <section className="contest-alert is-uncertain"><div><strong>{owner.pendingPhase === "inflight" ? "Saving…" : busy ? "Checking save status…" : "Save status unknown"}</strong><p>The original save is preserved for receipt checking or an exact retry.</p></div>{owner.pendingPhase === "uncertain" && <><button disabled={busy} onClick={() => void checkReceipt(false)}>Check save status</button><button disabled={busy} onClick={() => void checkReceipt(true)}>Retry same save</button></>}</section>}
    {manager && <section className="contest-manager"><div className="contest-session-list"><h2>Contest sessions</h2>{sessions.map(session => <button type="button" key={session.sessionID} disabled={disabled} aria-current={active?.sessionID === session.sessionID || undefined} onClick={() => void openSession(session.sessionID)}><span><strong>{session.name}</strong><small>{session.rule.displayName} · {session.qsoCount} QSOs</small></span><time>{session.rule.identity.edition}</time></button>)}</div>
      <form className="contest-create" onSubmit={createSession} aria-label="Create contest session"><h2>New session</h2><label>Session name<input maxLength={128} disabled={disabled} value={create.name} onChange={e => setCreate({...create,name:e.target.value})}/></label><label>Contest<select disabled={disabled} value={create.ruleID} onChange={e => setCreate({...create,ruleID:e.target.value,stationExchangeFields:{},stationFields:{}})}>{rules.map(rule => <option key={rule.identity.id} value={rule.identity.id}>{rule.displayName} · {rule.identity.edition}</option>)}</select></label><div className="contest-create-fields"><label>Station callsign<input maxLength={32} disabled={disabled} value={create.station} onChange={e => setCreate({...create,station:e.target.value})}/></label><label>Operator callsign<input maxLength={32} disabled={disabled} value={create.operator} onChange={e => setCreate({...create,operator:e.target.value})}/></label><label>CQ zone<input maxLength={8} disabled={disabled} value={create.cqZone} onChange={e => setCreate({...create,cqZone:e.target.value})}/></label><label>DXCC entity<input maxLength={160} disabled={disabled} value={create.entity} onChange={e => setCreate({...create,entity:e.target.value})}/></label>{selectedCreateEntry && <>{selectedCreateEntry.exchange.sentFields.filter(field => field.id !== selectedAllocatedField).map(field => <label key={`exchange-${field.id}`}>{selectedCreateIsARRLDX ? field.id === "location" ? "Station state or province (W/VE)" : "Station power (DX)" : `Station ${field.label.charAt(0).toLowerCase() + field.label.slice(1)}`}<input maxLength={field.maximumUTF8Bytes} required={field.required} disabled={disabled} value={create.stationExchangeFields[field.id] ?? ""} onChange={e => { const value = selectedCreateIsARRLDX ? e.target.value.toUpperCase() : e.target.value; setCreate({...create,stationExchangeFields:selectedCreateIsARRLDX ? Object.fromEntries(selectedCreateEntry.exchange.sentFields.map(item => [item.id, item.id === field.id ? value : ""])) : {...create.stationExchangeFields,[field.id]:value}}); }}/></label>)}{(selectedCreateEntry.stationFields ?? []).map(field => <label key={`station-${field.id}`}>{field.label}<input maxLength={field.maximumUTF8Bytes} required={field.required} disabled={disabled} value={create.stationFields[field.id] ?? ""} onChange={e => setCreate({...create,stationFields:{...create.stationFields,[field.id]:e.target.value}})}/></label>)}</>}</div>{selectedCreateIsARRLDX && <p className="contest-source">W/VE stations enter one state or province; DX stations enter one uppercase power token such as 100, K, 1KW, or KILO. An incomplete token stays editable until it is valid. Cabrillo section is an independent station field.</p>}<p className="contest-source">Exact rule and reference versions are pinned at creation.</p><button className="contest-primary" type="submit" disabled={disabled}>Create and open</button></form></section>}
    {active && draft && !manager && (() => {
      const entryPanel = <form ref={entryRoot} className="contest-entry" aria-label={`${active.rule.mode} contest entry`} onSubmit={logQSO}><header><h2>Plain Log · optional simulated operator flow</h2><span>{owner.dirty ? "Saving…" : "Saved"}</span></header>
{active.rule.operatorCapability && <ContestOperatorPanel key={`${active.sessionID}/${active.workspaceGeneration}`} session={active} draft={draft} entryRoot={entryRoot}
editGeneration={operatorEditGeneration} disabled={entryDisabled || owner.dirty || !!uncertain} recovery={operatorRecovery}
reserveSerial={reserveSerial} commitQSO={commitQSO} simulateOutput={simulateContestOutput}
admitIntent={(identity, context) => !owner.dirty && !owner.pendingOperation && owner.session?.sessionID === context.sessionID &&
owner.session.workspaceGeneration === context.workspaceGeneration && owner.draft?.draftID + "@" + owner.draft?.revision === identity}
guardFormSubmit={guarded => { operatorSubmitGuard.current = guarded; }}
onSurfaceChange={acceptOperatorSurface}
registerSurfaceController={acceptOperatorSurfaceController}
focusField={field => (field === "callsign" ? callsignInput.current : exchangeInput.current)?.focus()}/>}
<ContestEntryFields callsign={<ContestTextField label="Callsign" className="contest-call" inputRef={callsignInput} data-contest-operator-field="callsign" aria-label="Contest callsign" autoComplete="off" maxLength={32} disabled={entryDisabled} value={draft.fields.callsign} onChange={e => changeField("callsign", e.target.value.toUpperCase())}/>} reports={draftReport?.format !== "none" && <><ContestTextField label="Sent report" maxLength={draftReport?.maximumUTF8Bytes} disabled={entryDisabled} value={draft.fields.sentReport} onChange={e => changeField("sentReport", e.target.value)}/><ContestTextField label="Received report" maxLength={draftReport?.maximumUTF8Bytes} disabled={entryDisabled} value={draft.fields.receivedReport} onChange={e => changeField("receivedReport", e.target.value)}/></>} exchange={isStructuredEntry(active.rule.entry) ? active.rule.entry.exchange.receivedFields.map((field, index) => <ContestTextField label={`Received ${field.label}`} key={field.id} inputRef={index === 0 ? exchangeInput : undefined} data-contest-operator-field="exchange" maxLength={field.maximumUTF8Bytes} disabled={entryDisabled} required={field.required} value={draft.fields.receivedExchangeFields?.[field.id] ?? ""} onChange={e => changeStructuredReceived(field.id, e.target.value)}/>) : <><ContestTextField label="Sent exchange" maxLength={32} disabled={entryDisabled} value={draft.fields.sentExchange} onChange={e => changeField("sentExchange", e.target.value)}/><ContestTextField label="Received exchange" inputRef={exchangeInput} data-contest-operator-field="exchange" maxLength={32} disabled={entryDisabled} value={draft.fields.receivedExchange} onChange={e => changeField("receivedExchange", e.target.value)}/></>}/>
<SentExchangeSummary entry={active.rule.entry} values={draft.fields.sentExchangeFields} resolvedSerial={draft.resolvedSerial} label="Sent exchange"/>
<div className="contest-entry-context"><div><span>Frequency Hz</span><input aria-label="Frequency Hz" inputMode="numeric" maxLength={11} disabled={entryDisabled} value={frequencyText} onChange={e => changeFrequency(e.target.value)}/></div><div><span>Band</span><select aria-label="Band" disabled={entryDisabled} value={draft.fields.band} onChange={e => changeField("band", e.target.value)}>{(active.rule.supportedBands ?? ["160m","80m","40m","20m","15m","10m"]).map(x => <option key={x}>{x}</option>)}</select></div><div><span>Mode</span>{(active.rule.supportedModes?.length ?? 1) > 1 ? <select aria-label="Mode" disabled={entryDisabled} value={draft.fields.mode} onChange={e => changeMode(e.target.value as ContestDraftFields["mode"])}>{active.rule.supportedModes!.map(mode => <option key={mode}>{mode}</option>)}</select> : <strong>{draft.fields.mode}</strong>}</div></div>
{operatingFrequencyError && <p className="contest-validation is-duplicate">{operatingFrequencyError}</p>}<div className={`contest-validation is-${draft.dupe.state}`}><strong>{draft.dupe.state === "duplicate" ? "Duplicate" : "Dupe check"}</strong><span>{draft.dupe.state === "unchecked" && draft.fields.callsign.trim() === "" ? "Enter a callsign to check duplicate status." : draft.dupe.reason}</span>{[...draft.validation.errors,...draft.validation.warnings].map((item, index) => <span key={`validation-${index}`}>{item}</span>)}</div>
<footer>{(draft.resolvedSerial?.requirement ?? active.rule.entry.serial.requirement) === "requiredForCommit" && <button type="button" disabled={disabled} onClick={() => void reserveSerial().catch(() => {})}>{draft.reservedSerial ? `Serial ${draft.reservedSerial}` : "Reserve serial"}</button>}<button className="contest-primary" type="submit" disabled={entryDisabled || !!operatingFrequencyError || draft.validation.errors.length > 0 || draft.dupe.state === "duplicate"}>Log QSO</button></footer>
</form>;
      const statisticsPanel = <aside className="contest-score" aria-label="Score and multipliers"><h2><Trophy size={15}/> Score & multipliers</h2><ContestScoreSummary score={score}/></aside>;
      const assistancePanel = <><ContestAssistancePanel request={request} ownerLeaseID={leaseRef.current?.id??0} sessionID={active.sessionID} workspaceGeneration={active.workspaceGeneration}
draftID={draft.draftID} callsign={draft.fields.callsign} disabled={entryDisabled} onSelect={applyAssistanceCallsign} importDataset={scpImport} onSurfaceChange={setSCPSurface}/></>;
      const historyPanel = <><ContestCallHistoryPanel request={request} ownerLeaseID={leaseRef.current?.id??0} session={active} draft={draft}
disabled={entryDisabled} ready={!owner.dirty&&!draftSaveInFlight} onApply={applyHistory} importDataset={historyImport} onSurfaceChange={setHistorySurface}/></>;
      const editorPanel = <>{editing && <form className="contest-qso-editor" aria-label={`Edit ${editing.original.callsign}`} onSubmit={event => { event.preventDefault(); void applyQSOChange("correction"); }}><header><div><h2><Pencil size={15}/> Edit {editing.original.callsign}</h2><p>Update the contact; score and duplicate credit are recalculated when saved.</p></div><button type="button" aria-label="Cancel contact edit" disabled={disabled} onClick={() => { setEditing(null); setConfirmDelete(false); setEditorFrequencyError(""); }}><X size={14}/>Cancel</button></header>
<div className="contest-qso-fields"><ContestTextField label="Callsign" autoComplete="off" maxLength={32} disabled={disabled} value={editing.qso.callsign} onChange={event => changeQSO("callsign", event.target.value.toUpperCase())}/>{editingReport?.format !== "none" && <><ContestTextField label="Sent report" maxLength={editingReport?.maximumUTF8Bytes} disabled={disabled} value={editing.qso.sentReport} onChange={event => changeQSO("sentReport", event.target.value)}/><ContestTextField label="Received report" maxLength={editingReport?.maximumUTF8Bytes} disabled={disabled} value={editing.qso.receivedReport} onChange={event => changeQSO("receivedReport", event.target.value)}/></>}{isStructuredEntry(active.rule.entry) ? active.rule.entry.exchange.receivedFields.map(field => <ContestTextField label={`Received ${field.label}`} key={field.id} maxLength={field.maximumUTF8Bytes} required={field.required} disabled={disabled} value={editing.qso.receivedExchangeFields?.[field.id] ?? ""} onChange={event => changeQSOReceivedField(field.id, event.target.value)}/>) : <ContestTextField label="Received exchange" maxLength={64} disabled={disabled} value={editing.qso.receivedExchange} onChange={event => { changeQSO("receivedExchange", event.target.value); changeQSO("normalizedReceivedExchange", event.target.value); }}/>}<ContestTextField label="Frequency Hz" inputMode="numeric" maxLength={11} disabled={disabled} value={editFrequencyText} onChange={event => changeQSOFrequency(event.target.value)}/><label>Band<select disabled={disabled} value={editing.qso.band} onChange={event => changeQSO("band", event.target.value)}>{(active.rule.supportedBands ?? ["160m","80m","40m","20m","15m","10m"]).map(value => <option key={value}>{value}</option>)}</select></label></div>
<SentExchangeSummary entry={active.rule.entry} values={editing.qso.sentExchangeFields} resolvedSerial={active.resolvedSerial} label="Frozen sent exchange"/>
<div className="contest-qso-readonly" aria-label="Original contact details"><div><span>Original UTC</span><strong>{new Date(editing.original.originalUTC).toISOString().replace("T", " ").slice(0, 19)} Z</strong></div><div><span>Operator</span><strong>{editing.original.operatorCallsign || "Not recorded"}</strong></div><div><span>Station location</span><strong>{editing.original.stationLocation || "Not recorded"}</strong></div><div><span>Sent allocation</span><strong>{editing.original.sentExchange || "Not allocated"}</strong></div><div><span>{editing.qso.callsign === editing.original.callsign ? "Entity" : "Original entity"}</span><strong>{editing.original.entity?.name ?? "Unavailable"}</strong>{editing.qso.callsign !== editing.original.callsign && <small>New callsign country is checked against the pinned reference when saved.</small>}</div><div><span>Source</span><strong>{editing.original.provenance.source === "operatorEntry" ? "Operator entry" : "Imported contact"}</strong></div></div>
{editorFrequencyError && <p className="contest-validation is-duplicate">{editorFrequencyError}</p>}<ContestTextField label="Correction note" className="contest-qso-note" maxLength={1024} disabled={disabled} value={correctionReason} onChange={event => setCorrectionReason(event.target.value)}/>
{confirmDelete && <div className="contest-delete-confirm" role="alert"><div><strong>Delete {editing.original.callsign}?</strong><p>This removes the contact and recalculates score, multiplier, and duplicate credit.</p></div><ContestTextField label="Deletion note" maxLength={1024} disabled={disabled} value={deletionReason} onChange={event => setDeletionReason(event.target.value)}/><button type="button" className="contest-danger" disabled={disabled || !deletionReason.trim()} onClick={() => void applyQSOChange("deletion")}><Trash2 size={14}/>Confirm deletion</button></div>}
<footer><button type="button" className="contest-danger-secondary" disabled={disabled} onClick={() => setConfirmDelete(value => !value)}><Trash2 size={14}/>{confirmDelete ? "Keep contact" : "Delete contact"}</button><button className="contest-primary" type="submit" disabled={disabled || !!editorFrequencyError || !correctionReason.trim()}>Save correction</button></footer></form>}</>;
      const logPanel = <section className="contest-log" aria-label="Contest log"><header><h2><ClipboardList size={15}/> Contest log</h2><p>This session only · {page?.total ?? 0} contacts</p></header><div className="contest-log-scroll"><ContestLogTable rows={page?.qsos.map(qso => ({ ...qso, multiplierLabels: qso.multiplierDisplayLabels ?? (qso.multiplier ? [qso.multiplier] : []) })) ?? []} disabled={disabled} onEdit={qsoID => void editQSO(qsoID)} editIcon={<Pencil size={13}/>}/></div><footer><span>{page ? `${page.offset + (page.qsos.length ? 1 : 0)}–${page.offset + page.qsos.length} of ${page.total}` : "Loading…"}</span><div><button disabled={busy || offset===0} onClick={() => void movePage(Math.max(0,offset-PAGE_SIZE))}>Previous</button><button disabled={busy || !page || offset+page.limit>=page.total} onClick={() => void movePage(offset+PAGE_SIZE)}>Next</button></div></footer></section>;
      return <>
      <section className="contest-snapshot" aria-label="Contest identity snapshot"><div><span>Station</span><strong>{active.station.callsign}</strong></div><div><span>Operator</span><strong>{active.operator.callsign}</strong></div><div><span>CQ zone</span><strong>{active.station.cqZone}</strong></div><div><span>Entity</span><strong>{active.station.dxccEntity || (active.rule.identity.id.startsWith("jidx-") && active.station.callsign.endsWith("/MM") ? "Maritime mobile" : "Unavailable")}</strong></div><div><span>Rules</span><small className={`contest-source is-${active.rule.sourceVerification}`}>{active.rule.sourceVerification} · {active.rule.identity.version} · {active.referenceDataVersion}</small></div></section>
      {active.rule.declarativeDefinition && <p className="contest-alert" role="status">Operator archive · this immutable contest definition supports logging and archive export. It is not marked sponsor-submission ready.</p>}
      {sacPreview && <p className="contest-alert" role="status">SAC scoring practice preview. Category and contest-date eligibility are not fully enforced.</p>}
      {active.rule.identity.id === "naqp-rtty" && <p className="contest-alert" role="status">NAQP RTTY rules preview · plain logging only. No radio, audio, or RTTY hardware output is used.</p>}
      {(active.rule.identity.id === "naqp-cw" || active.rule.identity.id === "naqp-ssb") && <p className="contest-alert" role="status">NAQP rules preview · optional simulated Run / S&amp;P output only. No radio, audio, PTT, or hardware output is used.</p>}
      {active.rule.identity.id === "arrl-rtty-roundup" && <p className="contest-alert" role="status">ARRL RTTY Roundup preview · plain logging only. Contest dates, categories, and RTTY hardware operation are not certified.</p>}
      {active.rule.identity.id.startsWith("arrl-dx-") && <p className="contest-alert" role="status">ARRL International DX preview · optional simulated Run / S&amp;P output and Single Operator export only. No radio, audio, PTT, or hardware output is used. Contest dates, full categories, and sponsor submission acceptance remain open.</p>}
      <ContestOperatorCanvas request={(method, params) => request(method as never, params as never)}
        canChangeLayout={() => !retiring && !busy && !uncertain && !owner.dirty && !draftSaveInFlight && !editing}
        panels={{
          "active-qso": { title: "Entry", content: entryPanel },
          "callsign-intelligence": { title: "Check Partial", content: <>{assistancePanel}{historyPanel}</> },
          propagation: { title: "Statistics", content: statisticsPanel },
          logbook: { title: "Log", content: <>{editorPanel}{logPanel}</> },
        }} traditional={<>
      <div className="contest-operating-grid">{entryPanel}{statisticsPanel}</div>
      {assistancePanel}
      {historyPanel}
      {editorPanel}
      {logPanel}
        </>} />
    </>; })()}
    {exportOpen && active && <ContestExportPanel session={active} opener={exportButton} saveOwner={exportSaveOwner}
      prepare={prepareExport} release={prepared => client.releaseExport(prepared)} onClose={closeExport}
      onSaved={filename => { setNotice(`Saved ${filename}.`); closeExport(); }}
    />}
  </main>;
}
export default ContestWorkspace;

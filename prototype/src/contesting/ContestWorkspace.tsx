import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, Database, RefreshCw, Trophy } from "lucide-react";
import { ContestMutationUncertain, ContestServerError } from "./client";
import { sharedContestSessionOwner, type ContestOwnerLease, type ContestRecoveryStorage } from "./sessionOwner";
import type { ContestCreateInput, ContestDraftFields, ContestLogPage, ContestRequest, ContestRuleMetadata, ContestScore, ContestSessionSummary } from "./types";
import "./ContestWorkspace.css";

const PAGE_SIZE = 20;
type Props = { request: ContestRequest; createRequestID?: () => string; digestPayload?: (payload: unknown) => Promise<string>; recoveryStorage?: ContestRecoveryStorage };
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }
function defaultStorage(): ContestRecoveryStorage | undefined { try { return globalThis.localStorage; } catch { return undefined; } }

export function ContestWorkspace({ request, createRequestID, digestPayload, recoveryStorage }: Props) {
  const owner = useMemo(() => sharedContestSessionOwner(request, createRequestID, digestPayload, recoveryStorage ?? defaultStorage()), [request, createRequestID, digestPayload, recoveryStorage]);
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
  const [inputError, setInputError] = useState("");
  const [create, setCreate] = useState({ name: "", ruleID: "cq-ww-cw", station: "", operator: "", cqZone: "", entity: "", category: "Single Operator" });
  const actionLock = useRef(false);
  const contextTicket = useRef(0);
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
  useEffect(() => { setFrequencyText(draft?.fields.frequencyHz?.toString() ?? ""); setInputError(""); }, [frequencyContext]);

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
      setManager(false); setNeedsRefresh(false);
      await owner.flush();
      if (ticket !== contextTicket.current || !accepts(scope) || !owner.session) return;
      await projections(owner.session, 0, ticket, scope);
    } catch (cause) { handleFailure(cause, ticket, scope); } finally { endAction(ticket, scope); }
  }

  function changeField<K extends keyof ContestDraftFields>(key: K, value: ContestDraftFields[K]) {
    if (!draft || busy || blockingOperation) return;
    owner.edit({ ...draft.fields, [key]: value });
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    const ticket = contextTicket.current, scope = capturedScope();
    saveTimer.current = window.setTimeout(() => void owner.flush().catch(cause => handleFailure(cause, ticket, scope)), 180);
  }
  function changeFrequency(raw: string) {
    if (busy || blockingOperation) return;
    setFrequencyText(raw);
    if (!/^[0-9]{0,11}$/.test(raw)) { setInputError("Frequency must contain digits only."); return; }
    const parsed = raw === "" ? null : Number(raw);
    if (parsed !== null && (!Number.isSafeInteger(parsed) || parsed > 100_000_000_000)) { setInputError("Frequency is outside the supported range."); return; }
    setInputError(""); changeField("frequencyHz", parsed);
  }

  async function createSession(event: FormEvent) {
    event.preventDefault(); if (uncertain || !workspaceGeneration || !beginAction()) return;
    const ticket = ++contextTicket.current, scope = admissionScope();
    try {
      await owner.flush();
      if (!accepts(scope) || owner.pendingOperation) return;
      const rule = rules.find(item => item.identity.id === create.ruleID); if (!rule) throw new Error("Select an available contest.");
      const input: ContestCreateInput = { name: create.name.trim(), ruleIdentity: rule.identity, referenceDataVersion: rule.referenceDataVersion,
        station: { callsign: create.station.trim().toUpperCase(), cqZone: create.cqZone.trim(), dxccEntity: create.entity.trim() },
        operator: { callsign: create.operator.trim().toUpperCase(), category: create.category.trim() } };
      const result = await client.create(workspaceGeneration, input);
      if (ticket !== contextTicket.current || !accepts(scope)) return;
      if (!owner.activate(result.session, result.draft, scope.lease!, scope.admission!)) return;
      setSessions(items => [...items.filter(item => item.sessionID !== result.session.sessionID), result.session]); setManager(false);
      await projections(result.session, 0, ticket, scope);
    } catch (cause) { handleFailure(cause, ticket, scope); } finally { endAction(ticket, scope); }
  }

  async function reserveSerial() {
    if (!active || !draft || uncertain || !beginAction()) return;
    const ticket = contextTicket.current, sessionID = active.sessionID, generation = active.workspaceGeneration, scope = admissionScope();
    try {
      await owner.flush(); if (!accepts(scope) || owner.pendingOperation) return;
      const current = owner.session!, result = await client.reserveSerial(current, owner.draft!.draftID);
      if (ticket === contextTicket.current && accepts(scope) && owner.session?.sessionID === sessionID && owner.session.workspaceGeneration === generation) owner.apply(result, scope.lease!, scope.admission!);
    } catch (cause) { handleFailure(cause, ticket, scope); } finally { endAction(ticket, scope); }
  }
  async function logQSO(event: FormEvent) {
    event.preventDefault(); if (!active || !draft || blockingOperation || inputError || draft.validation.errors.length || draft.dupe.state === "duplicate" || !beginAction()) return;
    const ticket = contextTicket.current, sessionID = active.sessionID, generation = active.workspaceGeneration, scope = admissionScope();
    try {
      await owner.flush(); if (!accepts(scope) || owner.pendingOperation) return; const current = owner.session!, result = await client.commitQSO(current, owner.draft!.draftID);
      if (ticket !== contextTicket.current || !accepts(scope) || owner.session?.sessionID !== sessionID || owner.session.workspaceGeneration !== generation) return;
      if (!owner.apply(result, scope.lease!, scope.admission!)) return;
      setScore(result.score); setNotice(`Logged ${result.qso.callsign}.`); await projections(result.session, 0, ticket, scope);
    } catch (cause) { handleFailure(cause, ticket, scope); } finally { endAction(ticket, scope); }
  }
  async function checkReceipt(retry = false) {
    if (!uncertain || !beginAction()) return; const ticket = contextTicket.current, operation = uncertain, scope = admissionScope();
    try {
      if (retry) {
        const result = await client.retry(operation);
        if (ticket !== contextTicket.current || !accepts(scope)) return;
        if (!owner.activate(result.session, result.draft, scope.lease!, scope.admission!)) return;
        setManager(false); await projections(result.session, 0, ticket, scope);
      } else {
        const result = await client.receipt(operation);
        if (ticket !== contextTicket.current || !accepts(scope)) return;
        if (result.status === "not_found") setNotice("The original operation is still unresolved. Retry the same operation only.");
        else {
          const opened = await client.open(operation.scope.sessionID, operation.scope.workspaceGeneration);
          if (ticket !== contextTicket.current || !accepts(scope) || opened.session.workspaceGeneration !== operation.scope.workspaceGeneration) return;
          if (!owner.confirmPending(operation, scope.lease!, scope.admission!)) return;
          if (!owner.activate(opened.session, opened.draft, scope.lease!, scope.admission!)) return;
          setManager(false); await projections(opened.session, 0, ticket, scope);
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

  const disabled = busy || !!uncertain;
  const entryDisabled = busy || blockingOperation;
  return <main className="contest-workspace">
    <header className="contest-header"><div><p>CONTESTING PILOT</p><h1>{active ? `${active.rule.displayName} · ${active.name}` : "Contest Workspace"}</h1></div><button type="button" disabled={disabled} onClick={() => setManager(value => !value)}><Database size={15}/>Contest Manager</button></header>
    {error && <p className="contest-alert is-error" role="alert"><AlertTriangle size={15}/>{error}{needsRefresh && <button type="button" onClick={() => void refreshDraft()}>Refresh draft</button>}</p>}
    {notice && <p className="contest-alert" role="status"><CheckCircle2 size={15}/>{notice}</p>}
    {uncertain && <section className="contest-alert is-uncertain"><div><strong>{owner.pendingPhase === "inflight" ? "Save in progress" : "Save status unknown"}</strong><p>Request <code>{uncertain.scope.requestID}</code> remains pinned to this exact operation.</p></div>{owner.pendingPhase === "uncertain" && <><button disabled={busy} onClick={() => void checkReceipt(false)}>Check receipt</button><button disabled={busy} onClick={() => void checkReceipt(true)}>Retry same operation</button></>}</section>}
    {manager && <section className="contest-manager"><div className="contest-session-list"><h2>Contest sessions</h2>{sessions.map(session => <button type="button" key={session.sessionID} disabled={disabled} aria-current={active?.sessionID === session.sessionID || undefined} onClick={() => void openSession(session.sessionID)}><span><strong>{session.name}</strong><small>{session.rule.displayName} · {session.qsoCount} QSOs</small></span><time>{session.rule.identity.edition}</time></button>)}</div>
      <form className="contest-create" onSubmit={createSession} aria-label="Create contest session"><h2>New session</h2><label>Session name<input maxLength={160} value={create.name} onChange={e => setCreate({...create,name:e.target.value})}/></label><label>Contest<select value={create.ruleID} onChange={e => setCreate({...create,ruleID:e.target.value})}>{rules.map(rule => <option key={rule.identity.id} value={rule.identity.id}>{rule.displayName} · {rule.identity.edition}</option>)}</select></label><div className="contest-create-fields"><label>Station callsign<input maxLength={32} value={create.station} onChange={e => setCreate({...create,station:e.target.value})}/></label><label>Operator callsign<input maxLength={32} value={create.operator} onChange={e => setCreate({...create,operator:e.target.value})}/></label><label>CQ zone<input maxLength={8} value={create.cqZone} onChange={e => setCreate({...create,cqZone:e.target.value})}/></label><label>DXCC entity<input maxLength={160} value={create.entity} onChange={e => setCreate({...create,entity:e.target.value})}/></label></div><p className="contest-source">Exact rule and reference versions are pinned at creation.</p><button className="contest-primary" type="submit" disabled={disabled}>Create and open</button></form></section>}
    {active && draft && !manager && <>
      <section className="contest-snapshot" aria-label="Contest identity snapshot"><div><span>Station</span><strong>{active.station.callsign}</strong></div><div><span>Operator</span><strong>{active.operator.callsign}</strong></div><div><span>CQ zone</span><strong>{active.station.cqZone}</strong></div><div><span>Entity</span><strong>{active.station.dxccEntity}</strong></div><div><span>Rules</span><small className={`contest-source is-${active.rule.sourceVerification}`}>{active.rule.sourceVerification} · {active.rule.identity.version} · {active.referenceDataVersion}</small></div></section>
      <div className="contest-operating-grid"><form className="contest-entry" aria-label="CW contest entry" onSubmit={logQSO}><header><h2>Plain Log · no transmit actions</h2><span>{owner.dirty ? "Saving draft…" : `Revision ${active.revision}`}</span></header>
        <div className="contest-entry-fields"><label className="contest-call">Callsign<input aria-label="Contest callsign" autoComplete="off" maxLength={32} disabled={entryDisabled} value={draft.fields.callsign} onChange={e => changeField("callsign", e.target.value.toUpperCase())}/></label><label>Sent report<input maxLength={8} disabled={entryDisabled} value={draft.fields.sentReport} onChange={e => changeField("sentReport", e.target.value)}/></label><label>Sent exchange<input maxLength={32} disabled={entryDisabled} value={draft.fields.sentExchange} onChange={e => changeField("sentExchange", e.target.value)}/></label><label>Received report<input maxLength={8} disabled={entryDisabled} value={draft.fields.receivedReport} onChange={e => changeField("receivedReport", e.target.value)}/></label><label>Received exchange<input maxLength={32} disabled={entryDisabled} value={draft.fields.receivedExchange} onChange={e => changeField("receivedExchange", e.target.value)}/></label></div>
        <div className="contest-entry-context"><div><span>Frequency Hz</span><input aria-label="Frequency Hz" inputMode="numeric" maxLength={11} disabled={entryDisabled} value={frequencyText} onChange={e => changeFrequency(e.target.value)}/></div><div><span>Band</span><select aria-label="Band" disabled={entryDisabled} value={draft.fields.band} onChange={e => changeField("band", e.target.value)}>{["160m","80m","40m","20m","15m","10m"].map(x => <option key={x}>{x}</option>)}</select></div><div><span>Mode</span><strong>CW</strong></div></div>
        {inputError && <p className="contest-validation is-duplicate">{inputError}</p>}<div className={`contest-validation is-${draft.dupe.state}`}><strong>{draft.dupe.state === "duplicate" ? "Duplicate" : "Dupe check"}</strong><span>{draft.dupe.reason}</span>{[...draft.validation.errors,...draft.validation.warnings].map(item => <span key={item}>{item}</span>)}</div>
        <footer><button type="button" disabled={disabled} onClick={() => void reserveSerial()}>{draft.reservedSerial ? `Serial ${draft.reservedSerial}` : "Reserve serial"}</button><button className="contest-primary" type="submit" disabled={entryDisabled || !!inputError || draft.validation.errors.length > 0 || draft.dupe.state === "duplicate"}>Log QSO</button></footer>
      </form><aside className="contest-score" aria-label="Score and multipliers"><h2><Trophy size={15}/> Score & multipliers</h2><dl><div><dt>Claimed score</dt><dd>{score?.claimedScore.toLocaleString() ?? "—"}</dd></div><div><dt>QSOs</dt><dd>{score?.qsos ?? "—"}</dd></div><div><dt>Points</dt><dd>{score?.points ?? "—"}</dd></div><div><dt>Multipliers</dt><dd>{score?.multipliers ?? "—"}</dd></div></dl><div className="contest-multipliers">{score?.multiplierLabels.length ? score.multiplierLabels.map(x => <span key={x}>{x}</span>) : <p>No multipliers recorded.</p>}</div><p className={`contest-source is-${score?.sourceVerification ?? "unverified"}`}>Score source: {score?.sourceVerification ?? "unavailable"}</p></aside></div>
      <section className="contest-log" aria-label="Contest log"><header><h2><ClipboardList size={15}/> Contest log</h2><p>This session only · {page?.total ?? 0} contacts</p></header><div className="contest-log-scroll"><table><thead><tr><th>UTC</th><th>Call</th><th>Band</th><th>Sent</th><th>Received</th><th>Pts</th><th>Mult</th></tr></thead><tbody>{page?.qsos.length ? page.qsos.map(qso => <tr key={qso.qsoID}><td data-label="UTC">{new Date(qso.workedAt).toISOString().slice(0,16).replace("T"," ")}</td><td data-label="Call"><strong>{qso.callsign}</strong></td><td data-label="Band">{qso.band}</td><td data-label="Sent">{qso.sentExchange}</td><td data-label="Received">{qso.receivedExchange}</td><td data-label="Points">{qso.points}</td><td data-label="Multiplier">{qso.multiplier ?? "—"}</td></tr>) : <tr><td colSpan={7}>No QSOs in this contest.</td></tr>}</tbody></table></div><footer><span>{page ? `${page.offset + (page.qsos.length ? 1 : 0)}–${page.offset + page.qsos.length} of ${page.total}` : "Loading…"}</span><div><button disabled={busy || offset===0} onClick={() => void movePage(Math.max(0,offset-PAGE_SIZE))}>Previous</button><button disabled={busy || !page || offset+page.limit>=page.total} onClick={() => void movePage(offset+PAGE_SIZE)}>Next</button></div></footer></section>
    </>}
  </main>;
}
export default ContestWorkspace;

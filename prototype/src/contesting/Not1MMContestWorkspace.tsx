import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { BookOpen, Download, Radio, Trophy } from "lucide-react";
import BandMaps, { type BandMapSpot } from "../live/BandMaps";
import ClusterPanel from "../live/ClusterPanel";
import { useSharedCW } from "../live/useSharedCW";
import { ContestOperatorCanvas } from "./ContestOperatorCanvas";
import { ContestEntryFields, ContestLogTable, ContestScoreSummary, ContestTextField, type ContestLogRow } from "./ContestPresentation";
import { nativeContestExportSave, type ContestExportSavePrepared } from "./contestExportSave";
import type { ContestTransitionController } from "./ContestWorkspace";
import "./ContestWorkspace.css";

type Data = Record<string, any>;
type Request = (method: string, params?: Record<string, unknown>) => Promise<unknown>;
type Field = { id: string; label: string; accessibleName: string; value: string; visible: boolean; readOnly: boolean; enabled: boolean };
type Score = { qsos: number; points: number; countries: number; zones: number; total: number };
type Projection = {
  sessionID: string; engine: "not1mm-python"; pluginID: string; sourceRevision: string; referenceID: string;
  workspaceGeneration: string; revision: number; draftID: string; fields: Field[]; frequencyHz: number; mode: string; band: number;
  focus: string; tabNext: Record<string, string>; tabPrevious: Record<string, string>; run: boolean;
  functionKeys: Array<{ id: string; highlighted: boolean }>; dupe: boolean; countryResolved: boolean;
  history: string; score: Score;
};
type Session = { sessionID: string; workspaceGeneration: string; name: string; pluginID: string; sourceRevision: string; revision: number };
type MutationResult = { projection: Projection; actions?: Data[]; messages?: string[]; replayed?: boolean; outputError?: string };
type Props = {
  request: Request;
  serviceRequest: Request;
  stationCall: string;
  radioFrequencyHz?: number;
  spots: BandMapSpot[];
  cluster: any;
  selectedSpotId?: string | null;
  onSelectedSpot?: (id: string) => void;
  registerTransition?: (controller: ContestTransitionController | null) => void;
};

const activeSessionKey = "xlog.contesting.not1mm.active-session.v1";
const bandLabels: Record<string, string> = { "1.8": "160m", "3.5": "80m", "7": "40m", "14": "20m", "21": "15m", "28": "10m" };
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : "Contest operation failed.";

function unwrap<T>(value: unknown): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The contest host returned an invalid response.");
  const frame = value as Data;
  if (typeof frame.id !== "string" || typeof frame.ok !== "boolean") throw new Error("The contest host response could not be correlated.");
  if (!frame.ok) throw new Error(typeof frame.error?.message === "string" ? frame.error.message : "The contest host rejected the operation.");
  if (!frame.result || typeof frame.result !== "object" || Array.isArray(frame.result)) throw new Error("The contest host returned no result.");
  return frame.result as T;
}

function projectionFields(projection: Projection | null) {
  return Object.fromEntries((projection?.fields ?? []).map(field => [field.id, field.value]));
}

function sameFields(left: Record<string, string>, right: Record<string, string>) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every(key => (left[key] ?? "") === (right[key] ?? ""));
}

function logRows(rows: Data[]): ContestLogRow[] {
  return rows.map(row => ({
    qsoID: String(row.ID ?? ""), workedAt: `${String(row.TS ?? "").replace(" ", "T")}Z`, callsign: String(row.Call ?? ""),
    band: bandLabels[String(row.Band)] ?? String(row.Band ?? ""), mode: String(row.Mode ?? "CW"),
    sentExchange: String(row.SentNr ?? ""), receivedExchange: String(row.ZN ?? row.Exchange1 ?? ""),
    points: Number(row.Points ?? 0), multiplierLabels: [String(row.CountryPrefix ?? ""), row.ZN ? `Zone ${row.ZN}` : ""].filter(Boolean),
  }));
}

export function Not1MMContestWorkspace({ request, serviceRequest, stationCall, radioFrequencyHz, spots, cluster,
  selectedSpotId, onSelectedSpot, registerTransition }: Props) {
  const [catalog, setCatalog] = useState<Data[]>([]), [sessions, setSessions] = useState<Session[]>([]);
  const [projection, setProjection] = useState<Projection | null>(null), projectionRef = useRef<Projection | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({}), fieldsRef = useRef<Record<string, string>>({});
  const [rows, setRows] = useState<Data[]>([]), [score, setScore] = useState<Score | null>(null), [matrices, setMatrices] = useState<Data>({ countries: [], zones: [] });
  const [manager, setManager] = useState(true), [busy, setBusy] = useState(false), busyRef = useRef(false);
  const [retiring, setRetiring] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [create, setCreate] = useState({ name: "CQ WW CW", cqZone: "15" });
  const [editing, setEditing] = useState<Data | null>(null), [editCall, setEditCall] = useState(""), [editZone, setEditZone] = useState("");
  const fieldRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const focusRef = useRef("callsign");
  const cw = useSharedCW(projection?.sessionID ?? "not1mm-no-session", retiring);
  projectionRef.current = projection; fieldsRef.current = fields;

  const result = async <T,>(method: string, params: Record<string, unknown> = {}) => unwrap<T>(await request(method, params));
  const acceptProjection = (next: Projection) => { projectionRef.current = next; focusRef.current = next.focus; setProjection(next); const values = projectionFields(next); fieldsRef.current = values; setFields(values); };
  const refresh = async (sessionID: string, next?: Projection) => {
    const [log, scoreResult] = await Promise.all([
      result<Data>("contest_log_page", { sessionID, offset: 0, limit: 100 }),
      result<Data>("contest_score", { sessionID }),
    ]);
    if (next && projectionRef.current?.sessionID !== next.sessionID) return;
    setRows(Array.isArray(log.rows) ? log.rows : []); setScore(scoreResult.score as Score); setMatrices(scoreResult.matrices ?? { countries: [], zones: [] });
  };
  const openSession = async (session: Session) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const opened = await result<{ projection: Projection }>("contest_open", {
        sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration,
      });
      acceptProjection(opened.projection); await refresh(session.sessionID, opened.projection);
      localStorage.setItem(activeSessionKey, session.sessionID); setManager(false); setEditing(null);
      await cw.controller.refresh();
    } catch (cause) { setError(errorMessage(cause)); }
    finally { busyRef.current = false; setBusy(false); }
  };

  useEffect(() => {
    let active = true;
    void Promise.all([result<Data>("contest_catalog"), result<{ sessions: Session[] }>("contest_sessions")]).then(([available, list]) => {
      if (!active) return;
      setCatalog(Array.isArray(available.plugins) ? available.plugins : []); setSessions(list.sessions);
      const stored = localStorage.getItem(activeSessionKey);
      const saved = stored ? list.sessions.find(session => session.sessionID === stored) : undefined;
      if (saved) void openSession(saved);
    }).catch(cause => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!registerTransition) return;
    registerTransition({
      freeze: () => setRetiring(true), resume: () => setRetiring(false),
      prepare: async () => {
        if (busyRef.current || editing || !sameFields(fieldsRef.current, projectionFields(projectionRef.current)))
          throw new Error("Finish or save the current contest edit before changing operating module.");
        await cw.controller.stop();
      },
    });
    return () => registerTransition(null);
  }, [registerTransition, editing, cw.controller]);

  const mutate = async (method: string, base: Projection, extra: Record<string, unknown> = {}) => {
    return result<MutationResult>(method, { sessionID: base.sessionID, operationID: crypto.randomUUID(), expectedRevision: base.revision, draftID: base.draftID, ...extra });
  };
  const runMutation = async (operation: (base: Projection) => Promise<MutationResult>, refreshViews = true) => {
    const base = projectionRef.current;
    if (!base || busyRef.current || retiring) return null;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const changed = await operation(base); acceptProjection(changed.projection);
      if (refreshViews) await refresh(changed.projection.sessionID, changed.projection);
      for (const item of changed.messages ?? []) setNotice(item);
      if (changed.actions?.length) throw new Error("Contest output requires native operation admission; no renderer output was sent.");
      if (changed.outputError) setError(changed.outputError);
      return changed.projection;
    } catch (cause) { setError(errorMessage(cause)); return null; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const hostAction = (method: string, extra: Record<string, unknown> = {}) => runMutation(async base => {
    const operationID = crypto.randomUUID();
    const native = await cw.controller.executeContest({ operation: method === "contest_esm" ? "esm" : "function_key",
      operationID, sessionID: base.sessionID, expectedContestRevision: base.revision, draftID: base.draftID,
      fields: fieldsRef.current, frequencyHz: base.frequencyHz, ...extra });
    const changed = native?.contestResult as (MutationResult & { operationID?: string }) | undefined;
    if (!changed?.projection || changed.operationID !== operationID) throw new Error(native?.error || "Contest CW operation was not confirmed. Use Stop and reopen the session before deciding what to do next.");
    return { ...changed, actions: [], outputError: native?.error || undefined };
  });

  const createSession = async (event: FormEvent) => {
    event.preventDefault();
    if (!stationCall.trim()) { setError("Configure the xLog station callsign before creating a contest."); return; }
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const sessionID = crypto.randomUUID();
      const workspaceGeneration = crypto.randomUUID();
      const created = await result<MutationResult>("contest_create", { sessionID, workspaceGeneration,
        operationID: crypto.randomUUID(), expectedRevision: 0,
        pluginID: "cq_ww_cw", name: create.name.trim() || "CQ WW CW", station: { Call: stationCall.trim().toUpperCase(), CQZone: create.cqZone },
        operator: stationCall.trim().toUpperCase(), settings: { SentExchange: create.cqZone, ModeCategory: "CW" } });
      acceptProjection(created.projection); await refresh(sessionID, created.projection);
      const list = await result<{ sessions: Session[] }>("contest_sessions"); setSessions(list.sessions);
      localStorage.setItem(activeSessionKey, sessionID); setManager(false);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const keyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape") { event.preventDefault(); void cw.controller.stop(); return; }
    if (!projection || busy || retiring) return;
    if (/^F(?:[1-9]|1[0-2])$/.test(event.key)) { event.preventDefault(); void hostAction("contest_function_key", { key: event.key }); return; }
    if (event.key === "Enter") { event.preventDefault(); void hostAction("contest_esm", { field: focusRef.current }); return; }
    if (event.key === "Tab") {
      const target = event.target as HTMLInputElement, current = target.dataset.contestField;
      const next = current && (event.shiftKey ? projection.tabPrevious[current] : projection.tabNext[current]);
      if (next && fieldRefs.current[next]) { event.preventDefault(); fieldRefs.current[next]?.focus(); }
    }
  };
  const chooseSpot = async (spot: BandMapSpot) => {
    const frequencyHz = Math.round(Number(spot.frequencyKHz) * 1000);
    if (!Number.isSafeInteger(frequencyHz)) return;
    const next = await runMutation(base => mutate("contest_draft_apply", base, {
      fields: { ...fieldsRef.current, callsign: String(spot.callsign ?? "").toUpperCase() }, frequencyHz,
    }), false);
    if (!next) return;
    onSelectedSpot?.(String(spot.id));
    try { await serviceRequest("contest_station_tune", { frequency_hz: frequencyHz, mode: "CW" }); setNotice(`Loaded ${spot.callsign} and requested one radio tune.`); }
    catch (cause) { setError(errorMessage(cause)); }
  };

  const exportCabrillo = async () => {
    const active = projectionRef.current;
    if (!active || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const prepared = await result<ContestExportSavePrepared & { filename?: string }>("contest_export_prepare", { sessionID: active.sessionID });
      const saved = await nativeContestExportSave(prepared);
      if (saved.status === "saved") setNotice(`Saved ${saved.filename}.`);
      else if (saved.status === "cancelled") setNotice("Cabrillo save cancelled.");
      else setError(saved.message);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const beginEdit = (qsoID: string) => {
    const row = rows.find(item => item.ID === qsoID); if (!row) return;
    setEditing(row); setEditCall(String(row.Call ?? "")); setEditZone(String(row.ZN ?? ""));
  };
  const correct = (event: FormEvent) => { event.preventDefault(); if (!editing) return;
    void runMutation(base => mutate("contest_qso_correct", base, { qsoID: editing.ID, fields: { callsign: editCall.toUpperCase(), other_2: editZone }, reason: "Operator correction" })).then(next => { if (next) setEditing(null); }); };
  const remove = () => { if (!editing || !confirm(`Delete ${editing.Call} from this contest?`)) return;
    void runMutation(base => mutate("contest_qso_delete", base, { qsoID: editing.ID, reason: "Operator deletion" })).then(next => { if (next) setEditing(null); }); };

  const scoreView = score ? { claimedScore: score.total, qsos: score.qsos, points: score.points,
    multipliers: score.countries + score.zones, multiplierLabels: [`${score.countries} countries`, `${score.zones} zones`], sourceVerification: "verified" } : null;
  const visibleFields = projection?.fields.filter(field => field.visible) ?? [];
  const cwPanel = () => projection && <section className="contest-operator" aria-label="CW controls"><header><div><strong>ESM and CW</strong><p>Not1MM chooses the F-key action; xLog owns the armed output lease.</p></div><span>{cw.state.message}</span></header><div className="contest-operator-controls"><button type="button" disabled={busy || cw.state.pending} onClick={() => void cw.controller.arm()}>Arm CW</button><button type="button" className="contest-danger-secondary" onClick={() => void cw.controller.stop()}>Stop</button><span className={cw.state.armed ? "is-armed" : ""}>{cw.state.armed ? "Armed" : "Disarmed"}</span></div>{cw.state.error && <p className="contest-alert is-error">{cw.state.error}</p>}<div className="contest-operator-keys">{projection.functionKeys.map(key => <button type="button" key={key.id} disabled={busy || retiring} className={key.highlighted ? "contest-primary" : undefined} onClick={() => void hostAction("contest_function_key", { key: key.id })}>{key.id}</button>)}</div></section>;
  const entryPanel: ReactNode = projection && <form className="contest-entry" aria-label="CQ WW CW entry" onSubmit={event => { event.preventDefault(); void runMutation(base => mutate("contest_qso_commit", base, { fields: fieldsRef.current, frequencyHz: base.frequencyHz })); }} onKeyDown={keyDown}>
    <header><div><h2><Radio size={15}/> CQ WW CW · Not1MM</h2><p>Actual pinned Python plugin · {projection.run ? "Run" : "Search & Pounce"}</p></div><span>{busy ? "Working…" : "Ready"}</span></header>
    <ContestEntryFields callsign={visibleFields.slice(0, 1).map(field => <ContestTextField key={field.id} label={field.label} aria-label={field.accessibleName} className="contest-call" autoComplete="off" data-contest-field={field.id} inputRef={node => { fieldRefs.current[field.id] = node; }} disabled={busy || retiring || !field.enabled} readOnly={field.readOnly} value={fields[field.id] ?? ""} onFocus={() => { focusRef.current = field.id; }} onChange={event => { const next = { ...fieldsRef.current, [field.id]: event.target.value.toUpperCase() }; fieldsRef.current = next; setFields(next); }}/>) } reports={visibleFields.slice(1, 3).map(field => <ContestTextField key={field.id} label={field.label} aria-label={field.accessibleName} data-contest-field={field.id} inputRef={node => { fieldRefs.current[field.id] = node; }} disabled={busy || retiring || !field.enabled} readOnly={field.readOnly} value={fields[field.id] ?? ""} onFocus={() => { focusRef.current = field.id; }} onChange={event => { const next = { ...fieldsRef.current, [field.id]: event.target.value }; fieldsRef.current = next; setFields(next); }}/>) } exchange={visibleFields.slice(3).map(field => <ContestTextField key={field.id} label={field.label} aria-label={field.accessibleName} data-contest-field={field.id} inputRef={node => { fieldRefs.current[field.id] = node; }} disabled={busy || retiring || !field.enabled} readOnly={field.readOnly} value={fields[field.id] ?? ""} onFocus={() => { focusRef.current = field.id; }} onChange={event => { const next = { ...fieldsRef.current, [field.id]: event.target.value.toUpperCase() }; fieldsRef.current = next; setFields(next); }}/>) } />
    <div className="contest-entry-context"><div><span>Frequency</span><strong>{(projection.frequencyHz / 1e6).toFixed(6)} MHz</strong></div><div><span>Band / mode</span><strong>{bandLabels[String(projection.band)] ?? projection.band} · {projection.mode}</strong></div><div><span>Operating style</span><button type="button" disabled={busy || retiring} onClick={() => void runMutation(base => mutate("contest_run_state", base, { run: !base.run }), false)}>{projection.run ? "Run" : "S&P"}</button></div></div>
    <div className={`contest-validation ${projection.dupe ? "is-duplicate" : "is-clear"}`}><strong>{projection.dupe ? "Duplicate" : "Dupe check"}</strong><span>{projection.countryResolved ? "Country resolved by xLog CTY data." : "Unknown country is retained; scoring credit may be zero."}</span></div>
    {cwPanel()}
    <footer><button type="button" disabled={busy || retiring} onClick={() => void hostAction("contest_esm", { field: focusRef.current })}>Enter / ESM</button><button className="contest-primary" type="submit" disabled={busy || retiring}>Log Now</button></footer>
  </form>;
  const scorePanel = <aside className="contest-score" aria-label="Score and multipliers"><h2><Trophy size={15}/> Score</h2><ContestScoreSummary score={scoreView}/></aside>;
  const checkPanel = <section className="contest-score" aria-label="Check Partial"><h2>Check Partial</h2><p className="contest-source">{projection?.history || "Type a call to query Not1MM call history."}</p><p>{projection?.dupe ? "Worked on this band" : projection?.countryResolved ? "Country resolved · not a duplicate" : "No country match yet"}</p></section>;
  const matrixPanel = <section className="contest-score" aria-label="Country and zone matrices"><h2>Countries / zones</h2><div className="contest-multipliers">{[...(matrices.countries ?? []), ...(matrices.zones ?? [])].map((item: Data, index: number) => <span key={`${item.value}-${item.band}-${index}`}>{item.value || "Unknown"} · {bandLabels[String(item.band)] ?? item.band} · {item.qsos}</span>)}</div></section>;
  const logPanel = <section className="contest-log"><header><div><h2><BookOpen size={15}/> Contest log</h2><p>{rows.length} contacts from the Python-owned DXLOG store.</p></div><button type="button" disabled={busy} onClick={() => void exportCabrillo()}><Download size={14}/>Export Cabrillo</button></header>{editing && <form className="contest-qso-editor" onSubmit={correct}><h2>Edit {editing.Call}</h2><div className="contest-qso-fields"><ContestTextField label="Callsign" value={editCall} onChange={event => setEditCall(event.target.value.toUpperCase())}/><ContestTextField label="Received CQ zone" value={editZone} onChange={event => setEditZone(event.target.value)}/></div><footer><button className="contest-danger" type="button" onClick={remove}>Delete</button><button type="button" onClick={() => setEditing(null)}>Cancel</button><button className="contest-primary" type="submit">Save correction</button></footer></form>}<ContestLogTable rows={logRows(rows)} disabled={busy || retiring} onEdit={beginEdit}/></section>;
  const bandMapPanel = <BandMaps spots={spots} radioFrequencyHz={radioFrequencyHz} compact onSelect={spot => void chooseSpot(spot)} selectionHint="Select a spot to load the active Not1MM draft and tune the selected xLog radio once."/>;
  const clusterPanel = <ClusterPanel passive snapshot={cluster} selectedSpotId={selectedSpotId ?? undefined} onRequest={serviceRequest} onSelect={spot => void chooseSpot(spot as BandMapSpot)}/>;

  return <main className="contest-workspace">
    <header className="contest-header"><div><h1>Contest Manager / Desk</h1><p>CQ WW CW · actual Not1MM Python plugin · xLog station services</p></div><div className="contest-header-actions">{projection && <button type="button" disabled={busy} onClick={() => setManager(value => !value)}>{manager ? "Back to desk" : "Select contest"}</button>}</div></header>
    {error && <p className="contest-alert is-error" role="alert">{error}<button type="button" onClick={() => setError("")}>Dismiss</button></p>}
    {notice && <p className="contest-alert" role="status">{notice}</p>}
    {manager ? <section className="contest-manager"><div className="contest-session-list"><h2>Python contest sessions</h2>{sessions.length ? sessions.map(session => <button type="button" key={session.sessionID} disabled={busy} onClick={() => void openSession(session)}><span><strong>{session.name}</strong><small>{session.pluginID} · revision {session.revision}</small></span></button>) : <p className="contest-empty">No Python contest sessions yet. Existing Swift sessions remain preserved in their legacy store.</p>}</div><form className="contest-create" onSubmit={createSession}><h2>New contest</h2><div className="contest-create-fields"><label>Contest<select disabled value="cq_ww_cw"><option value="cq_ww_cw">{catalog[0]?.name ?? "CQ WW CW"}</option></select></label><ContestTextField label="Session name" disabled={busy} value={create.name} onChange={event => setCreate({ ...create, name: event.target.value })}/><ContestTextField label="Station call" disabled value={stationCall}/><ContestTextField label="Sent CQ zone" disabled={busy} inputMode="numeric" value={create.cqZone} onChange={event => setCreate({ ...create, cqZone: event.target.value })}/></div><p className="contest-source">The new session is owned by upstream-compatible Python SQLite. Normal-log and legacy contest data are not modified.</p><button className="contest-primary" type="submit" disabled={busy || !stationCall.trim()}>Create and open</button></form></section> : projection ? <><section className="contest-snapshot" aria-label="Contest identity"><div><span>Station</span><strong>{stationCall}</strong></div><div><span>Engine</span><strong>Not1MM Python</strong></div><div><span>Plugin</span><strong>{projection.pluginID}</strong></div><div><span>Revision</span><strong>{projection.revision}</strong></div><div><span>Source</span><small>{projection.sourceRevision.slice(0, 12)} · {projection.referenceID}</small></div></section><ContestOperatorCanvas request={(method, params) => request(method, params)} canChangeLayout={() => !busy && !retiring && !editing} panels={{ "active-qso": { title: "Entry", content: entryPanel }, "callsign-intelligence": { title: "Check Partial", content: checkPanel }, propagation: { title: "Statistics", content: <>{scorePanel}{matrixPanel}</> }, logbook: { title: "Log", content: logPanel }, "band-maps": { title: "Bandmap", content: bandMapPanel }, "dx-cluster": { title: "Cluster", content: clusterPanel }, cw: { title: "CW", content: cwPanel() } }} traditional={<><div className="contest-operating-grid">{entryPanel}{scorePanel}</div>{checkPanel}{matrixPanel}<div className="contest-operating-grid">{bandMapPanel}{clusterPanel}</div>{logPanel}</>}/></> : <section className="contest-welcome"><h2>Open a CQ WW session</h2></section>}
  </main>;
}

export default Not1MMContestWorkspace;

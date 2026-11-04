import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ContestRequest } from "./types";
import type { StrategyMutation, StrategyScope } from "./ContestReminders";

type Row = { time: string; callsign: string; serial: string };
type Item = Row & { sourceQSOID?: string; status: "pending" | "confirmed"; repeats: string[] };
type Batch = { id: string; number: number; count: number; direction: "send" | "receive"; counterpart: string;
  timestamp: string; frequencyHz: number; status: string; items: Item[] };
export type QTCField = "header" | "all" | "time" | "callsign" | "serial" | "final";
export type QTCOutputIntent = { batchID: string; index: number; fields: QTCField };
export type QTCBookmarkIntent = { batchID: string; index?: number; event: "series_start" | "item" | "series_end" | "interruption" };
type PendingEdit = { batchID: string; index: number; row: Row; editID?: string };
type Workspace = { direction: "send" | "receive"; counterpart: string; number: number; timestamp: string; rows: Row[];
  selectedBatchID: string; selectedIndex: number; selectedField: "time" | "callsign" | "serial"; pendingEdit?: PendingEdit | null };
type Attempt = { batchID?: string; seriesID?: string; fields?: string; field?: string; outcome?: string | { outcome?: string; basis?: string; acceptanceLevel?: string } | null; status?: string; state?: string;
  providerOutcome?: string; operationID?: string; [key: string]: unknown };
type Review = { available: boolean; reason?: string; eligibility: string | null; ruleEdition: string; batches: Batch[];
  eligibleSources: Item[]; score: { qtcPoints: number; total: number }; output?: string;
  operating?: { schema: number; workspace?: Partial<Workspace>; attempts?: Attempt[];
    completedSeries?: Record<string, { operationID: string; completedUTC: string }>;
    observations?: Record<string, { status: "unknown" | "available" | "later" | "unavailable"; observedUTC: string; note?: string }> } };
type Props = { scope: StrategyScope & { frequencyHz: number }; request: ContestRequest; disabled: boolean;
  opportunityIntent?: { callsign: string; requestID: string };
  onMutate: StrategyMutation; onEntry(): void; onOutput?(intent: QTCOutputIntent): Promise<unknown>;
  onStop?(): Promise<unknown>; onBookmark?(intent: QTCBookmarkIntent): Promise<unknown>;
  onReview?(intent: { batchID: string; index?: number }): Promise<unknown> };
const blankRow = (): Row => ({ time: "", callsign: "", serial: "" });
const initialWorkspace = (): Workspace => ({ direction: "receive", counterpart: "", number: 1,
  timestamp: new Date().toISOString().slice(0, 19).replace("T", " "), rows: [blankRow()],
  selectedBatchID: "", selectedIndex: 0, selectedField: "time", pendingEdit: null });
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const attemptOutcome = (attempt: Attempt) => typeof attempt.outcome === "object" && attempt.outcome
  ? [attempt.outcome.outcome, attempt.outcome.basis].filter(Boolean).join(" · ")
  : attempt.providerOutcome ?? attempt.outcome ?? attempt.status ?? attempt.state ?? "unknown";

export function ContestQTC({ scope, request, disabled, opportunityIntent, onMutate, onEntry, onOutput, onStop, onBookmark, onReview }: Props) {
  const identity = scope.sessionID + "/" + scope.workspaceGeneration;
  const [data, setData] = useState<Review | null>(null), [workspace, setWorkspace] = useState(initialWorkspace);
  const [selected, setSelected] = useState<string[]>([]), [paste, setPaste] = useState("");
  const [editing, setEditing] = useState<PendingEdit | null>(null);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [working, setWorking] = useState(false);
  const [saved, setSaved] = useState(true), [pulse, setPulse] = useState(0), [dirty, setDirty] = useState(0);
  const [dismissedOpportunity, setDismissedOpportunity] = useState("");
  const ticket = useRef(0), hydrated = useRef(""), operation = useRef(false), liveIdentity = useRef(identity);
  const stopEpoch = useRef(0);
  const workspaceRef = useRef(workspace), dirtyRef = useRef(false), changeVersion = useRef(0);
  liveIdentity.current = identity; workspaceRef.current = workspace;
  useEffect(() => {
    liveIdentity.current = identity;
    setData(null); setWorkspace(initialWorkspace()); setSelected([]); setEditing(null); setError(""); setNotice("");
    setSaved(true); setDirty(0); hydrated.current = ""; dirtyRef.current = false; changeVersion.current = 0;
    return () => { if (liveIdentity.current === identity) liveIdentity.current = ""; };
  }, [identity]);
  useEffect(() => {
    const current = ++ticket.current;
    void request<Review>("contest_strategy", { sessionID: scope.sessionID, workspaceGeneration: scope.workspaceGeneration,
      expectedRevision: scope.revision, section: "qtc", counterpart: workspace.counterpart, direction: workspace.direction }).then(frame => {
      if (current !== ticket.current) return;
      if (!frame.ok) throw Error(frame.error.message);
      setData(frame.result);
      if (hydrated.current !== identity) {
        const restored = frame.result.operating?.workspace;
        if (restored && !dirtyRef.current) {
          setWorkspace(current => ({ ...current, ...restored,
            rows: restored.rows?.length ? restored.rows.map(row => ({ ...row })) : current.rows }));
          setEditing(restored.pendingEdit ?? null);
        }
        hydrated.current = identity;
      }
    }).catch(cause => { if (current === ticket.current) setError(message(cause)); });
    return () => { ticket.current++; };
  }, [identity, scope.revision, request, workspace.counterpart, workspace.direction, pulse]);
  function update(values: Partial<Workspace>) {
    dirtyRef.current = true; changeVersion.current++; setSaved(false); setDirty(value => value + 1);
    setWorkspace(current => ({ ...current, ...values }));
  }
  async function persist() {
    if (!dirtyRef.current) return;
    const at = identity, version = changeVersion.current, snapshot = structuredClone(workspaceRef.current);
    await onMutate("qtc_workspace", { workspace: snapshot });
    if (liveIdentity.current === at && changeVersion.current === version) { dirtyRef.current = false; setSaved(true); }
  }
  useEffect(() => {
    if (!dirty || !dirtyRef.current || disabled || operation.current || hydrated.current !== identity) return;
    const timer = window.setTimeout(() => {
      if (liveIdentity.current !== identity || operation.current) return;
      operation.current = true;
      void persist().then(() => { if (liveIdentity.current === identity) setPulse(value => value + 1); })
        .catch(cause => { if (liveIdentity.current === identity) setError("QTC editor was not saved: " + message(cause)); })
        .finally(() => { operation.current = false; });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [dirty, disabled, identity, workspace, pulse]);

  const locked = disabled || working;
  async function run(work: () => Promise<unknown>, success = "") {
    if (disabled || operation.current) return false;
    const at = identity, epoch = stopEpoch.current; operation.current = true; setWorking(true); setError(""); setNotice("");
    try {
      await work();
      if (liveIdentity.current === at) { setPulse(value => value + 1); if (stopEpoch.current === epoch) setNotice(success); }
      return liveIdentity.current === at;
    } catch (cause) { if (liveIdentity.current === at) setError(message(cause)); return false; }
    finally { operation.current = false; if (liveIdentity.current === at) setWorking(false); }
  }
  const mutate = (action: string, values: Record<string, unknown>) => run(() => onMutate(action, values));
  const batch = data?.batches.find(item => item.id === workspace.selectedBatchID);
  const index = batch ? Math.max(0, Math.min(workspace.selectedIndex, batch.items.length - 1)) : 0;
  const currentItem = batch?.items[index];
  function choose(batchID: string, selectedIndex = 0) { update({ selectedBatchID: batchID, selectedIndex }); }
  function openCorrection(target: Batch, rowIndex: number) {
    const retained = workspace.pendingEdit;
    if (retained && (retained.batchID !== target.id || retained.index !== rowIndex)) {
      setError("Finish or explicitly discard the retained pending correction before editing another item."); return;
    }
    const row = target.items[rowIndex];
    const pendingEdit = retained ? { ...retained, editID: retained.editID ?? crypto.randomUUID() }
      : { batchID: target.id, index: rowIndex, editID: crypto.randomUUID(), row: { time: row.time, callsign: row.callsign, serial: row.serial } };
    setEditing(pendingEdit); update({ pendingEdit });
  }
  function navigate(offset: number) {
    if (batch) update({ selectedIndex: Math.max(0, Math.min(batch.items.length - 1, index + offset)) });
  }
  async function output(fields: QTCField, target = batch, rowIndex = index) {
    if (!target || !onOutput) return;
    await run(() => onOutput({ batchID: target.id, index: rowIndex, fields }),
      "Output attempt recorded. Review the provider outcome; counterparty acknowledgment is separate.");
  }
  async function acknowledge(target = batch, rowIndex = index, next = false) {
    if (!target || target.status !== "open" || target.items[rowIndex]?.status !== "pending") return;
    if (workspace.pendingEdit?.batchID === target.id && workspace.pendingEdit.index === rowIndex) {
      setError("Save or explicitly discard the retained correction before acknowledging this item."); return;
    }
    const accepted = await run(() => onMutate("qtc_confirm", { batchID: target.id, index: rowIndex }), "Operator acknowledgment recorded.");
    if (accepted && next) update({ selectedIndex: Math.min(target.items.length - 1, rowIndex + 1) });
  }
  async function create() {
    const items = workspace.direction === "send" ? selected.map(sourceQSOID => ({ sourceQSOID })) : workspace.rows.map(row => ({
      time: row.time.trim(), callsign: row.callsign.trim().toUpperCase(), serial: row.serial.trim() }));
    if (workspace.direction === "receive" && items.some(row => !("time" in row) || !row.time || !row.callsign || !row.serial)) {
      setError("Complete time, callsign and serial in each row before creating the pending series. Unfinished editor rows can be saved."); return;
    }
    const batchID = crypto.randomUUID();
    const accepted = await run(async () => {
      await persist();
      if (liveIdentity.current !== identity) throw Error("QTC workspace changed before series creation; retained editor was not applied to another session.");
      await onMutate("qtc_create", { batchID, number: workspace.number, direction: workspace.direction, counterpart: workspace.counterpart,
        items, timestamp: workspace.timestamp, frequencyHz: scope.frequencyHz });
    });
    if (accepted) choose(batchID);
  }
  function pasteRows() {
    const lines = paste.trim().split(/\n/);
    if (!paste.trim() || lines.length > 10) { setError("Paste one to ten HHMM CALL SERIAL rows."); return; }
    const rows: Row[] = [];
    for (const line of lines) {
      const [time, callsign, serial, ...extra] = line.trim().toUpperCase().split(/\s+/);
      if (!time || !callsign || !serial || extra.length) { setError("Enter one HHMM CALL SERIAL per line."); return; }
      rows.push({ time, callsign, serial });
    }
    update({ rows }); setError("");
  }
  function keydown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      if (onStop) { event.preventDefault(); event.stopPropagation(); void stop(); } return;
    }
    if (event.metaKey) return;
    event.stopPropagation(); // Ordinary Entry ESM/F-keys cannot consume desk input.
    if (event.key === "Enter" && !event.altKey && event.target instanceof HTMLInputElement) event.preventDefault();
    if (!event.altKey || locked) return;
    const commands: Record<string, () => void> = {
      ArrowDown: () => navigate(1), ArrowUp: () => navigate(-1), Enter: () => { void acknowledge(batch, index, true); },
      h: () => { void output("header"); }, r: () => { void output("all"); },
      t: () => { void output("time"); }, c: () => { void output("callsign"); }, s: () => { void output("serial"); },
    };
    const command = commands[event.key] ?? commands[event.key.toLowerCase()];
    if (command) { event.preventDefault(); command(); }
  }
  async function stop() {
    if (!onStop) return;
    stopEpoch.current++;
    // Stop bypasses editor persistence and ordinary busy admission.
    try { await onStop(); setNotice("Stop requested. Draft and QTC edits retained; review the owner release outcome."); }
    catch (cause) { setError("Stop outcome unresolved: " + message(cause)); }
  }
  const attempts = data?.operating?.attempts ?? [];
  const observation = data?.operating?.observations?.[workspace.counterpart];
  const rowEditor = (row: Row, rowIndex: number, change: (field: keyof Row, value: string) => void, prefix = "QTC") => <>
    {(["time", "callsign", "serial"] as const).map(field => <label key={field}>{field}
      <input aria-label={prefix + " row " + (rowIndex + 1) + " " + field} maxLength={field === "callsign" ? 32 : field === "time" ? 4 : 9}
        value={row[field]} disabled={locked} onFocus={() => update({ selectedField: field })} onChange={event => change(field, event.target.value.toUpperCase())}/>
    </label>)}
  </>;
  return <section className="contest-productivity-section" aria-label="WAE QTC desk" onKeyDown={keydown}>
    <h2>WAE QTC desk</h2>
    <p>Output submission, provider outcome, operator acknowledgment and confirmed accounting are separate. Ordinary Entry is retained.</p>
    {opportunityIntent && opportunityIntent.requestID !== dismissedOpportunity && <aside aria-label="QTC map counterpart review">
      <p>Map counterpart {opportunityIntent.callsign}</p>
      <button disabled={locked} onClick={() => { update({ counterpart: opportunityIntent.callsign }); setSelected([]);
        setDismissedOpportunity(opportunityIntent.requestID); }}>Use QTC counterpart {opportunityIntent.callsign}</button>
      <button disabled={locked} onClick={() => setDismissedOpportunity(opportunityIntent.requestID)}>Dismiss map counterpart</button>
    </aside>}
    <button type="button" onClick={() => { void run(async () => { await persist(); onEntry(); }); }}>Return to Entry</button>
    {onStop && <button type="button" onClick={() => void stop()}>Stop QTC output</button>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {data && !data.available ? <p>{data.reason}</p> : <>
      <p>{data?.ruleEdition} · {data?.score.qtcPoints ?? 0} confirmed QTC points · shared score {data?.score.total ?? 0}</p>
      <p>{data?.output ?? (onOutput ? "Review the current lane and native provider before output." : "Manual operation: no native output callback is available.")}</p>
      <form onSubmit={event => { event.preventDefault(); void create(); }}>
        <div className="contest-productivity-actions">
          <label>QTC direction<select aria-label="QTC direction" disabled={locked} value={workspace.direction} onChange={event => { update({ direction: event.target.value as "send" | "receive" }); setSelected([]); }}>
            <option value="receive">Receive</option><option value="send">Send</option></select></label>
          <label>QTC counterpart<input aria-label="QTC counterpart" disabled={locked} maxLength={32} value={workspace.counterpart} onChange={event => { update({ counterpart: event.target.value.toUpperCase() }); setSelected([]); }}/></label>
          <label>Series number<input aria-label="QTC series number" disabled={locked} type="number" min={1} max={99999} value={workspace.number} onChange={event => update({ number: Number(event.target.value) })}/></label>
          <label>Transfer UTC<input aria-label="QTC transfer UTC" disabled={locked} value={workspace.timestamp} onChange={event => update({ timestamp: event.target.value })}/></label>
        </div>
        <p>{data?.eligibility ?? ("Transfer frequency: " + scope.frequencyHz + " Hz. A QSO dupe may still offer an eligible QTC opportunity.")}</p>
        {workspace.direction === "receive" ? <>
          <fieldset disabled={locked}><legend>Receive rows · unfinished edits are separate from accounting</legend>
            {workspace.rows.map((row, rowIndex) => <div className="contest-productivity-actions" key={rowIndex}>
              <strong>Row {rowIndex + 1}</strong>{rowEditor(row, rowIndex, (field, value) => update({ rows: workspace.rows.map((item, i) => i === rowIndex ? { ...item, [field]: value } : item) }))}
              <button type="button" disabled={locked || workspace.rows.length === 1} onClick={() => update({ rows: workspace.rows.filter((_, i) => i !== rowIndex) })}>Remove row {rowIndex + 1}</button>
            </div>)}
            <button type="button" disabled={locked || workspace.rows.length >= 10} onClick={() => update({ rows: [...workspace.rows, blankRow()] })}>Add receive row</button>
          </fieldset>
          <details><summary>Optional bulk paste</summary><label>Received items (HHMM CALL SERIAL, one per line)
            <textarea aria-label="Received QTC items" disabled={locked} maxLength={1500} rows={4} value={paste} onChange={event => setPaste(event.target.value)}/></label>
            <button type="button" disabled={locked} onClick={pasteRows}>Use pasted rows</button></details>
        </> : <fieldset disabled={locked}><legend>Eligible unsent source contacts</legend>
          {data?.eligibleSources.map(item => <label key={item.sourceQSOID}><input type="checkbox" checked={selected.includes(item.sourceQSOID!)} onChange={event => setSelected(ids => event.target.checked ? [...ids, item.sourceQSOID!] : ids.filter(id => id !== item.sourceQSOID))}/>{item.time} {item.callsign} {item.serial}</label>)}
        </fieldset>}
        <button type="button" disabled={locked || saved} onClick={() => void run(persist, "Unfinished QTC editor saved without confirming items.")}>Save unfinished QTC editor</button>
        <span role="status">{saved ? "Editor saved" : "Editor has unsaved changes"}</span>
        <button disabled={locked || !!data?.eligibility || !data?.available} type="submit">Create pending QTC series</button>
      </form>
      <label>Local counterpart opportunity<select aria-label="Local QTC opportunity" disabled={locked || !workspace.counterpart} value={observation?.status ?? "unknown"} onChange={event => void mutate("qtc_observe", {
        counterpart: workspace.counterpart, status: event.target.value, note: "", observedUTC: new Date().toISOString() })}>
        <option value="unknown">Unknown</option><option value="available">Available</option><option value="later">Later</option><option value="unavailable">Unavailable / refused</option>
      </select></label>{observation && <p>Observed {observation.observedUTC}. This local observation does not reserve or confirm QTCs.</p>}
      {batch && <section aria-label="Current QTC item"><h3>Operating {batch.direction} {batch.number}/{batch.count} · {batch.counterpart} · item {index + 1}</h3>
        <p>{currentItem?.time} {currentItem?.callsign} {currentItem?.serial} · {currentItem?.status}</p>
        <div className="contest-productivity-actions">
          <button disabled={locked || index === 0} onClick={() => navigate(-1)}>Previous QTC item</button>
          <button disabled={locked || index + 1 >= batch.items.length} onClick={() => navigate(1)}>Next QTC item</button>
          <button disabled={locked || currentItem?.status !== "pending" || batch.status !== "open"} onClick={() => void acknowledge(batch, index, true)}>Acknowledge and next</button>
          {(["header", "all", "time", "callsign", "serial", "final"] as const).map(fields => <button key={fields} disabled={locked || !onOutput || batch.status !== "open"} onClick={() => void output(fields)}>
            {fields === "final" ? "Send final QSL" : batch.direction === "receive" && fields !== "header" ? "Request repeat " + fields : "Send " + fields}</button>)}
        </div>
        <p>Desk keys: Alt+↑/↓ item, Alt+Enter acknowledge and next, Alt+H header, Alt+R row, Alt+T/C/S field repeat. Escape requests Stop when the native owner is available.</p>
        {onBookmark && <div className="contest-productivity-actions">{(["series_start", "item", "series_end", "interruption"] as const).map(event => <button key={event} disabled={locked} onClick={() => void run(() => onBookmark({ batchID: batch.id, index: event === "item" ? index : undefined, event }))}>Bookmark {event.replaceAll("_", " ")}</button>)}</div>}
        {onReview && <button disabled={locked} onClick={() => void run(() => onReview({ batchID: batch.id, index }))}>Review captured QTC audio</button>}
        <p>Bookmarks require an existing captured timeline; they never start recording. Missing audio does not block QTC entry.</p>
      </section>}
      {!editing && workspace.pendingEdit && <button disabled={locked} onClick={() => setEditing(workspace.pendingEdit ?? null)}>Continue pending correction</button>}
      {editing && <form onSubmit={event => { event.preventDefault(); void run(() => onMutate("qtc_item", { batchID: editing.batchID, index: editing.index, item: editing.row, editID: editing.editID })).then(accepted => {
        if (accepted) { setEditing(null); update({ pendingEdit: null }); }
      }); }}>
        <h3>Correct pending received item {editing.index + 1}</h3>
        <div className="contest-productivity-actions">{rowEditor(editing.row, editing.index, (field, value) => {
          const pendingEdit = { ...editing, row: { ...editing.row, [field]: value } }; setEditing(pendingEdit); update({ pendingEdit });
        }, "Pending QTC")}</div>
        <button disabled={locked}>Save pending item correction</button><button type="button" disabled={locked} onClick={() => setEditing(null)}>Close item editor</button>
        <button type="button" disabled={locked} onClick={() => { setEditing(null); update({ pendingEdit: null }); }}>Discard pending correction</button>
      </form>}
      <div aria-label="Saved QTC series">{data?.batches.map(item => <section key={item.id}><h3>{item.direction} {item.number}/{item.count} · {item.counterpart} · {item.status}</h3>
        <p>{item.timestamp} UTC · {item.frequencyHz} Hz</p><button disabled={locked} onClick={() => choose(item.id)}>Operate series {item.number}</button>
        <ol>{item.items.map((row, rowIndex) => <li key={rowIndex}>
          <strong>{row.time} {row.callsign} {row.serial}</strong> · {row.status} · {row.repeats.length} repeat requests
          <div className="contest-productivity-actions"><button disabled={locked || item.status !== "open" || row.status === "confirmed"} onClick={() => void acknowledge(item, rowIndex)}>Acknowledge item {rowIndex + 1}</button>
            <button disabled={locked} onClick={() => choose(item.id, rowIndex)}>Select item {rowIndex + 1}</button>
            {item.direction === "receive" && item.status === "open" && row.status === "pending" && <button disabled={locked} onClick={() => openCorrection(item, rowIndex)}>Correct pending item {rowIndex + 1}</button>}
            {(["all", "time", "callsign", "serial", "header"] as const).map(fields => <button key={fields} disabled={locked || !onOutput || item.status !== "open"} onClick={() => void output(fields, item, rowIndex)}>Repeat {fields} {rowIndex + 1}</button>)}
          </div></li>)}</ol>
        <button disabled={locked} onClick={() => void mutate(item.status === "open" ? "qtc_cancel" : "qtc_resume", { batchID: item.id })}>{item.status === "open" ? "Interrupt series" : "Resume same series"}</button>
        {data.operating?.completedSeries?.[item.id]
          ? <p>Series completion recorded {data.operating.completedSeries[item.id].completedUTC}; final QSL output remains separate.</p>
          : <button disabled={locked || item.status !== "open" || item.items.some(row => row.status !== "confirmed")}
            onClick={() => void mutate("qtc_complete", { batchID: item.id })}>Complete acknowledged series {item.number}</button>}
        {!item.items.some(row => row.status === "confirmed") && <button disabled={locked} onClick={() => void mutate("qtc_header", { batchID: item.id, number: workspace.number })}>Use reviewed series number</button>}
      </section>)}</div>
      <section aria-label="QTC output attempts"><h3>Output attempts</h3>{!attempts.length && <p>No output history recorded; old series have unknown prior delivery.</p>}
        <ol>{attempts.slice(-30).map((attempt, attemptIndex) => <li key={attempt.operationID ?? attemptIndex}>{attempt.batchID ?? attempt.seriesID} · {attempt.fields ?? attempt.field ?? "message"} · {attemptOutcome(attempt)}</li>)}</ol>
      </section>
    </>}
  </section>;
}

import { useEffect, useRef, useState } from "react";

type Request = (method: string, params?: Record<string, unknown>) => Promise<any>;
type Change = { field: string; retained: string | null; proposed: string | null; retainedOrigin: string; reason: string };
type Row = { contactID: string; revision: number; call: string; start: string; changes: Change[]; dependentConflict?: string | null;
  facts: { status: string; referenceRevision: string; matchedRule?: string | null } };
type Page = { rows: Row[]; comparedCount: number; affectedCount: number; unresolvedCount: number; offset: number; limit: number; referenceRevision: string };
type Review = { reviewID: string; generation: string; referenceRevision: string; rows: Row[] };
const fields = new Set(["dxcc", "country", "continent", "cqZone", "ituZone", "state", "county"]);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const result = (value: any) => value?.result ?? value;
function validRow(row: Row) {
  return row && uuid.test(row.contactID) && Number.isSafeInteger(row.revision) && row.revision >= 0 &&
    typeof row.call === "string" && typeof row.start === "string" && Number.isFinite(Date.parse(row.start)) &&
    Array.isArray(row.changes) && row.changes.length <= 7 && row.changes.every(change => change && fields.has(change.field) &&
      (change.retained === null || typeof change.retained === "string") && (change.proposed === null || typeof change.proposed === "string") &&
      typeof change.reason === "string" && typeof change.retainedOrigin === "string") &&
    typeof row.facts?.referenceRevision === "string" && typeof row.facts.status === "string";
}

/** Explicit country-only review. No field is preselected and no native mutation
 * is formed until a current native review token and field selection both exist. */
export function CountryCorrectionReview({ onRequest, refreshKey, queryContext = {}, onChanged }: {
  onRequest: Request; refreshKey: number; queryContext?: Record<string, unknown>; onChanged?: () => void;
}) {
  const [page, setPage] = useState<Page | null>(null), [generation, setGeneration] = useState("");
  const [selected, setSelected] = useState<string[]>([]), [review, setReview] = useState<Review | null>(null);
  const [choices, setChoices] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [receipts, setReceipts] = useState<{ operationID: string; call: string; generation: string }[]>([]);
  const [message, setMessage] = useState("");
  const [scan, setScan] = useState<{ generation: string; scanID: string } | null>(null);
  const scanScope = useRef<{ generation: string; scanID: string } | null>(null);
  const sequence = useRef(0), pending = useRef(false), undoIDs = useRef<Record<string, string>>({});
  const scopeKey = JSON.stringify(queryContext);
  useEffect(() => {
    const retiredScan = scanScope.current;
    if (retiredScan) void onRequest("logbook_country_review_cancel", retiredScan).catch(() => {});
    scanScope.current = null; setScan(null); pending.current = false; setBusy(false);
    sequence.current++; setPage(null); setReview(null); setSelected([]); setChoices({}); setGeneration("");
  }, [onRequest, refreshKey, scopeKey]);
  useEffect(() => () => {
    sequence.current++;
    const retiredScan = scanScope.current;
    if (retiredScan) void onRequest("logbook_country_review_cancel", retiredScan).catch(() => {});
  }, [onRequest]);
  async function read(offset = 0) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setReview(null); setChoices({}); setSelected([]);
    const ticket = ++sequence.current;
    try {
      const workspace = result(await onRequest("workspace_status"));
      if (!uuid.test(workspace?.generation)) throw new Error("Open a local logbook before reviewing countries.");
      const scope = { generation: workspace.generation, scanID: crypto.randomUUID() };
      scanScope.current = scope; setScan(scope);
      const response = result(await onRequest("logbook_country_review", { ...queryContext, ...scope, limit: 20, offset }));
      if (ticket !== sequence.current) return;
      const next: Page = response?.page;
      if (response?.read_only !== true || response?.generation !== workspace.generation || !next ||
          !Array.isArray(next.rows) || next.rows.length > 20 || !next.rows.every(validRow) ||
          ![next.comparedCount, next.affectedCount, next.unresolvedCount, next.offset, next.limit].every(Number.isSafeInteger))
        throw new Error("The country review could not be verified. Refresh it before selecting contacts.");
      setGeneration(workspace.generation); setPage(next); setMessage("");
    } catch (cause) { if (ticket === sequence.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (ticket === sequence.current) { scanScope.current = null; setScan(null); pending.current = false; setBusy(false); } }
  }
  async function cancelScan() {
    const scope = scanScope.current;
    if (!scope) return;
    sequence.current++; scanScope.current = null; setScan(null); pending.current = false; setBusy(false);
    try {
      await onRequest("logbook_country_review_cancel", scope);
      setMessage("Country scan cancelled. No contacts changed.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  async function preview() {
    if (!page || !generation || !selected.length || pending.current) return;
    pending.current = true; setBusy(true); setError(""); const ticket = ++sequence.current;
    try {
      const contacts = page.rows.filter(row => selected.includes(row.contactID)).map(row => ({ contactID: row.contactID, expectedRevision: row.revision }));
      const response = result(await onRequest("logbook_country_correction_preview", { generation, contacts }));
      if (ticket !== sequence.current) return;
      if (response?.read_only !== true || response?.generation !== generation || !uuid.test(response.reviewID) ||
          !Array.isArray(response.rows) || response.rows.length !== contacts.length || !response.rows.every(validRow) ||
          response.referenceRevision !== page.referenceRevision || response.rows.some((row: Row) =>
            !contacts.some(contact => contact.contactID === row.contactID && contact.expectedRevision === row.revision)))
        throw new Error("The contact or country evidence changed. Refresh this review.");
      setReview(response); setChoices({});
    } catch (cause) { if (ticket === sequence.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; setBusy(false); }
  }
  const selection = review?.rows.flatMap(row => (choices[row.contactID]?.length ? [{ contactID: row.contactID, fields: [...choices[row.contactID]].sort() }] : [])) ?? [];
  async function apply() {
    if (!review || !selection.length || pending.current) return;
    pending.current = true; setBusy(true); setError(""); const ticket = ++sequence.current;
    try {
      const response = result(await onRequest("logbook_country_correction_apply", { generation: review.generation, reviewID: review.reviewID, selection }));
      if (ticket !== sequence.current) return;
      if (response?.status !== "applied" || response?.generation !== review.generation || !Array.isArray(response.receipts))
        throw new Error("Apply outcome is unconfirmed. Retry the same selection to retrieve its receipt.");
      setReceipts(response.receipts.map((receipt: any) => {
        if (!uuid.test(receipt?.mutation?.operationID) || typeof receipt?.contact?.qso?.call !== "string") throw new Error("Correction receipt is incomplete.");
        return { operationID: receipt.mutation.operationID, call: receipt.contact.qso.call, generation: review.generation };
      }));
      setReview(null); setChoices({}); setSelected([]); setPage(null);
      setMessage(`${response.receipts.length} contact(s) corrected. Callsigns, times, confirmations and own-station context retained.`);
      onChanged?.();
    } catch (cause) { if (ticket === sequence.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; setBusy(false); }
  }
  async function undo(operationID: string, receiptGeneration: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    const undoOperationID = undoIDs.current[operationID] ??= crypto.randomUUID();
    try {
      const response = result(await onRequest("logbook_country_correction_undo", { generation: receiptGeneration, operationID, undoOperationID }));
      if (response?.status !== "applied") throw new Error("Recovery could not be confirmed.");
      setReceipts(items => items.filter(item => item.operationID !== operationID)); setMessage("Country correction recovered through a revision-checked edit."); onChanged?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; setBusy(false); }
  }
  async function cancel() {
    if (!review || pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const response = result(await onRequest("logbook_country_correction_cancel", { generation: review.generation, reviewID: review.reviewID }));
      if (response?.generation !== review.generation || !["cancelled", "already_applied"].includes(response?.status)) throw new Error("Review cancellation could not be confirmed.");
      if (response.status === "already_applied") {
        setMessage("The original apply completed. Its retained receipts are available; cancellation performed no further edits.");
        setReceipts((response.receipts ?? []).map((receipt: any) => ({ operationID: receipt.mutation.operationID, call: receipt.contact.qso.call, generation: review.generation })));
        onChanged?.();
      } else setMessage("Recorded country fields retained. No contacts changed.");
      setReview(null); setChoices({}); setSelected([]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section aria-label="Selected country field corrections" aria-busy={busy}>
    <h3>Review country fields</h3>
    <p>Compare the complete current Logbook selection against one country snapshot at each QSO date. Recorded values, including manual or unknown-origin imports, stay protected until you select specific changes.</p>
    <button type="button" disabled={busy || !!review} onClick={() => void read()}>Read country field differences</button>
    {scan && <button type="button" onClick={() => void cancelScan()}>Cancel country scan</button>}
    {busy && <p role="status">Checking local country evidence…</p>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {page && <>
      <p>{page.comparedCount.toLocaleString()} contacts compared · {page.affectedCount.toLocaleString()} requiring review · {page.unresolvedCount.toLocaleString()} unresolved. Nothing is selected automatically.</p>
      <div className="cty-correction-table" role="region" aria-label="Country field differences" tabIndex={0}><table>
        <thead><tr><th>Select for review</th><th>Call / QSO UTC</th><th>Recorded → proposed</th></tr></thead>
        <tbody>{page.rows.map(row => <tr key={row.contactID}><td><input type="checkbox" aria-label={`Review ${row.call} ${row.contactID}`} disabled={busy || !!review || !row.changes.length} checked={selected.includes(row.contactID)}
          onChange={event => setSelected(items => event.target.checked ? [...items, row.contactID] : items.filter(id => id !== row.contactID))} /></td>
          <td>{row.call}<br />{row.start}</td><td>{row.changes.map(change => <div key={change.field}>{change.field}: {change.retained || "Not recorded"} → {change.proposed || "Clear after explicit decision"}</div>)}
            {!row.changes.length && <p>Country result: {row.facts.status}. No supported replacement is proposed.</p>}
            {row.dependentConflict && <p>{row.dependentConflict}</p>}</td></tr>)}</tbody>
      </table></div>
      <button type="button" disabled={busy || !selected.length || !!review} onClick={() => void preview()}>Review selected contacts</button>
      <nav aria-label="Country correction pages"><button type="button" disabled={busy || !!review || page.offset === 0} onClick={() => void read(Math.max(0, page.offset - 20))}>Previous country page</button>
        <button type="button" disabled={busy || !!review || page.offset + 20 >= page.affectedCount} onClick={() => void read(page.offset + 20)}>Next country page</button></nav>
    </>}
    {review && <section aria-label="Explicit country change selection"><h4>Choose individual changes</h4>
      <p>Every retained field has protected or unknown origin. Selecting a proposal is your explicit decision to replace that field. A DXCC change also requires decisions on its listed subdivisions.</p>
      {review.rows.map(row => <fieldset key={row.contactID} disabled={busy}><legend>{row.call} · {row.start}</legend>
        {row.changes.map(change => <label key={change.field} style={{ display: "block" }}><input type="checkbox" checked={choices[row.contactID]?.includes(change.field) ?? false}
          onChange={event => setChoices(items => ({ ...items, [row.contactID]: event.target.checked ? [...(items[row.contactID] ?? []), change.field] : (items[row.contactID] ?? []).filter(field => field !== change.field) }))} />
          {change.field}: {change.retained || "Not recorded"} → {change.proposed || "Clear"}<small> · {change.reason}</small></label>)}
        {row.dependentConflict && <p role="status">{row.dependentConflict}</p>}
      </fieldset>)}
      <button type="button" disabled={busy || !selection.length} onClick={() => void apply()}>Apply selected country changes</button>
      <button type="button" disabled={busy} onClick={() => void cancel()}>Keep recorded values</button>
      <button type="button" disabled={busy} onClick={() => void cancel()}>Cancel country review</button>
    </section>}
    {!!receipts.length && <section aria-label="Country correction recovery"><h4>Applied correction receipts</h4><p>Recovery is available only while that contact has not changed again. Receipts and before-values also survive backup/restore.</p>
      {receipts.map(receipt => <p key={receipt.operationID}>{receipt.call} <button type="button" disabled={busy} onClick={() => void undo(receipt.operationID, receipt.generation)}>Recover country correction</button></p>)}
    </section>}
  </section>;
}

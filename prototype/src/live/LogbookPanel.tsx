import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { Download, FileUp, Pencil, RotateCcw, Search, Trash2, Triangle, ExternalLink, PanelsTopLeft } from "lucide-react";
import "./logbook.css";
import type { LogbookMutationSession } from "./logbookMutationSession";
import type { DraftSnapshot } from "./operatorDraftSession";
import { useLogbookCapacity } from "./logbookCapacity";
import { LogbookColumnHeader, LogbookColumns, useLogbookColumns } from "./LogbookColumns";
import { logbookColumns, type LogbookColumn } from "./logbookColumnPreferences";

type QSO = Record<string, unknown> & {
  id: string;
  call: string;
  start: string;
  band: string;
  mode: string;
  submode?: string;
  frequencyHz?: number | null;
  rstSent?: string;
  rstReceived?: string;
  name?: string;
  country?: string;
  comment?: string;
  qslSent?: string;
  qslReceived?: string;
  lotwSent?: string;
  lotwReceived?: string;
  extraFields?: Record<string, string>;
  isDirty?: boolean;
};

type LogbookPage = { qsos: QSO[]; total: number; offset: number; limit: number };
type Request = (method: string, params?: Record<string, unknown>) => Promise<any>;
// Keep worker responses and ADIF export frames bounded independently of the UI page.
const requestPageSize = 20;
const maxADIFBytes = 14_000;
const utf8 = new TextEncoder();

function result<T>(response: any): T {
  return (response && typeof response === "object" && "result" in response
    ? response.result
    : response) as T;
}

// Construct once, not for every row on every selection/poll-driven render.
const utcDateTime = new Intl.DateTimeFormat("en-GB", {
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false,
});

export function utcTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : utcDateTime.format(date);
}

type ConfirmationTone = "confirmed" | "rejected" | "pending" | "unrecorded";
export function confirmationTone(value: string | undefined): ConfirmationTone {
  switch (value?.trim().toUpperCase()) {
    case "Y": case "V": return "confirmed";
    case "N": return "rejected";
    case "R": case "Q": case "I": case "M": return "pending";
    default: return "unrecorded";
  }
}

function ConfirmationStatus({ service, sent, received, supportsReceived = true }: {
  service: string; sent?: string; received?: string; supportsReceived?: boolean;
}) {
  const sentText = sent?.trim() || "not recorded";
  const receivedText = received?.trim() || "not recorded";
  const description = supportsReceived
    ? `${service} sent ${sentText}, received ${receivedText}`
    : `${service} upload ${sentText}`;
  return <span className="live-logbook-confirmation" role="img" aria-label={description} title={description}>
    <Triangle aria-hidden="true" className={`is-${confirmationTone(sent)}`} size={10} fill="currentColor" strokeWidth={0} />
    <Triangle aria-hidden="true" className={`is-down ${supportsReceived ? `is-${confirmationTone(received)}` : "is-unavailable"}`} size={10} fill="currentColor" strokeWidth={0} />
  </span>;
}

function adifBatches(text: string): string[] {
  const endOfRecord = /<eor\s*>/gi;
  const batches: string[] = [];
  let previous = 0;
  let batch = "";
  let count = 0;
  for (const match of text.matchAll(endOfRecord)) {
    const record = text.slice(previous, match.index! + match[0].length);
    previous = match.index! + match[0].length;
    if (utf8.encode(record).byteLength > maxADIFBytes) {
      throw new Error("An ADIF record exceeds the safe import size. Nothing after that record was imported.");
    }
    if (count >= 100 || utf8.encode(batch + record).byteLength > maxADIFBytes) {
      batches.push(batch);
      batch = "";
      count = 0;
    }
    batch += record;
    count++;
  }
  if (text.slice(previous).trim()) {
    throw new Error("ADIF ends with an incomplete record. Choose a complete export.");
  }
  if (batch) batches.push(batch);
  return batches;
}

export function LogbookPanel({ onRequest, onEdit, refreshKey, mutations, onChanged, onUndock, onDock, onBusyChange, disabled = false }: {
  onRequest: Request;
  onEdit: (qso: QSO) => void;
  refreshKey: number;
  mutations: LogbookMutationSession;
  onChanged?: () => void;
  onUndock?: () => void; onDock?: () => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<LogbookPage | null>(null);
  const tableArea = useRef<HTMLDivElement>(null);
  const pageSize = useLogbookCapacity(tableArea, page?.qsos.length ?? 0);
  const [details, setDetails] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const columnsID = useId();
  const columnsButton = useRef<HTMLButtonElement>(null);
  const [columnPreferences, setColumnPreferences] = useLogbookColumns(onDock ? "detached" : "docked");
  const visibleColumns = logbookColumns.filter(([id]) => columnPreferences.columns.includes(id));
  const totalColumnWidth = visibleColumns.reduce((total, [id]) => total + columnPreferences.widths[id], 0);
  const hidden = (id: LogbookColumn) => !columnPreferences.columns.includes(id);
  function resizeColumn(id: LogbookColumn, width: number) {
    setColumnPreferences(current => ({ ...current, widths: { ...current.widths, [id]: width } }));
  }
  const [loading, setLoading] = useState(false);
  const [working, setBusy] = useState(false);
  const mutation = useSyncExternalStore(mutations.subscribe, mutations.getSnapshot);
  const busy = disabled || working || mutation.busy || !!mutation.pending || mutation.conflict || mutation.workspaceChanged;
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<DraftSnapshot | null>(null);
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const previousCapacity = useRef(pageSize);
  useLayoutEffect(() => {
    if (previousCapacity.current === pageSize) return;
    previousCapacity.current = pageSize;
    const index = page?.qsos.findIndex(qso => qso.id === selectedID) ?? -1;
    // Details consumes table height. Re-anchor before the capacity fetch so a
    // selected lower row is not dropped by the now-smaller page.
    if (index >= 0) setOffset(current => Math.floor((current + index) / pageSize) * pageSize);
  }, [pageSize, page, selectedID]);
  const preparation = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  function cancelDelete() { preparation.current++; setConfirmDelete(null); }
  useEffect(() => {
    // Changing the selected identity or query cancels consent. A passive table
    // refresh (including window focus) does not. Delete always submits the
    // original reviewed revision/generation, so an intervening edit conflicts
    // rather than silently upgrading consent to a different contact version.
    cancelDelete();
    return () => { preparation.current++; };
  }, [onRequest, search, selectedID]);

  async function readPage(pageOffset: number, pageSearch: string) {
    const first = result<LogbookPage>(await onRequest("logbook_list", { search: pageSearch, offset: pageOffset, limit: Math.min(requestPageSize, pageSize) }));
    const remainingOffsets: number[] = [];
    for (let next = pageOffset + requestPageSize; next < Math.min(first.total, pageOffset + pageSize); next += requestPageSize) remainingOffsets.push(next);
    const rest = await Promise.all(remainingOffsets.map(async next => result<LogbookPage>(
      await onRequest("logbook_list", { search: pageSearch, offset: next, limit: Math.min(requestPageSize, pageOffset + pageSize - next) }),
    )));
    const unique = new Map<string, QSO>();
    for (const qso of [first, ...rest].flatMap(chunk => chunk.qsos)) unique.set(qso.id, qso);
    return { ...first, qsos: [...unique.values()], offset: pageOffset, limit: pageSize };
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    readPage(offset, search)
      .then((response) => {
        if (!cancelled) {
          if (offset > 0 && offset >= response.total) setOffset(Math.max(0, Math.floor((response.total - 1) / pageSize) * pageSize));
          else {
            setPage(result<LogbookPage>(response));
            setSelectedID(current => response.qsos.some(qso => qso.id === current) ? current : null);
          }
        }
      })
      .catch((cause) => {
        if (!cancelled) { setPage(null); setError(cause instanceof Error ? cause.message : String(cause)); }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [onRequest, search, offset, refreshKey, pageSize]);

  async function reload(pageOffset = offset) {
    const response = await readPage(pageOffset, search);
    if (response.total > 0 && pageOffset >= response.total) {
      setOffset(Math.floor((response.total - 1) / pageSize) * pageSize);
    } else if (!response.total && pageOffset > 0) setOffset(0);
    else setPage(response);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    cancelDelete();
    setOffset(0);
    setSearch(query.trim());
  }

  async function prepareDelete(id: string) {
    const ticket = ++preparation.current;
    setError("");
    try {
      const snapshot = await mutations.prepareDelete(id);
      if (ticket === preparation.current) setConfirmDelete(snapshot);
    } catch (cause) { if (ticket === preparation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  async function deleteQSO(snapshot: DraftSnapshot) {
    setBusy(true); setError(""); setNotice("");
    try {
      const receipt = await mutations.delete(snapshot);
      setSelectedID(null);
      setConfirmDelete(null);
      if (receipt) setNotice("QSO deleted from the integrated logbook. Undo is available here.");
      if (onChanged) onChanged(); else await reload();
    } catch (cause) {
      setConfirmDelete(null);
      if (!mutations.getSnapshot().error) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }

  async function undoDelete() {
    if (!mutation.undo) return;
    setBusy(true); setError("");
    try {
      const receipt = await mutations.undo();
      if (receipt) setNotice("QSO restored in the integrated logbook.");
      if (onChanged) onChanged(); else await reload();
    } catch (cause) {
      if (!mutations.getSnapshot().error) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }

  async function importFile(file: File) {
    setBusy(true); setError(""); setNotice("");
    let imported = 0;
    let skipped = 0;
    try {
      const text = await file.text();
      const batches = adifBatches(text);
      if (!batches.length) throw new Error("No complete ADIF records were found.");
      for (const [index, batch] of batches.entries()) {
        const response = result<{ imported: number; skipped_duplicates: number }>(
          await onRequest("logbook_import_adif", { text: batch }),
        );
        imported += response.imported;
        skipped += response.skipped_duplicates;
        setNotice(`Importing ${index + 1} of ${batches.length} batches · ${imported} added`);
      }
      setOffset(0);
      await reload(0);
      setNotice(`${imported} QSOs imported; ${skipped} duplicates skipped.`);
    } catch (cause) {
      setError(`${imported} QSOs were imported before the operation stopped. ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function exportAll() {
    setBusy(true); setError(""); setNotice("");
    try {
      const firstPage = result<LogbookPage>(await onRequest("logbook_list", { search: "", offset: 0, limit: 1 }));
      const total = firstPage.total;
      if (!total) throw new Error("There are no QSOs to export.");
      const parts: string[] = [];
      let exported = 0;
      while (exported < total) {
        const response = result<{ text: string; count: number }>(
          await onRequest("logbook_export_adif", { offset: exported, limit: requestPageSize }),
        );
        if (response.count <= 0) throw new Error("Export stopped before the end of the logbook.");
        parts.push(response.text);
        exported += response.count;
        setNotice(`Preparing ADIF · ${exported.toLocaleString()} of ${total.toLocaleString()} QSOs`);
      }
      const url = URL.createObjectURL(new Blob([parts.join("")], { type: "text/plain;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `OM0RX-xLog-integrated-${new Date().toISOString().slice(0, 10)}.adi`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setNotice(`${exported.toLocaleString()} QSOs exported from the integrated logbook.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }

  const total = page?.total ?? 0;
  const rows = page?.qsos ?? [];
  const selected = rows.find(qso => qso.id === selectedID);
  const deleting = confirmDelete?.qso as QSO | undefined;
  return (
    <section className="live-logbook" aria-label="Integrated logbook">
      <header className="live-logbook-head">
        <div>
          <h2>Logbook</h2>
          <p>Local working copy · {total.toLocaleString()} contacts</p>
        </div>
        <div className="live-logbook-actions">
          <form className="live-logbook-search" onSubmit={submitSearch}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={128}
              placeholder="Callsign, name, country or note" aria-label="Search logbook" />
            <button type="submit" disabled={loading || busy} aria-label="Search" title="Search"><Search size={14} /></button>
          </form>
          <button type="button" disabled={!selected || busy || loading} onClick={() => selected && onEdit(selected)}><Pencil size={13} /> Edit</button>
          <button type="button" disabled={!selected || loading} aria-expanded={details && !!selected} aria-controls="logbook-contact-details"
            onClick={() => setDetails(value => !value)}>Details</button>
          <button type="button" ref={columnsButton} aria-expanded={columnsOpen} aria-controls={columnsID}
            onClick={() => setColumnsOpen(value => !value)}>Columns</button>
          <button type="button" disabled={!selected || busy || loading} onClick={() => selected && void prepareDelete(selected.id)}><Trash2 size={13} /> Delete</button>
          <button type="button" onClick={() => void undoDelete()} disabled={!mutation.undo || busy}><RotateCcw size={13} /> Undo delete</button>
          <input ref={fileInput} type="file" accept=".adi,.adif,text/plain" hidden
            onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} />
          <button type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
            <FileUp size={14} /> Import ADIF
          </button>
          <button type="button" onClick={() => void exportAll()} disabled={busy}>
            <Download size={14} /> Export all
          </button>
          {onUndock && <button type="button" onClick={onUndock} disabled={busy}><ExternalLink size={14} /> Undock</button>}
          {onDock && <button type="button" onClick={onDock} disabled={busy}><PanelsTopLeft size={14} /> Dock back</button>}
        </div>
      </header>
      {columnsOpen && <LogbookColumns id={columnsID} preferences={columnPreferences} onChange={setColumnPreferences}
        onDone={() => { setColumnsOpen(false); columnsButton.current?.focus(); }} />}
      {error && <p className="live-logbook-feedback error" role="alert">{error}</p>}
      {notice && <p className="live-logbook-feedback" role="status">{notice}</p>}
      {deleting && <div className="live-logbook-feedback" role="group" aria-label={`Delete ${deleting.call}`}>
        <span>Delete {deleting.call} · {utcTime(deleting.start)}? You can undo this deletion.</span>
        <div><button type="button" onClick={() => confirmDelete && void deleteQSO(confirmDelete)} disabled={busy}>Confirm delete</button>
          <button type="button" onClick={cancelDelete} disabled={busy}>Cancel</button></div>
      </div>}
      {details && selected && <dl id="logbook-contact-details" className="live-logbook-details" aria-label={`Details for ${selected.call}`}>
        <div><dt>Callsign</dt><dd>{selected.call}</dd></div>
        <div><dt>UTC</dt><dd>{utcTime(selected.start)}</dd></div>
        <div><dt>Band / Mode</dt><dd>{selected.band} · {selected.submode || selected.mode}</dd></div>
        <div><dt>Frequency MHz</dt><dd>{typeof selected.frequencyHz === "number" ? (selected.frequencyHz / 1_000_000).toFixed(6) : "—"}</dd></div>
        <div><dt>RST sent / received</dt><dd>{selected.rstSent || "—"} / {selected.rstReceived || "—"}</dd></div>
        <div><dt>Country / Name</dt><dd>{selected.country || "—"}{selected.name ? ` · ${selected.name}` : ""}</dd></div>
        <div className="live-logbook-details-qsl"><dt>Confirmations</dt><dd>
          <span>QSL <ConfirmationStatus service="QSL" sent={selected.qslSent} received={selected.qslReceived} /></span>
          <span>LoTW <ConfirmationStatus service="LoTW" sent={selected.lotwSent} received={selected.lotwReceived} /></span>
          <span>Club Log <ConfirmationStatus service="Club Log" sent={selected.extraFields?.CLUBLOG_QSO_UPLOAD_STATUS} supportsReceived={false} /></span>
        </dd></div>
        <div className="live-logbook-details-comment"><dt>Comment</dt><dd>{selected.comment || "—"}</dd></div>
      </dl>}
      <div className="live-logbook-table-wrap" ref={tableArea} role="region" aria-label="Logbook contacts, scroll for more columns" tabIndex={0}>
        <table className="live-logbook-table" style={{ minWidth: totalColumnWidth }}>
          <colgroup>{visibleColumns.map(([id]) => <col key={id} style={{ width: `${columnPreferences.widths[id] / totalColumnWidth * 100}%` }} />)}</colgroup>
          <thead><tr>{visibleColumns.map(([id, label]) => <LogbookColumnHeader key={id} column={id} label={label}
            width={columnPreferences.widths[id]} onWidth={resizeColumn} />)}</tr></thead>
          <tbody>
            {rows.map((qso, index) => <tr key={qso.id} tabIndex={0} aria-selected={selectedID === qso.id}
              onClick={() => { cancelDelete(); setSelectedID(qso.id); }}
              onDoubleClick={() => { if (!busy && !loading) onEdit(qso); }}
              onKeyDown={event => {
                if (busy || loading) return;
                if (event.key === "Enter") { event.preventDefault(); setSelectedID(qso.id); onEdit(qso); }
                else if (event.key === " ") { event.preventDefault(); cancelDelete(); setSelectedID(qso.id); }
                else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const next = Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
                  cancelDelete(); setSelectedID(rows[next].id);
                  (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
                }
              }}>
              <td hidden={hidden("utc")} className="mono" title={utcTime(qso.start)}>{utcTime(qso.start)}</td>
              <td className="live-logbook-call" title={qso.call}><span className={`live-logbook-sync-dot ${qso.isDirty ? "is-pending" : "is-clean"}`} role="img" aria-label={qso.isDirty ? "Pending synchronization" : "No pending changes"} title={qso.isDirty ? "Pending synchronization" : "No pending changes"} />{qso.call}</td>
              <td hidden={hidden("bandMode")} className="live-logbook-band" title={`${qso.band} · ${qso.submode || qso.mode}`}>{qso.band} · {qso.submode || qso.mode}</td>
              <td hidden={hidden("frequency")} className="live-logbook-frequency mono">{typeof qso.frequencyHz === "number" ? (qso.frequencyHz / 1_000_000).toFixed(6) : "—"}</td>
              <td hidden={hidden("rst")} className="mono" aria-label={`RST sent ${qso.rstSent || "not recorded"}, received ${qso.rstReceived || "not recorded"}`}>{qso.rstSent || "—"} / {qso.rstReceived || "—"}</td>
              <td hidden={hidden("country")} title={[qso.country, qso.name].filter(Boolean).join(" · ") || undefined}>{qso.country || "—"}</td>
              <td hidden={hidden("qsl")}><ConfirmationStatus service="QSL" sent={qso.qslSent} received={qso.qslReceived} /></td>
              <td hidden={hidden("lotw")}><ConfirmationStatus service="LoTW" sent={qso.lotwSent} received={qso.lotwReceived} /></td>
              <td hidden={hidden("clublog")}><ConfirmationStatus service="Club Log" sent={qso.extraFields?.CLUBLOG_QSO_UPLOAD_STATUS} supportsReceived={false} /></td>
              <td hidden={hidden("comment")} className="live-logbook-comment" title={qso.comment || undefined}>{qso.comment || "—"}</td>
            </tr>)}
          </tbody>
        </table>
        {!loading && !error && !rows.length && <div className="live-logbook-empty">
          {search ? "No QSOs match this search. Try a callsign or clear the search." : "This working logbook is empty. Log a QSO or import an ADIF file to begin."}
        </div>}
        {loading && <div className="live-logbook-empty" role="status">Loading logbook…</div>}
      </div>
      <footer className="live-logbook-footer">
        <span>{total ? `${offset + 1}–${Math.min(offset + rows.length, total)} of ${total.toLocaleString()}` : "0 contacts"}</span>
        <div>
          <button type="button" onClick={() => { cancelDelete(); setOffset(Math.max(0, offset - pageSize)); }} disabled={loading || offset === 0}>Previous</button>
          <button type="button" onClick={() => { cancelDelete(); setOffset(offset + pageSize); }} disabled={loading || offset + pageSize >= total}>Next</button>
        </div>
      </footer>
    </section>
  );
}

export default LogbookPanel;

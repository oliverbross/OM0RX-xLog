import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Download, FileUp, Pencil, RotateCcw, Search, Trash2 } from "lucide-react";
import "./logbook.css";

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
const pageSize = 20;
const maxADIFBytes = 14_000;
const utf8 = new TextEncoder();

function result<T>(response: any): T {
  return (response && typeof response === "object" && "result" in response
    ? response.result
    : response) as T;
}

function utcTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-GB", {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false,
      }).format(date);
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
    <ArrowUp aria-hidden="true" className={`is-${confirmationTone(sent)}`} size={12} strokeWidth={2.6} />
    <ArrowDown aria-hidden="true" className={supportsReceived ? `is-${confirmationTone(received)}` : "is-unavailable"} size={12} strokeWidth={2.6} />
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

export function LogbookPanel({ onRequest, onEdit, refreshKey }: {
  onRequest: Request;
  onEdit: (qso: QSO) => void;
  refreshKey: number;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<LogbookPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [undoID, setUndoID] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    onRequest("logbook_list", { search, offset, limit: pageSize })
      .then((response) => {
        if (!cancelled) setPage(result<LogbookPage>(response));
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [onRequest, search, offset, refreshKey]);

  async function reload() {
    const response = await onRequest("logbook_list", { search, offset, limit: pageSize });
    setPage(result<LogbookPage>(response));
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setSearch(query.trim());
  }

  async function deleteQSO(id: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      await onRequest("logbook_delete", { id });
      setUndoID(id);
      setConfirmDelete(null);
      setNotice("QSO deleted from the integrated logbook. Undo is available here.");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }

  async function undoDelete() {
    if (!undoID) return;
    setBusy(true); setError("");
    try {
      await onRequest("logbook_undo", { id: undoID });
      setUndoID(null);
      setNotice("QSO restored in the integrated logbook.");
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
      await reload();
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
          await onRequest("logbook_export_adif", { offset: exported, limit: pageSize }),
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
  return (
    <section className="live-logbook" aria-label="Integrated logbook">
      <header className="live-logbook-head">
        <div>
          <h2>Logbook</h2>
          <p>Working copy · {total.toLocaleString()} contacts · synchronization off</p>
        </div>
        <div className="live-logbook-actions">
          <input ref={fileInput} type="file" accept=".adi,.adif,text/plain" hidden
            onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} />
          <button type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
            <FileUp size={14} /> Import ADIF
          </button>
          <button type="button" onClick={() => void exportAll()} disabled={busy}>
            <Download size={14} /> Export all
          </button>
        </div>
      </header>
      <form className="live-logbook-search" onSubmit={submitSearch}>
        <Search size={15} aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="Callsign, comment, reference…" aria-label="Search logbook" />
        <button type="submit" disabled={loading}>Search</button>
      </form>
      {error && <p className="live-logbook-feedback error" role="alert">{error}</p>}
      {notice && <p className="live-logbook-feedback" role="status">{notice}
        {undoID && <button type="button" onClick={() => void undoDelete()} disabled={busy}><RotateCcw size={13} /> Undo delete</button>}
      </p>}
      <div className="live-logbook-table-wrap">
        <table className="live-logbook-table">
          <thead><tr><th scope="col">Date UTC</th><th scope="col">Callsign</th><th scope="col">Band / mode</th><th scope="col">Frequency</th><th scope="col">RST</th><th scope="col">Name / country</th><th scope="col">QSL</th><th scope="col">LoTW</th><th scope="col">Club Log</th><th scope="col">Comment</th><th scope="col">Sync</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map((qso) => <tr key={qso.id}>
              <td className="mono">{utcTime(qso.start)}</td>
              <td className="live-logbook-call mono">{qso.call}</td>
              <td>{qso.band} · {qso.submode || qso.mode}</td>
              <td className="mono">{typeof qso.frequencyHz === "number" ? `${(qso.frequencyHz / 1_000_000).toFixed(6)} MHz` : "—"}</td>
              <td className="mono" aria-label={`RST sent ${qso.rstSent || "not recorded"}, received ${qso.rstReceived || "not recorded"}`}>{qso.rstSent || "—"} / {qso.rstReceived || "—"}</td>
              <td>{[qso.name, qso.country].filter(Boolean).join(" · ") || "—"}</td>
              <td><ConfirmationStatus service="QSL" sent={qso.qslSent} received={qso.qslReceived} /></td>
              <td><ConfirmationStatus service="LoTW" sent={qso.lotwSent} received={qso.lotwReceived} /></td>
              <td><ConfirmationStatus service="Club Log" sent={qso.extraFields?.CLUBLOG_QSO_UPLOAD_STATUS} supportsReceived={false} /></td>
              <td className="live-logbook-comment" title={qso.comment || undefined}>{qso.comment || "—"}</td>
              <td>{qso.isDirty ? <span className="live-logbook-pending">Pending</span> : "Synced"}</td>
              <td className="live-logbook-row-actions">
                {confirmDelete === qso.id ? <>
                  <button type="button" onClick={() => void deleteQSO(qso.id)} disabled={busy}>Confirm delete</button>
                  <button type="button" onClick={() => setConfirmDelete(null)}>Cancel</button>
                </> : <>
                  <button type="button" title={`Edit ${qso.call}`} aria-label={`Edit ${qso.call}`} onClick={() => onEdit(qso)}><Pencil size={13} /></button>
                  <button type="button" title={`Delete ${qso.call}`} aria-label={`Delete ${qso.call}`} onClick={() => setConfirmDelete(qso.id)} disabled={busy}><Trash2 size={13} /></button>
                </>}
              </td>
            </tr>)}
          </tbody>
        </table>
        {!loading && !rows.length && <div className="live-logbook-empty">
          {search ? "No QSOs match this search. Try a callsign or clear the search." : "This working logbook is empty. Log a QSO or import an ADIF file to begin."}
        </div>}
        {loading && <div className="live-logbook-empty" role="status">Loading logbook…</div>}
      </div>
      <footer className="live-logbook-footer">
        <span>{total ? `${offset + 1}–${Math.min(offset + rows.length, total)} of ${total.toLocaleString()}` : "0 contacts"}</span>
        <div>
          <button type="button" onClick={() => setOffset(Math.max(0, offset - pageSize))} disabled={loading || offset === 0}>Previous</button>
          <button type="button" onClick={() => setOffset(offset + pageSize)} disabled={loading || offset + pageSize >= total}>Next</button>
        </div>
      </footer>
    </section>
  );
}

export default LogbookPanel;

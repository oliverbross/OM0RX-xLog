import { Radio } from "lucide-react";
import type { ReactNode } from "react";
import "./QSOHeader.css";

export type ReferenceEvidence = { call: string; rows: Array<{ kind?: unknown; reference?: unknown; status?: unknown; name?: unknown }>; error?: string };

export function ReferenceEvidenceStatus({ call, evidence }: { call?: unknown; evidence?: ReferenceEvidence | null }) {
  const current = String(call ?? "").trim().toUpperCase();
  const rows = current && evidence?.call.trim().toUpperCase() === current ? evidence.rows : [];
  const error = current && evidence?.call.trim().toUpperCase() === current ? evidence.error : undefined;
  if (!rows.length && !error) return null;
  return <span className="qso-reference-status" role="status" aria-label="Reference verification">
    {rows.map((row, index) => <span key={`${String(row.kind)}-${String(row.reference)}-${index}`}>
      {String(row.kind ?? "").toUpperCase()} {String(row.reference ?? "")} · {row.status === "verified"
        ? `Verified: ${String(row.name ?? "")}` : row.status === "not_installed" ? "Directory not installed" : "Not found in installed directory"}
    </span>)}
    {error && <span>{error}</span>}
  </span>;
}

export default function QSOHeader({ title, id, duplicateDate, actions }: { title: string; id?: string; duplicateDate?: string | null; actions?: ReactNode }) {
  return <header className="qso-panel-header">
    <h2 id={id}><Radio size={15} aria-hidden="true" />{title}</h2>
    {duplicateDate && <span className="qso-dupe-status" role="status" title="Previously worked on this band and mode · UTC date">Dupe: Worked on {duplicateDate}</span>}
    {actions}
  </header>;
}

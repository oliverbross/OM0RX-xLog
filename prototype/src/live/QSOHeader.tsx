import { Radio } from "lucide-react";
import "./QSOHeader.css";

export type ReferenceEvidence = { call: string; rows: Array<{ kind?: unknown; reference?: unknown; status?: unknown; name?: unknown }> };

export default function QSOHeader({ title, id, call, evidence }: { title: string; id?: string; call?: unknown; evidence?: ReferenceEvidence | null }) {
  const current = String(call ?? "").trim().toUpperCase();
  const rows = current && evidence?.call.trim().toUpperCase() === current ? evidence.rows : [];
  return <header className="qso-panel-header">
    <h2 id={id}><Radio size={15} aria-hidden="true" />{title}</h2>
    {!!rows.length && <span className="qso-reference-status" role="status" aria-label="Reference verification">
      {rows.map((row, index) => <span key={`${String(row.kind)}-${String(row.reference)}-${index}`}>
        {String(row.kind ?? "").toUpperCase()} {String(row.reference ?? "")} · {row.status === "verified"
          ? `Verified: ${String(row.name ?? "")}` : row.status === "not_installed" ? "Directory not installed" : "Not found in installed directory"}
      </span>)}
    </span>}
  </header>;
}

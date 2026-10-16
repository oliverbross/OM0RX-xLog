import { useEffect, useState } from "react";
import "./ctyCorrectionPreview.css";

type Row = {
  id: string; call: string; start: string;
  previousADIF?: number; previousCountry?: string;
  currentADIF?: number; currentCountry?: string;
};
type Snapshot = {
  source: "bundled" | "downloaded";
  preview: { rows: Row[]; affectedCount: number; protectedOverrideCount: number; offset: number; limit: number };
};
const pageSize = 20;
function entity(name?: string, adif?: number) {
  return adif == null ? "Unresolved" : `${name ?? "Unknown entity"} (${adif})`;
}

export function CTYCorrectionPreview({ onRequest, refreshKey }: {
  onRequest: (method: string, params?: Record<string, unknown>) => Promise<any>;
  refreshKey: number;
}) {
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setSnapshot(null); setError("");
    onRequest("logbook_cty_preview", { limit: pageSize, offset }).then(response => {
      if (cancelled) return;
      const next: Snapshot = response?.result ?? response;
      if (offset > 0 && offset >= next.preview.affectedCount) { setOffset(0); return; }
      setSnapshot(next);
    }).catch(cause => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [onRequest, offset, refreshKey, reload]);
  const preview = snapshot?.preview;
  return <section className="cty-correction-preview" aria-label="PJ country inference preview" aria-busy={loading} tabIndex={0}>
    <header><h3>PJ country inference preview</h3><button type="button" disabled={loading}
      onClick={() => { setOffset(0); setReload(value => value + 1); }}>Refresh preview</button></header>
    <p>Read-only comparison of the former PJ shortcut with current CTY rules at each QSO date. Stored DXCC values, including manual overrides, are excluded. No contacts are changed.</p>
    {loading && <p role="status">Reading local classifications…</p>}
    {error && <p role="alert">Could not read the preview: {error} Use Refresh preview to retry.</p>}
    {preview && <>
      <p role="status">{preview.affectedCount.toLocaleString()} inferred classifications differ · {preview.protectedOverrideCount.toLocaleString()} PJ contacts protected by stored DXCC · {snapshot.source} CTY source</p>
      {preview.affectedCount === 0 ? <p>No inferred PJ classifications differ in this local logbook.</p> : <>
        <div className="cty-correction-table" tabIndex={0} role="region" aria-label="Inferred country changes"><table>
          <caption>Inferred entities only; before and after values are not stored-field provenance.</caption>
          <thead><tr><th scope="col">Callsign / QSO identity</th><th scope="col">QSO date (UTC)</th><th scope="col">Former inference</th><th scope="col">Current inference</th></tr></thead>
          <tbody>{preview.rows.map(row => <tr key={row.id}>
            <th scope="row">{row.call}<small>{row.id}</small></th>
            <td>{row.start.replace("T", " ").replace(/Z$/, "")}</td>
            <td>{entity(row.previousCountry, row.previousADIF)}</td><td>{entity(row.currentCountry, row.currentADIF)}</td>
          </tr>)}</tbody>
        </table></div>
        <nav aria-label="PJ preview pages">
          <button type="button" disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - pageSize))}>Previous preview page</button>
          <span>{preview.offset + 1}–{preview.offset + preview.rows.length} of {preview.affectedCount}</span>
          <button type="button" disabled={loading || offset + pageSize >= preview.affectedCount} onClick={() => setOffset(value => value + pageSize)}>Next preview page</button>
        </nav>
      </>}
    </>}
  </section>;
}

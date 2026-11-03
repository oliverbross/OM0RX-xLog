import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Data = Record<string, any>;
export type POTAExportPreview = { version: number; rulesVersion: string; sourceURLs: string[]; capturedAt: string;
  physicalContacts: number; includedContacts: number; derivedRecords: number;
  files: { filename: string; stationCall: string; ownPark: string; state: string; physicalContacts: number; derivedRecords: number; text: string }[];
  issues: { contactID: string; message: string }[]; warnings: string[]; assignment?: unknown };
export function POTAExportPanel({ request, selection, onClose, onWorking }: { request: (method: string, params?: Data) => Promise<Data>; selection: Data; onClose: () => void; onWorking?: (value: boolean) => void }) {
  const [preview, setPreview] = useState<POTAExportPreview | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [token, setToken] = useState("");
  const [activeContext, setActiveContext] = useState<Data | null>(null);
  useEffect(() => { let active = true; void request("settings_load").then(value => { if (active) setActiveContext(value.settings?.portableOperating?.activeContext ?? null); }).catch(() => { /* The selected/filtered export remains available if settings cannot be read. */ }); return () => { active = false; }; }, [request]);
  const [parks, setParks] = useState(""), [state, setState] = useState(""), [split, setSplit] = useState(false), [subset, setSubset] = useState(false);
  const [club, setClub] = useState(false), [locationsReviewed, setLocationsReviewed] = useState(false);
  const run = async (operation: () => Promise<void>) => { setBusy(true); onWorking?.(true); setMessage(""); try { await operation(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); onWorking?.(false); } };
  const invalidate = () => { setPreview(null); setSubset(false); setLocationsReviewed(false); };
  const review = (scope = selection) => run(async () => {
    const snapshot = await request("logbook_export_adif", { action: "begin", ...scope });
    const assignment = parks.trim() || state.trim() || club ? { ownParks: [...new Set(parks.toUpperCase().split(/[\s,;]+/).filter(Boolean))], state, clubOrGroup: club } : undefined;
    const response = await request("logbook_export_adif", { action: "pota_preview", token: snapshot.token, splitByDay: split, ...(assignment ? { assignment } : {}) });
    const value = (response.preview ?? response) as POTAExportPreview;
    if (!Array.isArray(value.files) || !Array.isArray(value.issues) || !Number.isSafeInteger(value.physicalContacts)) throw new Error("The POTA snapshot preview could not be verified.");
    const fileCount = response.fileCount ?? (value as any).fileCount ?? value.files.length;
    const issueCount = response.issueCount ?? (value as any).issueCount ?? value.issues.length;
    const files = [], issues = [];
    for (let offset = 0; offset < fileCount; offset += 25) { const page = await request("logbook_export_adif", { action: "pota_files", token: snapshot.token, offset, limit: 25 }); if (!Array.isArray(page.files) || !page.files.length) throw new Error("POTA file metadata page is incomplete."); files.push(...page.files); }
    for (let offset = 0; offset < issueCount; offset += 25) { const page = await request("logbook_export_adif", { action: "pota_issues", token: snapshot.token, offset, limit: 25 }); if (!Array.isArray(page.issues) || !page.issues.length) throw new Error("POTA exclusions page is incomplete."); issues.push(...page.issues); }
    if (files.length !== fileCount || issues.length !== issueCount) throw new Error("POTA preview population changed. Refresh the preview.");
    setToken(snapshot.token); setPreview({ ...value, files, issues }); setSubset(false); setLocationsReviewed(false);
  });
  return <section role="dialog" aria-label="POTA activation export" className="logbook-transfer"><h3>POTA activation export</h3><p>This creates local files from a frozen selection. Each file contains one station, own park and location. Hunter reports are not submission files.</p>
    <label>Export-only own parks for records missing own park<input aria-label="POTA export own park assignment" value={parks} disabled={busy} onChange={e => { setParks(e.target.value); invalidate(); }} /></label>
    <label>Export-only subdivision for records missing MY_STATE<input aria-label="POTA export subdivision assignment" value={state} disabled={busy} onChange={e => { setState(e.target.value); invalidate(); }} /></label>
    <label><input type="checkbox" checked={split} disabled={busy} onChange={e => { setSplit(e.target.checked); invalidate(); }} />Split additionally by UTC day</label>
    <label><input type="checkbox" checked={club} disabled={busy} onChange={e => { setClub(e.target.checked); invalidate(); }} />Club/group activation (station and individual operator required)</label>
    <button type="button" disabled={busy} onClick={() => void review()}>Freeze selection and preview</button>
    {activeContext && <button type="button" disabled={busy} onClick={() => void review({ scope: "filtered", query: { version: 1, join: "all", clauses: [{ field: "portableContext", op: "eq", values: [activeContext.sessionID] }] } })}>Preview active portable session: {activeContext.preset?.name}</button>}
    {preview && <><p>{preview.physicalContacts} physical contacts · {preview.includedContacts} included · {preview.derivedRecords} derived ADIF records · {preview.files.length} files</p>
      <table><thead><tr><th>Station</th><th>Own park</th><th>Location</th><th>Contacts / records</th></tr></thead><tbody>{preview.files.map(file => <tr key={file.filename}><td>{file.stationCall}</td><td>{file.ownPark}</td><td>{file.state || "Review subdivision if park crosses boundaries"}</td><td>{file.physicalContacts} / {file.derivedRecords}</td></tr>)}</tbody></table>
      {preview.warnings.map((warning, i) => <p key={i}>{warning}</p>)}
      {preview.issues.length > 0 && <><p role="alert">{preview.issues.length} source contacts excluded from the valid subset (first 100 shown; every exclusion is retained in the manifest):</p><ul>{preview.issues.slice(0, 100).map(issue => <li key={issue.contactID}>{issue.contactID}: {issue.message}</li>)}</ul>
        <label><input type="checkbox" checked={subset} onChange={e => setSubset(e.target.checked)} />Export the displayed valid subset and retain these exclusions in the manifest</label></>}
      <p>{preview.rulesVersion} · captured {preview.capturedAt}</p>
      <label><input type="checkbox" checked={locationsReviewed} onChange={e => setLocationsReviewed(e.target.checked)} />I reviewed own park identities and the correct subdivision for parks spanning locations</label>
      <button type="button" disabled={busy || !locationsReviewed || !preview.files.length || preview.issues.length > 0 && !subset} onClick={() => void run(async () => {
        const files = [];
        for (let fileIndex = 0; fileIndex < preview.files.length; fileIndex++) {
          const chunks: Uint8Array[] = []; let offset = 0, total = 1;
          while (offset < total) {
            const chunk = await request("logbook_export_adif", { action: "pota_read", token, fileIndex, offset, limit: 12000 });
            const raw = atob(chunk.bytes ?? chunk.base64 ?? "");
            if (!Number.isSafeInteger(chunk.total) || chunk.total < 1 || raw.length !== chunk.count || raw.length < 1 || offset + raw.length > chunk.total) throw new Error("POTA file chunk could not be verified. Refresh the preview.");
            total = chunk.total; chunks.push(Uint8Array.from(raw, c => c.charCodeAt(0))); offset += raw.length;
          }
          const bytes = new Uint8Array(total); let cursor = 0; for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
          files.push({ ...preview.files[fileIndex], text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) });
        }
        const result = await invoke<Data>("logbook_export_pota_set", { preview: { ...preview, files } });
        setMessage(result.cancelled ? "Export cancelled. No files published." : result.saved ? `Published ${preview.files.length} ADI files and manifest.` : "Export did not complete.");
      })}>Save reviewed file set</button></>}
    <button type="button" disabled={busy} onClick={onClose}>Close POTA export</button>{message && <p role="status">{message}</p>}
  </section>;
}

import { useEffect, useRef, useState } from "react";
import "./countryReferenceControl.css";

type Request = (method: string, params?: Record<string, unknown>) => Promise<any>;
type Snapshot = { reference_revision: string; provider: string; source_revision: string | null; source_version: string | null;
  record_count: number | null; excluded_count: number | null; coverage: string[]; rollback_available: boolean };

export default function CountryReferenceControl({ request, visible }: { request: Request; visible: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [path, setPath] = useState(""), [url, setURL] = useState("");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const pending = useRef(false), epoch = useRef(0);
  useEffect(() => () => { epoch.current++; }, []);
  async function run(method: string, params: Record<string, unknown> = {}) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setMessage(""); const ticket = ++epoch.current;
    try {
      const raw = await request(method, params), response = raw?.result ?? raw;
      if (ticket !== epoch.current) return;
      if (typeof response?.reference_revision !== "string" || typeof response?.provider !== "string" ||
          typeof response?.rollback_available !== "boolean" || !Array.isArray(response.coverage))
        throw new Error("Country snapshot status could not be verified.");
      setSnapshot(response);
      setMessage(method === "reference_country_status" ? "Country snapshot inspected. No contacts changed." :
        response.country_reference_changed ? "Country snapshot activated. Stored contacts and contest interpretation stay unchanged; review country fields separately." :
        "Country snapshot unchanged. Check completed without a new data revision.");
    } catch (cause) { if (ticket === epoch.current) setMessage(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className="country-reference-control" hidden={!visible} aria-label="Versioned country snapshot" aria-busy={busy}>
    <h2>Country snapshot</h2>
    <p>The bundled country snapshot includes dated exact exceptions and historical entities. Updates change inference only. Use Logbook → Country preview to review selected stored fields.</p>
    <button type="button" disabled={busy} onClick={() => void run("reference_country_status")}>Read country snapshot</button>
    {snapshot && <>
      <p>{snapshot.provider} · {snapshot.record_count?.toLocaleString() ?? "Unknown"} rules · {snapshot.excluded_count?.toLocaleString() ?? "Unknown"} explicitly excluded source entries.</p>
      <p>Source version: {snapshot.source_version ?? "Not supplied"}. Coverage: {snapshot.coverage.join(", ")}.</p>
      <details><summary>Country source and revision</summary><p>Source revision: {snapshot.source_revision ?? "Not supplied"}</p><p>Active snapshot: {snapshot.reference_revision}</p></details>
    </>}
    <label>Normalized country pack file (.json)<input aria-label="Country pack file" value={path} disabled={busy} maxLength={4096} placeholder="Absolute path to a reviewed country pack" onChange={event => setPath(event.target.value)} /></label>
    <button type="button" disabled={busy || !path.trim()} onClick={() => void run("reference_country_import", { path: path.trim() })}>Validate and import country pack</button>
    <label>Normalized country pack URL<input aria-label="Country pack URL" type="url" value={url} disabled={busy} maxLength={2048} placeholder="https://…/country-reference-pack.json" onChange={event => setURL(event.target.value)} /></label>
    <button type="button" disabled={busy || !url.trim()} onClick={() => void run("reference_country_download", { url: url.trim() })}>Check and download country pack</button>
    <button type="button" disabled={busy || !snapshot?.rollback_available} onClick={() => void run("reference_country_rollback")}>Restore previous country snapshot</button>
    <p>Imports and downloads use the same validator as the bundle. Invalid or incomplete packs retain the last usable snapshot. Snapshot rollback does not undo contact edits.</p>
    {message && <p role="status">{message}</p>}
  </section>;
}

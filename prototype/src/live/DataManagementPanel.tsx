import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Archive, CheckCircle2, DatabaseBackup, RefreshCw } from "lucide-react";
import "./data-management.css";
import RemoteBackupPanel from "./RemoteBackupPanel";

type Request = (method: string, params?: Record<string, unknown>) => Promise<any>;
type Backup = { name: string };
type Preview = {
  name: string;
  manifest: {
    createdAt: string;
    qsoCount: number;
    pendingSyncCount: number;
    databaseBytes: number;
    includesReferenceData: boolean;
  };
  includes_settings: boolean;
  includes_preferences: boolean;
};
type ReferenceStatus = {
  running: boolean;
  status: string;
  cty_source: string;
  state: Record<string, any>;
};
export function safeReferenceSource(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "Not reported";
  try { const url = new URL(value); if (!["https:", "http:"].includes(url.protocol)) return "Not reported";
    url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.href;
  } catch { return "Not reported"; }
}
export function safeReferenceVersion(value: unknown): string {
  if (typeof value !== "string") return "Not reported";
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 80 && /^[\x20-\x7e]+$/.test(trimmed) ? trimmed : "Not reported";
}

export function DataManagementPanel({ onRequest, onChanged, section, visible = true, sourceSettings = {}, pickBackup = () => invoke<string | null>("pick_backup_package") }: {
  onRequest: Request;
  onChanged: () => void;
  pickBackup?: () => Promise<string | null>;
  section?: "references" | "backups";
  visible?: boolean;
  sourceSettings?: Record<string, unknown>;
}) {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [selected, setSelected] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reference, setReference] = useState<ReferenceStatus | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoreSettings, setRestoreSettings] = useState(true);
  const [restorePreferences, setRestorePreferences] = useState(false);
  const [restoreReference, setRestoreReference] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [referenceError, setReferenceError] = useState("");
  const mounted = useRef(false);
  const statusFlight = useRef<{ request: Request; promise: Promise<any> } | null>(null);
  const fetchReferenceStatus = useCallback(() => {
    if (statusFlight.current?.request === onRequest) return statusFlight.current.promise;
    const promise = Promise.resolve().then(() => onRequest("reference_status")).finally(() => {
      if (statusFlight.current?.promise === promise) statusFlight.current = null;
    });
    statusFlight.current = { request: onRequest, promise };
    return promise;
  }, [onRequest]);

  async function reload() {
    const [listing, status] = await Promise.allSettled([
      onRequest("backup_list"), fetchReferenceStatus(),
    ]);
    if (!mounted.current) return;
    if (status.status === "fulfilled") { setReference(status.value); setReferenceError(""); }
    else setReferenceError("Reference status is unavailable. Backup results are unaffected.");
    if (listing.status === "fulfilled") setBackups(listing.value.backups ?? []);
    else throw listing.reason;
  }

  useEffect(() => {
    let disposed = false;
    mounted.current = true;
    void Promise.allSettled([onRequest("backup_list"), fetchReferenceStatus()])
      .then(([listing, status]) => {
        if (disposed) return;
        if (listing.status === "fulfilled") setBackups(listing.value.backups ?? []);
        else setError("Backup listing is unavailable. Try again before creating or restoring a backup.");
        if (status.status === "fulfilled") { setReference(status.value); setReferenceError(""); }
        else setReferenceError("Reference status is unavailable. Its freshness cannot be assessed.");
      });
    return () => { disposed = true; mounted.current = false; };
  }, [onRequest, fetchReferenceStatus]);

  useEffect(() => {
    if (!visible || section === "backups") return;
    let disposed = false;
    let pending = false;
    const timer = window.setInterval(() => {
      if (pending) return;
      pending = true;
      void fetchReferenceStatus()
        .then((status) => { if (!disposed) { setReference(status); setReferenceError(""); } })
        .catch(() => { if (!disposed) setReferenceError("Reference progress is unavailable. Do not assume the update succeeded."); })
        .finally(() => { pending = false; });
    }, 3000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [fetchReferenceStatus, visible, section]);

  async function act(action: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function inspect(name: string) {
    setSelected(name); setConfirmRestore(false); setRestorePreferences(false); setError("");
    try { setPreview(await onRequest("backup_inspect", { name })); }
    catch (cause) { setPreview(null); setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  const state = reference?.state ?? {};
  const date = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Not recorded";
  const activationSources: Record<string, string> = {
    pota: "https://pota.app/all_parks_ext.csv", sota: "https://www.sotadata.org.uk/summitslist.csv",
    iota: "https://www.iota-world.org/islands-on-the-air/downloads/download-file.html?path=groups.json",
    wwff: "https://wwff.co/wwff-data/wwff_directory.csv",
  };
  const activationFiles: Record<string, string> = { pota: "pota-parks.csv", sota: "sota-summits.csv", iota: "iota-groups.json", wwff: "wwff-directory.csv", castle: "castle-cache.json" };
  const datasets = [
    { id: "clublog", name: "Club Log CTY", file: "cty.xml", checked: state.clubLogUpdatedAt, bytes: state.clubLogBytes, source: sourceSettings.clubLogCTYURL, group: "clublog_lotw" },
    { id: "lotw", name: "LoTW activity", file: "lotw-user-activity.csv", checked: state.lotwUpdatedAt, bytes: state.lotwBytes, source: sourceSettings.lotwActivityURL, group: "clublog_lotw" },
    { id: "wavelog", name: "Wavelog catalog", file: "wavelog-catalog.json", checked: state.wavelogCatalogUpdatedAt, bytes: state.wavelogCatalogBytes, source: sourceSettings.wavelogURL, group: "wavelog_catalog" },
    ...["pota", "sota", "iota", "wwff", "castle"].map(id => ({ id, name: id === "castle" ? "Castle / COTA" : id.toUpperCase(), file: activationFiles[id], checked: state.activationUpdatedAt?.[id], bytes: state.activationBytes?.[id], source: activationSources[id], group: id === "castle" ? "unsupported" : "activations" })),
  ];
  const activeGroup = /^Updating (clublog_lotw|activations|wavelog_catalog)$/.exec(reference?.status ?? "")?.[1];
  return <section className="live-data-management" aria-label="Data management">
    <h2><DatabaseBackup size={15} /> {section === "references" ? "Reference data status" : section === "backups" ? "Verified backups" : "Backups and reference data"}</h2>
    <p className="secondary">These tools operate on the integrated working copy. The original xLog database and installed apps remain untouched.</p>
    {error && <p className="live-data-feedback error" role="alert">{error}</p>}
    {message && <p className="live-data-feedback" role="status">{message}</p>}

    <div className="live-data-section" hidden={section === "references"}>
      <div className="live-data-section-title"><h3>Verified backups</h3>
        <button type="button" disabled={busy} onClick={() => void act(async () => {
          const created = await onRequest("backup_create");
          await reload(); await inspect(created.name);
          setMessage(`Verified backup created: ${created.manifest.qsoCount.toLocaleString()} QSOs.`);
        })}><Archive size={14} /> Create backup</button></div>
      <p>Each backup contains a consistent SQLite snapshot and non-secret settings. Credentials stay in Keychain.</p>
      <button type="button" disabled={busy} onClick={() => void act(async () => {
        const sourcePath = await pickBackup();
        if (!sourcePath) return;
        const imported = await onRequest("backup_import", { source_path: sourcePath });
        await reload(); await inspect(imported.name);
        setMessage(`Verified external backup imported: ${imported.manifest.qsoCount.toLocaleString()} QSOs. Inspect it before restoring.`);
      })}>Import xLog backup…</button>
      <div className="live-data-backup-list" role="list" aria-label="Integrated logbook backups">
        {backups.map((backup) => <button role="listitem" type="button" key={backup.name}
          aria-pressed={selected === backup.name} onClick={() => void inspect(backup.name)}>{backup.name}</button>)}
        {!backups.length && <span className="secondary">No backup has been created yet.</span>}
      </div>
      {preview && <div className="live-data-preview">
        <strong><CheckCircle2 size={14} /> Verified · {preview.manifest.qsoCount.toLocaleString()} QSOs</strong>
        <span>Created {date(preview.manifest.createdAt)} · {preview.manifest.pendingSyncCount.toLocaleString()} pending sync · {(preview.manifest.databaseBytes / 1024 / 1024).toFixed(1)} MB</span>
        <span>{preview.manifest.includesReferenceData ? "Reference cache included" : "No reference cache"} · {preview.includes_settings ? "Settings included" : "No settings"}</span>
        <label><input type="checkbox" checked={restoreSettings} onChange={(event) => setRestoreSettings(event.target.checked)} /> Restore settings</label>
        <label><input type="checkbox" checked={restorePreferences} onChange={(event) => setRestorePreferences(event.target.checked)} disabled={!preview.includes_preferences} /> Restore workspace preferences (band maps and intelligence)</label>
        <label><input type="checkbox" checked={restoreReference} onChange={(event) => setRestoreReference(event.target.checked)} disabled={!preview.manifest.includesReferenceData} /> Restore reference cache</label>
        <label className="live-data-confirm"><input type="checkbox" checked={confirmRestore} onChange={(event) => setConfirmRestore(event.target.checked)} /> I understand this replaces the integrated working copy and creates a recovery backup first.</label>
        <button type="button" disabled={busy || !confirmRestore} onClick={() => void act(async () => {
          const restored = await onRequest("backup_restore", {
            name: preview.name, confirm_restore: true,
            restore_settings: restoreSettings, restore_preferences: restorePreferences,
            restore_reference_data: restoreReference,
          });
          setConfirmRestore(false);
          setMessage(`Restored ${restored.qso_count.toLocaleString()} QSOs. Recovery backup: ${restored.recovery_backup}.`);
          onChanged();
        })}>Restore integrated copy</button>
      </div>}
    </div>

    <RemoteBackupPanel request={onRequest} visible={visible && section !== "references"} />
    <div className="live-data-section" hidden={section === "backups"}>
      <div className="live-data-section-title"><h3>Reference data</h3><span className="secondary">CTY: {reference?.cty_source === "workspace_download" ? "updated workspace data" : "bundled data"}</span></div>
      <p>Download, check and attempt dates appear when tracked. Legacy caches may lack separate records. Freshness reflects only the recorded source check, not the presence of a cache file.</p>
      {referenceError && <p className="live-data-feedback error" role="alert">{referenceError}</p>}
      <p className="secondary" role="status">{reference?.status || "Checking reference cache…"}</p>
      <div className="live-reference-scroll"><table className="live-reference-table" aria-label="Reference dataset evidence"><thead><tr><th scope="col">Dataset / source</th><th scope="col">Version / dates</th><th scope="col">Records / size</th><th scope="col">Download state / freshness</th></tr></thead><tbody>{datasets.map(dataset => {
        const validator = state.validators?.[dataset.file], metadata = state.sourceMetadata?.[dataset.file];
        const checked = date(metadata?.checkedAt);
        const count = state.activationCounts?.[dataset.id];
        const recorded = checked !== "Not recorded";
        return <tr key={dataset.id}><th scope="row"><strong>{dataset.name}</strong><span className="reference-source">{dataset.id === "castle" ? "No official bulk source configured" : safeReferenceSource(dataset.source)}</span><small>{dataset.id === "clublog" ? reference?.cty_source === "workspace_download" ? "Workspace CTY in use" : reference?.cty_source === "bundled" ? "Bundled CTY fallback in use" : "CTY source unknown" : dataset.id === "wavelog" ? "Configured Wavelog endpoint" : dataset.id === "lotw" ? "Configured public activity feed" : "Configured directory source"}</small></th>
          <td><span>Version / revision: {safeReferenceVersion(metadata?.sourceVersion)}</span><small>ETag: {typeof validator?.eTag === "string" && validator.eTag.trim() ? validator.eTag.slice(0, 160) : "Not reported"}</small><small>Source date: {date(validator?.lastModified)}</small><small>Successful refresh/check: {checked}</small>{!metadata && dataset.checked && <small>Legacy cache date: {date(dataset.checked)}</small>}<small>{metadata ? `Last download: ${date(metadata.downloadedAt)}` : "Last download: not tracked separately"}</small>{metadata && <small>Last attempt: {date(metadata.lastAttemptAt)}</small>}</td>
          <td><span>{typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? `${count.toLocaleString()} records` : "Record count not reported"}</span><small>{typeof dataset.bytes === "number" && Number.isSafeInteger(dataset.bytes) && dataset.bytes > 0 ? `${dataset.bytes.toLocaleString()} bytes recorded` : "Size not recorded"}</small></td>
          <td><span className={`reference-evidence ${metadata?.status === "failed" ? "failed" : recorded ? "recorded" : "unknown"}`}>{reference?.running && activeGroup === dataset.group ? "Refresh running" : dataset.id === "castle" ? "Bulk source unavailable" : metadata?.status === "failed" ? "Last attempt failed" : metadata?.status === "downloaded" ? "Last result: downloaded" : metadata?.status === "up_to_date" ? "Source unchanged at last check" : recorded ? "Successful check recorded" : "No successful check recorded"}</span><small>{referenceError ? "Status unavailable; freshness unknown" : metadata?.status === "failed" ? "Latest check failed; freshness unknown" : metadata?.status === "downloaded" ? "Updated at the recorded source check" : metadata?.status === "up_to_date" ? "Unchanged at the recorded source check" : "Freshness not assessed"}</small><small>{metadata ? `Last error: ${typeof metadata.lastError === "string" && /^[a-z0-9_]{1,80}$/i.test(metadata.lastError) ? metadata.lastError : metadata.status === "failed" ? "Details not recorded" : "None reported for last attempt"}` : "Per-dataset errors: not recorded"}</small></td></tr>;
      })}</tbody></table></div>
      <div className="live-data-refresh-actions">
        {[["clublog_lotw", "Club Log + LoTW"], ["activations", "POTA / SOTA / IOTA / WWFF"], ["wavelog_catalog", "Wavelog catalog"]].map(([source, label]) =>
          <button key={source} type="button" disabled={busy || reference?.running} onClick={() => void act(async () => {
            const started = await onRequest("reference_refresh", { source });
            setReference((current) => ({ ...(current ?? { cty_source: "unknown", state: {} }), running: true, status: started.status }));
            setMessage(`${label} update started. Progress appears here.`);
          })}><RefreshCw size={13} /> {label}</button>)}
      </div>
    </div>
  </section>;
}

export default DataManagementPanel;

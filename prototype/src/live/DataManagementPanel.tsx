import { useEffect, useState } from "react";
import { Archive, CheckCircle2, DatabaseBackup, RefreshCw } from "lucide-react";
import "./data-management.css";

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

export function DataManagementPanel({ onRequest, onChanged }: {
  onRequest: Request;
  onChanged: () => void;
}) {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [selected, setSelected] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reference, setReference] = useState<ReferenceStatus | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoreSettings, setRestoreSettings] = useState(true);
  const [restoreReference, setRestoreReference] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function reload() {
    const [listing, status] = await Promise.all([
      onRequest("backup_list"), onRequest("reference_status"),
    ]);
    setBackups(listing.backups ?? []);
    setReference(status);
  }

  useEffect(() => {
    let disposed = false;
    void Promise.all([onRequest("backup_list"), onRequest("reference_status")])
      .then(([listing, status]) => {
        if (!disposed) { setBackups(listing.backups ?? []); setReference(status); }
      })
      .catch((cause) => { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { disposed = true; };
  }, [onRequest]);

  useEffect(() => {
    if (!reference?.running) return;
    let disposed = false;
    const timer = window.setInterval(() => {
      void onRequest("reference_status")
        .then((status) => { if (!disposed) setReference(status); })
        .catch((cause) => { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)); });
    }, 3000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [onRequest, reference?.running]);

  async function act(action: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function inspect(name: string) {
    setSelected(name); setConfirmRestore(false); setError("");
    try { setPreview(await onRequest("backup_inspect", { name })); }
    catch (cause) { setPreview(null); setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  const state = reference?.state ?? {};
  const date = (value?: string) => value ? new Date(value).toLocaleString() : "Never";
  return <section className="live-data-management" aria-label="Data management">
    <h2><DatabaseBackup size={15} /> Backups and reference data</h2>
    <p className="secondary">These tools operate on the integrated working copy. The original xLog database and installed apps remain untouched.</p>
    {error && <p className="live-data-feedback error" role="alert">{error}</p>}
    {message && <p className="live-data-feedback" role="status">{message}</p>}

    <div className="live-data-section">
      <div className="live-data-section-title"><h3>Verified backups</h3>
        <button type="button" disabled={busy} onClick={() => void act(async () => {
          const created = await onRequest("backup_create");
          await reload(); await inspect(created.name);
          setMessage(`Verified backup created: ${created.manifest.qsoCount.toLocaleString()} QSOs.`);
        })}><Archive size={14} /> Create backup</button></div>
      <p>Each backup contains a consistent SQLite snapshot and non-secret settings. Credentials stay in Keychain.</p>
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
        <label><input type="checkbox" checked={restoreReference} onChange={(event) => setRestoreReference(event.target.checked)} disabled={!preview.manifest.includesReferenceData} /> Restore reference cache</label>
        <label className="live-data-confirm"><input type="checkbox" checked={confirmRestore} onChange={(event) => setConfirmRestore(event.target.checked)} /> I understand this replaces the integrated working copy and creates a recovery backup first.</label>
        <button type="button" disabled={busy || !confirmRestore} onClick={() => void act(async () => {
          const restored = await onRequest("backup_restore", {
            name: preview.name, confirm_restore: true,
            restore_settings: restoreSettings, restore_reference_data: restoreReference,
          });
          setConfirmRestore(false);
          setMessage(`Restored ${restored.qso_count.toLocaleString()} QSOs. Recovery backup: ${restored.recovery_backup}.`);
          onChanged();
        })}>Restore integrated copy</button>
      </div>}
    </div>

    <div className="live-data-section">
      <div className="live-data-section-title"><h3>Reference data</h3><span className="secondary">CTY: {reference?.cty_source === "workspace_download" ? "updated workspace data" : "bundled data"}</span></div>
      <p>Current cache: Club Log {date(state.clubLogUpdatedAt)} · LoTW {date(state.lotwUpdatedAt)} · Wavelog catalog {date(state.wavelogCatalogUpdatedAt)}</p>
      <p className="secondary" role="status">{reference?.status || "Checking reference cache…"}</p>
      <div className="live-data-refresh-actions">
        {[["clublog_lotw", "Club Log + LoTW"], ["activations", "POTA / SOTA / IOTA / WWFF"], ["wavelog_catalog", "Wavelog catalog"]].map(([source, label]) =>
          <button key={source} type="button" disabled={busy || reference?.running} onClick={() => void act(async () => {
            const started = await onRequest("reference_refresh", { source });
            setReference((current) => current ? { ...current, running: true, status: started.status } : null);
            setMessage(`${label} update started. Progress appears here.`);
          })}><RefreshCw size={13} /> {label}</button>)}
      </div>
    </div>
  </section>;
}

export default DataManagementPanel;

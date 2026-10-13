import { useCallback, useEffect, useRef, useState } from "react";
import "./SyncPanel.css";

type Data = Record<string, any>;
type Request = (method: string, params?: Data) => Promise<Data>;
type Field = { key: string; label: string; local: string; remote: string };
type Conflict = { id: string; revision: string; fields: Field[]; localQSO: Data; remoteQSO: Data };
type Props = { request: Request; onChanged: () => void };
const errorText = (error: unknown) => error instanceof Error ? error.message : "The operation failed. Refresh the current sync state and retry.";
const syncTime = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "—";

export default function SyncPanel({ request, onChanged }: Props) {
  const [state, setState] = useState<Data | null>(null);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [setupMessage, setSetupMessage] = useState("");
  const [checkingSetup, setCheckingSetup] = useState(false);
  const [interval, setIntervalMinutes] = useState("5");
  const intervalEdited = useRef(false), finished = useRef<string | null>(null), changed = useRef(onChanged);
  changed.current = onChanged;
  const mounted = useRef(false), working = useRef(false), sequence = useRef(0), polling = useRef(false);
  const read = useCallback(async () => {
    const revision = ++sequence.current;
    try {
      const next = await request("sync_status");
      if (mounted.current && revision === sequence.current) {
        setState(next);
        if (!next.running) setMessage(current => current.startsWith("Synchronization started.") ? "" : current);
        if (!intervalEdited.current) setIntervalMinutes(String(next.interval_minutes || 5));
        if (next.finished_at && finished.current !== next.finished_at) {
          finished.current = next.finished_at;
          changed.current();
        }
      }
    } catch (cause) { if (mounted.current && revision === sequence.current) setError(errorText(cause)); }
  }, [request]);
  useEffect(() => {
    mounted.current = true;
    const poll = async () => {
      if (polling.current || working.current) return;
      polling.current = true;
      try { await read(); } finally { polling.current = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 3000);
    return () => { mounted.current = false; sequence.current++; clearInterval(timer); };
  }, [read]);
  const act = async (method: string, params: Data, success: string) => {
    if (working.current) return;
    working.current = true; sequence.current++; setBusy(true); setError(""); setMessage("");
    try {
      await request(method, params);
      if (mounted.current) { if (method === "sync_configure") intervalEdited.current = false; setMessage(success); await read(); onChanged(); }
    } catch (cause) {
      if (mounted.current) { setError(errorText(cause)); await read(); }
    } finally { working.current = false; if (mounted.current) setBusy(false); }
  };
  const locked = busy || state?.running === true;
  const automatic = state?.automatic_sync === true;
  const available = !!state && state.sync_available !== false;
  const validInterval = /^\d+$/.test(interval) && Number(interval) >= 1 && Number(interval) <= 60;
  const configure = (enabled: boolean) => act("sync_configure", {
    enabled, interval_minutes: enabled ? Number(interval) : Number(state?.interval_minutes || 5), confirm_single_writer: confirmed || automatic,
  }, enabled ? "Automatic synchronization is enabled while xLog is open, including after restart." : "Automatic synchronization is off. Your contacts and pending changes are retained.");
  const checkSetup = async () => {
    setCheckingSetup(true); setSetupMessage("");
    try {
      // Read presence flags only. No credential value or remote sync request crosses this boundary.
      const [configuration, credentials] = await Promise.all([request("settings_load"), request("secret_status")]);
      const settings = configuration.settings;
      const missing: string[] = [];
      if (!String(settings?.wavelogURL ?? "").trim()) missing.push("Wavelog URL");
      if (!Number.isInteger(settings?.wavelogStationID) || settings.wavelogStationID < 1) missing.push("station ID");
      if (credentials["wavelog-token"] !== true) missing.push("Wavelog API v2 token");
      if (mounted.current) setSetupMessage(missing.length
        ? `Setup incomplete: ${missing.join(", ")}. Open Settings; paste the token directly into its private credential field and save it there.`
        : "URL, station ID and saved token are present. Server authentication is not yet verified. Confirm the single writer, then enable automatic sync or synchronize now.");
    } catch {
      if (mounted.current) setSetupMessage("Could not check setup. Review Settings and approve any Keychain prompt directly on this Mac; no synchronization was started.");
    } finally { if (mounted.current) setCheckingSetup(false); }
  };
  const conflicts: Conflict[] = state?.conflicts || [];
  return <section className="live-sync sync-panel" aria-label="Wavelog synchronization">
    <h2>Wavelog synchronization</h2>
    <p>Sync sends pending local changes and reconciles Wavelog edits and deletions. Stop the original xLog and every other sync writer before using this logbook as the active Wavelog writer.</p>
    <div className="sync-setup"><button disabled={locked || checkingSetup} onClick={() => void checkSetup()}>{checkingSetup ? "Checking setup…" : "Check setup"}</button><p aria-live="polite">{setupMessage || "Queued contacts with 0 attempts have not been uploaded yet. Conflicting edits always need your review."}</p></div>
    {!automatic && <label className="sync-confirm"><input type="checkbox" checked={confirmed} disabled={locked} onChange={event => setConfirmed(event.target.checked)} />I have stopped the other sync applications; this logbook is the only writer.</label>}
    <div className="sync-schedule">
      <strong className={automatic ? "sync-enabled" : "secondary"}>{!state ? "Reading schedule…" : automatic ? "Automatic sync on" : "Automatic sync off"}</strong>
      <label className="sync-interval">Every <input aria-label="Sync interval in minutes" type="number" min="1" max="60" step="1" value={interval} disabled={locked || !available} onChange={event => { intervalEdited.current = true; setIntervalMinutes(event.target.value); }} /> min</label>
      {automatic ? <><button disabled={locked || !validInterval || Number(interval) === state?.interval_minutes} onClick={() => void configure(true)}>Save interval</button><button disabled={locked} onClick={() => void configure(false)}>Turn off</button></> : <button className="primary" disabled={!available || !confirmed || locked || !validInterval} onClick={() => void configure(true)}>Enable automatic sync</button>}
      <button disabled={!available || !(confirmed || automatic) || locked} onClick={() => void act("sync_run", { confirm_single_writer: true }, "Synchronization started. Progress appears below.")}>{state?.running ? "Synchronizing…" : "Synchronize now"}</button>
    </div>
    {!validInterval && <p className="sync-error">Choose a whole number from 1 to 60 minutes.</p>}
    <p className="secondary">{automatic ? "Saved for this logbook and Wavelog destination. Runs while xLog is open; failures retry with backoff." : "Enable once to keep this logbook synchronized whenever xLog is open."}{state?.running ? " Wait for the current run to finish before changing its schedule." : ""}</p>
    <div className="sync-evidence" role="status"><strong>{state?.status || "Reading sync state…"}</strong><span>Last finished: {syncTime(state?.finished_at)}</span><span>Next attempt: {automatic ? state?.running ? "After this run" : state?.next_attempt ? syncTime(state.next_attempt) : "Within 15 seconds" : "Not scheduled"}</span></div>
    {state?.finished_at && typeof state.pulled === "number" && <p className="secondary">{state.pushed} uploaded · {state.pulled.toLocaleString()} remote records checked · {state.deleted} deletions applied · {state.failed} failures</p>}
    {Number(state?.held) > 0 && <p className="sync-error" role="status">{Number(state?.held).toLocaleString()} remote contacts held: duplicate identities have different ADIF details and cannot be safely matched. These contacts and their pending edits are unchanged; other contacts continue to synchronize. Review the duplicate entries in Wavelog before changing them.</p>}
    {error && <p className="sync-error" role="alert">{error}</p>}
    {message && <p className="sync-success" role="status">{message}</p>}
    <h2>Conflicts <span className="sync-count">{state ? conflicts.length : "—"}</span></h2>
    <p className="secondary">Compare changed fields, choose which values to keep, then save the merged contact. This queues a local change for the next {automatic ? "automatic" : "manual"} sync.</p>
    {!state ? <p>Loading conflicts…</p> : !conflicts.length ? <p>No unresolved conflicts.</p> : conflicts.map((conflict, index) => <details className="sync-conflict" key={conflict.id} open={index === 0}>
      <summary>{conflict.localQSO.call} · {conflict.fields.length} changed {conflict.fields.length === 1 ? "field" : "fields"}{conflict.remoteQSO.deletedAt ? " · deleted on Wavelog" : ""}</summary>
      <ConflictMerge conflict={conflict} disabled={locked} onSave={fields => act("sync_resolve", { id: conflict.id, remote_fields: fields, expected_revision: conflict.revision }, `${conflict.localQSO.call} merged locally and queued for the next ${automatic ? "automatic" : "manual"} sync.`)} />
    </details>)}
    <h2>Pending outbox <span className="sync-count">{state?.outbox?.length ?? "—"}</span></h2>
    {state && !state.outbox?.length ? <p>No pending local changes.</p> : <div className="sync-table-scroll"><table className="sync-outbox"><thead><tr><th scope="col">Callsign</th><th scope="col">Attempts</th><th scope="col">State</th><th scope="col">Action</th></tr></thead><tbody>{state?.outbox?.map((entry: Data) => <tr key={entry.id}><th scope="row">{entry.call}</th><td>{entry.attempt_count}</td><td>{entry.waiting ? "Waiting" : entry.has_error ? "Failed" : "Queued"}</td><td><button disabled={locked} onClick={() => void act("sync_retry", { id: entry.id }, `${entry.call} requeued for the next ${automatic ? "automatic" : "manual"} sync.`)}>Requeue</button></td></tr>)}</tbody></table></div>}
  </section>;
}

function ConflictMerge({ conflict, disabled, onSave }: { conflict: Conflict; disabled: boolean; onSave: (fields: string[]) => Promise<unknown> }) {
  const [reviewedRevision, setReviewedRevision] = useState(conflict.revision);
  const [remoteFields, setRemoteFields] = useState<Set<string>>(() => new Set());
  const changed = reviewedRevision !== conflict.revision;
  const remoteCount = conflict.fields.filter(field => remoteFields.has(field.key)).length;
  const choose = (key: string, remote: boolean) => setRemoteFields(current => { const next = new Set(current); if (remote) next.add(key); else next.delete(key); return next; });
  const display = (field: Field, remote: boolean) => {
    const qso = remote ? conflict.remoteQSO : conflict.localQSO;
    if (["start", "end", "deletedAt"].includes(field.key) && qso[field.key]) return `${String(qso[field.key]).replace("T", " ").replace("Z", " UTC")}`;
    if (["frequencyHz", "receiveFrequencyHz"].includes(field.key) && typeof qso[field.key] === "number") return `${(qso[field.key] / 1e6).toFixed(6)} MHz`;
    return remote ? field.remote : field.local;
  };
  return <div className="sync-merge">
    {changed && <div className="sync-stale" role="alert"><p>This contact changed while you were choosing fields. Review the updated values before saving.</p><button disabled={disabled} onClick={() => { setRemoteFields(new Set()); setReviewedRevision(conflict.revision); }}>Review updated values</button></div>}
    <div className="live-actions"><button disabled={disabled || changed} onClick={() => setRemoteFields(new Set())}>All local</button><button disabled={disabled || changed} onClick={() => setRemoteFields(new Set(conflict.fields.map(field => field.key)))}>All remote</button><span className="secondary">{remoteCount} Wavelog · {conflict.fields.length - remoteCount} local</span></div>
    {!conflict.fields.length ? <p>The contact values match. Save to clear this conflict and retain the local contact.</p> : <div className="sync-table-scroll"><table className="sync-field-table"><thead><tr><th scope="col">Field</th><th scope="col">Local logbook</th><th scope="col">Wavelog</th></tr></thead><tbody>{conflict.fields.map(field => <tr key={field.key}>
      <th scope="row">{field.label}</th>{[false, true].map(remote => <td key={String(remote)}><label className={`sync-choice ${remoteFields.has(field.key) === remote ? "chosen" : ""}`}><input type="radio" name={`${conflict.id}.${field.key}`} aria-label={`${field.label} ${remote ? "remote" : "local"}`} checked={remoteFields.has(field.key) === remote} disabled={disabled || changed} onChange={() => choose(field.key, remote)} /><span>{display(field, remote)}</span></label></td>)}
    </tr>)}</tbody></table></div>}
    <div className="live-actions sync-merge-save"><span className="secondary">Save locally and queue for the next sync.</span><button className="primary" disabled={disabled || changed} onClick={() => void onSave([...remoteFields].sort())}>Save merged contact</button></div>
  </div>;
}

import { useCallback, useEffect, useRef, useState } from "react";
import "./SyncPanel.css";
import { connectSyncChanges } from "./syncChanges";
import { SyncMutationClient } from "./syncMutation";
import { useSettingsSaveToast } from "./SettingsSaveToast";

type Data = Record<string, any>;
type Request = (method: string, params?: Data) => Promise<Data>;
type Field = { key: string; label: string; local: string; remote: string };
type Conflict = { id: string; revision: string; fields: Field[]; localQSO: Data; remoteQSO: Data };
type HeldGroup = { identity: string; remote_ids: number[]; differing_fields: string[]; value_shapes: string[] };
type SyncRun = { run_id: string; trigger: "automatic" | "manual"; outcome: string; started_at: string; finished_at: string | null;
  upload_tracking: boolean; upload_attempts: number | null; confirmed_creates: number | null; confirmed_updates: number | null;
  confirmed_deletes: number | null; unknown_writes: number | null; upload_counts_complete: boolean; report_counts: Data | null };
const runOutcomes: Record<string, string> = { running: "Running", completed: "Completed", completed_with_failures: "Completed with failures",
  failed: "Failed", cancelled: "Cancelled", interrupted: "Interrupted · completion unknown" };
const syncRunsFrom = (value: unknown): SyncRun[] => !Array.isArray(value) ? [] : value.slice(0, 100).filter((item): item is SyncRun =>
  !!item && typeof item === "object" && typeof item.run_id === "string" && ["automatic", "manual"].includes(item.trigger)
  && Object.prototype.hasOwnProperty.call(runOutcomes, item.outcome) && typeof item.started_at === "string"
  && typeof item.upload_tracking === "boolean" && typeof item.upload_counts_complete === "boolean"
  && ["upload_attempts", "confirmed_creates", "confirmed_updates", "confirmed_deletes", "unknown_writes"].every(key =>
    item[key] === null || Number.isSafeInteger(item[key]) && item[key] >= 0));
type Props = { request: Request; onChanged: () => void; journalKey?: string };
const errorText = (error: unknown) => error instanceof Error ? error.message : "The operation failed. Refresh the current sync state and retry.";
const syncTime = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "—";
const heldIdentityLabel = (identity: string) => {
  const [call, , band, mode] = identity.split("|");
  return [call, band, mode].filter(Boolean).join(" · ") || "Held Wavelog records";
};
const heldGroupsFrom = (value: unknown): HeldGroup[] => !Array.isArray(value) ? [] : value.flatMap(item => {
  if (!item || typeof item !== "object") return [];
  const group = item as Data;
  return [{
    identity: typeof group.identity === "string" ? group.identity : "",
    remote_ids: Array.isArray(group.remote_ids) ? group.remote_ids.filter(Number.isInteger) : [],
    differing_fields: Array.isArray(group.differing_fields) ? group.differing_fields.filter((field): field is string => typeof field === "string") : [],
    value_shapes: Array.isArray(group.value_shapes) ? group.value_shapes.filter((shape): shape is string => typeof shape === "string") : [],
  }];
});

export default function SyncPanel({ request, onChanged, journalKey = "xlog.sync.mutation.main.v1" }: Props) {
  const [state, setState] = useState<Data | null>(null);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const saveToast = useSettingsSaveToast();
  const [setupMessage, setSetupMessage] = useState("");
  const [subscriptionError, setSubscriptionError] = useState("");
  const [verified, setVerified] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(false);
  const [interval, setIntervalMinutes] = useState("5");
  const [unresolved, setUnresolved] = useState(false);
  const mutation = useRef<SyncMutationClient | null>(null);
  if (!mutation.current) mutation.current = new SyncMutationClient(journalKey);
  const intervalEdited = useRef(false), finished = useRef<string | null>(null), changed = useRef(onChanged);
  changed.current = onChanged;
  const mounted = useRef(false), working = useRef(false), sequence = useRef(0), polling = useRef(false);
  const refreshPending = useRef(false);
  const currentRequest = useRef(request); currentRequest.current = request;
  const read = useCallback(async () => {
    const revision = ++sequence.current;
    try {
      const next = await currentRequest.current("sync_status");
      if (mounted.current && revision === sequence.current) {
        setState(next);
        try {
          await mutation.current!.recover(currentRequest.current);
          if (!mounted.current || revision !== sequence.current) return;
          setUnresolved(false); setVerified(!!next.mutation_owner);
        } catch (cause) {
          if (!mounted.current || revision !== sequence.current) return;
          setUnresolved(true); setVerified(false); setError(current => current || errorText(cause));
        }
        if (!next.running) setMessage(current => current.startsWith("Synchronization started.") ? "" : current);
        if (!intervalEdited.current) setIntervalMinutes(String(next.interval_minutes || 5));
        if (next.finished_at && finished.current !== next.finished_at) {
          finished.current = next.finished_at;
          changed.current();
        }
      }
    } catch (cause) { if (mounted.current && revision === sequence.current) { setVerified(false); setError(errorText(cause)); } }
  }, []);
  const refresh = useCallback(async () => {
    sequence.current++; setVerified(false);
    refreshPending.current = true;
    if (polling.current || working.current || !mounted.current) return;
    polling.current = true;
    try {
      do { refreshPending.current = false; await read(); }
      while (mounted.current && refreshPending.current && !working.current);
    } finally { polling.current = false; }
  }, [read]);
  useEffect(() => {
    mounted.current = true;
    const dispose = connectSyncChanges(() => { void refresh(); }, setSubscriptionError);
    return () => { mounted.current = false; sequence.current++; dispose(); };
  }, [refresh, request]);
  const act = async (method: string, params: Data, success: string) => {
    if (working.current) return;
    working.current = true; sequence.current++; setBusy(true); setError(""); setMessage("");
    try {
      await mutation.current!.submit(request, state?.mutation_owner, method, params);
      if (mounted.current) {
        if (method === "sync_configure") { intervalEdited.current = false; saveToast.show(success); }
        else setMessage(success);
        await read(); onChanged();
      }
    } catch (cause) {
      if (mounted.current) { setError(errorText(cause)); await read(); }
    } finally { working.current = false; if (mounted.current) { setBusy(false); if (refreshPending.current) void refresh(); } }
  };
  const locked = busy || state?.running === true || !verified;
  const automatic = state?.automatic_sync === true;
  const available = verified && !!state && state.sync_available !== false;
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
  const heldGroups = heldGroupsFrom(state?.held_groups);
  const recentRuns = syncRunsFrom(state?.recent_runs);
  return <section className="live-sync sync-panel" aria-label="Wavelog synchronization">
    <h2>Wavelog synchronization</h2>
    <button type="button" disabled={busy || checkingSetup} onClick={() => { setError(""); void refresh(); }}>Refresh Sync state</button>
    <p>Sync sends pending local changes and reconciles Wavelog edits and deletions. Stop the original xLog and every other sync writer before using this logbook as the active Wavelog writer.</p>
    {state?.mode === "local" && <p role="status">Integrated-only mode keeps your contacts and pending changes here. To use Wavelog, save Integrated logbook + Wavelog synchronization in Settings → Logbook, then explicitly synchronize or enable automatic sync.</p>}
    <div className="sync-setup"><button disabled={locked || !available || checkingSetup} onClick={() => void checkSetup()}>{checkingSetup ? "Checking setup…" : "Check setup"}</button><p aria-live="polite">{setupMessage || "Queued contacts with 0 attempts have not been uploaded yet. Conflicting edits always need your review."}</p></div>
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
    {state && !verified && <p className="secondary" role="status">Sync state is being refreshed or is unavailable. Retained values are display only; actions are disabled.</p>}
    {state?.finished_at && typeof state.pulled === "number" && <p className="secondary">{state.pushed} local contacts acknowledged · {state.pulled.toLocaleString()} remote records checked · {state.deleted} deletions reconciled · {state.failed} failures</p>}
    {state && <section aria-label="Sync run history">
      <h2>Recent sync runs</h2>
      <p className="secondary">Receipts survive restart; the newest 100 runs are retained. Earlier activity cannot be reconstructed from these receipts.</p>
      {!recentRuns.length ? <p>No durable run receipts yet. Earlier upload counts are unknown.</p> : recentRuns.map((run, index) =>
        <details className="sync-conflict" key={run.run_id} open={index === 0}>
          <summary>{run.trigger === "automatic" ? "Automatic" : "Manual"} · {runOutcomes[run.outcome]} · {syncTime(run.started_at)}</summary>
          <p>Directions: local changes to Wavelog; Wavelog history to this logbook.</p>
          <p>Started: {syncTime(run.started_at)} · Finished: {run.finished_at ? syncTime(run.finished_at) : "Not confirmed"}</p>
          {run.upload_tracking ? <>
            <p>Confirmed remote writes: {run.confirmed_creates} creates · {run.confirmed_updates} updates · {run.confirmed_deletes} deletes.</p>
            {!run.upload_counts_complete && <p className="secondary">Upload totals are incomplete. Counts show confirmed writes so far.</p>}
            {Number(run.unknown_writes) > 0 && <p className="sync-error">{run.unknown_writes} write attempts have an unknown outcome. Confirmed counts are partial.</p>}
          </> : <p>Upload counts unavailable for this run.</p>}
          {run.report_counts && <p>{run.report_counts.acknowledged_contacts} local contacts acknowledged · {run.report_counts.remote_contacts_processed} remote records processed · {run.report_counts.deletions_reconciled} deletions reconciled · {run.report_counts.failures} failures.</p>}
          <p className="secondary">Acknowledged contacts can include unchanged records. Remote records processed are not a count of new local contacts.</p>
        </details>)}
    </section>}
    {state?.run_receipt_error && <p className="sync-error">{String(state.run_receipt_error)}</p>}
    {Number(state?.held) > 0 && <div className="sync-held">
      <p role="status"><strong>{Number(state?.held).toLocaleString()} Wavelog records held for review.</strong> The same logging identity appears under multiple distinct Wavelog record IDs. Confirmation services may legitimately update ADIF fields, but xLog cannot determine which exported row belongs to which ID. These contacts and their pending edits remain unchanged; other contacts continue to synchronize.</p>
      {heldGroups.length > 0 && <div className="sync-held-groups" aria-label="Held Wavelog record groups">{heldGroups.map(group => <details className="sync-held-group" key={`${group.identity}:${group.remote_ids.join(",")}`}>
        <summary>{heldIdentityLabel(group.identity)} · {group.remote_ids.length.toLocaleString()} Wavelog IDs · {group.differing_fields.length.toLocaleString()} differing {group.differing_fields.length === 1 ? "field" : "fields"}</summary>
        <dl>
          <div><dt>Wavelog IDs</dt><dd>{group.remote_ids.join(", ") || "Unavailable"}</dd></div>
          <div><dt>Differing fields</dt><dd>{group.differing_fields.join(", ") || "No field names available"}</dd></div>
          {group.value_shapes.length > 0 && <div><dt>Difference shape</dt><dd>{group.value_shapes.join(" · ")}</dd></div>}
        </dl>
      </details>)}</div>}
      <p>Review the listed record IDs in Wavelog before editing or removing either record.</p>
    </div>}
    {error && <p className="sync-error" role="alert">{error}</p>}
    {unresolved && <button disabled={busy || !state} onClick={() => {
      try { mutation.current!.discard(); setUnresolved(false); setError(""); void refresh(); }
      catch (cause) { setError(errorText(cause)); }
    }}>I reviewed the current state; dismiss unresolved Sync intent</button>}
    {subscriptionError && <p className="sync-error" role="alert">{subscriptionError}</p>}
    {message && <p className="sync-success" role="status">{message}</p>}
    {saveToast.toast}
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

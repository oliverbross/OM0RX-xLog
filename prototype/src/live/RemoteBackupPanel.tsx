import { useCallback, useEffect, useRef, useState } from "react";

type Data = Record<string, any>;
type Request = (method: string, params?: Record<string, unknown>) => Promise<Data>;
type Intent = { action: string; operation_id: string; owner: Data };
const stable = (value: Data) => JSON.stringify(value, Object.keys(value).sort());
const message = (cause: unknown) => cause instanceof Error ? cause.message : "Backup status is unavailable. Refresh before another action.";

/** Native-only offers/proofs/plans. Mount, focus and recovery perform reads only. */
export default function RemoteBackupPanel({ request, visible }: { request: Request; visible: boolean }) {
  const key = `xlog.remote-backup.intent.v1.${window.location.search || "main"}`;
  const [state, setState] = useState<Data | null>(null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false), [verified, setVerified] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const sequence = useRef(0), working = useRef(false), live = useRef(false);
  const reviewedOwner = useRef("");
  const read = useCallback(async () => {
    const version = ++sequence.current; setVerified(false);
    try {
      const next = await request("remote_backup_request", { action: "snapshot" });
      if (!live.current || sequence.current !== version) return;
      if (!next || typeof next.available !== "boolean" || typeof next.owner?.generation !== "string"
        || !Number.isSafeInteger(next.owner?.revision) || next.owner.revision < 0
        || !(next.owner.token === null || typeof next.owner.token === "string"))
        throw new Error("Remote backup ownership is unavailable. Refresh before another action.");
      if (reviewedOwner.current !== stable(next.owner ?? {})) setConfirmed(false);
      reviewedOwner.current = stable(next.owner ?? {});
      setState(next);
      const raw = localStorage.getItem(key);
      if (raw) {
        const intent: Intent = JSON.parse(raw);
        const recovery = await request("remote_backup_request", { action: "receipt", generation: intent.owner.generation, operation_id: intent.operation_id });
        if (!live.current || sequence.current !== version) return;
        const receipt = recovery.receipt;
        if (!receipt || receipt.operation_id?.toLowerCase() !== intent.operation_id.toLowerCase()
          || receipt.status !== "acknowledged" || receipt.request?.action !== intent.action
          || stable(receipt.request.owner ?? {}) !== stable(intent.owner)) {
          setPending(true); throw new Error("The last backup command has an unknown outcome. Review current status; it will not be replayed.");
        }
        localStorage.removeItem(key);
      }
      setPending(false); setVerified(true); setError("");
    } catch (cause) {
      if (live.current && sequence.current === version) {
        try { setPending(!!localStorage.getItem(key)); } catch { setPending(true); }
        setError(message(cause));
      }
    }
  }, [request, key]);
  useEffect(() => {
    live.current = true;
    if (!visible) return () => { live.current = false; sequence.current++; };
    void read();
    const focus = () => { if (!working.current) void read(); };
    window.addEventListener("focus", focus);
    return () => { live.current = false; sequence.current++; window.removeEventListener("focus", focus); };
  }, [visible, read]);
  const act = async (action: string) => {
    if (working.current || !verified || pending || !state?.available) return;
    working.current = true; setBusy(true); setVerified(false); setError(""); sequence.current++;
    try {
      if (localStorage.getItem(key)) throw new Error("Review the unresolved backup command before another action.");
      const intent: Intent = { action, operation_id: crypto.randomUUID(), owner: state.owner };
      const raw = JSON.stringify(intent); localStorage.setItem(key, raw);
      if (localStorage.getItem(key) !== raw) throw new Error("Backup intent could not be saved. No command was sent.");
      setPending(true);
      // An uncertain reply is reconciled with a receipt, never a repeated write.
      await request("remote_backup_request", intent);
    } catch (cause) { if (live.current) setError(message(cause)); }
    finally { working.current = false; if (live.current) { setBusy(false); setConfirmed(false); await read(); } }
  };
  const locked = busy || !verified || pending || state?.busy === true;
  if (!visible) return null;
  return <section className="live-data-section" aria-label="Remote backup account and status">
    <div className="live-data-section-title"><h3>Remote backup</h3><button type="button" disabled={busy} onClick={() => void read()}>Refresh remote backup status</button></div>
    {!state ? <p>Reading remote backup availability…</p> : !state.available
      ? <p>Remote backup account setup and execution are unavailable in this build. Continue using verified local backups above.</p>
      : <>
        <p>Review the native account and frozen backup, verify its registration, approve this one backup, then explicitly start it. Approval and reopening this screen never start or resume a backup.</p>
        <button type="button" disabled={locked || state.running} onClick={() => void act("prepare")}>Review native Dropbox setup</button>
        {state.prepared && <>
          <dl><dt>Account</dt><dd>{state.account}</dd><dt>Destination folder</dt><dd>{state.folder}</dd><dt>Backup</dt><dd>{state.backup_id} · {state.byte_count?.toLocaleString()} bytes</dd></dl>
          <p role="status">{state.running ? "Backup execution is active. This is not verified completion." : state.upload_outcome ? "Backup execution finished; review its durable outcome below." : state.approved ? "Approved; waiting for explicit Start." : state.registered ? "Native account registration verified; backup not approved." : "Account registration requires native verification."}</p>
          {state.upload_outcome && <p role="status">Durable upload outcome: {state.upload_outcome}.{state.remote_identity_recorded ? " Provider object identity is recorded." : " No pinned provider object identity is recorded."}</p>}
          <button type="button" disabled={locked || state.running || state.registered} onClick={() => void act("verify_account")}>Verify native account registration</button>
          <label><input type="checkbox" disabled={locked || state.running || !state.registered} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I approve this account, destination and one backup.</label>
          <button type="button" disabled={locked || state.running || !state.registered || !confirmed} onClick={() => void act("approve")}>Approve one backup</button>
          <button type="button" disabled={locked || state.running || !!state.upload_outcome || !state.registered || !state.approved} onClick={() => void act("start")}>Start approved backup</button>
          <button type="button" disabled={locked || !state.running} onClick={() => void act("stop")}>Stop backup</button>
          <button type="button" disabled={locked || !state.approved} onClick={() => void act("revoke")}>Revoke backup approval</button>
          <button type="button" disabled={locked || !state.approved || !state.registered} onClick={() => void act("review_retention")}>Review retained backup evidence</button>
          <button type="button" disabled={locked || state.running || !state.approved || !state.registered
            || state.upload_outcome !== "verified" || state.remote_identity_recorded !== true}
            onClick={() => void act("stage_restore")}>Download verified backup for restore review</button>
        </>}
      </>}
    <p className="secondary">Remote deletion is unavailable. Retention review cannot delete backups. Unknown outcomes require a status review and are never retried automatically.</p>
    {state?.retention_review && <p role="status">Retained evidence review: {state.retention_review.protected} protected · {state.retention_review.candidates} candidates for a future review. No deletion is authorized.</p>}
    {state?.staged_restore && <p role="status">Verified remote backup staged locally as {state.staged_restore.name} ({state.staged_restore.qso_count?.toLocaleString()} contacts). Inspect it under Local backups before an explicit restore.</p>}
    {error && <p role="alert" className="live-data-feedback error">{error}</p>}
    {pending && <button type="button" disabled={busy || !state} onClick={() => {
      try { localStorage.removeItem(key); setPending(false); void read(); } catch (cause) { setError(message(cause)); }
    }}>I reviewed current status; dismiss unresolved backup intent</button>}
  </section>;
}

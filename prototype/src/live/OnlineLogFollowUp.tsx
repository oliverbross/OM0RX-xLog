import { useEffect, useRef, useState } from "react";
import { sameGeneration, validGeneration } from "./operatorDraftSession";
import "./onlineLogFollowUp.css";

type Request = (method: string, params?: Record<string, unknown>) => Promise<any>;
type Upload = { service: "qrz" | "club_log"; state: string | null; receipt_revision: number | null; current_revision: boolean;
  attempt_age_seconds: number | null; last_attempt_at: string | null; acceptance_age_seconds: null };
type Confirmation = { source: "paper" | "lotw" | "eqsl"; received_status: string; received_date: string | null; match_age_seconds: null };
type FollowUp = { contact_id: string; contact_revision: number; uploads: Upload[]; confirmations: Confirmation[];
  award_impact: "excludedDeletedContact" | "noRetainedConfirmation" | "retainedConfirmationRequiresAwardRules"; sponsor_credit: null };
const unwrap = (value: any) => value?.result ?? value;
const whole = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const retainedString = (value: unknown): value is string => typeof value === "string" && value.length <= 65_536;
const states = ["dispatching", "deferred", "delivered", "rejected", "uncertain"];

export function readOnlineLogFollowUp(response: any, contactID: string, generation: string): FollowUp {
  const invalid = () => { throw new Error("The retained follow-up response could not be verified. Refresh retained status."); };
  const value = unwrap(response), item = value?.follow_up;
  if (!sameGeneration(value?.generation, generation) || value?.read_only !== true || !item
    || typeof item.contact_id !== "string" || item.contact_id.toLowerCase() !== contactID.toLowerCase()
    || !whole(item.contact_revision) || item.sponsor_credit !== null
    || !["excludedDeletedContact", "noRetainedConfirmation", "retainedConfirmationRequiresAwardRules"].includes(item.award_impact)
    || !Array.isArray(item.uploads) || item.uploads.length !== 2
    || !Array.isArray(item.confirmations) || item.confirmations.length !== 3) return invalid();
  for (const [index, row] of item.uploads.entries()) {
    if (!row || row.service !== ["qrz", "club_log"][index] || row.acceptance_age_seconds !== null
      || typeof row.current_revision !== "boolean" || !(row.state === null || states.includes(row.state))
      || !(row.receipt_revision === null || whole(row.receipt_revision) && row.receipt_revision <= item.contact_revision)
      || row.current_revision !== (row.receipt_revision === item.contact_revision)
      || !(row.attempt_age_seconds === null || typeof row.attempt_age_seconds === "number" && Number.isFinite(row.attempt_age_seconds) && row.attempt_age_seconds >= 0)
      || !(row.last_attempt_at === null || typeof row.last_attempt_at === "string" && Number.isFinite(Date.parse(row.last_attempt_at)))
      || (row.state === null) !== (row.receipt_revision === null)
      || row.state === null && (row.last_attempt_at !== null || row.attempt_age_seconds !== null)) return invalid();
  }
  for (const [index, row] of item.confirmations.entries()) {
    if (!row || row.source !== ["paper", "lotw", "eqsl"][index] || !retainedString(row.received_status)
      || !(row.received_date === null || retainedString(row.received_date)) || row.match_age_seconds !== null) return invalid();
  }
  return item as FollowUp;
}

const provider = { qrz: "QRZ", club_log: "Club Log" };
const confirmation = { paper: "Paper QSL", lotw: "LoTW", eqsl: "eQSL" };
const stateLabel: Record<string, string> = { dispatching: "Dispatch recorded; outcome pending", deferred: "Deferred",
  delivered: "Upload accepted", rejected: "Rejected", uncertain: "Delivery uncertain — review required" };
const age = (seconds: number | null) => seconds === null ? "Unknown" : `${Math.floor(seconds).toLocaleString()} seconds at read`;

/** Click-only local reads. Changing contact/workspace context retires in-flight
 * results; refresh events clear displayed evidence and never start another read. */
export function OnlineLogFollowUpPanel({ contactID, call, onRequest, refreshKey, onClose }: {
  contactID: string; call: string; onRequest: Request; refreshKey: number; onClose?: () => void;
}) {
  const context = `${contactID}:${refreshKey}`, current = useRef(context); current.current = context;
  const sequence = useRef(0);
  const [snapshot, setSnapshot] = useState<{ context: string; value: FollowUp } | null>(null);
  const [reading, setReading] = useState(false), [error, setError] = useState("");
  useEffect(() => { sequence.current++; setSnapshot(null); setReading(false); setError(""); return () => { sequence.current++; }; }, [context, onRequest]);
  async function read() {
    const ticket = ++sequence.current, expected = context;
    setReading(true); setSnapshot(null); setError("");
    try {
      const contact = unwrap(await onRequest("logbook_contact", { contactID }));
      if (ticket !== sequence.current || current.current !== expected) return;
      if (!validGeneration(contact?.generation) || !sameGeneration(contact.contact?.generation, contact.generation)
        || typeof contact.contact?.qso?.id !== "string" || contact.contact.qso.id.toLowerCase() !== contactID.toLowerCase())
        throw new Error("This contact is unavailable. Refresh the Logbook.");
      const response = await onRequest("logbook_follow_up", { contactID, generation: contact.generation });
      if (ticket !== sequence.current || current.current !== expected) return;
      setSnapshot({ context: expected, value: readOnlineLogFollowUp(response, contactID, contact.generation) });
    } catch (cause) {
      if (ticket === sequence.current && current.current === expected)
        setError(cause instanceof Error ? cause.message : "Retained follow-up is unavailable.");
    } finally { if (ticket === sequence.current && current.current === expected) setReading(false); }
  }
  const value = snapshot?.context === context ? snapshot.value : null;
  return <section className="online-log-follow-up" aria-label={`Upload follow-up for ${call}`} aria-busy={reading} tabIndex={0}>
    <header><h3>{call} · Upload follow-up</h3><div><button type="button" disabled={reading} onClick={() => void read()}>Refresh retained status</button>
      {onClose && <button type="button" onClick={onClose}>Close follow-up</button>}</div></header>
    <p>Reads saved local evidence only. Provider acceptance age, match age and sponsor credit are unknown. Upload acceptance does not establish confirmation.</p>
    {reading ? <p role="status">Reading retained status…</p> : error ? <p role="alert">{error}</p>
      : !value ? <p role="status">Use Refresh retained status to inspect this contact. Contact changes require a fresh read.</p> : <>
        <p>Contact revision {value.contact_revision}. Ages are fixed at this read.</p>
        <div className="follow-up-providers">{value.uploads.map(row => <article key={row.service} aria-label={`${provider[row.service]} upload`}>
          <h4>{provider[row.service]}</h4><p>{row.state ? stateLabel[row.state] : "No retained upload receipt"}</p>
          <dl><div><dt>Receipt scope</dt><dd>{row.receipt_revision === null ? "Unknown" : `${row.current_revision ? "Current" : "Historical"} revision ${row.receipt_revision}`}</dd></div>
            <div><dt>Last attempt (UTC)</dt><dd>{row.last_attempt_at ?? "Unknown"}</dd></div>
            <div><dt>Attempt age</dt><dd>{age(row.attempt_age_seconds)}</dd></div>
            <div><dt>Acceptance age</dt><dd>Unknown</dd></div></dl>
          {row.receipt_revision !== null && !row.current_revision && <p>The receipt describes an earlier revision; upload of the current revision is unknown.</p>}
        </article>)}</div>
        <h4>Retained confirmation fields</h4><div className="follow-up-confirmations">{value.confirmations.map(row => <article key={row.source}>
          <h5>{confirmation[row.source]}</h5><dl><div><dt>Received status</dt><dd>{row.received_status || "Not recorded"}</dd></div>
            <div><dt>Retained date</dt><dd>{row.received_date || "Not recorded"}</dd></div><div><dt>Match age</dt><dd>Unknown</dd></div></dl>
        </article>)}</div>
        <p>{value.award_impact === "excludedDeletedContact" ? "Deleted contact: excluded from award impact."
          : value.award_impact === "retainedConfirmationRequiresAwardRules" ? "Retained confirmation evidence requires evaluation against the selected award’s rules."
          : "No affirmative confirmation is retained in these fields."} Sponsor credit: Unknown.</p>
      </>}
  </section>;
}

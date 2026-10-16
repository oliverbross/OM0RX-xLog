import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { requestQSODataQuality, type QSODataQualityEvidence, type QSODataQualityReport } from "../worker";
import { sameGeneration, validGeneration, validScopedSnapshot, type DraftSnapshot } from "./operatorDraftSession";

type Request = (method: string, params?: Record<string, unknown>) => Promise<any>;
const sourceLabels: Record<string, string> = {
  storedFieldOriginUnknown: "Stored field; original source unknown", otherRetainedContact: "Other retained contact",
  suppliedCTYReference: "Local CTY inference, not a replacement", retainedPowerMetadata: "Retained power metadata; not reauthenticated",
  retainedConflictAlternative: "Retained conflict alternative, not a replacement",
};
const dateLabels: Record<string, string> = { fieldOriginUnknown: "Field origin date", powerObservedAt: "Power observation date",
  referenceSourceDate: "Reference source date", conflictDetectedAt: "Conflict detection date" };
const impacts: Record<string, string> = { validationReview: "Validation review", dxccDependentViewsAndRules: "DXCC-dependent views and rules",
  powerDependentRules: "Power-dependent rules", exportAndSyncReview: "Export and sync review", existingConflictOwnerReview: "Existing conflict-owner review" };
function validEvidence(value: any): value is QSODataQualityEvidence {
  return value && ["field", "value", "source", "dateRole"].every(key => typeof value[key] === "string") &&
    ["date", "rawDate", "referenceSource", "referenceVersion"].every(key => value[key] === null || typeof value[key] === "string") &&
    (value.date === null || Number.isFinite(Date.parse(value.date)));
}
function validReport(value: QSODataQualityReport) {
  const duplicate = value.duplicateReview;
  const validDuplicate = duplicate == null || duplicate.rule === "nativePossibleDuplicate600SecondsV1" &&
    duplicate.windowSeconds === 600 && duplicate.candidateLimit === 5 && ["complete", "truncated", "unknown"].includes(duplicate.status) &&
    Array.isArray(duplicate.unresolvedRequirements) && duplicate.unresolvedRequirements.every(item => typeof item === "string") &&
    Array.isArray(duplicate.candidates) && duplicate.candidates.length <= 5 &&
    new Set(duplicate.candidates.map(item => typeof item?.contactID === "string" ? item.contactID.toLowerCase() : null)).size === duplicate.candidates.length &&
    (duplicate.status !== "truncated" || duplicate.candidates.length === 5) &&
    (duplicate.status === "unknown" ? duplicate.candidates.length === 0 && duplicate.unresolvedRequirements.length > 0 : duplicate.unresolvedRequirements.length === 0) &&
    duplicate.candidates.every(item => item && validGeneration(item.contactID) && item.contactID.toLowerCase() !== value.contactID.toLowerCase() &&
      Number.isSafeInteger(item.contactRevision) && item.contactRevision >= 0 && [item.call, item.band, item.mode].every(field => typeof field === "string") &&
      typeof item.contactStart === "string" && Number.isFinite(Date.parse(item.contactStart)));
  return validDuplicate && Array.isArray(value.retainedFields) && value.retainedFields.length <= 8 && value.retainedFields.every(validEvidence) &&
    (value.referenceComparison === null || validEvidence(value.referenceComparison)) &&
    (value.retainedPowerObservation === null || validEvidence(value.retainedPowerObservation)) &&
    Array.isArray(value.findings) && value.findings.length <= 100 && value.findings.every(finding =>
      finding && ["field", "severity", "message"].every(key => typeof (finding as any)[key] === "string") && validEvidence(finding.retained) &&
      (finding.comparison === null || validEvidence(finding.comparison)) && Array.isArray(finding.reviewImpacts) &&
      finding.reviewImpacts.every(value => typeof value === "string"));
}
function DuplicateReview({ value }: { value: QSODataQualityReport["duplicateReview"] }) {
  const unknownLabels: Record<string, string> = { deletedContact: "Deleted contact", invalidContactDate: "Invalid QSO date",
    missingCall: "Missing callsign", missingBand: "Missing band", missingMode: "Missing mode" };
  return <section aria-label="Read-only possible duplicate review">
    <h4>Possible duplicates · review only</h4>
    <p>Native rule: same retained callsign, band and primary mode (case-insensitive), within ±600 seconds. Self and deleted contacts excluded. No frequency, submode or portable-call inference; not proof of semantic equivalence.</p>
    {!value ? <p>Duplicate review: Unknown / unavailable.</p> : <>
      <p>{value.status === "unknown" ? `Duplicate review unknown: ${value.unresolvedRequirements.map(item => unknownLabels[item] ?? "Unresolved input").join("; ")}.`
        : value.status === "truncated" ? "Incomplete: showing the nearest 5 candidates; more exist. Total candidate count unknown."
        : value.candidates.length ? `Complete for this bounded rule: ${value.candidates.length} candidate(s).`
        : "No candidates under this bounded rule. This does not establish that the contact is unique."}</p>
      {!!value.candidates.length && <ul>{value.candidates.map(candidate => <li key={candidate.contactID}>
        <p>{candidate.call} · {candidate.band} {candidate.mode} · QSO start {candidate.contactStart} (UTC)</p>
        <p>Contact {candidate.contactID}, revision {candidate.contactRevision}. Source: canonical retained contact; original field source/date unknown.</p>
      </li>)}</ul>}
    </>}
    <p>Possible matches may be intentional separate contacts. No merge, deletion, correction, award or sync delta is proposed.</p>
  </section>;
}
function Evidence({ value }: { value: QSODataQualityEvidence }) {
  return <dl className="qso-quality-evidence">
    <div><dt>Field / retained value</dt><dd>{value.field}: {value.value || "Not recorded"}</dd></div>
    <div><dt>Source</dt><dd>{sourceLabels[value.source] ?? "Unknown"}</dd></div>
    <div><dt>{dateLabels[value.dateRole] ?? "Date role unknown"}</dt><dd>{value.date ? `${value.date} (UTC)` : "Unknown"}</dd></div>
    {value.rawDate !== null && <div><dt>Retained date text</dt><dd>{value.rawDate || "Not recorded"}</dd></div>}
    {(value.source === "suppliedCTYReference" || value.source === "retainedPowerMetadata") && <>
      <div><dt>Reference / metadata source</dt><dd>{value.referenceSource ?? "Unknown"}</dd></div>
      <div><dt>Reference version</dt><dd>{value.referenceVersion ?? "Unknown"}</dd></div>
    </>}
  </dl>;
}

/** A single canonical Details read owns this review. Findings never upgrade its scope. */
export function LogbookContactReview({ contactID, call, onRequest, pageContext, pageLoading = false, renderContact }: {
  contactID: string; call: string; onRequest: Request; pageContext: unknown;
  pageLoading?: boolean;
  renderContact: (snapshot: DraftSnapshot) => ReactNode;
}) {
  const [contact, setContact] = useState<DraftSnapshot | null>(null);
  const [report, setReport] = useState<QSODataQualityReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true), [reading, setReading] = useState(false), [retired, setRetired] = useState(false);
  const sequence = useRef(0), scope = useRef<DraftSnapshot | null>(null), pending = useRef(false);
  useLayoutEffect(() => {
    const ticket = ++sequence.current;
    scope.current = null; pending.current = false; setContact(null); setReport(null); setError(""); setRetired(false); setLoading(true); setReading(false);
    if (pageLoading) return () => { sequence.current++; scope.current = null; };
    void onRequest("logbook_contact", { contactID }).then(response => {
      if (ticket !== sequence.current) return;
      const value = response?.result ?? response;
      if (!validScopedSnapshot(value?.contact) || !sameGeneration(value.generation, value.contact.generation) ||
          value.contact.qso.id.toLowerCase() !== contactID.toLowerCase() || value.contact.qso.deletedAt)
        throw new Error("This contact is unavailable. Close Details and refresh the Logbook.");
      scope.current = value.contact; setContact(value.contact);
    }).catch(cause => {
      if (ticket === sequence.current) setError(cause instanceof Error ? cause.message : "Contact unavailable. Close Details and refresh the Logbook.");
    }).finally(() => { if (ticket === sequence.current) setLoading(false); });
    return () => { sequence.current++; scope.current = null; };
  }, [contactID, onRequest, pageContext, pageLoading]);
  async function inspect() {
    const current = scope.current;
    if (!current || pending.current || retired) return;
    pending.current = true;
    const ticket = ++sequence.current;
    setReport(null); setError(""); setReading(true);
    try {
      const response = await requestQSODataQuality({ contactID: current.qso.id, generation: current.generation!, expectedRevision: current.revision }, onRequest);
      if (ticket !== sequence.current || scope.current !== current) return;
      if (response.status || !response.data_quality) {
        scope.current = null; setContact(null); setRetired(true);
        throw new Error("This contact changed or is unavailable. Close Details and refresh the Logbook before another review.");
      }
      if (!validReport(response.data_quality)) throw new Error("Findings could not be verified. Close Details and refresh the Logbook.");
      setReport(response.data_quality);
    } catch (cause) {
      if (ticket === sequence.current) {
        scope.current = null; setContact(null); setRetired(true); setReport(null);
        setError(cause instanceof Error ? cause.message : "Findings unavailable. Close Details and refresh the Logbook.");
      }
    } finally { if (ticket === sequence.current) { pending.current = false; setReading(false); } }
  }
  return <section id="logbook-contact-details" className="live-logbook-contact-review" aria-label={`Details for ${call}`} aria-busy={loading || reading} tabIndex={0}>
    {loading ? <p role="status">Reading canonical contact…</p> : contact && renderContact(contact)}
    <section className="qso-quality" aria-label="Read-only data quality">
      <div className="qso-quality-actions"><h3>Data quality · read only</h3><button type="button" disabled={!contact || loading || reading || retired} onClick={() => void inspect()}>Read findings</button></div>
      <p>Stored values remain authoritative. Comparisons are not corrections, eligibility, completion or sponsor credit. No award or sync delta is calculated.</p>
      {contact && <p>Exact contact revision {contact.revision}. Record updated {String(contact.qso.updatedAt ?? "Unknown")} — not a field-origin date.</p>}
      {error && <p role="alert">{error}</p>}
      {reading ? <p role="status">Reading local findings…</p> : report ? <>
        <p>Conflict alternatives not requested. CTY comparison: {report.referenceStatus === "resolved" ? "Resolved locally" : report.referenceStatus === "notProvided" ? "Reference unavailable" : report.referenceStatus === "unresolved" ? "Unresolved" : "Contact date invalid"}.</p>
        <DuplicateReview value={report.duplicateReview} />
        <details><summary>Retained field evidence and reference context</summary>
          {report.retainedFields.map((value, index) => <Evidence key={index} value={value} />)}
          {report.referenceComparison ? <Evidence value={report.referenceComparison} /> : <p>CTY comparison evidence: Unknown.</p>}
          {report.retainedPowerObservation ? <Evidence value={report.retainedPowerObservation} /> : <p>Power observation evidence: Unknown.</p>}
        </details>
        {!report.findings.length ? <p>No findings from these bounded local checks. This is not a complete data-quality or eligibility assessment.</p>
          : <ol className="qso-quality-findings">{report.findings.map((finding, index) => <li key={index}>
            <h4>{finding.field} · {finding.severity}</h4><p>{finding.message}</p><div className="qso-quality-comparison">
              <div><h5>Stored evidence</h5><Evidence value={finding.retained} /></div>
              <div><h5>Comparison only</h5>{finding.comparison ? <Evidence value={finding.comparison} /> : <p>Unknown / not supplied.</p>}</div>
            </div><p>May require review: {finding.reviewImpacts.map(value => impacts[value] ?? "Unknown impact").join("; ") || "Unknown"}. No numerical impact is inferred.</p>
          </li>)}</ol>}
      </> : !loading && !error && <p>Use Read findings for this exact retained contact. No provider or reference refresh is performed.</p>}
    </section>
  </section>;
}

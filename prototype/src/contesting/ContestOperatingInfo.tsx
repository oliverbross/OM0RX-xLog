import { useEffect, useRef, useState } from "react";
import type { ContestMethod, ContestRequest } from "./types";
import { durationText } from "./contestSchedule";

export type OperatingPlan = { ruleProfileID: string; note: string };
export type OperatingInfo = {
  evaluationUTC: string; selectedProfileID: string;
  profile: { label: string; edition: string; sourceURL: string; interpretationURL: string;
    startUTC: string; endUTCExclusive: string; categoryBand: string; scope: string } | null;
  unverifiedReason: string | null; availableProfiles: { id: string; label: string }[]; plan: OperatingPlan;
  qsoCount: number; invalidTimestampQSOs: number; excludedPeriodOrFutureQSOs: number;
  inferredInactivitySeconds: number | null; durationNote: string;
  allowance: { limitMinutes: number; reconstructedMinutes: number; remainingMinutes: number; status: string } | null;
  offTime: { minimumOffMinutes: number; qualifyingLogOffMinutes: number;
    gaps: { startUTC: string; endUTCExclusive: string; emptyMinutes: number; qualifiesLogCriterion: boolean }[] } | null;
  bandChanges: { limit: number; complete: boolean; unknownOrderOrBandQSOs: number;
    hours: { hourUTC: string; changes: number; status: string }[] } | null;
};

/** Detail inside existing Info/timer surfaces; never implies RF permission. */
export function ContestOperatingInfo({ request, scope, onPlanSave }: {
  request: ContestRequest; scope: { sessionID: string; workspaceGeneration: string; revision: number };
  onPlanSave?: (plan: OperatingPlan) => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<{ key: string; value: OperatingInfo } | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<{ key: string; plan: OperatingPlan } | null>(null);
  const [savingScope, setSavingScope] = useState<string | null>(null);
  const key = `${scope.sessionID}/${scope.workspaceGeneration}/${scope.revision}`;
  const planKey = `${scope.sessionID}/${scope.workspaceGeneration}`;
  const currentPlanKey = useRef(planKey);
  currentPlanKey.current = planKey;
  const saving = savingScope === planKey;
  const data = snapshot?.key === key ? snapshot.value : null;
  const plan = draft?.key === planKey ? draft.plan : data?.plan ?? { ruleProfileID: "", note: "" };
  useEffect(() => {
    let active = true, pending = false;
    setError("");
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await request<OperatingInfo>("contest_operating_info" as ContestMethod, {
          sessionID: scope.sessionID, workspaceGeneration: scope.workspaceGeneration,
          expectedRevision: scope.revision, now: new Date().toISOString(),
        });
        if (!active) return;
        if (!response.ok) throw new Error(response.error.message ?? "Operating information unavailable");
        setSnapshot({ key, value: response.result }); setError("");
      } catch (failure) {
        if (active) { setSnapshot(null); setError(String(failure instanceof Error ? failure.message : failure)); }
      } finally { pending = false; }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [request, scope.sessionID, scope.workspaceGeneration, scope.revision, key]);
  const updatePlan = (next: Partial<OperatingPlan>) => setDraft({ key: planKey, plan: { ...plan, ...next } });
  const save = async () => {
    if (!onPlanSave) return;
    setSavingScope(planKey); setError("");
    try {
      await onPlanSave(plan);
      if (currentPlanKey.current === planKey) setDraft(current => current?.key === planKey ? null : current);
    } catch (failure) {
      if (currentPlanKey.current === planKey) setError(String(failure instanceof Error ? failure.message : failure));
    } finally { setSavingScope(current => current === planKey ? null : current); }
  };
  return <section aria-label="Operating rules and plan" aria-busy={!data && !error}>
    <h3>Operating rules and plan</h3>
    {error && <p role="alert">{error}</p>}
    {!data ? <p>Operating information unavailable for this log revision.</p> : <>
      <p>{data.profile ? `${data.profile.label} · ${data.profile.categoryBand} · ${data.profile.scope} scope` : data.unverifiedReason}</p>
      {data.profile && <p><a href={data.profile.sourceURL} target="_blank" rel="noreferrer">Official {data.profile.edition} rules</a>{" · "}
        <a href={data.profile.interpretationURL} target="_blank" rel="noreferrer">Sponsor timing interpretation</a><br/>
        {data.profile.startUTC} – {data.profile.endUTCExclusive} (exclusive)</p>}
      <p>Overall compliance unverified. Receiver and transmission activity unknown.</p>
      <dl><dt>Inferred inactivity since QSO</dt><dd>{data.inferredInactivitySeconds === null ? "Unknown" : durationText(data.inferredInactivitySeconds)}</dd>
        <dt>Observed operating / style / operator / lane durations</dt><dd>Unavailable</dd>
        {data.offTime && <><dt>Log-qualifying off-time</dt><dd>{data.offTime.qualifyingLogOffMinutes} min · at least {data.offTime.minimumOffMinutes} consecutive empty UTC clock minutes</dd></>}
        {data.allowance && <><dt>Reconstructed allowance use through last QSO minute</dt><dd>{data.allowance.reconstructedMinutes} / {data.allowance.limitMinutes} min · {data.allowance.remainingMinutes} min remaining in reconstruction · {data.allowance.status.replaceAll("-", " ")}</dd></>}
      </dl>
      <p>{data.durationNote} Plans and rest notes are intentions, not observed intervals.</p>
      {(data.invalidTimestampQSOs > 0 || data.excludedPeriodOrFutureQSOs > 0) && <p role="status">Excluded: {data.invalidTimestampQSOs} invalid timestamps; {data.excludedPeriodOrFutureQSOs} outside the selected period or after evaluation UTC.</p>}
      {data.bandChanges && <><p>QSO-observed band changes · maximum {data.bandChanges.limit} per UTC clock hour · mode changes excluded. Transmission compliance unverified.</p>
        {!data.bandChanges.complete && <p role="status">Incomplete band/order evidence: {data.bandChanges.unknownOrderOrBandQSOs} QSO(s). Counts are lower bounds.</p>}
        {data.bandChanges.hours.length ? <ul>{data.bandChanges.hours.map(hour => <li key={hour.hourUTC}>{hour.hourUTC}: {hour.changes} / {data.bandChanges!.limit} · {hour.status.replaceAll("-", " ")}</li>)}</ul> : <p>No band changes observed in available QSO evidence.</p>}</>}
      {data.offTime && data.offTime.gaps.length > 0 && <details><summary>Contributing QSO gaps</summary><ul>{data.offTime.gaps.map(gap => <li key={gap.startUTC}>{gap.startUTC} – {gap.endUTCExclusive}: {gap.emptyMinutes} empty minutes · {gap.qualifiesLogCriterion ? "qualifies log criterion" : "below minimum"}</li>)}</ul></details>}
      {onPlanSave && <fieldset disabled={saving}><legend>Operator plan</legend>
        <label>Rule edition/category<select aria-label="Operating rule profile" value={plan.ruleProfileID} onChange={event => updatePlan({ ruleProfileID: event.target.value })}>
          <option value="">Unverified / no profile</option>{data.availableProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label>
        <label>Rest, targets and notes<textarea aria-label="Operating plan note" maxLength={4000} value={plan.note} onChange={event => updatePlan({ note: event.target.value })}/></label>
        <button type="button" onClick={() => { void save(); }}>Save operating plan</button>
      </fieldset>}
    </>}
  </section>;
}

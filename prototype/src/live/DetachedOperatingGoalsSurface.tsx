import { FormEvent, useEffect, useRef, useState } from "react";
import { evaluateOperatingGoals, type OperatingGoal, type OperatingGoalEvaluation, type OperatingGoalResult } from "./operatingGoals";
import "./DetachedOperatingGoalsSurface.css";

const bands = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "2m", "70cm"];
const modes = ["CW", "SSB", "FT8", "FT4", "FT2", "RTTY", "PSK", "DIGI", "AM", "FM"];
const programmes = ["POTA", "SOTA", "IOTA", "WWFF"] as const;
type GoalType = OperatingGoal["type"];
type Evaluate = typeof evaluateOperatingGoals;

const goalLabel = (goal: OperatingGoal | (OperatingGoal & { id: string })) => goal.type === "callsign" ? goal.callsign
  : goal.type === "entity_slot" ? `DXCC ${goal.dxcc} · ${goal.band} · ${goal.mode}` : `${goal.programme} ${goal.reference}`;
const sponsor = (value: boolean | null) => value === null ? "Unknown" : value ? "Yes" : "No";
const utc = (value: number) => new Date(value * 1000).toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" });
const age = (seconds: number) => seconds < 60 ? `${Math.floor(seconds)}s old`
  : seconds < 3600 ? `${Math.floor(seconds / 60)}m old` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h old` : `${Math.floor(seconds / 86400)}d old`;
const basis = (value: string) => value === "publisher_observed_at" ? "Publisher observed time" : value.replaceAll("_", " ");

function Evaluation({ value }: { value: OperatingGoalEvaluation }) {
  return <article className="operating-goal-result">
    <div className="operating-goal-result-heading"><h2>{goalLabel(value.goal)}</h2>
      <span className={value.evidence.some(item => item.freshness === "active") ? "is-active" : "is-quiet"}>
        {value.evidence.some(item => item.freshness === "active") ? "Active evidence" : value.evidence.length ? "Scheduled evidence" : "No retained evidence"}
      </span></div>
    <dl className="operating-goal-states">
      <div><dt>Worked</dt><dd className={value.worked ? "is-confirmed" : "is-unmet"}>{value.worked ? `Yes · ${value.worked_count}` : "No"}</dd></div>
      <div><dt>Confirmed</dt><dd className={value.confirmed ? "is-confirmed" : "is-unmet"}>{value.confirmed ? `Yes · ${value.confirmed_count}` : "No"}</dd></div>
      <div><dt>Sponsor evidence</dt><dd>{sponsor(value.evidence_eligible)}</dd></div>
      <div><dt>Sponsor credit</dt><dd>{sponsor(value.credited)}</dd></div>
    </dl>
    <ul className="operating-goal-reasons">{value.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
    {value.evidence.length ? <div className="operating-goal-evidence" aria-label={`Retained evidence for ${goalLabel(value.goal)}`}>
      {value.evidence.map(item => <div key={`${item.source}:${item.id}`}>
        <strong>{item.freshness === "active" ? "Active" : "Scheduled"} · {item.callsign || item.reference || "Matching target"}</strong>
        <span>{[item.reference, item.band, item.mode].filter(Boolean).join(" · ") || "No band or mode supplied"}</span>
        <span>{item.source} · {age(item.age_seconds)}</span>
        <span>{basis(item.time_basis)} · {utc(item.observed_at)} UTC</span>
        <span>{item.reason}</span>
      </div>)}</div> : <p className="secondary operating-goal-empty">No matching retained opportunity evidence.</p>}
  </article>;
}

export function OperatingGoalsSurface({ evaluate = evaluateOperatingGoals }: { evaluate?: Evaluate }) {
  const [type, setType] = useState<GoalType>("callsign"), [callsign, setCallsign] = useState("");
  const [dxcc, setDXCC] = useState(""), [band, setBand] = useState("20m"), [mode, setMode] = useState("CW");
  const [programme, setProgramme] = useState<typeof programmes[number]>("POTA"), [reference, setReference] = useState("");
  const [profileID, setProfileID] = useState(""), [stationCall, setStationCall] = useState("");
  const [goals, setGoals] = useState<OperatingGoal[]>([]), [result, setResult] = useState<OperatingGoalResult | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), sequence = useRef(0);
  useEffect(() => () => { sequence.current++; }, []);
  const invalidate = () => { sequence.current++; setResult(null); setError(""); setBusy(false); };
  const updateGoals = (next: OperatingGoal[]) => { invalidate(); setGoals(next); };
  const add = (event: FormEvent) => {
    event.preventDefault();
    let next: OperatingGoal;
    if (type === "callsign") {
      const value = callsign.trim().toUpperCase();
      if (!/^(?=.*[A-Z])(?=.*\d)[A-Z0-9/]{3,28}$/.test(value)) { setError("Enter a valid callsign containing letters and numbers."); return; }
      next = { type, callsign: value }; setCallsign("");
    } else if (type === "entity_slot") {
      const value = Number(dxcc);
      if (!Number.isSafeInteger(value) || value < 1 || value > 999) { setError("Enter a DXCC number from 1 to 999."); return; }
      next = { type, dxcc: value, band, mode }; setDXCC("");
    } else {
      const value = reference.trim().toUpperCase();
      if (!value) { setError(`Enter the ${programme} reference.`); return; }
      next = { type, programme, reference: value }; setReference("");
    }
    const key = JSON.stringify(next);
    if (goals.some(goal => JSON.stringify(goal) === key)) { setError("That target is already selected."); return; }
    updateGoals([...goals, next]);
  };
  const run = async () => {
    if (!goals.length || busy) return;
    const profile = profileID.trim() ? Number(profileID) : undefined;
    if (profile !== undefined && (!Number.isSafeInteger(profile) || profile < 1)) { setError("Station profile ID must be a positive whole number."); return; }
    const call = stationCall.trim().toUpperCase() || undefined;
    if (call && !/^[A-Z0-9/]{1,32}$/.test(call)) { setError("Station callsign may contain only letters, numbers and slashes."); return; }
    const request = ++sequence.current; setBusy(true); setError(""); setResult(null);
    try {
      const value = await evaluate(goals, { profileID: profile, stationCall: call });
      if (request === sequence.current) setResult(value);
    } catch (failure) {
      if (request === sequence.current) setError(failure instanceof Error ? failure.message : "Operating goals are unavailable.");
    } finally { if (request === sequence.current) setBusy(false); }
  };
  const scopeChanged = (change: () => void) => { invalidate(); change(); };
  return <div className="app live detached-task-app detached-operating-goals-app"><main aria-label="Operating Goals">
    <form className="operating-goal-builder" onSubmit={add}>
      <label>Target type<select value={type} onChange={event => { invalidate(); setType(event.target.value as GoalType); }}>
        <option value="callsign">Callsign</option><option value="entity_slot">DXCC band / mode</option><option value="reference">Programme reference</option>
      </select></label>
      {type === "callsign" && <label className="operating-goal-primary-field">Callsign<input autoFocus value={callsign} onChange={event => { setError(""); setCallsign(event.target.value); }} placeholder="e.g. K1ABC" /></label>}
      {type === "entity_slot" && <><label>DXCC<input value={dxcc} inputMode="numeric" onChange={event => { setError(""); setDXCC(event.target.value); }} placeholder="291" /></label>
        <label>Band<select value={band} onChange={event => setBand(event.target.value)}>{bands.map(item => <option key={item}>{item}</option>)}</select></label>
        <label>Mode<select value={mode} onChange={event => setMode(event.target.value)}>{modes.map(item => <option key={item}>{item}</option>)}</select></label></>}
      {type === "reference" && <><label>Programme<select value={programme} onChange={event => setProgramme(event.target.value as typeof programme)}>{programmes.map(item => <option key={item}>{item}</option>)}</select></label>
        <label className="operating-goal-primary-field">Reference<input value={reference} onChange={event => { setError(""); setReference(event.target.value); }} placeholder="e.g. K-0001" /></label></>}
      <button type="submit">Add target</button>
    </form>
    <section className="operating-goal-selection" aria-label="Selected targets">
      {goals.length ? <ul>{goals.map((goal, index) => <li key={JSON.stringify(goal)}><span>{goalLabel(goal)}</span>
        <button type="button" aria-label={`Remove ${goalLabel(goal)}`} onClick={() => updateGoals(goals.filter((_, item) => item !== index))}>Remove</button></li>)}</ul>
        : <p className="secondary">Add one or more targets to compare with retained local contacts and opportunity evidence.</p>}
      <div className="operating-goal-scope">
        <label>Station profile ID<input inputMode="numeric" value={profileID} onChange={event => scopeChanged(() => setProfileID(event.target.value))} placeholder="All" /></label>
        <label>Station callsign<input value={stationCall} onChange={event => scopeChanged(() => setStationCall(event.target.value))} placeholder="All" /></label>
        <button className="primary" type="button" disabled={!goals.length || busy} onClick={() => void run()}>{busy ? "Evaluating…" : "Evaluate selected"}</button>
      </div>
    </section>
    {error && <p className="live-error" role="alert">{error}</p>}
    {result && <>
      <section className="operating-goal-source-summary" aria-label="Evaluation sources"><dl>
        <div><dt>Station scope</dt><dd>{result.station_scope.all_stations ? "All retained stations" : [result.station_scope.callsign, result.station_scope.profile_id && `Profile ${result.station_scope.profile_id}`].filter(Boolean).join(" · ")}</dd></div>
        <div><dt>Contacts</dt><dd>{result.sources.contacts.count.toLocaleString()} retained</dd></div>
        <div><dt>Opportunities</dt><dd>{result.sources.opportunities.count.toLocaleString()} retained</dd></div>
        <div><dt>Cluster observations</dt><dd className="is-unknown">Not included</dd></div>
      </dl></section>
      <section className="operating-goal-results" aria-label="Goal evaluations">{result.evaluations.map(value => <Evaluation key={value.goal.id} value={value} />)}</section>
    </>}
    <p className="secondary operating-goal-boundary">Retained contacts and public opportunity snapshots only. Cluster observations are not included, so current activity remains unverified. This window never refreshes feeds, creates alerts, tunes the station or changes the logbook.</p>
  </main></div>;
}

export const DetachedOperatingGoalsSurface = OperatingGoalsSurface;

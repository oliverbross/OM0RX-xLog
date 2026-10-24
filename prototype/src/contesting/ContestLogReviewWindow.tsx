import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { compareContestLog, defaultReviewOptions, type ReviewFinding, type ReviewOptions, type ReviewResult } from "./logReview";
import { collectReview, readReview, runReviewWorker, type ReviewRead, type ReviewSnapshot } from "./logReviewService";
import "./ContestLogReviewWindow.css";

type Decision={disposition:"Keep logged contact"|"Dismiss suggestion";at:string};
type Completed={snapshot:ReviewSnapshot;result:ReviewResult;options:ReviewOptions};
const message=(cause:unknown)=>cause instanceof Error?cause.message:String(cause);
const utc=(value:string|null)=>value?value.replace("T"," ").replace(/\.\d+Z$/,"Z"):"Unavailable";
const storageKey=(snapshot:ReviewSnapshot)=>"xlog-contest-review-v1/"+snapshot.context.workspaceGeneration+"/"+snapshot.context.sessionID;
function loadDecisions(snapshot:ReviewSnapshot):Record<string,Decision> {
  const data=JSON.parse(localStorage.getItem(storageKey(snapshot))??"{}");
  if(!data || typeof data!=="object" || Array.isArray(data)) return {};
  return Object.fromEntries(Object.entries(data).filter(([,value])=>{
    const entry=value as Decision;
    return entry && ["Keep logged contact","Dismiss suggestion"].includes(entry.disposition) && typeof entry.at==="string";
  })) as Record<string,Decision>;
}

export function ContestLogReviewWindow({read=readReview,compare=runReviewWorker}:{
  read?:ReviewRead;compare?:typeof runReviewWorker;
}) {
  const [options,setOptions]=useState(defaultReviewOptions),[complete,setComplete]=useState<Completed|null>(null);
  const [busy,setBusy]=useState(false),[progress,setProgress]=useState(""),[error,setError]=useState("");
  const [filter,setFilter]=useState("Unreviewed"),[selected,setSelected]=useState<ReviewFinding|null>(null);
  const [decisions,setDecisions]=useState<Record<string,Decision>>({}),[raw,setRaw]=useState<Record<string,string>>({});
  const [notice,setNotice]=useState("");
  const active=useRef<AbortController|null>(null),detailGeneration=useRef(0);
  useEffect(()=>()=>{active.current?.abort();detailGeneration.current++;},[]);
  const run=async()=>{
    if(active.current)return;
    const controller=new AbortController();active.current=controller;
    setBusy(true);setError("");setNotice("");setProgress("Reading the active contest…");
    setSelected(null);setRaw({});detailGeneration.current++;
    try {
      compareContestLog([],[],options); // Validate before starting archive reads.
      const snapshot=await collectReview(read,controller.signal,setProgress);
      setProgress("Comparing callsigns, times and frequencies…");
      const result=await compare(snapshot,{...options},controller.signal);
      if(controller.signal.aborted)return;
      setComplete({snapshot,result,options:{...options}});setFilter("Unreviewed");
      try {setDecisions(loadDecisions(snapshot));} catch {setDecisions({});setNotice("Saved review decisions could not be read. Findings remain available.");}
    } catch(cause) {if(!controller.signal.aborted)setError(message(cause));else setNotice("Review cancelled. Previous results, if any, remain unchanged.");}
    finally {if(active.current===controller){active.current=null;setBusy(false);setProgress("");}}
  };
  const decide=(finding:ReviewFinding,disposition:Decision["disposition"]|null)=>{
    if(!complete)return;
    const next={...decisions};
    if(disposition)next[finding.key]={disposition,at:new Date().toISOString()};else delete next[finding.key];
    try {localStorage.setItem(storageKey(complete.snapshot),JSON.stringify(next));setDecisions(next);setNotice("Review decision saved. The contest contact is unchanged.");}
    catch {setError("Could not save the review decision. Local storage may be full.");}
  };
  const showRaw=async(id:string)=>{
    if(!complete)return;
    const token=detailGeneration.current;
    try {
      const result=await read("spot_history_detail",{id},complete.snapshot.context);
      if(token===detailGeneration.current)setRaw(previous=>({...previous,[id]:result.observation?.rawLine??"Original report is no longer available."}));
    }catch(cause){if(token===detailGeneration.current)setError(message(cause));}
  };
  const copyReport=async()=>{
    if(!complete)return;
    const report={format:"xlog-contest-log-review-v1",sessionID:complete.snapshot.context.sessionID,
      sourceRevision:complete.snapshot.context.revision,capturedAt:complete.snapshot.capturedAt,options:complete.options,
      archive:complete.snapshot.archive,watermark:complete.snapshot.watermark,truncated:complete.snapshot.truncated,
      arrivalFrom:complete.snapshot.arrivalFrom,arrivalTo:complete.snapshot.arrivalTo,references:complete.snapshot.references,
      result:complete.result,decisions:Object.fromEntries(complete.result.findings.filter(f=>decisions[f.key]).map(f=>[f.key,decisions[f.key]]))};
    try{await navigator.clipboard.writeText(JSON.stringify(report,null,2));setNotice("Review report copied as JSON.");}
    catch{setError("The report could not be copied to the clipboard.");}
  };
  const findings=complete?.result.findings??[];
  const shown=findings.filter(f=>filter==="All" || (filter==="Reviewed"?Boolean(decisions[f.key]):
    !decisions[f.key] && (filter==="Unreviewed" || f.kind===filter)));
  return <main className="contest-log-review">
    <header><div><h1>Log Review</h1><p>Compare the active contest with recorded spots and local reference data.</p></div>
      <button onClick={()=>void run()} disabled={busy}>{complete?"Run again":"Run review"}</button>
      {busy&&<button onClick={()=>active.current?.abort()}>Cancel</button>}</header>
    <p className="review-hint">Run after operating. Review never changes contacts or sends radio commands.
      Missing spots do not mean a contact is wrong; reports can contain mistakes or describe another station.</p>
    <fieldset disabled={busy}><legend>Comparison tolerances</legend>
      <label>Time ± minutes<input type="number" min="1" max="30" value={options.minutes}
        onChange={e=>setOptions({...options,minutes:Number(e.target.value)})}/></label>
      <label>Frequency ± kHz<input type="number" min="0.1" max="10" step="0.1" value={options.kHz}
        onChange={e=>setOptions({...options,kHz:Number(e.target.value)})}/></label>
      <label>Mismatch search ± minutes<input type="number" min={options.minutes} max="180" value={options.searchMinutes}
        onChange={e=>setOptions({...options,searchMinutes:Number(e.target.value)})}/></label>
    </fieldset>
    {busy&&<p role="status">{progress}</p>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {complete&&<>
      <section className="review-summary" aria-label="Review summary">
        <strong>{complete.result.checked.toLocaleString()} contacts checked · {findings.length} suggestions</strong>
        <span>{complete.result.corroborated} corroborated · {complete.result.withoutEvidence} without corroborating evidence
          {complete.result.invalidContacts>0&&` · ${complete.result.invalidContacts} contacts skipped (invalid time, call, frequency or mode)`}
          {complete.result.unsupportedBandContacts>0&&` · ${complete.result.unsupportedBandContacts} contacts outside supported bands skipped`}</span>
        <span>{complete.result.eligibleReports.toLocaleString()} eligible reports · {complete.result.excludedReports.toLocaleString()} excluded
          (local entries, missing reported time, or invalid fields)</span>
        <span>Log revision {complete.snapshot.context.revision} · snapshot {utc(complete.snapshot.capturedAt)}.
          Rerun after corrections; decisions apply only to unchanged contacts and evidence.</span>
        <details><summary>Archive coverage and limitations</summary>
          <p>Recorder: {complete.snapshot.archive.recording.state}; {complete.snapshot.archive.recording.queued} queued,
            {complete.snapshot.archive.recording.unrecorded} known unrecorded reports in retained archive health.
            Gaps may exist while the app or cluster was disconnected.</p>
          <p>Archive arrivals: {utc(complete.snapshot.archive.status?.earliest??null)} to {utc(complete.snapshot.archive.status?.latest??null)}.
            Review arrival window: {utc(complete.snapshot.arrivalFrom)} to {utc(complete.snapshot.arrivalTo)} (one day around the log).
            Comparison uses reported UTC, not arrival time. Reports received later than this window are outside this review.</p>
          <p>Archive watermark {complete.snapshot.watermark??"none"}. Repeated or redistributed reports are not independent confirmation.
            Portable suffixes are kept distinct. Spot comparisons support HF, 6m, 2m and 70cm. Points are not recalculated.
            Zone checks interpret the received exchange only for CQ WW CW/SSB.</p>
        </details>
        <details><summary>Local references and callsign checks</summary>
          <p>CTY and cached Club Log country data are suggestions at the QSO time, not proof of an exchange.
            Club Log country data is not a Club Log user directory. LoTW lists are incomplete: absence never means a callsign is invalid.
            No online lookup or download runs during review.</p>
          {complete.snapshot.references.sources.map(source=><p key={source.name}>
            <strong>{source.name}</strong>: {source.status} · file date {utc(source.modifiedAt??null)} · <code>{source.version??"no local file"}</code></p>)}
          <div className="review-table-scroll"><table><thead><tr><th>Call</th><th>LoTW activity list</th><th>Country / CQ zone references</th></tr></thead>
            <tbody>{complete.snapshot.references.rows.map(row=><tr key={row.id}><td>{row.call}</td>
              <td>{row.lotwListed===null?"Unavailable":row.lotwListed?"Listed":"Not listed — inconclusive"}</td>
              <td>{row.countries.map(country=>`${country.source}: ${country.country} (${country.primaryPrefix??`DXCC ${country.adif}`}), CQ ${country.cqZone||"unknown"}`).join(" · ")||"Unresolved — insufficient reference evidence"}</td>
            </tr>)}</tbody></table></div>
        </details>
        {(complete.snapshot.archive.recording.retainedGap || complete.snapshot.archive.recording.unknownGap) &&
          <p role="alert">{complete.snapshot.archive.recording.unknownGap
            ? "The archive contains a recorded interruption with unknown loss. Coverage is incomplete, even if the known unrecorded count is zero."
            : "The archive contains a recorded gap. These results use only the reports that were retained."}</p>}
        {complete.snapshot.truncated&&<p role="alert">Partial archive: the 50,000-report limit was reached. Results do not cover every report in this window.</p>}
      </section>
      <div className="review-toolbar"><label>Show <select value={filter} onChange={e=>setFilter(e.target.value)}>
        {["Unreviewed","Possible typo","Frequency/time mismatch","Country / zone mismatch","Reviewed","All"].map(value=><option key={value}>{value}</option>)}
      </select></label><span>{shown.length} shown</span><button onClick={()=>void copyReport()}>Copy report</button></div>
      <div className="review-results"><section aria-label="Suggestions" className="review-table-scroll"><table><thead><tr>
        <th>UTC</th><th>Logged call</th><th>kHz / mode</th><th>Suggestion</th><th>Status</th>
      </tr></thead><tbody>{shown.map(finding=><tr key={finding.key} className={selected?.key===finding.key?"selected":""}>
        <td>{utc(finding.qso.TS)}</td><td><button onClick={()=>setSelected(finding)}>{finding.qso.Call}</button></td>
        <td>{Number(finding.qso.Freq).toFixed(1)} / {finding.qso.Mode}</td><td>{finding.kind}</td>
        <td>{decisions[finding.key]?"Reviewed":"Unreviewed"}</td></tr>)}</tbody></table>
        {!shown.length&&<p>No suggestions in this filter. This is not proof that the log has no errors.</p>}</section>
        {selected&&<aside aria-label="Supporting reports"><h2>{selected.qso.Call} · {selected.kind}</h2>
          <p>{selected.explanation}</p>
          <p>Logged {utc(selected.qso.TS)} UTC · RX {selected.qso.Freq} kHz
            {Number(selected.qso.QSXFreq)>0&&` · split ${selected.qso.QSXFreq} kHz`} · {selected.qso.Mode}</p>
          <p>Logged country {selected.qso.CountryPrefix||"unavailable"} · received exchange {selected.qso.NR??"unavailable"}.</p>
          {selected.reference&&<p>LoTW activity list: {selected.reference.lotwListed===null?"unavailable":selected.reference.lotwListed?"listed":"not listed (inconclusive)"}.
            {selected.reference.countries.map(country=><span key={country.source}> {country.source}: {country.country}, CQ {country.cqZone||"unknown"}.</span>)}</p>}
          {selected.evidenceCount>0&&<p>Showing {selected.evidence.length} of {selected.evidenceCount} distinct reports.</p>}
          {selected.evidence.map(spot=><article key={spot.id}><strong>{spot.callsign} · {spot.frequencyKHz.toFixed(1)} kHz · {spot.mode}</strong>
            <p>Reported {utc(spot.reportedAt)} · arrived {utc(spot.arrivedAt)}</p>
            <p>Spotter {spot.spotter} · {spot.clusterName} · {spot.recordKind}</p><p>{spot.comment}</p>
            <button onClick={()=>void showRaw(spot.id)}>Original report</button>
            {raw[spot.id]&&<pre>{raw[spot.id]}</pre>}</article>)}
          <div className="review-decisions"><button onClick={()=>decide(selected,"Keep logged contact")}>Keep logged contact</button>
            <button onClick={()=>decide(selected,"Dismiss suggestion")}>Dismiss suggestion</button>
            {decisions[selected.key]&&<button onClick={()=>decide(selected,null)}>Reopen review</button>}</div>
          {decisions[selected.key]&&<p>{decisions[selected.key].disposition} · {utc(decisions[selected.key].at)}</p>}
          <p>To correct a contact, open Contest → Log Display and double-click this contact to use Edit Contact. Run review again afterwards.</p>
          <button onClick={()=>void invoke("contest_log_review_open_log",{
            sessionId:complete.snapshot.context.sessionID,workspaceGeneration:complete.snapshot.context.workspaceGeneration,
          }).catch(cause=>setError(message(cause)))}>Open Log Display</button>
        </aside>}
      </div>
    </>}
    {!complete&&!busy&&<p className="review-empty">Your live spot archive is already recorded separately. Start a review when you are ready; nothing runs automatically.</p>}
  </main>;
}

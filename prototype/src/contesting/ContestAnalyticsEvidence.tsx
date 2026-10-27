import {useEffect,useRef,useState} from 'react';
import type {AnalyticsDataset} from './contestAnalytics';
import {analyticalCandidate,inspectLearningEvidence,type LearningEvidence} from './analyticsEvidenceModel';
import type {Drill} from './ContestAnalyticsCharts';
import type {AnalyticsExport} from './contestAnalyticsExport';

export function AnalyticsCandidateEvidence({dataset,onDrill}:{dataset:AnalyticsDataset;onDrill:Drill}){
 const [source,setSource]=useState(''),[band,setBand]=useState('20m'),[zone,setZone]=useState(''),[points,setPoints]=useState(3);
 useEffect(()=>{setSource('');setZone('');},[dataset.meta.identity]);
 const value=analyticalCandidate(dataset,source,band,zone,points);
 return <section className="analytics-section"><h2>Candidate evidence in this analytical copy</h2><p>CQ WW CW/SSB only. Select a saved contact as country evidence for a possible later-band contact. A new unresolved callsign needs separate reference evidence; no country or received exchange is guessed.</p>
   <div className="analytics-controls"><label>Saved candidate evidence<select aria-label="Analytical candidate source" value={source} onChange={event=>setSource(event.target.value)}><option value="">Choose saved contact</option>{dataset.contacts.slice(0,500).map(row=><option key={row.id} value={row.id}>{row.call} · {row.band} · {row.id.slice(0,8)}</option>)}</select></label>
     <label>Proposed band<select aria-label="Analytical candidate band" value={band} onChange={event=>setBand(event.target.value)}>{['160m','80m','40m','20m','15m','10m'].map(item=><option key={item}>{item}</option>)}</select></label>
     <label>Assumed received CQ zone<input aria-label="Analytical received zone" value={zone} maxLength={2} placeholder="Unknown" onChange={event=>setZone(event.target.value)}/></label>
     <label>Assumed valid QSO points<input aria-label="Analytical assumed points" type="number" min={0} max={3} value={points} onChange={event=>setPoints(Math.max(0,Math.min(3,Math.floor(Number(event.target.value)||0))))}/></label></div>
   {dataset.contacts.length>500&&<p>The selector shows the first 500 contacts; use contributing-contact evidence for the full snapshot. No extra candidate references are fetched.</p>}
   <p>{value.status} · {value.reason}</p>{'call' in value&&<><p>{value.call} · {value.country} · {band} · {value.duplicate?'Duplicate in copy':'Not worked on this band'} · country {value.newCountry?'needed':'worked'} · zone {value.newZone===null?'unknown':value.newZone?'needed':'worked'} · conditional gain {value.conditionalGain===null?'unverified':value.conditionalGain}.</p>
     <button onClick={()=>onDrill('Candidate source and existing multiplier support',value.ids)}>Open candidate evidence contacts</button></>}
   <p className="analytics-note">Identity {dataset.meta.identity}. This read-only calculation cannot load a draft, tune, send or guarantee a result. The existing live station-owned opportunity preview remains separate.</p>
 </section>;
}

export function AnalyticsLearningEvidence({dataset,onDrill,exportState}:{dataset:AnalyticsDataset;onDrill:Drill;exportState:AnalyticsExport}){
 const [text,setText]=useState(''),[review,setReview]=useState<{evidence:LearningEvidence;sha256:string}|null>(null),[error,setError]=useState('');
 const ticket=useRef(0);
 useEffect(()=>{ticket.current++;setReview(null);setError('');},[dataset.meta.identity,text]);
 const inspect=async()=>{const id=++ticket.current;setReview(null);setError('');try{const evidence=inspectLearningEvidence(dataset,text);
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));if(ticket.current===id)setReview({evidence,sha256:Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')});
 }catch(cause){if(ticket.current===id)setError(String(cause));}};
 const template={schemaVersion:1,format:'xlog-learning-evidence',logIdentity:dataset.meta.identity,source:'Operator transcription; organizer format not verified',findings:dataset.contacts[0]?[{qsoID:dataset.contacts[0].id,status:'operator-note',note:''}]:[]};
 return <section className="analytics-section"><h2>Read-only adjudication / learning evidence</h2><p>Import normalized annotations against this exact immutable log identity. Source claims are unverified; accepted/rejected labels do not alter score, duplicate ownership or contacts. Official LCR/UBN dialect conversion remains unsupported.</p>
   <button onClick={()=>{setText(JSON.stringify(template,null,2));setReview(null);}}>Show identity-bound evidence template</button>
   <label>Original learning evidence<textarea aria-label="Original learning evidence" value={text} maxLength={1048576} rows={6} onChange={event=>{setText(event.target.value);setReview(null);}}/></label>
   <button disabled={!text} onClick={()=>void inspect()}>Inspect learning evidence without correction</button>{error&&<p role="alert">{error}</p>}
   {review&&<><p>{review.evidence.findings.length} annotations · source {review.evidence.source} · SHA-256 {review.sha256}. View-local until exported; no log changes.</p>
     <ul>{['accepted','not-in-log','exchange','duplicate','operator-note'].map(status=>{const rows=review.evidence.findings.filter(row=>row.status===status);return rows.length>0&&<li key={status}><button onClick={()=>onDrill(`${status} · unverified external/operator evidence`,rows.map(row=>row.qsoID))}>{status} · {rows.length} contributing contacts</button></li>;})}</ul>
     <button disabled={exportState.pending} onClick={()=>void exportState.save('xlog-learning-review.json',()=>JSON.stringify({snapshotIdentity:dataset.meta.identity,sessionID:dataset.meta.sessionID,referenceID:dataset.meta.referenceID,sourceRevision:dataset.meta.sourceRevision,sourceSHA256:review.sha256,sourceText:text,evidence:review.evidence,contactMutations:0,sourceClaimsVerified:false},null,2))}>Save read-only learning review</button>
     <details><summary>Reviewed annotations</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(review.evidence,null,2)}</pre></details></>}
 </section>;
}

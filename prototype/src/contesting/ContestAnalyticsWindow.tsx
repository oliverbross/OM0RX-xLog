import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, BarChart3, Clock3, Download, Filter, Layers, ListChecks, RefreshCw, Target, Users } from "lucide-react";
import { aggregate, analyticsReport, defaultAnalyticsFilters, numberText, utcText, type AnalyticsDataset, type AnalyticsFilters, type AnalyticsResult } from "./contestAnalytics";
import { collectAnalytics, readAnalytics, type AnalyticsRead, type AnalyticsSnapshot } from "./contestAnalyticsService";
import { AnalyticsExplorer, AnalyticsTimeline, type Drill } from "./ContestAnalyticsCharts";
import { AnalyticsDrilldown, AnalyticsMultipliers, AnalyticsPerformance, AnalyticsQuality } from "./ContestAnalyticsDetails";
import { useAnalyticsExport } from "./contestAnalyticsExport";
import { AnalyticsCompare } from "./ContestAnalyticsCompare";
import "./ContestAnalyticsWindow.css";
import { listenToAudio } from "./contestRecorder";

const tabs=[{id:"overview",label:"Overview",icon:Activity},{id:"explorer",label:"Timeline & Explorer",icon:BarChart3},{id:"multipliers",label:"Multipliers",icon:Target},{id:"performance",label:"Operating Performance",icon:Users},{id:"compare",label:"Compare",icon:Layers},{id:"quality",label:"Quality & Review",icon:ListChecks}] as const;
type Tab=typeof tabs[number]["id"];
const errorText=(cause:unknown)=>cause instanceof Error?cause.message:String(cause);

export function ContestAnalyticsWindow({read=readAnalytics,initialSnapshot}:{read?:AnalyticsRead;initialSnapshot?:AnalyticsSnapshot}){
  const exportState=useAnalyticsExport();
  const [snapshot,setSnapshot]=useState<AnalyticsSnapshot|null>(initialSnapshot??null),[dataset,setDataset]=useState<AnalyticsDataset|null>(null),[result,setResult]=useState<AnalyticsResult|null>(null);
  const [filters,setFilters]=useState<AnalyticsFilters>(defaultAnalyticsFilters),[tab,setTab]=useState<Tab>("overview"),[live,setLive]=useState(true),[busy,setBusy]=useState(false),[analyzing,setAnalyzing]=useState(false),[error,setError]=useState(""),[progress,setProgress]=useState("");
  const [drill,setDrill]=useState<{title:string;ids:string[]}|null>(null),[advanced,setAdvanced]=useState(false),[goal,setGoal]=useState(0),[measure,setMeasure]=useState<"qsos"|"points"|"multipliers"|"score">("qsos");
  const workerRef=useRef<Worker|null>(null),requestRef=useRef(0),snapshotRef=useRef(snapshot),filtersRef=useRef(filters),abortRef=useRef<AbortController|null>(null),busyRef=useRef(false),mounted=useRef(true),drillRef=useRef<HTMLElement|null>(null);
  snapshotRef.current=snapshot;filtersRef.current=filters;
  const update=useCallback((patch:Partial<AnalyticsFilters>)=>{setFilters(current=>({...current,...patch}));setDrill(null);},[]);
  useEffect(()=>{if(dataset){if(!dataset.scoreHistory&&measure==="score"||!dataset.meta.cqWW&&measure==="multipliers")setMeasure("qsos");if(!dataset.meta.cqWW&&filters.measure==="multipliers")update({measure:"qsos"});}},[dataset,measure,filters.measure,update]);
  const refresh=useCallback(async()=>{
    if(busyRef.current)return;
    busyRef.current=true;setBusy(true);setError("");setProgress("Copying the contest log…");setDrill(null);
    const abort=new AbortController();abortRef.current?.abort();abortRef.current=abort;
    try{const next=await collectAnalytics(read,abort.signal,setProgress);if(!mounted.current)return;
      const previous=snapshotRef.current;setSnapshot(next);
      if(previous)void read({action:"release",snapshotID:previous.meta.snapshotID},previous.meta).catch(()=>{});
    }catch(cause){if(!abort.signal.aborted&&mounted.current){setError(errorText(cause));setSnapshot(null);setDataset(null);setResult(null);}}
    finally{busyRef.current=false;if(mounted.current){setBusy(false);setProgress("");}}
  },[read]);
  useEffect(()=>{mounted.current=true;if(!initialSnapshot)void refresh();return()=>{mounted.current=false;abortRef.current?.abort();const value=snapshotRef.current;if(value&&!initialSnapshot)void read({action:"release",snapshotID:value.meta.snapshotID},value.meta).catch(()=>{});};},[read,refresh,initialSnapshot]);
  useEffect(()=>{
    if(!snapshot)return;
    const worker=new Worker(new URL("./contestAnalytics.worker.ts",import.meta.url),{type:"module"});workerRef.current=worker;setDataset(null);setResult(null);setAnalyzing(true);
    const id=++requestRef.current;
    worker.onmessage=event=>{if(event.data.dataset)setDataset(event.data.dataset);if(event.data.id!==requestRef.current)return;setAnalyzing(false);if(event.data.error){setError(event.data.error);setResult(null);return;}setError("");setResult(event.data.result);};
    worker.onerror=()=>{setAnalyzing(false);setError("The analytics worker stopped. Refresh to retry.");};
    worker.postMessage({id,snapshot,filters:filtersRef.current,now:Date.now()});
    return()=>{worker.terminate();if(workerRef.current===worker)workerRef.current=null;};
  },[snapshot]);
  useEffect(()=>{if(!workerRef.current)return;setAnalyzing(true);workerRef.current.postMessage({id:++requestRef.current,filters,now:Date.now()});},[filters]);
  useEffect(()=>{
    if(!live||initialSnapshot)return;let checking=false;
    const timer=setInterval(async()=>{
      if(document.hidden||checking||busyRef.current)return;const current=snapshotRef.current;if(!current)return;checking=true;
      try{const check=await read({action:"check",snapshotID:current.meta.snapshotID},current.meta);if(!mounted.current||snapshotRef.current!==current)return;
        if(check.current!==true)await refresh();else if(workerRef.current){setAnalyzing(true);workerRef.current.postMessage({id:++requestRef.current,filters:filtersRef.current,now:Date.now()});}
      }catch(cause){if(mounted.current&&snapshotRef.current===current){setError(errorText(cause));setDataset(null);setResult(null);setSnapshot(null);setDrill(null);}}
      finally{checking=false;}
    },15000);return()=>clearInterval(timer);
  },[live,read,refresh,initialSnapshot]);
  const onDrill:Drill=(title,ids)=>{if(busy||analyzing)return;setDrill({title,ids});setTimeout(()=>drillRef.current?.scrollIntoView?.({behavior:window.matchMedia?.("(prefers-reduced-motion: reduce)").matches?"auto":"smooth",block:"start"}),0);};
  const selectedContacts=useMemo(()=>{const ids=new Set(drill?.ids??[]);return dataset?.contacts.filter(q=>ids.has(q.id))??[];},[dataset,drill]);
  const choices=useMemo(()=>Object.fromEntries((["band","mode","operator","style","continent"] as const).map(key=>[key,[...new Set(dataset?.contacts.map(q=>q[key])??[])].sort()])),[dataset]);
  const locked=busy||analyzing,category=dataset?`${String(dataset.meta.settings.BandCategory??"ALL")} · ${String(dataset.meta.settings.ModeCategory??"Selected mode")} · ${String(dataset.meta.settings.PowerCategory??"Power unspecified")}`:"";
  const metric=measure==="qsos"?"Logged contacts":measure==="points"?"Stored QSO points":measure==="multipliers"?"New category multipliers":"Reconstructed category score growth";
  const status=busy?progress:analyzing?"Calculating this view…":dataset?`${dataset.meta.total.toLocaleString()} contacts · Snapshot ${utcText(Date.parse(dataset.meta.capturedAt))} UTC`:"Open a contest session, then refresh analytics.";
  return <main className="contest-analytics" aria-label="Contest Analytics" aria-busy={locked}>
    <header className="analytics-header"><div className="analytics-title"><BarChart3 size={27} aria-hidden="true"/><div><h1>Contest Analytics</h1><p>{dataset?`${dataset.meta.stationCall} · ${dataset.meta.name}`:"OM0RX-xLog · Contest analysis"}</p></div></div><div className="analytics-actions"><label className="analytics-live"><input type="checkbox" checked={live} onChange={e=>setLive(e.target.checked)}/><Activity size={14}/> Live refresh</label><button onClick={()=>void refresh()} disabled={busy}><RefreshCw size={15}/> {busy?"Loading…":"Refresh"}</button><button disabled={!dataset||locked||exportState.pending} onClick={()=>dataset&&void exportState.save(`xlog-${dataset.meta.pluginID}-analytics.json`,()=>JSON.stringify(analyticsReport(dataset,filters),null,2))}><Download size={15}/> Export report</button><button disabled={!dataset||locked||exportState.pending} onClick={()=>void exportState.print()}>Print / PDF</button></div></header>
    <div className="analytics-status" role="status"><span className={busy||analyzing?"analytics-attention":""}>{status}</span><span>Read-only · Local contest data</span></div>
    {(exportState.pending||exportState.message)&&<p role="status" className="analytics-note">{exportState.pending?exportState.pendingLabel:exportState.message}</p>}
    {exportState.error&&<p role="alert" className="analytics-error">{exportState.error}</p>}
    {error&&<p role="alert" className="analytics-error">{error} <button disabled={busy} onClick={()=>void refresh()}>Retry</button></p>}
    {dataset&&<>
      <div className="analytics-scope"><span>Claimed category <strong>{category}</strong></span><span>Viewing <strong>{filters.scope==="category"?"Claimed category":"All logged bands"}{filters.band!=="all"?` · ${filters.band}`:""}</strong></span><span>Host score remains authoritative</span></div>
      <nav className="analytics-tabs" aria-label="Analytics sections">{tabs.map(({id,label,icon:Icon})=><button key={id} aria-current={tab===id?"page":undefined} onClick={()=>setTab(id)}><Icon size={16}/>{label}</button>)}</nav>
      <fieldset className="analytics-filters" disabled={locked}><legend><Filter size={13}/> Display filters</legend>
        {(["band","mode","operator","style","continent"] as const).map(key=><label key={key}>{key==="style"?"Run / S&P":key[0].toUpperCase()+key.slice(1)}<select aria-label={`Analytics ${key}`} value={filters[key]} onChange={e=>update({[key]:e.target.value})}><option value="all">All {key==="style"?"styles":key+"s"}</option>{choices[key]?.map((value:string)=><option key={value}>{value}</option>)}</select></label>)}
        <label>Scoring scope<select aria-label="Analytics scoring scope" value={filters.scope} onChange={e=>update({scope:e.target.value as "all"|"category"})}><option value="all">All logged bands</option><option value="category">Claimed category</option></select></label><label>Inclusion<select aria-label="Analytics inclusion" value={filters.basis} onChange={e=>update({basis:e.target.value as "logged"|"nondupe"})}><option value="logged">All logged QSOs</option><option value="nondupe">Known nonduplicate</option></select></label>
        <button aria-expanded={advanced} onClick={()=>setAdvanced(v=>!v)}><Clock3 size={14}/> UTC range</button><button onClick={()=>{setFilters(defaultAnalyticsFilters);setDrill(null);}}>Reset</button>
        {advanced&&<div className="analytics-time-filter"><label>From UTC · inclusive<input aria-label="Analytics UTC start" type="datetime-local" value={filters.from} onChange={e=>update({from:e.target.value})}/></label><label>To UTC · exclusive<input aria-label="Analytics UTC end" type="datetime-local" value={filters.to} onChange={e=>update({to:e.target.value})}/></label><p>Empty endpoints use the logged contact extent. Enter the event period to include known empty hours before or after your contacts. All timeline intervals use [start, end).</p></div>}
      </fieldset>
      {result&&!error&&<>
      <section className="analytics-metrics" aria-label="Contest metrics"><div><span>Claimed score · host</span><strong>{numberText(dataset.meta.score.total)}</strong><small>{numberText(dataset.meta.score.points)} points {dataset.meta.cqWW?"×":"·"} {numberText(dataset.meta.score.multipliers)} multipliers{!dataset.meta.cqWW?" · plugin formula":""}</small></div>
        <button aria-label={`Contacts in view ${numberText(result.summary.qsos)}`} onClick={()=>onDrill("All contacts in the displayed scope",result.summary.ids)} disabled={locked}><span>Contacts in view</span><strong>{numberText(result.summary.qsos)}</strong><small>{result.summary.nondupe} nondupe · {result.summary.duplicates} dupes · {result.summary.unknownDupe} unknown</small></button>
        <button onClick={()=>onDrill("Stored QSO points in view",result.summary.ids)} disabled={locked}><span>QSO points in view</span><strong>{numberText(result.summary.points)}</strong><small>{result.summary.unknownPoints?`${result.summary.unknownPoints} records have unknown points`:result.summary.qsos?`${numberText(result.summary.points/result.summary.qsos,2)} points / logged QSO`:"No contacts in scope"}</small></button>
        <div><span>Distinct geography in view</span><strong>{result.summary.countries}<small> countries</small></strong><small>{dataset.meta.cqWW?`${result.summary.zones} received CQ zones`:"Zone interpretation is contest-specific"}</small></div>
      </section>
      {tab==="overview"&&<>
        <section className="analytics-section"><header><div><h2>Every hour tells part of the story</h2><p>{metric} by UTC · <span className="analytics-legend-bar"/> hourly output <span className="analytics-legend-line"/> cumulative contacts</p></div><div className="analytics-controls"><label>Measure<select value={measure} onChange={e=>setMeasure(e.target.value as typeof measure)}><option value="qsos">Contacts</option><option value="points">QSO points</option><option value="multipliers" disabled={!dataset.meta.cqWW}>New multipliers</option><option value="score" disabled={!dataset.scoreHistory}>Score growth</option></select></label><label>Bucket<select value={filters.minutes} onChange={e=>update({minutes:Number(e.target.value)})}>{[5,10,15,30,60].map(n=><option key={n} value={n}>{n} min</option>)}</select></label></div></header>
          <AnalyticsTimeline buckets={result.buckets} measure={measure} onDrill={onDrill} goal={measure==="qsos"?goal*filters.minutes/60:0}/><footer><span>Click any interval for its contacts. Dashed bars are partial buckets. Line uses its own cumulative scale, ending at {numberText(result.buckets.at(-1)?.cumulative??0)} QSOs.</span><button onClick={()=>setTab("explorer")}>Open Explorer</button></footer>
        </section>
        <div className="analytics-two-columns"><section className="analytics-section"><header><div><h2>Recent wall-clock pace</h2><p>Selected scope · Fixed-window denominators, ending now.</p></div><label>Hourly QSO goal<input aria-label="Analytics hourly goal" type="number" min={0} max={1000} value={goal||""} placeholder="Off" onChange={e=>setGoal(Math.max(0,Math.min(1000,Math.round(Number(e.target.value)||0))))}/></label></header><div className="analytics-table-scroll"><table><thead><tr><th>Window</th><th>QSO / h</th><th>Points / h</th><th>Score growth / h</th><th>Goal delta</th></tr></thead><tbody>{result.recent.map(row=><tr key={row.minutes}><th><button onClick={()=>onDrill(`Last ${row.minutes} minutes · fixed ${row.minutes}-minute denominator`,row.ids)}>{row.minutes} min</button></th><td>{numberText(row.rate,1)}</td><td>{numberText(row.points*60/row.minutes,1)}</td><td>{numberText(row.scoreGrowth,1)}</td><td>{goal?numberText(row.rate-goal,1):"Off"}</td></tr>)}</tbody></table></div><p className="analytics-note">These windows can include time before the first logged contact. No operating duration is inferred. Score growth uses reconstructed category deltas when supported.</p><p className="analytics-note">Last QSO in the selected scope: {result.lastQso===null?"Unavailable":`${utcText(result.lastQso)} UTC · ${Math.max(0,Math.floor((Date.now()-result.lastQso)/60000))} min ago`}.</p></section>
          <section className="analytics-section"><header><div><h2>Your strongest intervals</h2><p>Best logged QSO counts in fixed 10 / 30 / 60-minute windows.</p></div></header><table><thead><tr><th>Window</th><th>Starts UTC</th><th>Contacts</th><th>QSO / h</th></tr></thead><tbody>{result.best.map(row=><tr key={row.minutes}><th>{row.minutes} min</th><td>{row.start===null?"—":utcText(row.start)}</td><td><button onClick={()=>onDrill(`Best ${row.minutes}-minute interval · fixed denominator`,row.ids)}>{row.qsos}</button></td><td>{numberText(row.rate,1)}</td></tr>)}</tbody></table><p className="analytics-note">{dataset.scoreHistoryReason}</p></section></div>
        <section className="analytics-section"><header><div><h2>Band contribution</h2><p>Contacts, points and geographic reach in the displayed scope.</p></div></header><div className="analytics-table-scroll"><table><thead><tr><th>Band</th><th>Contacts</th><th>Distinct calls</th><th>QSO points</th><th>Points / QSO</th><th>Countries</th><th>New category mults</th></tr></thead><tbody>{(choices.band??[]).map((band:string)=>{const selected=new Set(result.summary.ids),rows=dataset.contacts.filter(q=>q.band===band&&selected.has(q.id)),sum=aggregate(rows);return <tr key={band}><th><button onClick={()=>onDrill(`${band} · current view`,sum.ids)}>{band}</button></th><td>{sum.qsos}</td><td>{sum.calls}</td><td>{numberText(sum.points)}</td><td>{sum.qsos?numberText(sum.points/sum.qsos,2):"—"}</td><td>{sum.countries}</td><td>{dataset.meta.cqWW?sum.multipliers:"Unavailable"}</td></tr>;})}</tbody></table></div><p className="analytics-note">Distinct country counts differ from country-band multipliers. Category score is not a sum of separately scored bands.</p></section>
      </>}
      {tab==="explorer"&&<AnalyticsExplorer result={result} filters={filters} onChange={update} onDrill={onDrill} multiplierSupported={dataset.meta.cqWW}/>}
      {tab==="multipliers"&&<AnalyticsMultipliers dataset={dataset} result={result} onDrill={onDrill}/>}
      {tab==="performance"&&<AnalyticsPerformance dataset={dataset} result={result} filters={filters} onDrill={onDrill}/>}
      {tab==="compare"&&<AnalyticsCompare dataset={dataset} filters={filters} onDrill={onDrill}/>}
      {tab==="quality"&&<AnalyticsQuality dataset={dataset} result={result} onDrill={onDrill}/>}
      <section className="analytics-section"><header><div><h2>Listen to this UTC interval</h2><p>Uses this dataset’s durable log identity and displayed time extent. Capture gaps and unmatched reference logs remain unavailable.</p></div><button disabled={locked||!result.buckets.length} onClick={()=>{const first=result.buckets[0],last=result.buckets.at(-1);if(first&&last)void listenToAudio({logId:dataset.meta.sessionID,fromUtcMs:first.start,toUtcMs:last.end}).catch(cause=>setError(errorText(cause)));}}>Listen to interval…</button></header></section>
      {drill&&<div ref={drillRef as React.RefObject<HTMLDivElement>}><AnalyticsDrilldown logId={dataset.meta.sessionID} title={drill.title} contacts={selectedContacts} exportState={exportState} onClose={()=>setDrill(null)}/></div>}
      <footer className="analytics-footer"><span>Revision {dataset.meta.revision} · {dataset.meta.referenceID} · Corrected claimed log</span><button onClick={()=>{setTab("quality");setDrill(null);}}>View calculation basis & coverage</button></footer>
      </>}
    </>}
    {!dataset&&!busy&&!analyzing&&!error&&<div className="analytics-empty"><BarChart3 size={32}/><h2>A clear view of your contest</h2><p>Open a contest session and refresh to explore its complete log.</p></div>}
    {busy&&<div className="analytics-loading"><RefreshCw size={22}/><p>{progress}</p><button onClick={()=>{abortRef.current?.abort();setProgress("Cancelled. Refresh when ready.");}}>Cancel</button></div>}
  </main>;
}

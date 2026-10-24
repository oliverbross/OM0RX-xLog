import { useMemo, useState } from "react";
import { FileUp } from "lucide-react";
import { aggregate, analyticsTime, comparisonFilters, numberText, readAnalyticsReport, selectContacts, type AnalyticsContact, type AnalyticsDataset, type AnalyticsFilters } from "./contestAnalytics";
import type { Drill } from "./ContestAnalyticsCharts";

export function AnalyticsCompare({dataset,filters,onDrill}:{dataset:AnalyticsDataset;filters:AnalyticsFilters;onDrill:Drill}){
  const [reference,setReference]=useState<AnalyticsDataset|null>(null),[error,setError]=useState(""),[currentStart,setCurrentStart]=useState(""),[referenceStart,setReferenceStart]=useState("");
  const comparison=useMemo(()=>{
    if(!reference)return {value:null,error:""};
    try{
    const first=(rows:AnalyticsContact[])=>rows.find(q=>q.time!==null)?.time??null;
    const start=currentStart?analyticsTime(currentStart):first(dataset.contacts),refStart=referenceStart?analyticsTime(referenceStart):first(reference.contacts);
    const current=selectContacts(dataset,filters),other=selectContacts(reference,comparisonFilters(filters,start,refStart));
    const bucket=(rows:AnalyticsContact[],anchor:number|null)=>{const map=new Map<number,AnalyticsContact[]>();if(anchor===null)return map;for(const q of rows)if(q.time!==null&&q.time>=anchor){const hour=Math.floor((q.time-anchor)/3600000),group=map.get(hour)??[];group.push(q);map.set(hour,group);}return map;};
    const a=bucket(current,start),b=bucket(other,refStart),last=Math.min(167,Math.max(0,...a.keys(),...b.keys()));let ca=0,cb=0;
    const timeline=Array.from({length:last+1},(_,hour)=>{const now=a.get(hour)??[],past=b.get(hour)??[];ca+=now.length;cb+=past.length;return {hour,now:now.length,past:past.length,currentTotal:ca,referenceTotal:cb,ids:now.map(q=>q.id)};});
    const bands=[...new Set([...current,...other].map(q=>q.band))].sort();
    return {value:{current,other,start,refStart,timeline,bands},error:""};
    }catch(cause){return {value:null,error:cause instanceof Error?cause.message:"Could not compare this UTC range."};}
  },[dataset,reference,filters,currentStart,referenceStart]);
  const compared=comparison.value;
  const load=async(file:File|undefined)=>{if(!file)return;setError("");try{if(file.size>32*1024*1024)throw new Error("Choose a report smaller than 32 MB.");setReference(readAnalyticsReport(await file.text()));}catch(cause){setError(cause instanceof Error?cause.message:"Could not read the reference report.");}};
  const mismatches=reference?["BandCategory","ModeCategory","PowerCategory","OperatorCategory","AssistedCategory","TransmitterCategory"].filter(key=>JSON.stringify(reference.meta.settings[key])!==JSON.stringify(dataset.meta.settings[key])):[];
  return <><section className="analytics-section"><header><div><h2>Compare two efforts</h2><p>Import a saved xLog analytics report as a separate, read-only reference.</p></div><label className="analytics-file"><FileUp size={15}/> Choose reference report<input aria-label="Reference analytics report" type="file" accept=".json,application/json" onChange={e=>{void load(e.target.files?.[0]);e.target.value="";}}/></label></header>
    {error&&<p role="alert">{error}</p>}
    {comparison.error&&<p role="alert">{comparison.error}</p>}
    {!reference?<div className="analytics-empty"><h3>Bring a previous effort alongside this one</h3><p>Use “Export report” in another contest, then choose its JSON file here. Contacts stay in their original session. Core analysis works offline.</p><p>Cabrillo / ADIF reference import and official adjudicated results need a future parser; this version compares complete xLog reports.</p></div>:<><p><strong>{reference.meta.stationCall} · {reference.meta.name}</strong> · {numberText(reference.meta.total)} logged contacts · Corrected claimed log</p>
      {(mismatches.length>0||reference.meta.pluginID!==dataset.meta.pluginID||reference.meta.referenceID!==dataset.meta.referenceID)&&<p className="analytics-warning">Comparison context differs: {[...mismatches,reference.meta.pluginID!==dataset.meta.pluginID?"contest plugin":"",reference.meta.referenceID!==dataset.meta.referenceID?"CTY reference":""].filter(Boolean).join(", ")}. These efforts are not an equivalent operator ranking.</p>}
      <p className="analytics-note">Station setup, location and rules must be checked by the operator. Both scores are claimed, not adjudicated.</p>
      <div className="analytics-controls"><label>Current event start · UTC<input type="datetime-local" value={currentStart} onChange={e=>setCurrentStart(e.target.value)}/></label><label>Reference event start · UTC<input type="datetime-local" value={referenceStart} onChange={e=>setReferenceStart(e.target.value)}/></label><button onClick={()=>setReference(null)}>Remove reference</button></div>
      <p className="analytics-note">{currentStart&&referenceStart?"Aligned by entered event starts.":"Without entered event starts, each log aligns to its first logged contact; this is not elapsed event time."} Display dimensions and the equivalent elapsed time interval apply to both logs.</p>
    </>}
  </section>
    {compared&&reference&&<><section className="analytics-section"><h2>Elapsed-hour contact pace</h2><div className="analytics-table-scroll"><table><thead><tr><th>Elapsed hour</th><th>Current</th><th>Reference</th><th>Current cumulative</th><th>Reference cumulative</th><th>Cumulative difference</th></tr></thead><tbody>{compared.timeline.map(row=><tr key={row.hour}><th>+{row.hour}:00</th><td><button onClick={()=>onDrill(`Current effort · elapsed hour ${row.hour}`,row.ids)}>{row.now}</button></td><td>{row.past}</td><td>{row.currentTotal}</td><td>{row.referenceTotal}</td><td className={row.currentTotal>=row.referenceTotal?"analytics-positive":"analytics-attention"}>{row.currentTotal-row.referenceTotal>0?"+":""}{row.currentTotal-row.referenceTotal}</td></tr>)}</tbody></table></div><p className="analytics-note">Up to 168 elapsed hours. Reference and current remain separate datasets. Empty hours show no logged contacts.</p></section>
      <section className="analytics-section"><h2>Band contribution</h2><div className="analytics-table-scroll"><table><thead><tr><th>Band</th><th>Current QSOs</th><th>Reference QSOs</th><th>Current share</th><th>Reference share</th><th>QSO-point difference</th></tr></thead><tbody>{compared.bands.map(band=>{const a=aggregate(compared.current.filter(q=>q.band===band)),b=aggregate(compared.other.filter(q=>q.band===band));return <tr key={band}><th>{band}</th><td><button onClick={()=>onDrill(`${band} · current effort`,a.ids)}>{a.qsos}</button></td><td>{b.qsos}</td><td>{numberText(compared.current.length?a.qsos/compared.current.length*100:0,1)}%</td><td>{numberText(compared.other.length?b.qsos/compared.other.length*100:0,1)}%</td><td>{numberText(a.points-b.points)}</td></tr>;})}</tbody></table></div></section></>}
  </>;
}

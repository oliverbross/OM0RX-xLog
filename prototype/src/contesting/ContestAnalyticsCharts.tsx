import { useEffect, useState } from "react";
import { type AnalyticsBucket, type AnalyticsResult, type AnalyticsFilters, type Dimension, type Measure, dimensions, dimensionLabels, numberText, utcText } from "./contestAnalytics";
export type Drill=(title:string,ids:string[])=>void;
export function AnalyticsTimeline({buckets,measure,onDrill,goal=0}:{buckets:AnalyticsBucket[];measure:"qsos"|"points"|"multipliers"|"score";onDrill:Drill;goal?:number}){
  const maximum=Math.max(1,...buckets.map(bucket=>bucket[measure]??0),goal),cumulative=Math.max(1,buckets.at(-1)?.cumulative??0),width=Math.max(700,buckets.length*22);
  return <div className="analytics-chart-scroll"><div className="analytics-chart" style={{width:`max(100%, ${width}px)`}}>
    <div className="analytics-chart-axis"><span>{numberText(maximum)}</span><span>{numberText(maximum/2)}</span><span>0</span></div>
    <div className="analytics-bars" style={{gridTemplateColumns:`repeat(${Math.max(1,buckets.length)},minmax(0,1fr))`}}>
      <svg viewBox={`0 0 ${Math.max(1,buckets.length)*20} 190`} preserveAspectRatio="none" aria-hidden="true" className="analytics-cumulative"><polyline points={buckets.map((bucket,index)=>`${index*20+10},${185-bucket.cumulative/cumulative*175}`).join(" ")}/></svg>
      {goal>0&&<div className="analytics-goal-line" style={{bottom:`${goal/maximum*100}%`}}><span>Goal {goal}</span></div>}
      {buckets.map((bucket,index)=><button key={bucket.start} className={bucket.partial?"is-partial":""} aria-label={`${utcText(bucket.start)} UTC · ${numberText(bucket[measure])} ${measure}${bucket.partial?" · partial bucket":""}`} onClick={()=>onDrill(`${utcText(bucket.start)} – ${utcText(bucket.end)} UTC · [start, end)`,bucket.ids)} title={`${utcText(bucket.start)} UTC\n${numberText(bucket[measure])} ${measure}\n${bucket.cumulative} cumulative QSOs${bucket.partial?"\nPartial bucket":""}`}>
        <span className="analytics-bar-fill" style={{height:`${Math.max(0,(bucket[measure]??0)/maximum*100)}%`}}/>
        {(index%Math.max(1,Math.ceil(buckets.length/12))===0||index===buckets.length-1)&&<time className="analytics-tick">{utcText(bucket.start).slice(5,10)}<br/>{utcText(bucket.start).slice(11)}</time>}
      </button>)}
    </div>
  </div></div>;
}
export function AnalyticsExplorer({result,filters,onChange,onDrill,multiplierSupported}:{result:AnalyticsResult;filters:AnalyticsFilters;onChange:(patch:Partial<AnalyticsFilters>)=>void;onDrill:Drill;multiplierSupported:boolean}){
  const [heat,setHeat]=useState(true),[page,setPage]=useState(0),[columnPage,setColumnPage]=useState(0),pivot=result.pivot,max=Math.max(1,...pivot.cells.map(c=>c.value));
  useEffect(()=>{setPage(0);setColumnPage(0);},[filters,pivot.rows.length,pivot.columns.length]);
  const rows=pivot.rows.slice(page*80,page*80+80),columns=pivot.columns.slice(columnPage*40,columnPage*40+40);
  const cells=new Map(pivot.cells.map(cell=>[JSON.stringify([cell.row,cell.column]),cell]));
  const format=(value:number)=>filters.measure==="share"?`${numberText(value,1)}%`:numberText(value);
  return <section className="analytics-section"><header><div><h2>Explore the log</h2><p>Choose dimensions. Select a cell to see its contributing contacts.</p></div></header>
    <div className="analytics-controls"><label>Rows<select value={filters.row} onChange={e=>{setPage(0);onChange({row:e.target.value as Dimension});}}>{dimensions.map(d=><option key={d} value={d}>{dimensionLabels[d]}</option>)}</select></label>
      <label>Columns<select value={filters.column} onChange={e=>{setColumnPage(0);onChange({column:e.target.value as Dimension});}}>{dimensions.map(d=><option key={d} value={d}>{dimensionLabels[d]}</option>)}</select></label>
      <label>Measure<select value={filters.measure} onChange={e=>onChange({measure:e.target.value as Measure})}><option value="qsos">Logged contacts</option><option value="calls">Distinct callsigns</option><option value="points">QSO points</option><option value="multipliers" disabled={!multiplierSupported}>New credited multipliers</option><option value="share">Share of contacts (%)</option></select></label>
      <label className="analytics-check"><input type="checkbox" checked={heat} onChange={e=>setHeat(e.target.checked)}/> Heatmap</label>
      <label>Preset<select value="" onChange={e=>{const [row,column]=e.target.value.split("/") as Dimension[];if(row){setPage(0);onChange({row,column});}}}><option value="">Choose a question…</option><option value="hour/band">When did each band produce?</option><option value="country/band">Country coverage by band</option><option value="hour/continent">When did regions appear?</option><option value="style/band">Run versus S&P by band</option><option value="hour/operator">Activity across operator shifts</option><option value="band/mode">Band and mode mix</option></select></label>
    </div>
    <div className="analytics-table-scroll"><table className="analytics-pivot" aria-label="Contest analytics cross-tab"><thead><tr><th>{dimensionLabels[filters.row]} / {dimensionLabels[filters.column]}</th>{columns.map(c=><th key={c}>{c}</th>)}<th>Total</th></tr></thead><tbody>{rows.map(row=><tr key={row}><th scope="row">{row}</th>{columns.map(column=>{const cell=cells.get(JSON.stringify([row,column]));return <td key={column} style={heat&&cell?{backgroundColor:`rgb(53 200 245 / ${.06+cell.value/max*.3})`}:undefined}><button onClick={()=>onDrill(`${row} / ${column} · ${format(cell?.value??0)} ${filters.measure}`,cell?.ids??[])}>{format(cell?.value??0)}</button></td>;})}<td><button onClick={()=>onDrill(row,pivot.cells.filter(c=>c.row===row).flatMap(c=>c.ids))}>{format(pivot.rowTotals.find(r=>r.key===row)?.value??0)}</button></td></tr>)}</tbody><tfoot><tr><th>Total</th>{columns.map(column=><td key={column}><button onClick={()=>onDrill(column,pivot.cells.filter(c=>c.column===column).flatMap(c=>c.ids))}>{format(pivot.columnTotals.find(c=>c.key===column)?.value??0)}</button></td>)}<td>{format(pivot.total)}</td></tr></tfoot></table></div>
    {!pivot.rows.length&&<p className="analytics-empty">No contacts match this view. Clear filters or choose another UTC interval.</p>}
    <footer><span>Distinct totals are recomputed from contacts. New multiplier events retain their full category history.</span>{pivot.rows.length>80&&<div><button disabled={page===0} onClick={()=>setPage(p=>p-1)}>Previous rows</button> <span>{page+1} / {Math.ceil(pivot.rows.length/80)}</span> <button disabled={(page+1)*80>=pivot.rows.length} onClick={()=>setPage(p=>p+1)}>Next rows</button></div>}{pivot.columns.length>40&&<div><button disabled={columnPage===0} onClick={()=>setColumnPage(p=>p-1)}>Previous columns</button> <span>{columnPage+1} / {Math.ceil(pivot.columns.length/40)}</span> <button disabled={(columnPage+1)*40>=pivot.columns.length} onClick={()=>setColumnPage(p=>p+1)}>Next columns</button></div>}</footer>
  </section>;
}

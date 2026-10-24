/** Pure analysis of an immutable host copy. No log, station, network or scoring writes. */
export type AnalyticsRow = {
  id:string;sourceOrder:number;call:string;utc:string;band:string;frequencyKHz:number|null;mode:string;operator:string;
  style:string;country:string;countryName:string;continent:string;zone:string;prefix:string;
  points:number|null;inCategory:boolean;multiplierEligible:boolean|null;
};
export type AnalyticsMeta = {
  sessionID:string;workspaceGeneration:string;snapshotID:string;identity:string;revision:number;total:number;
  pluginID:string;name:string;stationCall:string;settings:Record<string,unknown>;referenceID:string;
  sourceRevision:string;capturedAt:string;cqWW:boolean;dupeType:number;
  score:{qsos:number;points:number;multipliers:number;total:number;countries?:number;zones?:number};
};
export type AnalyticsContact = AnalyticsRow & {time:number|null;dupe:boolean|null;newKeys:string[];supportKeys:string[];scoreGain:number|null;issues:string[]};
export type AnalyticsDataset = {meta:AnalyticsMeta;contacts:AnalyticsContact[];scoreHistory:boolean;scoreHistoryReason:string};
export type Dimension = "hour"|"band"|"mode"|"country"|"continent"|"zone"|"operator"|"style"|"prefix";
export type Measure = "qsos"|"calls"|"points"|"multipliers"|"share";
export type AnalyticsFilters = {band:string;mode:string;operator:string;style:string;continent:string;scope:"all"|"category";basis:"logged"|"nondupe";from:string;to:string;minutes:number;row:Dimension;column:Dimension;measure:Measure};
export const defaultAnalyticsFilters:AnalyticsFilters={band:"all",mode:"all",operator:"all",style:"all",continent:"all",scope:"all",basis:"logged",from:"",to:"",minutes:60,row:"hour",column:"band",measure:"qsos"};
export const dimensions:Dimension[]=["hour","band","mode","country","continent","zone","operator","style","prefix"];
export const dimensionLabels:Record<Dimension,string>={hour:"UTC hour",band:"Band",mode:"Mode",country:"Country prefix",continent:"Continent",zone:"CQ zone",operator:"Operator",style:"Run / S&P",prefix:"WPX prefix"};
export const numberText=(value:number|null|undefined,maximumFractionDigits=0)=>value===null||value===undefined?"—":value.toLocaleString(undefined,{maximumFractionDigits});
export const utcText=(time:number)=>new Date(time).toISOString().replace("T"," ").slice(0,16);

export function analyticsTime(value:string):number|null {
  const match=/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if(!match)return null;
  const [,year,month,day,hour,minute,second="00",fraction="",offset="Z"]=match;
  const check=new Date(Date.UTC(+year,+month-1,+day,+hour,+minute,+second));
  if(check.getUTCFullYear()!==+year||check.getUTCMonth()!==+month-1||check.getUTCDate()!==+day||check.getUTCHours()!==+hour||check.getUTCMinutes()!==+minute||check.getUTCSeconds()!==+second)return null;
  const time=Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}${fraction}${offset}`);
  return Number.isFinite(time)?time:null;
}
const modeGroup=(mode:string)=>["SSB","USB","LSB","PH","PHONE"].includes(mode)?"SSB":mode;

export function prepareAnalytics(meta:AnalyticsMeta,rows:AnalyticsRow[]):AnalyticsDataset {
  const contacts:AnalyticsContact[]=rows.map(row=>({...row,time:analyticsTime(row.utc),dupe:null,newKeys:[],supportKeys:[],scoreGain:null,issues:[]}));
  contacts.sort((a,b)=>(a.time??Infinity)-(b.time??Infinity)); // Stable ties preserve the host's TS,rowid order.
  const seen=new Set<string>(),multipliers=new Set<string>();let points=0;
  for(const qso of contacts){
    if(qso.time===null)qso.issues.push("Invalid timestamp");
    if(qso.time!==null&&qso.time>Date.parse(meta.capturedAt))qso.issues.push("Timestamp after snapshot capture");
    if(!/^[A-Z0-9/]{3,32}$/.test(qso.call)||!/[A-Z]/.test(qso.call)||!/[0-9]/.test(qso.call))qso.issues.push("Invalid callsign");
    if(qso.band==="Unknown")qso.issues.push("Unknown band");
    if(qso.country==="Unknown")qso.issues.push("Unresolved country");
    if(qso.points===null)qso.issues.push("Unknown QSO points");
    if(qso.style==="Unknown")qso.issues.push("Unattributed operating style");
    if(qso.operator==="Unknown")qso.issues.push("Unattributed operator");
    if(meta.cqWW&&qso.zone==="Unknown")qso.issues.push("Unresolved CQ zone");
  }
  // Match the host's stored row order for duplicate ownership, including
  // backdated entries. Only the displayed timeline is chronological.
  for(const qso of [...contacts].sort((a,b)=>a.sourceOrder-b.sourceOrder)){
    const call=qso.call.trim().toUpperCase();
    const key=meta.dupeType===1?call:meta.dupeType===2?`${call}|${qso.band}`:meta.dupeType===3?`${call}|${qso.band}|${modeGroup(qso.mode)}`:null;
    if(meta.dupeType===4)qso.dupe=false;
    else if(key&&!qso.issues.includes("Invalid callsign")&&qso.band!=="Unknown"){
      qso.dupe=seen.has(key);seen.add(key);
    }
  }
  for(const qso of contacts){
    if(!qso.inCategory)continue;
    const before=points*multipliers.size;
    points+=qso.points??0;
    // Only CQ WW CW/SSB has a verified country-band + received-zone-band adapter.
    if(meta.cqWW&&qso.multiplierEligible===true){
      if(qso.country!=="Unknown")qso.supportKeys.push(`Country ${qso.country} · ${qso.band}`);
      if(qso.zone!=="Unknown")qso.supportKeys.push(`CQ zone ${qso.zone} · ${qso.band}`);
      for(const mult of qso.supportKeys)if(!multipliers.has(mult)){multipliers.add(mult);qso.newKeys.push(mult);}
    }
    if(meta.cqWW)qso.scoreGain=points*multipliers.size-before;
  }
  const complete=contacts.filter(q=>q.inCategory).every(q=>q.time!==null&&q.points!==null&&q.dupe!==null&&q.country!=="Unknown"&&q.zone!=="Unknown"&&q.multiplierEligible===!q.dupe);
  const reconciled=meta.cqWW&&complete&&points===meta.score.points&&multipliers.size===meta.score.multipliers&&points*multipliers.size===meta.score.total;
  if(!reconciled)for(const qso of contacts)qso.scoreGain=null;
  return {meta,contacts,scoreHistory:reconciled,scoreHistoryReason:reconciled?"Reconstructed from the corrected category log; reconciles with the host score.":meta.cqWW?"Score history unavailable: complete category data must reconcile with the host score.":"Historical score and credited multiplier keys need a contest-specific adapter. Current claimed score comes from the host."};
}

export type Aggregate = {qsos:number;calls:number;points:number;unknownPoints:number;nondupe:number;duplicates:number;unknownDupe:number;multipliers:number;countries:number;zones:number;ids:string[]};
export function aggregate(rows:AnalyticsContact[]):Aggregate {
  return {qsos:rows.length,calls:new Set(rows.map(q=>q.call.trim().toUpperCase())).size,points:rows.reduce((s,q)=>s+(q.points??0),0),
    unknownPoints:rows.filter(q=>q.points===null).length,nondupe:rows.filter(q=>q.dupe===false).length,duplicates:rows.filter(q=>q.dupe===true).length,
    unknownDupe:rows.filter(q=>q.dupe===null).length,multipliers:rows.reduce((s,q)=>s+q.newKeys.length,0),
    countries:new Set(rows.filter(q=>q.country!=="Unknown").map(q=>q.country)).size,zones:new Set(rows.filter(q=>q.zone!=="Unknown").map(q=>q.zone)).size,ids:rows.map(q=>q.id)};
}
export function selectContacts(dataset:AnalyticsDataset,filters:AnalyticsFilters):AnalyticsContact[]{
  const from=filters.from?analyticsTime(filters.from):null,to=filters.to?analyticsTime(filters.to):null;
  if(filters.from&&from===null||filters.to&&to===null||from!==null&&to!==null&&from>=to)throw new Error("Choose a valid UTC interval with the end after the start.");
  return dataset.contacts.filter(q=>(filters.scope==="all"||q.inCategory)&&(filters.basis==="logged"||q.dupe===false)
    &&(["band","mode","operator","style","continent"] as const).every(key=>filters[key]==="all"||filters[key]===q[key])
    &&(from===null||q.time!==null&&q.time>=from)&&(to===null||q.time!==null&&q.time<to));
}
export type AnalyticsBucket={start:number;end:number;partial:boolean;qsos:number;points:number;multipliers:number;score:number|null;cumulative:number;ids:string[]};
export function timeline(rows:AnalyticsContact[],filters:AnalyticsFilters,now:number,scoreHistory:boolean,extent?:{first:number;last:number}):AnalyticsBucket[]{
  const timed=rows.filter(q=>q.time!==null),span=filters.minutes*60000;
  if(![5,10,15,30,60].includes(filters.minutes))throw new Error("Unsupported timeline interval.");
  const first=filters.from?analyticsTime(filters.from):extent?.first??timed[0]?.time;
  const last=filters.to?analyticsTime(filters.to):extent?.last??timed.at(-1)?.time;
  if(first==null||last==null)return [];
  const start=Math.floor(first/span)*span,end=filters.to?last:Math.floor(Math.max(last,now-last<86400000?now:last)/span)*span+span;
  const count=Math.ceil((end-start)/span);
  if(count>4096)throw new Error("This interval contains more than 4,096 buckets. Choose a shorter UTC range or larger buckets.");
  const buckets:AnalyticsBucket[]=Array.from({length:Math.max(0,count)},(_,index)=>({start:start+index*span,end:Math.min(end,start+(index+1)*span),partial:false,qsos:0,points:0,multipliers:0,score:scoreHistory?0:null,cumulative:0,ids:[]}));
  for(const qso of timed){const bucket=buckets[Math.floor((qso.time!-start)/span)];if(bucket){bucket.qsos++;bucket.points+=qso.points??0;bucket.multipliers+=qso.newKeys.length;if(bucket.score!==null)bucket.score+=qso.scoreGain??0;bucket.ids.push(qso.id);}}
  let cumulative=0;
  return buckets.map(bucket=>{cumulative+=bucket.qsos;return {...bucket,cumulative,partial:bucket.start<=now&&now<bucket.end||bucket.start<first||bucket.end-bucket.start<span};});
}
export function dimensionValue(qso:AnalyticsContact,dimension:Dimension):string {
  return dimension==="hour"?(qso.time===null?"Invalid timestamp":utcText(Math.floor(qso.time/3600000)*3600000)):qso[dimension];
}
export type PivotCell={row:string;column:string;value:number;ids:string[]};
export function pivot(rows:AnalyticsContact[],row:Dimension,column:Dimension,measure:Measure){
  const groups=new Map<string,AnalyticsContact[]>(),rowGroups=new Map<string,AnalyticsContact[]>(),columnGroups=new Map<string,AnalyticsContact[]>();
  const add=(map:Map<string,AnalyticsContact[]>,key:string,qso:AnalyticsContact)=>{const group=map.get(key)??[];group.push(qso);map.set(key,group);};
  for(const qso of rows){const r=dimensionValue(qso,row),c=dimensionValue(qso,column);add(groups,JSON.stringify([r,c]),qso);add(rowGroups,r,qso);add(columnGroups,c,qso);}
  const value=(group:AnalyticsContact[])=>measure==="share"?(rows.length?group.length/rows.length*100:0):aggregate(group)[measure];
  const cells:PivotCell[]=[...groups].map(([key,group])=>{const [r,c]=JSON.parse(key);return {row:r,column:c,value:value(group),ids:group.map(q=>q.id)};});
  const rowKeys=[...new Set(cells.map(c=>c.row))].sort(),columnKeys=[...new Set(cells.map(c=>c.column))].sort();
  return {cells,rows:rowKeys,columns:columnKeys,total:value(rows),rowTotals:rowKeys.map(key=>({key,value:value(rowGroups.get(key)!)})),columnTotals:columnKeys.map(key=>({key,value:value(columnGroups.get(key)!)}))};
}
export function bestIntervals(rows:AnalyticsContact[]){
  const timed=rows.filter(q=>q.time!==null);
  return [10,30,60].map(minutes=>{let right=0,bestStart=0,bestEnd=0;const span=minutes*60000;
    for(let left=0;left<timed.length;left++){while(right<timed.length&&timed[right].time!<timed[left].time!+span)right++;if(right-left>bestEnd-bestStart){bestStart=left;bestEnd=right;}}
    const best=timed.slice(bestStart,bestEnd);return {minutes,start:best[0]?.time??null,qsos:best.length,rate:best.length*60/minutes,ids:best.map(q=>q.id)};
  });
}
export type AnalyticsResult=ReturnType<typeof analyzeAnalytics>;
export function analyzeAnalytics(dataset:AnalyticsDataset,filters:AnalyticsFilters,now:number){
  if(filters.measure==="multipliers"&&!dataset.meta.cqWW)throw new Error("Credited multiplier keys are unavailable for this contest. Choose contacts, calls or points.");
  const rows=selectContacts(dataset,filters),timed=rows.filter(q=>q.time!==null&&q.time<=now),last=timed.at(-1);
  const allTimed=dataset.contacts.filter(q=>q.time!==null),extent=allTimed.length?{first:allTimed[0].time!,last:allTimed.at(-1)!.time!}:undefined;
  const supportMap=new Map<string,AnalyticsContact[]>();
  for(const q of dataset.contacts)for(const key of q.supportKeys){const group=supportMap.get(key)??[];group.push(q);supportMap.set(key,group);}
  const recent=[10,30,60].map(minutes=>{const selected=timed.filter(q=>q.time!>=now-minutes*60000);return {minutes,...aggregate(selected),rate:selected.length*60/minutes,scoreGrowth:dataset.scoreHistory?selected.reduce((s,q)=>s+(q.scoreGain??0),0)*60/minutes:null};});
  return {summary:aggregate(rows),buckets:timeline(rows,filters,now,dataset.scoreHistory,extent),pivot:pivot(rows,filters.row,filters.column,filters.measure),best:bestIntervals(rows),recent,lastQso:last?.time??null,
    support:[...new Set(rows.flatMap(q=>q.supportKeys))].map(key=>{const all=supportMap.get(key)!;return {key,ids:all.map(q=>q.id),first:all[0]?.utc??"",support:all.length};}),
    styles:["Run","S&P","Unknown"].map(style=>({style,...aggregate(rows.filter(q=>q.style===style))})),
    quality:[...new Set(rows.flatMap(q=>q.issues))].map(issue=>({issue,ids:rows.filter(q=>q.issues.includes(issue)).map(q=>q.id)}))};
}

/** Translate the display UTC interval into the same elapsed interval in another log. */
export function comparisonFilters(filters:AnalyticsFilters,currentStart:number|null,referenceStart:number|null):AnalyticsFilters {
  if(currentStart===null||referenceStart===null)return {...filters,from:"",to:""};
  const translated=(value:string)=>{const time=analyticsTime(value);return time===null?"":new Date(referenceStart+time-currentStart).toISOString();};
  return {...filters,from:filters.from?translated(filters.from):"",to:filters.to?translated(filters.to):""};
}

export function analyticsReport(dataset:AnalyticsDataset,filters:AnalyticsFilters){
  return {format:"xlog-contest-analytics-v1",exportedAt:new Date().toISOString(),basis:"Corrected claimed log; not adjudicated",meta:dataset.meta,filters,rows:dataset.contacts.map(({time,dupe,newKeys,supportKeys,scoreGain,issues,...row})=>row)};
}
export function readAnalyticsReport(text:string):AnalyticsDataset {
  if(text.length>32*1024*1024)throw new Error("Choose an analytics report smaller than 32 MB.");
  const report=JSON.parse(text);
  if(report?.format!=="xlog-contest-analytics-v1"||!Array.isArray(report.rows)||report.rows.length>50000||report.rows.length!==report.meta?.total)throw new Error("Choose a complete xLog analytics JSON report.");
  const strings=["id","call","utc","band","mode","operator","style","country","countryName","continent","zone","prefix"];
  if(report.rows.some((row:AnalyticsRow)=>!row||strings.some(key=>typeof row[key as keyof AnalyticsRow]!=="string"||String(row[key as keyof AnalyticsRow]).length>256)||typeof row.inCategory!=="boolean"||(row.multiplierEligible!==null&&typeof row.multiplierEligible!=="boolean")||(row.points!==null&&!Number.isFinite(row.points))||(row.frequencyKHz!==null&&!Number.isFinite(row.frequencyKHz)))||new Set(report.rows.map((row:AnalyticsRow)=>row.id)).size!==report.rows.length)throw new Error("The reference report contains invalid contact data.");
  if(report.rows.some((row:AnalyticsRow)=>!Number.isSafeInteger(row.sourceOrder)||row.sourceOrder<1)
    ||new Set(report.rows.map((row:AnalyticsRow)=>row.sourceOrder)).size!==report.rows.length)
    throw new Error("The reference report lacks valid stored contact order. Export a fresh analytics report.");
  const meta=report.meta;
  if(!meta||!["sessionID","workspaceGeneration","snapshotID","identity","pluginID","name","stationCall","referenceID","capturedAt"].every(key=>typeof meta[key]==="string"&&meta[key].length<=256)||!meta.settings||typeof meta.settings!=="object"||Array.isArray(meta.settings)||typeof meta.cqWW!=="boolean"||!Number.isInteger(meta.dupeType)||!meta.score||!["qsos","points","multipliers","total"].every(key=>Number.isFinite(meta.score[key])))throw new Error("The reference report metadata is invalid.");
  // Never trust capabilities supplied by an imported file.
  return prepareAnalytics({...meta,cqWW:["cq_ww_cw","cq_ww_ssb"].includes(meta.pluginID)},report.rows);
}

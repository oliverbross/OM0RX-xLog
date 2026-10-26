import { describe,expect,it } from "vitest";
import { aggregate,analyzeAnalytics,analyticsReport,analyticsTime,bestIntervals,comparisonFilters,conditionalContactGain,defaultAnalyticsFilters,pivot,prepareAnalytics,readAnalyticsReport,selectContacts,timeline } from "./contestAnalytics";
import { analyticsFixtureMeta,analyticsFixtureRows } from "./contestAnalytics.fixtures";

const data=()=>prepareAnalytics(analyticsFixtureMeta,analyticsFixtureRows);
describe("contest analytical semantics",()=>{
  it("withholds conditional gains for unreconciled history or explicit incomplete scoring even when terminal arithmetic matches",()=>{
    const meta={...analyticsFixtureMeta,hostEvidence:true,score:{qsos:1,points:2,multipliers:1,total:2},
      scoreHistory:{status:"UNVERIFIED" as const,reason:"Pinned prefix rebuild changes earlier points",model:"points-times-credited-identities"}};
    expect(conditionalContactGain(meta,3,1)).toBeNull();
    const incomplete={...meta,score:{...meta.score,scoringComplete:false},scoreHistory:{...meta.scoreHistory,status:"PASS" as const}};
    expect(conditionalContactGain(incomplete,3,1)).toBeNull();
    const dataset=prepareAnalytics(incomplete,[{...analyticsFixtureRows[0],points:2,claimedScore:2,hostDupe:false}]);
    expect(dataset.scoreHistory).toBe(false);
    expect(dataset.contacts[0].scoreGain).toBeNull();
    expect(conditionalContactGain({...meta,hostEvidence:false,cqWW:true},3,1)).toBe(8);
  });
  it("uses host additive/bonus events and initial score without substituting a product",()=>{
    const meta={...analyticsFixtureMeta,cqWW:false,pluginID:"es_manual_key",hostEvidence:true,multiplierAdapter:true,total:2,
      scoreHistory:{status:"PASS" as const,reason:"Corrected log; station seniority bonus.",model:"points-plus-seniority-times-identities-plus-one",factor:1,initialScore:15,constantBonus:15},
      score:{qsos:2,points:30,multipliers:0,total:45}};
    const rows=[{...analyticsFixtureRows[0],points:25,claimedScore:40,hostDupe:false,creditedKeys:[]},
      {...analyticsFixtureRows[1],points:5,claimedScore:45,hostDupe:false,creditedKeys:[]}];
    const dataset=prepareAnalytics(meta,rows);
    expect(dataset.scoreHistory).toBe(true);expect(dataset.contacts.map(q=>q.scoreGain)).toEqual([25,5]);
    expect(conditionalContactGain(meta,10,0)).toBe(10);expect(conditionalContactGain(meta,0,1)).toBe(45);
    expect(prepareAnalytics({...meta,score:{...meta.score,total:46}},rows).scoreHistory).toBe(false);
    expect(conditionalContactGain({...meta,score:{...meta.score,total:46}},10,0)).toBeNull();
  });
  it("reconciles configured factors and keeps unknown score growth null",()=>{
    const meta={...analyticsFixtureMeta,cqWW:false,pluginID:"winter_field_day",hostEvidence:true,
      scoreHistory:{status:"PASS" as const,reason:"Verified configured factor",model:"points-times-credited-identities",factor:2},
      score:{qsos:4,points:10,multipliers:2,total:40}};
    expect(conditionalContactGain(meta,3,1)).toBe(38);
    expect(conditionalContactGain({...meta,score:{qsos:4,points:10,multipliers:58,total:580},scoreHistory:{...meta.scoreHistory,model:"points-times-capped-identities",factor:1,identityCap:58}},3,1)).toBe(174);
    const unknown=prepareAnalytics({...meta,scoreHistory:{status:"UNVERIFIED",reason:"Backdated owner",model:"points-times-credited-identities"}},analyticsFixtureRows);
    expect(unknown.scoreHistory).toBe(false);expect(unknown.contacts.every(q=>q.scoreGain===null)).toBe(true);
    expect(timeline(unknown.contacts,defaultAnalyticsFilters,Date.parse(meta.capturedAt),false).every(row=>row.score===null)).toBe(true);
  });
  it("uses authoritative timed duplicate evidence and strips imported host capabilities",()=>{
    const meta={...analyticsFixtureMeta,cqWW:false,pluginID:"trans_tasman",hostEvidence:true,dupeType:5,total:2,
      multiplierAdapter:false,scoreHistory:{status:"PASS" as const,reason:"Block products",model:"sum-of-utc-block-products"},
      neededViews:[{id:"prefix",label:"Prefixes",status:"NOT APPLICABLE" as const,reason:"Open-ended universe",rows:[]}],
      score:{qsos:2,points:2,multipliers:1,total:2}};
    const rows=[{...analyticsFixtureRows[0],points:1,claimedScore:1,hostDupe:false},
      {...analyticsFixtureRows[1],points:1,claimedScore:2,hostDupe:false}];
    const dataset=prepareAnalytics(meta,rows);expect(dataset.scoreHistory).toBe(true);expect(dataset.contacts.map(row=>row.dupe)).toEqual([false,false]);
    const imported=readAnalyticsReport(JSON.stringify(analyticsReport(dataset,defaultAnalyticsFilters)));
    expect(imported.meta.hostEvidence).toBe(false);expect(imported.meta.neededViews).toBeUndefined();expect(imported.scoreHistory).toBe(false);
    expect(imported.contacts.every(row=>row.dupe===null)).toBe(true);
  });
  it("uses global family keys across bands and withholds unreconciled histories",()=>{
    const meta={...analyticsFixtureMeta,cqWW:false,pluginID:"cq_wpx_cw",multiplierAdapter:true,total:2,score:{qsos:2,points:6,multipliers:1,total:6}};
    const rows=[{...analyticsFixtureRows[0],mode:"CW",zone:"Unknown",creditedKeys:["WPX prefixes K1 · Contest"],multiplierEligible:null},
      {...analyticsFixtureRows[0],id:"second",sourceOrder:2,utc:"2026-10-25 00:00:00",mode:"CW",band:"40m",zone:"Unknown",creditedKeys:["WPX prefixes K1 · Contest"],multiplierEligible:null}];
    const dataset=prepareAnalytics(meta,rows);
    expect(dataset.scoreHistory).toBe(true);expect(dataset.contacts.map(q=>q.newKeys.length)).toEqual([1,0]);
    expect(dataset.contacts.reduce((sum,q)=>sum+(q.scoreGain??0),0)).toBe(6);
    expect(prepareAnalytics({...meta,score:{...meta.score,total:12}},rows).scoreHistory).toBe(false);
    const reference=readAnalyticsReport(JSON.stringify(analyticsReport(dataset,defaultAnalyticsFilters)));
    expect(reference.scoreHistory).toBe(false);
  });
  it("accepts Not1MM UTC, offset ISO, and minutes; rejects impossible dates",()=>{
    expect(analyticsTime("2026-10-25 00:00:00")).toBe(analyticsTime("2026-10-25T02:00:00+02:00"));
    expect(analyticsTime("2026-02-30 12:00:00")).toBeNull();expect(analyticsTime("2026-10-25T24:00:00Z")).toBeNull();
    expect(analyticsTime("2026-10-25T00:00")).toBe(analyticsTime("2026-10-25T00:00:00Z"));
  });
  it("reconciles CQ WW product score and preserves zero-point multiplier support",()=>{
    const dataset=data();expect(dataset.scoreHistory).toBe(true);
    expect(dataset.contacts[1].newKeys).toHaveLength(2);expect(dataset.contacts[1].points).toBe(0);
    expect(dataset.contacts.reduce((s,q)=>s+(q.scoreGain??0),0)).toBe(30);
    expect(dataset.contacts[2].dupe).toBe(true);expect(dataset.contacts[2].newKeys).toEqual([]);
  });
  it("never reintroduces a multiplier when an earlier QSO is filtered away",()=>{
    const filtered=selectContacts(data(),{...defaultAnalyticsFilters,from:"2026-10-25T01:00"});
    expect(filtered).toHaveLength(1);expect(filtered[0].newKeys).toEqual(["CQ zone 4 · 20m"]);
  });
  it("keeps host duplicate ownership after a timestamp correction and report round-trip",()=>{
    const original={...analyticsFixtureRows[0],sourceOrder:1,utc:"2026-10-25 12:10:00"};
    const duplicate={...analyticsFixtureRows[2],sourceOrder:2,utc:"2026-10-25 12:00:00"};
    const dataset=prepareAnalytics({...analyticsFixtureMeta,total:2,score:{qsos:2,points:3,multipliers:2,total:6}},[duplicate,original]);
    expect(dataset.contacts.map(q=>[q.id,q.dupe])).toEqual([["c",true],["a",false]]);
    expect(dataset.scoreHistory).toBe(true);
    const selected=selectContacts(dataset,{...defaultAnalyticsFilters,basis:"nondupe"});
    expect(selected.map(q=>q.id)).toEqual(["a"]);expect(aggregate(selected).points).toBe(3);
    const restored=readAnalyticsReport(JSON.stringify(analyticsReport(dataset,defaultAnalyticsFilters)));
    expect(restored.contacts.map(q=>[q.id,q.dupe])).toEqual([["c",true],["a",false]]);
    const oldReport=analyticsReport(dataset,defaultAnalyticsFilters);
    expect(()=>readAnalyticsReport(JSON.stringify({...oldReport,rows:oldReport.rows.map(({sourceOrder,...row})=>row)}))).toThrow("stored contact order");
  });
  it("preserves unknown style and operator; distinct totals are nonadditive",()=>{
    const dataset=data();expect(aggregate(dataset.contacts)).toMatchObject({qsos:4,calls:3,nondupe:3,duplicates:1});
    const mixed=prepareAnalytics({...analyticsFixtureMeta,score:{...analyticsFixtureMeta.score,total:0}},[analyticsFixtureRows[0],{...analyticsFixtureRows[0],id:"other",band:"40m"}]);
    const table=pivot(mixed.contacts,"country","band","calls");expect(table.total).toBe(1);expect(table.cells.map(c=>c.value)).toEqual([1,1]);
    expect(analyzeAnalytics(dataset,defaultAnalyticsFilters,Date.parse("2026-10-25T03:00:00Z")).styles.find(s=>s.style==="Unknown")?.qsos).toBe(1);
  });
  it("uses UTC half-open buckets across days including exact boundaries and quiet hours",()=>{
    const dataset=data(),buckets=timeline(dataset.contacts,defaultAnalyticsFilters,Date.parse("2026-10-25T02:30:00Z"),true);
    expect(buckets.map(b=>b.qsos)).toEqual([1,2,0,1]);expect(buckets[0].start).toBe(Date.parse("2026-10-24T23:00:00Z"));expect(buckets.at(-1)?.partial).toBe(true);
    const selected=selectContacts(dataset,{...defaultAnalyticsFilters,from:"2026-10-25T00:00",to:"2026-10-25T02:00"});expect(selected.map(q=>q.id)).toEqual(["b","c"]);
  });
  it("continues valid time calculations while keeping invalid rows inspectable",()=>{
    const dataset=prepareAnalytics({...analyticsFixtureMeta,total:5},[...analyticsFixtureRows,{...analyticsFixtureRows[0],id:"bad",utc:"invalid"}]);
    const result=analyzeAnalytics(dataset,defaultAnalyticsFilters,Date.parse("2026-10-25T03:00:00Z"));
    expect(result.summary.qsos).toBe(5);expect(result.buckets.reduce((s,b)=>s+b.qsos,0)).toBe(4);
    expect(result.quality.find(q=>q.issue==="Invalid timestamp")?.ids).toEqual(["bad"]);expect(dataset.scoreHistory).toBe(false);
  });
  it("hides unsupported historical scoring and plugin-specific zone meanings",()=>{
    const dataset=prepareAnalytics({...analyticsFixtureMeta,cqWW:false,pluginID:"iaru_hf",dupeType:5},analyticsFixtureRows);
    expect(dataset.scoreHistory).toBe(false);expect(dataset.contacts.every(q=>q.scoreGain===null&&q.newKeys.length===0&&q.dupe===null)).toBe(true);
  });
  it("keeps claimed category separate from all-log counts",()=>{
    const rows=analyticsFixtureRows.map((row,index)=>({...row,inCategory:index!==0}));const dataset=prepareAnalytics(analyticsFixtureMeta,rows);
    expect(selectContacts(dataset,defaultAnalyticsFilters)).toHaveLength(4);expect(selectContacts(dataset,{...defaultAnalyticsFilters,scope:"category"})).toHaveLength(3);
    expect(dataset.meta.score.total).toBe(30);
  });
  it("uses fixed elapsed denominators for best intervals and recent pace",()=>{
    const dataset=prepareAnalytics(analyticsFixtureMeta,[{...analyticsFixtureRows[0],utc:"2026-10-25 12:00:00"},{...analyticsFixtureRows[1],utc:"2026-10-25 12:01:00"}]);
    const result=analyzeAnalytics(dataset,defaultAnalyticsFilters,Date.parse("2026-10-25T12:30:00Z"));
    expect(result.recent.find(r=>r.minutes===60)?.rate).toBe(2);expect(bestIntervals(dataset.contacts)[0]).toMatchObject({qsos:2,rate:12});
  });
  it("supports configured empty event hours and rejects excessive buckets",()=>{
    const filters={...defaultAnalyticsFilters,from:"2026-10-24T21:00",to:"2026-10-25T04:00"};expect(timeline(data().contacts,filters,0,true).map(b=>b.qsos)).toEqual([0,0,1,2,0,1,0]);
    expect(()=>timeline(data().contacts,{...filters,from:"2020-01-01T00:00"},0,true)).toThrow("4,096");
  });
  it("round-trips portable read-only reports and rejects malicious capability metadata",()=>{
    const report=analyticsReport(data(),defaultAnalyticsFilters);expect(readAnalyticsReport(JSON.stringify(report)).contacts.map(q=>q.id)).toEqual(["a","b","c","d"]);
    expect(()=>readAnalyticsReport(JSON.stringify({...report,rows:[null]}))).toThrow();
    const altered={...report,meta:{...report.meta,pluginID:"iaru_hf",cqWW:true}};expect(readAnalyticsReport(JSON.stringify(altered)).scoreHistory).toBe(false);
  });
  it("does not mutate the source rows or metadata",()=>{
    const before=JSON.stringify({meta:analyticsFixtureMeta,rows:analyticsFixtureRows});analyzeAnalytics(data(),defaultAnalyticsFilters,0);expect(JSON.stringify({meta:analyticsFixtureMeta,rows:analyticsFixtureRows})).toBe(before);
  });
  it("analyzes all 10,000 contacts with bounded full-event buckets",()=>{
    const start=Date.parse("2026-10-23T00:00:00Z"),rows=Array.from({length:10000},(_,index)=>({...analyticsFixtureRows[0],id:`scale-${index}`,call:`K${index}TEST`,utc:new Date(start+index*16000).toISOString()}));
    const meta={...analyticsFixtureMeta,total:10000,score:{qsos:10000,points:30000,multipliers:2,total:60000}};
    const started=performance.now(),dataset=prepareAnalytics(meta,rows),result=analyzeAnalytics(dataset,defaultAnalyticsFilters,start+10000*16000);
    expect(result.summary.qsos).toBe(10000);expect(result.summary.calls).toBe(10000);expect(result.buckets.reduce((s,b)=>s+b.qsos,0)).toBe(10000);expect(result.buckets.length).toBeLessThan(50);
    expect(dataset.scoreHistory).toBe(true);console.info(`Analytics 10k prepare + aggregate: ${(performance.now()-started).toFixed(1)} ms`);
  });
  it("keeps the full timeline extent after band filtering, including empty hours",()=>{
    const result=analyzeAnalytics(data(),{...defaultAnalyticsFilters,band:"40m"},Date.parse("2026-10-25T02:30:00Z"));
    expect(result.summary.qsos).toBe(0);expect(result.buckets.map(b=>b.qsos)).toEqual([0,0,0,0]);
  });
  it("compares equivalent elapsed intervals rather than a subset against an entire reference",()=>{
    const current=data(),shift=365*86400000,reference=prepareAnalytics({...analyticsFixtureMeta},analyticsFixtureRows.map(q=>({...q,utc:new Date(analyticsTime(q.utc)!-shift).toISOString()})));
    const filters={...defaultAnalyticsFilters,from:"2026-10-25T00:00",to:"2026-10-25T01:00"};
    const translated=comparisonFilters(filters,current.contacts[0].time,reference.contacts[0].time);
    expect(selectContacts(current,filters).map(q=>q.id)).toEqual(selectContacts(reference,translated).map(q=>q.id));
  });
});

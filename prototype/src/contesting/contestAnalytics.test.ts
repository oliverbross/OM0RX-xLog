import { describe,expect,it } from "vitest";
import { aggregate,analyzeAnalytics,analyticsReport,analyticsTime,bestIntervals,comparisonFilters,defaultAnalyticsFilters,pivot,prepareAnalytics,readAnalyticsReport,selectContacts,timeline } from "./contestAnalytics";
import { analyticsFixtureMeta,analyticsFixtureRows } from "./contestAnalytics.fixtures";

const data=()=>prepareAnalytics(analyticsFixtureMeta,analyticsFixtureRows);
describe("contest analytical semantics",()=>{
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

import { describe, expect, it } from "vitest";
import { compareContestLog, defaultReviewOptions, possibleCallTypo, reviewTime, type ReviewQSO, type ReviewSpot } from "./logReview";
export const qso=(patch:Partial<ReviewQSO>={}):ReviewQSO=>({ID:"qso-1",Call:"DL3AG",TS:"2026-10-24 00:01:00",Freq:7150,Mode:"LSB",NR:14,...patch});
export const spot=(patch:Partial<ReviewSpot>={}):ReviewSpot=>({id:"spot-1",callsign:"DL3AG",spotter:"OM0RX",frequencyKHz:7150,band:"40m",
  mode:"SSB",reportedAt:"2026-10-23T23:59:00Z",arrivedAt:"2026-10-24T00:01:01Z",recordKind:"live",source:"cluster",
  comment:"CQ WW",clusterName:"Test cluster",...patch});
const compare=(qsos:ReviewQSO[],spots:ReviewSpot[])=>compareContestLog(qsos,spots,defaultReviewOptions);
describe("contest archive comparison",()=>{
  it("corroborates case-insensitive phone aliases across midnight using reported UTC",()=>{
    expect(compare([qso({Call:"dl3ag"})],[spot({arrivedAt:"2026-10-25T00:00:00Z",recordKind:"historical_reply"})]))
      .toMatchObject({corroborated:1,findings:[],withoutEvidence:0});
  });
  it("flags a nearby one-character typo and preserves original contact",()=>{
    const row=Object.freeze(qso({Call:"DL3AJ"}));
    const original=JSON.stringify(row);
    expect(compare([row],[spot()]).findings[0]).toMatchObject({kind:"Possible typo",qso:row,evidence:[{callsign:"DL3AG"}]});
    expect(JSON.stringify(row)).toBe(original);
  });
  it("counts every candidate before truncating supporting reports",()=>{
    const reports=Array.from({length:9},(_,index)=>spot({id:String(index),spotter:`K${index}AA`,callsign:index===8?"DL3AK":"DL3AG",
      reportedAt:`2026-10-24T00:01:0${index}Z`}));
    const finding=compare([qso({Call:"DL3AJ"})],reports).findings[0];
    expect(finding.evidence).toHaveLength(8);expect(finding.candidateCalls).toEqual(["DL3AG","DL3AK"]);
  });
  it("does not flag another station at the same frequency if the logged call is corroborated",()=>{
    expect(compare([qso()],[spot(),spot({id:"other",callsign:"DL3AJ"})]).findings).toEqual([]);
  });
  it("does not infer a typo from other bands, modes, frequencies or distant times",()=>{
    expect(compare([qso({Call:"DL3AJ"})],[
      spot({frequencyKHz:14150}),spot({mode:"FT8"}),spot({frequencyKHz:7170}),
      spot({reportedAt:"2026-10-24T01:00:00Z"}),
    ]).findings).toEqual([]);
  });
  it("flags exact-call time or frequency mismatch but not a distant unrelated appearance",()=>{
    expect(compare([qso()],[spot({frequencyKHz:7170})]).findings[0]?.kind).toBe("Frequency/time mismatch");
    expect(compare([qso()],[spot({reportedAt:"2026-10-24T00:40:00Z"})]).findings[0]?.kind).toBe("Frequency/time mismatch");
    expect(compare([qso()],[spot({frequencyKHz:7170,reportedAt:"2026-10-24T00:40:00Z"})]).findings).toEqual([]);
  });
  it("accepts a split transmit frequency without a mismatch",()=>{
    expect(compare([qso({QSXFreq:7170})],[spot({frequencyKHz:7170})]).corroborated).toBe(1);
  });
  it("uses the time and frequency tolerances selected by the operator",()=>{
    const reports=[spot({frequencyKHz:7154})];
    expect(compare([qso()],reports).findings).toHaveLength(1);
    expect(compareContestLog([qso()],reports,{...defaultReviewOptions,kHz:5}).corroborated).toBe(1);
  });
  it("uses the shared band-map classifier for supported VHF bands",()=>{
    expect(compare([qso({Freq:144200})],[spot({frequencyKHz:144200,band:"2m"})]).corroborated).toBe(1);
  });
  it("reports missing evidence without declaring the QSO wrong",()=>{
    expect(compare([qso()],[])).toMatchObject({findings:[],withoutEvidence:1});
  });
  it("excludes local overlays, unknown times and invalid calls",()=>{
    expect(compare([qso({Call:"DL3AJ"})],[
      spot({recordKind:"local"}),spot({comment:"Heard while tuning"}),spot({source:"manual"}),
      spot({reportedAt:null}),spot({callsign:"??"}),spot({reportedAt:"2026-02-30T12:00:00Z"}),
    ])).toMatchObject({excludedReports:6,eligibleReports:0,findings:[]});
  });
  it("collapses redistributed reports without presenting vote confidence",()=>{
    const result=compare([qso({Call:"DL3AJ"})],[spot(),spot({id:"copy",clusterName:"Other"})]);
    expect(result.findings[0].evidenceCount).toBe(1);
    expect(result.findings[0].evidence).toHaveLength(1);
  });
  it("recognizes transposition/insertion/deletion, keeping portable suffixes distinct",()=>{
    for(const pair of [["DL3AG","DL3GA"],["DL3AG","DL3A"],["DL3AG","DL33AG"],["DL3AG/P","DL3AJ/P"]])
      expect(possibleCallTypo(...pair as [string,string])).toBe(true);
    for(const pair of [["DL3AG","DL3AG/P"],["DL3AG/P","DL3AG/M"],["ZA/DL3AG","OE/DL3AG"],["DL3AG","K1ABC"]])
      expect(possibleCallTypo(...pair as [string,string])).toBe(false);
  });
  it("changes decision identity after a correction or changed evidence",()=>{
    const first=compare([qso({Call:"DL3AJ"})],[spot()]).findings[0].key;
    expect(compare([qso({Call:"DL3AJ",NR:15})],[spot()]).findings[0].key).not.toBe(first);
    expect(compare([qso({Call:"DL3AJ"})],[spot({frequencyKHz:7151})]).findings[0].key).not.toBe(first);
  });
  it("skips malformed contacts and validates bounds",()=>{
    expect(compare([qso({TS:"not UTC"}),qso({Call:"?"}),qso({Freq:0})],[]).invalidContacts).toBe(3);
    expect(()=>compareContestLog([],[],{...defaultReviewOptions,minutes:NaN})).toThrow();
    expect(Number.isNaN(reviewTime("2026-10-24T01:00:00+01:00"))).toBe(true);
  });
  it("handles a contest-sized sample without modifying or rescoring the log",()=>{
    const rows=Array.from({length:300},(_,i)=>qso({ID:String(i),Call:"K"+i+"AA"}));
    const reports=Array.from({length:10000},(_,i)=>spot({id:String(i),callsign:"K"+i+"AA",
      reportedAt:new Date(Date.UTC(2026,9,23,0,0,i*10)).toISOString()}));
    const result=compare(rows,reports);
    expect(result.checked).toBe(300);
  });
});

import {describe,it,expect} from "vitest";
import {compareContestLog,defaultReviewOptions,type ReviewQSO,type ReviewReferences} from "./logReview";
const row:ReviewQSO={ID:"one",Call:"OE8DDX",TS:"2026-10-24 01:00:00",Freq:7110,Mode:"LSB",
  NR:15,CountryPrefix:"OE",ContestName:"CQ-WW-SSB"};
const refs:ReviewReferences={sources:[{name:"cty",status:"available",version:"fixture"}],rows:[{
  id:"one",call:"OE8DDX",lotwListed:false,countries:[{source:"cty",adif:206,country:"AUSTRIA",cqZone:15,primaryPrefix:"OE"}],
}]};
const compare=(qso:ReviewQSO= row,references=refs)=>compareContestLog([qso],[],defaultReviewOptions,references);
describe("reference evidence for post-contest review",()=>{
  it("does not accuse an unspotted call that is absent from LoTW",()=>{
    expect(compare()).toMatchObject({findings:[],withoutEvidence:1,checked:1});
  });
  it("flags logged country and received zone discrepancies without changing either",()=>{
    const qso=Object.freeze({...row,NR:14,CountryPrefix:"*4U1V"});
    const finding=compare(qso).findings[0];
    expect(finding.kind).toBe("Country / zone mismatch");
    expect(finding.explanation).toContain("*4U1V");expect(finding.explanation).toContain("suggests 15");
    expect(qso).toMatchObject({NR:14,CountryPrefix:"*4U1V"});
  });
  it("flags an invalid CQ WW zone but never interprets another contest serial as a zone",()=>{
    expect(compare({...row,NR:41}).findings[0].explanation).toContain("outside 1–40");
    expect(compare({...row,NR:145,ContestName:"CQ-WPX-SSB"}).findings).toEqual([]);
  });
  it("surfaces country source disagreements instead of choosing a winner",()=>{
    const mixed=structuredClone(refs);mixed.rows[0].countries.push({source:"clublog",adif:100,country:"OTHER",cqZone:15});
    expect(compare(row,mixed).findings[0].explanation).toContain("references disagree");
  });
  it("does not infer missing or unresolved reference data means an invalid call",()=>{
    expect(compare(row,{sources:[{name:"lotw",status:"missing",version:null}],rows:[{id:row.ID,call:row.Call,lotwListed:null,countries:[]}]}).findings).toEqual([]);
  });
  it("invalidates review decisions after a QSO or reference version changes",()=>{
    const bad={...row,NR:14};const key=compare(bad).findings[0].key;
    const updated=structuredClone(refs);updated.sources[0].version="new";
    expect(compare(bad,updated).findings[0].key).not.toBe(key);
    expect(compare({...bad,NR:13}).findings[0].key).not.toBe(key);
  });
  it("counts unsupported bands separately from malformed QSOs",()=>{
    expect(compare({...row,Freq:1296000})).toMatchObject({unsupportedBandContacts:1,invalidContacts:0});
  });
});

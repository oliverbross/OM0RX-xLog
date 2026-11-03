import { describe, expect, it } from "vitest";
import { parseOwnRBN } from "./hfPropagationModel";
import { ownRbnReceivers, receiverLocation } from "./ownRbnMap";
import { checkedGuideRequestFrame, clippedGuideRange, emptyGuideDocument, parseGuide, readGuideDocument } from "./bandMapGuides";
import { builtinGuides } from "./bandMapBuiltinGuides";
import { retainOwnRBN } from "./ownRbnFeed";
describe("Heard me evidence", () => {
  const now = 1_800_000_000_000;
  const raw = (call: string, time = now, snr: unknown = 0) => ["RX-1/P", "14025", call, snr, null, "", 0, 0, 0, 1, time / 1000];
  it("keeps exact transmitted and receiver identities, zero and unknown measurements", () => {
    const spots = parseOwnRBN({ spots: { a: raw("OM0RX"), b: raw("OM0RX/P"), c: raw("OM0RXX"), d: raw(" OM0RX ", now-1000, null) }, call_info: { "RX-1/P": [0,0,0,0,0,0,0,0,"JN88AA"] } }, "OM0RX");
    expect(spots).toHaveLength(2); expect(spots[0]).toMatchObject({ spotter: "RX-1/P", snr: 0, speed: null }); expect(spots[1].snr).toBeNull();
    const rows = ownRbnReceivers(spots, "OM0RX", null, now); expect(rows).toHaveLength(1); expect(rows[0].updates).toBe(2); expect(rows[0].time).toBe(now); expect(rows[0].location?.provenance).toContain("locator centre");
    const replay = retainOwnRBN(spots, [{...spots[0],time:now-5000}],600,now);
    expect(replay[0].time).toBe(now);
    expect(ownRbnReceivers(spots, "OM0RX", null, now+600_001)).toEqual([]);
  });
  it("does not invent receiver positions and bounds dense projections", () => {
    for (const grid of ["", "XX99", "JN88A", "JN88AAoops"]) expect(receiverLocation(grid)).toBeNull();
    expect(receiverLocation("AA00")).toMatchObject({ lat: -89.5, lon: -179 });
    const base = parseOwnRBN({ spots: { a: raw("OM0RX") } }, "OM0RX")[0];
    const rows = ownRbnReceivers(Array.from({length:1000}, (_,i) => ({ ...base, id:String(i), spotter:`RX-${i}` })), "OM0RX", null, now);
    expect(rows).toHaveLength(200); expect(rows.every(r=>r.location === null)).toBe(true);
  });
});
describe("Visual guides", () => {
  it("bounds UTF-8 documents and the exact escaped CAS request before transport", () => {
    expect(() => readGuideDocument(" ".repeat(10_241))).toThrow(/10 KiB/);
    const request = { id:"0".repeat(36), method:"workspace_band_map_apply", operatingContext:"0".repeat(36), params:{generation:"0".repeat(36),scope:"desk",expected:{guidesJSON:"\\".repeat(10000)},patch:{guidesJSON:"\\".repeat(10000)}} };
    expect(() => checkedGuideRequestFrame(request)).toThrow(/32 KiB/);
    expect(checkedGuideRequestFrame({...request,params:{scope:"desk",expected:{guidesJSON:""},patch:{guidesJSON:""}}})).toBeTruthy();
    const compact = {...builtinGuides[0],origin:"custom",ranges:[],markers:[]};
    expect(readGuideDocument(JSON.stringify({...emptyGuideDocument(),custom:Array.from({length:16},(_,i)=>({...compact,id:`copy-${i}`}))})).custom).toHaveLength(16);
    expect(readGuideDocument(JSON.stringify({...emptyGuideDocument(),custom:[{...compact,id:"ranges",ranges:Array.from({length:128},(_,i)=>({startHz:100000+i,endHz:100001+i,color:"#123456",label:""}))}]})).custom[0].ranges).toHaveLength(128);
    expect(readGuideDocument(JSON.stringify({...emptyGuideDocument(),custom:[{...compact,id:"markers",markers:Array.from({length:128},()=>({frequencyHz:14025000,label:"",category:""}))}]})).custom[0].markers).toHaveLength(128);
    const text = JSON.stringify({...emptyGuideDocument(),custom:[{...builtinGuides[0],id:"unicode",origin:"custom",name:"🌍".repeat(20),ranges:[],markers:Array.from({length:128},()=>({frequencyHz:14025000,label:"🌍".repeat(8),category:"personal"}))}]});
    expect(text.length).toBeLessThan(10_240);
    expect(() => readGuideDocument(text)).toThrow(/10 KiB/);
  });
  it("validates published references and clips Hz boundaries without changing source data", () => {
    for (const guide of builtinGuides) expect(parseGuide(JSON.stringify(guide))).toEqual(guide);
    const range = { startHz:14_025_000, endHz:14_025_001, color:"#123456", label:"one Hz" };
    expect(clippedGuideRange(range,14025,14026)).toEqual({top:0,height:.1});
    expect(clippedGuideRange(range,14026,14027)).toBeNull();
  });
  it("round trips personal references while rejecting malformed and oversized imports", () => {
    const guide = { ...builtinGuides[0], id:"personal", origin:"custom", name:"My guide", markers:[{frequencyHz:14_025_000,label:"Personal",category:"personal"}] };
    const doc = {...emptyGuideDocument(), custom:[parseGuide(JSON.stringify(guide))]};
    expect(readGuideDocument(JSON.stringify(doc))).toEqual(doc);
    for (const patch of [{version:2},{units:"kHz"},{ranges:[{startHz:5,endHz:1,color:"red",label:"bad"}]},{markers:[{frequencyHz:NaN,label:"bad",category:"personal"}]}]) expect(()=>parseGuide(JSON.stringify({...guide,...patch}))).toThrow();
    expect(()=>parseGuide(" ".repeat(131_073))).toThrow(/128 KiB/);
  });
});

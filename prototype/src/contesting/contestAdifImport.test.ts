// @vitest-environment jsdom
import { expect, it } from "vitest";
import { contestADIFImport,historicalADIFRecords } from "./contestAdifImport";

const bytes=(value:string)=>new TextEncoder().encode(value).buffer;

it("normalizes N1MM CQ WW SSB ADIF into deterministic contest contacts",async()=>{
  const document="N1MM export<EOH>\n<CALL:4>LZ9W<QSO_DATE:8>20261024<TIME_ON:6>010203<FREQ:7>7.17500<MODE:3>SSB"+
    "<CONTEST_ID:9>CQ-WW-SSB<RST_SENT:2>59<RST_RCVD:2>59<STX_STRING:2>15<CQZ:2>20"+
    "<APP_N1MM_ID:32>8ce260a09bbc48c9bc3642ed635b90dc<EOR>";
  await expect(contestADIFImport(bytes(document))).resolves.toEqual([{
    qsoID:"8ce260a0-9bbc-48c9-bc36-42ed635b90dc",timestamp:"2026-10-24 01:02:03",frequencyHz:7_175_000,mode:"SSB",
    fields:{callsign:"LZ9W",sent:"59",receive:"59",other_1:"15",other_2:"20"},
  }]);
});

it("preserves separately identified N1MM contacts with the same callsign",async()=>{
  const record=(id:string,time:string)=>`<CALL:6>EA5DFV<QSO_DATE:8>20261024<TIME_ON:6>${time}<FREQ:7>7.17900<MODE:3>SSB`+
    `<CONTEST_ID:9>CQ-WW-SSB<RST_SENT:2>59<RST_RCVD:2>59<STX_STRING:2>15<CQZ:2>14<APP_N1MM_ID:32>${id}<EOR>`;
  const records=await contestADIFImport(bytes(record("11111111111141118111111111111111","010203")+
    record("22222222222242228222222222222222","020304")));
  expect(records).toHaveLength(2);
  expect(records.every(item=>item.fields.callsign==="EA5DFV"&&item.frequencyHz===7_179_000)).toBe(true);
  expect(new Set(records.map(item=>item.qsoID)).size).toBe(2);
});

it("rejects a wrong contest, invalid zone, and a truncated record before import",async()=>{
  const base="<CALL:4>LZ9W<QSO_DATE:8>20261024<TIME_ON:6>010203<FREQ:7>7.17500<MODE:3>SSB"+
    "<CONTEST_ID:9>CQ-WW-SSB<RST_SENT:2>59<RST_RCVD:2>59<STX_STRING:2>15<CQZ:2>20<EOR>";
  await expect(contestADIFImport(bytes(base.replace("CQ-WW-SSB","CQ-WW-CW!")))).rejects.toThrow("not CQ-WW-SSB");
  await expect(contestADIFImport(bytes(base.replace("<CQZ:2>20","<CQZ:2>41")))).rejects.toThrow("invalid CQ zone");
  await expect(contestADIFImport(bytes(base.replace("<CALL:4>LZ9W","<CALL:8>LZ9W")))).rejects.toThrow();
});

it("uses the shared ADI/ADX decoder and retains raw serials, submode and extension metadata without row identities",async()=>{
  const document='<ADX><HEADER><ADIF_VER>3.1.7</ADIF_VER></HEADER><RECORDS><RECORD><CALL>K1ABC</CALL><STX>00101</STX><MODE>RTTY</MODE><SUBMODE>RTTY</SUBMODE><APP PROGRAMID="VENDOR" FIELDNAME="SOURCE" TYPE="S">opaque</APP></RECORD></RECORDS></ADX>';
  const records=await historicalADIFRecords(bytes(document),'utf-8');
  expect(records[0].raw).toMatchObject({CALL:'K1ABC',STX:'00101',MODE:'RTTY',SUBMODE:'RTTY',APP_VENDOR_SOURCE:'opaque'});
  expect(records[0].metadata?.extensions.APP_VENDOR_SOURCE).toBeTruthy();expect(records[0].sourceSHA256).toMatch(/^[a-f0-9]{64}$/);
  await expect(historicalADIFRecords(bytes('<CALL:4>K1AB'),'utf-8')).rejects.toThrow();
});

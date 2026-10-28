// @vitest-environment jsdom
import { expect,it } from "vitest";
import { writeFileSync } from "node:fs";
import { ADIFExportDocument,decodeADIFDocument } from "/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/src/live/adifTransfer";
const out="/tmp/xlog-review-verification-20261028-12824393/frontend/";
it.each([['NAME','Alice'],['GUEST_OP','W1AW'],['VE_PROV','ON']])("VERIFY freezes actual %s ADX export for independent schema validation",(name,value)=>{
  const field=(key:string,text:string)=>`<${key}:${new TextEncoder().encode(text).length}>${text}`;
  const adi=field('CALL','K1ABC')+field('QSO_DATE','20261028')+field('TIME_ON','123456')+field('BAND','20m')+field('MODE','CW')+field(name,value)+'<EOR>\r\n';
  const writer=new ADIFExportDocument('adx');writer.append(adi,1);
  const xml=writer.finish();expect(decodeADIFDocument(new TextEncoder().encode(xml).buffer).text).toBe(adi);
  writeFileSync(out+name+'.adx',xml);
  console.log('VERIFY codec generated',name,xml);
});

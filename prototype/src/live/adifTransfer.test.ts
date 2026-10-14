// @vitest-environment jsdom
import { expect, it } from "vitest";
import { adifBatches, decodeADIF } from "./adifTransfer";

it("rejects malformed UTF-8 instead of replacing the invalid bytes", () => {
  expect(() => decodeADIF(new Uint8Array([60, 67, 65, 76, 76, 58, 49, 62, 0xff]).buffer)).toThrow("Only UTF-8 ADI or ADX");
  expect(decodeADIF(new TextEncoder().encode("<COMMENT:2>é<EOR>").buffer)).toContain("é");
});
it.each(["<?xml version='1.0'?><ADX/>", "<ADX/>"])("rejects incomplete ADX %s", text => {
  expect(() => decodeADIF(new TextEncoder().encode(text).buffer)).toThrow("invalid or unsupported XML");
});

const decode = (text: string) => decodeADIF(new TextEncoder().encode(text).buffer);
const adx = (fields: string, header = "<ADIF_VER>3.1.7</ADIF_VER>") => `<ADX><HEADER>${header}</HEADER><RECORDS><RECORD>${fields}</RECORD></RECORDS></ADX>`;

it("converts UTF-8 ADX text, empty fields and extensions into exact byte-counted ADI", () => {
  const converted = decode("\uFEFF<?xml version='1.0' encoding='UTF-8'?>" + adx(
    "<CALL>W1AW</CALL><COMMENT>Žilina &amp; &lt;EOR&gt; 😀</COMMENT><NOTES/>" +
    '<APP PROGRAMID="TEST" FIELDNAME="OPAQUE" TYPE="S">value</APP><USERDEF FIELDNAME="CUSTOM">é</USERDEF>',
    '<USERDEF FIELDID="1" TYPE="S">CUSTOM</USERDEF>'));
  const comment = "Žilina & <EOR> 😀";
  expect(converted).toBe(`<CALL:4>W1AW<COMMENT:${new TextEncoder().encode(comment).length}>${comment}<NOTES:0><APP_TEST_OPAQUE:5>value<CUSTOM:2>é<EOR>\r\n`);
  expect(adifBatches(converted)).toEqual([converted]);
});

it("keeps record order and uses the existing bounded batcher for ADX", () => {
  const xml = `<ADX><HEADER/><RECORDS>${"<RECORD><CALL>W1AW</CALL></RECORD>".repeat(101)}</RECORDS></ADX>`;
  const batches = adifBatches(decode(xml));
  expect(batches).toHaveLength(2);
  expect(batches[1].trim()).toBe("<CALL:4>W1AW<EOR>");
  expect(() => adifBatches(decode(adx(`<COMMENT>${"x".repeat(14_001)}</COMMENT>`)))).toThrow("safe import size");
});

it("accepts XML namespaces, comments, processing instructions and CDATA field text", () => {
  expect(decode('<a:ADX xmlns:a="urn:adif"><a:HEADER/><!-- metadata --><a:RECORDS><?export value?><a:RECORD><a:COMMENT><![CDATA[<EOR> & é]]></a:COMMENT></a:RECORD></a:RECORDS></a:ADX>'))
    .toBe("<COMMENT:10><EOR> & é<EOR>\r\n");
});

it.each([
  '<!DOCTYPE ADX [<!ENTITY custom "value">]>' + adx("<COMMENT>&custom;</COMMENT>"),
  '<!DOCTYPE ADX SYSTEM "https://example.invalid/external.dtd">' + adx("<CALL>W1AW</CALL>"),
  '<?xml version="1.0" encoding="ISO-8859-1"?>' + adx("<CALL>W1AW</CALL>"),
  adx("<CALL>W1AW</CALL><call>K1ABC</call>"),
  adx('<APP PROGRAMID="TEST" FIELDNAME="X">a</APP><APP_TEST_X>b</APP_TEST_X>'),
  adx("<COMMENT><CALL>W1AW</CALL></COMMENT>"),
  adx("<COMMENT>&unknown;</COMMENT>"),
  adx('<CALL unexpected="ignored">W1AW</CALL>'),
  adx('<USERDEF FIELDNAME="EOR">bad</USERDEF>'),
  adx('<APP FIELDNAME="X">bad</APP>'),
  adx("<CALL>W1AW</CALL>").replace("</RECORD>", ""),
  adx("<CALL>W1AW</CALL>").replace("<RECORDS>", "<RECORDS>lost text"),
  "<ADX><HEADER/><RECORDS/></ADX>",
  "<ADX><HEADER/><RECORDS><UNEXPECTED/></RECORDS></ADX>",
])("rejects unsafe, lossy or malformed XML before preview: %s", source => {
  expect(() => decode(source)).toThrow();
});

it("rejects UTF-16 and unsupported XML encoding even when its text is ASCII", () => {
  expect(() => decode("<\0A\0D\0X\0>\0")).toThrow("Only UTF-8");
  expect(() => decodeADIF(new Uint8Array([0xff, 0xfe, 60, 0]).buffer)).toThrow("Only UTF-8");
});

it("keeps UTF-8 and EOR-looking field values in their length-delimited records", () => {
  const text = "<COMMENT:10>é<EOR>abc<EOR>\r\n";
  expect(adifBatches(text)).toEqual([text]);
});
it("batches only complete records with byte and record bounds", () => {
  const record = "<CALL:4>W1AW<EOR>";
  expect(adifBatches(record.repeat(101))).toEqual([record.repeat(100), record]);
  expect(adifBatches(record.repeat(2), 20)).toEqual([record, record]);
  expect(() => adifBatches(record, 10)).toThrow("safe import size");
});
it.each(["no records", "<CALL:4>W1", "<CALL:4>W1AW", "<CALL:x>W1AW<EOR>"])("rejects incomplete or malformed input %s", text => {
  expect(() => adifBatches(text)).toThrow();
});
